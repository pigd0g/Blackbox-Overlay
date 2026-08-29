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

function colorAt(frame, x, y) {
  const offset = (y * WIDTH + x) * 3;
  return [frame[offset], frame[offset + 1], frame[offset + 2]];
}

const CENTER_POSITION = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };

test("frame buffer is WIDTH x HEIGHT x 3 bytes", () => {
  const frame = paintStickFrame(CENTER_POSITION);
  assert.equal(frame.length, WIDTH * HEIGHT * 3);
});

test("frame background is chroma green", () => {
  const frame = paintStickFrame(CENTER_POSITION);

  // Corner and mid-margin samples must all be #00B140.
  for (const [x, y] of [[0, 0], [WIDTH - 1, 0], [0, HEIGHT - 1], [WIDTH - 1, HEIGHT - 1], [WIDTH >> 1, 4]]) {
    assert.deepEqual(colorAt(frame, x, y), [0x00, 0xb1, 0x40], `at ${x},${y}`);
  }
});

test("gimbal boxes are dark grey at their centers", () => {
  const frame = paintStickFrame(CENTER_POSITION);

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    const cx = layout.x0 + GIMBAL_LAYOUT.size / 2;
    const cy = layout.y0 + GIMBAL_LAYOUT.size / 2;

    // Sample beside the crosshair lines, not on them.
    assert.deepEqual(colorAt(frame, cx - 20, cy - 20), [0x40, 0x40, 0x40]);
    assert.deepEqual(colorAt(frame, cx + 30, cy + 30), [0x40, 0x40, 0x40]);
  }
});

test("crosshair axes are white", () => {
  const frame = paintStickFrame(CENTER_POSITION);

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    const cx = layout.x0 + GIMBAL_LAYOUT.size / 2;
    const cy = layout.y0 + GIMBAL_LAYOUT.size / 2;

    // Center is covered by the stick dot at (0,0); sample the
    // crosshair arms away from it.
    assert.deepEqual(colorAt(frame, layout.x0 + 5, cy), [0xff, 0xff, 0xff]);
    assert.deepEqual(colorAt(frame, cx, layout.y0 + 5), [0xff, 0xff, 0xff]);
  }
});

test("stick dot moves with position and is red", () => {
  const half = GIMBAL_LAYOUT.size / 2 - 4;

  const frame = paintStickFrame({
    left: { x: 0, y: 0 },
    right: { x: 1, y: 1 }
  });

  const rightCx = GIMBAL_LAYOUT.right.x0 + GIMBAL_LAYOUT.size / 2;
  const rightCy = GIMBAL_LAYOUT.right.y0 + GIMBAL_LAYOUT.size / 2;

  const dotX = Math.round(rightCx + half);
  const dotY = Math.round(rightCy - half);

  assert.deepEqual(colorAt(frame, dotX, dotY), [0xff, 0x00, 0x00]);
});

test("pixelRect clips out-of-bounds writes safely", () => {
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);

  assert.doesNotThrow(() => {
    pixelRect(frame, -10, -10, 400, 400, [1, 2, 3]);
    pixelDot(frame, -5, -5, 8, [9, 9, 9]);
    pixelDot(frame, WIDTH + 5, HEIGHT + 5, 8, [9, 9, 9]);
  });
});