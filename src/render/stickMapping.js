// ======================================================
// GIMBALVID — STICK MAPPING
// ======================================================
//
// Turns raw rcCommand columns into normalized gimbal
// positions, the same evidence layer Blackbox Lab uses
// for its stick display, reworked for terminal rendering.
//
// rcCommand[0]=roll, [1]=pitch, [2]=yaw, [3]=collective.
// Gimbal assignment (fixed, mode-2 style):
//   left  gimbal: x = yaw,         y = collective
//   right gimbal: x = roll,        y = pitch
//
// ======================================================

export const REQUIRED_FIELDS = [
  "rcCommand[0]",
  "rcCommand[1]",
  "rcCommand[2]",
  "rcCommand[3]",
  "time"
];

// Optional channels used by the on-screen toggles:
//   rcCommand[4] — arming channel (0 = disarmed, high = armed)
//   rcCommand[3] — collective doubles as throttle indicator
export const ARM_CHANNEL = "rcCommand[4]";

// The log states its own deflection range: RF logs use ±500
// for every rcCommand axis, but nothing is assumed — the
// observed extreme decides, with 500 as the floor so a calm
// flight is not stretched to full deflection.
export function detectScale(values) {
  let maxAbs = 0;

  for (const value of values) {
    const abs = Math.abs(Number(value));

    if (Number.isFinite(abs) && abs > maxAbs) {
      maxAbs = abs;
    }
  }

  return Math.max(500, Math.ceil(maxAbs / 100) * 100);
}

export function clamp(value) {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Per-axis scales for a flight's rcCommand columns.
 * Returns null when the log carries no rcCommand telemetry.
 */
export function detectScales(flight) {
  if (!flight || flight.mainFieldNames.length === 0) {
    return null;
  }

  const columns = REQUIRED_FIELDS.map((name) => {
    const index = flight.mainFieldNames.indexOf(name);
    return index >= 0
      ? { index, values: flight.mainFrames.map((frame) => frame[index]) }
      : null;
  });

  if (columns.some((column) => column === null)) {
    return null;
  }

  return {
    columnIndexes: {
      roll: columns[0].index,
      pitch: columns[1].index,
      yaw: columns[2].index,
      collective: columns[3].index,
      time: columns[4].index,
      arm: flight.mainFieldNames.indexOf(ARM_CHANNEL)
    },
    scales: {
      roll: detectScale(columns[0].values),
      pitch: detectScale(columns[1].values),
      yaw: detectScale(columns[2].values),
      collective: detectScale(columns[3].values)
    }
  };
}

/**
 * Toggle states for one main frame:
 *   armed    — arming channel rcCommand[4] is high (non-zero)
 *   throttle — collective stick (rcCommand[3]) above 0
 */
export function readToggleState(frame, binding) {
  const { columnIndexes } = binding;
  const arm =
    columnIndexes.arm >= 0 ? Number(frame[columnIndexes.arm]) || 0 : 0;
  const collective = Number(frame[columnIndexes.collective]) || 0;

  return {
    armed: arm > 0,
    throttle: collective > 0
  };
}

/**
 * Normalized gimbal positions for one main frame: x right,
 * y up, both in [-1, 1].
 */
export function mapStickPositions(frame, binding) {
  const { columnIndexes, scales } = binding;

  return {
    left: {
      x: clamp(frame[columnIndexes.yaw] / scales.yaw),
      y: clamp(frame[columnIndexes.collective] / scales.collective)
    },
    right: {
      x: clamp(frame[columnIndexes.roll] / scales.roll),
      y: clamp(frame[columnIndexes.pitch] / scales.pitch)
    }
  };
}

/**
 * Frame row effective at flight time t: the latest frame at
 * or before t (a stick position holds until the next frame
 * arrives), falling back to row 0 before the log starts.
 */
export function timeToRowIndex(timeColumnUs, tSeconds) {
  if (!timeColumnUs || timeColumnUs.length === 0) {
    return 0;
  }

  const targetUs = tSeconds * 1_000_000;

  let low = 0;
  let high = timeColumnUs.length - 1;

  if (timeColumnUs[low] > targetUs) {
    return 0;
  }

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if (timeColumnUs[mid] <= targetUs) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}