// ======================================================
// RotorFlight-Blackbox-Video-Overlay — FONT REGISTRY TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FONT,
  FONT_IDS,
  TYPOGRAPHY,
  resolveFont,
  defaultFont,
  nearestWeight,
  fontFilePath,
  fontCatalog
} from "../src/render/fonts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("default font is vt323", () => {
  assert.equal(DEFAULT_FONT, "vt323");
  assert.equal(defaultFont().id, "vt323");
  assert.equal(resolveFont(undefined).id, "vt323");
});

test("registry exposes the seven shipped fonts", () => {
  assert.deepEqual([...FONT_IDS], [
    "vt323",
    "bitmap",
    "geist",
    "orbitron",
    "audiowide",
    "spacemono",
    "zendots"
  ]);
});

test("resolveFont is case-insensitive and throws with the id list", () => {
  assert.equal(resolveFont("GEIST").id, "geist");
  assert.equal(resolveFont("SpaceMono").id, "spacemono");

  assert.throws(
    () => resolveFont("comic-sans"),
    /Unknown font "comic-sans".*vt323, bitmap/
  );
});

test("nearestWeight snaps to the closest static instance", () => {
  const geist = resolveFont("geist");

  assert.equal(nearestWeight(geist, 400), 400);
  assert.equal(nearestWeight(geist, 550), 600); // heavier for >500
  assert.equal(nearestWeight(geist, 600), 600);
  assert.equal(nearestWeight(geist, 900), 900);
  assert.equal(nearestWeight(geist, 450), 400); // lighter for <=500
  assert.equal(nearestWeight(geist, 100), 100);

  // Single-weight families snap everything to 400.
  const vt = resolveFont("vt323");

  assert.equal(nearestWeight(vt, 100), 400);
  assert.equal(nearestWeight(vt, 700), 400);
  assert.equal(nearestWeight(vt, 900), 400);
});

test("every registered weight maps to a real file on disk", () => {
  for (const id of FONT_IDS) {
    const fontDef = resolveFont(id);

    if (fontDef.source !== "ttf") {
      continue; // bitmap is virtual
    }

    for (const weight of Object.keys(fontDef.weights)) {
      const { path } = fontFilePath(fontDef, Number(weight));

      assert.ok(
        existsSync(path),
        `${id} w${weight} file missing: ${path}`
      );
      assert.ok(path.startsWith(join(ROOT, "fonts")));
    }
  }
});

test("fontFilePath rejects the bitmap backend", () => {
  assert.throws(() => fontFilePath(resolveFont("bitmap"), 400), /not file-backed/);
});

test("typography roles define label and value", () => {
  assert.ok(TYPOGRAPHY.label.sizePx < TYPOGRAPHY.value.sizePx);
  assert.equal(TYPOGRAPHY.label.bitmapScale, 2);
  assert.equal(TYPOGRAPHY.value.bitmapScale, 3);
});

test("font catalog feeds the GUI", () => {
  const catalog = fontCatalog();

  assert.equal(catalog.default, "vt323");
  assert.equal(catalog.ids.length, FONT_IDS.length);
  assert.equal(catalog.fonts.bitmap.source, "bitmap");
  assert.deepEqual(
    Object.keys(catalog.fonts.geist.weights),
    ["100", "200", "300", "400", "500", "600", "700", "800", "900"]
  );

  // Catalog paths are forward-slash web paths.
  assert.match(catalog.fonts.vt323.weights["400"], /^fonts\/VT323\//);
});