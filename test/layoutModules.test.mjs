// ======================================================
// RotorFlight-Blackbox-Video-Overlay — LAYOUT MODULE TESTS (v2)
// ======================================================
//
// valueFormat (field knowledge, formatting, percentage
// detection) + fieldStats (min/max + running max against a
// synthetic log with known ramps) + config round-trip.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describeSource,
  formatValue,
  isPercentageSource,
  isFlagSource,
  defaultLabel,
  axisPairCaption,
  RC_CHANNELS,
  DERIVED_ENTRIES
} from "../src/render/layout/valueFormat.js";

import { createFieldStats } from "../src/render/layout/fieldStats.js";

import {
  normalizeLayout,
  DEFAULT_LAYOUT,
  createItem,
  firstFreeCell,
  cellOrigin,
  cellSize,
  SCHEMA_VERSION
} from "../src/render/layout/layoutSchema.js";

// ------------------------------------------------------
// valueFormat
// ------------------------------------------------------

test("raw field decoders: Vbat ×100, Ibat ×100, motor ×10 of percent", () => {
  const vbat = describeSource("field:Vbat");

  assert.equal(vbat.kind, "unit");
  assert.equal(vbat.unit, "V");
  assert.ok(Math.abs(vbat.scale - 0.01) < 1e-9);

  const motor = describeSource("field:motor[0]");

  assert.equal(motor.unit, "%");
  assert.equal(motor.percent, true);

  const unknown = describeSource("field:gyroADC[0]");

  assert.equal(unknown.kind, "raw");
  assert.equal(unknown.unit, null);

  assert.equal(describeSource("field:"), null);
  assert.equal(describeSource("junk"), null);
});

test("formatValue uses the unit table; unknown values print dashes", () => {
  assert.equal(formatValue(22.3, "field:Vbat"), "22.30");
  assert.equal(formatValue(73.729, "field:Ibat"), "73.7");
  assert.equal(formatValue(1996.4, "derived:rpm"), "1996");
  assert.equal(formatValue(66.8, "derived:escTemp"), "67");
  assert.equal(formatValue(71.44, "derived:motorPct"), "71.4");
  assert.equal(formatValue(null, "derived:rpm"), "--");
  assert.equal(formatValue(Number.NaN, "field:Vbat"), "--");
});

test("generic raw fields print rounded integers", () => {
  assert.equal(formatValue(1234.6, "field:gyroADC[0]"), "1235");
});

test("percentage sources: motorPct + motor[n] only", () => {
  assert.equal(isPercentageSource("derived:motorPct"), true);
  assert.equal(isPercentageSource("field:motor[0]"), true);
  assert.equal(isPercentageSource("field:motor[3]"), true);
  assert.equal(isPercentageSource("derived:rpm"), false);
  assert.equal(isPercentageSource("field:Ibat"), false);
});

test("flags are flagged; labels default friendly", () => {
  assert.equal(isFlagSource("derived:armed"), true);
  assert.equal(isFlagSource("field:Vbat"), false);
  assert.equal(defaultLabel("derived:escTemp"), "ESC Temp");
  assert.equal(defaultLabel("field:someUnknown"), "someUnknown");
});

test("rc channel captions name the pair", () => {
  assert.equal(axisPairCaption(0, 1), "Roll · Pitch");
  assert.equal(axisPairCaption(2, 3), "Yaw · Collective");
  assert.equal(axisPairCaption(9, 0), "RC9 · Roll");
});

test("rc + derived catalogs are complete", () => {
  assert.equal(RC_CHANNELS.length, 5);
  assert.equal(RC_CHANNELS.map((c) => c.name).join(","), "Roll,Pitch,Yaw,Collective,Throttle");
  assert.equal(DERIVED_ENTRIES.length, 10);

  const keys = DERIVED_ENTRIES.map((e) => e.key);

  for (const key of keys) {
    assert.ok(describeSource(`derived:${key}`), `derived:${key} describes`);
  }
});

// ------------------------------------------------------
// fieldStats (synthetic flight with known values)
// ------------------------------------------------------

function rampFlight() {
  const frames = [];

  for (let i = 0; i < 200; i += 1) {
    frames.push([
      0,               // rcCommand[0]
      0,
      0,
      0,
      i * 20_000,      // time µs
      0,
      i * 5,           // motor[0] → 0..99.5%
      2480,            // Vbat
      1000 + i * 5,    // headspeed 1000..1995
      1000 + i * 2,    // Ibat 10.00 → 13.98 A
      40               // Tesc
    ]);
  }

  return {
    index: 0,
    durationSeconds: 4,
    mainFieldNames: [
      "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time",
      "rcCommand[4]", "motor[0]", "Vbat", "headspeed", "Ibat", "Tesc"
    ],
    mainFrames: frames,
    slowFrames: [],
    events: [],
    sysConfig: {},
    stats: {}
  };
}

test("flightStats: min/max over the whole log", () => {
  const stats = createFieldStats(rampFlight());

  assert.deepEqual(stats.flightStats("derived:motorPct"), { min: 0, max: 99.5 });
  assert.deepEqual(stats.flightStats("derived:rpm"), { min: 1000, max: 1995 });
  assert.deepEqual(stats.flightStats("field:Ibat"), { min: 10, max: 13.98 });
  assert.equal(stats.flightStats("field:notThere"), null);
});

test("movingMax: running prefix max up to a row", () => {
  const stats = createFieldStats(rampFlight());
  const moving = stats.movingMax("derived:rpm");

  assert.equal(moving(0), 1000);
  assert.ok(moving(50) < moving(199));
  assert.equal(moving(199), 1995);
  assert.equal(moving(-5), null);
  assert.equal(moving(999), null);
});

test("stats cache: repeated reads are cheap and stable", () => {
  const stats = createFieldStats(rampFlight());

  assert.deepEqual(stats.flightStats("field:Ibat"), stats.flightStats("field:Ibat"));
});

// ------------------------------------------------------
// Layout round-trip
// ------------------------------------------------------

test("normalize is idempotent (round-trip)", () => {
  const doc = DEFAULT_LAYOUT();
  doc.items.push(createItem("stick", { col: 1, row: 1, showCaption: true }));
  doc.items.push(createItem("bar", { col: 3, row: 0, source: "derived:current", maxValue: { mode: "dynamic" } }));
  doc.items.push(createItem("donut", { col: 5, row: 2, size: "large" }));

  const once = normalizeLayout(doc);
  const twice = normalizeLayout(once.layout);

  assert.deepEqual(twice.layout, once.layout);
  assert.deepEqual([...twice.boxes.values()], [...once.boxes.values()]);
});

test("schema version carries; unknown versions still normalize", () => {
  const doc = DEFAULT_LAYOUT();
  doc.version = "future-42";

  const { layout, warnings } = normalizeLayout(doc);

  assert.equal(layout.version, SCHEMA_VERSION);
  assert.ok(warnings.some((w) => /version/.test(w)));
});

test("cellSize divides exactly; origins round", () => {
  const doc = DEFAULT_LAYOUT();
  doc.canvas = { width: 400, height: 200 };
  doc.grid = { cols: 3, rows: 4 };

  const { layout } = normalizeLayout(doc);
  const { cellW, cellH } = cellSize(layout);

  assert.equal(cellW, 400 / 3);
  assert.equal(cellH, 50);

  assert.deepEqual(cellOrigin(layout, 2, 3), { x: 267, y: 150 });
});

test("files: a saved layout JSON round-trips through normalize", () => {
  const doc = DEFAULT_LAYOUT();
  doc.items.push(createItem("text", { col: 0, row: 0, source: "field:Vbat", showLabel: true }));

  const { layout } = normalizeLayout(doc);
  const dir = mkdtempSync(join(tmpdir(), "rfbvo-layout-"));
  const file = join(dir, "overlay.gimbal.json");

  writeFileSync(file, JSON.stringify(layout, null, 2));

  assert.ok(existsSync(file));

  const reloaded = JSON.parse(readFileSync(file, "utf8"));
  const again = normalizeLayout(reloaded);

  assert.deepEqual(again.layout, layout);

  rmSync(dir, { recursive: true, force: true });
});