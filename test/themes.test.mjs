// ======================================================
// RotorFlight-Blackbox-Video-Overlay — THEME TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  THEMES,
  THEME_NAMES,
  THEME_KEYS,
  THEME_HEX,
  resolveTheme,
  applyThemeOverrides,
  hexToRgb
} from "../src/render/themes.js";

const EXPECTED = {
  default: {
    background: "#C6D8D3",
    box: "#404040",
    crosshair: "#92898A",
    dot: "#EE4266",
    labelOff: "#242424",
    rpm: "#6A380E",
    armed: "#1B5E20",
    motor: "#242424",
    vCell: "#1A5374",
    current: "#8E4A0B",
    maxCurrent: "#5C5C5C",
    escTemp: "#7A5A00",
    barMotor: "#2E7D32",
    barCurrent: "#C8770C",
    barTrack: "#B9C2BB",
    textShadow: "#3A3A3A"
  },
  light: {
    background: "#E8EAED",
    box: "#D2D4D8",
    crosshair: "#B0B3B8",
    dot: "#EE4266",
    labelOff: "#FFFFFF",
    rpm: "#FFFFFF",
    armed: "#FFFFFF",
    motor: "#FFFFFF",
    vCell: "#FFFFFF",
    current: "#FFFFFF",
    maxCurrent: "#FFFFFF",
    escTemp: "#FFFFFF",
    barMotor: "#05FF6D",
    barCurrent: "#005FEE",
    barTrack: "#DADCE0",
    textShadow: "#7F8183"
  },
  gunmetal: {
    background: "#B8C7C9",
    box: "#252A2E",
    crosshair: "#65727A",
    dot: "#00D9FF",
    labelOff: "#172025",
    rpm: "#B45F06",
    armed: "#00AFC7",
    motor: "#172025",
    vCell: "#176B85",
    current: "#B45F06",
    maxCurrent: "#3B4A52",
    escTemp: "#7A6114",
    barMotor: "#00AFC7",
    barCurrent: "#E07C06",
    barTrack: "#8FA3A6",
    textShadow: "#0E1418"
  },
  charcoal: {
    background: "#C2CBC5",
    box: "#292C2B",
    crosshair: "#68716D",
    dot: "#FFB000",
    labelOff: "#1F2422",
    rpm: "#D47B00",
    armed: "#4F8A4B",
    motor: "#1F2422",
    vCell: "#27718A",
    current: "#D47B00",
    maxCurrent: "#565B58",
    escTemp: "#7A6210",
    barMotor: "#4F8A4B",
    barCurrent: "#E69400",
    barTrack: "#9AA69D",
    textShadow: "#121614"
  },
  slate: {
    background: "#C4D0D4",
    box: "#30363A",
    crosshair: "#727D83",
    dot: "#FF4F8B",
    labelOff: "#20272B",
    rpm: "#B75C3A",
    armed: "#2F8065",
    motor: "#20272B",
    vCell: "#287B9C",
    current: "#B75C3A",
    maxCurrent: "#4A5459",
    escTemp: "#7C5F2E",
    barMotor: "#3D9B78",
    barCurrent: "#D96A42",
    barTrack: "#9AA6AC",
    textShadow: "#14191D"
  },
  lime: {
    background: "#CBD3CF",
    box: "#202522",
    crosshair: "#59615C",
    dot: "#B7FF00",
    labelOff: "#18201A",
    rpm: "#E07A19",
    armed: "#659E22",
    motor: "#18201A",
    vCell: "#27809A",
    current: "#E07A19",
    maxCurrent: "#4A524D",
    escTemp: "#7A610F",
    barMotor: "#78B82A",
    barCurrent: "#F08C1C",
    barTrack: "#A9B2AA",
    textShadow: "#12160F"
  }
};

function rgb(hexString) {
  return [
    parseInt(hexString.slice(1, 3), 16),
    parseInt(hexString.slice(3, 5), 16),
    parseInt(hexString.slice(5, 7), 16)
  ];
}

test("every theme carries exactly the 16 interface colors", () => {
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
    /Unknown theme "neon-pink".*light, gunmetal, charcoal, slate, lime/
  );
});

test("THEME_HEX mirrors THEMES as lowercase #rrggbb strings", () => {
  for (const name of THEME_NAMES) {
    assert.deepEqual(Object.keys(THEME_HEX[name]).sort(), [...THEME_KEYS].sort());

    for (const key of THEME_KEYS) {
      const [r, g, b] = THEMES[name][key];
      assert.equal(
        THEME_HEX[name][key],
        `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`,
        `${name}.${key} hex should round-trip the rgb triplet`
      );
    }
  }
});

test("hexToRgb parses #rgb and #rrggbb, rejects garbage", () => {
  assert.deepEqual(hexToRgb("#EE4266"), [0xee, 0x42, 0x66]);
  assert.deepEqual(hexToRgb("#f80"), [255, 136, 0]);
  assert.deepEqual(hexToRgb("#abc"), [0xaa, 0xbb, 0xcc]);
  assert.equal(hexToRgb("EE4266"), null);
  assert.deepEqual(hexToRgb("#eE4266"), [0xee, 0x42, 0x66]);
  assert.equal(hexToRgb("#12345"), null);
  assert.equal(hexToRgb("#1234567"), null);
  assert.equal(hexToRgb(""), null);
  assert.equal(hexToRgb(null), null);
  assert.equal(hexToRgb(42), null);
});

test("applyThemeOverrides merges valid keys and ignores the rest", () => {
  const merged = applyThemeOverrides(THEMES.default, {
    dot: "#00FF88",
    escTemp: "#123",
    bogusKey: "#FF0000",
    rpm: "not-a-color",
    motor: 12345
  });

  assert.deepEqual(merged.dot, [0x00, 0xff, 0x88]);
  assert.deepEqual(merged.escTemp, [0x11, 0x22, 0x33]);
  assert.equal("bogusKey" in merged, false, "unknown keys must be dropped");
  assert.deepEqual(merged.rpm, THEMES.default.rpm, "invalid hex ignored");
  assert.deepEqual(merged.motor, THEMES.default.motor, "non-string ignored");

  // The base theme is never mutated.
  assert.deepEqual(THEMES.default.dot, [0xee, 0x42, 0x66]);
});

test("applyThemeOverrides tolerates absent/odd override objects", () => {
  assert.deepEqual(
    applyThemeOverrides(THEMES.default, null),
    THEMES.default
  );
  assert.deepEqual(
    applyThemeOverrides(THEMES.default, undefined),
    THEMES.default
  );
  assert.deepEqual(applyThemeOverrides(THEMES.default, "junk"), THEMES.default);
  assert.deepEqual(applyThemeOverrides(THEMES.default, {}), THEMES.default);
});