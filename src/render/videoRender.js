// ======================================================
// RotorFlight-Blackbox-Video-Overlay — VIDEO RENDER ORCHESTRATION
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
import { createFlightSampler } from "./frameSampler.js";
import { resolveTheme } from "./themes.js";

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
 * @param {string}  [options.theme] color theme name (themes.js)
 * @param {(msg: string) => void} [options.onProgress]
 * @returns {Promise<{frames: number, fps: number, durationSeconds: number}>}
 */
export async function renderStickVideo(flight, outputPath, options = {}) {
  const fps = options.fps ?? DEFAULT_FPS;
  const theme = resolveTheme(options.theme);

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`--fps must be a positive number, got ${fps}`);
  }

  const sampler = createFlightSampler(flight);

  if (!sampler) {
    throw new Error(
      "This flight has no rcCommand[0..3] telemetry — cannot render gimbal sticks."
    );
  }

  const durationSeconds = sampler.durationSeconds;

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
      const sampled = sampler.frameAt(tSeconds);
      const state = {
        throttle: sampled.toggles.throttle,
        perCell: sampled.telemetry.perCell,
        cellCount: sampled.telemetry.cellCount,
        rpm: sampled.telemetry.rpm
      };

      await writer.writeFrame(paintStickFrame(sampled.positions, state, theme));

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