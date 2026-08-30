// ======================================================
// RotorFlight-Blackbox-Video-Overlay — CONSOLE FRONTEND
// ======================================================
//
// Vanilla JS driving the local console: file browsing, log
// loading, live preview scrubbing against the real render
// pipeline, theme selection and per-theme re-inking, and
// render jobs with SSE progress.
//
// ======================================================

"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  logPill: $("log-pill"),
  ffmpegPill: $("ffmpeg-pill"),
  browseBtn: $("browse-btn"),
  srcPanel: $("src-panel"),
  srcHint: $("src-hint"),
  flightsSection: $("flights-section"),
  flightList: $("flight-list"),
  flightFacts: $("flight-facts"),
  fieldList: $("field-list"),
  fieldCount: $("field-count"),
  screen: $("screen"),
  screenFrame: $("screen-frame"),
  screenIdle: $("screen-idle"),
  playBtn: $("play-btn"),
  trace: $("trace"),
  scrubber: $("scrubber"),
  scrubHead: $("scrub-head"),
  tValue: $("t-value"),
  frameValue: $("frame-value"),
  themeStack: $("theme-stack"),
  alphaToggle: $("alpha-toggle"),
  alphaHint: $("alpha-hint"),
  shadowToggle: $("shadow-toggle"),
  colorGrid: $("color-grid"),
  themeReset: $("theme-reset"),
  fpsInput: $("fps-input"),
  outputInput: $("output-input"),
  footFacts: $("foot-facts"),
  renderBtn: $("render-btn"),
  renderMsg: $("render-msg"),
  renderMeter: $("render-meter"),
  renderMeterFill: $("render-meter-fill"),
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
  videoPath: $("video-path")
};

const state = {
  logPath: null,
  flights: [],
  flight: null,
  durationSeconds: 0,
  tracePoints: null,
  theme: "default",
  themes: null,
  themeKeys: [],
  themeOverrides: {},
  alpha: false,
  shadow: false,
  playing: false,
  t: 0,
  fps: 30,
  previewJob: 0,
  previewPending: false
};

const ctx = els.screen.getContext("2d");
void ctx;

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
    body: JSON.stringify(body)
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

/**
 * Mirrors normalizeFps() from src/gui/api.js — the rule is
 * shared, but the browser loads no Node modules.
 */
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

// ------------------------------------------------------
// Accent wiring — the UI re-inks to the theme's dot
// ------------------------------------------------------

function applyAccent(themeName, overrides = state.themeOverrides) {
  const base = state.themes && state.themes[themeName];

  if (!base) return;

  const theme = { ...base, ...overrides };
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty("--dot", theme.dot);

  const match = String(theme.dot).match(/^#([0-9a-f]{6})$/i);

  if (match) {
    const value = match[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);

    rootStyle.setProperty("--dot-soft", `rgba(${r}, ${g}, ${b}, 0.14)`);
  }
}

/**
 * The effective theme for this render: the selected base
 * theme with the user's per-key color overrides merged on.
 */
function effectiveThemeOverrideList() {
  return Object.keys(state.themeOverrides).length > 0
    ? { ...state.themeOverrides }
    : undefined;
}

// ------------------------------------------------------
// Theme color customizer
// ------------------------------------------------------

const OVERRIDE_LABELS = {
  background: "Backdrop",
  box: "Gimbal box",
  crosshair: "Crosshair",
  dot: "Stick dot",
  labelOff: "Text dim",
  rpm: "RPM",
  armed: "Armed text",
  motor: "Motor text",
  vCell: "Voltage text",
  current: "Current text",
  maxCurrent: "Max current text",
  escTemp: "ESC temp text",
  barMotor: "Motor bar fill",
  barCurrent: "Current bar fill",
  barTrack: "Bar track",
  textShadow: "Text shadow"
};

function buildColorGrid() {
  els.colorGrid.innerHTML = "";

  const base = (state.themes && state.themes[state.theme]) || {};
  const merged = { ...base, ...state.themeOverrides };

  for (const key of state.themeKeys) {
    const row = document.createElement("label");
    row.className = "color-row";

    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.className = "color-swatch";
    swatch.value = normalizeHex(merged[key]);
    swatch.dataset.key = key;
    swatch.addEventListener("input", () => {
      state.themeOverrides[key] = swatch.value;
      onThemeColorsOverride(key);
    });

    const name = document.createElement("span");
    name.className = "color-name";
    name.textContent = OVERRIDE_LABELS[key] || key;

    row.append(swatch, name);
    els.colorGrid.appendChild(row);
  }
}

function normalizeHex(hex) {
  const match = String(hex || "").match(/^#([0-9a-f]{6})$/i);

  return match ? `#${match[1].toLowerCase()}` : "#000000";
}

/**
 * Any theme-color change re-inks the console accent (when
 * the dot moved) and repaints the monitor. Swatch refresh
 * is debounced — the native picker fires `input` rapidly
 * while dragging, and each swatch is a server round-trip.
 */
const SWATCH_REFRESH_DEBOUNCE_MS = 250;
let swatchRefreshTimer = 0;

function onThemeColorsOverride(changedKey) {
  if (changedKey === "dot") {
    applyAccent(state.theme, state.themeOverrides);
  }

  // The monitor preview updates immediately (coalesced).
  requestPreview();

  clearTimeout(swatchRefreshTimer);
  swatchRefreshTimer = setTimeout(() => {
    swatchRefreshTimer = 0;
    refreshSwatches();
  }, SWATCH_REFRESH_DEBOUNCE_MS);
}

function resetThemeColors() {
  state.themeOverrides = {};
  buildColorGrid();
  applyAccent(state.theme);
  clearTimeout(swatchRefreshTimer);
  requestPreview();
  refreshSwatches();
}

els.themeReset.addEventListener("click", () => {
  resetThemeColors();
});

els.alphaToggle.addEventListener("change", () => {
  state.alpha = els.alphaToggle.checked;
  els.alphaHint.hidden = !state.alpha;
  // GUI-only affordance: checkerboard behind the preview so
  // transparency is visible. Never rendered into the video.
  els.screenFrame.classList.toggle("alpha-checker", state.alpha);
  updateOutputDefault();
  requestPreview();
});

els.shadowToggle.addEventListener("change", () => {
  state.shadow = els.shadowToggle.checked;
  requestPreview();
});

// ------------------------------------------------------
// Boot
// ------------------------------------------------------

async function boot() {
  try {
    const serverState = await getJson("/api/state");

    state.themes = serverState.themes.themes;
    state.themeKeys = serverState.themes.keys || [];

    for (const name of serverState.themes.names) {
      addThemeCard(name);
    }

    buildColorGrid();
    applyAccent(state.theme);
    markThemeSelection(state.theme);

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

    els.outputInput.value = "";
    renderFootFacts();
  } catch (error) {
    els.ffmpegPill.dataset.state = "missing";
    els.ffmpegPill.textContent = "SERVER ERROR";
    els.renderMsg.textContent = error.message;
  }
}

// ------------------------------------------------------
// Theme cards
// ------------------------------------------------------

function addThemeCard(name) {
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

  paintSwatch(canvas, name);
}

let swatchToken = 0;

async function paintSwatch(canvas, themeName) {
  const myLog = state.logPath;
  const myFlight = state.flight;

  if (!myLog || !myFlight) {
    paintStaticSwatch(canvas, themeName);
    return;
  }

  const token = (swatchToken += 1);
  const t = state.durationSeconds * 0.4;

  const frame = await fetchPreview(
    {
      file: myLog,
      flight: myFlight,
      t,
      theme: themeName,
      alpha: false,
      // Live color edits paint live swatches, but only for
      // the theme card they actually apply to.
      themeOverrides:
        themeName === state.theme ? effectiveThemeOverrideList() : undefined
    },
    token
  );

  if (
    frame &&
    frame.token === token &&
    state.logPath === myLog &&
    state.flight === myFlight
  ) {
    drawFrameTo(canvas, frame);
  }
}

// Before a log is loaded, swatches are drawn locally from
// THEME_HEX — a real layout in miniature.
function paintStaticSwatch(canvas, themeName) {
  const base = state.themes && state.themes[themeName];

  if (!base) return;

  const theme =
    themeName === state.theme
      ? { ...base, ...state.themeOverrides }
      : base;

  const g = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  g.fillStyle = "transparent";
  g.clearRect(0, 0, w, h);
  g.fillStyle = theme.background;
  g.fillRect(0, 0, w, h);

  for (const box of [
    { x: 5, y: 5 },
    { x: w - 45, y: 5 }
  ]) {
    g.fillStyle = theme.box;
    g.fillRect(box.x, box.y, 40, 40);

    g.strokeStyle = theme.crosshair;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(box.x + 20, box.y + 2);
    g.lineTo(box.x + 20, box.y + 38);
    g.moveTo(box.x + 2, box.y + 20);
    g.lineTo(box.x + 38, box.y + 20);
    g.stroke();
  }

  g.fillStyle = theme.dot;
  g.beginPath();
  g.arc(5 + 12, 5 + 14, 5, 0, Math.PI * 2);
  g.arc(w - 45 + 28, 5 + 14, 5, 0, Math.PI * 2);
  g.fill();

  // Mini telemetry strip: motor bar fill, current bar fill,
  // RPM accent — mirrors the live layout's accent colors.
  g.fillStyle = theme.barMotor;
  g.fillRect(6, 52, 14, 4);
  g.fillStyle = theme.barCurrent;
  g.fillRect(w / 2 - 7, 52, 14, 4);
  g.fillStyle = theme.rpm;
  g.fillRect(w - 20, 52, 14, 4);
}

function markThemeSelection(name) {
  for (const card of els.themeStack.children) {
    if (card.dataset.theme === name) {
      card.setAttribute("aria-checked", "true");
    } else {
      card.setAttribute("aria-checked", "false");
    }
  }
}

async function selectTheme(name) {
  state.theme = name;
  state.themeOverrides = {};
  buildColorGrid();
  markThemeSelection(name);
  applyAccent(name);

  // The one orchestrated moment: monitor glides, accent re-inks.
  els.screen.classList.remove("theme-glide");
  void els.screen.offsetWidth;
  els.screen.classList.add("theme-glide");

  await requestPreview();
}

// ------------------------------------------------------
// Preview frames
// ------------------------------------------------------
//
// One request in flight, latest wins: tokens let stale
// responses land silently, and a busy flag prevents the
// request flood that once starved the render endpoints.

async function fetchPreview(body, token) {
  const response = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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
  const buffer = await response.arrayBuffer();

  return {
    width,
    height,
    pixels: new Uint8ClampedArray(buffer),
    token
  };
}

function drawFrameTo(canvas, frame) {
  const g = canvas.getContext("2d");
  g.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
}

let previewBusy = false;

function previewCurrent() {
  return {
    file: state.logPath,
    flight: state.flight,
    t: state.t,
    theme: state.theme,
    themeOverrides: effectiveThemeOverrideList(),
    alpha: state.alpha,
    shadow: state.shadow
  };
}

function sameSubject(a, b) {
  return (
    a.file === b.file &&
    a.flight === b.flight &&
    a.alpha === b.alpha &&
    a.shadow === b.shadow &&
    a.theme === b.theme &&
    JSON.stringify(a.themeOverrides || {}) ===
      JSON.stringify(b.themeOverrides || {})
  );
}

/** Queue a preview; coalesces while one request is in flight. */
function requestPreview() {
  if (!state.logPath || !state.flight) return;

  if (previewBusy) {
    state.previewPending = true;
    return;
  }

  const subject = previewCurrent();
  const token = (state.previewJob += 1);

  previewBusy = true;

  fetchPreview(subject, token)
    .then((frame) => {
      if (
        frame &&
        frame.token === token &&
        sameSubject(subject, previewCurrent())
      ) {
        drawFrameTo(els.screen, frame);
      }
    })
    .finally(() => {
      previewBusy = false;

      if (state.previewPending) {
        state.previewPending = false;
        requestPreview();
      }
    });
}

// ------------------------------------------------------
// Playback
// ------------------------------------------------------

let lastTick = 0;
let lastDrawnT = -1;
// The server paints a full frame per request; playback
// stays smooth at ~20 preview updates/s without flooding.
const PREVIEW_INTERVAL_MS = 50;

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

function stopPlayback() {
  if (!state.playing) return;
  state.playing = false;
  setPlayingButton(false);
}

function setPlaying(next) {
  state.playing = next;
  setPlayingButton(next);

  if (next) {
    lastTick = 0;
    lastDrawnT = -1;
    requestAnimationFrame(tick);
  }
}

function setPlayingButton(playing) {
  els.playBtn.textContent = playing ? "⏸" : "▶";
  els.playBtn.setAttribute("aria-pressed", String(playing));
  els.playBtn.setAttribute(
    "aria-label",
    playing ? "Pause preview" : "Play preview"
  );
}

// ------------------------------------------------------
// Transport
// ------------------------------------------------------

function syncTransport() {
  els.scrubber.value = state.durationSeconds
    ? String((state.t / state.durationSeconds) * 1000)
    : "0";

  els.tValue.textContent = formatClock(state.t);
  els.frameValue.textContent = String(Math.round(state.t * state.fps));
  positionScrubHead();
}

function positionScrubHead() {
  if (!state.durationSeconds) return;

  const fraction = state.t / state.durationSeconds;
  const width = els.trace.clientWidth || 1;

  els.scrubHead.style.left = `${fraction * width}px`;
  els.scrubHead.style.display = "block";
}

els.scrubber.addEventListener("input", () => {
  state.t = (Number(els.scrubber.value) / 1000) * state.durationSeconds;
  syncTransport();
  requestPreview();
});

els.playBtn.addEventListener("click", () => setPlaying(!state.playing));

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

  // Space on a focused button/option activates it natively;
  // handling it here too would double-toggle the transport.
  if (target instanceof HTMLElement && target.closest("button, a, [role='radio']")) {
    return;
  }

  if (event.key === " ") {
    if (!state.flight || els.playBtn.disabled) return;

    event.preventDefault();
    setPlaying(!state.playing);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (!state.durationSeconds || els.scrubber.disabled) return;

    event.preventDefault();
    setPlaying(false);

    const step = event.key === "ArrowLeft" ? -1 : 1;

    state.t = Math.min(
      Math.max(state.t + step / state.fps, 0),
      state.durationSeconds
    );
    syncTransport();
    requestPreview();
  }
});

// ------------------------------------------------------
// Flight trace under the scrubber
// ------------------------------------------------------

function drawTrace() {
  const points = state.tracePoints;

  if (!points || points.length < 2) return;

  const cssWidth = Math.round(els.trace.clientWidth || 600);
  els.trace.width = cssWidth;

  const g = els.trace.getContext("2d");
  const w = els.trace.width;
  const h = els.trace.height;

  const rootStyle = getComputedStyle(document.documentElement);
  g.fillStyle = (rootStyle.getPropertyValue("--well-deep") || "#d4d9d2").trim();
  g.fillRect(0, 0, w, h);

  const baseline = Math.floor(h * 0.5);
  g.strokeStyle = "rgba(36, 40, 42, 0.18)";
  g.beginPath();
  g.moveTo(0, baseline);
  g.lineTo(w, baseline);
  g.stroke();

  g.strokeStyle = (rootStyle.getPropertyValue("--ink-soft") || "#5c6468").trim();
  g.lineWidth = 1.5;
  g.beginPath();

  const firstT = points[0][0];
  const lastT = points[points.length - 1][0];
  const span = Math.max(lastT - firstT, 1e-6);

  for (const [t, y] of points) {
    const x = ((t - firstT) / span) * w;
    const py = baseline - y * (h * 0.42);
    g.lineTo(x, py);
  }

  g.stroke();
}

// ------------------------------------------------------
// Log loading
// ------------------------------------------------------

async function loadLog(path) {
  els.renderMsg.textContent = "Reading log…";

  try {
    const payload = await postJson("/api/log", { path });

    state.logPath = payload.file;
    state.flights = payload.flights;
    state.flight = null;
    state.t = 0;
    state.tracePoints = null;
    state.previewJob += 1;

    els.logPill.hidden = false;
    els.logPill.textContent = payload.file.split(/[\\/]/).pop();
    els.logPill.title = payload.file;

    renderFlights();
    renderFootFacts();

    els.renderMsg.textContent =
      `${payload.flightCount} flight(s) decoded — choose one to preview.`;
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
    dur.textContent = flight.renderable
      ? `${flight.videoDurationSeconds.toFixed(1)}s`
      : "no sticks";
    row.appendChild(dur);

    row.addEventListener("click", () => selectFlight(flight.flight));
    els.flightList.appendChild(row);
  }

  els.flightsSection.hidden = false;

  const first = state.flights.find((flight) => flight.renderable);

  if (first) {
    selectFlight(first.flight);
  } else {
    updateFlightFacts(null);
    disableFlightUI();
  }
}

function disableFlightUI() {
  els.scrubber.disabled = true;
  els.playBtn.disabled = true;
}

function updateFlightFacts(flight) {
  els.flightFacts.innerHTML = "";

  if (!flight) {
    const dt = document.createElement("dt");
    dt.textContent = "LOG";
    const dd = document.createElement("dd");
    dd.textContent = "No usable flights";
    els.flightFacts.append(dt, dd);
    return;
  }

  const facts = [
    ["CRAFT", flight.craftName || "(unnamed)"],
    ["FW", flight.firmware || "(unknown)"],
    ["LOG START", flight.logStart || "—"],
    [
      "FRAMES",
      `${flight.mainFrameCount} main · ${flight.slowFrameCount} slow`
    ],
    ["BOARD", flight.board || "—"]
  ];

  for (const [label, value] of facts) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    els.flightFacts.append(dt, dd);
  }
}

async function selectFlight(flightNumber) {
  const flight = state.flights.find((entry) => entry.flight === flightNumber);

  if (!flight) return;

  state.flight = flightNumber;
  state.t = 0;
  state.durationSeconds = flight.videoDurationSeconds || 0;

  for (const row of els.flightList.children) {
    row.setAttribute(
      "aria-selected",
      String(Number(row.dataset.flight) === flightNumber)
    );
  }

  updateFlightFacts(flight);
  renderFields(flight);

  els.scrubber.disabled = !flight.renderable;
  els.playBtn.disabled = !flight.renderable;

  if (els.renderBtn.dataset.forceDisabled !== "1") {
    els.renderBtn.disabled = !flight.renderable;
  }

  els.screenIdle.hidden = flight.renderable;

  updateOutputDefault();
  syncTransport();

  if (!flight.renderable) {
    state.tracePoints = null;
    return;
  }

  const [tracePayload] = await Promise.all([
    postJson("/api/trace", { file: state.logPath, flight: flightNumber }),
    requestPreview()
  ]);

  state.tracePoints = tracePayload.points;
  drawTrace();

  refreshSwatches();
}

function renderFields(flight) {
  els.fieldList.innerHTML = "";

  const names = flight.mainFields || [];

  els.fieldCount.textContent = String(names.length);

  for (const name of names) {
    const li = document.createElement("li");
    li.textContent = name;
    els.fieldList.appendChild(li);
  }
}

function refreshSwatches() {
  for (const card of els.themeStack.children) {
    paintSwatch(card.querySelector("canvas"), card.dataset.theme);
  }
}

function updateOutputDefault() {
  if (!state.logPath || !state.flight) return;

  const leaf =
    state.logPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") || "log";

  const extension = state.alpha ? "mov" : "mp4";

  if (els.outputInput.dataset.touched !== "1") {
    els.outputInput.value = `out/${leaf}-flight${state.flight}-sticks.${extension}`;
    els.outputInput.dataset.touched = "1";
  } else {
    // Keep the user's stem; follow the alpha toggle only for
    // the extension.
    const current = els.outputInput.value.trim();

    if (/\.(mp4|mov)$/i.test(current)) {
      els.outputInput.value = current.replace(/\.(mp4|mov)$/i, `.${extension}`);
    }
  }
}

els.outputInput.addEventListener("input", () => {
  els.outputInput.dataset.touched = "1";
});

els.fpsInput.addEventListener("change", () => {
  const normalized = normalizeFps(els.fpsInput.value);

  state.fps = normalized;
  els.fpsInput.value = String(normalized);
  syncTransport();
});

// ------------------------------------------------------
// File browser
// ------------------------------------------------------

async function browseInto(path) {
  try {
    renderBrowse(
      await getJson(`/api/browse?dir=${encodeURIComponent(path ?? "")}`)
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

  if (listing.directories.length === 0) {
    const li = document.createElement("li");
    li.className = "browse-empty";
    li.textContent = "No subfolders";
    els.browseDirs.appendChild(li);
  } else {
    for (const dir of listing.directories) {
      els.browseDirs.appendChild(
        browseEntry(`▸ ${dir.name}`, null, () => browseInto(dir.path))
      );
    }
  }

  els.browseFiles.innerHTML = "";

  if (listing.files.length === 0) {
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
        })
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

// ------------------------------------------------------
// Drag & drop — the browser hides full paths, so the file
// bytes are uploaded to a temp dir and decoded there.
// ------------------------------------------------------

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
      body: file
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

// ------------------------------------------------------
// Render jobs (SSE progress)
// ------------------------------------------------------

let eventSource = null;

els.renderBtn.addEventListener("click", async () => {
  if (!state.logPath || !state.flight) return;

  // A running preview pump competes with ffmpeg for the
  // preview socket; park playback before rendering.
  stopPlayback();
  els.renderBtn.disabled = true;

  try {
    const payload = await postJson("/api/render", {
      path: state.logPath,
      flight: state.flight,
      fps: state.fps,
      theme: state.theme,
      themeOverrides: effectiveThemeOverrideList(),
      alpha: state.alpha,
      shadow: state.shadow,
      output: els.outputInput.value.trim()
    });

    watchJob(payload.jobId);
  } catch (error) {
    els.renderMsg.textContent = error.message;

    if (els.renderBtn.dataset.forceDisabled !== "1") {
      els.renderBtn.disabled = false;
    }
  }
});

function watchJob(jobId) {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);

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

  els.videoPath.textContent = job.output;
  els.videoDialog.showModal();
  els.renderMsg.textContent = "Loading video…";

  // Alpha renders are ProRes 4444 (.mov), which browsers
  // cannot decode. The render pipeline writes a flattened
  // <name>.preview.mp4 (checkerboard composite) next to it
  // — play that in the dialog, keep the .mov as deliverable.
  const playable = job.previewPath ?? job.output;

  // Load first, play only when the file is actually ready —
  // and surface any decode error instead of a dead dialog.
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
    els.renderMsg.textContent =
      job.alpha && job.previewPath
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
  player.src = `/api/media?path=${encodeURIComponent(playable)}`;
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

// ------------------------------------------------------
// Footer facts
// ------------------------------------------------------

function renderFootFacts() {
  if (!state.logPath) {
    els.footFacts.innerHTML = "<span class='foot-item'>NO LOG LOADED</span>";
    return;
  }

  const totalDuration = state.flights.reduce(
    (sum, flight) => sum + (flight.videoDurationSeconds || 0),
    0
  );

  const rendered = state.flights.filter((flight) => flight.renderable).length;

  els.footFacts.innerHTML =
    `<span class="foot-item"><b>${state.flights.length}</b> FLIGHTS</span>` +
    `<span class="foot-item"><b>${rendered}</b> RENDERABLE</span>` +
    `<span class="foot-item">${totalDuration.toFixed(1)}S TOTAL</span>`;
}

boot();