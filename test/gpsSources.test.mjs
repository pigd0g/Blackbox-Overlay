// ======================================================
// Blackbox-Overlay — GPS SOURCE TESTS
// ======================================================
//
// GPS-derived value sources: sampler carry-forward, unit
// conversions, stats alignment, coords text, and the schema
// coercion that keeps text sources out of bar/donut.
//
// Synthetic flights follow the layoutModules/frameSampler
// convention: hand-built frames with known ramps.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeSource,
  formatValue,
  defaultLabel
} from "../src/render/layout/valueFormat.js";

import { createFieldStats } from "../src/render/layout/fieldStats.js";

import { createFlightSampler } from "../src/render/frameSampler.js";

import { normalizeLayout, createItem } from "../src/render/layout/layoutSchema.js";

import { buildSceneState, resolveItemValue } from "../src/render/layout/sceneState.js";

import { summarizeFlight } from "../src/summarize.js";

// ------------------------------------------------------
// Fixtures
// ------------------------------------------------------

const GPS_NAMES = [
  "time", "GPS_numSat", "GPS_coord[0]", "GPS_coord[1]",
  "GPS_altitude", "GPS_speed", "GPS_ground_course"
];

/**
 * 20 Hz main frames for `seconds`; GPS fixes every 5 frames
 * (4 Hz). GPS raw values ride the G-frame layout: speed in
 * cm/s, altitude cm, course deci-deg, coords ×1e7.
 */
function gpsFlight({
  seconds = 10,
  gpsStartRow = 10, // first fix after 0.5 s
  gpsEvery = 5,
  speedCmS = 5000, // → 180 km/h
  altitudeCm = 12000, // → 120 m
  numSat = 9,
  courseDeciDeg = 1234, // → 123.4°
  withCoords = true
} = {}) {
  const hz = 20;
  const frameCount = seconds * hz;
  const frames = [];

  for (let i = 0; i < frameCount; i += 1) {
    frames.push([
      0, 0, 0, 0, // rcCommand[0..3]
      i * 50_000, // time µs
      0, // rcCommand[4]
      2480 // Vbat
    ]);
  }

  const gpsFrames = [];

  for (let i = gpsStartRow; i < frameCount; i += gpsEvery) {
    const values = [i * 50_000, numSat];

    if (withCoords) {
      values.push(-373578449, 1450315218);
    } else {
      values.push(0, 0);
    }

    values.push(altitudeCm, speedCmS, courseDeciDeg);

    gpsFrames.push({ afterMainFrame: i, values });
  }

  return {
    index: 0,
    durationSeconds: seconds,
    mainFieldNames: ["rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time", "rcCommand[4]", "Vbat"],
    slowFieldNames: [],
    gpsFieldNames: GPS_NAMES,
    mainFrames: frames,
    slowFrames: [],
    gpsFrames,
    events: [],
    sysConfig: {},
    stats: {}
  };
}

/** The same flight minus any GPS evidence. */
function noGpsFlight() {
  const flight = gpsFlight();

  flight.gpsFrames = [];
  flight.gpsFieldNames = [];

  return flight;
}

// ------------------------------------------------------
// valueFormat registry
// ------------------------------------------------------

test("GPS sources describe with friendly labels + units", () => {
  const speed = describeSource("derived:gpsSpeed");

  assert.equal(speed.kind, "unit");
  assert.equal(speed.unit, "km/h");
  assert.equal(speed.label, "GPS Speed");

  const alt = describeSource("derived:gpsAltitude");

  assert.equal(alt.unit, "m");

  const course = describeSource("derived:gpsCourse");

  assert.equal(course.unit, "deg");

  const sats = describeSource("derived:gpsSats");

  assert.equal(sats.kind, "unit");
  assert.equal(sats.unit, null);

  const coords = describeSource("derived:gpsCoords");

  assert.equal(coords.kind, "text");
  assert.equal(coords.label, "GPS Coords");
});

test("GPS formatting: km/h integer, m one decimal, sats raw", () => {
  assert.equal(formatValue(123.456, "derived:gpsSpeed"), "123");
  assert.equal(formatValue(120.04, "derived:gpsAltitude"), "120.0");
  assert.equal(formatValue(9, "derived:gpsSats"), "9");
  assert.equal(formatValue(123.4, "derived:gpsCourse"), "123");
  assert.equal(formatValue(null, "derived:gpsSpeed"), "--");
  assert.equal(formatValue(null, "derived:gpsAltitude"), "--");
});

test("GPS entries are not percentage sources and not flags", () => {
  for (const id of ["gpsSpeed", "gpsAltitude", "gpsSats", "gpsCourse", "gpsCoords"]) {
    assert.equal(defaultLabel(`derived:${id}`).startsWith("GPS"), true);
  }
});

// ------------------------------------------------------
// Sampler carry-forward + conversions
// ------------------------------------------------------

test("sampler: no GPS flight → GPS telemetry keys absent", () => {
  const sampler = createFlightSampler(noGpsFlight());
  const sampled = sampler.frameAt(1);

  assert.equal(sampled.telemetry.gpsSpeed, undefined);
  assert.equal(sampled.telemetry.gpsAltitude, undefined);
  assert.equal(sampled.telemetry.gpsSats, undefined);
});

test("sampler: GPS null before first fix, held after", () => {
  const flight = gpsFlight({ gpsStartRow: 10 });
  const sampler = createFlightSampler(flight);

  // Row 5 (t=0.25s) predates the first fix at row 10 (t=0.5s).
  const early = sampler.frameAt(0.25);

  assert.equal(early.telemetry.gpsSpeed, null);
  assert.equal(early.telemetry.gpsAltitude, null);

  // After the fix the values land converted (row 11 = t 0.55s).
  const later = sampler.frameAt(0.55);

  assert.ok(Math.abs(later.telemetry.gpsSpeed - 180) < 1e-9);
  assert.ok(Math.abs(later.telemetry.gpsAltitude - 120) < 1e-9);
  assert.equal(later.telemetry.gpsSats, 9);
  assert.ok(Math.abs(later.telemetry.gpsCourse - 123.4) < 1e-9);
  assert.equal(later.telemetry.gpsLat, -373578449);
  assert.equal(later.telemetry.gpsLon, 1450315218);
});

test("sampler: GPS values hold between fixes (last fix wins)", () => {
  const flight = gpsFlight({ gpsStartRow: 0, gpsEvery: 5 });
  const sampler = createFlightSampler(flight);

  // Rows 0 and 5 carry fixes; row 7 must hold row 5's value.
  const mid = sampler.frameAt(0.3); // row 6

  assert.ok(Math.abs(mid.telemetry.gpsSpeed - 180) < 1e-9);
});

// ------------------------------------------------------
// fieldStats alignment
// ------------------------------------------------------

test("fieldStats: GPS min/max over aligned values only", () => {
  // Speed constant 180 km/h; rows before the first fix are NaN
  // and excluded, so min === max === 180.
  const stats = createFieldStats(gpsFlight({ gpsStartRow: 10 }));

  assert.deepEqual(stats.flightStats("derived:gpsSpeed"), { min: 180, max: 180 });
  assert.deepEqual(stats.flightStats("derived:gpsAltitude"), { min: 120, max: 120 });
  assert.deepEqual(stats.flightStats("derived:gpsSats"), { min: 9, max: 9 });
  assert.deepEqual(stats.flightStats("derived:gpsCourse"), { min: 123.4, max: 123.4 });
});

test("fieldStats: no GPS → null stats for GPS sources", () => {
  const stats = createFieldStats(noGpsFlight());

  assert.equal(stats.flightStats("derived:gpsSpeed"), null);
  assert.equal(stats.movingMax("derived:gpsSpeed"), null);
});

test("fieldStats: GPS movingMax follows fixes", () => {
  const flight = gpsFlight({
    gpsStartRow: 0,
    gpsEvery: 5,
    seconds: 10
  });

  // Ramp the speed across fixes: fix k carries speed (k+1)*100 cm/s.
  for (let g = 0; g < flight.gpsFrames.length; g += 1) {
    flight.gpsFrames[g].values[5] = (g + 1) * 100;
  }

  const stats = createFieldStats(flight);
  const moving = stats.movingMax("derived:gpsSpeed");

  // Fix k carries speed (k+1)*100 cm/s → (k+1)*3.6 km/h.
  // Row 6 has seen fixes 0 and 1 → max 0.036*200 = 7.2 km/h.
  assert.ok(Math.abs(moving(6) - 7.2) < 1e-9);
  // Row 40 has seen fixes 0..8 → max 0.036*900 = 32.4.
  assert.ok(Math.abs(moving(40) - 32.4) < 1e-9);
  // Fixes 0..39 → max 0.036*4000 = 144.
  assert.equal(stats.flightStats("derived:gpsSpeed").max, 144);
});

// ------------------------------------------------------
// sceneState: coords text + numeric flow
// ------------------------------------------------------

test("sceneState: numeric GPS values resolve through derived()", () => {
  const flight = gpsFlight({ gpsStartRow: 0 });
  const sampler = createFlightSampler(flight);
  const state = buildSceneState({ flight, sampler, t: 1 });

  assert.ok(Math.abs(state.derived("gpsSpeed") - 180) < 1e-9);
  assert.ok(Math.abs(state.derived("gpsAltitude") - 120) < 1e-9);
  assert.equal(state.derived("gpsSats"), 9);
  assert.ok(Math.abs(state.derived("gpsCourse") - 123.4) < 1e-9);
});

test("sceneState: gpsCoords renders text with 6 decimals", () => {
  const flight = gpsFlight({ gpsStartRow: 0 });
  const sampler = createFlightSampler(flight);
  const state = buildSceneState({ flight, sampler, t: 1 });
  const item = { props: { source: "derived:gpsCoords" } };
  const resolved = resolveItemValue(item, state);

  assert.equal(resolved.text, "-37.357845, 145.031522");
  assert.equal(resolved.value, null);
});

test("sceneState: gpsCoords shows dashes before first fix", () => {
  const flight = gpsFlight({ gpsStartRow: 10 });
  const sampler = createFlightSampler(flight);
  const state = buildSceneState({ flight, sampler, t: 0.25 });
  const item = { props: { source: "derived:gpsCoords" } };
  const resolved = resolveItemValue(item, state);

  assert.equal(resolved.text, "--");
});

test("sceneState: placeholder GPS reads dashes", () => {
  const state = buildSceneState({ t: 0 });
  const item = { props: { source: "derived:gpsSpeed" } };
  const resolved = resolveItemValue(item, state);

  assert.equal(resolved.value, null);
  assert.equal(resolved.text, "--");
});

// ------------------------------------------------------
// layoutSchema coercion
// ------------------------------------------------------

test("bar bound to gpsCoords coerces with a warning", () => {
  const doc = { items: [] };
  doc.items.push(createItem("bar", { col: 0, row: 0, source: "derived:gpsCoords" }));

  const { layout, warnings } = normalizeLayout(doc);

  assert.equal(layout.items[0].props.source, "derived:motorPct");
  assert.ok(warnings.some((w) => /non-numeric source/.test(w)));
});

test("donut bound to gpsCoords coerces to rpm", () => {
  const doc = { items: [] };
  doc.items.push(createItem("donut", { col: 1, row: 1, source: "derived:gpsCoords" }));

  const { layout, warnings } = normalizeLayout(doc);

  assert.equal(layout.items[0].props.source, "derived:rpm");
  assert.ok(warnings.some((w) => /non-numeric source/.test(w)));
});

test("text widget keeps gpsCoords; numeric GPS sources survive", () => {
  const doc = { items: [] };
  doc.items.push(createItem("text", { col: 0, row: 0, source: "derived:gpsCoords" }));
  doc.items.push(createItem("donut", { col: 2, row: 0, source: "derived:gpsSpeed", maxValue: { mode: "dynamic" } }));

  const { layout, warnings } = normalizeLayout(doc);

  assert.equal(layout.items[0].props.source, "derived:gpsCoords");
  assert.equal(layout.items[1].props.source, "derived:gpsSpeed");
  assert.equal(warnings.length, 0);
});

// ------------------------------------------------------
// summarize availability gate
// ------------------------------------------------------

test("summary.gps true only with GPS frames + fields", () => {
  assert.equal(summarizeFlight(gpsFlight()).gps, true);
  assert.equal(summarizeFlight(noGpsFlight()).gps, false);

  const missingFields = gpsFlight();

  missingFields.gpsFieldNames = ["time", "GPS_numSat"];
  assert.equal(summarizeFlight(missingFields).gps, false);
});