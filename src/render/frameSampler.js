// ======================================================
// GIMBALVID — FLIGHT FRAME SAMPLER
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
import { readTelemetry } from "./telemetry.js";

const DEFAULT_LOOP_INTERVAL_US = 20_000;

/**
 * Build a reusable sampler for one decoded flight.
 * Returns null when the flight carries no rcCommand[0..3]
 * telemetry (nothing to map onto the gimbals).
 *
 * `frameAt(tSeconds)` returns
 *   { row, positions, toggles, telemetry }
 * or null past the end of the flight.
 */
export function createFlightSampler(flight) {
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

    return { row, positions, toggles, telemetry };
  }

  return {
    durationSeconds,
    samplingIntervalUs: typicalIntervalUs,
    frameAt
  };
}