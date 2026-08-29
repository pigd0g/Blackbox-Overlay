// ======================================================
// GIMBALVID — GIMBAL FRAME PAINTER
// ======================================================
//
// Paints one video frame as raw RGB24 bytes:
//
//   ┌────────────────────────────────────────────┐
//   │  green screen background (#00B140)         │
//   │  ┌─────────┐        ┌─────────┐            │
//   │  │ +  ·    │        │    ·  + │            │
//   │  │    ·    │        │    ·    │            │
//   │  └─────────┘        └─────────┘            │
//   │   left (yaw,collective)  right(roll,pitch) │
//   └────────────────────────────────────────────┘
//
// Each gimbal: dark grey square, white vertical and
// horizontal axis, red stick-position dot.
//
// ======================================================

export const WIDTH = 500;
export const HEIGHT = 250;

const COLOR_BACKGROUND = [0x00, 0xb1, 0x40]; // chroma green
const COLOR_BOX = [0x40, 0x40, 0x40]; // dark grey
const COLOR_CROSSHAIR = [0xff, 0xff, 0xff]; // white
const COLOR_DOT = [0xff, 0x00, 0x00]; // red

export const GIMBAL_LAYOUT = (() => {
  const size = 230;
  const marginX = Math.floor((WIDTH - size * 2) / 3);
  const top = Math.floor((HEIGHT - size) / 2);

  return {
    size,
    left: { x0: marginX, y0: top, size },
    right: { x0: marginX * 2 + size, y0: top, size }
  };
})();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pixelRect(frame, x0, y0, width, height, color) {
  const xStart = clamp(x0, 0, WIDTH);
  const yStart = clamp(y0, 0, HEIGHT);
  const xEnd = clamp(x0 + width, 0, WIDTH);
  const yEnd = clamp(y0 + height, 0, HEIGHT);

  for (let y = yStart; y < yEnd; y += 1) {
    const rowStart = (y * WIDTH + xStart) * 3;

    for (let x = xStart; x < xEnd; x += 1) {
      const offset = rowStart + (x - xStart) * 3;
      frame[offset] = color[0];
      frame[offset + 1] = color[1];
      frame[offset + 2] = color[2];
    }
  }
}

export function pixelLineH(frame, x0, x1, y, color) {
  pixelRect(frame, x0, y, x1 - x0 + 1, 1, color);
}

export function pixelLineV(frame, x, y0, y1, color) {
  pixelRect(frame, x, y0, 1, y1 - y0 + 1, color);
}

export function pixelDot(frame, cx, cy, radius, color) {
  const r = Math.max(1, Math.round(radius));

  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= r * r) {
        const x = cx + dx;
        const y = cy + dy;
        const rowStart = (y * WIDTH + x) * 3;

        if (y >= 0 && y < HEIGHT && x >= 0 && x < WIDTH) {
          frame[rowStart] = color[0];
          frame[rowStart + 1] = color[1];
          frame[rowStart + 2] = color[2];
        }
      }
    }
  }
}

/**
 * One gimbal: grey square, white crosshair axes, red dot.
 * Stick position is x right, y up in [-1, 1].
 */
export function paintGimbal(frame, layout, position) {
  const { x0, y0 } = layout;
  const { size } = layout;
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const half = size / 2;

  pixelRect(frame, x0, y0, size, size, COLOR_BOX);
  pixelLineH(frame, x0, x0 + size - 1, cy, COLOR_CROSSHAIR);
  pixelLineV(frame, cx, y0, y0 + size - 1, COLOR_CROSSHAIR);

  const dotX = Math.round(cx + position.x * (half - 4));
  const dotY = Math.round(cy - position.y * (half - 4));

  pixelDot(frame, dotX, dotY, 5, COLOR_DOT);
}

/**
 * Paint one full RGB frame. Positions from
 * mapStickPositions(): { left: {x, y}, right: {x, y} }.
 */
export function paintStickFrame(positions) {
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);

  pixelRect(frame, 0, 0, WIDTH, HEIGHT, COLOR_BACKGROUND);

  paintGimbal(frame, GIMBAL_LAYOUT.left, positions.left);
  paintGimbal(frame, GIMBAL_LAYOUT.right, positions.right);

  return frame;
}