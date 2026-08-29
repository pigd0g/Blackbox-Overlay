// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TELEMETRY READING (battery, RPM)
// ======================================================
//
// Shared telemetry helpers for the on-frame status bar:
//
//   Vbat      — logged as volts × 100 (Blackbox Lab reads
//               it the same way), 23.30 V → 2330
//   headspeed — logged RPM (motor RPM; rotor RPM on
//               geared heads would need the gearing)
//
// Cell count follows the common 1S–14S lipo logic: divide
// pack volts by the nominal-per-cell operating point
// (4.10 V, the same constant Blackbox Lab uses) and round;
// clamped to the 1S..14S range hobby chargers know.
//
// ======================================================

export const VOLTS_PER_CELL_NOMINAL = 4.1;
export const MAX_CELLS = 14;
export const VBAT_SCALE = 100;

/**
 * Cell count from pack volts, 1S..14S. Null when the
 * reading is not plausible for any lipo (0 V, > 14S).
 */
export function detectCellCount(packVolts) {
  if (!Number.isFinite(packVolts) || packVolts <= 0) {
    return null;
  }

  const cells = Math.round(packVolts / VOLTS_PER_CELL_NOMINAL);

  if (cells < 1 || cells > MAX_CELLS) {
    return null;
  }

  return cells;
}

/** Per-cell volts, rounded to 2 decimals. Null if impossible. */
export function voltsPerCell(packVolts, cells) {
  if (
    !Number.isFinite(packVolts) ||
    !Number.isFinite(cells) ||
    cells < 1
  ) {
    return null;
  }

  return Math.round((packVolts / cells) * 100) / 100;
}

/**
 * Read live telemetry for one main frame.
 * Returns { packVolts, cellCount, perCell, rpm } with null
 * for anything the log does not carry.
 */
export function readTelemetry(frame, binding) {
  const { columnIndexes } = binding;

  let packVolts = null;
  let rpm = null;

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

  const cellCount = packVolts === null ? null : detectCellCount(packVolts);
  const perCell = cellCount === null ? null : voltsPerCell(packVolts, cellCount);

  return { packVolts, cellCount, perCell, rpm };
}