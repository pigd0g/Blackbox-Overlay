// ======================================================
// RotorFlight-Blackbox-Video-Overlay — COLOR THEMES (v2)
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
    alpha: 100
  };
}

function theme(values) {
  return {
    background: hex(values.background),
    textShadow: hex(values.textShadow),
    fonts: {
      label: { size: values.labelSize, color: hex(values.labelColor) },
      value: { size: values.valueSize, color: hex(values.valueColor) }
    },
    card: { color: null, accent: null },
    stick: {
      box: hex(values.box),
      crosshair: hex(values.crosshair),
      dot: hex(values.dot)
    },
    bar: { track: hex(values.track), fill: hex(values.fill) },
    donut: { track: hex(values.donutTrack), fill: hex(values.donutFill) }
  };
}

export const THEME_NAMES = [
  "default",
  "light",
  "gunmetal",
  "charcoal",
  "slate",
  "lime"
];

export const THEMES = {
  // The original palette, re-inked: dark ink labels, near-
  // black values, the crimson dot, green fills.
  default: theme({
    background: "#C6D8D3",
    textShadow: "#F2F2F2",
    labelSize: 15,
    labelColor: "#3E4A46",
    valueSize: 22,
    valueColor: "#14201C",
    box: "#404040",
    crosshair: "#92898A",
    dot: "#EE4266",
    track: "#B9C2BB",
    fill: "#2E7D32",
    donutTrack: "#B9C2BB",
    donutFill: "#2E7D32"
  }),

  // Paper-white light theme: white text on pale gray.
  light: theme({
    background: "#E8EAED",
    textShadow: "#4C4D4D",
    labelSize: 15,
    labelColor: "#FFFFFF",
    valueSize: 22,
    valueColor: "#FFFFFF",
    box: "#404040",
    crosshair: "#B0B3B8",
    dot: "#EE4266",
    track: "#DADCE0",
    fill: "#05FF6D",
    donutTrack: "#DADCE0",
    donutFill: "#005FEE"
  }),

  // Gunmetal + electric cyan.
  gunmetal: theme({
    background: "#B8C7C9",
    textShadow: "#F2F2F2",
    labelSize: 15,
    labelColor: "#172025",
    valueSize: 22,
    valueColor: "#0E1418",
    box: "#252A2E",
    crosshair: "#65727A",
    dot: "#00D9FF",
    track: "#8FA3A6",
    fill: "#00AFC7",
    donutTrack: "#8FA3A6",
    donutFill: "#E07C06"
  }),

  // Charcoal + amber — aviation instrumentation.
  charcoal: theme({
    background: "#C2CBC5",
    textShadow: "#F2F2F2",
    labelSize: 15,
    labelColor: "#1F2422",
    valueSize: 22,
    valueColor: "#14181C",
    box: "#292C2B",
    crosshair: "#68716D",
    dot: "#FFB000",
    track: "#9AA69D",
    fill: "#4F8A4B",
    donutTrack: "#9AA69D",
    donutFill: "#E69400"
  }),

  // Slate + magenta — modern FPV.
  slate: theme({
    background: "#C4D0D4",
    textShadow: "#F2F2F2",
    labelSize: 15,
    labelColor: "#20272B",
    valueSize: 22,
    valueColor: "#141A1E",
    box: "#30363A",
    crosshair: "#727D83",
    dot: "#FF4F8B",
    track: "#9AA6AC",
    fill: "#3D9B78",
    donutTrack: "#9AA6AC",
    donutFill: "#D96A42"
  }),

  // Black + lime — aggressive motorsport.
  lime: theme({
    background: "#CBD3CF",
    textShadow: "#F2F2F2",
    labelSize: 15,
    labelColor: "#18201A",
    valueSize: 22,
    valueColor: "#101614",
    box: "#202522",
    crosshair: "#59615C",
    dot: "#B7FF00",
    track: "#A9B2AA",
    fill: "#78B82A",
    donutTrack: "#A9B2AA",
    donutFill: "#F08C1C"
  })
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
    Math.round((normalized.alpha / 100) * 255)
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
      `Unknown theme "${name}". Valid themes: ${THEME_NAMES.join(", ")}`
    );
  }

  return structuredClone(THEMES[key]);
}