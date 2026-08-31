// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TEXT RENDERER TESTS
// ======================================================
//
// The facade contract: same drawText/measureText surface for
// the TTF and bitmap backends, role objects accepted as the
// sizing argument, AA coverage blends src-over, shadows draw
// proportional offsets, and the layout width budgets hold for
// every registry font.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createOverlayTextRenderer,
  clearTextCaches
} from "../src/render/textRenderer.js";
import { FONT_IDS, resolveFont } from "../src/render/fonts.js";
import { paintStickFrame, WIDTH, HEIGHT } from "../src/render/gimbalFrame.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HAS_FONTS = existsSync(join(ROOT, "fonts", "VT323", "VT323-Regular.ttf"));

const FRAME_W = 320;
const FRAME_H = 80;

function blankFrame() {
  return new Uint8Array(FRAME_W * FRAME_H * 4);
}

function inkPixels(frame) {
  let count = 0;

  for (let i = 3; i < frame.length; i += 4) {
    if (frame[i] > 0) count += 1;
  }

  return count;
}

// Column width budgets in gimbalFrame.js:
//   left text 16..180 (bar at 180) → 164px
//   right text 640..794 (+3 shadow) → 157px
const LEFT_BUDGET = 164;
const RIGHT_BUDGET = 157 - 4; // label gap included in the check below

test("registry fonts all expose the same facade", { skip: !HAS_FONTS }, () => {
  clearTextCaches();

  for (const id of FONT_IDS) {
    const renderer = createOverlayTextRenderer(id);

    assert.ok(renderer.roles.label, `${id}: label role`);
    assert.ok(renderer.roles.value, `${id}: value role`);
    assert.equal(typeof renderer.drawText, "function");
    assert.equal(typeof renderer.measureText, "function");
    assert.equal(typeof renderer.roleInkHeight("value"), "number");
    assert.ok(renderer.roleInkHeight("value") > 0);
  }
});

test("measureText is positive and stable per role", { skip: !HAS_FONTS }, () => {
  clearTextCaches();

  for (const id of FONT_IDS) {
    const renderer = createOverlayTextRenderer(id);

    const width = renderer.measureText("RPM", renderer.roles.label);

    assert.ok(width > 0, `${id}: measureText("RPM")`);
    assert.equal(
      renderer.measureText("RPM", renderer.roles.label),
      width,
      `${id}: measurement must be deterministic`
    );
    assert.equal(renderer.measureText("", renderer.roles.label), 0);
  }
});

test("ttf and bitmap widths agree on role semantics", { skip: !HAS_FONTS }, () => {
  clearTextCaches();

  const bitmap = createOverlayTextRenderer("bitmap");

  // Bitmap label role = scale 2: 5 chars x 6 px advance x 2,
  // minus the single trailing tracking scale.
  assert.equal(bitmap.measureText("ARMED", bitmap.roles.label), 5 * 6 * 2 - 2);
  assert.equal(bitmap.measureText("ARMED", bitmap.roles.value), 5 * 6 * 3 - 3);
});

test("drawText paints anti-aliased ink with the exact color", { skip: !HAS_FONTS }, () => {
  clearTextCaches();
  const renderer = createOverlayTextRenderer("geist");
  const frame = blankFrame();
  const color = [10, 220, 130];

  renderer.drawText(frame, FRAME_W, FRAME_H, 10, 20, "ARMED", color, renderer.roles.value, {});

  let solid = 0;
  let partial = 0;

  for (let i = 0; i < frame.length; i += 4) {
    if (frame[i + 3] === 255) solid += 1;
    else if (frame[i + 3] > 0) partial += 1;
  }

  assert.ok(solid > 20, "solid core pixels exist");
  assert.ok(partial > 5, "anti-aliased edge pixels exist");

  // A solid pixel carries the exact color, straight alpha.
  outer: for (let y = 0; y < FRAME_H; y += 1) {
    for (let x = 0; x < FRAME_W; x += 1) {
      const offset = (y * FRAME_W + x) * 4;

      if (frame[offset + 3] === 255 && frame[offset] === 10) {
        assert.deepEqual(
          [frame[offset], frame[offset + 1], frame[offset + 2], frame[offset + 3]],
          [10, 220, 130, 255]
        );
        break outer;
      }
    }
  }
});

test("drawText clips safely at frame edges", { skip: !HAS_FONTS }, () => {
  clearTextCaches();
  const renderer = createOverlayTextRenderer("orbitron");
  const frame = blankFrame();

  assert.doesNotThrow(() => {
    renderer.drawText(frame, FRAME_W, FRAME_H, FRAME_W - 5, FRAME_H - 5, "ARMED 22.5V", [1, 2, 3], renderer.roles.value, {});
    renderer.drawText(frame, FRAME_W, FRAME_H, -30, -10, "NEG", [1, 2, 3], renderer.roles.value, {});
  });
});

test("shadow pass draws behind and offset from the fill", { skip: !HAS_FONTS }, () => {
  clearTextCaches();
  const renderer = createOverlayTextRenderer("geist");
  const color = [255, 255, 255];
  const shadow = [0, 0, 0];

  const plain = blankFrame();
  renderer.drawText(plain, FRAME_W, FRAME_H, 10, 10, "MAX 63°C", color, renderer.roles.value, {});

  const shadowed = blankFrame();
  renderer.drawText(shadowed, FRAME_W, FRAME_H, 10, 10, "MAX 63°C", color, renderer.roles.value, { shadowColor: shadow });

  assert.ok(
    inkPixels(shadowed) > inkPixels(plain),
    "shadow adds ink"
  );

  // Shadow-only pixel: down-right of a glyph, black on alpha.
  let foundShadowPixel = false;

  for (let i = 0; i < shadowed.length && !foundShadowPixel; i += 4) {
    if (
      shadowed[i] === 0 &&
      shadowed[i + 1] === 0 &&
      shadowed[i + 2] === 0 &&
      shadowed[i + 3] === 255
    ) {
      foundShadowPixel = true;
    }
  }

  assert.ok(foundShadowPixel, "pure shadow-colored pixel exists");
});

test("width budgets hold for every registry font", { skip: !HAS_FONTS }, () => {
  clearTextCaches();

  for (const id of FONT_IDS) {
    const renderer = createOverlayTextRenderer(id);

    // Left column worst cases (value role).
    for (const text of ["MOTOR OFF", "DISARMED", "72.5%"]) {
      const width = renderer.measureText(text, renderer.roles.value);

      assert.ok(
        width <= LEFT_BUDGET,
        `${id}: "${text}" = ${width.toFixed(0)}px exceeds left budget ${LEFT_BUDGET}`
      );
    }

    // Right column worst case: label + gap + widest value.
    const gap = 4;

    const widest = Math.max(
      renderer.measureText("VBAT", renderer.roles.label) + gap +
        renderer.measureText("22.20V", renderer.roles.value),
      renderer.measureText("RPM", renderer.roles.label) + gap +
        renderer.measureText("21,840", renderer.roles.value),
      renderer.measureText("AMP", renderer.roles.label) + gap +
        renderer.measureText("120.5A", renderer.roles.value)
    );

    assert.ok(
      widest <= RIGHT_BUDGET + gap,
      `${id}: right column line = ${widest.toFixed(0)}px exceeds budget`
    );
  }
});

test("full-state frames paint text ink in both columns for every font", { skip: !HAS_FONTS }, () => {
  clearTextCaches();

  const fullState = {
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

  for (const id of FONT_IDS) {
    const frame = paintStickFrame(
      { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
      fullState,
      undefined,
      { font: id }
    );

    let leftInk = 0;
    let rightInk = 0;

    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const offset = (y * WIDTH + x) * 4;

        if (frame[offset + 3] !== 255) continue;
        if (frame[offset] === 0x40 && frame[offset + 1] === 0x40) continue; // gimbal box
        const isBackground =
          frame[offset] === 0xc6 && frame[offset + 1] === 0xd8 && frame[offset + 2] === 0xd3;

        if (isBackground) continue;

        if (x >= 14 && x < 178) leftInk += 1;
        if (x >= 638 && x < 798) rightInk += 1;
      }
    }

    assert.ok(leftInk > 100, `${id}: left column ink ${leftInk}`);
    assert.ok(rightInk > 300, `${id}: right column ink ${rightInk}`);
  }
});