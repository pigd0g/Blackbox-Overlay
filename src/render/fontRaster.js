// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GLYPH RASTERIZER
// ======================================================
//
// Turns parsed TrueType outlines (fontEngine.js) into
// anti-aliased grayscale coverage masks:
//
//   contours (font units)
//     → transform to pixel space (y down)
//     → flatten quadratic B-splines to line segments
//       (implied on-curve midpoints, stb_truetype style)
//     → scanline fill: 4 vertical sub-samples per pixel row,
//       nonzero winding, fractional span endpoints
//     → 0..255 coverage bytes
//
// GlyphCache rasterizes lazily per character and keeps each
// glyph entry forever — the overlay draws a few dozen glyphs
// per frame, so steady-state cost is mask blitting only.
//
// Glyph geometry contract (pixel space):
//   left  = glyph bitmap x relative to the pen position
//   top   = glyph bitmap y relative to the BASELINE (up = +)
//   bitmap is width x height coverage bytes
//
// ======================================================

import { loadTtfFont } from "./fontEngine.js";

// Vertical sub-samples per pixel row for edge anti-aliasing.
const SUB_ROWS = 4;

// Quadratic curve subdivision counts the same regardless of
// pixel size — glyphs here render at 14-30 px, where 8 flat
// steps per Bézier is visually indistinguishable from exact.
const CURVE_STEPS = 8;

/**
 * One rasterized glyph:
 *   { width, height, left, top, advance, bitmap }
 * bitmap is a Uint8Array of coverage (0..255), row-major.
 * All values in pixels; advance includes letter-spacing 0.
 */
export class GlyphCache {
  constructor(faceOrPath, sizePx) {
    this.face =
      typeof faceOrPath === "string"
        ? loadTtfFont(faceOrPath)
        : faceOrPath;

    this.sizePx = Math.max(1, Math.round(sizePx));

    // Effective scale: registry metrics are folded in by the
    // caller via the size it requests (see textRenderer.js).
    this.scale = this.sizePx / this.face.unitsPerEm;

    // Cap height of "H" — the stable top-left anchor the
    // overlay aligns text with (bitmap-font semantics).
    this.capHeightPx = Math.max(
      1,
      Math.round(this.measureCapHeight() * this.scale)
    );

    this.ascentPx = Math.round(this.face.ascent * this.scale);
    this.cache = new Map();
  }

  measureCapHeight() {
    const gid = this.face.glyphId("H");

    if (!gid) {
      // Fallback: conventional cap height ≈ 0.7 em.
      return this.face.unitsPerEm * 0.7;
    }

    let maxY = -Infinity;

    for (const contour of this.face.outline(gid)) {
      for (const point of contour) {
        if (point.y > maxY) {
          maxY = point.y;
        }
      }
    }

    return Number.isFinite(maxY) ? maxY : this.face.unitsPerEm * 0.7;
  }

  /** Advance width of one character in pixels. */
  advanceOf(char) {
    const advance = this.face.advance(char) * this.scale;

    // .notdef / unknown: give space-like breathing room so
    // missing glyphs behave like blanks, never zero-width.
    if (advance <= 0) {
      return this.face.glyphId(char) === 0 ? this.sizePx * 0.3 : 0;
    }

    return advance;
  }

  /**
   * Rasterize (or fetch) one character. Returns null when the
   * glyph has no ink (space) — callers still advance.
   */
  get(char) {
    const key = char;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const glyphId = this.face.glyphId(char);

    let entry = null;

    if (glyphId > 0) {
      const advance = this.advanceOf(char);
      const segments = flattenGlyph(this.face, glyphId, this.scale);

      if (segments.length > 0) {
        const { bitmap, width, height, left, top } =
          rasterizeSegments(segments);

        entry = { bitmap, width, height, left, top, advance };
      }
    }

    if (this.cache.size > 512) {
      this.cache.clear(); // defensive: never grow unbounded
    }

    this.cache.set(key, entry);

    return entry;
  }
}

/**
 * Flatten every contour of a glyph into pixel-space segments.
 * Returns a flat array [x0, y0, x1, y1, ...].
 */
function flattenGlyph(face, glyphId, scale) {
  const contours = face.outline(glyphId);
  const segments = [];

  if (contours.length === 0) {
    return segments;
  }

  const line = (x0, y0, x1, y1) => {
    segments.push(x0 * scale, y0 * -scale, x1 * scale, y1 * -scale);
  };

  for (const contour of contours) {
    if (contour.length === 0) {
      continue;
    }

    // Rotate so the first point is on-curve; two consecutive
    // off-curve points imply an on-curve midpoint between them
    // (implicit-start glyph, e.g. some 'o' contours).
    let points = contour;

    if (!points[0].onCurve) {
      if (points[points.length - 1].onCurve) {
        points = [
          points[points.length - 1],
          ...points.slice(0, points.length - 1)
        ];
      } else {
        const first = points[0];
        const last = points[points.length - 1];

        points = [
          {
            x: (first.x + last.x) / 2,
            y: (first.y + last.y) / 2,
            onCurve: true
          },
          ...points
        ];
      }
    }

    // Close the contour by winding back to the start point.
    const path = [...points, points[0]];

    let curX = path[0].x;
    let curY = path[0].y;
    let i = 1;

    while (i < path.length) {
      const point = path[i];

      if (point.onCurve) {
        // Straight segment… or a zero-length closer that the
        // scanline filter ignores harmlessly.
        line(curX, curY, point.x, point.y);
        curX = point.x;
        curY = point.y;
        i += 1;
        continue;
      }

      // point is a quadratic control point; find the spline's
      // end: the next on-curve point, or an implied midpoint
      // when the next point is off-curve too.
      const next = path[i + 1];

      if (!next) {
        break;
      }

      let endX;
      let endY;

      if (next.onCurve) {
        endX = next.x;
        endY = next.y;
        i += 2;
      } else {
        endX = (point.x + next.x) / 2;
        endY = (point.y + next.y) / 2;
        i += 1;
      }

      let prevX = curX;
      let prevY = curY;

      for (let step = 1; step <= CURVE_STEPS; step += 1) {
        const t = step / CURVE_STEPS;
        const s = 1 - t;

        const bx = s * s * curX + 2 * s * t * point.x + t * t * endX;
        const by = s * s * curY + 2 * s * t * point.y + t * t * endY;

        line(prevX, prevY, bx, by);

        prevX = bx;
        prevY = by;
      }

      curX = prevX;
      curY = prevY;
    }
  }

  return segments;
}

/**
 * Scanline rasterization of a segment soup in pixel space.
 * Nonzero winding; 4 vertical sub-samples per row; spans keep
 * fractional endpoints for horizontal AA.
 */
function rasterizeSegments(segments) {
  const edgeCount = segments.length / 4;

  if (edgeCount === 0) {
    return { bitmap: new Uint8Array(0), width: 0, height: 0, left: 0, top: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < segments.length; i += 2) {
    const x = segments[i];
    const y = segments[i + 1];

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // 1 px of padding around the ink box absorbs AA spill.
  const left = Math.floor(minX) - 1;
  const top = Math.floor(minY) - 1;
  const width = Math.ceil(maxX) - left + 2;
  const height = Math.ceil(maxY) - top + 2;

  // Clip segment y-range per row for intersection math.
  const coverage = new Float32Array(width * height);

  for (let row = 0; row < height; row += 1) {
    const rowBase = row * width;

    for (let sub = 0; sub < SUB_ROWS; sub += 1) {
      const sampleY = row + top + (sub + 0.5) / SUB_ROWS;

      crossings(segments, sampleY);

      const spans = spansFromCrossings(currentCrossings);

      for (let s = 0; s < spans.length; s += 2) {
        addSpan(
          coverage,
          width,
          rowBase,
          spans[s] - left,
          spans[s + 1] - left
        );
      }
    }

    // Normalize accumulated sub-row coverage to 0..255.
    for (let x = 0; x < width; x += 1) {
      const value = Math.round((coverage[rowBase + x] / SUB_ROWS) * 255);

      coverage[rowBase + x] = value > 255 ? 255 : value;
    }
  }

  const bitmap = new Uint8Array(width * height);

  for (let i = 0; i < bitmap.length; i += 1) {
    bitmap[i] = coverage[i];
  }

  return { bitmap, width, height, left, top };
}

// Reused crossing buffer — crossings() fills it per sample.
let currentCrossings = [];

function crossings(segments, sampleY) {
  currentCrossings.length = 0;

  for (let i = 0; i < segments.length; i += 4) {
    const x0 = segments[i];
    const y0 = segments[i + 1];
    const x1 = segments[i + 2];
    const y1 = segments[i + 3];

    // Half-open y interval avoids double-counting vertices.
    if (y0 === y1) {
      continue;
    }

    const topY = y0 < y1 ? y0 : y1;
    const bottomY = y0 < y1 ? y1 : y0;

    if (sampleY < topY || sampleY >= bottomY) {
      continue;
    }

    const t = (sampleY - y0) / (y1 - y0);
    const x = x0 + t * (x1 - x0);

    currentCrossings.push(x, y1 > y0 ? 1 : -1);
  }
}

/** Sort crossings, pair them by winding, emit covered spans. */
function spansFromCrossings(crossingsX) {
  const spans = [];

  // crossingsX is flat [x, dir, x, dir, ...] — pair them up.
  const order = [];

  for (let i = 0; i < crossingsX.length; i += 2) {
    order.push([crossingsX[i], crossingsX[i + 1]]);
  }

  order.sort((a, b) => a[0] - b[0]);

  let winding = 0;
  let spanStart = 0;

  for (const [x, dir] of order) {
    const previous = winding;

    winding += dir;

    if (previous === 0 && winding !== 0) {
      spanStart = x;
    } else if (previous !== 0 && winding === 0) {
      spans.push(spanStart, x);
    }
  }

  return spans;
}

/** Add one span's fractional horizontal coverage to a row. */
function addSpan(coverage, width, rowBase, xStart, xEnd) {
  if (xEnd <= xStart) {
    return;
  }

  const firstCol = Math.max(0, Math.floor(xStart));
  const lastCol = Math.min(width - 1, Math.floor(xEnd));

  for (let col = firstCol; col <= lastCol; col += 1) {
    const overlap =
      Math.min(xEnd, col + 1) - Math.max(xStart, col);

    if (overlap > 0) {
      coverage[rowBase + col] += overlap;
    }
  }
}