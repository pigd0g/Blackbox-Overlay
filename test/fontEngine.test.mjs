// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TTF ENGINE TESTS
// ======================================================
//
// Exercises the from-scratch TrueType parser and glyph
// rasterizer against the real bundled fonts (test skips
// cleanly if fonts/ has been pruned). The full overlay
// charset must parse, map, and rasterize for every family.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTtfFont, clearTtfCache } from "../src/render/fontEngine.js";
import { GlyphCache } from "../src/render/fontRaster.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONTS_DIR = join(ROOT, "fonts");

const HAS_FONTS = existsSync(join(FONTS_DIR, "VT323", "VT323-Regular.ttf"));

const FAMILIES = HAS_FONTS
  ? {
      vt323: join(FONTS_DIR, "VT323", "VT323-Regular.ttf"),
      geist: join(FONTS_DIR, "Geist", "static", "Geist-Regular.ttf"),
      geistBold: join(FONTS_DIR, "Geist", "static", "Geist-Bold.ttf"),
      orbitron: join(FONTS_DIR, "Orbitron", "static", "Orbitron-Regular.ttf"),
      audiowide: join(FONTS_DIR, "Audiowide", "Audiowide-Regular.ttf"),
      spaceMono: join(FONTS_DIR, "Space_Mono", "SpaceMono-Regular.ttf"),
      zenDots: join(FONTS_DIR, "Zen_Dots", "ZenDots-Regular.ttf")
    }
  : {};

// The exact character set the overlay can draw.
const OVERLAY_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.:%/°";

test("parses every bundled family with sane metrics", { skip: !HAS_FONTS }, () => {
  for (const [name, path] of Object.entries(FAMILIES)) {
    const face = loadTtfFont(path);

    assert.ok(face.unitsPerEm >= 256, `${name}: unitsPerEm`);
    assert.ok(face.numGlyphs > 100, `${name}: numGlyphs`);
    assert.ok(face.ascent > 0, `${name}: ascent`);
    assert.ok(face.descent < 0, `${name}: descent is negative`);
  }
});

test("cmap resolves the whole overlay charset incl. degree sign", { skip: !HAS_FONTS }, () => {
  for (const [name, path] of Object.entries(FAMILIES)) {
    const face = loadTtfFont(path);

    for (const char of OVERLAY_CHARSET) {
      const glyphId = face.glyphId(char);

      assert.ok(glyphId > 0, `${name}: glyph missing for ${JSON.stringify(char)}`);
      assert.ok(face.advance(char) > 0, `${name}: advance for ${JSON.stringify(char)}`);
    }
  }
});

test("unmapped characters resolve to .notdef without crashing", { skip: !HAS_FONTS }, () => {
  const face = loadTtfFont(FAMILIES.geist);

  // Geist ships a real .notdef box outline; whatever the cmap
  // answers for an unassigned codepoint, lookups stay safe.
  assert.doesNotThrow(() => face.glyphId("\uE000"));
  assert.doesNotThrow(() => face.outline(face.glyphId("\uE000")));
});

test("outline() yields non-empty contours for inked glyphs", { skip: !HAS_FONTS }, () => {
  const face = loadTtfFont(FAMILIES.geist);
  const contours = face.outline(face.glyphId("A"));

  assert.ok(contours.length >= 1);
  assert.ok(contours[0].length >= 3);

  for (const point of contours[0]) {
    assert.equal(typeof point.x, "number");
    assert.equal(typeof point.y, "number");
    assert.equal(typeof point.onCurve, "boolean");
  }

  // Space has no contours.
  assert.deepEqual(face.outline(face.glyphId(" ")), []);
});

test("parsed faces are cached per path", { skip: !HAS_FONTS }, () => {
  clearTtfCache();
  const a = loadTtfFont(FAMILIES.vt323);
  const b = loadTtfFont(FAMILIES.vt323);

  assert.equal(a, b);
  clearTtfCache();
  const c = loadTtfFont(FAMILIES.vt323);

  assert.notEqual(a, c);
});

test("rasterizer produces AA coverage for every charset glyph", { skip: !HAS_FONTS }, () => {
  for (const [name, path] of Object.entries(FAMILIES)) {
    const cache = new GlyphCache(path, 24);

    for (const char of OVERLAY_CHARSET) {
      const glyph = cache.get(char);

      assert.ok(glyph, `${name}: no bitmap for ${JSON.stringify(char)}`);
      assert.ok(glyph.width > 0 && glyph.height > 0, `${name} ${char}: empty bitmap`);

      let max = 0;
      let partial = 0;

      for (const value of glyph.bitmap) {
        if (value > max) max = value;
        if (value > 0 && value < 255) partial += 1;
      }

      assert.equal(max, 255, `${name} ${char}: no solid coverage`);
      assert.ok(partial > 0, `${name} ${char}: no anti-aliased edge pixels`);
      assert.ok(glyph.advance > 0, `${name} ${char}: zero advance`);
    }
  }
});

test("space has no ink but a real advance", { skip: !HAS_FONTS }, () => {
  const cache = new GlyphCache(FAMILIES.geist, 24);
  const space = cache.get(" ");

  assert.equal(space, null);
  assert.ok(cache.advanceOf(" ") > 0);
});

test("cap height anchors the baseline consistently", { skip: !HAS_FONTS }, () => {
  for (const path of Object.values(FAMILIES)) {
    const cache = new GlyphCache(path, 22);

    // Cap height ~ 0.5..0.9 em at these sizes.
    assert.ok(
      cache.capHeightPx >= 10 && cache.capHeightPx <= 20,
      `cap height ${cache.capHeightPx} out of range for ${path}`
    );
  }
});

test("heavier weights rasterize denser ink", { skip: !HAS_FONTS }, () => {
  const light = new GlyphCache(FAMILIES.geist, 24).get("M");
  const bold = new GlyphCache(FAMILIES.geistBold, 24).get("M");

  const ink = (glyph) =>
    glyph.bitmap.reduce((sum, value) => sum + value, 0);

  assert.ok(
    ink(bold) > ink(light),
    `bold ink ${ink(bold)} must exceed light ink ${ink(light)}`
  );
});

test("glyph cache returns the same entry for repeated gets", { skip: !HAS_FONTS }, () => {
  const cache = new GlyphCache(FAMILIES.vt323, 28);

  assert.equal(cache.get("R"), cache.get("R"));
  assert.equal(cache.get("5"), cache.get("5"));
});

test("GlyphCache accepts a preloaded face object", { skip: !HAS_FONTS }, () => {
  const face = loadTtfFont(FAMILIES.orbitron);
  const cache = new GlyphCache(face, 24);

  assert.ok(cache.get("G"));
});