// ======================================================
// GIMBALVID — GIMBAL FRAME PAINTER
// ======================================================
//
// Paints one video frame as raw RGB24 bytes:
//
//   ┌────────────────────────────────────────────┐
//   │  background (#C6D8D3)                      │
//   │  ┌─────────┐        ┌─────────┐            │
//   │  +  ·     │        │     ·  +│            │
//   │  └─────────┘        └─────────┘            │
//   │  [ Armed ]           [ Throttle ]          │
//   │  toggle              toggle                │
//   └────────────────────────────────────────────┘
//
// Each gimbal: dark grey square with #92898A crosshair
// axes and a #EE4266 stick-position dot. Left toggle reads
// the log's arming channel; right toggle lights when the
// throttle (collective) is above 0.
//
// ======================================================

import { pixelText } from "./bitmapFont.js";

export const WIDTH = 500;
export const HEIGHT = 300;

const COLOR_BACKGROUND = [0xc6, 0xd8, 0xd3]; // pale sage
const COLOR_BOX = [0x40, 0x40, 0x40]; // dark grey square
const COLOR_CROSSHAIR = [0x92, 0x89, 0x8a]; // axis lines
const COLOR_DOT = [0xee, 0x42, 0x66]; // stick dot

const COLOR_TOGGLE_OFF_BOX = [0x9e, 0x9e, 0x9e];
const COLOR_TOGGLE_ON_BOX = [0x2e, 0x7d, 0x32]; // green when on
const COLOR_TOGGLE_KNOB = [0xf5, 0xf5, 0xf5];
const COLOR_TOGGLE_LABEL = [0x24, 0x24, 0x24];
const COLOR_TOGGLE_LABEL_ON = [0x2e, 0x7d, 0x32];

export const GIMBAL_LAYOUT = (() => {
  const toggleSpace = 46; // bottom strip reserved for toggles
  const size = 230; // gimbal square keeps its original size
  const marginX = Math.floor((WIDTH - size * 2) / 3);
  const top = Math.floor((HEIGHT - toggleSpace - size) / 2) + 6;

  return {
    size,
    toggleSpace,
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
 * One gimbal: grey square, colored crosshair axes,
 * stick-position dot. Position: x right, y up in [-1, 1].
 */
export function paintGimbal(frame, layout, position) {
  const { x0, y0, size } = layout;
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const half = size / 2;
  const dotRadius = 10; // twice the original 5

  pixelRect(frame, x0, y0, size, size, COLOR_BOX);
  pixelLineH(frame, x0, x0 + size - 1, cy, COLOR_CROSSHAIR);
  pixelLineV(frame, cx, y0, y0 + size - 1, COLOR_CROSSHAIR);

  // Inset keeps the full-size dot inside the box even at
  // full deflection (radius + 4 px margin).
  const inset = half - dotRadius - 4;
  const dotX = Math.round(cx + position.x * inset);
  const dotY = Math.round(cy - position.y * inset);

  pixelDot(frame, dotX, dotY, dotRadius, COLOR_DOT);
}

/**
 * A toggle switch: box with a sliding knob and the switch
 * name beside it. On = knob right + green track & label.
 */
export function paintToggle(frame, x0, y0, isOn, label) {
  const trackWidth = 56;
  const trackHeight = 22;
  const knobSize = 18;

  pixelRect(
    frame,
    x0,
    y0,
    trackWidth,
    trackHeight,
    isOn ? COLOR_TOGGLE_ON_BOX : COLOR_TOGGLE_OFF_BOX
  );

  const knobY = y0 + (trackHeight - knobSize) / 2;
  const knobX = isOn ? x0 + trackWidth - knobSize - 2 : x0 + 2;

  pixelRect(frame, knobX, knobY, knobSize, knobSize, COLOR_TOGGLE_KNOB);

  // Switch name beside the track, 2x pixel font, dim when
  // off and green when on.
  const labelX = x0 + trackWidth + 10;
  const labelY = y0 + Math.floor((trackHeight - 14) / 2);

  pixelText(
    frame,
    WIDTH,
    HEIGHT,
    labelX,
    labelY,
    label,
    isOn ? COLOR_TOGGLE_LABEL_ON : COLOR_TOGGLE_LABEL,
    2
  );
}

/**
 * Paint one full RGB frame.
 * Positions: { left: {x,y}, right: {x,y} } from mapStickPositions().
 * State:     { armed: boolean, throttle: boolean }.
 */
export function paintStickFrame(positions, state = { armed: false, throttle: false }) {
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);

  pixelRect(frame, 0, 0, WIDTH, HEIGHT, COLOR_BACKGROUND);

  paintGimbal(frame, GIMBAL_LAYOUT.left, positions.left);
  paintGimbal(frame, GIMBAL_LAYOUT.right, positions.right);

  const { toggleSpace } = GIMBAL_LAYOUT;
  const toggleY = HEIGHT - toggleSpace + 10;

  paintToggle(
    frame,
    GIMBAL_LAYOUT.left.x0 + 8,
    toggleY,
    state.armed === true,
    "ARMED"
  );
  paintToggle(
    frame,
    GIMBAL_LAYOUT.right.x0 + 8,
    toggleY,
    state.throttle === true,
    "THROTTLE"
  );

  return frame;
}