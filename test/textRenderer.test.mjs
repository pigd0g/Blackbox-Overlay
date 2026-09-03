// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TEXT RENDERER TESTS
// ======================================================
//
// The facade contract: same drawText/measureText surface for
// the TTF and bitmap backends, arbitrary px sizes accepted,
// AA coverage blends src-over, shadows draw proportional
// offsets, and per-colour alpha multiplies glyph coverage.
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
import { FONT_IDS } from "../src/render/fonts.js";
import { pixelRect } from "../src/render/layout/pixelPrimitives.js";
import { colorOf } from "../src/render/themes.js";

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

test("arbitrary px sizes measure (v2 per-item sizes)", { skip: !HAS_FONTS }, () => {
  clearTextCaches();

  const renderer = createOverlayTextRenderer("vt323");
  const at22 = renderer.measureText("RPM", 22);
  const at44 = renderer.measureText("RPM", 44);

  assert.ok(at44 > at22, "bigger px → wider text");
  assert.ok(at22 > 0);
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

test("per-colour alpha multiplies glyph coverage (v2 opacity)", { skip: !HAS_FONTS }, () => {
  clearTextCaches();
  const renderer = createOverlayTextRenderer("geist");

  const opaque = blankFrame();
  const half = blankFrame();

  renderer.drawText(opaque, FRAME_W, FRAME_H, 10, 10, "RPM", [0, 0, 255], renderer.roles.value, {});
  renderer.drawText(half, FRAME_W, FRAME_H, 10, 10, "RPM", [0, 0, 255, 128], renderer.roles.value, {});

  let maxA = 0;

  for (let i = 3; i < half.length; i += 4) {
    maxA = Math.max(maxA, half[i]);
  }

  assert.ok(maxA < 255, "half-alpha text never reaches full opacity");
  assert.ok(inkPixels(opaque) > 0);
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

test("v2 text card renders label over value through the scene painter", { skip: !HAS_FONTS }, async () => {
  clearTextCaches();

  const schema = await import("../src/render/layout/layoutSchema.js");
  const { paintScene, buildSceneState } = await import("../src/render/layout/scenePainter.js");
  const themes = await import("../src/render/themes.js");

  const doc = schema.DEFAULT_LAYOUT();
  doc.canvas = { width: 320, height: 120 };
  doc.items.push(schema.createItem("text"));

  const { layout, boxes } = schema.normalizeLayout(doc);
  const theme = themes.resolveTheme("default");
  const state = buildSceneState({});

  const scene = paintScene(layout, boxes, state, theme, { alpha: true });

  // "Custom text" (the default) measured: ink must exist.
  assert.ok(inkPixels(scene) > 30, "custom text painted ink");
});

test("colour slots resolve to [r,g,b,a]", () => {
  assert.deepEqual(colorOf("#FF0000"), [255, 0, 0, 255]);
  assert.deepEqual(colorOf({ hex: "#00ff00", alpha: 50 }), [0, 255, 0, 128]);
  assert.deepEqual(colorOf(null, "#102030"), [16, 32, 48, 255]);
});

test("pixelRect honours src-over alpha", () => {
  const w = 8;
  const h = 8;
  const frame = blankFrame(w, h);

  function blankFrame(width, height) {
    return new Uint8Array(width * height * 4);
  }

  pixelRect(frame, w, h, 0, 0, w, h, [255, 0, 0, 255]);
  pixelRect(frame, w, h, 0, 0, 4, 4, [0, 0, 255, 128]);

  const offset = (1 * w + 1) * 4;

  assert.ok(Math.abs(frame[offset] - 127) <= 1, "red channel halves");
  assert.equal(frame[offset + 2], 128);
  assert.equal(frame[offset + 3], 255);
});