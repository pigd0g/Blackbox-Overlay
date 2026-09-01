// ======================================================
// RotorFlight-Blackbox-Video-Overlay — PIXEL PRIMITIVES (v2)
// ======================================================
//
// Dimension-parametrized drawing primitives for the scene
// painter. Every call names its buffer and its width/height;
// nothing is tied to a fixed frame size (the v1 constraint).
//
// Compositing: full src-over everywhere. `color` is
// [r, g, b, a] with a in 0–255; opaque a=255 short-circuits
// to a straight plot, a=0 is a no-op, and AA edges blend
// straight (non-premultiplied) so alpha renders key cleanly
// in editors.
//
// ======================================================

/** Src-over blend of a single pixel. */
export function blendPixel(buf, width, height, x, y, color) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }

  const srcA = color[3] ?? 255;

  if (srcA <= 0) {
    return;
  }

  const offset = (y * width + x) * 4;
  const dstA = buf[offset + 3];

  if (srcA >= 255 || dstA === 0) {
    buf[offset] = color[0];
    buf[offset + 1] = color[1];
    buf[offset + 2] = color[2];
    buf[offset + 3] = srcA;
    return;
  }

  const srcW = srcA / 255;
  const dstW = (dstA / 255) * (1 - srcW);
  const outA = srcW + dstW;

  if (outA <= 0) {
    return;
  }

  for (let c = 0; c < 3; c += 1) {
    buf[offset + c] = Math.round(
      (color[c] * srcW + buf[offset + c] * dstW) / outA
    );
  }

  buf[offset + 3] = Math.round(outA * 255);
}

/** Filled rectangle with src-over blending. */
export function pixelRect(buf, width, height, x0, y0, w, h, color) {
  const xStart = Math.max(0, Math.round(x0));
  const yStart = Math.max(0, Math.round(y0));
  const xEnd = Math.min(width, Math.round(x0 + w));
  const yEnd = Math.min(height, Math.round(y0 + h));
  const a = color[3] ?? 255;

  for (let y = yStart; y < yEnd; y += 1) {
    const rowStart = y * width * 4;

    for (let x = xStart; x < xEnd; x += 1) {
      const offset = rowStart + x * 4;

      const dstA = buf[offset + 3];

      if (a >= 255 || dstA === 0) {
        buf[offset] = color[0];
        buf[offset + 1] = color[1];
        buf[offset + 2] = color[2];
        buf[offset + 3] = a;
      } else {
        blendPixel(buf, width, height, x, y, color);
      }
    }
  }
}

function inCorner(dx, dy, r) {
  const rx = dx - (r - 0.5);
  const ry = dy - (r - 0.5);

  return rx * rx + ry * ry <= r * r;
}

/**
 * Rounded rectangle. radius clamps to min(w,h)/2. Pixels
 * inside the four corner quarter-circles are kept only in
 * the corner disc; everything else blends src-over.
 */
export function pixelRectRounded(buf, width, height, x0, y0, w, h, radius, color) {
  const x0r = Math.round(x0);
  const y0r = Math.round(y0);
  const xStart = Math.max(0, x0r);
  const yStart = Math.max(0, y0r);
  const xEnd = Math.min(width, Math.round(x0 + w));
  const yEnd = Math.min(height, Math.round(y0 + h));
  const r = Math.max(
    0,
    Math.min(radius ?? 0, Math.floor(w / 2), Math.floor(h / 2))
  );
  const wR = Math.round(wprox(x0, w));

  for (let y = yStart; y < yEnd; y += 1) {
    const dy = y - y0r;
    const bottom = Math.round(hprox(y0, h)) - 1 - dy;

    for (let x = xStart; x < xEnd; x += 1) {
      const dx = x - x0r;
      const right = wR - 1 - dx;

      let inside = true;

      if (dx < r && dy < r) {
        inside = inCorner(dx, dy, r);
      } else if (right < r && dy < r) {
        inside = inCorner(right, dy, r);
      } else if (dx < r && bottom < r) {
        inside = inCorner(dx, bottom, r);
      } else if (right < r && bottom < r) {
        inside = inCorner(right, bottom, r);
      }

      if (inside) {
        blendPixel(buf, width, height, x, y, color);
      }
    }
  }
}

function wprox(x0, w) {
  const x0r = Math.round(x0);

  return Math.round(x0 + w) - x0r;
}

function hprox(y0, h) {
  const y0r = Math.round(y0);

  return Math.round(y0 + h) - y0r;
}

/** Horizontal line, inclusive of both endpoints. */
export function pixelLineH(buf, width, height, x0, x1, y, color) {
  const start = Math.min(x0, x1);
  const end = Math.max(x0, x1);

  pixelRect(buf, width, height, start, y, end - start + 1, 1, color);
}

/** Vertical line, inclusive of both endpoints. */
export function pixelLineV(buf, width, height, x, y0, y1, color) {
  const start = Math.min(y0, y1);
  const end = Math.max(y0, y1);

  pixelRect(buf, width, height, x, start, 1, end - start + 1, color);
}

/**
 * Anti-aliased filled circle. Interior paints solid; rim
 * pixels blend by 4×4 supersampled coverage.
 */
export function pixelCircle(buf, width, height, cx, cy, radius, color) {
  const r = Math.max(1, radius);
  const c = Math.ceil(r);
  const SAMPLES = 4;
  const SAMPLES_SQ = SAMPLES * SAMPLES;
  const alphaScale = (color[3] ?? 255) / 255;

  for (let dy = -c; dy <= c; dy += 1) {
    for (let dx = -c; dx <= c; dx += 1) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const farX = ax + 0.5;
      const farY = ay + 0.5;

      if (farX * farX + farY * farY <= r * r) {
        blendPixel(buf, width, height, cx + dx, cy + dy, color);

        continue;
      }

      const nearX = ax - 0.5;
      const nearY = ay - 0.5;

      if (nearX * nearX + nearY * nearY > r * r) {
        continue;
      }

      let hit = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = dx + (sx + 0.5) / SAMPLES - 0.5;
          const py = dy + (sy + 0.5) / SAMPLES - 0.5;

          if (px * px + py * py <= r * r) {
            hit += 1;
          }
        }
      }

      if (hit > 0) {
        blendPixel(buf, width, height, cx + dx, cy + dy, [
          color[0],
          color[1],
          color[2],
          Math.round((hit / SAMPLES_SQ) * alphaScale * 255)
        ]);
      }
    }
  }
}

/**
 * Anti-aliased ring arc for the donut chart: pixels whose
 * 4×4 supersampled coverage lies inside BOTH the outer
 * radius AND outside the inner radius, within the angular
 * sweep. Sweep starts at 12 o'clock and runs clockwise;
 * fraction 0–1 of the full circle (≤0 none, ≥1 full ring).
 */
export function pixelRing(
  buf,
  width,
  height,
  cx,
  cy,
  outerR,
  innerR,
  fraction,
  color
) {
  const r = Math.max(1, outerR);
  const inner = Math.max(0, Math.min(innerR, r - 1));
  const c = Math.ceil(r);
  const SAMPLES = 4;
  const SAMPLES_SQ = SAMPLES * SAMPLES;
  const alphaScale = (color[3] ?? 255) / 255;

  // Angle from 12 o'clock, clockwise. atan2(dx, -dy) yields
  // [−π, π]; positive shifts map it to [0, 2π).
  const coveredAngle = (px, py) => {
    if (fraction >= 1) {
      return true;
    }

    if (fraction <= 0) {
      return false;
    }

    let angle = Math.atan2(px, -py);

    if (angle < 0) {
      angle += Math.PI * 2;
    }

    return angle <= fraction * Math.PI * 2;
  };

  for (let dy = -c; dy <= c; dy += 1) {
    for (let dx = -c; dx <= c; dx += 1) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const farX = ax + 0.5;
      const farY = ay + 0.5;
      const nearX = Math.max(0, ax - 0.5);
      const nearY = Math.max(0, ay - 0.5);
      const farDist = Math.hypot(farX, farY);
      const nearDist = Math.hypot(nearX, nearY);

      // Fully inside: nearest point clears the inner radius
      // and the farthest stays within the outer.
      if (farDist <= r && nearDist >= inner) {
        if (coveredAngle(dx, dy)) {
          blendPixel(buf, width, height, cx + dx, cy + dy, color);
        }

        continue;
      }

      // Quick reject: the nearest corner is beyond the ring.
      if (nearDist > r) {
        continue;
      }

      // Quick reject: the farthest corner is inside the hole.
      if (farDist < inner) {
        continue;
      }

      // Edge region: supersample distance and angle.
      let hit = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = dx + (sx + 0.5) / SAMPLES - 0.5;
          const py = dy + (sy + 0.5) / SAMPLES - 0.5;
          const dist = Math.hypot(px, py);

          if (dist > r || dist < inner) {
            continue;
          }

          if (coveredAngle(px, py)) {
            hit += 1;
          }
        }
      }

      if (hit > 0) {
        blendPixel(buf, width, height, cx + dx, cy + dy, [
          color[0],
          color[1],
          color[2],
          Math.round((hit / SAMPLES_SQ) * alphaScale * 255)
        ]);
      }
    }
  }
}