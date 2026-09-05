// ======================================================
// Blackbox-Overlay — FONT REGISTRY
// ======================================================
//
// Single source of truth for the overlay's typefaces. Every
// selectable font — including the original 5x7 bitmap — is a
// registry entry; the overlay never knows which one answers.
//
// Weights resolve to STATIC instance files (fonts/*/static/*
// where available), never to the variable-font files: the
// from-scratch engine reads plain glyf outlines, so requesting
// e.g. weight 600 from Geist snaps to Geist-SemiBold.ttf.
// Per-font `metrics` compensate for each family's proportions
// without touching overlay layout code:
//
//   sizeMultiplier  scales role px sizes (perceived size)
//   baselineOffset  px nudge applied after baseline calc
//   tracking        extra px between glyphs (negative = tighter)
//
// Paths resolve from this module's URL — NOT the process cwd —
// so the CLI, GUI server, and npm-global installs all work.
//
// ======================================================

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_DIR = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_FONT = "vt323";

/**
 * Role typography: what the overlay asks for, regardless of
 * font. TTF roles are pixel sizes; the bitmap backend maps
 * its classic integer scales (label 2 → 10x14, value 3 →
 * 15x21 per glyph). Default weights snap to whatever the
 * selected family ships (VT323 has only 400).
 */
export const TYPOGRAPHY = {
  label: { sizePx: 15, bitmapScale: 2, weight: 400 },
  value: { sizePx: 22, bitmapScale: 3, weight: 600 }
};

const FONT_DIR = (...segments) => join(REGISTRY_DIR, "..", "..", "fonts", ...segments);

const FONTS = {
  // ---- Default: retro CRT terminal look -------------------
  vt323: {
    id: "vt323",
    name: "VT323",
    source: "ttf",
    weights: { 400: "VT323/VT323-Regular.ttf" },
    metrics: { sizeMultiplier: 1.25, baselineOffset: 0, tracking: 0.5 }
  },

  // ---- The original 5x7 bitmap font -----------------------
  bitmap: {
    id: "bitmap",
    name: "Bitmap 5x7",
    source: "bitmap",
    weights: {},
    metrics: { sizeMultiplier: 1, baselineOffset: 0, tracking: 0 }
  },

  // ---- Clean / professional -------------------------------
  geist: {
    id: "geist",
    name: "Geist",
    source: "ttf",
    weights: {
      100: "Geist/static/Geist-Thin.ttf",
      200: "Geist/static/Geist-ExtraLight.ttf",
      300: "Geist/static/Geist-Light.ttf",
      400: "Geist/static/Geist-Regular.ttf",
      500: "Geist/static/Geist-Medium.ttf",
      600: "Geist/static/Geist-SemiBold.ttf",
      700: "Geist/static/Geist-Bold.ttf",
      800: "Geist/static/Geist-ExtraBold.ttf",
      900: "Geist/static/Geist-Black.ttf"
    },
    metrics: { sizeMultiplier: 1, baselineOffset: 0, tracking: 0 }
  },

  // ---- Futuristic FPV / HUD -------------------------------
  orbitron: {
    id: "orbitron",
    name: "Orbitron",
    source: "ttf",
    weights: {
      400: "Orbitron/static/Orbitron-Regular.ttf",
      500: "Orbitron/static/Orbitron-Medium.ttf",
      600: "Orbitron/static/Orbitron-SemiBold.ttf",
      700: "Orbitron/static/Orbitron-Bold.ttf",
      800: "Orbitron/static/Orbitron-ExtraBold.ttf",
      900: "Orbitron/static/Orbitron-Black.ttf"
    },
    metrics: { sizeMultiplier: 0.9, baselineOffset: 0, tracking: 0 }
  },

  // ---- Aggressive / sporty --------------------------------
  audiowide: {
    id: "audiowide",
    name: "Audiowide",
    source: "ttf",
    weights: { 400: "Audiowide/Audiowide-Regular.ttf" },
    metrics: { sizeMultiplier: 0.88, baselineOffset: 0, tracking: 0 }
  },

  // ---- Technical telemetry / instrumentation --------------
  spacemono: {
    id: "spacemono",
    name: "Space Mono",
    source: "ttf",
    weights: {
      400: "Space_Mono/SpaceMono-Regular.ttf",
      700: "Space_Mono/SpaceMono-Bold.ttf"
    },
    metrics: { sizeMultiplier: 1, baselineOffset: 0, tracking: 0 }
  },

  // ---- Futuristic / experimental --------------------------
  zendots: {
    id: "zendots",
    name: "Zen Dots",
    source: "ttf",
    weights: { 400: "Zen_Dots/ZenDots-Regular.ttf" },
    metrics: { sizeMultiplier: 0.82, baselineOffset: 0, tracking: 0 }
  }
};

export const FONT_IDS = Object.keys(FONTS);

/**
 * Resolve a font id (case-insensitive). Unknown ids throw
 * with the valid options listed — same contract as
 * resolveTheme().
 */
export function resolveFont(name) {
  if (!name) {
    return FONTS[DEFAULT_FONT];
  }

  const key = String(name).toLowerCase();

  if (!FONT_IDS.includes(key)) {
    throw new Error(
      `Unknown font "${name}". Valid fonts: ${FONT_IDS.join(", ")}`
    );
  }

  return FONTS[key];
}

/** Registry entry for the default font. */
export function defaultFont() {
  return FONTS[DEFAULT_FONT];
}

/**
 * Nearest available weight, CSS font-matching style: above
 * 500 prefer heavier, otherwise lighter first.
 */
export function nearestWeight(fontDef, requested) {
  const weights = Object.keys(fontDef.weights)
    .map(Number)
    .sort((a, b) => a - b);

  if (weights.length === 0) {
    return null; // bitmap backend ignores weights
  }

  if (weights.includes(requested)) {
    return requested;
  }

  const wanted = Number(requested) || TYPOGRAPHY.value.weight;

  if (wanted > 500) {
    for (const weight of weights) {
      if (weight >= wanted) return weight;
    }

    return weights[weights.length - 1];
  }

  for (const weight of [...weights].reverse()) {
    if (weight <= wanted) return weight;
  }

  return weights[0];
}

/**
 * Absolute path of the static file for a font + weight.
 * Throws when the family has no TTF files at all (bitmap) or
 * the mapped file is missing from fonts/.
 */
export function fontFilePath(fontDef, requestedWeight) {
  if (fontDef.source !== "ttf") {
    throw new Error(`Font "${fontDef.id}" is not file-backed`);
  }

  const weight = nearestWeight(fontDef, requestedWeight) ?? 400;
  const relative = fontDef.weights[weight];

  const absolute = FONT_DIR(relative);

  if (!existsSync(absolute)) {
    throw new Error(
      `Font file missing for ${fontDef.id} (wght ${weight}): ${absolute}`
    );
  }

  return { path: absolute, weight, matched: nearestWeight(fontDef, weight) === weight };
}

/**
 * Catalog for the GUI: ids in registry order, display names,
 * the default id, and a relative path per weight for the
 * browser to @font-face.
 */
export function fontCatalog() {
  const fonts = {};

  for (const fontDef of Object.values(FONTS)) {
    fonts[fontDef.id] = {
      name: fontDef.name,
      source: fontDef.source,
      default: fontDef.id === DEFAULT_FONT,
      weights: Object.fromEntries(
        Object.entries(fontDef.weights).map(([weight, relative]) => [
          String(weight),
          `fonts/${relative.split("\\").join("/")}`
        ])
      )
    };
  }

  return { ids: [...FONT_IDS], default: DEFAULT_FONT, fonts };
}