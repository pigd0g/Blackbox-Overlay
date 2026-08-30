// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TINY BITMAP FONT (5x7)
// ======================================================
//
// Classic 5x7 pixel font for on-frame labels: uppercase
// A-Z, digits, and a little punctuation. Every glyph is
// seven strings of five '0'/'1' bits, top row first.
//
// pixelText() renders with an integer scale; labels like
// "ARMED" / "THROTTLE" use scale 2 (10x14 per glyph) so
// they stay readable in the overlay. An optional shadow
// color draws a hard drop shadow offset +scale px diagonally
// beneath the glyphs — keeps text readable over busy
// footage and both light and dark themes.
//
// Frames are RGBA (4 bytes/pixel): alpha 255 when a bit is
// lit, 0 when dark — so transparent-background renders can
// key the text cleanly too.
//
// ======================================================

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
  "°": ["01100", "01100", "00000", "00000", "00000", "00000", "00000"]
};

export function getGlyph(character) {
  return GLYPHS[character.toUpperCase()] ?? null;
}

/** Rendered text width in pixels (trailing advance removed). */
export function measureText(text, scale = 1) {
  if (!text) {
    return 0;
  }

  return text.length * (GLYPH_WIDTH + 1) * scale - scale;
}

/**
 * Draw text with the 5x7 font. Returns the width drawn,
 * so callers can chain or center. Clipped to the frame.
 * Frames are RGBA (4 bytes/pixel); lit bits write the full
 * color with alpha 255.
 *
 * shadowColor: when provided, a copy of the text is drawn
 * offset (+scale, +scale) first, so glyphs get a hard
 * drop shadow. The shadow is skipped for transparent
 * frames by passing null (the default).
 */
export function pixelText(
  frame,
  width,
  height,
  x,
  y,
  text,
  color,
  scale = 1,
  shadowColor = null
) {
  if (shadowColor) {
    drawText(frame, width, height, x + scale, y + scale, text, shadowColor, scale);
  }

  drawText(frame, width, height, x, y, text, color, scale);

  return measureText(text, scale);
}

function drawText(frame, width, height, x, y, text, color, scale) {
  let cursorX = x;

  for (const character of String(text ?? "")) {
    const glyph = getGlyph(character);

    if (glyph) {
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const bits = glyph[row];

        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          if (bits[col] === "1") {
            for (let sy = 0; sy < scale; sy += 1) {
              for (let sx = 0; sx < scale; sx += 1) {
                plotPixel(
                  frame,
                  width,
                  height,
                  cursorX + col * scale + sx,
                  y + row * scale + sy,
                  color
                );
              }
            }
          }
        }
      }
    }

    cursorX += (GLYPH_WIDTH + 1) * scale;
  }
}

function plotPixel(frame, width, height, x, y, color) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }

  const offset = (y * width + x) * 4;

  frame[offset] = color[0];
  frame[offset + 1] = color[1];
  frame[offset + 2] = color[2];
  frame[offset + 3] = 255;
}