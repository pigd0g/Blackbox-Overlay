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
  suggestOutputPath,
  evaluateSync,
  renderPreviewFrame
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
  // Opaque H.264 renders keep the classic .mp4 extension.
  const result = resolveOutputPath(
    "my-video.mp4", "ignored.bbl", 1, false, "h264-yuv420p"
  );

  assertInOutDir(result);
  assert.equal(
    resolve(result),
    resolve(OUT_DIR, "my-video.mp4")
  );
});

test("resolveOutputPath flattens absolute and ../ escapes", () => {
  const absolute = resolveOutputPath("C:\\Windows\\evil.mp4", "a.bbl", 1, false, "h264-yuv420p");
  const traversal = resolveOutputPath("../../../evil.mp4", "a.bbl", 1, false, "h264-yuv420p");

  assertInOutDir(absolute, "absolute path must be flattened");
  assertInOutDir(traversal, "traversal path must be flattened");
  assert.equal(resolve(absolute), resolve(OUT_DIR, "evil.mp4"));
  assert.equal(resolve(traversal), resolve(OUT_DIR, "evil.mp4"));
});

test("resolveOutputPath strips a trailing extension cleanly", () => {
  const result = resolveOutputPath("clip sticks.mp4", "a.bbl", 1, false, "h264-yuv420p");
  assert.equal(resolve(result), resolve(OUT_DIR, "clip sticks.mp4"));
});

test("resolveOutputPath falls back to the log-based default", () => {
  const result = resolveOutputPath("", "some/log/file.bbl", 3, false, "h264-yuv420p");
  const expected = suggestOutputPath("some/log/file.bbl", 3, false, "h264-yuv420p");

  assert.equal(resolve(result), resolve(expected));
  assertInOutDir(result);
  assert.match(result, /file-flight3-overlay\.mp4$/);
});

test("resolveOutputPath forces .mov for default alpha renders", () => {
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

test("resolveOutputPath follows the chosen alpha format", () => {
  // VP9 lives in WebM; ProRes and PNG stay .mov.
  assert.equal(
    resolve(resolveOutputPath("clip.mp4", "a.bbl", 1, true, "vp9-yuva420p")),
    resolve(OUT_DIR, "clip.webm")
  );
  assert.equal(
    resolve(resolveOutputPath("clip.mp4", "a.bbl", 1, true, "png-rgba")),
    resolve(OUT_DIR, "clip.mov")
  );
  assert.equal(
    resolve(resolveOutputPath("clip.mp4", "a.bbl", 1, true, "prores4444-12")),
    resolve(OUT_DIR, "clip.mov")
  );

  // Unknown ids fall back to the default format (.mov).
  assert.equal(
    resolve(resolveOutputPath("clip.mp4", "a.bbl", 1, true, "banana")),
    resolve(OUT_DIR, "clip.mov")
  );

  // Log-based defaults carry the format extension too.
  const fallback = resolveOutputPath("", "log/file.bbl", 2, true, "png-rgba");

  assert.match(fallback, /file-flight2-overlay\.mov$/);
});

test("suggestOutputPath picks the extension per format", () => {
  assert.match(
    suggestOutputPath("a.bbl", 1, true, "vp9-yuva420p"),
    /overlay\.webm$/
  );
  assert.match(
    suggestOutputPath("a.bbl", 1, true, "png-rgba"),
    /overlay\.mov$/
  );
  assert.match(
    suggestOutputPath("a.bbl", 1, true, "prores4444-12"),
    /overlay\.mov$/
  );

  // Null format falls back to the registry default (.mov).
  assert.match(
    suggestOutputPath("a.bbl", 1, true),
    /overlay\.mov$/
  );
});

// ------------------------------------------------------
// Sync drift: evaluateSync + preview mapping surface
// ------------------------------------------------------

test("evaluateSync throws for a missing log file", async () => {
  await assert.throws(
    () => evaluateSync({ filePath: "Z:/definitely/not/here.bbl", flight: 1, layout: null }),
    (error) => /ENOENT|no such file|not a binary/i.test(error.message)
  );
});

test("renderPreviewFrame works with a sync-active layout and no flight", () => {
  // Placeholder state (no flight): the preview ignores sync
  // entirely and must not crash on a sync-active layout.
  const layout = {
    version: 2,
    canvas: { width: 320, height: 180 },
    grid: { cols: 4, rows: 2 },
    alpha: true,
    theme: "default",
    font: "vt323",
    sync: {
      mode: "manual",
      calculate: {
        fps: 60,
        start: { minutes: 0, seconds: 0, frame: 0 },
        end: { minutes: 0, seconds: 0, frame: 0 },
        disarmGracePeriod: 0
      },
      manual: { clockDriftPercent: 1.31 }
    },
    themeOverrides: {},
    items: [
      { id: "t-a", type: "text", col: 0, row: 0,
        props: { source: "custom", customText: "SYNC" } }
    ]
  };

  const frame = renderPreviewFrame({ layout, t: 5 });

  assert.equal(frame.width, 320);
  assert.equal(frame.height, 180);
  assert.equal(frame.pixels.length, 320 * 180 * 4);
});