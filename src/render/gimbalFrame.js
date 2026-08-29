// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GIMBAL FRAME PAINTER
// ======================================================
//
// Paints one video frame as raw RGB24 bytes:
//
//   ┌────────────────────────────────────────────┐
//   │  background (theme)                        │
//   │  ┌─────────┐        ┌─────────┐            │
//   │  +  ·     │        │     ·  +│            │
//   │  └─────────┘        └─────────┘            │
//   │  [Throttle]   6S 4.10V      RPM 1996       │
//   └────────────────────────────────────────────┘
//
// Each gimbal: theme-colored square with crosshair axes
// and a stick-position dot. Below: throttle toggle left,
// battery volts-per-cell center, live RPM right.
//
// All colors come from a theme object (themes.js); the
// default palette applies when none is passed.
//
// ======================================================

import { pixelText, measureText } from "./bitmapFont.js";
import { THEMES } from "./themes.js";

export const WIDTH = 500;
export const HEIGHT = 300;

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

// Tailwind "rounded-md" corner radius (0.375rem = 6 px).
export const CORNER_RADIUS_MD = 6;

/**
 * Rectangle with rounded corners: pixels inside the full
 * rect except in the four corner squares, which are kept
 * only inside a quarter-circle of the given radius.
 */
export function pixelRectRounded(frame, x0, y0, width, height, radius, color) {
  const r = Math.max(
    0,
    Math.min(radius, Math.floor(width / 2), Math.floor(height / 2))
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let inside = true;

      // Corner zones: keep only pixels within the quarter circle.
      if (x < r && y < r) {
        inside = inCorner(x, y, r);
      } else if (x >= width - r && y < r) {
        inside = inCorner(width - 1 - x, y, r);
      } else if (x < r && y >= height - r) {
        inside = inCorner(x, height - 1 - y, r);
      } else if (x >= width - r && y >= height - r) {
        inside = inCorner(width - 1 - x, height - 1 - y, r);
      }

      if (inside) {
        plotPixel(frame, x0 + x, y0 + y, color);
      }
    }
  }
}

function inCorner(dx, dy, r) {
  const rx = dx - (r - 0.5);
  const ry = dy - (r - 0.5);

  return rx * rx + ry * ry <= r * r;
}

function plotPixel(frame, x, y, color) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
    return;
  }

  const offset = (y * WIDTH + x) * 3;
  frame[offset] = color[0];
  frame[offset + 1] = color[1];
  frame[offset + 2] = color[2];
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
 * One gimbal: theme square, crosshair axes, stick dot.
 * Position: x right, y up in [-1, 1].
 */
export function paintGimbal(frame, layout, position, theme) {
  const { x0, y0, size } = layout;
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const half = size / 2;
  const dotRadius = 10; // twice the original 5

  pixelRectRounded(frame, x0, y0, size, size, CORNER_RADIUS_MD, theme.box);
  pixelLineH(frame, x0 + CORNER_RADIUS_MD, x0 + size - 1 - CORNER_RADIUS_MD, cy, theme.crosshair);
  pixelLineV(frame, cx, y0 + CORNER_RADIUS_MD, y0 + size - 1 - CORNER_RADIUS_MD, theme.crosshair);

  // Inset keeps the full-size dot inside the box even at
  // full deflection (radius + 4 px margin).
  const inset = half - dotRadius - 4;
  const dotX = Math.round(cx + position.x * inset);
  const dotY = Math.round(cy - position.y * inset);

  pixelDot(frame, dotX, dotY, dotRadius, theme.dot);
}

/**
 * A toggle switch: box with a sliding knob and the switch
 * name beside it. On = knob right + on-state colors.
 */
export function paintToggle(frame, x0, y0, isOn, label, theme) {
  const trackWidth = 56;
  const trackHeight = 22;
  const knobSize = 18;

  pixelRect(
    frame,
    x0,
    y0,
    trackWidth,
    trackHeight,
    isOn ? theme.toggleOn : theme.toggleOff
  );

  const knobY = y0 + (trackHeight - knobSize) / 2;
  const knobX = isOn ? x0 + trackWidth - knobSize - 2 : x0 + 2;

  pixelRect(frame, knobX, knobY, knobSize, knobSize, theme.knob);

  // Switch name beside the track, 2x pixel font, dim when
  // off and theme-on colored when on.
  const labelX = x0 + trackWidth + 10;
  const labelY = y0 + Math.floor((trackHeight - 14) / 2);

  pixelText(
    frame,
    WIDTH,
    HEIGHT,
    labelX,
    labelY,
    label,
    isOn ? theme.labelOn : theme.labelOff,
    2
  );
}

/**
 * Paint one full RGB frame.
 * Positions: { left: {x,y}, right: {x,y} } from mapStickPositions().
 * State:     { throttle: boolean, perCell, cellCount, rpm }.
 * Theme:     color set from themes.js (default when omitted).
 */
export function paintStickFrame(
  positions,
  state = { throttle: false, perCell: null, cellCount: null, rpm: null },
  theme = THEMES.default
) {
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);

  pixelRect(frame, 0, 0, WIDTH, HEIGHT, theme.background);

  paintGimbal(frame, GIMBAL_LAYOUT.left, positions.left, theme);
  paintGimbal(frame, GIMBAL_LAYOUT.right, positions.right, theme);

  const { toggleSpace } = GIMBAL_LAYOUT;
  const barY = HEIGHT - toggleSpace + 10;

  // Left: throttle toggle.
  paintToggle(
    frame,
    GIMBAL_LAYOUT.left.x0 + 8,
    barY,
    state.throttle === true,
    "THROTTLE",
    theme
  );

  // Center: battery volts per cell.
  paintBattery(frame, barY, state.perCell, state.cellCount, theme);

  // Right: live RPM under the right gimbal.
  paintRpm(frame, barY, state.rpm, theme);

  return frame;
}

/**
 * Battery readout centered between the toggle and RPM:
 * "6S 4.10V" — per-cell volts rounded to 2 decimals, cell
 * count from the 1S–14S lipo rule. Dim when no Vbat data.
 */
function paintBattery(frame, barY, perCell, cellCount, theme) {
  const labelY = barY + 4;

  if (perCell === null || cellCount === null) {
    pixelText(
      frame,
      WIDTH,
      HEIGHT,
      Math.floor(WIDTH / 2 - 30),
      labelY,
      "--",
      theme.toggleOff,
      2
    );
    return;
  }

  const volts = perCell.toFixed(2);
  const label = `${cellCount}S ${volts}V`;

  // Center the whole label on the frame midpoint.
  const width = measureText(label, 2);

  pixelText(
    frame,
    WIDTH,
    HEIGHT,
    Math.floor(WIDTH / 2 - width / 2),
    labelY,
    label,
    theme.battery,
    2
  );
}

/**
 * Live RPM readout on the right: "RPM 1996".
 */
function paintRpm(frame, barY, rpm, theme) {
  const labelY = barY + 4;
  const label = rpm === null ? "RPM --" : `RPM ${Math.round(rpm)}`;

  const width = measureText(label, 2);

  pixelText(
    frame,
    WIDTH,
    HEIGHT,
    WIDTH - width - 12,
    labelY,
    label,
    theme.rpm,
    2
  );
}