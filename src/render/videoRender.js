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
import { resolveTheme, applyThemeOverrides } from "./themes.js";

export const DEFAULT_FPS = 30;

// Checkerboard cell used to flatten alpha preview frames —
// mirrors the GUI's transparency affordance so the browser
// dialog shows exactly what an editor would key.
const PREVIEW_CHECKER_SIZE = 20;
const PREVIEW_CHECKER_A = [201, 205, 210]; // #C9CDD2
const PREVIEW_CHECKER_B = [236, 239, 242]; // #ECEFF2

/**
 * Default output path next to the log: alpha renders land
 * as <logBase>-sticks.mov (ProRes 4444), otherwise
 * <logBase>-sticks.mp4.
 */
export function defaultVideoPath(logFilePath, alpha = false) {
  const dot = logFilePath.lastIndexOf(".");

  const base =
    dot > 0 && dot > logFilePath.lastIndexOf("/")
      ? logFilePath.slice(0, dot)
      : logFilePath;

  return `${base}-sticks.${alpha ? "mov" : "mp4"}`;
}

/**
 * Path of the browser-playable preview written alongside an
 * alpha (.mov) render.
 */
export function previewPathFor(outputPath) {
  const dot = outputPath.lastIndexOf(".");

  const base =
    dot > 0 ? outputPath.slice(0, dot) : outputPath;

  return `${base}.preview.mp4`;
}

/**
 * Flatten one RGBA frame over a static checkerboard:
 * alpha 0 pixels show the checker, partial alpha blends.
 * Returns the same buffer for reuse-friendly callers.
 */
function compositeOverCheckerboard(frame, checker) {
  for (let i = 0; i < frame.length; i += 4) {
    const a = frame[i + 3];

    if (a !== 255) {
      frame[i] = (frame[i] * a) / 255 + ((checker[i] * (255 - a)) / 255);
      frame[i + 1] =
        (frame[i + 1] * a) / 255 + ((checker[i + 1] * (255 - a)) / 255);
      frame[i + 2] =
        (frame[i + 2] * a) / 255 + ((checker[i + 2] * (255 - a)) / 255);
      frame[i + 3] = 255;
    }
  }

  return frame;
}

function buildCheckerboard() {
  const checker = new Uint8Array(WIDTH * HEIGHT * 4);

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const oddSquare =
        (Math.floor(x / PREVIEW_CHECKER_SIZE) +
          Math.floor(y / PREVIEW_CHECKER_SIZE)) %
          2 ===
        1;

      const color = oddSquare ? PREVIEW_CHECKER_A : PREVIEW_CHECKER_B;
      const offset = (y * WIDTH + x) * 4;

      checker[offset] = color[0];
      checker[offset + 1] = color[1];
      checker[offset + 2] = color[2];
      checker[offset + 3] = 255;
    }
  }

  return checker;
}

/**
 * Render a decoded flight to a stick-position video.
 * Opaque renders are H.264 .mp4; transparent-background
 * renders are ProRes 4444 .mov (alpha-capable).
 *
 * @param {object}  flight          decoded flight from decodeBblFile()
 * @param {string}  outputPath      destination .mp4 or .mov
 * @param {object}  [options]
 * @param {number}  [options.fps]   output frame rate (default 30)
 * @param {string}  [options.theme] color theme name (themes.js)
 * @param {object}  [options.themeOverrides] per-key hex color
 *                  overrides applied over the theme
 * @param {boolean} [options.alpha] transparent background,
 *                  ProRes 4444 output (default false); when
 *                  on, a browser-playable
 *                  <name>.preview.mp4 (frames flattened over
 *                  a checkerboard) is written next to the
 *                  .mov — browsers can't decode ProRes.
 * @param {boolean} [options.shadow] draw the theme's text
 *                  drop shadow (default OFF)
 * @param {(msg: string) => void} [options.onProgress]
 * @returns {Promise<{frames: number, fps: number, durationSeconds: number}>}
 */
export async function renderStickVideo(flight, outputPath, options = {}) {
  const fps = options.fps ?? DEFAULT_FPS;
  const alpha = options.alpha === true;
  const theme = applyThemeOverrides(
    resolveTheme(options.theme),
    options.themeOverrides
  );

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

  const writer = new VideoWriter(outputPath, fps, WIDTH, HEIGHT, { alpha });

  const previewWriter = alpha
    ? new VideoWriter(previewPathFor(outputPath), fps, WIDTH, HEIGHT, {
        alpha: false
      })
    : null;
  const checker = previewWriter ? buildCheckerboard() : null;
  // Reused for every preview frame so alpha renders don't
  // allocate a fresh RGBA copy per frame.
  const previewScratch = previewWriter
    ? new Uint8Array(WIDTH * HEIGHT * 4)
    : null;

  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const tSeconds = frameIndex / fps;
      const sampled = sampler.frameAt(tSeconds);

      const frame = paintStickFrame(
        sampled.positions,
        {
          armed: sampled.toggles.armed,
          motorOn: sampled.toggles.motorOn,
          ...sampled.telemetry
        },
        theme,
        { alpha, shadow: options.shadow === true }
      );

      await writer.writeFrame(frame);

      if (previewWriter) {
        previewScratch.set(frame);
        await previewWriter.writeFrame(
          compositeOverCheckerboard(previewScratch, checker)
        );
      }

      if (options.onProgress && frameIndex % 500 === 0 && frameIndex > 0) {
        options.onProgress(
          `rendered ${frameIndex}/${frameCount} frames...`
        );
      }
    }

    await writer.finish();

    if (previewWriter) {
      await previewWriter.finish();
    }
  } catch (error) {
    await writer.abort();
    await previewWriter?.abort();
    throw error;
  }

  options.onProgress?.(`rendered ${frameCount}/${frameCount} frames...`);

  return {
    frames: frameCount,
    fps,
    durationSeconds,
    ...(previewWriter ? { previewPath: previewPathFor(outputPath) } : {})
  };
}

export { checkFfmpegAvailable };