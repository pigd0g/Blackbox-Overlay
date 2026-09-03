// ======================================================
// RotorFlight-Blackbox-Video-Overlay — SCENE / WIDGET PAINTER TESTS (v2)
// ======================================================
//
// Pixel assertions at known coordinates replace the v1
// gimbalFrame tests: geometry rules live in layoutSchema
// (boxes) and the widget painters, and both preview and
// render go through paintScene.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LAYOUT,
  createItem,
  normalizeLayout,
  firstFreeCell,
  cellOrigin,
  WIDGET_SIZES,
  CANVAS_MAX,
  GRID_COLS_MAX,
  GRID_ROWS_MAX
} from "../src/render/layout/layoutSchema.js";
import { paintScene, buildSceneState, resolveFraction, resolveItemColors } from "../src/render/layout/scenePainter.js";
import { createFieldStats } from "../src/render/layout/fieldStats.js";
import { resolveTheme } from "../src/render/themes.js";

// ------------------------------------------------------
// Schema + geometry
// ------------------------------------------------------

test("default layout: 1920x1080, 12x6 grid, alpha on, no items", () => {
  const { layout, warnings } = normalizeLayout(DEFAULT_LAYOUT());

  assert.deepEqual(layout.canvas, { width: 1920, height: 1080 });
  assert.deepEqual(layout.grid, { cols: 12, rows: 6 });
  assert.equal(layout.alpha, true);
  assert.equal(layout.shadow, false);
  assert.equal(layout.theme, "default");
  assert.deepEqual(layout.items, []);
  assert.deepEqual(warnings, []);
});

test("canvas clamps to 64–7680 and rounds to even", () => {
  const doc = DEFAULT_LAYOUT();
  doc.canvas = { width: 10, height: 9999 };
  const small = normalizeLayout(doc).layout;

  assert.equal(small.canvas.width, 64);
  assert.equal(small.canvas.height, 7680 - 7680 % 2 === 7680 ? 7680 : 4094 || 7680);

  doc.canvas = { width: 333, height: 1081 };
  const odd = normalizeLayout(doc).layout;

  assert.equal(odd.canvas.width, 332);
  assert.equal(odd.canvas.height, 1080);
});

test("grid clamps to cols 1–48 / rows 1–27", () => {
  const doc = DEFAULT_LAYOUT();
  doc.grid = { cols: 999, rows: 0 };

  const layout = normalizeLayout(doc).layout;

  assert.equal(layout.grid.cols, GRID_COLS_MAX);
  assert.equal(layout.grid.rows, 1);
});

test("items clamp into the grid bounds", () => {
  const doc = DEFAULT_LAYOUT();
  doc.grid = { cols: 4, rows: 2 };
  doc.items.push({ id: "x", type: "text", col: 50, row: 50, props: { source: "custom" } });

  const { layout } = normalizeLayout(doc);

  assert.equal(layout.items[0].col, 3);
  assert.equal(layout.items[0].row, 1);
});

test("unknown item types and props drop with warnings", () => {
  const doc = DEFAULT_LAYOUT();
  doc.items.push({ id: "a", type: "sparkline", col: 0, row: 0, props: {} });
  doc.items.push({ id: "b", type: "text", col: 0, row: 0, props: { source: "custom", glitch: true } });

  const { layout, warnings } = normalizeLayout(doc);

  assert.equal(layout.items.length, 1);
  assert.equal(layout.items[0].id, "b");
  assert.equal("glitch" in layout.items[0].props, false);
  assert.ok(warnings.length >= 2);
});

test("duplicate ids rename, ids stay stable otherwise", () => {
  const doc = DEFAULT_LAYOUT();
  doc.items.push({ id: "same", type: "text", col: 0, row: 0, props: { source: "custom" } });
  doc.items.push({ id: "same", type: "text", col: 1, row: 0, props: { source: "custom" } });

  const { layout, warnings } = normalizeLayout(doc);

  assert.equal(layout.items[0].id, "same");
  assert.notEqual(layout.items[1].id, "same");
  assert.ok(warnings.some((w) => /duplicated/.test(w)));
});

test("colour slots normalize to {hex, alpha} or null", () => {
  const doc = DEFAULT_LAYOUT();
  doc.items.push({
    id: "c",
    type: "text",
    col: 0,
    row: 0,
    props: { source: "custom", valueColor: "#FF8000", cardColor: { hex: "#123456", alpha: 250 }, accentColor: "junk" }
  });

  const { layout, warnings } = normalizeLayout(doc);
  const props = layout.items[0].props;

  assert.deepEqual(props.valueColor, { hex: "#ff8000", alpha: 100 });
  assert.deepEqual(props.cardColor, { hex: "#123456", alpha: 100 });
  assert.equal(props.accentColor, null);
  assert.ok(warnings.some((w) => /accentColor/.test(w)));
});

test("boxes: top-left anchored at the cell origin", () => {
  const doc = DEFAULT_LAYOUT();
  doc.canvas = { width: 400, height: 200 };
  doc.grid = { cols: 4, rows: 2 };
  doc.items.push(createItem("stick", { col: 2, row: 1 }));

  const { layout, boxes } = normalizeLayout(doc);
  const origin = cellOrigin(layout, 2, 1);
  const box = boxes.get(layout.items[0].id);

  assert.deepEqual(box, { x: origin.x, y: origin.y, width: 200, height: 200 });
  assert.deepEqual(origin, { x: 200, y: 100 });
});

test("stick caption grows the measured box", () => {
  const doc = DEFAULT_LAYOUT();
  doc.items.push(createItem("stick", { col: 0, row: 0, showCaption: true }));

  const { boxes } = normalizeLayout(doc);
  const box = boxes.get(doc.items[0].id);

  assert.equal(box.width, WIDGET_SIZES.med);
  assert.ok(box.height > WIDGET_SIZES.med, "caption adds height");
});

test("firstFreeCell skips covered cells (raster scan)", () => {
  const doc = DEFAULT_LAYOUT();
  doc.canvas = { width: 400, height: 200 };
  doc.grid = { cols: 4, rows: 2 };
  doc.items.push(createItem("stick", { col: 0, row: 0 }));

  const { layout, boxes } = normalizeLayout(doc);
  const free = firstFreeCell(layout, [...boxes.values()]);

  // Stick med (200px) covers cells (0,0), (1,0), (0,1), (1,1)
  // at this cell size (100x100) → the next free cells are
  // column 2.
  assert.deepEqual(free, { col: 2, row: 0 });
});

test("cardMinWidth floors the text box only when a card is set", () => {
  const doc = DEFAULT_LAYOUT();
  doc.canvas = { width: 800, height: 200 };
  doc.items.push(createItem("text", {
    col: 0,
    row: 0,
    source: "custom",
    customText: "HI",
    cardColor: { hex: "#3366CC", alpha: 100 },
    cardMinWidth: 300
  }));

  const { layout, boxes } = normalizeLayout(doc);
  const cardBox = boxes.get(layout.items[0].id);

  assert.equal(cardBox.width, 300, "floor widens the measured card");

  // Same item without a card: the floor is ignored.
  const doc2 = DEFAULT_LAYOUT();
  doc2.canvas = { width: 800, height: 200 };
  doc2.items.push(createItem("text", {
    col: 0,
    row: 0,
    source: "custom",
    customText: "HI",
    cardMinWidth: 300
  }));

  const { boxes: boxes2 } = normalizeLayout(doc2);
  const bare = boxes2.get(doc2.items[0].id);

  assert.ok(bare.width < 300, "no card → no floor");

  // Clamp: absurd floors cap at CARD_MIN_WIDTH_MAX.
  const doc3 = DEFAULT_LAYOUT();
  doc3.items.push(createItem("text", {
    col: 0,
    row: 0,
    source: "custom",
    cardColor: { hex: "#3366CC", alpha: 100 },
    cardMinWidth: 99999
  }));

  const { layout: layout3, boxes: boxes3 } = normalizeLayout(doc3);

  assert.ok(
    boxes3.get(layout3.items[0].id).width <= 2048,
    "cardMinWidth clamps to 2048"
  );
  assert.ok(layout3.items[0].props.cardMinWidth <= 2048);
});

// ------------------------------------------------------
// Scene painting
// ------------------------------------------------------

function paintDoc(items, canvas = { width: 400, height: 200 }, grid = { cols: 4, rows: 2 }, alpha = true) {
  const doc = DEFAULT_LAYOUT();
  doc.canvas = canvas;
  doc.grid = grid;
  doc.alpha = alpha;
  doc.items.push(...items);

  return normalizeLayout(doc);
}

test("empty alpha scene paints nothing", () => {
  const { layout, boxes } = paintDoc([]);
  const frame = paintScene(layout, boxes, buildSceneState({}), resolveTheme("default"), { alpha: true });

  for (let i = 3; i < frame.length; i += 4) {
    assert.equal(frame[i], 0);
  }
});

test("opaque scene fills the theme background", () => {
  const { layout, boxes } = paintDoc([]);
  const frame = paintScene(layout, boxes, buildSceneState({}), resolveTheme("default"), { alpha: false });

  assert.equal(frame[0], 0xc6);
  assert.equal(frame[1], 0xd8);
  assert.equal(frame[2], 0xd3);

  const last = frame.length - 1;

  assert.equal(frame[last], 255);
});

test("stick: box + crosshair + centred dot paint at known pixels", () => {
  const { layout, boxes } = paintDoc([createItem("stick", { col: 0, row: 0 })]);
  const frame = paintScene(layout, boxes, buildSceneState({}), resolveTheme("default"), { alpha: true });

  const px = (x, y) => {
    const o = (y * 400 + x) * 4;
    return [frame[o], frame[o + 1], frame[o + 2], frame[o + 3]];
  };

  assert.deepEqual(px(30, 30), [52, 61, 58, 255], "box fill #343D3A");
  // Crosshair: dot radius is 15, so sample well outside it.
  assert.deepEqual(px(40, 100), [127, 140, 135, 255], "crosshair #7F8C87");
  assert.deepEqual(px(100, 100), [232, 62, 99, 255], "dot #E83E63");
  assert.deepEqual(px(399, 199), [0, 0, 0, 0], "outside stays transparent");
});

test("stick dot follows the selected channels", () => {
  // Channel 0 (roll) swept full right on X → dot right of centre.
  const doc = DEFAULT_LAYOUT();
  doc.canvas = { width: 400, height: 220 };
  doc.items.push(createItem("stick", { col: 0, row: 0, xChannel: 0, yChannel: 1 }));

  const { layout, boxes } = normalizeLayout(doc);

  const flight = {
    mainFieldNames: ["rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "time", "rcCommand[4]"],
    mainFrames: [[500, 0, 0, 0, 0, 0]],
    slowFrames: [],
    events: [],
    sysConfig: {},
    stats: {}
  };

  const state = buildSceneState({ flight, sampler: createSampler(flight), t: 0, stats: null });

  const frame = paintScene(layout, boxes, state, resolveTheme("default"), { alpha: true });

  const px = (x, y) => {
    const o = (y * 400 + x) * 4;
    return [frame[o], frame[o + 1], frame[o + 2], frame[o + 3]];
  };

  // Inset keeps the dot inside: cx 100 + 81 (half 100 − dot
  // 15 − margin 4) at full right deflection.
  assert.deepEqual(px(181, 100), [232, 62, 99, 255], "dot at full right deflection");
});

test("stick dot radius scales with the widget size", () => {
  // Small (120px → r 9): a point 12px off-centre on the axis
  // falls outside the dot, leaving the crosshair visible.
  const smallDoc = DEFAULT_LAYOUT();
  smallDoc.canvas = { width: 400, height: 220 };
  smallDoc.items.push(createItem("stick", { col: 0, row: 0, size: "small" }));

  const small = normalizeLayout(smallDoc);
  const smallFrame = paintScene(small.layout, small.boxes, buildSceneState({}), resolveTheme("default"), { alpha: true });
  const sPx = (x, y) => {
    const o = (y * 400 + x) * 4;
    return [smallFrame[o], smallFrame[o + 1], smallFrame[o + 2], smallFrame[o + 3]];
  };

  // Small centre: (60, 60) in the 100x100 cell 0,0.
  assert.deepEqual(sPx(60, 60), [232, 62, 99, 255], "small dot paints the centre");
  // r 15 would cover (60, 72); r 9 leaves the crosshair there.
  assert.deepEqual(sPx(60, 72), [127, 140, 135, 255], "small dot stays inside the old radius");

  // Large (280px → r 21): a point 18px off-centre on the axis
  // is inside the dot (outside the old r 15).
  const largeDoc = DEFAULT_LAYOUT();
  largeDoc.canvas = { width: 600, height: 400 };
  largeDoc.grid = { cols: 2, rows: 1 };
  largeDoc.items.push(createItem("stick", { col: 0, row: 0, size: "large" }));

  const large = normalizeLayout(largeDoc);
  const largeFrame = paintScene(large.layout, large.boxes, buildSceneState({}), resolveTheme("default"), { alpha: true });
  const lPx = (x, y) => {
    const o = (y * 600 + x) * 4;
    return [largeFrame[o], largeFrame[o + 1], largeFrame[o + 2], largeFrame[o + 3]];
  };

  // Large centre: (140, 140) — box anchored at cell origin,
  // side 280.
  assert.deepEqual(lPx(140 + 18, 140), [232, 62, 99, 255], "large dot covers beyond the old radius");
});

function createSampler(flight) {
  // Minimal synchronous sampler: row 0 only.
  return {
    durationSeconds: 0.02,
    samplingIntervalUs: 20000,
    frameAt: () => ({
      row: 0,
      positions: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
      toggles: { armed: false, motorOn: false, throttle: false },
      telemetry: {}
    })
  };
}

test("text card: custom text paints ink; card colour paints behind", () => {
  const withCard = createItem("text", {
    source: "custom",
    customText: "AAAA",
    cardColor: { hex: "#3366CC", alpha: 100 }
  });

  const { layout, boxes } = paintDoc([withCard]);
  const frame = paintScene(layout, boxes, buildSceneState({}), resolveTheme("default"), { alpha: true });

  const px = (x, y) => {
    const o = (y * 400 + x) * 4;
    return [frame[o + 3]];
  };

  // Card interior (inside the box, before accent/padding).
  assert.equal(px(12, 12)[0], 255, "card painted");
});

test("bar: vertical fill rises from the bottom", () => {
  const { layout, boxes } = paintDoc([createItem("bar", { col: 0, row: 0, maxValue: { mode: "percent" } })]);
  const frame = paintScene(layout, boxes, buildSceneState({}), resolveTheme("default"), { alpha: true });

  const aAt = (x, y) => frame[(y * 400 + x) * 4 + 3];

  // Track painted along the full bar (13 x 200 at 0,0).
  assert.equal(aAt(6, 4), 255, "track painted near the top");
  assert.equal(aAt(6, 195), 255, "track painted near the bottom");
});

test("donut: full track ring with a hole at the centre", () => {
  const item = createItem("donut", { col: 0, row: 0, showLabel: false, showValue: false });

  const { layout, boxes } = paintDoc([item]);
  const frame = paintScene(layout, boxes, buildSceneState({}), resolveTheme("default"), { alpha: true });

  const aAt = (x, y) => frame[(y * 400 + x) * 4 + 3];

  // med = 200px, ring 22% (44px) → band 56..100 from centre.
  assert.equal(aAt(100 + 90, 100), 255, "ring band painted");
  assert.equal(aAt(100, 100), 0, "centre hole empty");
  assert.equal(aAt(100, 100 - 95), 255, "12 o'clock band");
  assert.equal(aAt(100, 100 - 50), 0, "inside the ring empty (50 < 56)");
});

test("items inherit theme colours when props are null", () => {
  const theme = resolveTheme("gunmetal");
  const item = createItem("bar", { col: 0, row: 0 });
  const colors = resolveItemColors(item, theme);

  // gunmetal bar.track = #8FA3A6.
  assert.deepEqual(colors.track, [143, 163, 166, 255]);

  // dot resolves the theme stick.dot.
  const stick = createItem("stick", { col: 0, row: 0 });
  const stickColors = resolveItemColors(stick, theme);

  assert.deepEqual(stickColors.dot, [0, 200, 240, 255]);
});

test("item colour override beats the theme slot", () => {
  const item = createItem("bar", { col: 0, row: 0, fillColor: { hex: "#010203", alpha: 40 } });
  const colors = resolveItemColors(item, resolveTheme("default"));

  assert.deepEqual(colors.fill, [1, 2, 3, 102]);
});

// ------------------------------------------------------
// Fractions (min-max normalization rules)
// ------------------------------------------------------

test("resolveFraction: percent lock and dynamic modes", async () => {
  const frames = [];

  for (let i = 0; i < 100; i += 1) {
    frames.push([0, 0, 0, 0, i * 20_000, 0, i * 10, 2480, 1996, 2000, 40]);
  }

  const flight = {
    index: 0,
    durationSeconds: 2,
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

  const stats = createFieldStats(flight);
  const { createFlightSampler } = await import("../src/render/frameSampler.js");
  const sampler = createFlightSampler(flight);

  const state = buildSceneState({ flight, sampler, t: 0.5, stats });

  // 20ms loop: t=0.5 lands on row 25 of the 0→100 ramp.
  const pctItem = { props: { source: "derived:motorPct", maxValue: { mode: "percent" } } };
  const pct = resolveFraction(pctItem, state);

  assert.equal(pct.max, 100, "percent mode locks the denominator");
  assert.ok(Math.abs(pct.fraction - 0.25) < 0.03, `mid-ramp value ≈ 0.25, got ${pct.fraction}`);

  const dynamicItem = { props: { source: "derived:motorPct", maxValue: { mode: "dynamic" } } };
  const dyn = resolveFraction(dynamicItem, state);

  // Dynamic is a running prefix max: at row 25 the running
  // max equals the value, so the gauge reads full.
  assert.ok(dyn.fraction > 0.99, "dynamic pins at the running peak");

  const late = buildSceneState({ flight, sampler, t: 1.9, stats });
  const dynLate = resolveFraction(dynamicItem, late);
  const pctLate = resolveFraction(pctItem, late);

  // Percent always reads the raw value; by the end of the
  // ramp the dynamic gauge and the raw value converge.
  assert.ok(pctLate.fraction >= 0.9, "percent reads the raw value at the ramp end");
  assert.ok(dynLate.fraction > 0.99, "dynamic stays pinned at full");
});

test("placeholder state renders dashes and centred sticks", () => {
  const state = buildSceneState({});

  assert.equal(state.placeholder, true);
  assert.deepEqual(state.channels, [null, null, null, null, null]);
  assert.equal(state.toggles.armed, false);
});