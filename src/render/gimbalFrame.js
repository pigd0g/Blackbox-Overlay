// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GIMBAL FRAME PAINTER
// ======================================================
//
// Paints one video frame as raw RGBA bytes:
//
//   ┌─────────┬──┬─────────┐      ┌─────────┬──┬─────────┐
//   │ ARMED   │▓ │  left   │      │  right  │▓ │ RPM     │
//   │ MOTOR   │▓ │ gimbal  │      │  gimbal │▓ │ V/CELL  │
//   │ MOTOR % │▓ │  230px  │      │  230px  │▓ │ ...     │
//   └─────────┴──┴─────────┘      └─────────┴──┴─────────┘
//   text col   bar   stick        stick   bar  text col
//
// Left column: armed flag, motor on/off flag, motor %,
// plus a vertical motor-% progress bar hugging the left
// edge of the left gimbal.
//
// Right column: RPM, pack voltage, volts/cell, live
// current, max current (running peak so far), ESC temp,
// plus a vertical current-vs-max bar hugging the right
// edge of the right gimbal.
//
// All colors come from a theme object (themes.js); the
// default palette applies when none is passed.
//
// With `alpha` the background is never painted — the buffer
// stays fully transparent (0,0,0,0) behind the widgets — so
// the frames can feed ffmpeg's rgba → ProRes 4444 pipeline.
//
// ======================================================

import { createOverlayTextRenderer } from "./textRenderer.js";
import { THEMES } from "./themes.js";

export const WIDTH = 800;
export const HEIGHT = 262;

export const GIMBAL_LAYOUT = (() => {
  const size = 200; // gimbal square
  const top = Math.floor((HEIGHT - size) / 2) + 1; // 32

  // Left cluster: text column, motor bar, left gimbal.
  // "MOTOR OFF" at scale 3 needs 159px, ending at 174.
  const leftTextX = 16;
  const leftBarX0 = 180; // 180..192
  const leftX0 = 198; // 198..398

  // Right cluster: right gimbal, current bar, text column.
  // The gimbals sit close together to buy the value column
  // room: "VBAT 22.20V" at label scale 2 + value scale 3
  // needs 155px → 640..794 (+3px shadow).
  const rightX0 = 415; // 415..615
  const rightBarX0 = 621; // 621..633
  const rightTextX = 640;

  return {
    size,
    toggleSpace: 0,
    top,
    gap: rightX0 - (leftX0 + size),
    left: { x0: leftX0, y0: top, size },
    right: { x0: rightX0, y0: top, size },
    leftBar: { x0: leftBarX0, y0: top, size },
    rightBar: { x0: rightBarX0, y0: top, size },
    leftTextX,
    rightTextX,
  };
})();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pixelRect(frame, x0, y0, width, height, color, alpha = 255) {
  const xStart = clamp(x0, 0, WIDTH);
  const yStart = clamp(y0, 0, HEIGHT);
  const xEnd = clamp(x0 + width, 0, WIDTH);
  const yEnd = clamp(y0 + height, 0, HEIGHT);

  for (let y = yStart; y < yEnd; y += 1) {
    const rowStart = (y * WIDTH + xStart) * 4;

    for (let x = xStart; x < xEnd; x += 1) {
      const offset = rowStart + (x - xStart) * 4;

      frame[offset] = color[0];
      frame[offset + 1] = color[1];
      frame[offset + 2] = color[2];
      frame[offset + 3] = alpha;
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
    Math.min(radius, Math.floor(width / 2), Math.floor(height / 2)),
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

  const offset = (y * WIDTH + x) * 4;

  frame[offset] = color[0];
  frame[offset + 1] = color[1];
  frame[offset + 2] = color[2];
  frame[offset + 3] = 255;
}

/**
 * Src-over blend of one pixel: composites `color` at the
 * given alpha (0-255) over whatever is already there
 * (straight, non-premultiplied RGBA). Anti-aliased fringes
 * therefore blend into an opaque gimbal box, and over the
 * untouched alpha-mode background they carry partial alpha
 * for a clean key in editors.
 */
function blendPixel(frame, x, y, color, alpha) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
    return;
  }

  const srcA = Math.min(255, Math.max(0, alpha));

  if (srcA === 0) {
    return;
  }

  const offset = (y * WIDTH + x) * 4;
  const dstA = frame[offset + 3];
  const dstWeight = (dstA * (255 - srcA)) / 255;
  const outA = srcA + dstWeight;

  if (outA <= 0) {
    return;
  }

  for (let c = 0; c < 3; c += 1) {
    frame[offset + c] = Math.round(
      (color[c] * srcA + frame[offset + c] * dstWeight) / outA,
    );
  }

  frame[offset + 3] = Math.round(outA);
}

export function pixelLineH(frame, x0, x1, y, color) {
  pixelRect(frame, x0, y, x1 - x0 + 1, 1, color);
}

export function pixelLineV(frame, x, y0, y1, color) {
  pixelRect(frame, x, y0, 1, y1 - y0 + 1, color);
}

/**
 * Anti-aliased filled circle. Interior pixels paint solid;
 * the ring straddling the circle's edge blends by coverage
 * (supersampled 4x4 per pixel) so the dot has smooth edges
 * instead of hard jaggies. Blending is proper src-over, so
 * alpha-mode frames keep graduated alpha at the rim.
 */
export function pixelDot(frame, cx, cy, radius, color) {
  const r = Math.max(1, radius);
  const c = Math.ceil(r);
  const SAMPLES = 4;
  const SAMPLES_SQ = SAMPLES * SAMPLES;

  for (let dy = -c; dy <= c; dy += 1) {
    for (let dx = -c; dx <= c; dx += 1) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);

      // Quick accept: the pixel's farthest corner is inside
      // the circle, so it is fully covered — paint solid.
      const farX = ax + 0.5;
      const farY = ay + 0.5;

      if (farX * farX + farY * farY <= r * r) {
        plotPixel(frame, cx + dx, cy + dy, color);
        continue;
      }

      // Quick reject: the pixel's nearest corner is outside.
      const nearX = ax - 0.5;
      const nearY = ay - 0.5;

      if (nearX * nearX + nearY * nearY > r * r) {
        continue;
      }

      // Edge pixel: 4x4 supersample coverage → alpha.
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
        blendPixel(frame, cx + dx, cy + dy, color, Math.round((hit / SAMPLES_SQ) * 255));
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
  const dotRadius = 15; // twice the original 5

  pixelRectRounded(frame, x0, y0, size, size, CORNER_RADIUS_MD, theme.box);
  pixelLineH(
    frame,
    x0 + CORNER_RADIUS_MD,
    x0 + size - 1 - CORNER_RADIUS_MD,
    cy,
    theme.crosshair,
  );
  pixelLineV(
    frame,
    cx,
    y0 + CORNER_RADIUS_MD,
    y0 + size - 1 - CORNER_RADIUS_MD,
    theme.crosshair,
  );

  // Inset keeps the full-size dot inside the box even at
  // full deflection (radius + 4 px margin).
  const inset = half - dotRadius - 4;
  const dotX = Math.round(cx + position.x * inset);
  const dotY = Math.round(cy - position.y * inset);

  pixelDot(frame, dotX, dotY, dotRadius, theme.dot);
}

/**
 * Vertical progress bar: a track with a fill rising from
 * the bottom, sized to [0, 1]. The fill keeps the rounded
 * silhouette's top corners so an empty bar still reads as
 * a rounded track and a full one as a rounded pill.
 */
export function paintVerticalBar(
  frame,
  layout,
  fraction,
  fillColor,
  trackColor,
) {
  const { x0, y0, size } = layout;

  pixelRectRounded(frame, x0, y0, BAR_WIDTH, size, 3, trackColor);

  const clamped = clamp(fraction ?? 0, 0, 1);
  const fillHeight = Math.round(size * clamped);
  const yMax = y0 + size;

  if (fillHeight > 0) {
    pixelRectRounded(
      frame,
      x0 + 1,
      yMax - fillHeight,
      BAR_WIDTH - 2,
      fillHeight,
      2,
      fillColor,
    );
  }
}

// Paint rules for the telemetry text columns. The x origins
// come from GIMBAL_LAYOUT (leftTextX / rightTextX). Text is
// drawn through the overlay text renderer (fonts.js) — roles
// carry the sizing, the selected font answers. The 4px
// label→value gap keeps "VBAT 22.20V" inside the 155px right
// text column. Every line draws with a theme.textShadow drop
// shadow when the shadow option is on; pass a theme without
// textShadow (or shadow off) to skip it.
const DEFAULT_FONT_ID = "vt323";
const BAR_WIDTH = 13;
const LABEL_GAP = 4;

/**
 * Text renderer for a font id, memoized so per-frame paint
 * calls do not rebuild glyph caches. The underlying glyph
// cache is process-wide and bounded.
 */
const rendererCache = new Map();

function overlayRenderer(fontId) {
  if (!rendererCache.has(fontId)) {
    rendererCache.set(fontId, createOverlayTextRenderer(fontId));
  }

  return rendererCache.get(fontId);
}

/**
 * Drop-shadow color for active text: the theme's textShadow
 * when the shadow option is on, null when off (default).
 */
function shadowFor(theme, enabled) {
  return enabled === true ? (theme.textShadow ?? [0, 0, 0]) : null;
}

function labelLine(
  frame,
  x,
  y,
  labelText,
  valueText,
  labelColor,
  valueColor,
  renderer,
  shadow
) {
  const labelRole = renderer.roles.label;
  const valueRole = renderer.roles.value;

  renderer.drawText(
    frame,
    WIDTH,
    HEIGHT,
    x,
    y,
    labelText,
    labelColor,
    labelRole,
    { shadowColor: shadow }
  );

  if (valueText !== null) {
    const valueX =
      x + Math.ceil(renderer.measureText(labelText, labelRole)) +
      LABEL_GAP;

    renderer.drawText(
      frame,
      WIDTH,
      HEIGHT,
      valueX,
      y - 2,
      valueText,
      valueColor,
      valueRole,
      { shadowColor: shadow }
    );
  }
}

/**
 * Flag + value readout: the flag text renders in its
 * on-color when set (e.g. "ARMED") and the muted
 * labelOff color when not (e.g. "DISARMED", "MOTOR OFF").
 */
function paintFlag(frame, x, y, onText, offText, on, onColor, theme, renderer, shadow) {
  renderer.drawText(
    frame,
    WIDTH,
    HEIGHT,
    x,
    y,
    on ? onText : offText,
    on ? onColor : theme.labelOff,
    renderer.roles.value,
    { shadowColor: shadow }
  );
}

/**
 * Left column: Armed flag, Motor On/Off flag, Motor %
 * value. The bare percentage renders on the third line —
 * the MOTOR_ON/OFF flag above already names it, so no
 * "MOTOR" label is drawn.
 */
function paintLeftColumn(frame, y0, state, theme, renderer, shadow) {
  paintFlag(
    frame,
    GIMBAL_LAYOUT.leftTextX,
    y0,
    "ARMED",
    "DISARMED",
    state.armed === true,
    theme.armed,
    theme,
    renderer,
    shadow,
  );

  paintFlag(
    frame,
    GIMBAL_LAYOUT.leftTextX,
    y0 + lineStride(renderer),
    "MOTOR ON",
    "MOTOR OFF",
    state.motorOn === true,
    theme.motor,
    theme,
    renderer,
    shadow,
  );

  const motorPctText =
    state.motorPct === null || state.motorPct === undefined
      ? "--"
      : `${Number(state.motorPct).toFixed(1)}%`;

  renderer.drawText(
    frame,
    WIDTH,
    HEIGHT,
    GIMBAL_LAYOUT.leftTextX,
    y0 + lineStride(renderer) * 2 - 2,
    motorPctText,
    theme.motor,
    renderer.roles.value,
    { shadowColor: shadow },
  );
}

/**
 * Right column: RPM, Volts-per-cell, Battery volts,
 * Current, Max Current, ESC temp.
 */
function paintRightColumn(frame, y0, state, theme, renderer, shadow) {
  const rpmText =
    state.rpm === null || state.rpm === undefined
      ? "--"
      : `${Math.round(state.rpm)}`;
  const packText =
    state.packVolts === null || state.packVolts === undefined
      ? "--"
      : `${state.packVolts.toFixed(2)}V`;
  const perCellText =
    state.perCell === null || state.perCell === undefined
      ? "--"
      : `${state.perCell.toFixed(2)}V`;
  const currentText =
    state.current === null || state.current === undefined
      ? "--"
      : `${state.current.toFixed(1)}A`;
  const maxCurrentText =
    state.maxCurrent === null || state.maxCurrent === undefined
      ? "--"
      : `${state.maxCurrent.toFixed(1)}`;
  const escText =
    state.escTemp === null || state.escTemp === undefined
      ? "--"
      : `${Math.round(state.escTemp)}°C`;

  labelLine(
    frame,
    GIMBAL_LAYOUT.rightTextX,
    y0,
    "RPM",
    rpmText,
    theme.labelOff,
    theme.rpm,
    renderer,
    shadow,
  );
  labelLine(
    frame,
    GIMBAL_LAYOUT.rightTextX,
    y0 + lineStride(renderer),
    "V/C",
    perCellText,
    theme.labelOff,
    theme.vCell,
    renderer,
    shadow,
  );
  labelLine(
    frame,
    GIMBAL_LAYOUT.rightTextX,
    y0 + lineStride(renderer) * 2,
    "VBAT",
    packText,
    theme.labelOff,
    theme.vCell,
    renderer,
    shadow,
  );
  labelLine(
    frame,
    GIMBAL_LAYOUT.rightTextX,
    y0 + lineStride(renderer) * 3,
    "AMP",
    currentText,
    theme.labelOff,
    theme.current,
    renderer,
    shadow,
  );
  labelLine(
    frame,
    GIMBAL_LAYOUT.rightTextX,
    y0 + lineStride(renderer) * 4,
    "MAX",
    maxCurrentText,
    theme.labelOff,
    theme.maxCurrent,
    renderer,
    shadow,
  );
  labelLine(
    frame,
    GIMBAL_LAYOUT.rightTextX,
    y0 + lineStride(renderer) * 5,
    "ESC",
    escText,
    theme.labelOff,
    theme.escTemp,
    renderer,
    shadow,
  );
}

function paintLeftBar(frame, state, theme) {
  const fraction =
    state.motorPct === null || state.motorPct === undefined
      ? 0
      : Number(state.motorPct) / 100;

  paintVerticalBar(
    frame,
    GIMBAL_LAYOUT.leftBar,
    fraction,
    theme.barMotor,
    theme.barTrack,
  );
}

function paintRightBar(frame, state, theme) {
  const current = Number(state.current);
  const max = Number(state.maxCurrent);
  const fraction =
    state.current === null ||
    state.maxCurrent === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(max) ||
    max <= 0
      ? 0
      : clamp(current / max, 0, 1);

  paintVerticalBar(
    frame,
    GIMBAL_LAYOUT.rightBar,
    fraction,
    theme.barCurrent,
    theme.barTrack,
  );
}

/**
 * Paint one full RGBA frame.
 * Positions: { left: {x,y}, right: {x,y} } from mapStickPositions().
 * State: {
 *   armed, motorOn, motorPct,
 *   rpm, packVolts, perCell,
 *   current, maxCurrent, escTemp
 * }.
 * Theme: color set from themes.js (default when omitted),
 * optionally re-inked via applyThemeOverrides() by callers.
 * Options.alpha: leave the background transparent.
 * Options.shadow: draw the theme's textShadow under every
 * glyph (default OFF — opt-in per frame).
 * Options.font: registry font id (fonts.js); default vt323.
 */
export function paintStickFrame(
  positions,
  state = {},
  theme = THEMES.default,
  options = {},
) {
  const {
    armed = false,
    motorOn = false,
    motorPct = null,
    rpm = null,
    packVolts = null,
    perCell = null,
    current = null,
    maxCurrent = null,
    escTemp = null,
  } = state;

  // Positions may be missing (degenerated callers); sticks at
  // center so the frame never throws.
  const safePositions = positions ?? {
    left: { x: 0, y: 0 },
    right: { x: 0, y: 0 },
  };

  const fullState = {
    motorOn,
    motorPct,
    armed,
    rpm,
    packVolts,
    perCell,
    current,
    maxCurrent,
    escTemp,
  };
  const alphaBackground = options.alpha === true;
  const shadow = shadowFor(theme, options.shadow === true);
  const renderer = overlayRenderer(options.font ?? DEFAULT_FONT_ID);
  const stride = lineStride(renderer);

  const frame = new Uint8Array(WIDTH * HEIGHT * 4).fill(0);

  if (!alphaBackground) {
    pixelRect(frame, 0, 0, WIDTH, HEIGHT, theme.background);
  }

  paintGimbal(
    frame,
    GIMBAL_LAYOUT.left,
    safePositions.left ?? { x: 0, y: 0 },
    theme,
  );
  paintGimbal(
    frame,
    GIMBAL_LAYOUT.right,
    safePositions.right ?? { x: 0, y: 0 },
    theme,
  );

  // The column starts a third of the way down so all six
  // right-column lines stay inside 262px for every font.
  const columnTop = GIMBAL_LAYOUT.top + 12;

  paintLeftColumn(frame, columnTop, fullState, theme, renderer, shadow);
  paintLeftBar(frame, fullState, theme);

  paintRightColumn(frame, columnTop, fullState, theme, renderer, shadow);
  paintRightBar(frame, fullState, theme);

  return frame;
}

/**
 * Vertical distance between text baselines: derived from the
 * value role's ink height so each font's line stack scales
 * with its glyphs (bitmap keeps the historical 34px = 21px
 * glyph + 13px air).
 */
function lineStride(renderer) {
  const inkHeight = renderer.roleInkHeight("value");

  return Math.max(24, Math.round(inkHeight * 1.62));
}
