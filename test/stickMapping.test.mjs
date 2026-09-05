// ======================================================
// Blackbox-Overlay — STICK MAPPING UNIT TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectScale,
  clamp,
  detectScales,
  mapStickPositions,
  readToggleState,
  timeToRowIndex
} from "../src/render/stickMapping.js";

function makeFlight(mainFieldNames, mainFrames) {
  return {
    mainFieldNames,
    mainFrames
  };
}

test("detectScale floors at 500 for calm logs", () => {
  assert.equal(detectScale([10, -20, 30]), 500);
  assert.equal(detectScale([0]), 500);
  assert.equal(detectScale([]), 500);
});

test("detectScale rounds observed extremes up to the next 100", () => {
  assert.equal(detectScale([520]), 600);
  assert.equal(detectScale([-501, 500]), 600);
  assert.equal(detectScale([1000]), 1000);
});

test("clamp keeps positions in [-1, 1]", () => {
  assert.equal(clamp(-2), -1);
  assert.equal(clamp(0), 0);
  assert.equal(clamp(1.5), 1);
});

test("detectScales returns null without rcCommand telemetry", () => {
  assert.equal(detectScales(null), null);
  assert.equal(
    detectScales(makeFlight(["time"], [[0]])),
    null
  );
});

test("mapStickPositions: left = yaw/collective, right = roll/pitch", () => {
  // rcCommand[0]=roll [1]=pitch [2]=yaw [3]=collective, time
  const flight = makeFlight(
    ["rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time"],
    [[250, -250, 500, -500, 0]]
  );

  const binding = detectScales(flight);
  const positions = mapStickPositions(flight.mainFrames[0], binding);

  assert.deepEqual(positions.left, { x: 1, y: -1 });
  assert.deepEqual(positions.right, { x: 0.5, y: -0.5 });
});

test("mapStickPositions keeps full deflection at the standard ±500 range", () => {
  const flight = makeFlight(
    ["rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time"],
    [[500, 0, -500, 0, 0]]
  );

  const binding = detectScales(flight);
  const positions = mapStickPositions(flight.mainFrames[0], binding);

  assert.deepEqual(positions.right, { x: 1, y: 0 });
  assert.deepEqual(positions.left, { x: -1, y: 0 });
});

test("readToggleState: throttle = rcCommand[4], armed = flightModeFlags bit 0", () => {
  // [roll, pitch, yaw, collective, time, throttle(rc4)]
  // slow: [flightModeFlags, ...]
  const flight = makeFlight(
    [
      "rcCommand[0]",
      "rcCommand[1]",
      "rcCommand[2]",
      "rcCommand[3]",
      "time",
      "rcCommand[4]",
      "motor[0]"
    ],
    [
      [0, 0, 0, 10, 0, 0, 0],      // disarmed (flag bit0=1!), throttle 0
      [0, 0, 0, 50, 1000, 1000, 5], // flag cleared, throttle on
      [0, 0, 0, 0, 2000, 0, 300],   // armed again, throttle off, motor spinning
      [0, 0, 0, -20, 3000, 0, 0]    // disarmed, negative collective (irrelevant)
    ]
  );
  flight.slowFieldNames = ["flightModeFlags", "stateFlags"];
  flight.slowFrames = [
    { afterMainFrame: -1, values: [1, 7] },     // ARM box set
    { afterMainFrame: 0, values: [0, 7] },      // ARM box cleared
    { afterMainFrame: 2, values: [1, 5] }       // ARM box set again
  ];

  const binding = detectScales(flight);

  const slowAt = (mainRow) => {
    let values = flight.slowFrames[0].values;
    for (const slow of flight.slowFrames) {
      if (slow.afterMainFrame <= mainRow) values = slow.values;
    }
    return values;
  };

  // Frame 0: the afterMainFrame=0 slow frame applies at row 0
  // (flag cleared after pre-log values) → not armed, throttle 0.
  assert.deepEqual(
    readToggleState(flight.mainFrames[0], slowAt(0), binding),
    { armed: false, motorOn: false, throttle: false }
  );
  // Frame 1: flag cleared → throttle channel drives only throttle.
  assert.deepEqual(
    readToggleState(flight.mainFrames[1], slowAt(1), binding),
    { armed: false, motorOn: true, throttle: true }
  );
  // Frame 2: flag set again, throttle 0, motor spinning.
  assert.deepEqual(
    readToggleState(flight.mainFrames[2], slowAt(2), binding),
    { armed: true, motorOn: true, throttle: false }
  );
  // Frame 3: latest slow (afterMainFrame=2) still applies.
  assert.deepEqual(
    readToggleState(flight.mainFrames[3], slowAt(3), binding),
    { armed: true, motorOn: false, throttle: false }
  );
});

test("readToggleState: collective (rcCommand[3]) never drives toggles", () => {
  // Collective wildly positive; throttle (rc4) and flags off.
  const flight = makeFlight(
    [
      "rcCommand[0]",
      "rcCommand[1]",
      "rcCommand[2]",
      "rcCommand[3]",
      "time",
      "rcCommand[4]",
      "motor[0]"
    ],
    [[0, 0, 0, 400, 0, 0, 0]]
  );
  flight.slowFieldNames = ["flightModeFlags"];
  flight.slowFrames = [{ afterMainFrame: -1, values: [0] }];

  const binding = detectScales(flight);

  assert.deepEqual(readToggleState(flight.mainFrames[0], flight.slowFrames[0].values, binding), {
    armed: false,
    motorOn: false,
    throttle: false
  });
});

test("readToggleState falls back to motor[0] without flightModeFlags", () => {
  const flight = makeFlight(
    [
      "rcCommand[0]",
      "rcCommand[1]",
      "rcCommand[2]",
      "rcCommand[3]",
      "time",
      "rcCommand[4]",
      "motor[0]"
    ],
    [
      [0, 0, 0, 0, 0, 0, 0],      // motor idle → disarmed
      [0, 0, 0, 0, 1000, 500, 42] // motor spinning → armed
    ]
  );
  flight.slowFieldNames = ["stateFlags"];
  flight.slowFrames = [{ afterMainFrame: -1, values: [7] }];

  const binding = detectScales(flight);
  const noSlow = null;

  assert.deepEqual(readToggleState(flight.mainFrames[0], noSlow, binding), {
    armed: false,
    motorOn: false,
    throttle: false
  });
  assert.deepEqual(readToggleState(flight.mainFrames[1], noSlow, binding), {
    armed: true,
    motorOn: true,
    throttle: true
  });
});

test("readToggleState: Betaflight-style 4-channel log throttles on rcCommand[3]", () => {
  const flight = makeFlight(
    ["rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time"],
    [[0, 0, 0, 800, 0]]
  );

  const binding = detectScales(flight);

  assert.equal(binding.columnIndexes.throttle, binding.columnIndexes.collective);
  assert.deepEqual(readToggleState(flight.mainFrames[0], null, binding), {
    // No slow flags, no motor field → armed/motorOn stay false.
    armed: false,
    motorOn: false,
    throttle: true
  });
});

test("timeToRowIndex finds the nearest frame by binary search", () => {
  // Times in microseconds: 0, 1s, 2s, 3s
  const timeColumnUs = [0, 1_000_000, 2_000_000, 3_000_000];

  assert.equal(timeToRowIndex(timeColumnUs, -1), 0);
  assert.equal(timeToRowIndex(timeColumnUs, 0), 0);
  assert.equal(timeToRowIndex(timeColumnUs, 1.1), 1);
  assert.equal(timeToRowIndex(timeColumnUs, 2.9), 2);
  assert.equal(timeToRowIndex(timeColumnUs, 99), 3);
  assert.equal(timeToRowIndex([], 5), 0);
});