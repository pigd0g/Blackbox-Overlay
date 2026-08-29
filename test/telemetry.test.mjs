// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TELEMETRY READING TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectCellCount,
  voltsPerCell,
  readTelemetry
} from "../src/render/telemetry.js";

test("detectCellCount: common 1S-14S lipo rule at 4.1 V/cell", () => {
  assert.equal(detectCellCount(4.1), 1);
  assert.equal(detectCellCount(3.8), 1); // rounds down to 1S
  assert.equal(detectCellCount(8.2), 2);
  assert.equal(detectCellCount(12.3), 3);
  assert.equal(detectCellCount(16.2), 4);
  assert.equal(detectCellCount(24.6), 6); // the Kraken fixture pack
  assert.equal(detectCellCount(49.2), 12);
  assert.equal(detectCellCount(57.4), 14);

  // Outside any plausible lipo: null.
  assert.equal(detectCellCount(0), null);
  assert.equal(detectCellCount(-5), null);
  assert.equal(detectCellCount(62), null); // 15S+ territory
  assert.equal(detectCellCount(Number.NaN), null);
});

test("voltsPerCell rounds to 2 decimals at 4.10 V/cell reference", () => {
  assert.equal(voltsPerCell(24.6, 6), 4.1);
  assert.equal(voltsPerCell(23.3, 6), 3.88);
  assert.equal(voltsPerCell(24.9, 6), 4.15);
  assert.equal(voltsPerCell(12.34, 3), 4.11);

  // Bad inputs → null.
  assert.equal(voltsPerCell(null, 6), null);
  assert.equal(voltsPerCell(24.6, 0), null);
  assert.equal(voltsPerCell(24.6, Number.NaN), null);
});

test("readTelemetry: Vbat /100, headspeed as RPM", () => {
  // Main frame indexes: roll, pitch, yaw, collective, time,
  // throttle, motor, vbat, headspeed.
  const mainFrame = [0, 0, 0, 146, 86_200_000, 1000, 680, 2380, 1978];

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
      headspeed: 8
    }
  };

  assert.deepEqual(readTelemetry(mainFrame, binding), {
    packVolts: 23.8,
    cellCount: 6,
    perCell: 3.97,
    rpm: 1978
  });
});

test("readTelemetry: missing Vbat / headspeed columns read null", () => {
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
      headspeed: -1
    }
  };

  assert.deepEqual(readTelemetry(mainFrame, binding), {
    packVolts: null,
    cellCount: null,
    perCell: null,
    rpm: null
  });
});