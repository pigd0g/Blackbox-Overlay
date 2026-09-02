// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GUI API HANDLERS (v2)
// ======================================================
//
// The logic behind the local GUI server: log decoding with
// a small cache, filesystem browsing, LAYOUT-DRIVEN preview
// frames (with a downscaled interactive mode), layout
// normalization, and the render job queue.
//
// Transport-agnostic: handlers take plain values and return
// plain results; serve.js wires them to http.
//
// Preview contract (the downscale decisions):
//   • the editor always receives real scenePainter frames —
//     full-res render, box-filtered down
//   • the interactive preview caps at PREVIEW_MAX_W = 960px
//     wide (≤960px canvases preview 1:1)
//   • responses carry X-Frame-Width/Height (the PIXEL size
//     of the payload) and X-Layout-Width/Height (the layout
//     resolution) so the browser can scale the canvas and
//     map pointer coordinates correctly
//
// ======================================================

import {
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { decodeBblFile, looksLikeBinaryBbl } from "../bbl/bblDecoder.js";
import { summarizeFlight } from "../summarize.js";
import { createFlightSampler } from "../render/frameSampler.js";
import { createFieldStats } from "../render/layout/fieldStats.js";
import { normalizeLayout, firstFreeCell } from "../render/layout/layoutSchema.js";
import { buildSceneState } from "../render/layout/sceneState.js";
import { paintScene } from "../render/layout/scenePainter.js";
import { resolveOutputFormat } from "../render/outputFormats.js";
import {
  THEME_NAMES,
  themeColorMap,
  resolveTheme,
  mergeThemeOverrides
} from "../render/themes.js";
import { fontCatalog, resolveFont } from "../render/fonts.js";
import {
  renderLayoutVideo,
  checkFfmpegAvailable
} from "../render/videoRender.js";
import { OUTPUT_FORMATS, DEFAULT_OUTPUT_FORMAT } from "../render/outputFormats.js";

// ------------------------------------------------------
// Constants
// ------------------------------------------------------

const LOG_CACHE_LIMIT = 2;

export const PREVIEW_MAX_W = 960;

/** Frame rates: decimal to 2 places (59.94), clamped to 1–120. */
export const FPS_MIN = 1;
export const FPS_MAX = 120;
export const FPS_DEFAULT = 30;

export function normalizeFps(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return FPS_DEFAULT;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return FPS_DEFAULT;
  }

  const clamped = Math.min(Math.max(parsed, FPS_MIN), FPS_MAX);

  return Math.round(clamped * 100) / 100;
}

export function tempDir() {
  return tmpdir();
}

// ------------------------------------------------------
// Layout library (presets + user layouts)
// ------------------------------------------------------

// Bundled presets live with the source (src/presets); user
// layouts land in <cwd>/layouts/ (gitignored, like out/).
const PRESETS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "presets"
);

export const LAYOUTS_DIRNAME = "layouts";

export const THUMB_MAX_W = 160;

/** <cwd>/layouts/ — created only when saving. */
function userLayoutsDir() {
  return join(process.cwd(), LAYOUTS_DIRNAME);
}

function layoutsDir() {
  const dir = userLayoutsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Humanize a filename stem: "my-cool_layout" → "My Cool Layout". */
export function layoutDisplayName(stem) {
  return String(stem)
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Sanitize a user-supplied name into a safe filename stem.
 * Returns null when the name is empty or path-hostile. */
export function sanitizeLayoutName(name) {
  const trimmed = String(name ?? "").trim();

  if (!trimmed || /^\.+$/.test(trimmed)) {
    return null;
  }

  if (/[/\\:*?"<>|]/.test(trimmed) || /\.\./.test(trimmed)) {
    return null;
  }

  const stem = trimmed.replace(/\s+/g, " ").slice(0, 80).trim();

  return stem.length > 0 ? stem : null;
}

function layoutFilePath(id, dir) {
  const stem = sanitizeLayoutName(id);

  if (!stem) {
    return null;
  }

  const target = resolve(dir, `${stem}.gimbal.json`);

  if (target !== dir && !target.startsWith(dir + sep)) {
    return null;
  }

  return target;
}

function readLayoutFile(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));

  return normalizeLayout(parsed).layout;
}

/** Built-in presets: discovered from src/presets/*.json. */
export function listPresetLayouts() {
  const presets = [];

  let entries = [];

  try {
    entries = readdirSync(PRESETS_DIR);
  } catch {
    return presets;
  }

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".json")) {
      continue;
    }

    const id = entry.replace(/\.json$/i, "");
    const idSafe = layoutFilePath(id, PRESETS_DIR) ? id : null;

    if (idSafe) {
      presets.push({ id: idSafe, name: layoutDisplayName(idSafe) });
    }
  }

  presets.sort((a, b) => a.name.localeCompare(b.name));

  return presets;
}

/** User layouts: <cwd>/layouts/*.gimbal.json (listed without creating). */
export function listUserLayouts() {
  const dir = userLayoutsDir();
  const user = [];

  let entries = [];

  try {
    entries = readdirSync(dir);
  } catch {
    return user;
  }

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".gimbal.json")) {
      continue;
    }

    const id = entry.slice(0, -".gimbal.json".length);
    const filePath = layoutFilePath(id, dir);

    if (!filePath || resolve(filePath) !== resolve(dir, entry)) {
      continue;
    }

    let mtime = 0;

    try {
      mtime = statSync(filePath).mtimeMs;
    } catch {
      // Unreadable: still list it, no timestamp.
    }

    user.push({
      id,
      name: layoutDisplayName(id),
      mtime
    });
  }

  user.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  return user;
}

export function listLayouts() {
  return { presets: listPresetLayouts(), user: listUserLayouts() };
}

/** Load a layout doc by id (user layouts first, then presets). */
export function loadLayoutDoc(id) {
  const userPath = layoutFilePath(id, userLayoutsDir());

  if (userPath && existsSync(userPath)) {
    return readLayoutFile(userPath);
  }

  const presetStem = sanitizeLayoutName(id);
  const presetPath =
    presetStem &&
    resolve(PRESETS_DIR, `${presetStem}.json`);

  if (
    presetPath &&
    presetPath.startsWith(resolve(PRESETS_DIR) + sep) &&
    existsSync(presetPath)
  ) {
    return readLayoutFile(presetPath);
  }

  throw new Error(`No such layout: ${id}`);
}

/**
 * Save a user layout. The doc is normalized first (the
 * layout schema stays the single validation authority).
 * Returns { id, name, layout }.
 */
export function saveUserLayout(name, rawDoc) {
  const stem = sanitizeLayoutName(name);

  if (!stem) {
    const error = new Error("Layout name is required.");
    error.code = "badname";
    throw error;
  }

  const { layout } = normalizeLayout(rawDoc);

  const dir = layoutsDir();
  const target = layoutFilePath(stem, dir);

  if (!target) {
    const error = new Error("Invalid layout name.");
    error.code = "badname";
    throw error;
  }

  writeFileSync(target, JSON.stringify(layout, null, 2));

  return {
    id: stem,
    name: layoutDisplayName(stem),
    layout
  };
}

export function deleteUserLayout(id) {
  const dir = userLayoutsDir();
  const filePath = layoutFilePath(id, dir);

  if (!filePath || !existsSync(filePath)) {
    throw new Error(`No such layout: ${id}`);
  }

  unlinkSync(filePath);

  return { deleted: id };
}

// ------------------------------------------------------
// Log cache
// ------------------------------------------------------

/** Most recently used decoded logs, keyed by path::mtime. */
const logCache = new Map();

function cacheKey(filePath) {
  try {
    return `${resolve(filePath)}::${statSync(filePath).mtimeMs}`;
  } catch {
    return null;
  }
}

/** Test hook: drop cached decodes. */
export function clearLogCache() {
  logCache.clear();
}

/**
 * Decode a .bbl file (or reuse a cached decode). Returns
 * { flightCount, usable, flights }.
 */
function loadLog(filePath) {
  const key = cacheKey(filePath);

  if (key && logCache.has(key)) {
    const hit = logCache.get(key);
    // Refresh recency.
    logCache.delete(key);
    logCache.set(key, hit);
    return hit;
  }

  const size = statSync(filePath).size;
  const buffer = readFileSync(filePath);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, size);

  if (!looksLikeBinaryBbl(bytes)) {
    throw new Error("Not a binary blackbox log (.bbl).");
  }

  const { flightCount, flights } = decodeBblFile(bytes);
  const usable = flights.filter((flight) => flight.mainFrames.length > 0);
  const record = { flightCount, usable, flights: usable.length };

  if (key) {
    logCache.set(key, record);

    while (logCache.size > LOG_CACHE_LIMIT) {
      logCache.delete(logCache.keys().next().value);
    }
  }

  return record;
}

function findFlight(log, flightNumber) {
  return (
    log.usable.find((flight) => flight.index + 1 === Number(flightNumber)) ??
    null
  );
}

// ------------------------------------------------------
// Filesystem browsing (unchanged from v1)
// ------------------------------------------------------

function listDrivesWindows() {
  const drives = [];

  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = `${letter}:\\`;

    if (existsSync(root)) {
      drives.push({ name: root, path: root });
    }
  }

  return drives;
}

export function browseDirectory(rawDir) {
  let dir =
    rawDir && String(rawDir).trim() ? resolve(String(rawDir)) : homedir();

  if (!existsSync(dir)) {
    dir = homedir();
  }

  if (!statSync(dir).isDirectory()) {
    dir = dirname(dir);
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  const directories = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith("$") || entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      directories.push({ name: entry.name, path: fullPath });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".bbl")) {
      let size = 0;

      try {
        size = statSync(fullPath).size;
      } catch {
        // Unreadable entry: still list it, size unknown.
      }

      files.push({ name: entry.name, path: fullPath, size });
    }
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base"
  });
  directories.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => collator.compare(a.name, b.name));

  const parent = dirname(dir);
  const drives = process.platform === "win32" ? listDrivesWindows() : [];

  return {
    path: dir,
    parent: parent === dir ? null : parent,
    drives: drives.length > 0 ? drives : null,
    directories,
    files
  };
}

// ------------------------------------------------------
// Log summaries + field catalog
// ------------------------------------------------------

/**
 * Flights + metadata for the GUI's source panel, plus the
 * field list the TELEMETRY panel renders. `renderable`
 * means sticks can animate (rcCommand present).
 */
export function describeLog(filePath) {
  const log = loadLog(filePath);
  const flights = log.usable.map((flight) => {
    const summary = summarizeFlight(flight);

    summary.renderable = detectScalesSafe(flight);

    return summary;
  });

  return { file: resolve(filePath), flightCount: log.flightCount, flights };
}

function detectScalesSafe(flight) {
  // Re-use detectScales' rcCommand requirement via the
  // sampler builder without building the whole sampler.
  const names = flight.mainFieldNames ?? [];
  const required = ["rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time"];

  return required.every((name) => names.includes(name));
}

// ------------------------------------------------------
// Layout endpoints
// ------------------------------------------------------

/**
 * Normalize a layout doc: the single validation authority.
 * Returns { layout, boxes (plain object), warnings }.
 */
export function normalizeLayoutDoc(rawDoc) {
  const { layout, boxes, warnings } = normalizeLayout(rawDoc);

  return {
    layout,
    boxes: Object.fromEntries(boxes.entries()),
    warnings
  };
}

/** Catalog for the GUI boot: themes, theme slots, fonts, defaults. */
export function stateCatalog() {
  const themeMaps = {};

  for (const name of THEME_NAMES) {
    themeMaps[name] = themeColorMap(resolveTheme(name));
  }

  return {
    themes: { names: [...THEME_NAMES], maps: themeMaps },
    fonts: fontCatalog(),
    outputFormats: OUTPUT_FORMATS.map(({ id, label, extension, alpha }) => ({
      id,
      label,
      extension,
      alpha: alpha === true
    })),
    defaultLayout: normalizeLayoutDoc(null).layout
  };
}

// ------------------------------------------------------
// Preview
// ------------------------------------------------------

/**
 * One painted frame for direct canvas putImageData. Paints
 * at full layout resolution, then box-downsamples to the
 * preview cap (≤960px wide stays 1:1). `maxWidth` lowers
 * the cap for card thumbnails (clamped 64–PREVIEW_MAX_W).
 * Works with no flight — placeholder state.
 *
 * Returns { width, height, layoutWidth, layoutHeight, pixels }.
 */
export function renderPreviewFrame({ layout: rawLayout, file, filePath, flight, t, maxWidth }) {
  const normalized = normalizeLayout(rawLayout);
  const layout = normalized.layout;
  const boxes = normalized.boxes;

  const theme = overrideTheme(layout);

  let sceneState;

  if (file ?? filePath) {
    const log = loadLog(file ?? filePath);
    const flightObj = findFlight(log, flight);

    if (!flightObj) {
      throw new Error(`Flight ${flight} not found in this log.`);
    }

    sceneState = buildStateForFlight(flightObj, layout, t);
  } else {
    sceneState = buildStateForFlight(null, layout, t);
  }

  const frame = paintScene(layout, boxes, sceneState, theme, {
    alpha: layout.alpha === true,
    shadow: layout.shadow === true
  });

  const cap = Math.min(
    PREVIEW_MAX_W,
    Math.max(64, Math.round(Number(maxWidth) || PREVIEW_MAX_W))
  );

  const scaled = downscaleFrame(
    frame,
    layout.canvas.width,
    layout.canvas.height,
    cap
  );

  return {
    width: scaled.width,
    height: scaled.height,
    layoutWidth: layout.canvas.width,
    layoutHeight: layout.canvas.height,
    pixels: scaled.pixels
  };
}

/** Scene state for one flight (or placeholder) at time t. */
function buildStateForFlight(flightObj, layout, t) {
  if (!flightObj) {
    return buildSceneState({ t });
  }

  const sampler = hasRc(flightObj) ? createFlightSampler(flightObj) : null;

  if (!sampler && layout.items.some((item) => item.type === "stick")) {
    throw new Error("This flight has no rcCommand[0..3] telemetry.");
  }

  const stats = createFieldStats(flightObj);

  return buildSceneState({
    flight: flightObj,
    sampler,
    t,
    stats
  });
}

function hasRc(flightObj) {
  const names = flightObj?.mainFieldNames ?? [];

  return ["rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time"].every(
    (name) => names.includes(name)
  );
}

function overrideTheme(layout) {
  return mergeThemeOverrides(
    resolveTheme(layout.theme),
    layout.themeOverrides
  );
}

/** Box-filter downsample to ≤cap px wide (or 1:1 when already
 * small). Returns { width, height, pixels }. */
function downscaleFrame(frame, srcW, srcH, cap = PREVIEW_MAX_W) {
  if (srcW <= cap) {
    return { width: srcW, height: srcH, pixels: frame };
  }

  // Proportional height, even.
  const scale = cap / srcW;
  const dstW = evenFloor(Math.round(srcW * scale));
  const dstH = evenFloor(Math.round(srcH * scale));

  return {
    width: dstW,
    height: dstH,
    pixels: boxDownsampleFrame(frame, srcW, srcH, dstW, dstH)
  };
}

function evenFloor(v) {
  const f = Math.floor(v);

  return f - (f % 2);
}

function boxDownsampleFrame(frame, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy += 1) {
    const y0 = Math.floor(dy * scaleY);
    const y1 = Math.min(srcH, Math.max(y0 + 1, Math.floor((dy + 1) * scaleY)));

    for (let dx = 0; dx < dstW; dx += 1) {
      const x0 = Math.floor(dx * scaleX);
      const x1 = Math.min(srcW, Math.max(x0 + 1, Math.floor((dx + 1) * scaleX)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;

      for (let y = y0; y < y1; y += 1) {
        const rowBase = y * srcW * 4;

        for (let x = x0; x < x1; x += 1) {
          const o = rowBase + x * 4;

          r += frame[o];
          g += frame[o + 1];
          b += frame[o + 2];
          a += frame[o + 3];
          n += 1;
        }
      }

      const offset = (dy * dstW + dx) * 4;

      out[offset] = Math.round(r / n);
      out[offset + 1] = Math.round(g / n);
      out[offset + 2] = Math.round(b / n);
      out[offset + 3] = Math.round(a / n);
    }
  }

  return out;
}

// ------------------------------------------------------
// Render jobs
// ------------------------------------------------------

let jobSeq = 0;
let activeJob = null;
let lastFinishedJob = null;

const completedOutputs = new Set();

export function isCompletedOutput(path) {
  return completedOutputs.has(resolve(String(path)));
}

function jobSnapshot(job) {
  const snapshot = {
    id: job.id,
    state: job.state,
    file: job.file,
    flight: job.flight,
    fps: job.fps,
    format: job.format,
    layout: job.layout,
    output: job.output,
    previewPath: job.previewPath,
    frames: job.frames,
    totalFrames: job.totalFrames,
    message: job.message
  };

  if (job.error) {
    snapshot.error = job.error;
  }

  if (job.durationSeconds !== undefined) {
    snapshot.durationSeconds = job.durationSeconds;
  }

  return snapshot;
}

function broadcast(job, event) {
  for (const listener of job.listeners) {
    try {
      listener(event);
    } catch {
      // A dead SSE connection must never break the render.
    }
  }
}

/**
 * Start a render job (one at a time). Returns
 * { jobId, job: snapshot }; throws with `.code = "busy"`
 * when a render is already in progress.
 *
 * `preview: false` skips the browser-playable flattened
 * .preview.mp4 for alpha renders (only the .mov is written).
 */
export function startRenderJob({
  file,
  filePath,
  flight,
  fps,
  layout: rawLayout,
  output,
  preview,
  format
}) {
  if (activeJob && !activeJob.settled) {
    const error = new Error("A render is already in progress.");
    error.code = "busy";
    throw error;
  }

  const sourceFile = file ?? filePath;
  const log = loadLog(sourceFile);
  const flightObj = findFlight(log, flight);

  if (!flightObj) {
    throw new Error(`Flight ${flight} not found in this log.`);
  }

  const { layout, warnings } = normalizeLayout(rawLayout);

  if (warnings.length > 0) {
    // Layout issues ride the job snapshot for the GUI toast;
    // rendering continues with the normalized doc.
  }

  jobSeq += 1;
  const job = {
    id: `job-${Date.now().toString(36)}-${jobSeq}`,
    state: "running",
    file: resolve(String(sourceFile)),
    flight: Number(flight),
    fps: normalizeFps(fps),
    // Codec id (outputFormats.js) — alpha codecs for
    // transparent renders, h264-yuv420p for opaque ones.
    format: format ?? DEFAULT_OUTPUT_FORMAT,
    layout,
    warnings,
    output: resolve(String(output)),
    previewPath: null,
    preview: preview !== false,
    frames: 0,
    totalFrames: null,
    message: "starting ffmpeg…",
    settled: false,
    listeners: new Set()
  };

  activeJob = job;

  renderLayoutVideo(flightObj, job.output, {
    layout,
    fps: job.fps,
    format: job.format,
    preview: job.preview,
    onProgress: (message) => {
      job.message = message;

      const match = message.match(/rendered (\d+)\/(\d+)/);

      if (match) {
        job.frames = Number(match[1]);
        job.totalFrames = Number(match[2]);
      }

      broadcast(job, { type: "progress", job: jobSnapshot(job) });
    }
  })
    .then((result) => {
      job.state = "done";
      job.settled = true;
      job.frames = result.frames;
      job.totalFrames = result.frames;
      job.durationSeconds = result.durationSeconds;
      job.message = `done: ${result.frames} frames`;

      if (result.previewPath) {
        job.previewPath = resolve(result.previewPath);
        completedOutputs.add(job.previewPath);
      }

      completedOutputs.add(resolve(job.output));
      lastFinishedJob = job;
      broadcast(job, { type: "done", job: jobSnapshot(job) });
    })
    .catch((error) => {
      job.state = "error";
      job.settled = true;
      job.error = error.message;
      job.message = `failed: ${error.message}`;
      lastFinishedJob = job;
      broadcast(job, { type: "error", job: jobSnapshot(job) });
    })
    .finally(() => {
      if (activeJob === job) {
        activeJob = null;
      }
    });

  return { jobId: job.id, job: jobSnapshot(job) };
}

export function jobStatus(id) {
  if (activeJob && activeJob.id === id) {
    return jobSnapshot(activeJob);
  }

  return lastFinishedJob && lastFinishedJob.id === id
    ? jobSnapshot(lastFinishedJob)
    : null;
}

export function currentJob() {
  return activeJob ? jobSnapshot(activeJob) : null;
}

/**
 * Subscribe to live job events. Returns an unsubscribe
 * function, or null when the id is unknown.
 */
export function subscribeJob(id, listener) {
  const job =
    activeJob && activeJob.id === id
      ? activeJob
      : lastFinishedJob && lastFinishedJob.id === id
        ? lastFinishedJob
        : null;

  if (!job) {
    return null;
  }

  listener({ type: "progress", job: jobSnapshot(job) });
  job.listeners.add(listener);

  return () => {
    job.listeners.delete(listener);
  };
}

// ------------------------------------------------------
// Misc capabilities
// ------------------------------------------------------

export async function ffmpegAvailable() {
  return checkFfmpegAvailable();
}

/**
 * Default GUI render destination: <cwd>/out/<logbase>-flight<N>-overlay.<ext>
 * (.mov/.webm per the chosen format; .mp4 when the format is
 * opaque or unspecified).
 */
export function suggestOutputPath(filePath, flight, alpha = false, format = null) {
  const leaf =
    String(filePath).replace(/\.[^.]+$/, "").split(/[\\/]/).pop() || "log";

  const extension = resolveOutputFormat(format).extension;

  return join(
    process.cwd(),
    "out",
    `${leaf}-flight${Number(flight) || 1}-overlay${extension}`
  );
}

export function isPathInside(path, dir) {
  const resolvedPath = resolve(String(path));
  const root = resolve(String(dir));

  return resolvedPath === root || resolvedPath.startsWith(root + sep);
}

/**
 * Every GUI render lands in <cwd>/out/ — whatever the
 * client sends, only the file name survives. The extension
 * follows the chosen format; unknown/null ids fall back to
 * the default (PNG lossless .mov).
 */
export function resolveOutputPath(output, filePath, flight, alpha = false, format = null) {
  const requested = String(output ?? "").trim();

  const stem =
    requested
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || null;

  const extension = resolveOutputFormat(format).extension;

  return stem
    ? join(process.cwd(), "out", `${stem}${extension}`)
    : suggestOutputPath(filePath, flight, alpha, format);
}