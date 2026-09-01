// ======================================================
// RotorFlight-Blackbox-Video-Overlay — VIDEO RENDER ORCHESTRATION (v2)
// ======================================================
//
// Renders a decoded flight through the layout pipeline:
// samples the flight in real time (frame i = flight time
// i / fps), builds the scene state, paints each moment via
// scenePainter at the LAYOUT's canvas resolution, and pipes
// everything into ffmpeg.
//
// Alpha renders (layout.alpha === true, the default) write
// ProRes 4444 .mov plus a browser-playable flattened
// .preview.mp4 (checkerboard composite); opaque renders are
// H.264 .mp4 filled with the theme background.
//
// ======================================================

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { VideoWriter, checkFfmpegAvailable } from "./videoWriter.js";
import { createFlightSampler } from "./frameSampler.js";
import { createFieldStats } from "./layout/fieldStats.js";
import { buildSceneState } from "./layout/sceneState.js";
import { paintScene } from "./layout/scenePainter.js";
import { resolveTheme, mergeThemeOverrides } from "./themes.js";

export const DEFAULT_FPS = 30;

// Checkerboard cell used to flatten alpha preview frames —
// mirrors the GUI's transparency affordance so the browser
// dialog shows exactly what an editor would key.
const PREVIEW_CHECKER_SIZE = 20;
const PREVIEW_CHECKER_A = [201, 205, 210]; // #C9CDD2
const PREVIEW_CHECKER_B = [236, 239, 242]; // #ECEFF2

/**
 * Default output path next to the log: alpha renders land
 * as <logBase>-overlay.mov (ProRes 4444), otherwise
 * <logBase>-overlay.mp4.
 */
export function defaultVideoPath(logFilePath, alpha = false) {
  const dot = logFilePath.lastIndexOf(".");

  const base =
    dot > 0 && dot > logFilePath.lastIndexOf("/")
      ? logFilePath.slice(0, dot)
      : logFilePath;

  return `${base}-overlay.${alpha ? "mov" : "mp4"}`;
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

function buildCheckerboard(width, height) {
  const checker = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const oddSquare =
        (Math.floor(x / PREVIEW_CHECKER_SIZE) +
          Math.floor(y / PREVIEW_CHECKER_SIZE)) %
          2 ===
        1;

      const color = oddSquare ? PREVIEW_CHECKER_A : PREVIEW_CHECKER_B;
      const offset = (y * width + x) * 4;

      checker[offset] = color[0];
      checker[offset + 1] = color[1];
      checker[offset + 2] = color[2];
      checker[offset + 3] = 255;
    }
  }

  return checker;
}

/**
 * Render a decoded flight through a layout to video.
 *
 * @param {object}  flight          decoded flight from decodeBblFile()
 * @param {string}  outputPath      destination .mp4 or .mov
 * @param {object}  [options]
 * @param {object}  [options.layout]    normalized layout doc
 *                  (canvas/grid/alpha/shadow/theme/items);
 *                  a missing layout renders an empty canvas
 * @param {number}  [options.fps]   output frame rate (default 30)
 * @param {(msg: string) => void} [options.onProgress]
 * @returns {Promise<{frames: number, fps: number, durationSeconds: number}>}
 */
export async function renderLayoutVideo(flight, outputPath, options = {}) {
  const layout = options.layout;
  const fps = options.fps ?? DEFAULT_FPS;
  const alpha = layout.alpha === true;

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`fps must be a positive number, got ${fps}`);
  }

  // ProRes 4444 does not live in an .mp4 container; guard
  // the combination early with a clear error instead of
  // letting ffmpeg fail cryptically at mux time.
  if (alpha && outputPath.toLowerCase().endsWith(".mp4")) {
    throw new Error("Alpha renders need a .mov output path (ProRes 4444), not .mp4.");
  }

  // The sticks need rcCommand telemetry; a layout without
  // stick items can render flights the v1 pipeline rejected.
  const sampler = createFlightSampler(flight);
  const needsSticks = layout.items.some((item) => item.type === "stick");

  if (!sampler && needsSticks) {
    throw new Error(
      "This flight has no rcCommand[0..3] telemetry — cannot render stick displays."
    );
  }

  const stats = createFieldStats(flight);
  const theme = mergeThemeOverrides(
    resolveTheme(layout.theme),
    layout.themeOverrides
  );

  const width = layout.canvas.width;
  const height = layout.canvas.height;

  // Bounding boxes: scenePainter needs the same measure the
  // editor sees; normalizeLayout is the single authority —
  // the incoming layout is already normalized, so reuse a
  // cheap re-measure via the schema's export.
  const { normalizeLayout } = await import("./layout/layoutSchema.js");
  const boxes = normalizeLayout(layout).boxes;

  const durationSeconds = sampler
    ? sampler.durationSeconds
    : (flight.durationSeconds ?? 0);

  if (!(durationSeconds > 0)) {
    throw new Error("Flight duration is zero — nothing to render.");
  }

  const frameCount = Math.ceil(durationSeconds * fps);
  const outputDirectory = dirname(outputPath);

  if (outputDirectory && outputDirectory !== ".") {
    mkdirSync(outputDirectory, { recursive: true });
  }

  const writer = new VideoWriter(outputPath, fps, width, height, { alpha });

  const previewWriter = alpha
    ? new VideoWriter(previewPathFor(outputPath), fps, width, height, {
        alpha: false
      })
    : null;
  const checker = previewWriter ? buildCheckerboard(width, height) : null;
  // Reused for every preview frame so alpha renders don't
  // allocate a fresh RGBA copy per frame.
  const previewScratch = previewWriter
    ? new Uint8Array(width * height * 4)
    : null;

  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const tSeconds = frameIndex / fps;
      const sceneState = sampler
        ? buildSceneState({ flight, sampler, t: tSeconds, stats })
        : buildSceneState({ t: tSeconds });

      const frame = paintScene(layout, boxes, sceneState, theme, {
        alpha,
        shadow: layout.shadow === true
      });

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