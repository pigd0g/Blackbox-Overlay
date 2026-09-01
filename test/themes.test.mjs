// ======================================================
// RotorFlight-Blackbox-Video-Overlay — THEME TESTS (v2)
// ======================================================
//
// Themes are STRUCTURAL defaults: fonts, card, stick, bar,
// donut slots plus background/textShadow. No per-widget
// colour keys. Overrides merge by path.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  THEMES,
  THEME_NAMES,
  resolveTheme,
  mergeThemeOverrides,
  normalizeThemeColor,
  colorOf,
  themeColorMap,
  themeHasPath
} from "../src/render/themes.js";

test("six themes ship, all with the v2 structural slots", () => {
  assert.deepEqual(THEME_NAMES, [
    "default",
    "light",
    "gunmetal",
    "charcoal",
    "slate",
    "lime"
  ]);

  for (const name of THEME_NAMES) {
    const theme = resolveTheme(name);

    assert.ok(theme.background?.hex, `${name}: background`);
    assert.ok(theme.textShadow?.hex, `${name}: textShadow`);
    assert.ok(theme.fonts.label.size > 0, `${name}: label size`);
    assert.ok(theme.fonts.value.size > 0, `${name}: value size`);
    assert.ok(theme.fonts.label.color?.hex, `${name}: label color`);
    assert.ok(theme.fonts.value.color?.hex, `${name}: value color`);
    assert.equal(theme.card.color, null, `${name}: card default none`);
    assert.ok(theme.stick.box?.hex, `${name}: stick box`);
    assert.ok(theme.stick.crosshair?.hex, `${name}: crosshair`);
    assert.ok(theme.stick.dot?.hex, `${name}: dot`);
    assert.ok(theme.bar.track?.hex, `${name}: bar track`);
    assert.ok(theme.bar.fill?.hex, `${name}: bar fill`);
    assert.ok(theme.donut.track?.hex, `${name}: donut track`);
    assert.ok(theme.donut.fill?.hex, `${name}: donut fill`);
  }
});

test("resolveTheme throws for unknown names, case-insensitive otherwise", () => {
  assert.throws(() => resolveTheme("nope"), /Unknown theme/);
  assert.deepEqual(resolveTheme("GUNMETAL").background, resolveTheme("gunmetal").background);
  assert.deepEqual(resolveTheme(undefined).background, resolveTheme("default").background);
});

test("resolveTheme never leaks the registry object", () => {
  const a = resolveTheme("default");
  const b = resolveTheme("default");

  a.stick.dot = { hex: "#000000", alpha: 100 };

  assert.equal(b.stick.dot.hex, "#ee4266");
});

test("normalizeThemeColor accepts hex strings and {hex,alpha}", () => {
  assert.deepEqual(normalizeThemeColor("#EE4266"), { hex: "#ee4266", alpha: 100 });
  assert.deepEqual(normalizeThemeColor("#abc"), { hex: "#aabbcc", alpha: 100 });
  assert.deepEqual(normalizeThemeColor({ hex: "#123456", alpha: 40 }), { hex: "#123456", alpha: 40 });
  assert.deepEqual(normalizeThemeColor({ hex: "#123456", alpha: 250 }), { hex: "#123456", alpha: 100 });
  assert.equal(normalizeThemeColor("nope"), null);
  assert.equal(normalizeThemeColor(null), null);
});

test("colorOf maps slots into paint space", () => {
  assert.deepEqual(colorOf("#FF8000"), [255, 128, 0, 255]);
  assert.deepEqual(colorOf({ hex: "#FF8000", alpha: 50 }), [255, 128, 0, 128]);
  assert.deepEqual(colorOf(null, "#102030"), [16, 32, 48, 255]);
});

test("mergeThemeOverrides assigns by path and ignores junk", () => {
  const base = resolveTheme("default");
  const merged = mergeThemeOverrides(base, {
    "stick.dot": "#00FF88",
    "fonts.label.size": 18,
    "card.accent": { hex: "#123456", alpha: 50 },
    "nonexistent.path": "#FFFFFF",
    "stick.dot": null
  });

  // dot ends as the LAST override (null drops it, keeping base).
  assert.equal(merged.stick.dot.hex, "#ee4266");
  assert.equal(merged.fonts.label.size, 18);
  assert.deepEqual(merged.card.accent, { hex: "#123456", alpha: 50 });
  assert.equal(base.stick.dot.hex, "#ee4266", "base never mutated");
});

test("mergeThemeOverrides supports colour slots only", () => {
  const merged = mergeThemeOverrides(resolveTheme("default"), {
    background: { hex: "#0A0B0C", alpha: 100 }
  });

  assert.equal(merged.background.hex, "#0a0b0c");
});

test("themeColorMap flattens hex slots for the GUI", () => {
  const map = themeColorMap(resolveTheme("default"));

  assert.equal(map["stick.dot"], "#ee4266");
  assert.equal(map["bar.fill"], "#2e7d32");
  // card.color is null by default → omitted.
  assert.equal("card.color" in map, false);
});

test("themeHasPath validates override targets", () => {
  const theme = resolveTheme("default");

  assert.equal(themeHasPath(theme, "stick.dot"), true);
  assert.equal(themeHasPath(theme, "stick.nope"), false);
  assert.equal(themeHasPath(theme, "fonts.label.size"), true);
});