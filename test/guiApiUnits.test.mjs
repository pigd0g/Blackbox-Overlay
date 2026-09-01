// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GUI API UNIT TESTS
// ======================================================
//
// Pure helpers behind the GUI: fps normalization and the
// render destination rule (everything lands in <cwd>/out/).
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, sep } from "node:path";

import {
  normalizeFps,
  FPS_DEFAULT,
  resolveOutputPath,
  suggestOutputPath
} from "../src/gui/api.js";

const OUT_DIR = resolve(process.cwd(), "out");

test("normalizeFps keeps legal decimal rates to 2 places", () => {
  assert.equal(normalizeFps(59.94), 59.94);
  assert.equal(normalizeFps("59.94"), 59.94);
  assert.equal(normalizeFps(29.97), 29.97);
  assert.equal(normalizeFps(23.976), 23.98);
  assert.equal(normalizeFps(30), 30);
  assert.equal(normalizeFps("60.005"), 60.01);
});

test("normalizeFps clamps to the 1–120 band", () => {
  assert.equal(normalizeFps(0.25), 1);
  assert.equal(normalizeFps(-5), 1);
  assert.equal(normalizeFps(150), 120);
  assert.equal(normalizeFps(999), 120);
});

test("normalizeFps falls back to 30 on garbage", () => {
  assert.equal(normalizeFps("banana"), FPS_DEFAULT);
  assert.equal(normalizeFps(Number.NaN), FPS_DEFAULT);
  assert.equal(normalizeFps(undefined), FPS_DEFAULT);
  assert.equal(normalizeFps(null), FPS_DEFAULT);
  assert.equal(normalizeFps(""), FPS_DEFAULT);
});

function assertInOutDir(actual, message) {
  assert.equal(
    resolve(actual).startsWith(OUT_DIR + sep) || resolve(actual) === OUT_DIR,
    true,
    message ?? `${actual} should live in ${OUT_DIR}`
  );
}

test("resolveOutputPath keeps a bare file name in out/", () => {
  const result = resolveOutputPath("my-video.mp4", "ignored.bbl", 1);

  assertInOutDir(result);
  assert.equal(
    resolve(result),
    resolve(OUT_DIR, "my-video.mp4")
  );
});

test("resolveOutputPath flattens absolute and ../ escapes", () => {
  const absolute = resolveOutputPath("C:\\Windows\\evil.mp4", "a.bbl", 1);
  const traversal = resolveOutputPath("../../../evil.mp4", "a.bbl", 1);

  assertInOutDir(absolute, "absolute path must be flattened");
  assertInOutDir(traversal, "traversal path must be flattened");
  assert.equal(resolve(absolute), resolve(OUT_DIR, "evil.mp4"));
  assert.equal(resolve(traversal), resolve(OUT_DIR, "evil.mp4"));
});

test("resolveOutputPath strips a trailing extension cleanly", () => {
  const result = resolveOutputPath("clip sticks.mp4", "a.bbl", 1);
  assert.equal(resolve(result), resolve(OUT_DIR, "clip sticks.mp4"));
});

test("resolveOutputPath falls back to the log-based default", () => {
  const result = resolveOutputPath("", "some/log/file.bbl", 3);
  const expected = suggestOutputPath("some/log/file.bbl", 3);

  assert.equal(resolve(result), resolve(expected));
  assertInOutDir(result);
  assert.match(result, /file-flight3-overlay\.mp4$/);
});

test("resolveOutputPath forces .mov for alpha renders", () => {
  const named = resolveOutputPath("my-video.mp4", "a.bbl", 1, true);

  assertInOutDir(named);
  assert.equal(resolve(named), resolve(OUT_DIR, "my-video.mov"));

  const fallback = resolveOutputPath("", "some/log/file.bbl", 3, true);

  assert.equal(
    resolve(fallback),
    resolve(suggestOutputPath("some/log/file.bbl", 3, true))
  );
  assert.match(fallback, /file-flight3-overlay\.mov$/);
});

test("resolveOutputPath keeps .mp4 when alpha is off", () => {
  const named = resolveOutputPath("clip.mov", "a.bbl", 1, false);

  // The user's stem survives; the extension follows the mode.
  assert.equal(resolve(named), resolve(OUT_DIR, "clip.mp4"));
});