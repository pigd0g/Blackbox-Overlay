// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GUI API HANDLERS
// ======================================================
//
// The full logic behind the local GUI server: log decoding
// with a small cache, filesystem browsing, single preview
// frames, scrubber traces, and the render job queue.
// Transport-agnostic: handlers take plain values and return
// plain results; serve.js wires them to http.
//
// ======================================================

import {
  readdirSync,
  statSync,
  existsSync,
  readFileSync
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";

import { decodeBblFile, looksLikeBinaryBbl } from "../bbl/bblDecoder.js";
import { summarizeFlight } from "../summarize.js";
import { createFlightSampler } from "../render/frameSampler.js";
import { THEMES, THEME_NAMES, THEME_HEX, resolveTheme } from "../render/themes.js";
import {
  WIDTH as FRAME_WIDTH,
  HEIGHT as FRAME_HEIGHT,
  paintStickFrame
} from "../render/gimbalFrame.js";
import {
  renderStickVideo,
  checkFfmpegAvailable
} from "../render/videoRender.js";

const LOG_CACHE_LIMIT = 2;

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
 * { flightCount, usable, flights } where `flights` holds
 * every decoded flight and `usable` only those with frames.
 */
export function loadLog(filePath) {
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
  const value = { flightCount, usable, flights };

  if (key) {
    logCache.set(key, value);

    while (logCache.size > LOG_CACHE_LIMIT) {
      logCache.delete(logCache.keys().next().value);
    }
  }

  return value;
}

function findFlight(log, flightNumber) {
  return (
    log.usable.find((flight) => flight.index + 1 === Number(flightNumber)) ??
    null
  );
}

// ------------------------------------------------------
// Filesystem browsing
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

/**
 * Directory listing for the file browser: subdirectories
 * plus .bbl files (with sizes). Windows gets drive roots
 * so the browser can jump between volumes.
 */
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
    // A root's parent is itself; the UI hides "up" there.
    parent: parent === dir ? null : parent,
    drives: drives.length > 0 ? drives : null,
    directories,
    files
  };
}

// ------------------------------------------------------
// Log summaries
// ------------------------------------------------------

/**
 * Flights + metadata for the GUI's source panel: the CLI
 * summary plus renderability and the sampler-based video
 * duration per flight.
 */
export function describeLog(filePath) {
  const log = loadLog(filePath);
  const flights = log.usable.map((flight) => {
    const summary = summarizeFlight(flight);
    const sampler = createFlightSampler(flight);

    summary.renderable = sampler !== null;

    if (sampler) {
      summary.videoDurationSeconds = Number(sampler.durationSeconds.toFixed(3));
    }

    return summary;
  });

  return { file: resolve(filePath), flightCount: log.flightCount, flights };
}

// ------------------------------------------------------
// Preview frames + trace
// ------------------------------------------------------

/**
 * One painted 500x300 frame, converted to RGBA for direct
 * canvas putImageData. Returns { width, height, pixels }.
 */
export function renderPreviewFrame({ file, filePath, flight, t, theme }) {
  const log = loadLog(file ?? filePath);
  const flightObj = findFlight(log, flight);

  if (!flightObj) {
    throw new Error(`Flight ${flight} not found in this log.`);
  }

  const sampler = createFlightSampler(flightObj);

  if (!sampler) {
    throw new Error("This flight has no rcCommand[0..3] telemetry.");
  }

  const clamped = Math.min(
    Math.max(Number(t) || 0, 0),
    Math.max(sampler.durationSeconds, 0)
  );

  const sampled = sampler.frameAt(clamped);
  const themeObj = resolveTheme(theme);

  const rgb = paintStickFrame(
    sampled.positions,
    {
      throttle: sampled.toggles.throttle,
      perCell: sampled.telemetry.perCell,
      cellCount: sampled.telemetry.cellCount,
      rpm: sampled.telemetry.rpm
    },
    themeObj
  );

  const rgba = Buffer.alloc((rgb.length / 3) * 4);

  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];
    rgba[j + 1] = rgb[i + 1];
    rgba[j + 2] = rgb[i + 2];
    rgba[j + 3] = 255;
  }

  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, pixels: rgba };
}

const TRACE_POINTS = 1200;

/**
 * Downsampled collective curve (left gimbal Y) across the
 * whole flight — the scrubber's background trace.
 */
export function flightTrace({ file, filePath, flight }) {
  const log = loadLog(file ?? filePath);
  const flightObj = findFlight(log, flight);

  if (!flightObj) {
    throw new Error(`Flight ${flight} not found in this log.`);
  }

  const sampler = createFlightSampler(flightObj);

  if (!sampler) {
    throw new Error("This flight has no rcCommand[0..3] telemetry.");
  }

  const duration = Math.max(sampler.durationSeconds, 0);
  const steps = Math.min(TRACE_POINTS, Math.max(2, Math.round(duration * 50)));
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * duration;
    const sampled = sampler.frameAt(t);

    points.push([Number(t.toFixed(3)), Number(sampled.positions.left.y.toFixed(3))]);
  }

  return { durationSeconds: Number(duration.toFixed(3)), points };
}

// ------------------------------------------------------
// Render jobs
// ------------------------------------------------------

let jobSeq = 0;
let activeJob = null;

// The most recently settled render, kept so its SSE channel
// can close cleanly and /api/media can still answer.
let lastFinishedJob = null;

/** Outputs finished this session — the only files /api/media serves. */
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
    theme: job.theme,
    output: job.output,
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
 * when a render is already running.
 */
export function startRenderJob({ file, filePath, flight, fps, theme, output }) {
  if (activeJob && !activeJob.settled) {
    const error = new Error("A render is already in progress.");
    error.code = "busy";
    throw error;
  }

  const log = loadLog(file ?? filePath);
  const sourceFile = file ?? filePath;
  const flightObj = findFlight(log, flight);

  if (!flightObj) {
    throw new Error(`Flight ${flight} not found in this log.`);
  }

  jobSeq += 1;
  const job = {
    id: `job-${Date.now().toString(36)}-${jobSeq}`,
    state: "running",
    file: resolve(String(sourceFile)),
    flight: Number(flight),
    fps: Number(fps) || 30,
    theme: String(theme || "default"),
    output: resolve(String(output)),
    frames: 0,
    totalFrames: null,
    message: "starting ffmpeg…",
    settled: false,
    listeners: new Set()
  };

  activeJob = job;

  const options = {
    fps: job.fps,
    theme: job.theme,
    onProgress: (message) => {
      job.message = message;

      const match = message.match(/rendered (\d+)\/(\d+)/);

      if (match) {
        job.frames = Number(match[1]);
        job.totalFrames = Number(match[2]);
      }

      broadcast(job, { type: "progress", job: jobSnapshot(job) });
    }
  };

  renderStickVideo(flightObj, job.output, options)
    .then((result) => {
      job.state = "done";
      job.settled = true;
      job.frames = result.frames;
      job.totalFrames = result.frames;
      job.durationSeconds = result.durationSeconds;
      job.message = `done: ${result.frames} frames`;
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

  // Finished jobs stay answerable until the next render
  // replaces them — the SSE channel and any late status
  // poll land after finally() has cleared activeJob.
  return lastFinishedJob && lastFinishedJob.id === id
    ? jobSnapshot(lastFinishedJob)
    : null;
}

export function currentJob() {
  return activeJob ? jobSnapshot(activeJob) : null;
}

/**
 * Subscribe to live job events. Returns an unsubscribe
 * function, or null when the id is unknown. A snapshot of
 * the current state is delivered first.
 *
 * The unsubscribe closure captures the job object itself —
 * NOT the activeJob module variable, which is nulled the
 * moment the render settles. Closing the SSE connection
 * after a finished render must be a quiet no-op, not a
 * crash.
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

export function themeCatalog() {
  return { names: [...THEME_NAMES], themes: THEME_HEX };
}

export async function ffmpegAvailable() {
  return checkFfmpegAvailable();
}

/**
 * Default GUI render destination: <cwd>/out/<logbase>-flight<N>-sticks.mp4
 */
export function suggestOutputPath(filePath, flight) {
  const leaf =
    String(filePath).replace(/\.[^.]+$/, "").split(/[\\/]/).pop() || "log";

  return join(
    process.cwd(),
    "out",
    `${leaf}-flight${Number(flight) || 1}-sticks.mp4`
  );
}

/**
 * Every GUI render lands in <cwd>/out/ — whatever the client
 * sends, only the file name survives (absolute paths and
 * relative subpaths are flattened), so the repo root and
 * anywhere else stay clean.
 */
export function resolveOutputPath(output, filePath, flight) {
  const requested = String(output ?? "").trim();

  const name =
    requested
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || null;

  return name
    ? join(process.cwd(), "out", `${name}.mp4`)
    : suggestOutputPath(filePath, flight);
}

export function isPathInside(path, dir) {
  const resolvedPath = resolve(String(path));
  const root = resolve(String(dir));

  return resolvedPath === root || resolvedPath.startsWith(root + sep);
}

/**
 * Frame rates: decimal to 2 places (59.94), clamped to
 * 1–120. Anything invalid falls back to the 30 default.
 * Shared by the GUI input and its tests so the rule lives
 * in one place.
 */
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