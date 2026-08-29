// ======================================================
// GIMBALVID — VIDEO RENDER ORCHESTRATION
// ======================================================
//
// Decodes a flight, samples its main frames in real time
// (frame i = flight time i / fps), paints each sample as a
// gimbal-stick frame, and pipes everything into ffmpeg.
//
// Timing scales with the requested fps: any fps plays back
// at true flight speed, higher fps just adds smoothness.
//
// ======================================================

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { WIDTH, HEIGHT, paintStickFrame } from "./gimbalFrame.js";
import { VideoWriter, checkFfmpegAvailable } from "./videoWriter.js";
import {
  detectScales,
  mapStickPositions,
  readToggleState,
  timeToRowIndex
} from "./stickMapping.js";

export const DEFAULT_FPS = 30;

/**
 * Default output path next to the log:
 * <logBase>-sticks.mp4
 */
export function defaultVideoPath(logFilePath) {
  const dot = logFilePath.lastIndexOf(".");

  const base =
    dot > 0 && dot > logFilePath.lastIndexOf("/")
      ? logFilePath.slice(0, dot)
      : logFilePath;

  return `${base}-sticks.mp4`;
}

/**
 * Render a decoded flight to an .mp4 stick-position video.
 *
 * @param {object}  flight          decoded flight from decodeBblFile()
 * @param {string}  outputPath      destination .mp4
 * @param {object}  [options]
 * @param {number}  [options.fps]   output frame rate (default 30)
 * @param {(msg: string) => void} [options.onProgress]
 * @returns {Promise<{frames: number, fps: number, durationSeconds: number}>}
 */
export async function renderStickVideo(flight, outputPath, options = {}) {
  const fps = options.fps ?? DEFAULT_FPS;

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`--fps must be a positive number, got ${fps}`);
  }

  const binding = detectScales(flight);

  if (!binding) {
    throw new Error(
      "This flight has no rcCommand[0..3] telemetry — cannot render gimbal sticks."
    );
  }

  const timeIndex = binding.columnIndexes.time;
  const timeColumnUs = flight.mainFrames.map((frame) => frame[timeIndex]);

  const firstTimeUs =
    flight.mainFrames.length > 0 ? timeColumnUs[0] : 0;

  // Normalize the timeline to 0 so frame i is exactly flight
  // time i / fps, regardless of when the log starts counting.
  const relativeTimeUs = timeColumnUs.map((t) => t - firstTimeUs);

  // Frame interval from the log's own sample rate (fallback:
  // one 20 ms loop), so the final hold period is rendered too.
  const lastTimeUs = relativeTimeUs[relativeTimeUs.length - 1] ?? 0;
  const typicalIntervalUs =
    relativeTimeUs.length > 1
      ? relativeTimeUs[relativeTimeUs.length - 1] - relativeTimeUs[relativeTimeUs.length - 2]
      : 20_000;

  const durationSeconds = (lastTimeUs + typicalIntervalUs) / 1_000_000;

  if (durationSeconds <= 0) {
    throw new Error("Flight duration is zero — nothing to render.");
  }

  const frameCount = Math.ceil(durationSeconds * fps);
  const outputDirectory = dirname(outputPath);

  if (outputDirectory && outputDirectory !== ".") {
    mkdirSync(outputDirectory, { recursive: true });
  }

  const writer = new VideoWriter(outputPath, fps, WIDTH, HEIGHT);

  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const tSeconds = frameIndex / fps;
      const row = timeToRowIndex(relativeTimeUs, tSeconds);
      const mainFrame = flight.mainFrames[row];
      const positions = mapStickPositions(mainFrame, binding);
      const state = readToggleState(mainFrame, binding);

      await writer.writeFrame(paintStickFrame(positions, state));

      if (options.onProgress && frameIndex % 500 === 0 && frameIndex > 0) {
        options.onProgress(
          `rendered ${frameIndex}/${frameCount} frames...`
        );
      }
    }

    await writer.finish();
  } catch (error) {
    await writer.abort();
    throw error;
  }

  options.onProgress?.(`rendered ${frameCount}/${frameCount} frames...`);

  return {
    frames: frameCount,
    fps,
    durationSeconds
  };
}

export { checkFfmpegAvailable };