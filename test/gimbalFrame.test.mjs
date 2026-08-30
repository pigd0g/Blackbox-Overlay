// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GIMBAL FRAME PAINTER TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WIDTH,
  HEIGHT,
  GIMBAL_LAYOUT,
  paintStickFrame,
  paintVerticalBar,
  pixelRect,
  pixelDot
} from "../src/render/gimbalFrame.js";
import { pixelText, measureText, getGlyph } from "../src/render/bitmapFont.js";
import { THEMES } from "../src/render/themes.js";

function colorAt(frame, x, y) {
  const offset = (y * WIDTH + x) * 4;
  return [frame[offset], frame[offset + 1], frame[offset + 2], frame[offset + 3]];
}

const CENTER_POSITION = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };

const ALL_OFF = {
  armed: false,
  motorOn: false,
  motorPct: null,
  rpm: null,
  packVolts: null,
  perCell: null,
  current: null,
  maxCurrent: null,
  escTemp: null
};

const FULL_STATE = {
  armed: true,
  motorOn: true,
  motorPct: 72.5,
  rpm: 1996,
  packVolts: 22.2,
  perCell: 3.7,
  current: 35.6,
  maxCurrent: 35.6,
  escTemp: 63
};

test("frame buffer is 800 x 262, RGBA", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  assert.equal(WIDTH, 800);
  assert.equal(HEIGHT, 262);
  assert.equal(frame.length, WIDTH * HEIGHT * 4);

  // Width/height stay even so yuv420p encoding works.
  assert.equal(WIDTH % 2, 0);
  assert.equal(HEIGHT % 2, 0);
});

test("frame background is the theme backdrop, opaque by default", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  for (const [x, y] of [
    [0, 0],
    [WIDTH - 1, 0],
    [0, HEIGHT - 1],
    [WIDTH - 1, HEIGHT - 1],
    [WIDTH >> 1, 4]
  ]) {
    assert.deepEqual(colorAt(frame, x, y), [0xc6, 0xd8, 0xd3, 255], `at ${x},${y}`);
  }
});

test("alpha mode leaves the backdrop transparent but paints widgets", () => {
  const frame = paintStickFrame(CENTER_POSITION, FULL_STATE, THEMES.default, {
    alpha: true
  });

  // Every background sample stays untouched (0,0,0,0)…
  for (const [x, y] of [
    [2, 2],
    [WIDTH - 2, 2],
    [WIDTH - 2, HEIGHT - 2],
    [2, HEIGHT - 2],
    [WIDTH >> 1, 4]
  ]) {
    assert.deepEqual(colorAt(frame, x, y), [0, 0, 0, 0], `bg at ${x},${y}`);
  }

  // …while the gimbal boxes stay fully opaque.
  const cx = GIMBAL_LAYOUT.left.x0 + GIMBAL_LAYOUT.size / 2;
  const cy = GIMBAL_LAYOUT.left.y0 + GIMBAL_LAYOUT.size / 2;

  assert.deepEqual(colorAt(frame, cx - 60, cy - 60), [0x40, 0x40, 0x40, 255]);
});

test("gimbal boxes are dark grey away from crosshair and dot", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    const cx = layout.x0 + GIMBAL_LAYOUT.size / 2;
    const cy = layout.y0 + GIMBAL_LAYOUT.size / 2;

    assert.deepEqual(colorAt(frame, cx - 60, cy - 60), [0x40, 0x40, 0x40, 255]);
  }
});

test("crosshair axes are #92898A", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    const cx = layout.x0 + GIMBAL_LAYOUT.size / 2;
    const cy = layout.y0 + GIMBAL_LAYOUT.size / 2;

    // Center is covered by the stick dot at (0,0); sample the
    // arms (inset past the rounded corners).
    assert.deepEqual(colorAt(frame, layout.x0 + 12, cy), [0x92, 0x89, 0x8a, 255]);
    assert.deepEqual(colorAt(frame, cx, layout.y0 + 12), [0x92, 0x89, 0x8a, 255]);
  }
});

test("gimbal boxes have rounded-md corners (6 px)", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    const { x0, y0, size } = layout;

    // The four extreme corner pixels must be background —
    // a sharp square would paint them grey.
    for (const [cx2, cy2] of [
      [x0, y0],
      [x0 + size - 1, y0],
      [x0, y0 + size - 1],
      [x0 + size - 1, y0 + size - 1]
    ]) {
      assert.deepEqual(
        colorAt(frame, cx2, cy2),
        [0xc6, 0xd8, 0xd3, 255],
        `corner ${cx2},${cy2} should be rounded away`
      );
    }

    // Just inside each corner arc the box paint must appear.
    assert.deepEqual(colorAt(frame, x0 + 6, y0 + 1), [0x40, 0x40, 0x40, 255]);

    // The box centre stays untouched.
    assert.deepEqual(
      colorAt(frame, x0 + size / 2 - 40, y0 + size / 2 - 40),
      [0x40, 0x40, 0x40, 255]
    );
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
  assert.deepEqual(colorAt(frame, dotX, dotY), [0xee, 0x42, 0x66, 255]);

  // …and 9 px out (inside a radius-10 dot; old radius 5 would miss).
  assert.deepEqual(colorAt(frame, dotX + 9, dotY), [0xee, 0x42, 0x66, 255]);

  // …but 11 px out is outside the new dot (gimbal grey again).
  assert.deepEqual(colorAt(frame, dotX + 11, dotY), [0x40, 0x40, 0x40, 255]);
});

test("gimbals sit inside the new 800px frame", () => {
  assert.equal(GIMBAL_LAYOUT.left.x0, 192);
  assert.equal(GIMBAL_LAYOUT.right.x0, 476);
  assert.equal(GIMBAL_LAYOUT.left.x0 + GIMBAL_LAYOUT.size, 392);

  // Both gimbals fully inside, vertically centered.
  for (const layout of [GIMBAL_LAYOUT.left, GIMBAL_LAYOUT.right]) {
    assert.ok(layout.x0 > 0);
    assert.ok(layout.x0 + layout.size < WIDTH);
    assert.ok(layout.y0 >= 0);
    assert.ok(layout.y0 + layout.size <= HEIGHT);
  }
});

test("left flag column renders OFF states in the dim label color", () => {
  const frame = paintStickFrame(CENTER_POSITION, ALL_OFF);

  // "DISARMED" at scale 2: the D's top bar lights y+0..1.
  const flagsY = GIMBAL_LAYOUT.top + 12;

  assert.deepEqual(colorAt(frame, 16 + 2, flagsY + 1), [0x24, 0x24, 0x24, 255]);
});

test("left column ARMED + MOTOR ON light up in theme colors", () => {
  const frame = paintStickFrame(CENTER_POSITION, FULL_STATE);

  // "ARMED" at scale 2: the A's top bar lights y+0..1.
  const armedY = GIMBAL_LAYOUT.top + 12;

  assert.deepEqual(colorAt(frame, 16 + 2, armedY + 0), [0x1b, 0x5e, 0x20, 255]);
});

test("right column renders RPM, VBAT, AMP, MAX, ESC labels", () => {
  const frame = paintStickFrame(CENTER_POSITION, FULL_STATE);
  const x = 700; // GIMBAL_LAYOUT.rightTextX
  const top = GIMBAL_LAYOUT.top + 12; // 44

  // RPM label top row: R glyph "11110" lights the top bar.
  assert.deepEqual(colorAt(frame, x + 1, top), [0x24, 0x24, 0x24, 255]);

  // ESC value "63°C" renders in the amber escTemp color; the
  // '6' glyph's top bar lights 4px at the value start.
  const escValueX = x + measureText("ESC", 1) + 4; // 721
  const escValueY = top + 30 * 5 - 2; // 192

  assert.deepEqual(colorAt(frame, escValueX + 4, escValueY), [0x7a, 0x5a, 0x00, 255]);
});

test("motor bar fills from the bottom with barMotor color", () => {
  const layout = GIMBAL_LAYOUT.leftBar;
  const frame = paintStickFrame(CENTER_POSITION, { ...ALL_OFF, motorPct: 50 });

  const bottomY = layout.y0 + layout.size - 1 - 1;
  const topY = layout.y0 + Math.round(layout.size * 0.5) - 2;

  // Bottom inside the fill; near the top still track.
  assert.deepEqual(
    colorAt(frame, layout.x0 + 6, bottomY),
    [0x2e, 0x7d, 0x32, 255],
    "fill color at the bottom half"
  );
  assert.notDeepEqual(colorAt(frame, layout.x0 + 6, topY), [0x2e, 0x7d, 0x32, 255]);
});

test("motor bar renders a rounded track when empty", () => {
  const layout = GIMBAL_LAYOUT.leftBar;
  const frame = paintStickFrame(CENTER_POSITION, { ...ALL_OFF, motorPct: null });

  // Track color inside the pill (not background).
  assert.deepEqual(
    colorAt(frame, layout.x0 + 6, layout.y0 + layout.size - 4),
    [0xb9, 0xc2, 0xbb, 255]
  );
});

test("current bar tracks current vs running max", () => {
  const layout = GIMBAL_LAYOUT.rightBar;

  // 35.6 A of a 40 A running peak → half-full.
  const frame = paintStickFrame(
    CENTER_POSITION,
    { ...ALL_OFF, current: 35.6, maxCurrent: 40 },
    THEMES.default
  );

  const cy = layout.y0 + layout.size - 1 - Math.round(layout.size * (35.6 / 40)) + 2;

  // Sample near the bottom: must be barCurrent fill.
  assert.deepEqual(
    colorAt(frame, layout.x0 + 6, layout.y0 + layout.size - 4),
    [0xc8, 0x77, 0x0c, 255]
  );

  // Empty state: no max → empty track.
  const empty = paintStickFrame(
    CENTER_POSITION,
    { ...ALL_OFF, current: null, maxCurrent: null },
    THEMES.default
  );

  assert.deepEqual(
    colorAt(empty, layout.x0 + 6, layout.y0 + layout.size - 4),
    [0xb9, 0xc2, 0xbb, 255]
  );
});

test("vertical fill respects the fraction bounds", () => {
  const frame = new Uint8Array(WIDTH * HEIGHT * 4);

  assert.doesNotThrow(() => {
    paintVerticalBar(
      frame,
      GIMBAL_LAYOUT.leftBar,
      1.4,
      [1, 2, 3],
      [9, 9, 9]
    );
    paintVerticalBar(
      frame,
      GIMBAL_LAYOUT.leftBar,
      -1,
      [1, 2, 3],
      [9, 9, 9]
    );
  });
});

test("themes repaint the frame: gunmetal spot-check", () => {
  const frame = paintStickFrame(
    { left: { x: 0, y: 0 }, right: { x: 1, y: 1 } },
    FULL_STATE,
    THEMES.gunmetal
  );

  // Background and dot must follow the gunmetal palette.
  assert.deepEqual(colorAt(frame, 2, 2), [0xb8, 0xc7, 0xc9, 255]);
  assert.deepEqual(colorAt(frame, WIDTH - 2, HEIGHT - 2), [0xb8, 0xc7, 0xc9, 255]);

  // The right dot sits at full deflection in FULL_STATE.
  const inset = GIMBAL_LAYOUT.size / 2 - 10 - 4;
  const dotX = Math.round(
    GIMBAL_LAYOUT.right.x0 + GIMBAL_LAYOUT.size / 2 + inset
  );
  const dotY = Math.round(
    GIMBAL_LAYOUT.right.y0 + GIMBAL_LAYOUT.size / 2 - inset
  );

  assert.deepEqual(colorAt(frame, dotX, dotY), [0x00, 0xd9, 0xff, 255]);
});

test("pixelRect clips out-of-bounds writes safely", () => {
  const frame = new Uint8Array(WIDTH * HEIGHT * 4);

  assert.doesNotThrow(() => {
    pixelRect(frame, -10, -10, 400, 400, [1, 2, 3]);
    pixelDot(frame, -5, -5, 8, [9, 9, 9]);
    pixelDot(frame, WIDTH + 5, HEIGHT + 5, 8, [9, 9, 9]);
  });
});

test("bitmap font renders the ° and / glyphs for ESC + V/C", () => {
  assert.ok(getGlyph("°"), "degree glyph missing");
  assert.ok(getGlyph("/"), "slash glyph missing");

  const frame = new Uint8Array(WIDTH * HEIGHT * 4);

  assert.doesNotThrow(() => {
    pixelText(frame, WIDTH, HEIGHT, 10, 10, "ESC 63°C V/C", [1, 2, 3], 2);
  });
});

test("bitmap font basics", () => {
  assert.equal(measureText("ARMED", 2), 5 * 12 - 2);
  assert.ok(getGlyph("A"), "glyph A missing");
  assert.equal(getGlyph("@"), null, "unknown glyphs must return null");

  // Unknown characters render as blanks (spaces advance only).
  const frame = new Uint8Array(WIDTH * HEIGHT * 4);
  const drawn = pixelText(frame, WIDTH, HEIGHT, 10, 10, "A@", [1, 2, 3], 1);
  assert.equal(drawn, measureText("A@", 1));

  // Clipping: text off the edge must not throw.
  assert.doesNotThrow(() => {
    pixelText(frame, WIDTH, HEIGHT, WIDTH - 2, HEIGHT - 2, "ARMED", [1, 2, 3], 2);
  });
});