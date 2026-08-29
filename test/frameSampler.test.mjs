// ======================================================
// GIMBALVID — FRAME SAMPLER TESTS
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
import { renderStickVideo } from "../src/render/videoRender.js";

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

test("sampler reproduces the CLI video render output", async () => {
  if (!hasFixture) return;

  const dir = mkdtempSync(join(tmpdir(), "gimbalvid-sampler-"));

  try {
    const result = await renderStickVideo(
      flight,
      join(dir, "sampler-check.mp4"),
      { fps: 10, onProgress: () => {} }
    );

    assert.ok(result.frames > 10);
    assert.ok(Math.abs(result.durationSeconds - sampler.durationSeconds) < 0.05);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

after(() => {
  // No global state to reset; the before() hook owns fixtures.
});