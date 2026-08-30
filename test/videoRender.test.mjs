// ======================================================
// RotorFlight-Blackbox-Video-Overlay — VIDEO RENDER INTEGRATION TEST
// ======================================================
//
// Renders tiny synthetic videos and validates them with
// ffprobe: opaque H.264 .mp4 and alpha ProRes 4444 .mov.
// Skips cleanly when ffmpeg/ffprobe are not on PATH.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkFfmpegAvailable, renderStickVideo } from "../src/render/videoRender.js";

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
    mainFrames: frames
  };
}

test("renderStickVideo produces a valid mp4", { skip: !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-test-"));
  const outputPath = join(directory, "sticks.mp4");

  try {
    const flight = syntheticFlight(1, 10);
    const result = await renderStickVideo(flight, outputPath, { fps: 10 });

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

    assert.equal(video.width, 800);
    assert.equal(video.height, 262);
    assert.equal(video.codec_name, "h264");
    assert.equal(Number(probe.format.duration).toFixed(1), "1.0");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderStickVideo with alpha produces ProRes 4444 .mov", { skip: !canRender }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-alpha-"));
  const outputPath = join(directory, "sticks.mov");

  try {
    const flight = syntheticFlight(0.5, 10);
    const result = await renderStickVideo(flight, outputPath, {
      fps: 10,
      alpha: true
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
    assert.equal(video.width, 800);
    assert.equal(video.height, 262);
    assert.match(video.pix_fmt, /^yuva4444?/);

    // Alpha-capable profile: 4444 (or its XT variants).
    assert.match(String(video.profile), /4444/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renderStickVideo rejects flights without rcCommand telemetry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rfbvo-test-"));
  const outputPath = join(directory, "sticks.mp4");

  try {
    await assert.rejects(
      renderStickVideo(
        { mainFieldNames: ["time"], mainFrames: [[0]] },
        outputPath,
        { fps: 10 }
      ),
      /rcCommand/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("checkFfmpegAvailable agrees with actual PATH state", async () => {
  const available = await checkFfmpegAvailable();
  assert.equal(available, canRender);
});