// ======================================================
// RotorFlight-Blackbox-Video-Overlay — VIDEO RENDER INTEGRATION TEST (v2)
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

test("renderLayoutVideo produces a valid mp4 at the layout size", { skip: !canRender }, async () => {
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

test("renderLayoutVideo with alpha produces ProRes 4444 .mov + preview", { skip: !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-alpha-"));
  const outputPath = join(directory, "overlay.mov");

  try {
    const flight = syntheticFlight(0.5, 10);
    const layout = testLayout(true);

    const result = await renderLayoutVideo(flight, outputPath, {
      fps: 10,
      layout
    });

    assert.equal(result.frames, 5);
    assert.ok(existsSync(outputPath), "output mov missing");

    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", outputPath],
        { encoding: "utf8" }
      )
    );

    const video = probe.streams.find((s) => s.codec_type === "video");

    assert.equal(video.codec_name, "prores");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.match(video.pix_fmt, /^yuva4444?/);
    assert.match(String(video.profile), /4444/);

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

test("renderLayoutVideo with preview:false skips the flattened preview", { skip: !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-nopreview-"));
  const outputPath = join(directory, "overlay.mov");

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
    assert.ok(existsSync(outputPath), "the .mov itself is still written");
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
        { fps: 10, layout: testLayout(false) }
      ),
      /rcCommand/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderLayoutVideo renders non-stick layouts without rcCommand", { skip: !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-nostick-"));
  const outputPath = join(directory, "overlay.mov");

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
    renderLayoutVideo(flight, "out/wrong.mp4", { fps: 10, layout: testLayout(true) }),
    /\.mov/
  );
});

test("checkFfmpegAvailable agrees with actual PATH state", async () => {
  const available = await checkFfmpegAvailable();
  assert.equal(available, canRender);
});