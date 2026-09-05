// ======================================================
// Blackbox-Overlay — FLIGHT FRAME SAMPLER
// ======================================================
//
// Shared time-sampling of a decoded flight for the video
// renderer and the GUI preview: given flight time t, produce
// the same state (sticks, toggles, telemetry) the video's
// frame at t would carry.
//
// Slow frames (flightModeFlags etc.) arrive keyed by the
// main-frame index they follow; a cursor carries the most
// recent slow values forward as sampling walks through the
// flight.
//
// ======================================================

import {
  detectScales,
  mapStickPositions,
  readToggleState,
  timeToRowIndex
} from "./stickMapping.js";
import { readTelemetry, detectCells, CURRENT_SCALE } from "./telemetry.js";

const DEFAULT_LOOP_INTERVAL_US = 20_000;
const ARM_FLAG_BIT = 1;

/**
 * Build a reusable sampler for one decoded flight.
 * Returns null when the flight carries no rcCommand[0..3]
 * telemetry (nothing to map onto the gimbals).
 *
 * Memoized per flight object — decoded flights are immutable
 * and the sampler is scrub-order independent, so GUI preview
 * requests and renders share one instance instead of re-scanning
 * the log (time column, cell latch, prefix max) per request.
 *
 * `frameAt(tSeconds)` returns
 *   { row, positions, toggles, telemetry }
 * or null past the end of the flight.
 */
const samplerCache = new WeakMap();

/** Test hook: drop memoized samplers. */
export function clearSamplerCache() {
  samplerCache.clear();
}

export function createFlightSampler(flight) {
  if (!flight || typeof flight !== "object") {
    return null;
  }

  if (samplerCache.has(flight)) {
    return samplerCache.get(flight);
  }

  const sampler = buildFlightSampler(flight);

  samplerCache.set(flight, sampler);

  return sampler;
}

function buildFlightSampler(flight) {
  const binding = detectScales(flight);

  if (!binding) {
    return null;
  }

  const timeIndex = binding.columnIndexes.time;
  const timeColumnUs = flight.mainFrames.map((frame) => frame[timeIndex]);

  const firstTimeUs = flight.mainFrames.length > 0 ? timeColumnUs[0] : 0;

  // Normalize the timeline to 0 so frame i is exactly flight
  // time i / fps, regardless of when the log starts counting.
  const relativeTimeUs = timeColumnUs.map((t) => t - firstTimeUs);

  // Frame interval from the log's own sample rate (fallback:
  // one 20 ms loop), so the final hold period is included.
  const lastTimeUs =
    relativeTimeUs[relativeTimeUs.length - 1] ?? 0;
  const typicalIntervalUs =
    relativeTimeUs.length > 1
      ? relativeTimeUs[relativeTimeUs.length - 1] -
        relativeTimeUs[relativeTimeUs.length - 2]
      : DEFAULT_LOOP_INTERVAL_US;

  const durationSeconds = (lastTimeUs + typicalIntervalUs) / 1_000_000;

  const slowFrames = flight.slowFrames ?? [];

  // ------------------------------------------------------
  // ARM span detection (the flight timeline for sync drift)
  //
  // The ARM flag (flightModeFlags bit 0, carried forward via
  // slow frames) is the only flight-boundary evidence this
  // project trusts: motor/throttle say nothing about log
  // start/stop (motors idle-spin pre-arm, logging continues
  // post-disarm). One forward pass finds the first ARM-on
  // and the first ARM-off after it, in relative log seconds —
  // the same two points the user marks in their footage (arm
  // → disarm switch moments), so Calculate mode divides
  // footage(arm→disarm) by log(arm→disarm).
  //
  //   t_arm    — first main row where ARM is set (0 when the
  //              log starts armed)
  //   t_disarm — first ARM clear after t_arm; null when the
  //              log ends still armed (error case for sync)
  //   armCycles — count of ARM off-transitions (warning when
  //              the log contains more than one arm/disarm
  //              cycle)
  // ------------------------------------------------------
  const flagsIndex = binding.slowColumnIndexes.flightModeFlags;
  let tArm = null;
  let tDisarm = null;
  let armCycles = 0;

  if (flagsIndex >= 0 && slowFrames.length > 0) {
    let slowCursor = 0;
    let armed = false;
    let prevArmed = false;
    let armedEverSeen = false;

    for (let row = 0; row < flight.mainFrames.length; row += 1) {
      while (
        slowCursor < slowFrames.length &&
        slowFrames[slowCursor].afterMainFrame <= row
      ) {
        armed =
          ((Number(slowFrames[slowCursor].values[flagsIndex]) || 0) & ARM_FLAG_BIT) ===
          ARM_FLAG_BIT;
        armedEverSeen = true;
        slowCursor += 1;
      }

      if (!armedEverSeen) {
        continue; // rows before the first slow frame
      }

      // Edge-triggered: count state TRANSITIONS, not rows, so
      // multi-cycle logs report every off-transition while the
      // span timestamps keep the FIRST cycle only.
      if (armed && !prevArmed) {
        if (tArm === null) {
          tArm = relativeTimeUs[row] / 1_000_000;
        }
      } else if (!armed && prevArmed && tArm !== null) {
        if (tDisarm === null) {
          tDisarm = relativeTimeUs[row] / 1_000_000;
        }

        armCycles += 1;
      }

      prevArmed = armed;
    }
  }

  // ------------------------------------------------------
  // Cell-count lock
  //
  // Total voltage alone is ambiguous once a pack sags under
  // load, so the count is decided once per flight from the
  // healthiest early readings and then held: a pack cannot
  // change chemistry mid-air, and a flickering 5S↔6S overlay
  // is worse than a slightly conservative cell bound.
  //
  // Latch procedure: scan the first window of frames with
  // plausible Vbat, detect the count per reading, and keep
  // the majority verdict (ties → the earlier, higher-current
  // reading wins because load only ever sags voltage down,
  // never up).
  // ------------------------------------------------------
  const LATCH_WINDOW_ROWS = 150;
  const vbatIndex = binding.columnIndexes.vbat;

  let lockedCells = null;

  if (vbatIndex >= 0 && flight.mainFrames.length > 0) {
    const windowEnd = Math.min(LATCH_WINDOW_ROWS, flight.mainFrames.length);
    const votes = new Map();

    for (let row = 0; row < windowEnd; row += 1) {
      const raw = Number(flight.mainFrames[row][vbatIndex]);

      if (!Number.isFinite(raw) || raw <= 0) {
        continue;
      }

      const count = detectCells(raw / 100);

      if (count !== null) {
        votes.set(count, (votes.get(count) ?? 0) + 1);
      }
    }

    let bestCount = null;
    let bestVotes = 0;

    // Strict comparison: with an even split, the first count
    // seen in the latch window (earliest rows = highest,
    // least-sagged voltage) keeps the seat.
    for (const [count, voteCount] of votes) {
      if (voteCount > bestVotes) {
        bestCount = count;
        bestVotes = voteCount;
      }
    }

    lockedCells = bestCount;
  }

  // ------------------------------------------------------
  // Running max current (prefix max)
  //
  // The current-vs-max bar reads the peak seen SO FAR, not
  // the flight-wide peak: it hits 100% the moment a new max
  // lands during playback. One forward pass builds a prefix
  // array so frameAt() stays scrub-order independent —
  // maxCurrentUpTo(row) is pure, no cursor state.
  // ------------------------------------------------------
  const ibatIndex = binding.columnIndexes.ibat;
  const maxCurrentPrefix = new Array(flight.mainFrames.length).fill(null);
  let runningMax = null;

  if (ibatIndex >= 0) {
    for (let row = 0; row < flight.mainFrames.length; row += 1) {
      const raw = Number(flight.mainFrames[row][ibatIndex]);

      if (!Number.isFinite(raw) || raw < 0) {
        continue;
      }

      const amps = raw / CURRENT_SCALE;

      if (runningMax === null || amps > runningMax) {
        runningMax = amps;
      }

      maxCurrentPrefix[row] = runningMax;
    }
  }

  const maxCurrentUpTo = (row) =>
    row >= 0 && row < maxCurrentPrefix.length
      ? maxCurrentPrefix[row]
      : null;

  function frameAt(tSeconds) {
    if (!Number.isFinite(tSeconds)) {
      return null;
    }

    const row = timeToRowIndex(relativeTimeUs, tSeconds);

    if (relativeTimeUs.length === 0) {
      return null;
    }

    // The slow-frame cursor is only valid while sampling walks
    // forward; a random jump rewinds it to the flight start.
    let slowValues = slowFrames.length > 0 ? slowFrames[0].values : null;
    let slowCursor = 0;

    while (
      slowCursor < slowFrames.length &&
      slowFrames[slowCursor].afterMainFrame <= row
    ) {
      slowValues = slowFrames[slowCursor].values;
      slowCursor += 1;
    }

    const mainFrame = flight.mainFrames[row];
    const positions = mapStickPositions(mainFrame, binding);
    const toggles = readToggleState(mainFrame, slowValues, binding);
    const telemetry = readTelemetry(mainFrame, binding);

    // The latched count wins whenever the pack was seen at
    // latch time; per-frame detection would flicker under
    // load sag, which is exactly what this prevents.
    if (lockedCells !== null) {
      telemetry.cellCount = lockedCells;
      telemetry.perCell =
        telemetry.packVolts === null
          ? null
          : Math.round((telemetry.packVolts / lockedCells) * 100) / 100;
    }

    // Peak current so far (running max over [0, row]).
    telemetry.maxCurrent = maxCurrentUpTo(row);

    return { row, positions, toggles, telemetry };
  }

  return {
    durationSeconds,
    samplingIntervalUs: typicalIntervalUs,

    /** ARM-flag span for sync drift (tests/debug + sync):
     * null when the log carries no usable ARM transition. */
    get flightSpanSeconds() {
      if (tArm === null || tDisarm === null || !(tDisarm > tArm)) {
        return null;
      }

      return tDisarm - tArm;
    },

    /** Relative log seconds of first ARM-on (null when never armed). */
    get armTimeSeconds() {
      return tArm;
    },

    /** Relative log seconds of first ARM-off after arm. */
    get disarmTimeSeconds() {
      return tDisarm;
    },

    /** ARM off-transition count (>1 = multi-cycle log). */
    get armCycles() {
      return armCycles;
    },

    /** Latched cell count for this flight (tests/debug). */
    get lockedCells() {
      return lockedCells;
    },

    /** Running-max current array accessor (tests/debug). */
    maxCurrentUpTo,

    frameAt
  };
}