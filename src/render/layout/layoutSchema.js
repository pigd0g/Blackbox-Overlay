// ======================================================
// RotorFlight-Blackbox-Video-Overlay — LAYOUT SCHEMA (v2)
// ======================================================
//
// The layout document: canvas resolution, editable grid,
// and the items placed on it. One authority for defaults,
// validation, clamping, and geometry:
//
//   normalizeLayout(doc) → { layout, boxes, warnings }
//
// Strict-normalizing: unknown item types and unknown
// properties are DROPPED (with a warning), invalid values
// are clamped, missing values filled from defaults. The
// returned `boxes` map id → { x, y, width, height } gives
// the browser authoritative geometry for hit-testing,
// free-cell placement, and dashed ghost dragging.
//
// Anchor model (the interview decision): an item's rect is
// anchored by its TOP-LEFT to its cell's top-left corner;
// widgets may overflow into neighbouring cells. `free`
// cells are those not covered by any item rect.
//
// Colour slots: null = inherit from theme. An explicit
// colour is { hex: "#rrggbb", alpha: 0–100 } (alpha default
// 100); normalization accepts plain "#hex" too.
//
// ======================================================

import { resolveTheme, normalizeThemeColor, mergeThemeOverrides } from "../themes.js";
import { resolveFont } from "../fonts.js";
import { createOverlayTextRenderer } from "../textRenderer.js";
import { defaultLabel, describeSource, isFlagSource, isPercentageSource } from "./valueFormat.js";

export const SCHEMA_VERSION = 2;

export const CANVAS_MIN = 64;
export const CANVAS_MAX = 7680;
export const GRID_COLS_MAX = 48;
export const GRID_ROWS_MAX = 27;

export const WIDGET_SIZES = { small: 120, med: 200, large: 280 };
export const BAR_DEFAULT_WIDTH = 13;
export const BAR_DEFAULT_HEIGHT = 200;
export const CARD_PADDING = 12;
export const ACCENT_WIDTH = 4;
export const CARD_RADIUS = 6;
export const LABEL_VALUE_GAP = 4;
export const CARD_MIN_WIDTH_MAX = 2048;

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 200;

const TEXT_ALIGNMENTS = ["stacked", "inline"];
const BAR_ORIENTATIONS = ["vertical", "horizontal"];
const MAX_MODES = ["percent", "flightMax", "dynamic"];
const ITEM_TYPES = ["stick", "text", "bar", "donut"];

export const DEFAULT_LAYOUT = () => ({
  version: SCHEMA_VERSION,
  canvas: { width: 1920, height: 1080 },
  grid: { cols: 12, rows: 6 },
  alpha: true,
  shadow: false,
  theme: "default",
  font: "vt323",
  themeOverrides: {},
  items: []
});

// ------------------------------------------------------
// Colour slots
// ------------------------------------------------------

function normalizeColorSlot(value, warnings, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = normalizeThemeColor(value);

  if (!normalized) {
    warnings.push(`${label}: invalid colour dropped (${JSON.stringify(value)})`);
    return null;
  }

  return normalized;
}

// ------------------------------------------------------
// Item factories
// ------------------------------------------------------

/** Default properties for a fresh item of `type`. */
export function itemDefaults(type) {
  switch (type) {
    case "stick":
      return {
        size: "med",
        xChannel: 0,
        yChannel: 1,
        showCaption: false,
        boxColor: null,
        crosshairColor: null,
        dotColor: null
      };

    case "text":
      return {
        source: "custom",
        customText: "Custom text",
        showLabel: false,
        alignment: "stacked",
        labelSize: null,
        labelColor: null,
        valueSize: null,
        valueColor: null,
        cardColor: null,
        cardMinWidth: null,
        accentColor: null
      };

    case "bar":
      return {
        source: "derived:motorPct",
        orientation: "vertical",
        width: BAR_DEFAULT_WIDTH,
        height: BAR_DEFAULT_HEIGHT,
        maxValue: { mode: "percent" },
        showLabel: false,
        labelOverride: null,
        labelSize: null,
        labelColor: null,
        trackColor: null,
        fillColor: null,
        cardColor: null,
        cardMinWidth: null,
        accentColor: null
      };

    case "donut":
      return {
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
        cardMinWidth: null,
        accentColor: null,
        maxValue: { mode: "flightMax" }
      };

    default:
      return {};
  }
}

/** A brand-new item the GUI can drop in. overrides may
 * carry col/row plus props (col/row are item-level). */
export function createItem(type, overrides = {}, at = null) {
  const { col, row, ...props } = overrides;
  const cell = at ?? (col !== undefined || row !== undefined
    ? { col: col ?? 0, row: row ?? 0 }
    : { col: 0, row: 0 });

  return {
    id: randomId(),
    type,
    col: cell.col,
    row: cell.row,
    props: { ...itemDefaults(type), ...props }
  };
}

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomId() {
  let id = "i";

  for (let i = 0; i < 7; i += 1) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }

  return id;
}

// ------------------------------------------------------
// Scalar clamps
// ------------------------------------------------------

function clampInt(value, min, max, fallback) {
  const num = Math.round(Number(value));

  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, num));
}

function canonicalSize(value, fallback) {
  const key = String(value ?? "").toLowerCase();

  if (key === "small" || key === "sm") return "small";
  if (key === "med" || key === "medium") return "med";
  if (key === "large" || key === "lg") return "large";

  return fallback;
}

function canonicalChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// ------------------------------------------------------
// Item normalization
// ------------------------------------------------------

function normalizeItem(raw, layout, warnings) {
  if (!raw || typeof raw !== "object") {
    warnings.push("item: dropped (not an object)");
    return null;
  }

  const type = raw.type;

  if (!ITEM_TYPES.includes(type)) {
    warnings.push(`item ${raw.id ?? "?"}: unknown type dropped (${type})`);
    return null;
  }

  const defaults = itemDefaults(type);
  const props = raw.props && typeof raw.props === "object" ? raw.props : {};
  const known = new Set(Object.keys(defaults));
  const item = {
    id: String(raw.id ?? "").slice(0, 32) || randomId(),
    type,
    col: 0,
    row: 0,
    props: {}
  };

  for (const key of Object.keys(props)) {
    if (key === "col" || key === "row" || key === "id" || key === "type") {
      continue;
    }

    if (!known.has(key)) {
      warnings.push(`item ${item.id}: unknown ${type} property dropped (${key})`);
    }
  }

  for (const [key, fallback] of Object.entries(defaults)) {
    const value = props[key] !== undefined ? props[key] : fallback;

    switch (key) {
      case "size":
        item.props.size = canonicalSize(value, fallback);
        break;

      case "xChannel":
      case "yChannel":
        item.props[key] = clampInt(value, 0, 4, fallback);
        break;

      case "showCaption":
      case "showLabel":
      case "showValue":
        item.props[key] = value === true;
        break;

      case "alignment":
        item.props.alignment = canonicalChoice(value, TEXT_ALIGNMENTS, fallback);
        break;

      case "orientation":
        item.props.orientation = canonicalChoice(value, BAR_ORIENTATIONS, fallback);
        break;

      case "width":
        item.props.width = clampInt(value, 2, 2048, fallback);
        break;

      case "height":
        item.props.height = clampInt(value, 2, 2048, fallback);
        break;

      case "labelSize":
      case "valueSize":
        item.props[key] = value === null || value === undefined
          ? null
          : clampInt(value, FONT_SIZE_MIN, FONT_SIZE_MAX, null);
        break;

      case "cardMinWidth":
        // null = auto-size from content; otherwise a floor in
        // px applied when the card is enabled.
        item.props.cardMinWidth = value === null || value === undefined
          ? null
          : clampInt(value, 0, CARD_MIN_WIDTH_MAX, null);
        break;

      case "boxColor":
      case "crosshairColor":
      case "dotColor":
      case "labelColor":
      case "valueColor":
      case "trackColor":
      case "fillColor":
      case "cardColor":
      case "accentColor":
        item.props[key] = normalizeColorSlot(
          value,
          warnings,
          `item ${item.id}.${key}`
        );
        break;

      case "customText":
        item.props.customText = String(value ?? fallback).slice(0, 500);
        break;

      case "labelOverride":
        item.props.labelOverride = value === null || value === undefined
          ? null
          : String(value).slice(0, 120);
        break;

      case "source":
        item.props.source = normalizeSource(value, item, warnings);
        break;

      case "maxValue":
        item.props.maxValue = normalizeMaxValue(value, fallback, warnings, item.id);
        break;

      default:
        item.props[key] = value;
        break;
    }
  }

  // Grid anchor clamps into bounds (the interview rule).
  item.col = clampInt(raw.col, 0, layout.grid.cols - 1, 0);
  item.row = clampInt(raw.row, 0, layout.grid.rows - 1, 0);

  return item;
}

function normalizeSource(value, item, warnings) {
  const id = value === undefined ? item.props.source : value;

  if (typeof id !== "string" || !(id === "custom" || describeSource(id))) {
    warnings.push(`item ${item.id}: unknown source dropped (${id}), using custom`);
    return "custom";
  }

  // Flags are text-only: a bar/donut bound to a flag is
  // coerced to a numeric default rather than silently
  // rendering nothing.
  if ((item.type === "bar" || item.type === "donut") && isFlagSource(id)) {
    warnings.push(`item ${item.id}: flag source not renderable as ${item.type}`);
    return item.type === "bar" ? "derived:motorPct" : "derived:rpm";
  }

  // Percentage lock (source-driven): percent mode forced on
  // the saved doc for percentage sources.
  if (
    item.type === "bar" || item.type === "donut"
  ) {
    if (isPercentageSource(id)) {
      return id;
    }
  }

  return id;
}

function normalizeMaxValue(value, type, warnings, id) {
  const mode = value && typeof value === "object" ? value.mode : value;

  if (!MAX_MODES.includes(mode)) {
    warnings.push(`item ${id}: unknown max mode dropped (${mode})`);
    return null;
  }

  return { mode };
}

// ------------------------------------------------------
// Geometry
// ------------------------------------------------------

export function cellSize(layout) {
  return {
    cellW: layout.canvas.width / layout.grid.cols,
    cellH: layout.canvas.height / layout.grid.rows
  };
}

export function cellOrigin(layout, col, row) {
  const { cellW, cellH } = cellSize(layout);

  return {
    x: Math.round(col * cellW),
    y: Math.round(row * cellH)
  };
}

/**
 * Free-cell scan: first cell (raster order) whose rect is
 * not covered by any existing item box. Returns the first
 * cell unconditionally when every cell is covered.
 */
export function firstFreeCell(layout, itemBoxes) {
  const { cellW, cellH } = cellSize(layout);

  const covers = (x, y) =>
    itemBoxes.some(
      (box) =>
        x < box.x + box.width &&
        x + cellW > box.x &&
        y < box.y + box.height &&
        y + cellH > box.y
    );

  for (let row = 0; row < layout.grid.rows; row += 1) {
    for (let col = 0; col < layout.grid.cols; col += 1) {
      const x = Math.round(col * cellW);
      const y = Math.round(row * cellH);

      if (!covers(x, y)) {
        return { col, row };
      }
    }
  }

  return { col: 0, row: 0 };
}

// ------------------------------------------------------
// Text measurement (auto-sized bounding boxes)
// ------------------------------------------------------

const rendererCache = new Map();

function rendererFor(fontId) {
  if (!rendererCache.has(fontId)) {
    rendererCache.set(fontId, createOverlayTextRenderer(fontId));
  }

  return rendererCache.get(fontId);
}

function inkHeight(renderer, sizeProp, rolePx) {
  const size = sizeProp ?? rolePx;

  if (renderer.source === "bitmap") {
    return 7 * Math.max(1, Math.round(size / 7));
  }

  return renderer.glyphCache(size).capHeightPx;
}

function measure(renderer, text, sizeProp, rolePx) {
  const size = sizeProp ?? rolePx;

  return renderer.measureText(text, size);
}

function textLabelFor(item) {
  if (item.type !== "text" && item.type !== "bar" && item.type !== "donut") {
    return null;
  }

  if (item.props.labelOverride !== undefined && item.props.labelOverride !== null) {
    return item.props.labelOverride;
  }

  if (item.props.source === "custom") {
    return null;
  }

  return defaultLabel(item.props.source);
}

function textStateFor(item) {
  const source = item.props.source;

  if (source === "custom") {
    return null;
  }

  if (isFlagSource(source)) {
    return "flag";
  }

  return "value";
}

/** Flag display text — the LONGER state sizes the box. */
function flagTexts(item) {
  const flags = {
    "derived:armed": ["ARMED", "DISARMED"],
    "derived:motorOn": ["MOTOR ON", "MOTOR OFF"],
    "derived:throttle": ["THROTTLE UP", "THROTTLE DOWN"]
  };
  const [on, off] = flags[item.props.source] ?? ["--", "--"];

  return { on, off };
}

// ------------------------------------------------------
// Bounding boxes (top-left anchored at the cell origin)
// ------------------------------------------------------

function sizePx(sizeKey) {
  return WIDGET_SIZES[sizeKey] ?? WIDGET_SIZES.med;
}

/** Card floor: when the item paints a card, a non-null
 * cardMinWidth widens the measured box so values stay inside
 * the card bounds (the paint pass fills the whole box). */
function cardMinWidthFloor(item) {
  if (!item.props.cardColor || item.props.cardMinWidth === null) {
    return 0;
  }

  return item.props.cardMinWidth;
}

function measureItemBox(item, layout, renderer, roleSizes) {
  const { x, y } = cellOrigin(layout, item.col, item.row);
  const { labelRolePx, valueRolePx } = roleSizes;
  const minW = cardMinWidthFloor(item);

  if (item.type === "stick") {
    const side = sizePx(item.props.size);
    const captionH = item.props.showCaption
      ? LABEL_VALUE_GAP +
        inkHeight(renderer, item.props.labelSize, labelRolePx)
      : 0;

    return { x, y, width: side, height: side + captionH };
  }

  if (item.type === "donut") {
    const side = sizePx(item.props.size);
    const labelH = item.props.showLabel && textLabelFor(item)
      ? LABEL_VALUE_GAP +
        inkHeight(renderer, item.props.labelSize, labelRolePx)
      : 0;

    return {
      x,
      y,
      width: Math.max(side, minW),
      height: side + labelH
    };
  }

  if (item.type === "bar") {
    const horizontal = item.props.orientation === "horizontal";
    const barW = horizontal ? item.props.width : item.props.width;
    const barH = horizontal ? item.props.height : item.props.height;
    const label = item.props.showLabel ? textLabelFor(item) : null;
    const labelH = label
      ? LABEL_VALUE_GAP +
        inkHeight(renderer, item.props.labelSize, labelRolePx)
      : 0;

    if (!label) {
      return { x, y, width: Math.max(barW, minW), height: barH };
    }

    const labelW = measure(renderer, label, item.props.labelSize, labelRolePx);

    return {
      x,
      y,
      width: Math.max(barW, Math.ceil(labelW) + CARD_PADDING * 2, minW),
      height: labelH + barH
    };
  }

  // text — auto-size via measurement
  if (item.props.source === "custom") {
    const lines = String(item.props.customText ?? "").split("\n");
    const size = item.props.valueSize ?? valueRolePx;
    let width = 0;

    for (const line of lines) {
      width = Math.max(width, measure(renderer, line, size, valueRolePx));
    }

    const lineH = inkHeight(renderer, size, valueRolePx);
    const innerH = Math.max(lineH, lines.length * Math.round(lineH * 1.25));

    return {
      x,
      y,
      width: Math.max(Math.ceil(width) + CARD_PADDING * 2, minW),
      height: innerH + CARD_PADDING * 2
    };
  }

  const label = item.props.showLabel ? textLabelFor(item) : null;
  const valueText = "--";
  const labelSize = item.props.labelSize;
  const valueSize = item.props.valueSize;
  const labelH = label
    ? inkHeight(renderer, labelSize, labelRolePx)
    : 0;
  const valueH = inkHeight(renderer, valueSize, valueRolePx);
  const labelW = label ? measure(renderer, label, labelSize, labelRolePx) : 0;
  const valueW = measure(renderer, valueText, valueSize, valueRolePx);

  let innerW;
  let innerH;

  if (label && item.props.alignment === "inline") {
    innerW = labelW + LABEL_VALUE_GAP + valueW;
    innerH = Math.max(labelH, valueH);
  } else if (label) {
    innerW = Math.max(labelW, valueW);
    innerH = labelH + LABEL_VALUE_GAP + valueH;
  } else {
    innerW = valueW;
    innerH = valueH;
  }

  return {
    x,
    y,
    width: Math.max(Math.ceil(innerW) + CARD_PADDING * 2, minW),
    height: innerH + CARD_PADDING * 2
  };
}

// ------------------------------------------------------
// Theme + font resolution used by measurement
// ------------------------------------------------------

function roleSizesFor(layout, theme) {
  const fonts = theme.fonts ?? {};

  return {
    labelRolePx: fonts.label?.size ?? 16,
    valueRolePx: fonts.value?.size ?? 22
  };
}

function applyThemeOverrides(baseTheme, overrides) {
  if (!overrides || typeof overrides !== "object") {
    return baseTheme;
  }

  // themes.js owns the merge rule (path-keyed overrides);
  // delegate so the semantics live in one place.
  return mergeThemeOverrides(baseTheme, overrides);
}

// ------------------------------------------------------
// normalizeLayout
// ------------------------------------------------------

export function normalizeLayout(rawDoc) {
  const warnings = [];
  const doc = rawDoc && typeof rawDoc === "object" ? rawDoc : {};
  const layout = DEFAULT_LAYOUT();

  if (doc.version !== undefined && doc.version !== SCHEMA_VERSION) {
    warnings.push(`version ${doc.version} normalized to ${SCHEMA_VERSION}`);
  }

  // Canvas: 64–7680, even.
  const width = clampInt(doc.canvas?.width, CANVAS_MIN, CANVAS_MAX, layout.canvas.width);
  const height = clampInt(doc.canvas?.height, CANVAS_MIN, CANVAS_MAX, layout.canvas.height);
  layout.canvas.width = width - (width % 2);
  layout.canvas.height = height - (height % 2);

  // Grid: 1–48 / 1–27.
  layout.grid.cols = clampInt(doc.grid?.cols, 1, GRID_COLS_MAX, layout.grid.cols);
  layout.grid.rows = clampInt(doc.grid?.rows, 1, GRID_ROWS_MAX, layout.grid.rows);

  layout.alpha = doc.alpha === undefined ? layout.alpha : doc.alpha === true;
  layout.shadow = doc.shadow === true;
  layout.theme =
    typeof doc.theme === "string" && doc.theme ? doc.theme : layout.theme;

  let themeResolved;

  try {
    themeResolved = resolveTheme(layout.theme);
  } catch {
    warnings.push(`unknown theme "${doc.theme}" → default`);
    layout.theme = "default";
    themeResolved = resolveTheme(layout.theme);
  }

  // Font family resolves early so measurement and painting
  // agree (and unknown ids fail loudly once).
  try {
    resolveFont(doc.font === undefined ? layout.font : doc.font);
    layout.font = doc.font === undefined ? layout.font : String(doc.font);
  } catch {
    warnings.push(`unknown font "${doc.font}" → ${layout.font}`);
  }

  layout.themeOverrides = normalizeThemeOverrides(
    doc.themeOverrides,
    themeResolved,
    warnings
  );

  // Theme with overrides, for role px sizes.
  const effectiveTheme = applyThemeOverrides(
    themeResolved,
    layout.themeOverrides
  );

  // Items.
  if (Array.isArray(doc.items)) {
    const seen = new Set();

    for (const raw of doc.items.slice(0, 256)) {
      const item = normalizeItem(raw, layout, warnings);

      if (!item) {
        continue;
      }

      if (seen.has(item.id)) {
        const fresh = randomId();

        warnings.push(`item id ${item.id} duplicated → ${fresh}`);
        item.id = fresh;
      }

      seen.add(item.id);
      layout.items.push(item);
    }

    if (doc.items.length > 256) {
      warnings.push(`items capped at 256 (${doc.items.length} given)`);
    }
  }

  // Bounding boxes (measurement needs the font + theme).
  const renderer = rendererFor(layout.font);
  const overridesMergedFonts = {
    label: effectiveFonts(effectiveTheme).label,
    value: effectiveFonts(effectiveTheme).value
  };
  const roleSizes = {
    labelRolePx: overridesMergedFonts.label.size,
    valueRolePx: overridesMergedFonts.value.size
  };

  const boxes = new Map();

  for (const item of layout.items) {
    boxes.set(
      item.id,
      measureItemBox(item, layout, renderer, roleSizes)
    );
  }

  return { layout, boxes, warnings };
}

function effectiveFonts(theme) {
  const fonts = theme.fonts ?? {};

  return {
    label: { size: fonts.label?.size ?? 16, color: fonts.label?.color ?? "#202020" },
    value: { size: fonts.value?.size ?? 22, color: fonts.value?.color ?? "#101010" }
  };
}

function normalizeThemeOverrides(raw, baseTheme, warnings) {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  // Path-keyed: { "stick.dot": "#00FF88" | {hex, alpha} }.
  const out = {};

  for (const [path, value] of Object.entries(raw)) {
    const target = resolveThemePath(baseTheme, path);

    if (!target) {
      warnings.push(`theme override path dropped: ${path}`);
      continue;
    }

    const normalized = normalizeThemeColor(value);

    if (!normalized) {
      warnings.push(`theme override dropped (bad colour): ${path}`);
      continue;
    }

    out[path] = normalized;
  }

  return out;
}

/**
 * Which override paths exist on a theme (mirror of the
 * theme structure): anything addressable via walkThemePath.
 */
function resolveThemePath(theme, path) {
  const parts = path.split(".");

  let node = theme;

  for (const part of parts) {
    if (node === null || typeof node !== "object" || !(part in node)) {
      return null;
    }

    node = node[part];
  }

  return typeof node === "string" || (node && typeof node === "object")
    ? node
    : null;
}

export { applyThemeOverrides, resolveThemePath };