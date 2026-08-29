// ======================================================
// GIMBALVID — GIMBAL FRAME PAINTER TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WIDTH,
  HEIGHT,
  GIMBAL_LAYOUT,
  paintStickFrame,
  pixelRect,
  pixelDot
} from "../src/render/gimbalFrame.js";
import { pixelText, measureText, getGlyph } from "../src/render/bitmapFont.js";

function colorAt(frame, x, y) {
  const offset = (y * WIDTH + x) * 3;
  return [frame[offset], frame[offset + 1], frame[offset + 2]];
}

const CENTER_POSITION = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
const ALL_OFF = { armed: false, throttle: false };
const ALL_ON = { armed: true, throttle: true };

test("frame buffer is 500 x 300 x 3 bytes", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);
  assert.equal(WIDTH, 500);
  assert.equal(HEIGHT, 300);
  assert.equal(frame.length, WIDTH * HEIGHT * 3);
});

test("frame background is #C6D8D3", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  for (const [x, y] of [
    [0, 0],
    [WIDTH - 1, 0],
    [0, HEIGHT - 1],
    [WIDTH - 1, HEIGHT - 1],
    [WIDTH >> 1, 4]
  ]) {
    assert.deepEqual(colorAt(frame, x, y), [0xc6, 0xd8, 0xd3], `at ${x},${y}`);
  }
});

test("gimbal boxes are dark grey away from crosshair and dot", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    const cx = layout.x0 + GIMBAL_LAYOUT.size / 2;
    const cy = layout.y0 + GIMBAL_LAYOUT.size / 2;

    assert.deepEqual(colorAt(frame, cx - 60, cy - 60), [0x40, 0x40, 0x40]);
  }
});

test("crosshair axes are #92898A", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    const cx = layout.x0 + GIMBAL_LAYOUT.size / 2;
    const cy = layout.y0 + GIMBAL_LAYOUT.size / 2;

    // Center is covered by the stick dot at (0,0); sample the arms.
    assert.deepEqual(colorAt(frame, layout.x0 + 5, cy), [0x92, 0x89, 0x8a]);
    assert.deepEqual(colorAt(frame, cx, layout.y0 + 5), [0x92, 0x89, 0x8a]);
  }
});

test("stick dots are #EE4266, radius 10 (twice the old 5)", () => {
  const inset = GIMBAL_LAYOUT.size / 2 - 10 - 4;

  const frame = paintStickFrame(
    { left: { x: 0, y: 0 }, right: { x: 1, y: 1 } },
    ALL_OFF
  );

  const rightCx = GIMBAL_LAYOUT.right.x0 + GIMBAL_LAYOUT.size / 2;
  const rightCy = GIMBAL_LAYOUT.right.y0 + GIMBAL_LAYOUT.size / 2;

  const dotX = Math.round(rightCx + inset);
  const dotY = Math.round(rightCy - inset);

  // Center of the dot…
  assert.deepEqual(colorAt(frame, dotX, dotY), [0xee, 0x42, 0x66]);

  // …and 9 px out (inside a radius-10 dot; old radius 5 would miss).
  assert.deepEqual(colorAt(frame, dotX + 9, dotY), [0xee, 0x42, 0x66]);

  // …but 11 px out is outside the new dot (gimbal grey again).
  assert.deepEqual(colorAt(frame, dotX + 11, dotY), [0x40, 0x40, 0x40]);
});

test("toggle strips with live under each gimbal box", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_ON);
  const toggleY = HEIGHT - GIMBAL_LAYOUT.toggleSpace + 10;

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    // Track starts 8 px into the box width.
    const trackX = layout.x0 + 8 + 10;

    assert.deepEqual(
      colorAt(frame, trackX, toggleY + 10),
      [0x2e, 0x7d, 0x32],
      "toggle track should be green when on"
    );
  }
});

test("toggles render off and on distinctly", () => {
  const off = paintStickFrame(CENTER_POSITION, { armed: false, throttle: false });
  const on = paintStickFrame(CENTER_POSITION, { armed: true, throttle: true });

  const toggleY = HEIGHT - GIMBAL_LAYOUT.toggleSpace + 10;
  // Sample inside the track but clear of the sliding knob
  // (knob occupies 2..20 px from either end).
  const trackX = GIMBAL_LAYOUT.left.x0 + 8 + 28;
  const sampleY = toggleY + 10;

  assert.deepEqual(colorAt(off, trackX, sampleY), [0x9e, 0x9e, 0x9e]);
  assert.deepEqual(colorAt(on, trackX, sampleY), [0x2e, 0x7d, 0x32]);
});

test("pixelRect clips out-of-bounds writes safely", () => {
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);

  assert.doesNotThrow(() => {
    pixelRect(frame, -10, -10, 400, 400, [1, 2, 3]);
    pixelDot(frame, -5, -5, 8, [9, 9, 9]);
    pixelDot(frame, WIDTH + 5, HEIGHT + 5, 8, [9, 9, 9]);
  });
});

test("pixel font renders ARMED label beside the toggle", () => {
  const frame = paintStickFrame(CENTER_POSITION, { armed: true, throttle: false });

  const toggleY = HEIGHT - GIMBAL_LAYOUT.toggleSpace + 10;
  const labelX = GIMBAL_LAYOUT.left.x0 + 8 + 56 + 10;
  const labelY = toggleY + Math.floor((22 - 14) / 2);

  // The "A" of ARMED: row 3 is the full-width bar ("11111"),
  // scale 2 → center pixel sits at labelX + 4..5, labelY + 6..7.
  assert.deepEqual(
    colorAt(frame, labelX + 4, labelY + 6),
    [0x2e, 0x7d, 0x32],
    "ARMED label should be green when armed"
  );

  // Right toggle is off: its THROTTLE label stays dark.
  const rightLabelX = GIMBAL_LAYOUT.right.x0 + 8 + 56 + 10;
  assert.deepEqual(
    colorAt(frame, rightLabelX + 4, labelY + 6),
    [0x24, 0x24, 0x24]
  );
});

test("bitmap font basics", () => {
  assert.equal(measureText("ARMED", 2), 5 * 12 - 2);
  assert.ok(getGlyph("A"), "glyph A missing");
  assert.equal(getGlyph("@"), null, "unknown glyphs must return null");

  // Unknown characters render as blanks (spaces advance only).
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);
  const drawn = pixelText(frame, WIDTH, HEIGHT, 10, 10, "A@", [1, 2, 3], 1);
  assert.equal(drawn, measureText("A@", 1));

  // Clipping: text off the edge must not throw.
  assert.doesNotThrow(() => {
    pixelText(frame, WIDTH, HEIGHT, WIDTH - 2, HEIGHT - 2, "ARMED", [1, 2, 3], 2);
  });
});