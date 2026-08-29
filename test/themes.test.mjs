// ======================================================
// GIMBALVID — THEME TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  THEMES,
  THEME_NAMES,
  THEME_KEYS,
  resolveTheme
} from "../src/render/themes.js";

const EXPECTED = {
  default: {
    background: "#C6D8D3",
    box: "#404040",
    crosshair: "#92898A",
    dot: "#EE4266",
    toggleOff: "#9E9E9E",
    toggleOn: "#2E7D32",
    knob: "#F5F5F5",
    labelOff: "#242424",
    labelOn: "#2E7D32",
    battery: "#1A5374",
    rpm: "#6A380E"
  },
  gunmetal: {
    background: "#B8C7C9",
    box: "#252A2E",
    crosshair: "#65727A",
    dot: "#00D9FF",
    toggleOff: "#59636A",
    toggleOn: "#00AFC7",
    knob: "#EAF4F5",
    labelOff: "#172025",
    labelOn: "#007F94",
    battery: "#176B85",
    rpm: "#B45F06"
  },
  charcoal: {
    background: "#C2CBC5",
    box: "#292C2B",
    crosshair: "#68716D",
    dot: "#FFB000",
    toggleOff: "#626865",
    toggleOn: "#4F8A4B",
    knob: "#F1F3EC",
    labelOff: "#1F2422",
    labelOn: "#4F8A4B",
    battery: "#27718A",
    rpm: "#D47B00"
  },
  slate: {
    background: "#C4D0D4",
    box: "#30363A",
    crosshair: "#727D83",
    dot: "#FF4F8B",
    toggleOff: "#626B70",
    toggleOn: "#3D9B78",
    knob: "#F3F6F7",
    labelOff: "#20272B",
    labelOn: "#2F8065",
    battery: "#287B9C",
    rpm: "#B75C3A"
  },
  lime: {
    background: "#CBD3CF",
    box: "#202522",
    crosshair: "#59615C",
    dot: "#B7FF00",
    toggleOff: "#59605B",
    toggleOn: "#78B82A",
    knob: "#F4F7F2",
    labelOff: "#18201A",
    labelOn: "#659E22",
    battery: "#27809A",
    rpm: "#E07A19"
  }
};

function rgb(hexString) {
  return [
    parseInt(hexString.slice(1, 3), 16),
    parseInt(hexString.slice(3, 5), 16),
    parseInt(hexString.slice(5, 7), 16)
  ];
}

test("every theme carries exactly the 11 interface colors", () => {
  for (const name of THEME_NAMES) {
    assert.deepEqual(Object.keys(THEMES[name]).sort(), [...THEME_KEYS].sort());
  }
});

test("theme hex values match the palette spec exactly", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    for (const [key, hex] of Object.entries(expected)) {
      assert.deepEqual(
        THEMES[name][key],
        rgb(hex),
        `${name}.${key} should be ${hex}`
      );
    }
  }
});

test("resolveTheme is case-insensitive and defaults sensibly", () => {
  assert.equal(resolveTheme("GUNMETAL"), THEMES.gunmetal);
  assert.equal(resolveTheme("Slate"), THEMES.slate);
  assert.equal(resolveTheme(undefined), THEMES.default);
  assert.equal(resolveTheme(""), THEMES.default);
  assert.equal(resolveTheme(null), THEMES.default);
});

test("resolveTheme rejects unknown names with the valid list", () => {
  assert.throws(
    () => resolveTheme("neon-pink"),
    /Unknown theme "neon-pink".*gunmetal, charcoal, slate, lime/
  );
});