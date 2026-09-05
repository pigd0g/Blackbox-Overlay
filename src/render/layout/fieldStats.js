// ======================================================
// Blackbox-Overlay — FIELD STATISTICS
// ======================================================
//
// Per-field whole-log statistics for the layout engine's
// Max Value modes:
//
//   flightStats(sourceId) → { min, max } over the entire
//       log's main frames (one O(frames) pass per field,
//       then a Map lookup).
//
//   movingMax(sourceId) → the running maximum UP TO a row
//       (prefix max), the same pattern frameSampler.js uses
//       for the v1 max-current bar. Shared scan, O(1) reads.
//
// Derived telemetry (RPM, Motor %, …) reads through the
// same column knowledge the scene sampler uses, so both
// modes see identical decoded values.
//
// ======================================================

const DERIVED_READERS = {
  rpm: (frame, b) => {
    const index = b.columnIndexes.headspeed;

    return index >= 0 ? Number(frame[index]) : NaN;
  },
  packVolts: (frame, b) => {
    const index = b.columnIndexes.vbat_alternative ?? b.columnIndexes.vbat;
    const raw = Number(frame[index]);

    return raw > 0 ? raw / 100 : NaN;
  },
  perCell: (frame, b, cells) => {
    const raw = Number(frame[b.columnIndexes.vbat]);

    return raw > 0 && cells ? raw / 100 / cells : NaN;
  },
  current: (frame, b) => {
    const index = b.columnIndexes.ibat;

    return index >= 0 ? Number(frame[index]) / 100 : NaN;
  },
  maxCurrent: (frame, b) => {
    const index = b.columnIndexes.ibat;

    return index >= 0 ? Number(frame[index]) / 100 : NaN;
  },
  escTemp: (frame, b) => {
    const index = b.columnIndexes.tesc;

    return index >= 0 ? Number(frame[index]) : NaN;
  },
  motorPct: (frame, b) => {
    const index = b.columnIndexes.motor;
    const raw = Number(frame[index]);

    return Number.isFinite(raw)
      ? Math.min(100, Math.max(0, (raw / 1000) * 100))
      : NaN;
  }
};

/**
 * Statistics for one decoded flight. Memoized per flight
 * object — decoded flights are immutable, and the GUI preview
 * path constructs these per request (api.js); sharing one
 * instance per flight keeps the lazy per-field scans warm.
 *
 *   stats.flightStats(sourceId) → { min, max } | null
 *   stats.movingMax(sourceId)   → (row) => running max | null
 */
const statsCache = new WeakMap();

/** Test hook: drop memoized stat sets. */
export function clearFieldStatsCache() {
  statsCache.clear();
}

export function createFieldStats(flight) {
  if (!flight || typeof flight !== "object") {
    return null;
  }

  if (statsCache.has(flight)) {
    return statsCache.get(flight);
  }

  const stats = buildFieldStats(flight);

  statsCache.set(flight, stats);

  return stats;
}

function buildFieldStats(flight) {
  const cache = new Map();
  let cells = null;
  let cellsResolved = false;

  const indexOf = (name) => flight.mainFieldNames.indexOf(name);

  function columnBinding() {
    return {
      columnIndexes: {
        vbat: indexOf("Vbat"),
        ibat: indexOf("Ibat"),
        tesc: indexOf("Tesc"),
        headspeed: indexOf("headspeed"),
        motor: indexOf("motor[0]")
      }
    };
  }

  function latchCells() {
    if (cellsResolved) {
      return cells;
    }

    cellsResolved = true;

    const vbatIndex = columnBinding().columnIndexes.vbat;

    if (vbatIndex < 0 || flight.mainFrames.length === 0) {
      return null;
    }

    // Same majority-vote latch idea as frameSampler's cell
    // lock: scan a window of plausible readings, keep the
    // winning count (ties → the earlier, higher reading).
    const votes = new Map();
    const windowEnd = Math.min(150, flight.mainFrames.length);

    for (let row = 0; row < windowEnd; row += 1) {
      const raw = Number(flight.mainFrames[row][vbatIndex]);

      if (!Number.isFinite(raw) || raw <= 0) {
        continue;
      }

      const count = detectCellsLite(raw / 100);

      if (count !== null) {
        votes.set(count, (votes.get(count) ?? 0) + 1);
      }
    }

    let bestCount = null;
    let bestVotes = 0;

    for (const [count, voteCount] of votes) {
      if (voteCount > bestVotes) {
        bestCount = count;
        bestVotes = voteCount;
      }
    }

    cells = bestCount;

    return cells;
  }

  function readValue(sourceId, frame) {
    const id = String(sourceId ?? "");

    if (id.startsWith("derived:")) {
      const key = id.slice("derived:".length);
      const reader = DERIVED_READERS[key];

      if (!reader) {
        return NaN;
      }

      const b = columnBinding();

      if (key === "perCell") {
        return reader(frame, b, latchCells());
      }

      return reader(frame, b);
    }

    if (id.startsWith("field:")) {
      const name = id.slice("field:".length);
      const index = indexOf(name);

      if (index < 0) {
        return NaN;
      }

      const raw = Number(frame[index]);

      // Same known scalers as valueFormat so stats and
      // display agree. Vbat/Ibat ×100, motor[n] is logged
      // as ×10 of a percent.
      if (name === "Vbat") return raw > 0 ? raw / 100 : NaN;
      if (name === "Ibat") return raw / 100;
      if (/^motor\[\d+\]$/.test(name)) return raw / 10;

      return raw;
    }

    return NaN;
  }

  // One walk per field builds both the flight min/max and
  // the prefix-max array; cached for all later reads.
  function scanField(sourceId) {
    if (cache.has(sourceId)) {
      return cache.get(sourceId);
    }

    let entry = null;
    const frames = flight.mainFrames;
    let columnProbe = false;

    if (String(sourceId ?? "").startsWith("field:")) {
      columnProbe = indexOf(String(sourceId).slice("field:".length)) >= 0;
    }

    if (columnProbe || String(sourceId ?? "").startsWith("derived:")) {
      let min = null;
      let max = null;
      let runningMax = null;
      const prefixMax = new Array(frames.length).fill(null);

      for (let row = 0; row < frames.length; row += 1) {
        const value = readValue(sourceId, frames[row]);

        if (!Number.isFinite(value)) {
          continue;
        }

        if (min === null || value < min) {
          min = value;
        }

        if (max === null || value > max) {
          max = value;
        }

        if (runningMax === null || value > runningMax) {
          runningMax = value;
        }

        prefixMax[row] = runningMax;
      }

      if (min !== null) {
        entry = {
          min,
          max,
          maxAt: (atRow) =>
            atRow >= 0 && atRow < prefixMax.length ? prefixMax[atRow] : null
        };
      }
    }

    cache.set(sourceId, entry);

    return entry;
  }

  function flightStats(sourceId) {
    const entry = scanField(sourceId);

    return entry ? { min: entry.min, max: entry.max } : null;
  }

  function movingMax(sourceId) {
    const entry = scanField(sourceId);

    return entry ? entry.maxAt : null;
  }

  return { flightStats, movingMax };
}

// Minimal cell detector (telemetry.detectCells semantics)
// inlined to avoid an import cycle.
const MIN_CELL_VOLTAGE = 3.0;
const MAX_CELL_VOLTAGE = 4.25;
const REF_CELL_VOLTAGE = 3.7;
const FULL_CELL_VOLTAGE = 4.2;
const MAX_CELLS = 14;

function detectCellsLite(totalVolts) {
  if (!Number.isFinite(totalVolts) || totalVolts <= 0) {
    return null;
  }

  let best = null;

  for (let cells = 1; cells <= MAX_CELLS; cells += 1) {
    const perCell = totalVolts / cells;

    if (perCell < MIN_CELL_VOLTAGE || perCell > MAX_CELL_VOLTAGE) {
      continue;
    }

    const score = Math.min(
      Math.abs(perCell - REF_CELL_VOLTAGE),
      Math.abs(perCell - FULL_CELL_VOLTAGE)
    );

    if (!best || score < best.score) {
      best = { cells, score };
    }
  }

  return best ? best.cells : null;
}