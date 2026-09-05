// ======================================================
// Blackbox-Overlay — COLOR THEMES (v2)
// ======================================================
//
// v2 themes are STRUCTURAL DEFAULTS for the layout engine,
// not a palette of widget-specific keys. Every widget colour
// property resolves: item value → theme slot → fallback.
//
// Theme structure (one per named theme):
//
//   background   opaque-render backdrop (alpha mode leaves
//               the canvas transparent instead)
//   textShadow   drop-shadow colour under glyphs
//   fonts.label  { size, color } label typography defaults
//   fonts.value  { size, color } value typography defaults
//   card.accent  left accent stripe default (null = none)
//   stick.box    gimbal square fill
//   stick.crosshair  axis lines inside the gimbal
//   stick.dot    stick-position dot
//   bar.track    progress-bar track
//   bar.fill     progress-bar fill
//   donut.track  donut track ring
//   donut.fill   donut value arc
//
// A colour slot is "#rrggbb"/"#rgb" (alpha 100) or
// { hex, alpha } (alpha 0–100). `null` card.color means no
// card is painted by default.
//
// ======================================================

function hex(color) {
  return {
    hex: `#${color.replace("#", "").padStart(6, "0").toLowerCase()}`,
    alpha: 100,
  };
}

function theme(values) {
  return {
    background: hex(values.background),
    textShadow: hex(values.textShadow),
    fonts: {
      label: { size: values.labelSize, color: hex(values.labelColor) },
      value: { size: values.valueSize, color: hex(values.valueColor) },
    },
    card: {
      color: null,
      // The accent stripe defaults to the value colour so the
      // card reads as part of the theme before any override.
      accent: hex(values.valueColor),
    },
    stick: {
      box: hex(values.box),
      crosshair: hex(values.crosshair),
      dot: hex(values.dot),
    },
    bar: { track: hex(values.track), fill: hex(values.fill) },
    donut: { track: hex(values.donutTrack), fill: hex(values.donutFill) },
  };
}

export const THEME_NAMES = [
  "default",
  "light",
  "gunmetal",
  "charcoal",
  "slate",
  "lime",
];

export const THEMES = {
  // Original palette — sage + crimson
  default: theme({
    background: "#C6D8D3",
    textShadow: "#E8F0ED",
    labelSize: 15,
    labelColor: "#34413D",
    valueSize: 22,
    valueColor: "#E83E63",
    box: "#343D3A",
    crosshair: "#7F8C87",
    dot: "#E83E63",
    track: "#B9C2BB",
    fill: "#E83E63",
    donutTrack: "#B9C2BB",
    donutFill: "#E83E63",
  }),

  // Paper-white light theme — blue accent
  light: theme({
    background: "#F1F3F5",
    textShadow: "#FFFFFF",
    labelSize: 15,
    labelColor: "#4B5560",
    valueSize: 22,
    valueColor: "#1677C8",
    box: "#30363D",
    crosshair: "#9AA3AC",
    dot: "#1677C8",
    track: "#DADCE0",
    fill: "#1677C8",
    donutTrack: "#DADCE0",
    donutFill: "#1677C8",
  }),

  // Gunmetal + electric cyan
  gunmetal: theme({
    background: "#B8C5C8",
    textShadow: "#E8EFF1",
    labelSize: 15,
    labelColor: "#273238",
    valueSize: 22,
    valueColor: "#00C8F0",
    box: "#252C31",
    crosshair: "#68777E",
    dot: "#00C8F0",
    track: "#8FA3A6",
    fill: "#00C8F0",
    donutTrack: "#8FA3A6",
    donutFill: "#00C8F0",
  }),

  // Charcoal + aviation amber
  charcoal: theme({
    background: "#BFC8C2",
    textShadow: "#E7ECE9",
    labelSize: 15,
    labelColor: "#29332F",
    valueSize: 22,
    valueColor: "#FFB000",
    box: "#292D2B",
    crosshair: "#66716B",
    dot: "#FFB000",
    track: "#9AA69D",
    fill: "#FFB000",
    donutTrack: "#9AA69D",
    donutFill: "#FFB000",
  }),

  // Slate + magenta
  slate: theme({
    background: "#C3CDD1",
    textShadow: "#E8EDF0",
    labelSize: 15,
    labelColor: "#293239",
    valueSize: 22,
    valueColor: "#F04F88",
    box: "#30373C",
    crosshair: "#707C83",
    dot: "#F04F88",
    track: "#9AA6AC",
    fill: "#F04F88",
    donutTrack: "#9AA6AC",
    donutFill: "#F04F88",
  }),

  // Black + lime — aggressive motorsport
  lime: theme({
    background: "#C8D0CC",
    textShadow: "#E9EEEC",
    labelSize: 15,
    labelColor: "#26302A",
    valueSize: 22,
    valueColor: "#B8F500",
    box: "#202522",
    crosshair: "#5D6861",
    dot: "#B8F500",
    track: "#A9B2AA",
    fill: "#B8F500",
    donutTrack: "#A9B2AA",
    donutFill: "#B8F500",
  }),
};

/**
 * "#rgb"/"#rrggbb"/{hex,alpha} → { hex: "#rrggbb", alpha }.
 * null/undefined passes through (inherit). Malformed input
 * returns null so callers can drop it with a warning.
 */
export function normalizeThemeColor(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "object") {
    const hexPart = normalizeHex(value.hex);
    const alpha = Math.round(Number(value.alpha));

    if (!hexPart || !Number.isFinite(alpha)) {
      return null;
    }

    return { hex: hexPart, alpha: Math.min(100, Math.max(0, alpha)) };
  }

  const hexPart = normalizeHex(value);

  return hexPart ? { hex: hexPart, alpha: 100 } : null;
}

function normalizeHex(value) {
  if (typeof value !== "string") {
    return null;
  }

  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);

  if (short) {
    const [r, g, b] = [short[1], short[2], short[3]];

    return `#${(r + r + g + g + b + b).toLowerCase()}`;
  }

  const long = value.match(/^#([0-9a-f]{6})$/i);

  return long ? `#${long[1].toLowerCase()}` : null;
}

/** Colour slot → [r, g, b, a(0–255)] for the painters. */
export function colorOf(slot, fallback = "#202020") {
  const normalized = normalizeThemeColor(slot) ?? normalizeThemeColor(fallback);

  if (!normalized) {
    return [0, 0, 0, 255];
  }

  const h = normalized.hex;

  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
    Math.round((normalized.alpha / 100) * 255),
  ];
}

/** True when the path exists on the theme structure. */
export function themeHasPath(theme, path) {
  let node = theme;

  for (const part of String(path).split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) {
      return false;
    }

    node = node[part];
  }

  return node !== undefined && node !== null
    ? true
    : // A slot whose default is null (card.color) still exists.
      Object.values(node ?? {}).length === 0;
}

/** Read a colour slot at a path; null when absent. */
export function themeColorAt(theme, path) {
  let node = theme;

  for (const part of String(path).split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) {
      return null;
    }

    node = node[part];
  }

  return node ?? null;
}

/**
 * Path-keyed overrides onto a base theme:
 *   { "stick.dot": "#00FF88" | {hex, alpha},
 *     "fonts.label.size": 18 }  (number sizes allowed)
 * Unknown paths, malformed colours, and bad sizes are
 * ignored. Null values keep the base default. Returns a
 * NEW theme; the base is never mutated.
 */
export function mergeThemeOverrides(baseTheme, overrides) {
  if (!overrides || typeof overrides !== "object") {
    return baseTheme;
  }

  const merged = structuredClone(baseTheme);

  for (const [path, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) {
      continue;
    }

    // The slot must EXIST on the base (even if null, like
    // card.*), walking every segment.
    if (!pathExists(baseTheme, path)) {
      continue;
    }

    const parts = String(path).split(".");

    if (parts[parts.length - 1] === "size") {
      const size = Math.round(Number(value));

      if (Number.isFinite(size)) {
        assignPath(merged, path, Math.min(200, Math.max(8, size)));
      }

      continue;
    }

    const leaf = normalizeThemeColor(value);

    if (leaf) {
      assignPath(merged, path, leaf);
    }
  }

  return merged;
}

function pathExists(root, path) {
  let node = root;

  for (const part of String(path).split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) {
      return false;
    }

    node = node[part];
  }

  return true;
}

function assignPath(root, path, value) {
  const parts = String(path).split(".");
  let node = root;

  for (let i = 0; i < parts.length - 1; i += 1) {
    node = node[parts[i]];
  }

  node[parts[parts.length - 1]] = value;
}

/**
 * Hex-string map of every colour slot, for the GUI's
 * swatches: { "stick.dot": "#ee4266", ... }. Null slots
// (card color) are omitted.
 */
export function themeColorMap(theme) {
  const out = {};

  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value && typeof value === "object") {
        if ("hex" in value) {
          if (value.hex !== null) {
            out[path] = value.hex;
          }
        } else if (!Array.isArray(value)) {
          walk(value, path);
        }
      }
    }
  };

  walk(theme, "");

  return out;
}

/**
 * Resolve a theme by name (case-insensitive). Unknown names
 * throw with the valid options listed.
 */
export function resolveTheme(name) {
  if (!name) {
    return structuredClone(THEMES.default);
  }

  const key = String(name).toLowerCase();

  if (!THEME_NAMES.includes(key)) {
    throw new Error(
      `Unknown theme "${name}". Valid themes: ${THEME_NAMES.join(", ")}`,
    );
  }

  return structuredClone(THEMES[key]);
}
