// ======================================================
// Blackbox-Overlay — FRAME SAMPLER TESTS
// ======================================================
//
// Uses the real fixture log when present; skips cleanly
// otherwise (matching the integration test's convention).
//
// ======================================================

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeBblFile } from "../src/bbl/bblDecoder.js";
import { createFlightSampler } from "../src/render/frameSampler.js";
import { renderLayoutVideo } from "../src/render/videoRender.js";
import { normalizeLayout, DEFAULT_LAYOUT } from "../src/render/layout/layoutSchema.js";

const FIXTURE = join(
  import.meta.dirname,
  "fixtures",
  "Kraken_20260522_025600.bbl"
);

const hasFixture = existsSync(FIXTURE);

let flight = null;
let sampler = null;

before(() => {
  if (!hasFixture) return;

  const buffer = readFileSync(FIXTURE);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
  const decoded = decodeBblFile(bytes);

  flight = decoded.flights.find((entry) => entry.mainFrames.length > 0);
  sampler = createFlightSampler(flight);
});

test("sampler binds a flight with rcCommand telemetry", () => {
  if (!hasFixture) return;

  assert.ok(sampler, "fixture flight should produce a sampler");
  assert.ok(sampler.durationSeconds > 0);
  assert.ok(Number.isFinite(sampler.samplingIntervalUs));
});

test("frameAt(0) returns the first main frame", () => {
  if (!hasFixture) return;

  const sampled = sampler.frameAt(0);

  assert.equal(sampled.row, 0);
  assert.ok(sampled.positions);
  assert.ok(sampled.toggles);
  assert.ok(sampled.telemetry);

  for (const value of [
    sampled.positions.left.x,
    sampled.positions.left.y,
    sampled.positions.right.x,
    sampled.positions.right.y
  ]) {
    assert.ok(Number.isFinite(value), "positions must be finite");
    assert.ok(value >= -1 && value <= 1, "positions must be normalized");
  }
});

test("frameAt walks forward and clamps past the end", () => {
  if (!hasFixture) return;

  const half = sampler.frameAt(sampler.durationSeconds / 2);

  assert.ok(half.row > 0, "mid-flight sample should advance the row");

  const past = sampler.frameAt(sampler.durationSeconds * 10);

  // Holds the last row rather than crashing.
  assert.ok(past.row > 0);
  assert.ok(Number.isFinite(past.positions.left.y));
});

test("frameAt rejects non-finite times", () => {
  if (!hasFixture) return;

  assert.equal(sampler.frameAt(Number.NaN), null);
});

test("sampler reproduces the video render output", { skip: process.env.RENDER_TESTS !== "1" }, async () => {
  if (!hasFixture) return;

  const dir = mkdtempSync(join(tmpdir(), "rfbvo-sampler-"));

  try {
    const doc = DEFAULT_LAYOUT();
    doc.canvas = { width: 160, height: 90 };
    doc.items = []; // empty layout: pure pipeline check

    const result = await renderLayoutVideo(
      flight,
      join(dir, "sampler-check.mov"),
      {
        fps: 10,
        layout: normalizeLayout(doc).layout,
        format: "png-rgba",
        onProgress: () => {}
      }
    );

    assert.ok(result.frames > 10);
    assert.ok(Math.abs(result.durationSeconds - sampler.durationSeconds) < 0.05);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------
// ARM-flag span detection (sync drift basis)
// ------------------------------------------------------

/** Synthetic flight: main loop at 50 Hz, slow frames keyed by
 * afterMainFrame, ARM flag schedule given in seconds. */
function flaggedFlight({ armOnAt = 0, armOffAt = null, secondCycle = null, durationSeconds = 10 }) {
  const hz = 50;
  const frameCount = Math.round(durationSeconds * hz);
  const frames = [];

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / hz;
    frames.push([
      0,                          // rcCommand[0]
      0,                          // rcCommand[1]
      0,                          // rcCommand[2]
      0,                          // rcCommand[3]
      Math.round(t * 1_000_000),  // time µs
      0,                          // rcCommand[4]
      2480,                       // Vbat
      1000,                       // headspeed
      0                           // Ibat
    ]);
  }

  const armStateAt = (t) => {
    if (secondCycle !== null && t >= secondCycle.rearmAt && t < secondCycle.disarmAt) {
      return true;
    }

    return t >= armOnAt && (armOffAt === null || t < armOffAt);
  };

  const SLOW_EVERY = 25; // every 0.5s
  const slowFrames = [];

  for (let i = 0; i < frameCount; i += SLOW_EVERY) {
    slowFrames.push({
      afterMainFrame: i,
      values: [armStateAt(i / hz) ? 1 : 0]
    });
  }

  return {
    index: 0,
    durationSeconds,
    mainFieldNames: [
      "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time",
      "rcCommand[4]", "Vbat", "headspeed", "Ibat"
    ],
    slowFieldNames: ["flightModeFlags"],
    mainFrames: frames,
    slowFrames,
    events: [],
    sysConfig: {},
    stats: {}
  };
}

test("ARM span: log starts armed, disarms later", () => {
  // ARM from t=0 through t=8 → span 8s (pre/post logging included).
  const sampler = createFlightSampler(flaggedFlight({ armOffAt: 8, durationSeconds: 10 }));

  assert.equal(sampler.armTimeSeconds, 0);
  assert.ok(Math.abs(sampler.disarmTimeSeconds - 8) < 1e-9);
  assert.ok(Math.abs(sampler.flightSpanSeconds - 8) < 1e-9);
  assert.equal(sampler.armCycles, 1);
});

test("ARM span: arm and disarm mid-log (pre-arm idle recorded)", () => {
  // Pre-arm 2s, armed 2–7s, post-disarm tail → span 5s.
  const sampler = createFlightSampler(
    flaggedFlight({ armOnAt: 2, armOffAt: 7, durationSeconds: 10 })
  );

  assert.ok(Math.abs(sampler.armTimeSeconds - 2) < 0.05);
  assert.ok(Math.abs(sampler.disarmTimeSeconds - 7) < 0.05);
  assert.ok(Math.abs(sampler.flightSpanSeconds - 5) < 0.06);
  assert.equal(sampler.armCycles, 1);
});

test("ARM span: log ends still armed → no span", () => {
  const sampler = createFlightSampler(flaggedFlight({ armOffAt: null, durationSeconds: 10 }));

  assert.equal(sampler.flightSpanSeconds, null);
  assert.equal(sampler.disarmTimeSeconds, null);
});

test("ARM span: multiple cycles counted, first span kept", () => {
  const sampler = createFlightSampler(
    flaggedFlight({
      armOnAt: 1,
      armOffAt: 4,
      secondCycle: { rearmAt: 6, disarmAt: 9 },
      durationSeconds: 11
    })
  );

  assert.equal(sampler.armCycles, 2);
  assert.ok(Math.abs(sampler.flightSpanSeconds - 3) < 0.06);
});

test("ARM span: no flightModeFlags column → no span", () => {
  const noFlags = flaggedFlight({ armOffAt: 5 });

  noFlags.slowFrames = [];
  noFlags.slowFieldNames = [];

  const sampler = createFlightSampler(noFlags);

  assert.equal(sampler.flightSpanSeconds, null);
  assert.equal(sampler.armTimeSeconds, null);
});

test("fixture log exposes an ARM span", () => {
  if (!hasFixture) return;

  assert.ok(sampler.flightSpanSeconds > 0, "fixture should arm and disarm");
  assert.ok(sampler.flightSpanSeconds <= sampler.durationSeconds);
  assert.equal(sampler.armCycles, 1);
});

after(() => {
  // No global state to reset; the before() hook owns fixtures.
});