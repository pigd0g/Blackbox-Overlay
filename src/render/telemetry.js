// ======================================================
// Blackbox-Overlay — TELEMETRY READING (battery, RPM, motor, ESC)
// ======================================================
//
// Shared telemetry helpers for the on-frame status bar:
//
//   Vbat      — logged as volts × 100 (Blackbox Lab reads
//               it the same way), 23.30 V → 2330
//   headspeed — logged RPM (motor RPM; rotor RPM on
//               geared heads would need the gearing)
//
// Cell counting: a pack's total voltage alone is ambiguous
// (14.8 V could be 4S healthy or 5S nearly dead), so the
// detector bounds each candidate's per-cell voltage to the
// plausible LiPo window and prefers the count whose per-cell
// voltage sits closest to a mid-discharge reference. The
// caller latches the resulting count for the whole flight —
// a pack cannot gain or lose cells mid-air — so heavy-load
// sag can never flip the overlay between 5S and 6S.
//
// ======================================================

// Practical LiPo window (per cell).
export const MIN_CELL_VOLTAGE = 3.0;
export const MAX_CELL_VOLTAGE = 4.25;

// Mid-discharge reference: a pack spends most of its usable
// life near here, so the closest candidate is most likely.
export const REF_CELL_VOLTAGE = 3.7;

// Fresh-off-the-charger reference. RC packs arrive at the
// field charged, so early-flight readings skew high; a
// candidate whose per-cell voltage reads as a *full* pack
// is ordinary, not exotic. Scores near this reference get
// a gentle bonus via a second reference point.
export const FULL_CELL_VOLTAGE = 4.2;

export const MAX_CELLS = 14;
export const VBAT_SCALE = 100;
export const CURRENT_SCALE = 100;
export const MOTOR_SCALE = 1000;

export const MOTOR_MIN_PCT = 0;
export const MOTOR_MAX_PCT = 100;

const ROUND = (value, places) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/**
 * Distance from the nearest of the two anchors — full and
 * mid-discharge. A candidate hugging either chemistry point
 * (4.2 = charged, 3.7 = working) beats one floating between
 * counts with no anchor.
 */
function cellScore(perCell) {
  return Math.min(
    Math.abs(perCell - REF_CELL_VOLTAGE),
    Math.abs(perCell - FULL_CELL_VOLTAGE)
  );
}

/**
 * Pick the most plausible cell count for a pack voltage.
 *
 * Candidates 1S..14S keep only those whose per-cell voltage
 * lands inside the LiPo window; the winner is the count whose
 * per-cell voltage sits closest to a real chemistry point
 * (fully-charged 4.2 V or mid-discharge 3.7 V). This reads
 * the fixture's 24.8 V as 6S @ 4.14 (full 6S) rather than
 * 7S @ 3.55, while nominal packs still resolve to their
 * nominal count.
 */
export function detectCells(totalVolts) {
  if (!Number.isFinite(totalVolts) || totalVolts <= 0) {
    return null;
  }

  let best = null;

  for (let cells = 1; cells <= MAX_CELLS; cells += 1) {
    const perCell = totalVolts / cells;

    if (perCell < MIN_CELL_VOLTAGE || perCell > MAX_CELL_VOLTAGE) {
      continue;
    }

    const score = cellScore(perCell);

    // Strict less-than keeps the smaller (earlier) count on
    // exact ties — the conservative display choice.
    if (!best || score < best.score) {
      best = { cells, perCell, score };
    }
  }

  return best ? best.cells : null;
}

/**
 * Per-cell volts for a known count, 2 decimals. Null when
 * impossible (no pack, non-positive cell count).
 */
export function voltsPerCell(packVolts, cells) {
  if (
    !Number.isFinite(packVolts) ||
    !Number.isFinite(cells) ||
    cells < 1
  ) {
    return null;
  }

  return ROUND(packVolts / cells, 2);
}

/**
 * Confidence that the detected count is right, in [0, 1],
 * from how much margin the winning candidate has over the
 * runner-up; below 3.3 V/cell the pack is in the ambiguous
 * region where adjacent counts are hard to tell apart, so
 * confidence is damped. Status flags low/full conditions.
 */
export function cellConfidence(totalVolts) {
  if (!Number.isFinite(totalVolts) || totalVolts <= 0) {
    return null;
  }

  const candidates = [];

  for (let cells = 1; cells <= MAX_CELLS; cells += 1) {
    const perCell = totalVolts / cells;

    if (perCell < MIN_CELL_VOLTAGE || perCell > MAX_CELL_VOLTAGE) {
      continue;
    }

    candidates.push({ cells, perCell, score: cellScore(perCell) });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => a.score - b.score);

  const best = candidates[0];
  const second = candidates[1];

  let confidence = 1;

  if (second) {
    // Under-load sag compresses scores; 0.25 V of separation
    // between candidates is a solid call.
    confidence = Math.min(1, Math.max(0, (second.score - best.score) / 0.25));
  }

  if (best.perCell < 3.3) {
    confidence *= 0.7;
  }

  return ROUND(confidence, 2);
}

/**
 * Status for one per-cell reading: flags when the pack is
 * near empty or freshly charged.
 */
export function cellStatus(perCell) {
  if (!Number.isFinite(perCell)) {
    return null;
  }

  if (perCell < 3.3) {
    return "low-voltage";
  }

  if (perCell >= 4.2) {
    return "fully-charged";
  }

  return "ok";
}

/**
 * Read live telemetry for one main frame.
 * Returns { packVolts, cellCount, perCell, rpm, motorPct,
 * current, escTemp } with null for anything the log does
 * not carry.
 *
 * `cellCount` here is per-frame detection, used for
 * latching (see frameSampler.js); it holds no state.
 */
export function readTelemetry(frame, binding) {
  const { columnIndexes } = binding;

  let packVolts = null;
  let rpm = null;
  let motorPct = null;
  let current = null;
  let escTemp = null;

  if (columnIndexes.vbat >= 0) {
    const raw = Number(frame[columnIndexes.vbat]);

    if (Number.isFinite(raw) && raw > 0) {
      packVolts = raw / VBAT_SCALE;
    }
  }

  if (columnIndexes.headspeed >= 0) {
    const raw = Number(frame[columnIndexes.headspeed]);

    if (Number.isFinite(raw) && raw >= 0) {
      rpm = raw;
    }
  }

  if (columnIndexes.motor >= 0) {
    const raw = Number(frame[columnIndexes.motor]);

    if (Number.isFinite(raw)) {
      motorPct = Math.round(
        Math.min(
          MOTOR_MAX_PCT,
          Math.max(MOTOR_MIN_PCT, (raw / MOTOR_SCALE) * 100)
        ) * 10
      ) / 10;
    }
  }

  if (columnIndexes.ibat >= 0) {
    const raw = Number(frame[columnIndexes.ibat]);

    if (Number.isFinite(raw)) {
      current = raw / CURRENT_SCALE;
    }
  }

  if (columnIndexes.tesc >= 0) {
    const raw = Number(frame[columnIndexes.tesc]);

    if (Number.isFinite(raw)) {
      escTemp = raw;
    }
  }

  const cellCount = packVolts === null ? null : detectCells(packVolts);
  const perCell = cellCount === null ? null : voltsPerCell(packVolts, cellCount);

  return { packVolts, cellCount, perCell, rpm, motorPct, current, escTemp };
}