// ======================================================
// GIMBALVID — STICK MAPPING UNIT TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectScale,
  clamp,
  detectScales,
  mapStickPositions,
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