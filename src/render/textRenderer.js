// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TEXT RENDER FACADE
// ======================================================
//
// The single text API the overlay paints with. Two backends
// hide behind one interface:
//
//   ttf     — registry font resolved to a static instance,
//             rasterized by fontRaster.js, cached per
//             (font, weight, size)
//   bitmap  — the original 5x7 font (bitmapFont.js), still
//             selectable as registry id "bitmap"
//
// Baseline semantics: drawText's y is the TOP of the cap
// line — matching the bitmap font's y-is-top behavior — and
// the TTF backend derives the baseline internally from the
// face's cap height. Families align visually without the
// overlay layout knowing.
//
// Shadows: optional hard drop shadow, offset proportional to
// text size, drawn first in shadowColor. Glyph coverage
// composites src-over with straight alpha, so AA fringes
// carry partial alpha in editor-keyable alpha renders.
//
// ======================================================

import { pixelText, measureText as measureBitmapText } from "./bitmapFont.js";
import { GlyphCache } from "./fontRaster.js";
import {
  TYPOGRAPHY,
  resolveFont,
  nearestWeight,
  fontFilePath
} from "./fonts.js";

// Glyph caches per "fontId|weight|sizePx".
const ttfCaches = new Map();

/** Test hook: drop all renderer/glyph caches. */
export function clearTextCaches() {
  ttfCaches.clear();
}

/**
 * A draw call's sizing argument is either a raw number or a
 * role object ({size, bitmapScale}) — the TTF backend reads
 * `size`, the bitmap backend reads `bitmapScale`. This keeps
 * role semantics per-backend without the overlay caring.
 */
function roleSize(sizing) {
  if (sizing && typeof sizing === "object") {
    return sizing.size ?? 0;
  }

  return sizing ?? 0;
}

function roleScale(sizing) {
  if (sizing && typeof sizing === "object") {
    return sizing.bitmapScale ?? 1;
  }

  return Math.max(1, Math.round((sizing ?? 0) / 7));
}

/**
 * Role-aware renderer the overlay paints with. Built from a
 * registry font id; roles (label/value) come from TYPOGRAPHY
 * with per-font metric compensation applied.
 */
export function createOverlayTextRenderer(fontName) {
  const fontDef = resolveFont(fontName);

  const renderer =
    fontDef.source === "bitmap"
      ? createBitmapRenderer(fontDef)
      : createTtfRenderer(fontDef);

  for (const [roleName, role] of Object.entries(TYPOGRAPHY)) {
    renderer.roles[roleName] = {
      size: renderer.resolveSize(role.sizePx),
      weight: fontDef.source === "bitmap"
        ? null
        : nearestWeight(fontDef, role.weight),
      bitmapScale: role.bitmapScale
    };
  }

  /**
   * Ink height of a role in px — line-stride math only.
   * Bitmap: 7 rows x the role's scale. TTF: cap height at
   * the role's size.
   */
  renderer.roleInkHeight = (roleName) => {
    const role = renderer.roles[roleName];

    if (fontDef.source === "bitmap") {
      return 7 * role.bitmapScale;
    }

    return renderer.glyphCache(role.size).capHeightPx;
  };

  return renderer;
}

// ------------------------------------------------------
// TTF backend
// ------------------------------------------------------

function createTtfRenderer(fontDef) {
  const metrics = fontDef.metrics ?? {};
  const defaultWeight = TYPOGRAPHY.value.weight;

  // The overlay never varies weights within a frame — one
  // static instance per (font, weight) is plenty.
  const { path } = fontFilePath(fontDef, defaultWeight);
  const resolvedWeight = nearestWeight(fontDef, defaultWeight);

  const cacheFor = (sizePx) => {
    const key = `${fontDef.id}|${resolvedWeight}|${sizePx}`;

    if (!ttfCaches.has(key)) {
      ttfCaches.set(key, new GlyphCache(path, sizePx));
    }

    return ttfCaches.get(key);
  };

  const renderer = {
    source: "ttf",
    font: fontDef,
    roles: {},

    /** Role base px size adjusted by the family multiplier. */
    resolveSize(baseSizePx) {
      return Math.max(
        8,
        Math.round(baseSizePx * (metrics.sizeMultiplier ?? 1))
      );
    },

    glyphCache(sizePx) {
      return cacheFor(sizePx);
    },

    measureText(text, sizeOrRole, tracking = metrics.tracking ?? 0) {
      const sizePx = roleSize(sizeOrRole);

      if (!text) {
        return 0;
      }

      const cache = cacheFor(sizePx);

      let width = 0;

      for (const char of String(text)) {
        width += cache.advanceOf(char) + tracking;
      }

      return Math.max(0, width - tracking);
    },

    /**
     * Draw text at (x, y = top of cap line) in color. Returns
     * the advance width, so callers can chain after the text
     * (the LABEL_GAP math in gimbalFrame.js).
     * options2.shadowColor draws a hard drop shadow first,
     * offset proportional to the glyph size.
     */
    drawText(frame, width, height, x, y, text, color, sizeOrRole, options2 = {}) {
      const sizePx = roleSize(sizeOrRole);

      if (!text) {
        return 0;
      }

      const cache = cacheFor(sizePx);
      const tracking =
        options2.tracking !== undefined
          ? options2.tracking
          : metrics.tracking ?? 0;
      const shadowColor = options2.shadowColor ?? null;
      const shadowOffset = Math.max(1, Math.round(sizePx / 11));
      const baseline = y + cache.capHeightPx + (metrics.baselineOffset ?? 0);

      const drawPass = (ox, oy, drawColor) => {
        let cursorX = x;

        for (const char of String(text)) {
          const glyph = cache.get(char);

          if (glyph) {
            blitGlyph(
              frame,
              width,
              height,
              glyph,
              Math.round(cursorX + glyph.left) + ox,
              // glyph.top is measured up from the baseline but
              // stored negative (pixel-space y-down), so the
              // glyph's first bitmap row lands at baseline+top.
              Math.round(baseline + glyph.top) + oy,
              drawColor
            );
          }

          cursorX += cache.advanceOf(char) + tracking;
        }
      };

      if (shadowColor) {
        drawPass(shadowOffset, shadowOffset, shadowColor);
      }

      drawPass(0, 0, color);

      return renderer.measureText(text, sizePx, tracking);
    }
  };

  return renderer;
}

/**
 * Coverage blit: solid core paints flat, partial coverage
 * blends src-over (straight alpha) so anti-aliased edges mix
 * with whatever is beneath — including transparent.
 */
function blitGlyph(frame, width, height, glyph, x, y, color) {
  for (let row = 0; row < glyph.height; row += 1) {
    const py = y + row;

    if (py < 0 || py >= height) {
      continue;
    }

    const rowBase = row * glyph.width;

    for (let col = 0; col < glyph.width; col += 1) {
      const px = x + col;

      if (px < 0 || px >= width) {
        continue;
      }

      const coverage = glyph.bitmap[rowBase + col];

      if (coverage === 0) {
        continue;
      }

      blendCoverage(frame, width, px, py, color, coverage / 255);
    }
  }
}

/** Src-over blend of one pixel at fractional alpha (0..1). */
function blendCoverage(frame, frameWidth, x, y, color, alpha) {
  const offset = (y * frameWidth + x) * 4;
  const srcA = Math.max(0, Math.min(1, alpha));

  if (srcA <= 0) {
    return;
  }

  const dstA = frame[offset + 3] / 255;
  const dstWeight = dstA * (1 - srcA);
  const outA = srcA + dstWeight;

  if (outA <= 0) {
    return;
  }

  frame[offset] = Math.round((color[0] * srcA + frame[offset] * dstWeight) / outA);
  frame[offset + 1] = Math.round((color[1] * srcA + frame[offset + 1] * dstWeight) / outA);
  frame[offset + 2] = Math.round((color[2] * srcA + frame[offset + 2] * dstWeight) / outA);
  frame[offset + 3] = Math.round(outA * 255);
}

// ------------------------------------------------------
// Bitmap backend (the original 5x7 pixel font)
// ------------------------------------------------------

function createBitmapRenderer(fontDef) {
  const renderer = {
    source: "bitmap",
    font: fontDef,
    roles: {},

    /** Bitmap roles use integer scales, not px sizes. */
    resolveSize() {
      return 0;
    },

    measureText(text, scaleOrRole, tracking = 0) {
      return measureBitmapText(text, roleScale(scaleOrRole));
    },

    drawText(frame, width, height, x, y, text, color, scaleOrRole, options2 = {}) {
      return pixelText(
        frame,
        width,
        height,
        x,
        y,
        text,
        color,
        roleScale(scaleOrRole),
        options2.shadowColor ?? null
      );
    }
  };

  return renderer;
}