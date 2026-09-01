// ======================================================
// RotorFlight-Blackbox-Video-Overlay — CONSOLE FRONTEND (v2)
// ======================================================
//
// Vanilla JS driving the overlay designer:
//   • the layout document is the single source of state
//     (canvas/grid/alpha/theme/font/overrides/items)
//   • every structural change round-trips through
//     /api/layout/normalize (server authority), then the
//     coalesced preview repaints from the normalized doc
//   • drag/drop: telemetry rows → canvas, existing items
//     via pointer-drag with a dashed snapping ghost that
//     commits on drop; arrows nudge the selection a cell
//   • properties rail renders a dynamic form per item type;
//     colours are pickers + opacity, null = theme inherit
//
// ======================================================

"use strict";

const $ = (id) => document.getElementById(id);

const PREVIEW_BG = "#D8ECD0"; // pastel sage — preview only
const GRID_DASH = [6, 6];
const GRID_COLOR = "rgba(32, 44, 38, 0.35)";
const HOVER_OUTLINE = "rgba(32, 44, 38, 0.55)";
const SELECT_OUTLINE = "#1a6fb0";

// Browser-only preview backdrops. "theme" tracks the layout
// theme's background slot; the fixed swatches give editors
// light/dark checking surfaces. None of these reach the
// video pipeline (alpha renders stay transparent).
const BACKDROP_PRESETS = {
  theme: null, // resolved from the active theme at draw time
  light: "#ffffff",
  dark: "#202225",
  default: PREVIEW_BG,
};
const BACKDROP_DEFAULT_KEY = "default";

const els = {
  // header
  saveBtn: $("save-btn"),
  loadBtn: $("load-btn"),
  loadInput: $("load-input"),
  logPill: $("log-pill"),
  ffmpegPill: $("ffmpeg-pill"),
  // source rail
  browseBtn: $("browse-btn"),
  srcPanel: $("src-panel"),
  srcHint: $("src-hint"),
  flightsSection: $("flights-section"),
  flightList: $("flight-list"),
  flightFacts: $("flight-facts"),
  themeStack: $("theme-stack"),
  fontStack: $("font-stack"),
  alphaToggle: $("alpha-toggle"),
  shadowToggle: $("shadow-toggle"),
  previewToggle: $("preview-toggle"),
  fpsInput: $("fps-input"),
  outputInput: $("output-input"),
  // telemetry rail
  addStickBtn: $("add-stick-btn"),
  addTextBtn: $("add-text-btn"),
  teleFilter: $("tele-filter"),
  teleGroups: $("tele-groups"),
  teleEmpty: $("tele-empty"),
  // stage
  canvasW: $("canvas-w"),
  canvasH: $("canvas-h"),
  gridCols: $("grid-cols"),
  gridRows: $("grid-rows"),
  gridToggle: $("grid-toggle"),
  bgPicker: $("bg-picker"),
  canvasWarn: $("canvas-warn"),
  screen: $("screen"),
  gridCanvas: $("grid-canvas"),
  screenFrame: $("screen-frame"),
  canvasWrap: $("canvas-wrap"),
  screenIdle: $("screen-idle"),
  dragGhost: $("drag-ghost"),
  playBtn: $("play-btn"),
  scrubber: $("scrubber"),
  tValue: $("t-value"),
  // properties
  propsBody: $("props-body"),
  propsEmpty: $("props-empty"),
  colorGrid: $("color-grid"),
  themeReset: $("theme-reset"),
  // footer
  footFacts: $("foot-facts"),
  renderBtn: $("render-btn"),
  renderMsg: $("render-msg"),
  renderMeter: $("render-meter"),
  renderMeterFill: $("render-meter-fill"),
  // dialogs
  browseDialog: $("browse-dialog"),
  browseClose: $("browse-close"),
  browseUp: $("browse-up"),
  browsePath: $("browse-path"),
  browseDrives: $("browse-drives"),
  browseDirs: $("browse-dirs"),
  browseFiles: $("browse-files"),
  videoDialog: $("video-dialog"),
  videoClose: $("video-close"),
  videoPlayer: $("video-player"),
  videoPath: $("video-path"),
};

// ------------------------------------------------------
// State
// ------------------------------------------------------

const state = {
  logPath: null,
  flights: [],
  fields: [],
  flight: null,
  durationSeconds: 0,
  // The layout document (client mirror; server normalizes).
  layout: null,
  // Server-measured boxes: id → {x,y,width,height} in layout px.
  boxes: {},
  // Preview payload scale: layout px / preview px.
  previewScale: 1,
  selectedId: null,
  themes: null,
  themeMaps: null,
  fonts: null,
  playing: false,
  t: 0,
  previewJob: 0,
  previewBusy: false,
  previewPending: false,
  // Browser-only preview backdrop key (BACKDROP_PRESETS).
  backdrop: BACKDROP_DEFAULT_KEY,
  // transient drag state
  drag: null,
};

const ctx = els.screen.getContext("2d");
const gridCtx = els.gridCanvas.getContext("2d");

// ------------------------------------------------------
// Small utilities
// ------------------------------------------------------

function formatClock(t) {
  const total = Math.max(0, t);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `${url} failed (${response.status})`);
  }

  return payload;
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `${url} failed (${response.status})`);
  }

  return payload;
}

const FPS_MIN = 1;
const FPS_MAX = 120;
const FPS_DEFAULT = 30;

function normalizeFps(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return FPS_DEFAULT;
  }

  const parsed = Number(String(value).trim());

  if (!Number.isFinite(parsed)) {
    return FPS_DEFAULT;
  }

  const clamped = Math.min(Math.max(parsed, FPS_MIN), FPS_MAX);

  return Math.round(clamped * 100) / 100;
}

function randomId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let id = "i";

  for (let i = 0; i < 7; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return id;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ------------------------------------------------------
 * Layout doc plumbing
 *
 * The client keeps a working layout doc; the server owns
 * validation + measurement. mutateLayout() normalizes the
 * doc and repaints; it returns the normalized items.
 * ------------------------------------------------------ */

function defaultLayoutObject() {
  return {
    version: 2,
    canvas: { width: 800, height: 500 },
    grid: { cols: 14, rows: 14 },
    alpha: true,
    shadow: false,
    theme: "default",
    font: "vt323",
    themeOverrides: {},
    items: [],
  };
}

let normalizeTimer = 0;

/** Coalesced normalize + preview refresh. */
function scheduleSync(delay = 120) {
  clearTimeout(normalizeTimer);
  normalizeTimer = setTimeout(async () => {
    try {
      const result = await postJson("/api/layout/normalize", {
        layout: state.layout,
      });

      state.layout = result.layout;
      state.boxes = result.boxes;

      if (result.warnings.length > 0) {
        els.canvasWarn.textContent = result.warnings[0];
        els.canvasWarn.hidden = false;
      } else {
        els.canvasWarn.hidden = true;
      }

      // Empty layouts show the idle hint immediately — the
      // preview response later confirms it, but the overlap
      // (idle text over painted items) must never linger.
      els.screenIdle.hidden = state.layout.items.length > 0;

      syncLayoutInputs();
      refreshProperties();
      requestPreview();
    } catch (error) {
      els.renderMsg.textContent = error.message;
    }
  }, delay);
}

function selectedItem() {
  return (
    state.layout?.items.find((item) => item.id === state.selectedId) ?? null
  );
}

function selectedItemBox() {
  return state.boxes[state.selectedId] ?? null;
}

/* ------------------------------------------------------
 * Preview pipeline (one request in flight, latest wins)
 * ------------------------------------------------------ */

async function fetchPreview(token) {
  const response = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layout: state.layout,
      file: state.logPath,
      flight: state.flight,
      t: state.t,
    }),
  });

  if (!response.ok) {
    let message = "Preview failed";

    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Binary/empty body; keep the generic message.
    }

    if (token === state.previewJob) {
      els.renderMsg.textContent = message;
    }

    return null;
  }

  const width = Number(response.headers.get("X-Frame-Width"));
  const height = Number(response.headers.get("X-Frame-Height"));
  const layoutW = Number(response.headers.get("X-Layout-Width"));
  const layoutH = Number(response.headers.get("X-Layout-Height"));
  const buffer = await response.arrayBuffer();

  return {
    width,
    height,
    layoutWidth: layoutW,
    layoutHeight: layoutH,
    pixels: new Uint8ClampedArray(buffer),
    token,
  };
}

function drawFrameTo(frame) {
  if (els.screen.width !== frame.width || els.screen.height !== frame.height) {
    els.screen.width = frame.width;
    els.screen.height = frame.height;
  }

  // putImageData REPLACES the bitmap (no compositing), so the
  // chosen backdrop must live in CSS: transparent frame
  // pixels reveal the element background beneath. Browser
  // decoration only — the video pipeline never sees it.
  ctx.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
}

/** Resolved preview backdrop colour, or "" when the canvas
 * should keep its transparent default (opaque layout). */
function previewBackdropColor() {
  if (state.layout?.alpha !== true) {
    return ""; // opaque frames paint their own background
  }

  const key = state.backdrop;

  if (key === "theme") {
    return (
      state.themeMaps?.[state.layout.theme]?.background ??
      BACKDROP_PRESETS[BACKDROP_DEFAULT_KEY]
    );
  }

  return BACKDROP_PRESETS[key] ?? BACKDROP_PRESETS[BACKDROP_DEFAULT_KEY];
}

/** Paint the backdrop swatches (theme swatch tracks the
 * current theme's background slot) and mark the selection. */
function buildBackdropPicker() {
  if (!els.bgPicker) return;

  const backdrop = previewBackdropColor();
  const themeBg =
    state.themeMaps?.[state.layout?.theme]?.background ??
    BACKDROP_PRESETS[BACKDROP_DEFAULT_KEY];

  for (const button of els.bgPicker.querySelectorAll(".bg-swatch")) {
    const key = button.dataset.bg;

    button.style.background = key === "theme" ? themeBg : BACKDROP_PRESETS[key];
    button.setAttribute("aria-checked", String(key === state.backdrop));
  }

  // putImageData replaces the bitmap (no compositing), so the
  // backdrop lives in CSS: the canvas reveals its background
  // wherever the alpha frame is transparent. The bezel
  // follows so the whole monitor reads as one surface.
  els.screen.style.background = backdrop;
  els.screenFrame.style.background =
    backdrop || BACKDROP_PRESETS[BACKDROP_DEFAULT_KEY];
}

els.bgPicker?.addEventListener("click", (event) => {
  const button = event.target.closest(".bg-swatch");

  if (!button) return;

  state.backdrop = button.dataset.bg ?? BACKDROP_DEFAULT_KEY;
  buildBackdropPicker();
  requestPreview();
});

function requestPreview() {
  if (!state.layout) return;

  if (state.previewBusy) {
    state.previewPending = true;
    return;
  }

  const token = (state.previewJob = (state.previewJob ?? 0) + 1);

  state.previewBusy = true;

  fetchPreview(token)
    .then((frame) => {
      if (frame && frame.token === token) {
        state.previewScale = frame.width / frame.layoutWidth;
        drawFrameTo(frame);
        drawGrid();
        const hasItems = state.layout.items.length > 0;
        els.screenIdle.hidden = hasItems;
      }
    })
    .finally(() => {
      state.previewBusy = false;

      if (state.previewPending) {
        state.previewPending = false;
        requestPreview();
      }
    });
}

/* ------------------------------------------------------
 * Grid + editing overlays (browser-only)
 * ------------------------------------------------------ */

function drawGrid() {
  const layout = state.layout;

  if (!layout) return;

  const show = els.gridToggle.checked;
  const w = els.screen.width;
  const h = els.screen.height;

  if (els.gridCanvas.width !== w || els.gridCanvas.height !== h) {
    els.gridCanvas.width = w;
    els.gridCanvas.height = h;
  }

  gridCtx.clearRect(0, 0, w, h);

  if (!show) return;

  gridCtx.strokeStyle = GRID_COLOR;
  gridCtx.lineWidth = 1;
  gridCtx.setLineDash(GRID_DASH);

  for (let c = 1; c < layout.grid.cols; c += 1) {
    const x = Math.round((c * w) / layout.grid.cols) + 0.5;

    gridCtx.beginPath();
    gridCtx.moveTo(x, 0);
    gridCtx.lineTo(x, h);
    gridCtx.stroke();
  }

  for (let r = 1; r < layout.grid.rows; r += 1) {
    const y = Math.round((r * h) / layout.grid.rows) + 0.5;

    gridCtx.beginPath();
    gridCtx.moveTo(0, y);
    gridCtx.lineTo(w, y);
    gridCtx.stroke();
  }

  gridCtx.setLineDash([]);

  // Objects occlude the grid: knock the lines out of every
  // item's measured box so the frame beneath shows through
  // and items always read as sitting ON the grid. The
  // selection outline (drawn next) stays above everything.
  const s = state.previewScale;

  for (const box of Object.values(state.boxes)) {
    gridCtx.clearRect(
      box.x * s - 1,
      box.y * s - 1,
      box.width * s + 2,
      box.height * s + 2
    );
  }

  drawSelection();
}

function drawSelection() {
  const box = selectedItemBox();

  if (!box) return;

  // Boxes are in layout space; map through the same
  // preview scale the frame was painted at.
  const s = state.previewScale;
  const x = box.x * s;
  const y = box.y * s;
  const w = box.width * s;
  const h = box.height * s;

  gridCtx.setLineDash([4, 4]);
  gridCtx.strokeStyle = SELECT_OUTLINE;
  gridCtx.lineWidth = 2;
  gridCtx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  gridCtx.setLineDash([]);
}

/* ------------------------------------------------------
 * Pointer interaction: select, drag, snap
 * ------------------------------------------------------ */

/** Pointer event → layout-space point. Only the DISPLAYED
 * canvas rect matters: the browser scales the canvas bitmap
 * (payload px) to the displayed size, and layout px relate
 * to bitmap px by layoutW/bitmapW. */
function canvasPoint(event) {
  const rect = els.screen.getBoundingClientRect();
  const layoutW = state.layout?.canvas.width || 1;
  const layoutH = state.layout?.canvas.height || 1;
  const bitmapW = els.screen.width || 1;
  const bitmapH = els.screen.height || 1;

  return {
    x: ((event.clientX - rect.left) / rect.width) * layoutW,
    y: ((event.clientY - rect.top) / rect.height) * layoutH,
  };
}

function hitTest(point) {
  // Topmost = last in the items array.
  const items = state.layout?.items ?? [];

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const box = state.boxes[items[i].id];

    if (!box) continue;

    if (
      point.x >= box.x &&
      point.x < box.x + box.width &&
      point.y >= box.y &&
      point.y < box.y + box.height
    ) {
      return items[i].id;
    }
  }

  return null;
}

function cellFromPoint(point) {
  const layout = state.layout;

  return {
    col: clamp(
      Math.floor(point.x / (layout.canvas.width / layout.grid.cols)),
      0,
      layout.grid.cols - 1,
    ),
    row: clamp(
      Math.floor(point.y / (layout.canvas.height / layout.grid.rows)),
      0,
      layout.grid.rows - 1,
    ),
  };
}

let dragging = null;

els.screen.addEventListener("pointerdown", (event) => {
  if (!state.layout || event.button !== 0) return;

  const point = canvasPoint(event);
  const hitId = hitTest(point);

  if (!hitId) {
    selectItem(null);
    return;
  }

  selectItem(hitId);

  const item = state.layout.items.find((it) => it.id === hitId);

  dragging = {
    id: hitId,
    startCol: item.col,
    startRow: item.row,
    moved: false,
  };

  els.screen.setPointerCapture(event.pointerId);
});

els.screen.addEventListener("pointermove", (event) => {
  if (!dragging) return;

  const layout = state.layout;
  const point = canvasPoint(event);
  const cell = cellFromPoint(point);
  const item = layout.items.find((it) => it.id === dragging.id);

  if (!item) return;

  if (cell.col !== item.col || cell.row !== item.row) {
    dragging.moved = true;
    moveGhost(item, cell.col, cell.row);
  }
});

els.screen.addEventListener("pointerup", (event) => {
  if (!dragging) return;

  const { id, moved } = dragging;

  dragging = null;
  els.dragGhost.hidden = true;

  if (!moved) {
    return;
  }

  const point = canvasPoint(event);
  const cell = cellFromPoint(point);
  const item = state.layout.items.find((it) => it.id === id);

  if (item && (cell.col !== item.col || cell.row !== item.row)) {
    item.col = cell.col;
    item.row = cell.row;
    selectItem(id);
    scheduleSync(0);
  }
});

/** Dashed snapping ghost during drags (browser-only).
 * Positioned in CSS pixels via the canvas's displayed size,
 * so the ghost tracks the item regardless of preview scale. */
function cssPerLayout() {
  const rect = els.screen.getBoundingClientRect();
  const layoutW = state.layout?.canvas.width || 1;

  return rect.width / layoutW;
}

function moveGhost(item, col, row) {
  const k = cssPerLayout();
  const layout = state.layout;
  const cellW = layout.canvas.width / layout.grid.cols;
  const cellH = layout.canvas.height / layout.grid.rows;
  const box = state.boxes[item.id];

  const ghost = els.dragGhost;

  ghost.hidden = false;
  ghost.style.left = `${col * cellW * k}px`;
  ghost.style.top = `${row * cellH * k}px`;
  // The item's full measured box (it overflows cells), so
  // the dragged contents always sit inside the outline.
  ghost.style.width = box ? `${box.width * k}px` : `${cellW * k}px`;
  ghost.style.height = box ? `${box.height * k}px` : `${cellH * k}px`;
}

els.screen.addEventListener("pointercancel", () => {
  dragging = null;
  els.dragGhost.hidden = true;
});

function selectItem(id) {
  state.selectedId = id;
  drawGrid();
  refreshProperties();
}

/* ------------------------------------------------------
 * Keyboard: arrows nudge a cell, delete, duplicate
 * ------------------------------------------------------ */

document.addEventListener("keydown", (event) => {
  if (els.browseDialog.open || els.videoDialog.open) return;

  const target = event.target;

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return;
  }

  if (event.key === " " && !target.closest("button, a, [role='radio']")) {
    if (!state.flight || els.playBtn.disabled) return;

    event.preventDefault();
    setPlaying(!state.playing);
    return;
  }

  if (!state.selectedId) return;

  const item = state.layout.items.find((it) => it.id === state.selectedId);

  if (!item) return;

  if (event.key === "Delete") {
    event.preventDefault();
    deleteItem(state.selectedId);
    return;
  }

  if (event.ctrlKey && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateItem(state.selectedId);
    return;
  }

  let col = item.col;
  let row = item.row;

  if (event.key === "ArrowLeft") col -= 1;
  else if (event.key === "ArrowRight") col += 1;
  else if (event.key === "ArrowUp") row -= 1;
  else if (event.key === "ArrowDown") row += 1;
  else return;

  event.preventDefault();

  item.col = clamp(col, 0, state.layout.grid.cols - 1);
  item.row = clamp(row, 0, state.layout.grid.rows - 1);
  scheduleSync(0);
});

/* ------------------------------------------------------
 * Item CRUD
 * ------------------------------------------------------ */

function firstFreeCellClient() {
  const layout = state.layout;
  const cellW = layout.canvas.width / layout.grid.cols;
  const cellH = layout.canvas.height / layout.grid.rows;

  const covered = (cx, cy) =>
    layout.items.some((item) => {
      const box = state.boxes[item.id];

      if (!box) return false;

      return (
        cx < box.x + box.width &&
        cx + cellW > box.x &&
        cy < box.y + box.height &&
        cy + cellH > box.y
      );
    });

  for (let row = 0; row < layout.grid.rows; row += 1) {
    for (let col = 0; col < layout.grid.cols; col += 1) {
      if (!covered(col * cellW, row * cellH)) {
        return { col, row };
      }
    }
  }

  return { col: 0, row: 0 };
}

const ITEM_DEFAULT_PROPS = {
  stick: {
    size: "med",
    xChannel: 0,
    yChannel: 1,
    showCaption: false,
    boxColor: null,
    crosshairColor: null,
    dotColor: null,
  },
  text: {
    source: "custom",
    customText: "Custom text",
    showLabel: false,
    alignment: "stacked",
    labelSize: null,
    labelColor: null,
    valueSize: null,
    valueColor: null,
    cardColor: null,
    accentColor: null,
  },
  bar: {
    source: "derived:motorPct",
    orientation: "vertical",
    width: 13,
    height: 200,
    maxValue: { mode: "percent" },
    showLabel: false,
    labelOverride: null,
    labelSize: null,
    labelColor: null,
    trackColor: null,
    fillColor: null,
    cardColor: null,
    accentColor: null,
  },
  donut: {
    source: "derived:rpm",
    size: "med",
    showValue: true,
    showLabel: true,
    labelOverride: null,
    labelSize: null,
    labelColor: null,
    valueSize: null,
    valueColor: null,
    trackColor: null,
    fillColor: null,
    cardColor: null,
    accentColor: null,
    maxValue: { mode: "flightMax" },
  },
};

const SOURCE_DEFAULTS = {
  "derived:motorPct": { type: "bar", maxValue: { mode: "percent" } },
};

function addItem(type, propsOverride = {}, at = null) {
  const props = structuredClone(ITEM_DEFAULT_PROPS[type]);
  const cell = at ?? firstFreeCellClient();

  if (propsOverride && typeof propsOverride === "object") {
    Object.assign(props, propsOverride);
  }

  const item = {
    id: randomId(),
    type,
    col: cell.col,
    row: cell.row,
    props,
  };

  state.layout.items.push(item);
  state.selectedId = item.id;
  scheduleSync(0);
}

function addSourceItem(sourceId, at = null) {
  const known = SOURCE_DEFAULTS[sourceId];
  const type = known ? known.type : "text";
  const props = structuredClone(ITEM_DEFAULT_PROPS[type]);

  delete props.customText;
  props.source = sourceId;

  if (type === "text") {
    props.showLabel = true;
  } else {
    // Percentage sources lock to percent; everything else
    // defaults to Flight Maximum. (Text items have no
    // maxValue — never add the key there.)
    props.maxValue = {
      mode:
        known?.maxValue?.mode ??
        (isPercentageSource(sourceId) ? "percent" : "flightMax"),
    };
  }

  const cell = at ?? firstFreeCellClient();
  const item = { id: randomId(), type, col: cell.col, row: cell.row, props };

  state.layout.items.push(item);
  state.selectedId = item.id;
  scheduleSync(0);
}

function deleteItem(id) {
  state.layout.items = state.layout.items.filter((item) => item.id !== id);

  if (state.selectedId === id) {
    state.selectedId = null;
  }

  scheduleSync(0);
}

function duplicateItem(id) {
  const item = state.layout.items.find((it) => it.id === id);

  if (!item) return;

  const copy = structuredClone(item);

  copy.id = randomId();
  copy.col = item.col;
  copy.row = item.row;

  // Bump into the next free cell.
  const cellW = state.layout.canvas.width / state.layout.grid.cols;
  const cellH = state.layout.canvas.height / state.layout.grid.rows;

  state.layout.items.push(copy);

  // First free scan happens server-side via normalize; the
  // copy lands on the same cell — the user moves it. For
  // convenience shift one cell right when free.
  const covered = state.layout.items.some(
    (other) =>
      other !== copy && other.col === copy.col && other.row === copy.row,
  );

  if (covered) {
    copy.col = (copy.col + 1) % state.layout.grid.cols;
  }

  state.selectedId = copy.id;
  scheduleSync(0);
}

function reorderItem(id, direction) {
  const items = state.layout.items;
  const index = items.findIndex((item) => item.id === id);

  if (index < 0) return;

  const swapWith = index + direction;

  if (swapWith < 0 || swapWith >= items.length) return;

  [items[index], items[swapWith]] = [items[swapWith], items[index]];
  scheduleSync(0);
}

/* ------------------------------------------------------
 * Telemetry panel
 * ------------------------------------------------------ */

const DERIVED_ENTRIES = [
  { id: "derived:armed", label: "Armed", kind: "flag" },
  { id: "derived:motorOn", label: "Motor On", kind: "flag" },
  { id: "derived:throttle", label: "Throttle", kind: "flag" },
  { id: "derived:rpm", label: "RPM", kind: "number" },
  { id: "derived:packVolts", label: "Battery Volts", kind: "number" },
  { id: "derived:perCell", label: "Volts/Cell", kind: "number" },
  { id: "derived:current", label: "Current", kind: "number" },
  { id: "derived:maxCurrent", label: "Max Current", kind: "number" },
  { id: "derived:escTemp", label: "ESC Temp", kind: "number" },
  { id: "derived:motorPct", label: "Motor %", kind: "number" },
];

const RC_ENTRIES = [
  { id: "field:rcCommand[0]", label: "Roll" },
  { id: "field:rcCommand[1]", label: "Pitch" },
  { id: "field:rcCommand[2]", label: "Yaw" },
  { id: "field:rcCommand[3]", label: "Collective" },
  { id: "field:rcCommand[4]", label: "Throttle" },
];

const RAW_SKIP = new Set([
  "rcCommand[0]",
  "rcCommand[1]",
  "rcCommand[2]",
  "rcCommand[3]",
  "rcCommand[4]",
  "time",
  "loopIteration",
]);

function renderTelemetryPanel() {
  const filter = els.teleFilter.value.trim().toLowerCase();

  els.teleGroups.innerHTML = "";

  const groups = [
    { title: "DERIVED", entries: DERIVED_ENTRIES },
    { title: "RC CHANNELS", entries: RC_ENTRIES },
    {
      title: "FIELDS",
      entries: state.fields
        .filter((name) => !RAW_SKIP.has(name))
        .map((name) => ({ id: `field:${name}`, label: name })),
    },
  ];

  for (const group of groups) {
    const entries = filter
      ? group.entries.filter((entry) =>
          entry.label.toLowerCase().includes(filter),
        )
      : group.entries;

    if (entries.length === 0) continue;

    const details = document.createElement("section");
    details.className = "tele-group";

    const title = document.createElement("h3");

    title.className = "group-title";
    title.textContent = group.title;
    details.appendChild(title);

    const list = document.createElement("ul");

    list.className = "tele-list";

    for (const entry of entries) {
      const li = document.createElement("li");
      li.className = "tele-row";
      li.dataset.source = entry.id;
      li.draggable = true;

      const name = document.createElement("span");

      name.className = "tele-name";
      name.textContent = entry.label;
      name.title = entry.id;
      li.appendChild(name);

      const add = document.createElement("button");

      add.type = "button";
      add.className = "btn btn-add";
      add.textContent = "+";
      add.title = `Add ${entry.label}`;
      add.setAttribute("aria-label", `Add ${entry.label} to preview`);
      add.addEventListener("click", () => {
        addSourceItem(entry.id);
      });
      li.appendChild(add);

      list.appendChild(li);
    }

    details.appendChild(list);
    els.teleGroups.appendChild(details);
  }
}

els.teleFilter.addEventListener("input", renderTelemetryPanel);

// Drag from the telemetry panel onto the canvas.
let panelDrag = null;

els.teleGroups.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".tele-row");

  if (!row) return;

  panelDrag = { source: row.dataset.source };
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", row.dataset.source);
});

els.teleGroups.addEventListener("dragend", () => {
  panelDrag = null;
});

els.screen.addEventListener("dragover", (event) => {
  if (!panelDrag) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";

  const cell = cellFromPoint(canvasPoint(event));

  showGhostAt(cell.col, cell.row);
});

els.screen.addEventListener("drop", (event) => {
  if (!panelDrag) return;

  event.preventDefault();

  const cell = cellFromPoint(canvasPoint(event));

  els.dragGhost.hidden = true;

  if (panelDrag.source === "custom") {
    addItem("text", null, cell);
  } else {
    addSourceItem(panelDrag.source, cell);
  }

  panelDrag = null;
});

function showGhostAt(col, row) {
  const k = cssPerLayout();
  const layout = state.layout;
  const cellW = layout.canvas.width / layout.grid.cols;
  const cellH = layout.canvas.height / layout.grid.rows;

  els.dragGhost.hidden = false;
  els.dragGhost.style.left = `${col * cellW * k}px`;
  els.dragGhost.style.top = `${row * cellH * k}px`;
  els.dragGhost.style.width = `${cellW * k}px`;
  els.dragGhost.style.height = `${cellH * k}px`;
}

/* ------------------------------------------------------
 * Properties rail
 * ------------------------------------------------------ */

const COLOR_PROPS = {
  stick: [
    ["boxColor", "Box"],
    ["crosshairColor", "Crosshair"],
    ["dotColor", "Dot"],
  ],
  text: [
    ["labelColor", "Label color"],
    ["valueColor", "Value color"],
    ["cardColor", "Card color (none = transparent)"],
    ["accentColor", "Accent stripe"],
  ],
  bar: [
    ["labelColor", "Label color"],
    ["trackColor", "Track color"],
    ["fillColor", "Bar color"],
    ["cardColor", "Card color (none = transparent)"],
    ["accentColor", "Accent stripe"],
  ],
  donut: [
    ["labelColor", "Label color"],
    ["valueColor", "Value color"],
    ["trackColor", "Track color"],
    ["fillColor", "Bar color"],
    ["cardColor", "Card color (none = transparent)"],
    ["accentColor", "Accent stripe"],
  ],
};

const FONT_PROPS = {
  text: [
    ["labelSize", "Label size"],
    ["valueSize", "Value size"],
  ],
  bar: [["labelSize", "Label size"]],
  donut: [
    ["labelSize", "Label size"],
    ["valueSize", "Value size"],
  ],
};

const TYPE_LABELS = {
  stick: "Stick Display",
  text: "Text",
  bar: "Progress Bar",
  donut: "Donut Chart",
};

function refreshProperties() {
  els.propsBody.innerHTML = "";

  const item = selectedItem();

  if (!item) {
    const empty = document.createElement("p");

    empty.className = "props-empty";
    empty.textContent = "Select an item on the canvas to edit its properties.";
    els.propsBody.appendChild(empty);
    return;
  }

  els.propsBody.appendChild(buildPropsHeader(item));

  const body = document.createElement("div");
  body.className = "props-body-inner";

  if (item.type === "stick") buildStickProps(item, body);
  if (item.type === "text") buildTextProps(item, body);
  if (item.type === "bar") buildBarProps(item, body);
  if (item.type === "donut") buildDonutProps(item, body);

  buildColorProps(item, body);
  buildFontSizes(item, body);
  buildItemActions(item, body);

  els.propsBody.appendChild(body);
}

function buildPropsHeader(item) {
  const header = document.createElement("div");
  header.className = "props-header";

  const type = document.createElement("span");

  type.className = "props-type";
  type.textContent = TYPE_LABELS[item.type];
  header.appendChild(type);

  return header;
}

function field(label, input, cls = "") {
  const row = document.createElement("label");

  row.className = `prop-row ${cls}`;

  const span = document.createElement("span");

  span.className = "prop-name";
  span.textContent = label;
  row.append(span, input);

  return row;
}

function textInput(value, onChange) {
  const input = document.createElement("input");

  input.type = "text";
  input.className = "fld";
  input.value = value ?? "";
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function numberInput(value, min, max, onChange, nullable = false) {
  const input = document.createElement("input");

  input.type = "number";
  input.className = "fld fld-num";
  input.min = min;
  input.max = max;

  if (value !== null && value !== undefined) {
    input.value = String(value);
  } else if (nullable) {
    input.placeholder = "theme";
  } else {
    input.value = String(value ?? min);
  }

  input.addEventListener("change", () => {
    onChange(input.value === "" && nullable ? null : Number(input.value));
  });
  return input;
}

function checkbox(label, checked, onChange) {
  const row = document.createElement("label");

  row.className = "alpha-row prop-check";

  const input = document.createElement("input");

  input.type = "checkbox";
  input.className = "switch-input";
  input.checked = checked === true;
  input.addEventListener("change", () => onChange(input.checked));

  const track = document.createElement("span");

  track.className = "switch-track";
  track.innerHTML = "<span class='switch-knob'></span>";

  const text = document.createElement("span");

  text.className = "switch-label";
  text.textContent = label;

  row.append(input, track, text);
  return row;
}

function select(options, value, onChange) {
  const select_el = document.createElement("select");

  select_el.className = "fld";

  for (const opt of options) {
    const option = document.createElement("option");

    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = opt.value === value;
    select_el.appendChild(option);
  }

  select_el.addEventListener("change", () => onChange(select_el.value));
  return select_el;
}

const RC_OPTIONS = [
  { value: 0, label: "rcCommand[0] — Roll" },
  { value: 1, label: "rcCommand[1] — Pitch" },
  { value: 2, label: "rcCommand[2] — Yaw" },
  { value: 3, label: "rcCommand[3] — Collective" },
  { value: 4, label: "rcCommand[4] — Throttle" },
];

const SOURCE_OPTIONS = () => {
  const options = [{ value: "custom", label: "Custom text" }];

  for (const entry of DERIVED_ENTRIES) {
    if (
      !entry.id.startsWith("derived:arm") &&
      entry.id !== "derived:throttle" &&
      entry.id !== "derived:motorOn"
    ) {
      options.push({ value: entry.id, label: entry.label });
    }
  }

  for (const name of state.fields) {
    if (!RAW_SKIP.has(name))
      options.push({ value: `field:${name}`, label: name });
  }

  return options;
};

function buildStickProps(item, root) {
  root.appendChild(
    checkbox("Axis caption", item.props.showCaption, (v) =>
      updateProp(item, "showCaption", v),
    ),
  );

  const xSel = select(RC_OPTIONS, item.props.xChannel, (v) =>
    updateProp(item, "xChannel", Number(v)),
  );
  const ySel = select(RC_OPTIONS, item.props.yChannel, (v) =>
    updateProp(item, "yChannel", Number(v)),
  );

  root.appendChild(field("X axis", xSel));
  root.appendChild(field("Y axis", ySel));

  const sizeSel = select(
    [
      { value: "small", label: "Small (120px)" },
      { value: "med", label: "Medium (200px)" },
      { value: "large", label: "Large (280px)" },
    ],
    item.props.size,
    (v) => updateProp(item, "size", v),
  );

  root.appendChild(field("Size", sizeSel));

  // Stick colour overrides ride COLOR_PROPS via the shared
  // builder; the stick entry lists box/crosshair/dot.
}

function buildTextProps(item, root) {
  if (item.props.source === "custom") {
    const textarea = document.createElement("textarea");

    textarea.className = "fld";
    textarea.rows = 3;
    textarea.value = item.props.customText ?? "";
    textarea.addEventListener("change", () =>
      updateProp(item, "customText", textarea.value),
    );
    root.appendChild(field("Text", textarea));
  } else {
    const srcSel = select(SOURCE_OPTIONS(), item.props.source, (v) =>
      updateProp(item, "source", v),
    );

    root.appendChild(field("Source", srcSel));
    root.appendChild(
      checkbox("Show label", item.props.showLabel, (v) =>
        updateProp(item, "showLabel", v),
      ),
    );

    const alignSel = select(
      [
        { value: "stacked", label: "Label over value (centred)" },
        { value: "inline", label: "Inline: label then value" },
      ],
      item.props.alignment,
      (v) => updateProp(item, "alignment", v),
    );

    root.appendChild(field("Layout", alignSel));

    const override = textInput(item.props.labelOverride ?? "", (v) =>
      updateProp(item, "labelOverride", v === "" ? null : v),
    );

    root.appendChild(field("Label override", override));
  }
}

function buildBarProps(item, root) {
  root.appendChild(
    field(
      "Source",
      select(barDonutSources(), item.props.source, (v) =>
        updateProp(item, "source", v),
      ),
    ),
  );
  root.appendChild(
    field(
      "Orientation",
      select(
        [
          { value: "vertical", label: "Vertical" },
          { value: "horizontal", label: "Horizontal" },
        ],
        item.props.orientation,
        (v) => updateProp(item, "orientation", v),
      ),
    ),
  );
  root.appendChild(
    field(
      "Thickness (px)",
      numberInput(item.props.width, 2, 2048, (v) =>
        updateProp(item, "width", v),
      ),
    ),
  );
  root.appendChild(
    field(
      "Length (px)",
      numberInput(item.props.height, 2, 2048, (v) =>
        updateProp(item, "height", v),
      ),
    ),
  );
  root.appendChild(
    checkbox("Show label", item.props.showLabel, (v) =>
      updateProp(item, "showLabel", v),
    ),
  );

  if (item.props.showLabel) {
    root.appendChild(
      field(
        "Label override",
        textInput(item.props.labelOverride ?? "", (v) =>
          updateProp(item, "labelOverride", v === "" ? null : v),
        ),
      ),
    );
  }

  buildMaxValue(item, root, isPercentageSource(item.props.source));
}

function buildDonutProps(item, root) {
  root.appendChild(
    field(
      "Source",
      select(barDonutSources(), item.props.source, (v) =>
        updateProp(item, "source", v),
      ),
    ),
  );
  root.appendChild(
    checkbox("Show value in center", item.props.showValue, (v) =>
      updateProp(item, "showValue", v),
    ),
  );
  root.appendChild(
    checkbox("Show label", item.props.showLabel, (v) =>
      updateProp(item, "showLabel", v),
    ),
  );

  if (item.props.showLabel) {
    root.appendChild(
      field(
        "Label override",
        textInput(item.props.labelOverride ?? "", (v) =>
          updateProp(item, "labelOverride", v === "" ? null : v),
        ),
      ),
    );
  }

  const sizeSel = select(
    [
      { value: "small", label: "Small (120px)" },
      { value: "med", label: "Medium (200px)" },
      { value: "large", label: "Large (280px)" },
    ],
    item.props.size,
    (v) => updateProp(item, "size", v),
  );

  root.appendChild(field("Size", sizeSel));

  buildMaxValue(item, root, isPercentageSource(item.props.source));
}

function buildMaxValue(item, root, percentage) {
  const modes = percentage
    ? [{ value: "percent", label: "100% Max (percentage field)" }]
    : [
        { value: "flightMax", label: "Flight Maximum" },
        { value: "dynamic", label: "Dynamic (grows as log plays)" },
      ];

  const modeSel = select(
    modes,
    percentage ? "percent" : (item.props.maxValue?.mode ?? "flightMax"),
    (v) => updateProp(item, "maxValue", { mode: v }),
  );

  root.appendChild(field("Max value", modeSel));
}

function barDonutSources() {
  const options = [];

  for (const entry of DERIVED_ENTRIES) {
    if (entry.kind === "number")
      options.push({ value: entry.id, label: entry.label });
  }

  for (const name of state.fields) {
    if (!RAW_SKIP.has(name) && !name.startsWith("rcCommand")) {
      options.push({ value: `field:${name}`, label: name });
    }
  }

  return options;
}

function isPercentageSource(sourceId) {
  return (
    sourceId === "derived:motorPct" ||
    /^field:motor\[\d+\]$/.test(sourceId ?? "")
  );
}

/* Colour sub-controls: picker + opacity, null = inherit. */

const SLOT_LABELS = {
  "stick.box": "Stick box",
  "stick.crosshair": "Crosshair",
  "stick.dot": "Stick dot",
  "fonts.label.color": "Labels",
  "fonts.value.color": "Values",
  "card.color": "Card",
  "card.accent": "Accent",
  "bar.track": "Bar track",
  "bar.fill": "Bar fill",
  "donut.track": "Donut track",
  "donut.fill": "Donut fill",
  background: "Backdrop",
  textShadow: "Text shadow",
};

function buildColorSub(label, item, propKey) {
  return buildColorPropertyStub(label, item, propKey);
}

function buildColorProperty(parent, label, item, propKey) {
  const wrap = document.createElement("div");

  wrap.className = "prop-row prop-color-row";

  const name = document.createElement("span");

  name.className = "prop-name";
  name.textContent = label;

  const controls = document.createElement("div");

  controls.className = "color-controls";

  const picker = document.createElement("input");

  picker.type = "color";
  picker.className = "color-swatch";

  const value = item.props[propKey];

  picker.value = value ? value.hex : "#888888";
  picker.disabled = !value;

  const opacity = document.createElement("input");

  opacity.type = "range";
  opacity.className = "opacity-slider";
  opacity.min = 0;
  opacity.max = 100;
  opacity.value = value ? value.alpha : 100;
  opacity.disabled = !value;
  opacity.title = "Opacity";

  const none = document.createElement("button");

  none.type = "button";
  none.className = "btn btn-tiny";
  none.textContent = value ? "clear" : "set";
  none.title = "Toggle between theme-inherited and explicit color";

  picker.addEventListener("input", () => {
    item.props[propKey] = { hex: picker.value, alpha: Number(opacity.value) };
    paintSoon();
  });

  opacity.addEventListener("input", () => {
    if (item.props[propKey]) {
      item.props[propKey] = {
        hex: item.props[propKey].hex,
        alpha: Number(opacity.value),
      };
      paintSoon();
    }
  });

  none.addEventListener("click", () => {
    if (item.props[propKey]) {
      item.props[propKey] = null;
      none.textContent = "set";
    } else {
      item.props[propKey] = { hex: picker.value, alpha: Number(opacity.value) };
      none.textContent = "clear";
    }

    picker.disabled = opacity.disabled = !item.props[propKey];
    refreshProperties();
    paintSoon();
  });

  controls.append(picker, opacity, none);
  wrap.append(name, controls);
  parent.appendChild(wrap);
}

function buildColorProps(item, root) {
  for (const [propKey, label] of COLOR_PROPS[item.type] ?? []) {
    buildColorProperty(root, label, item, propKey);

    // A card's min-width only matters once the card exists;
    // show it right under the card colour control.
    if (propKey === "cardColor") {
      buildCardMinWidthProperty(root, item);
    }
  }
}

/** Min card width (px): keeps values inside the card bounds
 * when live text would otherwise outgrow the measured box.
 * Empty = auto-size from content (null). */
function buildCardMinWidthProperty(root, item) {
  const input = numberInput(
    item.props.cardMinWidth,
    0,
    2048,
    (v) =>
      updateProp(
        item,
        "cardMinWidth",
        v === null || Number.isNaN(v) ? null : Math.round(v),
      ),
    true,
  );

  input.placeholder = "auto";
  input.disabled = !item.props.cardColor;
  input.title = item.props.cardColor
    ? "Minimum card width in px"
    : "Enable a card color first";

  root.appendChild(field("Card min width", input));
}

function buildFontSizeProperty(parent, label, item, propKey) {
  parent.appendChild(
    field(
      label,
      numberInput(
        item.props[propKey],
        8,
        200,
        (v) => updateProp(item, propKey, v),
        true,
      ),
    ),
  );
}

function buildFontSizes(item, root) {
  for (const [propKey, label] of FONT_PROPS[item.type] ?? []) {
    buildFontSizeProperty(root, `${label} (px)`, item, propKey);
  }
}

function updateProp(item, key, value) {
  // Percentage lock on bar/donut source changes (text items
  // carry no maxValue).
  if (
    key === "source" &&
    (item.type === "bar" || item.type === "donut") &&
    item.props.maxValue
  ) {
    item.props.maxValue = {
      mode: isPercentageSource(value)
        ? "percent"
        : item.props.maxValue?.mode === "percent"
          ? "flightMax"
          : (item.props.maxValue?.mode ?? "flightMax"),
    };
  }

  item.props[key] = value;
  scheduleSync(0);
}

function paintSoon() {
  scheduleSync(120);
}

function buildItemActions(item, root) {
  const actions = document.createElement("div");

  actions.className = "prop-actions";

  const make = (text, fn) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "btn btn-tiny";
    button.textContent = text;
    button.addEventListener("click", fn);
    return button;
  };

  if (item.type !== "stick") {
    const typeSel = select(
      [
        { value: "text", label: "Text card" },
        { value: "bar", label: "Progress Bar" },
        { value: "donut", label: "Donut Chart" },
      ],
      item.type,
      (v) => switchType(item, v),
    );

    root.appendChild(field("Widget type", typeSel));
  }

  const row = document.createElement("div");

  row.className = "prop-actions-row";
  row.append(
    make("Forward", () => reorderItem(item.id, 1)),
    make("Backward", () => reorderItem(item.id, -1)),
    make("Duplicate", () => duplicateItem(item.id)),
  );

  const del = make("Delete item", () => deleteItem(item.id));

  del.classList.add("btn-danger");
  row.append(del);

  root.appendChild(row);
}

function switchType(item, nextType) {
  if (nextType === item.type) return;

  const oldProps = item.props;
  const fresh = structuredClone(ITEM_DEFAULT_PROPS[nextType]);

  // Carry the source (custom text sources reset) and the
  // max-value mode for bar/donut; text items have neither.
  if (nextType !== "text") {
    fresh.source = oldProps.source ?? fresh.source;
    fresh.maxValue = {
      mode: isPercentageSource(fresh.source) ? "percent" : "flightMax",
    };
  } else if (oldProps.source && oldProps.source !== "custom") {
    fresh.source = oldProps.source;
    fresh.showLabel = true;
    fresh.alignment = "stacked";
  }

  item.type = nextType;
  item.props = fresh;
  scheduleSync(0);
}

/* ------------------------------------------------------
 * Boot + theme/font cards + customizer
 * ------------------------------------------------------ */

function applyAccent(
  themeName,
  overrides = state.layout?.themeOverrides ?? {},
) {
  if (!state.themeMaps) return;

  const map = state.themeMaps[themeName];

  if (!map) return;

  const merged = { ...map };

  for (const [path, value] of Object.entries(overrides)) {
    if (path in map && typeof value === "object" && value) {
      merged[path] = value.hex;
    } else if (path in map && typeof value === "string") {
      merged[path] = value;
    }
  }

  const dot = merged["stick.dot"] ?? "#ee4266";
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty("--dot", dot);

  const match = String(dot).match(/^#([0-9a-f]{6})$/i);

  if (match) {
    const value = match[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);

    rootStyle.setProperty("--dot-soft", `rgba(${r}, ${g}, ${b}, 0.14)`);
  }
}

function buildThemeCards() {
  els.themeStack.innerHTML = "";

  for (const name of state.themes) {
    const card = document.createElement("button");

    card.type = "button";
    card.className = "theme-card";
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", "false");
    card.dataset.theme = name;

    const canvas = document.createElement("canvas");

    canvas.width = 100;
    canvas.height = 60;
    card.appendChild(canvas);

    const label = document.createElement("span");

    label.className = "theme-name";
    label.textContent = name.toUpperCase();
    card.appendChild(label);

    card.addEventListener("click", () => selectTheme(name));
    els.themeStack.appendChild(card);

    paintStaticSwatch(canvas, name);
  }
}

function paintStaticSwatch(canvas, themeName) {
  const map = state.themeMaps?.[themeName];

  if (!map) return;

  const g = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  g.clearRect(0, 0, w, h);
  g.fillStyle = map.background;
  g.fillRect(0, 0, w, h);

  for (const box of [
    { x: 5, y: 5 },
    { x: w - 45, y: 5 },
  ]) {
    g.fillStyle = map["stick.box"];
    g.fillRect(box.x, box.y, 40, 40);

    g.strokeStyle = map["stick.crosshair"];
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(box.x + 20, box.y + 2);
    g.lineTo(box.x + 20, box.y + 38);
    g.moveTo(box.x + 2, box.y + 20);
    g.lineTo(box.x + 38, box.y + 20);
    g.stroke();
  }

  g.fillStyle = map["stick.dot"];
  g.beginPath();
  g.arc(5 + 12, 5 + 14, 5, 0, Math.PI * 2);
  g.arc(w - 45 + 28, 5 + 14, 5, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = map["bar.fill"];
  g.fillRect(6, 52, 14, 4);
  g.fillStyle = map["donut.fill"];
  g.fillRect(w / 2 - 7, 52, 14, 4);
}

function markThemeSelection(name) {
  for (const card of els.themeStack.children) {
    card.setAttribute("aria-checked", String(card.dataset.theme === name));
  }
}

async function selectTheme(name) {
  state.layout.theme = name;
  state.layout.themeOverrides = {};
  markThemeSelection(name);
  buildColorGrid();
  applyAccent(name);
  buildBackdropPicker();
  scheduleSync(0);
}

function loadFontFaces(catalog) {
  for (const [id, def] of Object.entries(catalog.fonts)) {
    const file = def.weights["400"] ?? Object.values(def.weights ?? {})[0];

    if (!file || def.source === "bitmap") continue;

    const family = `overlay-${id}`;
    const face = new FontFace(family, `url(/fonts/${file})`);

    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        for (const card of els.fontStack.children) {
          if (card.dataset.font === id) {
            card.querySelector(".font-name").style.fontFamily =
              `'${family}', monospace`;
          }
        }
      })
      .catch(() => {
        // Card falls back to the console font; not fatal.
      });
  }
}

function buildFontCards() {
  els.fontStack.innerHTML = "";

  for (const id of state.fonts.ids) {
    const def = state.fonts.fonts[id];
    const card = document.createElement("button");

    card.type = "button";
    card.className = "font-card";
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", "false");
    card.dataset.font = id;

    const name = document.createElement("span");

    name.className = "font-name";
    name.textContent = def ? def.name : id.toUpperCase();
    card.appendChild(name);

    card.addEventListener("click", () => selectFont(id));
    els.fontStack.appendChild(card);
  }
}

function markFontSelection(id) {
  for (const card of els.fontStack.children) {
    card.setAttribute("aria-checked", String(card.dataset.font === id));
  }
}

function selectFont(id) {
  state.layout.font = id;
  markFontSelection(id);
  scheduleSync(0);
}

/* Theme customizer: structural slots. */

const SLOT_ROWS = [
  ["background", "Backdrop"],
  ["textShadow", "Text shadow"],
  ["fonts.label.color", "Labels"],
  ["fonts.value.color", "Values"],
  ["card.color", "Card"],
  ["card.accent", "Accent stripe"],
  ["stick.box", "Stick box"],
  ["stick.crosshair", "Crosshair"],
  ["stick.dot", "Stick dot"],
  ["bar.track", "Bar track"],
  ["bar.fill", "Bar fill"],
  ["donut.track", "Donut track"],
  ["donut.fill", "Donut fill"],
];

function buildColorGrid() {
  els.colorGrid.innerHTML = "";

  const map = state.themeMaps?.[state.layout.theme] ?? {};

  for (const [slot, label] of SLOT_ROWS) {
    const wrap = document.createElement("label");

    wrap.className = "color-row";

    const swatch = document.createElement("input");

    swatch.type = "color";
    swatch.className = "color-swatch";
    swatch.value = map[slot] ?? "#000000";
    swatch.dataset.slot = slot;
    swatch.addEventListener("input", () => {
      state.layout.themeOverrides[slot] = { hex: swatch.value, alpha: 100 };
      applyAccent(state.layout.theme, state.layout.themeOverrides);
      paintSoon();
    });

    const name = document.createElement("span");

    name.className = "color-name";
    name.textContent = label;

    wrap.append(swatch, name);
    els.colorGrid.appendChild(wrap);
  }
}

els.themeReset.addEventListener("click", () => {
  state.layout.themeOverrides = {};
  buildColorGrid();
  applyAccent(state.layout.theme, {});
  scheduleSync(0);
});

/* ------------------------------------------------------
 * Layout strip handlers
 * ------------------------------------------------------ */

function onCanvasDims() {
  const width = Number(els.canvasW.value);
  const height = Number(els.canvasH.value);

  state.layout.canvas.width = clamp(Math.floor(width), 64, 7680);
  state.layout.canvas.height = clamp(Math.floor(height), 64, 7680);
  scheduleSync(0);
}

function onGridDims() {
  state.layout.grid.cols = clamp(
    Math.round(Number(els.gridCols.value)) || 12,
    1,
    48,
  );
  state.layout.grid.rows = clamp(
    Math.round(Number(els.gridRows.value)) || 6,
    1,
    27,
  );
  scheduleSync(0);
}

els.canvasW.addEventListener("change", onCanvasDims);
els.canvasH.addEventListener("change", onCanvasDims);
els.gridCols.addEventListener("change", onGridDims);
els.gridRows.addEventListener("change", onGridDims);

els.gridToggle.addEventListener("change", () => {
  drawGrid();
});

els.alphaToggle.addEventListener("change", () => {
  state.layout.alpha = els.alphaToggle.checked;
  els.alphaHint.hidden = false;
  updateOutputExtension();
  syncPreviewControls();
  scheduleSync(0);
});

els.shadowToggle.addEventListener("change", () => {
  state.layout.shadow = els.shadowToggle.checked;
  scheduleSync(0);
});

// The flattened .preview.mp4 only exists for alpha renders;
// keep the switch and its hint honest when alpha is off.
els.previewToggle.addEventListener("change", () => {
  syncPreviewControls();
});

function syncPreviewControls() {
  const alpha = state.layout?.alpha === true;

  els.previewToggle.disabled = !alpha;
  $("preview-hint").hidden = !alpha;
}

function updateOutputExtension() {
  const extension = state.layout.alpha ? "mov" : "mp4";
  const current = els.outputInput.value.trim();

  if (/\.(mp4|mov)$/i.test(current)) {
    els.outputInput.value = current.replace(/\.(mp4|mov)$/i, `.${extension}`);
  }
}

function syncLayoutInputs() {
  const layout = state.layout;

  if (document.activeElement !== els.canvasW) {
    els.canvasW.value = String(layout.canvas.width);
  }

  if (document.activeElement !== els.canvasH) {
    els.canvasH.value = String(layout.canvas.height);
  }

  if (document.activeElement !== els.gridCols) {
    els.gridCols.value = String(layout.grid.cols);
  }

  if (document.activeElement !== els.gridRows) {
    els.gridRows.value = String(layout.grid.rows);
  }

  drawGrid();
}

/* ------------------------------------------------------
 * Playback
 * ------------------------------------------------------ */

let lastTick = 0;
const PREVIEW_INTERVAL_MS = 50;
let lastDrawnT = -1;

function tick(now) {
  if (!state.playing) return;

  const delta = lastTick ? (now - lastTick) / 1000 : 0;
  lastTick = now;

  state.t += delta;

  if (state.t >= state.durationSeconds) {
    state.t = 0;
    lastDrawnT = -1;
  }

  syncTransport();

  if (Math.abs(state.t - lastDrawnT) * 1000 >= PREVIEW_INTERVAL_MS) {
    lastDrawnT = state.t;
    requestPreview();
  }

  requestAnimationFrame(tick);
}

function setPlaying(next) {
  state.playing = next;
  els.playBtn.textContent = next ? "⏸" : "▶";
  els.playBtn.setAttribute("aria-pressed", String(next));

  if (next) {
    lastTick = 0;
    lastDrawnT = -1;
    requestAnimationFrame(tick);
  }
}

function syncTransport() {
  els.scrubber.value = state.durationSeconds
    ? String((state.t / state.durationSeconds) * 1000)
    : "0";

  els.tValue.textContent = formatClock(state.t);
}

els.scrubber.addEventListener("input", () => {
  state.t = (Number(els.scrubber.value) / 1000) * state.durationSeconds;
  syncTransport();
  requestPreview();
});

els.playBtn.addEventListener("click", () => setPlaying(!state.playing));

/* ------------------------------------------------------
 * Log loading
 * ------------------------------------------------------ */

async function loadLog(path) {
  els.renderMsg.textContent = "Reading log…";

  try {
    const payload = await postJson("/api/log", { path });

    state.logPath = payload.file;
    state.flights = payload.flights;
    state.flight = null;
    state.t = 0;
    state.previewJob = (state.previewJob ?? 0) + 1;

    els.logPill.hidden = false;
    els.logPill.textContent = payload.file.split(/[\\/]/).pop();
    els.logPill.title = payload.file;

    // Telemetry entries: the first renderable flight's fields.
    const first =
      payload.flights.find((f) => f.renderable) ?? payload.flights[0];

    state.fields = first?.mainFields ?? [];
    renderTelemetryPanel();

    els.teleFilter.disabled = false;
    els.addStickBtn.disabled = false;
    els.addTextBtn.disabled = false;

    renderFlights();
    renderFootFacts();

    els.renderMsg.textContent = `${payload.flightCount} flight(s) decoded — choose one to preview.`;
  } catch (error) {
    els.renderMsg.textContent = `Could not read log: ${error.message}`;
  }
}

function renderFlights() {
  els.flightList.innerHTML = "";

  if (state.flights.length === 0) {
    els.srcHint.textContent = "No flights with decodable frames in this log.";
    els.flightsSection.hidden = true;
    return;
  }

  for (const flight of state.flights) {
    const row = document.createElement("button");

    row.type = "button";
    row.className = "flight-row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.dataset.flight = String(flight.flight);

    const num = document.createElement("span");

    num.className = "flight-num";
    num.textContent = `#${flight.flight}`;
    row.appendChild(num);

    const name = document.createElement("span");

    name.className = "flight-name";
    name.textContent = flight.craftName || "Flight";
    row.appendChild(name);

    const dur = document.createElement("span");

    dur.className = "flight-dur";
    dur.textContent = `${flight.durationSeconds.toFixed(1)}s`;
    row.appendChild(dur);

    row.addEventListener("click", () => selectFlight(flight.flight));
    els.flightList.appendChild(row);
  }

  els.flightsSection.hidden = false;

  if (state.flights[0]) {
    selectFlight(state.flights[0].flight);
  }
}

function selectFlight(flightNumber) {
  const flight = state.flights.find((entry) => entry.flight === flightNumber);

  if (!flight) return;

  state.flight = flightNumber;
  state.t = 0;
  state.durationSeconds = flight.durationSeconds || 0;

  for (const row of els.flightList.children) {
    row.setAttribute(
      "aria-selected",
      String(Number(row.dataset.flight) === flightNumber),
    );
  }

  updateFlightFacts(flight);

  els.scrubber.disabled = false;
  els.playBtn.disabled = false;

  if (els.renderBtn.dataset.forceDisabled !== "1") {
    els.renderBtn.disabled = false;
  }

  syncTransport();
  updateOutputDefault();
  requestPreview();
}

function updateFlightFacts(flight) {
  els.flightFacts.innerHTML = "";

  if (!flight) return;

  const facts = [
    ["CRAFT", flight.craftName || "(unnamed)"],
    ["FW", flight.firmware || "(unknown)"],
    ["LOG START", flight.logStart || "—"],
    ["FRAMES", `${flight.mainFrameCount} main · ${flight.slowFrameCount} slow`],
  ];

  for (const [label, value] of facts) {
    const dt = document.createElement("dt");

    dt.textContent = label;

    const dd = document.createElement("dd");

    dd.textContent = value;
    els.flightFacts.append(dt, dd);
  }
}

function renderFootFacts() {
  if (!state.logPath) {
    els.footFacts.innerHTML = "<span class='foot-item'>NO LOG LOADED</span>";
    return;
  }

  els.footFacts.innerHTML =
    `<span class="foot-item"><b>${state.flights.length}</b> FLIGHTS</span>` +
    `<span class="foot-item">${state.durationSeconds.toFixed(1)}S SELECTED</span>`;
}

function updateOutputDefault() {
  if (!state.logPath || !state.flight) return;

  const leaf =
    state.logPath
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, "") || "log";

  if (els.outputInput.dataset.touched !== "1") {
    els.outputInput.value = `out/${leaf}-flight${state.flight}-overlay.${state.layout.alpha ? "mov" : "mp4"}`;
    els.outputInput.dataset.touched = "1";
  } else {
    updateOutputExtension();
  }
}

els.outputInput.addEventListener("input", () => {
  els.outputInput.dataset.touched = "1";
});

els.fpsInput.addEventListener("change", () => {
  els.fpsInput.value = String(normalizeFps(els.fpsInput.value));
});

/* ------------------------------------------------------
 * File browser + drag/drop upload
 * ------------------------------------------------------ */

async function browseInto(path) {
  try {
    renderBrowse(
      await getJson(`/api/browse?dir=${encodeURIComponent(path ?? "")}`),
    );
  } catch (error) {
    els.renderMsg.textContent = `Cannot open folder: ${error.message}`;
  }
}

async function openBrowse() {
  try {
    renderBrowse(await getJson("/api/browse"));
    els.browseDialog.showModal();
  } catch (error) {
    els.renderMsg.textContent = `Cannot browse: ${error.message}`;
  }
}

function browseEntry(label, sublabel, action) {
  const li = document.createElement("li");

  const button = document.createElement("button");

  button.type = "button";
  button.addEventListener("click", action);

  const name = document.createElement("span");

  name.textContent = label;
  button.appendChild(name);

  if (sublabel) {
    const size = document.createElement("span");

    size.className = "entry-size";
    size.textContent = sublabel;
    button.appendChild(size);
  }

  li.appendChild(button);
  return li;
}

function renderBrowse(listing) {
  els.browsePath.textContent = listing.path;
  els.browseUp.disabled = !listing.parent;

  if (listing.parent) {
    els.browseUp.dataset.parent = listing.parent;
  } else {
    delete els.browseUp.dataset.parent;
  }

  els.browseDrives.innerHTML = "";

  if (listing.drives) {
    for (const drive of listing.drives) {
      const li = document.createElement("li");

      li.style.listStyle = "none";

      const button = document.createElement("button");

      button.type = "button";
      button.className = "btn";
      button.textContent = drive.name;
      button.addEventListener("click", () => browseInto(drive.path));

      li.appendChild(button);
      els.browseDrives.appendChild(li);
    }
  }

  els.browseDirs.innerHTML = "";

  if (!listing.directories.length) {
    const li = document.createElement("li");

    li.className = "browse-empty";
    li.textContent = "No subfolders";
    els.browseDirs.appendChild(li);
  } else {
    for (const dir of listing.directories) {
      els.browseDirs.appendChild(
        browseEntry(`▸ ${dir.name}`, null, () => browseInto(dir.path)),
      );
    }
  }

  els.browseFiles.innerHTML = "";

  if (!listing.files.length) {
    const li = document.createElement("li");

    li.className = "browse-empty";
    li.textContent = "No .bbl files here";
    els.browseFiles.appendChild(li);
  } else {
    for (const file of listing.files) {
      els.browseFiles.appendChild(
        browseEntry(file.name, formatBytes(file.size), () => {
          els.browseDialog.close();
          loadLog(file.path);
        }),
      );
    }
  }
}

els.browseBtn.addEventListener("click", () => openBrowse());
els.browseClose.addEventListener("click", () => els.browseDialog.close());
els.browseUp.addEventListener("click", () => {
  if (els.browseUp.dataset.parent) {
    browseInto(els.browseUp.dataset.parent);
  }
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

for (const eventName of ["dragenter", "dragover"]) {
  els.srcPanel.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.srcPanel.classList.add("drop-ready");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  els.srcPanel.addEventListener(eventName, () => {
    els.srcPanel.classList.remove("drop-ready");
  });
}

els.srcPanel.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files?.[0];

  if (!file || !file.name.toLowerCase().endsWith(".bbl")) {
    els.renderMsg.textContent = "Drop a .bbl blackbox log file.";
    return;
  }

  els.renderMsg.textContent = `Uploading ${file.name}…`;

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Upload failed");
    }

    await loadLog(payload.path);
  } catch (error) {
    els.renderMsg.textContent = `Upload failed: ${error.message}`;
  }
});

/* ------------------------------------------------------
 * Save / Load layout JSON
 * ------------------------------------------------------ */

els.saveBtn.addEventListener("click", () => {
  const doc = JSON.stringify(state.layout, null, 2);
  const blob = new Blob([doc], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "overlay.gimbal.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

els.loadBtn.addEventListener("click", () => els.loadInput.click());

els.loadInput.addEventListener("change", async () => {
  const file = els.loadInput.files?.[0];

  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());

    // Server normalize is the validation authority.
    const result = await postJson("/api/layout/normalize", { layout: parsed });

    state.layout = result.layout;
    state.boxes = result.boxes;
    state.selectedId = null;

    els.canvasW.value = String(state.layout.canvas.width);
    els.canvasH.value = String(state.layout.canvas.height);
    els.gridCols.value = String(state.layout.grid.cols);
    els.gridRows.value = String(state.layout.grid.rows);
    els.alphaToggle.checked = state.layout.alpha;
    els.shadowToggle.checked = state.layout.shadow;

    markThemeSelection(state.layout.theme);
    markFontSelection(state.layout.font);
    buildColorGrid();
    applyAccent(state.layout.theme, state.layout.themeOverrides);
    buildBackdropPicker();
    syncPreviewControls();

    els.renderMsg.textContent =
      result.warnings.length > 0
        ? `Loaded (with warnings: ${result.warnings.length})`
        : "Layout loaded.";

    requestPreview();
    refreshProperties();
  } catch (error) {
    els.renderMsg.textContent = `Could not load layout: ${error.message}`;
  } finally {
    els.loadInput.value = "";
  }
});

/* ------------------------------------------------------
 * Add buttons
 * ------------------------------------------------------ */

els.addStickBtn.addEventListener("click", () => {
  addItem("stick");
});

els.addTextBtn.addEventListener("click", () => {
  addItem("text");
});

/* ------------------------------------------------------
 * Render jobs (SSE progress)
 * ------------------------------------------------------ */

let eventSource = null;

els.renderBtn.addEventListener("click", async () => {
  if (!state.logPath || !state.flight) return;

  setPlaying(false);
  els.renderBtn.disabled = true;

  try {
    // Flush any pending edit to the server first, then send
    // the current layout to the render job.
    await scheduleSyncNow();

    const payload = await postJson("/api/render", {
      path: state.logPath,
      flight: state.flight,
      fps: normalizeFps(els.fpsInput.value),
      layout: state.layout,
      output: els.outputInput.value.trim(),
      // Alpha renders optionally skip the flattened .preview.mp4.
      preview: els.previewToggle.checked !== false,
    });

    watchJob(payload.jobId);
  } catch (error) {
    els.renderMsg.textContent = error.message;

    if (els.renderBtn.dataset.forceDisabled !== "1") {
      els.renderBtn.disabled = false;
    }
  }
});

let pendingSync = null;

/** Run a normalize pass NOW (coalescing with any pending
 * debounced run) and resolve when the doc is confirmed. */
function scheduleSyncNow() {
  clearTimeout(normalizeTimer);
  normalizeTimer = 0;

  pendingSync =
    pendingSync ??
    postJson("/api/layout/normalize", {
      layout: state.layout,
    })
      .then((result) => {
        state.layout = result.layout;
        state.boxes = result.boxes;
        syncLayoutInputs();
        refreshProperties();
        requestPreview();
      })
      .finally(() => {
        pendingSync = null;
      });

  return pendingSync;
}

function watchJob(jobId) {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(
    `/api/jobs/${encodeURIComponent(jobId)}/events`,
  );

  eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "progress") {
      showProgress(payload.job);
    } else if (payload.type === "done") {
      showDone(payload.job);
      finishJob();
    } else if (payload.type === "error") {
      showError(payload.job);
      finishJob();
    }
  };
}

function finishJob() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  if (els.renderBtn.dataset.forceDisabled !== "1") {
    els.renderBtn.disabled = false;
  }
}

function showProgress(job) {
  els.renderMeter.hidden = false;

  const total = job.totalFrames || 1;

  els.renderMeterFill.style.width = `${Math.min(100, (job.frames / total) * 100)}%`;
  els.renderMsg.textContent = `${job.message} → ${job.output}`;
}

function showDone(job) {
  els.renderMeter.hidden = true;
  els.renderMeterFill.style.width = "0%";
  els.renderMsg.textContent = `Done — ${job.frames} frames → ${job.output}`;

  // No preview (skipped or opaque-less alpha): report the
  // file location instead of opening a player that would
  // choke on raw ProRes 4444.
  if (!job.previewPath) {
    els.renderMsg.textContent = job.layout?.alpha
      ? `Done — ${job.frames} frames → ${job.output} (no preview; play the .mov in your editor)`
      : `Done — ${job.frames} frames → ${job.output}`;
    return;
  }

  els.videoPath.textContent = job.output;
  els.videoDialog.showModal();
  els.renderMsg.textContent = "Loading video…";

  const player = els.videoPlayer;
  const timeout = setTimeout(() => {
    cleanup();
    els.renderMsg.textContent =
      "Video is taking longer to load — press play when ready.";
  }, 8000);

  function cleanup() {
    clearTimeout(timeout);
    player.removeEventListener("canplay", onReady);
    player.removeEventListener("error", onError);
  }

  function onReady() {
    cleanup();
    els.renderMsg.textContent = job.layout?.alpha
      ? `Done — ${job.frames} frames → ${job.output} (preview below; the .mov carries the real alpha)`
      : `Done — ${job.frames} frames → ${job.output}`;
    player.play().catch(() => {
      // Autoplay may be refused; controls remain available.
    });
  }

  function onError() {
    cleanup();
    els.renderMsg.textContent =
      "The browser could not play this file — it is on disk at " + job.output;
  }

  player.addEventListener("canplay", onReady);
  player.addEventListener("error", onError);
  player.src = `/api/media?path=${encodeURIComponent(job.previewPath ?? job.output)}`;
  player.load();
}

function showError(job) {
  els.renderMeter.hidden = true;
  els.renderMsg.textContent = job.error
    ? `Render failed: ${job.error}`
    : "Render failed.";
}

els.videoClose.addEventListener("click", () => {
  els.videoPlayer.pause();
  els.videoDialog.close();
});

els.videoDialog.addEventListener("close", () => {
  els.videoPlayer.pause();
});

/* ------------------------------------------------------
 * Boot
 * ------------------------------------------------------ */

async function boot() {
  state.layout = defaultLayoutObject();

  try {
    const serverState = await getJson("/api/state");

    state.themes = serverState.themes.names;
    state.themeMaps = serverState.themes.maps;
    state.fonts = serverState.fonts;
    state.fonts.default = serverState.fonts.default || "vt323";
    state.layout.font = serverState.fonts.default || "vt323";

    buildThemeCards();
    markThemeSelection(state.layout.theme);
    buildColorGrid();
    applyAccent(state.layout.theme);
    buildBackdropPicker();

    buildFontCards();
    loadFontFaces(serverState.fonts);
    markFontSelection(state.layout.font);

    els.ffmpegPill.dataset.state = serverState.ffmpeg ? "ok" : "missing";
    els.ffmpegPill.textContent = serverState.ffmpeg
      ? "FFMPEG OK"
      : "FFMPEG NOT FOUND";

    if (!serverState.ffmpeg) {
      els.renderBtn.disabled = true;
      els.renderBtn.dataset.forceDisabled = "1";
      els.renderMsg.textContent =
        "Install ffmpeg (and add it to PATH) to render video.";
    }

    renderTelemetryPanel();
    renderFootFacts();
    syncLayoutInputs();
    syncPreviewControls();
    requestPreview();
  } catch (error) {
    els.ffmpegPill.dataset.state = "missing";
    els.ffmpegPill.textContent = "SERVER ERROR";
    els.renderMsg.textContent = error.message;
  }
}

boot();
