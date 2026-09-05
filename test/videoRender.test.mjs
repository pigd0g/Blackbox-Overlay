// ======================================================
// Blackbox-Overlay — VIDEO RENDER INTEGRATION TEST (v2)
// ======================================================
//
// Renders tiny synthetic videos through a layout and
// validates them with ffprobe: opaque H.264 .mp4 and alpha
// ProRes 4444 .mov with the layout's canvas size. Skips
// cleanly when ffmpeg/ffprobe are not on PATH.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkFfmpegAvailable, renderLayoutVideo } from "../src/render/videoRender.js";
import { normalizeLayout, DEFAULT_LAYOUT, createItem } from "../src/render/layout/layoutSchema.js";

// Render tests are slow (ffmpeg encodes); set RENDER_TESTS=1 to
// include them. Default: skipped — flip on before a release or
// when verifying codec behaviour manually.
const RUN_RENDER_TESTS = process.env.RENDER_TESTS === "1";

function ffmpegAvailable() {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRender = ffmpegAvailable();

function syntheticFlight(seconds, fps) {
  const frames = [];

  for (let i = 0; i < seconds * fps; i += 1) {
    const t = i / fps;
    const sweep = Math.sin(t * Math.PI * 2);
    frames.push([
      Math.round(500 * sweep), // rcCommand[0] roll
      0,                        // rcCommand[1] pitch
      0,                        // rcCommand[2] yaw
      Math.round(500 * (1 - t / seconds)), // rcCommand[3] collective
      Math.round(t * 1_000_000), // time
      Math.round(t * 1000),      // rcCommand[4] throttle
      i > fps / 2 ? 725 : 0,     // motor[0]
      2480,                      // Vbat centivolts
      1996,                      // headspeed
      Math.round(2000 + 500 * sweep), // Ibat centiamps
      40 + Math.round(20 * t)    // Tesc °C
    ]);
  }

  return {
    index: 0,
    durationSeconds: seconds,
    mainFieldNames: [
      "rcCommand[0]",
      "rcCommand[1]",
      "rcCommand[2]",
      "rcCommand[3]",
      "time",
      "rcCommand[4]",
      "motor[0]",
      "Vbat",
      "headspeed",
      "Ibat",
      "Tesc"
    ],
    mainFrames: frames,
    slowFrames: [],
    events: [],
    sysConfig: {},
    stats: {}
  };
}

function testLayout(alpha) {
  const doc = DEFAULT_LAYOUT();
  doc.canvas = { width: 320, height: 180 };
  doc.alpha = alpha;
  doc.items.push(createItem("stick", { col: 0, row: 0 }));
  doc.items.push(createItem("text", { col: 2, row: 0, source: "derived:rpm", showLabel: true }));
  doc.items.push(createItem("bar", { col: 4, row: 0, source: "derived:motorPct", maxValue: { mode: "percent" } }));

  return normalizeLayout(doc).layout;
}

test("renderLayoutVideo produces a valid mp4 at the layout size", { skip: !canRender || !RUN_RENDER_TESTS }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-test-"));
  const outputPath = join(directory, "overlay.mp4");

  try {
    const flight = syntheticFlight(1, 10);
    const layout = testLayout(false);

    const result = await renderLayoutVideo(flight, outputPath, { fps: 10, layout });

    assert.equal(result.frames, 10);
    assert.ok(existsSync(outputPath), "output mp4 missing");

    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v", "error",
          "-show_streams", "-show_format",
          "-of", "json",
          outputPath
        ],
        { encoding: "utf8" }
      )
    );

    const video = probe.streams.find((s) => s.codec_type === "video");
    assert.ok(video, "no video stream");

    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.equal(video.codec_name, "h264");
    assert.equal(Number(probe.format.duration).toFixed(1), "1.0");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderLayoutVideo with alpha defaults to VP9 .webm + preview", { skip: !canRender || !RUN_RENDER_TESTS }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-alpha-"));
  const outputPath = join(directory, "overlay.webm");

  try {
    const flight = syntheticFlight(0.5, 10);
    const layout = testLayout(true);

    const result = await renderLayoutVideo(flight, outputPath, {
      fps: 10,
      layout
    });

    assert.equal(result.frames, 5);
    assert.ok(existsSync(outputPath), "output webm missing");

    const video = probeVideo(outputPath);

    assert.equal(video.codec_name, "vp9");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.equal(String(video.tags?.alpha_mode ?? ""), "1");

    // The flattened preview exists and is playable H.264.
    const previewPath = result.previewPath;

    assert.ok(previewPath, "preview path returned");
    assert.ok(existsSync(previewPath));

    const previewProbe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", previewPath],
        { encoding: "utf8" }
      )
    );

    assert.equal(previewProbe.streams.find((s) => s.codec_type === "video").codec_name, "h264");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderLayoutVideo format=prores4444-12 produces ProRes .mov", { skip: !canRender || !RUN_RENDER_TESTS }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-fmt-"));
  const outputPath = join(directory, "overlay.mov");

  try {
    const result = await renderLayoutVideo(syntheticFlight(0.5, 10), outputPath, {
      fps: 10,
      layout: testLayout(true),
      format: "prores4444-12"
    });

    assert.equal(result.frames, 5);
    assert.ok(existsSync(outputPath));

    const video = probeVideo(outputPath);

    assert.equal(video.codec_name, "prores");
    assert.match(video.pix_fmt, /^yuva444/);
    assert.match(String(video.profile), /4444/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderLayoutVideo format=vp9-yuva420p writes .webm with alpha", { skip: !canRender || !RUN_RENDER_TESTS }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-vp9-"));
  const outputPath = join(directory, "overlay.webm");

  try {
    const result = await renderLayoutVideo(syntheticFlight(0.5, 10), outputPath, {
      fps: 10,
      layout: testLayout(true),
      format: "vp9-yuva420p"
    });

    assert.equal(result.frames, 5);
    assert.ok(existsSync(outputPath), "output webm missing");

    const video = probeVideo(outputPath);

    assert.equal(video.codec_name, "vp9");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);

    // Alpha rides WebM metadata rather than the pix_fmt name.
    assert.equal(String(video.tags?.alpha_mode ?? ""), "1");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderLayoutVideo rejects unknown format ids", async () => {
  const flight = syntheticFlight(0.5, 10);

  await assert.rejects(
    renderLayoutVideo(flight, "out/overlay.mov", {
      fps: 10,
      layout: testLayout(true),
      format: "banana"
    }),
    /Unknown output format/
  );
});

function probeVideo(path) {
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", path],
      { encoding: "utf8" }
    )
  );

  return probe.streams[0];
}

test("renderLayoutVideo with preview:false skips the flattened preview", { skip: !canRender || !RUN_RENDER_TESTS }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-nopreview-"));
  const outputPath = join(directory, "overlay.webm");

  try {
    const flight = syntheticFlight(0.5, 10);
    const layout = testLayout(true);

    const result = await renderLayoutVideo(flight, outputPath, {
      fps: 10,
      layout,
      preview: false
    });

    assert.equal(result.frames, 5);
    assert.equal(result.previewPath, undefined, "no preview path returned");
    assert.ok(existsSync(outputPath), "the .webm itself is still written");
    assert.equal(existsSync(join(directory, "overlay.preview.mp4")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderLayoutVideo rejects stick layouts on flights without rcCommand", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-test-"));
  const outputPath = join(directory, "overlay.mp4");

  try {
    await assert.rejects(
      renderLayoutVideo(
        { mainFieldNames: ["time"], mainFrames: [[0]], durationSeconds: 1, index: 0 },
        outputPath,
        { fps: 10, layout: testLayout(false), format: "h264-yuv420p" }
      ),
      /rcCommand/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderLayoutVideo renders non-stick layouts without rcCommand", { skip: !canRender || !RUN_RENDER_TESTS }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-nostick-"));
  const outputPath = join(directory, "overlay.webm");

  try {
    const doc = DEFAULT_LAYOUT();
    doc.canvas = { width: 160, height: 90 };
    doc.items.push(createItem("text", { col: 0, row: 0, source: "custom", customText: "HELLO" }));

    const layout = normalizeLayout(doc).layout;
    const flight = {
      index: 0,
      durationSeconds: 1,
      mainFieldNames: ["time"],
      mainFrames: [[0], [10000], [20000]],
      slowFrames: [],
      events: [],
      sysConfig: {},
      stats: {}
    };

    const result = await renderLayoutVideo(flight, outputPath, { fps: 3, layout });

    assert.equal(result.frames, 3);
    assert.ok(existsSync(outputPath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("alpha render to an .mp4 path is rejected clearly", async () => {
  const flight = syntheticFlight(0.5, 10);

  await assert.rejects(
    renderLayoutVideo(flight, "out/wrong.mp4", {
      fps: 10,
      layout: testLayout(true),
      format: "png-rgba"
    }),
    /\.mov/
  );
});

test("checkFfmpegAvailable agrees with actual PATH state", async () => {
  const available = await checkFfmpegAvailable();
  assert.equal(available, canRender);
});

// ------------------------------------------------------
// Sync drift compensation (frame count / duration)
// ------------------------------------------------------

function withSync(layout, sync) {
  layout.sync = sync;

  return layout;
}

test("sync manual drift stretches the video span (frame math)", { skip: !RUN_RENDER_TESTS || !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-sync-"));
  const outputPath = join(directory, "overlay.mp4");

  try {
    const flight = syntheticFlight(2, 10); // 20 frames @10fps log
    const layout = withSync(testLayout(false), {
      mode: "manual",
      calculate: {
        fps: 60,
        start: { minutes: 0, seconds: 0, frame: 0 },
        end: { minutes: 0, seconds: 0, frame: 0 },
        disarmGracePeriod: 0
      },
      manual: { clockDriftPercent: 10 } // ×1.1 → 22 frames @10fps
    });

    const result = await renderLayoutVideo(flight, outputPath, {
      fps: 10,
      layout,
      format: "h264-yuv420p",
      preview: false
    });

    assert.equal(result.frames, 22);
    assert.ok(Math.abs(result.durationSeconds - 2.2) < 1e-9);
    assert.ok(Math.abs(result.clockScale - 1.1) < 1e-9);
    assert.ok(Math.abs(result.blackboxDurationSeconds - 2) < 1e-6);
    assert.ok(existsSync(outputPath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("sync calculate mode scales by the ARM-flag span", { skip: !RUN_RENDER_TESTS || !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-synccalc-"));
  const outputPath = join(directory, "overlay.mp4");

  try {
    // 2s log at 10 Hz, ARM set at row 5 (t=0.5s), cleared at
    // row 15 (t=1.5s) → ARM span 1.0s. Footage span 1.1s
    // (at 10 fps "footage" fps) → scale 1.1 → video 2.2s.
    const flight = syntheticFlight(2, 10);
    flight.slowFieldNames = ["flightModeFlags"];
    flight.slowFrames = [
      { afterMainFrame: 0, values: [0] },
      { afterMainFrame: 5, values: [1] },
      { afterMainFrame: 15, values: [0] }
    ];

    const layout = withSync(testLayout(false), {
      mode: "calculate",
      calculate: {
        fps: 10,
        start: { minutes: 0, seconds: 0, frame: 0 },
        end: { minutes: 0, seconds: 1, frame: 1 },
        disarmGracePeriod: 3 // legacy field: must be ignored
      },
      manual: { clockDriftPercent: 0 }
    });

    const result = await renderLayoutVideo(flight, outputPath, {
      fps: 10,
      layout,
      format: "h264-yuv420p",
      preview: false
    });

    assert.ok(Math.abs(result.clockScale - 1.1) < 1e-9);
    assert.ok(Math.abs(result.blackboxDurationSeconds - 1) < 1e-6);
    assert.equal(result.frames, 22);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("sync invalid config falls back to identity scale", { skip: !RUN_RENDER_TESTS || !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-syncbad-"));
  const outputPath = join(directory, "overlay.mp4");

  try {
    const flight = syntheticFlight(1, 10);
    const layout = withSync(testLayout(false), {
      mode: "manual",
      calculate: {
        fps: 60,
        start: { minutes: 0, seconds: 0, frame: 0 },
        end: { minutes: 0, seconds: 0, frame: 0 },
        disarmGracePeriod: 0
      },
      manual: { clockDriftPercent: -100 } // scale 0 → invalid
    });

    const result = await renderLayoutVideo(flight, outputPath, {
      fps: 10,
      layout,
      format: "h264-yuv420p",
      preview: false
    });

    // computeSync resolved the invalid config to identity: the
    // frame count matches the uncompensated render.
    assert.equal(result.frames, 10);
    assert.equal(result.clockScale, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
