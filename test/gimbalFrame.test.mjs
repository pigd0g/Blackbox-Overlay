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
const ALL_OFF = { throttle: false, perCell: null, cellCount: null, rpm: null };
const FULL_STATE = { throttle: true, perCell: 4.13, cellCount: 6, rpm: 1996 };

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

test("throttle toggle lives under the left gimbal only", () => {
  const frame = paintStickFrame(CENTER_POSITION, { ...ALL_OFF, throttle: true });
  const toggleY = HEIGHT - GIMBAL_LAYOUT.toggleSpace + 10;

  // Left: toggle track, green when on, clear of the knob
  // (knob sits on the right half of the track in on state).
  assert.deepEqual(
    colorAt(frame, GIMBAL_LAYOUT.left.x0 + 8 + 4, toggleY + 10),
    [0x2e, 0x7d, 0x32],
    "left toggle track should be green when throttle is on"
  );

  // Right side: RPM text zone, no toggle track. The area
  // under the right gimbal away from any text is background.
  assert.deepEqual(
    colorAt(frame, GIMBAL_LAYOUT.right.x0 + 4, toggleY + 10),
    [0xc6, 0xd8, 0xd3],
    "right toggle must be gone (RPM readout lives there)"
  );
});

test("throttle toggle renders off and on distinctly", () => {
  const off = paintStickFrame(CENTER_POSITION, ALL_OFF);
  const on = paintStickFrame(CENTER_POSITION, { ...ALL_OFF, throttle: true });

  const toggleY = HEIGHT - GIMBAL_LAYOUT.toggleSpace + 10;
  // Sample inside the track but clear of the sliding knob
  // (knob occupies the LEFT 20 px when off, the RIGHT 18 px
  // when on — the middle of the track is safe in both).
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

test("pixel font renders THROTTLE label beside the toggle", () => {
  const frame = paintStickFrame(CENTER_POSITION, { ...FULL_STATE, throttle: true });

  const toggleY = HEIGHT - GIMBAL_LAYOUT.toggleSpace + 10;
  const labelX = GIMBAL_LAYOUT.left.x0 + 8 + 56 + 10;
  const labelY = toggleY + Math.floor((22 - 14) / 2);

  // "H" of THROTTLE: both vertical strokes are full-height
  // ("10001"), scale 2 → the left stroke lands at labelX+4..5
  // (5 px glyph + 1 px spacing × scale 2). Sample it.
  assert.deepEqual(
    colorAt(frame, labelX + 4, labelY + 2),
    [0x2e, 0x7d, 0x32],
    "THROTTLE label should be green when on"
  );

  // RPM readout on the right must show the live value. The
  // "R" glyph's left stroke ("11110"/"10001" rows) is lit the
  // full height — sample its top-left.
  const rpmLabel = "RPM 1996";
  const rpmWidth = measureText(rpmLabel, 2);
  const rpmX = WIDTH - rpmWidth - 12;

  assert.deepEqual(
    colorAt(frame, rpmX, labelY + 2),
    [0x6a, 0x38, 0x0e],
    "RPM text should render in amber"
  );

  // Battery readout centered: "6S 4.13V". The "6" glyph's
  // top bar ("00110" at scale 2) lights columns 2..5 on the
  // first row — sample there.
  const battLabel = "6S 4.13V";
  const battWidth = measureText(battLabel, 2);
  const battX = Math.floor(WIDTH / 2 - battWidth / 2);

  assert.deepEqual(
    colorAt(frame, battX + 4, labelY),
    [0x1a, 0x53, 0x74],
    "battery text should render in blue"
  );
});

test("no-data battery and RPM read as placeholders", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  // "--" centered, in the muted grey. The dash bar is row 3
  // of the 7-row glyph, scale 2 → labelY + 6..7.
  const dashX = Math.floor(WIDTH / 2 - measureText("--", 2) / 2);
  const dashY = HEIGHT - GIMBAL_LAYOUT.toggleSpace + 10 + 4 + 6;

  assert.deepEqual(colorAt(frame, dashX + 2, dashY), [0x9e, 0x9e, 0x9e]);
});

test("bitmap font basics", () => {
  assert.equal(measureText("THROTTLE", 2), 8 * 12 - 2);
  assert.ok(getGlyph("A"), "glyph A missing");
  assert.equal(getGlyph("@"), null, "unknown glyphs must return null");

  // Unknown characters render as blanks (spaces advance only).
  const frame = new Uint8Array(WIDTH * HEIGHT * 3);
  const drawn = pixelText(frame, WIDTH, HEIGHT, 10, 10, "A@", [1, 2, 3], 1);
  assert.equal(drawn, measureText("A@", 1));

  // Clipping: text off the edge must not throw.
  assert.doesNotThrow(() => {
    pixelText(frame, WIDTH, HEIGHT, WIDTH - 2, HEIGHT - 2, "THROTTLE", [1, 2, 3], 2);
  });
});