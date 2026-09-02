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
// the chosen alpha codec (src/render/outputFormats.js —
// ProRes 4444 12/10-bit, PNG, VP9), then flatten a
// browser-playable .preview.mp4 (checkerboard composite)
// in a single ffmpeg post-pass; opaque renders are H.264
// .mp4 filled with the theme background.
//
// ======================================================

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  VideoWriter,
  checkFfmpegAvailable,
  flattenAlphaPreview
} from "./videoWriter.js";
import { outputFormatOrThrow, DEFAULT_OUTPUT_FORMAT as DEFAULT_ALPHA_FORMAT } from "./outputFormats.js";
import { createFlightSampler } from "./frameSampler.js";
import { createFieldStats } from "./layout/fieldStats.js";
import { buildSceneState } from "./layout/sceneState.js";
import { paintScene } from "./layout/scenePainter.js";
import { resolveTheme, mergeThemeOverrides } from "./themes.js";

export const DEFAULT_FPS = 30;

/**
 * Default output path next to the log: alpha renders land
 * as <logBase>-overlay.<ext> (per the chosen format),
 * otherwise <logBase>-overlay.mp4.
 */
export function defaultVideoPath(logFilePath, alpha = false, formatId = null) {
  const dot = logFilePath.lastIndexOf(".");

  const base =
    dot > 0 && dot > logFilePath.lastIndexOf("/")
      ? logFilePath.slice(0, dot)
      : logFilePath;

  let extension = "mp4";

  if (alpha) {
    const format = outputFormatOrThrow(formatId ?? DEFAULT_ALPHA_FORMAT);
    extension = format.extension.slice(1);
  }

  return `${base}-overlay.${extension}`;
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
 * Render a decoded flight through a layout to video.
 *
 * @param {object}  flight          decoded flight from decodeBblFile()
 * @param {string}  outputPath      destination .mp4, .mov or .webm
 * @param {object}  [options]
 * @param {object}  [options.layout]    normalized layout doc
 *                  (canvas/grid/alpha/shadow/theme/items);
 *                  a missing layout renders an empty canvas
 * @param {number}  [options.fps]   output frame rate (default 30)
 * @param {string}  [options.format] alpha codec id from
 *                  outputFormats.js (default png-rgba)
 * @param {boolean} [options.preview] alpha renders also transcode
 *                  a browser-playable .preview.mp4 (default true)
 * @param {(msg: string) => void} [options.onProgress]
 * @returns {Promise<{frames: number, fps: number, durationSeconds: number}>}
 */
export async function renderLayoutVideo(flight, outputPath, options = {}) {
  const layout = options.layout;
  const fps = options.fps ?? DEFAULT_FPS;
  const alpha = layout.alpha === true;
  const wantPreview = options.preview !== false;
  const format = alpha ? outputFormatOrThrow(options.format ?? DEFAULT_ALPHA_FORMAT) : null;

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`fps must be a positive number, got ${fps}`);
  }

  // Alpha codecs do not live in an .mp4 container; guard
  // the combination early with a clear error instead of
  // letting ffmpeg fail cryptically at mux time.
  if (alpha && outputPath.toLowerCase().endsWith(".mp4")) {
    throw new Error(
      `Alpha renders need a ${format.extension} output path (${format.label}), not .mp4.`
    );
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

  const writer = new VideoWriter(outputPath, fps, width, height, {
    alpha,
    format: format?.id
  });

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

  if (alpha && wantPreview) {
    // The browser-playable flattened preview is transcoded
    // from the finished output in one ffmpeg pass — the
    // render loop pipes each frame exactly once. A failure
    // here errors the job; the alpha file itself is already
    // complete.
    options.onProgress?.("encoding preview...");

    await flattenAlphaPreview(
      outputPath,
      previewPathFor(outputPath),
      fps,
      width,
      height
    );
  }

  options.onProgress?.(`rendered ${frameCount}/${frameCount} frames...`);

  return {
    frames: frameCount,
    fps,
    durationSeconds,
    ...(alpha && wantPreview
      ? { previewPath: previewPathFor(outputPath) }
      : {})
  };
}

export { checkFfmpegAvailable };