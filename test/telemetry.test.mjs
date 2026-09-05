// ======================================================
// Blackbox-Overlay — TELEMETRY READING TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectCells,
  voltsPerCell,
  cellConfidence,
  cellStatus,
  readTelemetry
} from "../src/render/telemetry.js";
import { createFlightSampler } from "../src/render/frameSampler.js";

test("detectCells: healthy packs across the common ranges", () => {
  assert.equal(detectCells(4.1), 1);
  assert.equal(detectCells(7.6), 2);
  assert.equal(detectCells(11.2), 3);
  assert.equal(detectCells(14.8), 4);
  assert.equal(detectCells(15.2), 4); // 4S storage → 3.8 V/cell
  assert.equal(detectCells(18.5), 5);
  assert.equal(detectCells(22.2), 6);
  assert.equal(detectCells(44.4), 12); // 12S nominal
  assert.equal(detectCells(57.4), 14); // 13S would be 4.41 — out of window
});

test("detectCells: rejects anything outside the lipo window", () => {
  assert.equal(detectCells(0), null);
  assert.equal(detectCells(-5), null);
  assert.equal(detectCells(Number.NaN), null);
  // 2.9 * 14 = 40.6 is the lowest legal pack; below that with
  // no candidate inside 3.0–4.25 V/cell → null.
  assert.equal(detectCells(2.9), null);
  // 14S max = 59.5; above that no candidate fits.
  assert.equal(detectCells(62), null);
});

test("detectCells: full packs resolve via the 4.2 V chemistry anchor", () => {
  // Dual anchors (3.7 nominal + 4.2 full) read a fresh pack
  // as its true count: 16.8 V → 4S @ 4.20 (exact anchor) not
  // 5S @ 3.36; 24.6/25.2 V → 6S @ 4.10/4.20 not 7S.
  assert.equal(detectCells(16.8), 4);
  assert.equal(detectCells(24.6), 6);
  assert.equal(detectCells(25.2), 6);
});

test("voltsPerCell rounds to 2 decimals", () => {
  assert.equal(voltsPerCell(24.6, 6), 4.1);
  assert.equal(voltsPerCell(23.3, 6), 3.88);
  assert.equal(voltsPerCell(24.9, 6), 4.15);
  assert.equal(voltsPerCell(12.34, 3), 4.11);

  // Bad inputs → null.
  assert.equal(voltsPerCell(null, 6), null);
  assert.equal(voltsPerCell(24.6, 0), null);
  assert.equal(voltsPerCell(24.6, Number.NaN), null);
});

test("cellConfidence: clear-cut packs score high, ambiguous score low", () => {
  // 22.2 V (6S @ 3.7): 5S would be 4.44 — out of window — so
  // no runner-up exists; full confidence.
  assert.equal(cellConfidence(22.2), 1);

  // 24.6 V (6S @ 4.1): 7S @ 3.51 is the runner-up with the
  // same 0.45 separation — wait, both are 0.45/0.19...
  // 4.10 - 3.70 = 0.40; 3.70 - 3.51 = 0.19 → low confidence.
  const midFull = cellConfidence(24.6);

  assert.ok(midFull >= 0 && midFull <= 1);
  assert.ok(midFull < 1, "4.1 V/cell is symmetric-ish: dubious");

  // Invalid inputs → null.
  assert.equal(cellConfidence(0), null);
  assert.equal(cellConfidence(Number.NaN), null);
});

test("cellStatus flags low and full per-cell readings", () => {
  assert.equal(cellStatus(3.7), "ok");
  assert.equal(cellStatus(3.29), "low-voltage");
  assert.equal(cellStatus(4.2), "fully-charged");
  assert.equal(cellStatus(Number.NaN), null);
});

test("readTelemetry: Vbat /100, headspeed as RPM, motor %, Ibat, Tesc", () => {
  // Main frame indexes: roll, pitch, yaw, collective, time,
  // throttle, motor, vbat, headspeed, ibat, tesc.
  const mainFrame = [0, 0, 0, 146, 86_200_000, 1000, 725, 2380, 1978, 2450, 55];

  const binding = {
    columnIndexes: {
      roll: 0,
      pitch: 1,
      yaw: 2,
      collective: 3,
      time: 4,
      throttle: 5,
      motor: 6,
      vbat: 7,
      headspeed: 8,
      ibat: 9,
      tesc: 10
    }
  };

  // 23.8 V / 6 = 3.97 from the per-frame detector; the latch
  // in frameSampler overrides this per flight.
  assert.deepEqual(readTelemetry(mainFrame, binding), {
    packVolts: 23.8,
    cellCount: 6,
    perCell: 3.97,
    rpm: 1978,
    motorPct: 72.5,
    current: 24.5,
    escTemp: 55
  });
});

test("readTelemetry: missing Vbat / headspeed / Ibat / Tesc columns read null", () => {
  const mainFrame = [0, 0, 0, 0, 0, 0];

  const binding = {
    columnIndexes: {
      roll: 0,
      pitch: 1,
      yaw: 2,
      collective: 3,
      time: 4,
      throttle: 5,
      motor: -1,
      vbat: -1,
      headspeed: -1,
      ibat: -1,
      tesc: -1
    }
  };

  assert.deepEqual(readTelemetry(mainFrame, binding), {
    packVolts: null,
    cellCount: null,
    perCell: null,
    rpm: null,
    motorPct: null,
    current: null,
    escTemp: null
  });
});

test("readTelemetry: motor clamps to [0, 100] %", () => {
  const mainFrame = [0, 0, 0, 0, 0, 0, 1250, 0, 0, 0, 0];

  const binding = {
    columnIndexes: {
      roll: 0,
      pitch: 1,
      yaw: 2,
      collective: 3,
      time: 4,
      throttle: 5,
      motor: 6,
      vbat: -1,
      headspeed: -1,
      ibat: -1,
      tesc: -1
    }
  };

  assert.equal(readTelemetry(mainFrame, binding).motorPct, 100);
});

// ------------------------------------------------------
// Cell-count lock (sampler level)
// ------------------------------------------------------

/**
 * A tiny synthetic flight: N main frames of Vbat readings
 * (mV×100), big enough to exercise the latch window.
 */
function syntheticFlight(vbatSeries) {
  const mainFrames = vbatSeries.map((centiVolts, i) => [
    0, 0, 0, 0, i * 20_000, 0, 0, centiVolts
  ]);

  return {
    index: 0,
    sysConfig: {},
    durationSeconds: vbatSeries.length * 0.02,
    mainFrames,
    mainFieldNames: [
      "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time",
      "flightModeFlags", "motor[0]", "Vbat"
    ],
    slowFrames: [],
    gpsFrames: [],
    events: [],
    stats: { corruptFrames: 0 }
  };
}

/**
 * An Ibat-instrumented flight for the running-max tests:
 * current reads 20.00 A, then 35.64 A, 35.64 A, 35.64 A.
 */
function currentFlight() {
  const ibatSeries = [2000, 3564, 3564, 3564];
  const mainFrames = ibatSeries.map((centiAmps, i) => [
    0, 0, 0, 0, i * 20_000, 0, i > 0 ? 500 : 0, 2480, 1990, centiAmps, 40
  ]);

  return {
    index: 0,
    sysConfig: {},
    durationSeconds: mainFrames.length * 0.02,
    mainFrames,
    mainFieldNames: [
      "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time",
      "rcCommand[4]", "motor[0]", "Vbat", "headspeed", "Ibat", "Tesc"
    ],
    slowFieldNames: ["flightModeFlags"],
    slowFrames: [{ afterMainFrame: -1, values: [1] }],
    gpsFrames: [],
    events: [],
    stats: { corruptFrames: 0 }
  };
}

const BINDING_FRAMES = 400;

test("sampler locks the cell count for the whole flight", () => {
  // Start at 24.8 V (6S @ ~4.13), sag deep into the 5S-vs-6S
  // ambiguous zone (20.4 V is the 6S/5S crossover): per-frame
  // detection flips here, the latch must not.
  const series = [];

  for (let i = 0; i < BINDING_FRAMES; i += 1) {
    const volts = Math.max(24.8 - i * 0.02, 19.8); // → 19.8..24.8
    series.push(Math.round(volts * 100));
  }

  const sampler = createFlightSampler(syntheticFlight(series));

  assert.equal(sampler.lockedCells, 6);

  // First and last frames must both display 6S.
  const first = sampler.frameAt(0);
  const last = sampler.frameAt(sampler.durationSeconds - 0.001);

  assert.equal(first.telemetry.cellCount, 6);
  assert.equal(last.telemetry.cellCount, 6);
  assert.ok(last.telemetry.perCell < 3.5, "deep sag still reads through 6S");
});

test("sampler latch is scrub-order independent", () => {
  const series = [];

  for (let i = 0; i < BINDING_FRAMES; i += 1) {
    series.push(Math.round(Math.max(24.8 - i * 0.02, 19.8) * 100));
  }

  const a = createFlightSampler(syntheticFlight(series));
  const b = createFlightSampler(syntheticFlight(series));

  // Scrub backwards (end → start) vs forwards (start → end).
  const back = [];
  for (let t = a.durationSeconds - 0.02; t >= 0; t -= 0.5) {
    back.push(a.frameAt(Math.max(t, 0)).telemetry.cellCount);
  }

  const forward = [];
  for (let t = 0; t < a.durationSeconds; t += 0.5) {
    forward.push(b.frameAt(t).telemetry.cellCount);
  }

  assert.equal(samplerCellsUnique(back), samplerCellsUnique(forward));
});

function samplerCellsUnique(values) {
  return [...new Set(values)].join(",");
}

test("sampler without Vbat leaves telemetry untouched and unlocked", () => {
  const flight = syntheticFlight(new Array(50).fill(0));

  // Strip Vbat column: null index → no lock, no votes.
  flight.mainFieldNames = flight.mainFieldNames.filter((n) => n !== "Vbat");
  flight.mainFrames = flight.mainFrames.map((frame) => frame.slice(0, -1));

  const sampler = createFlightSampler(flight);

  assert.equal(sampler.lockedCells, null);
  assert.equal(sampler.frameAt(0).telemetry.cellCount, null);
});

// ------------------------------------------------------
// Running max current (sampler level)
// ------------------------------------------------------

test("sampler reports running max current per frame", () => {
  const sampler = createFlightSampler(currentFlight());

  const values = [0, 1, 2, 3].map((i) =>
    sampler.frameAt(i * 0.02).telemetry.maxCurrent
  );

  // Peak appears at row 1 and never decreases afterwards.
  assert.deepEqual(values, [20, 35.64, 35.64, 35.64]);
});

test("sampler running max is scrub-order independent", () => {
  const a = createFlightSampler(currentFlight());
  const b = createFlightSampler(currentFlight());

  // Step through explicit times instead of float-drifting
  // accumulators; each sampler visits in its own order.
  const times = [0, 0.02, 0.04, 0.06];
  const forward = times.map((t) => a.frameAt(t).telemetry.maxCurrent);
  const backward = times
    .slice()
    .reverse()
    .map((t) => b.frameAt(t).telemetry.maxCurrent)
    .reverse();

  assert.deepEqual(forward, backward);
});

test("sampler without Ibat leaves maxCurrent null", () => {
  const flight = currentFlight();

  flight.mainFieldNames = flight.mainFieldNames.filter((n) => n !== "Ibat");
  flight.mainFrames = flight.mainFrames.map((frame) => {
    const copy = frame.slice();
    copy.splice(9, 1);
    return copy;
  });

  const sampler = createFlightSampler(flight);

  assert.equal(sampler.frameAt(0).telemetry.maxCurrent, null);
  assert.equal(sampler.frameAt(0.02).telemetry.maxCurrent, null);
});