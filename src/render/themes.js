// ======================================================
// RotorFlight-Blackbox-Video-Overlay — COLOR THEMES
// ======================================================
//
// One object per theme with the 16 interface colors, in
// paint order:
//
//   background   frame backdrop (fully transparent when
//               alpha rendering is on)
//   box          gimbal square fill
//   crosshair    axis lines inside the gimbal
//   dot          stick-position dot
//   labelOff     dim text (flags off, column labels)
//   rpm          RPM readout text
//   armed        ARMED flag text (the on state)
//   motor        motor on/off flag text
//   vCell        volts-per-cell column text
//   current      live current text
//   maxCurrent   max current text
//   escTemp      ESC temperature text
//   barMotor     motor-% vertical bar fill
//   barCurrent   current-vs-max vertical bar fill
//   barTrack     vertical bar track behind both fills
//   textShadow   drop-shadow color drawn under every glyph
//               (+scale px diagonally) so text stays
//               readable over busy footage
//
// Every value is an [r, g, b] triplet.
//
// ======================================================

function hex(color) {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

function theme(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, hex(value)]),
  );
}

/**
 * "#rgb" or "#rrggbb" → [r, g, b], or null when malformed
 * (wrong length, non-hex characters).
 */
export function hexToRgb(value) {
  if (typeof value !== "string") {
    return null;
  }

  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);

  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }

  const long = value.match(/^#([0-9a-f]{6})$/i);

  return long
    ? [
        parseInt(long[1].slice(0, 2), 16),
        parseInt(long[1].slice(2, 4), 16),
        parseInt(long[1].slice(4, 6), 16),
      ]
    : null;
}

export const THEME_NAMES = [
  "default",
  "light",
  "gunmetal",
  "charcoal",
  "slate",
  "lime",
];

export const THEMES = {
  // The original palette.
  default: theme({
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
    textShadow: "#3A3A3A",
  }),

  // Paper-white light theme: white text on pale gray,
  // light progress bars, light gray sticks, white dots.
  light: theme({
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
    barMotor: "#05ff6d",
    barCurrent: "#005fee",
    barTrack: "#DADCE0",
    textShadow: "#7f8183",
  }),

  // Gunmetal + Electric Cyan — clean, modern flight
  // instrumentation; the cyan dot is the focal point and
  // the amber RPM a subtle energy accent.
  gunmetal: theme({
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
    textShadow: "#0E1418",
  }),

  // Charcoal + Amber — aviation / military instrumentation.
  charcoal: theme({
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
    textShadow: "#121614",
  }),

  // Slate + Magenta — modern FPV; close to the default
  // design but more cohesive.
  slate: theme({
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
    textShadow: "#14191D",
  }),

  // Black + Lime — aggressive FPV racing / motorsport.
  lime: theme({
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
    textShadow: "#12160F",
  }),
};

export const THEME_KEYS = Object.keys(THEMES.default);

/**
 * Hex-string form of every theme, for the GUI's swatches
 * and accent wiring. Same structure as THEMES but values
 * keep their "#rrggbb" source form.
 */
export const THEME_HEX = Object.fromEntries(
  Object.entries(THEMES).map(([name, colors]) => [
    name,
    Object.fromEntries(
      Object.entries(colors).map(([key, [r, g, b]]) => [
        key,
        `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`,
      ]),
    ),
  ]),
);

/**
 * Resolve a theme by name (case-insensitive). Unknown
 * names throw with the valid options listed.
 */
export function resolveTheme(name) {
  if (!name) {
    return THEMES.default;
  }

  const key = String(name).toLowerCase();

  if (!THEME_NAMES.includes(key)) {
    throw new Error(
      `Unknown theme "${name}". Valid themes: ${THEME_NAMES.join(", ")}`,
    );
  }

  return THEMES[key];
}

/**
 * Merge user color overrides onto a base theme. Overrides
 * are a plain object of { themeKey: "#rrggbb" } hex strings
 * — unknown keys and malformed values are ignored, valid
 * entries are converted to rgb triplets. Returns a new
 * theme; the base is never mutated.
 */
export function applyThemeOverrides(baseTheme, overrides) {
  const merged = { ...baseTheme };

  if (!overrides || typeof overrides !== "object") {
    return merged;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in baseTheme)) {
      continue;
    }

    const rgb = hexToRgb(value);

    if (rgb) {
      merged[key] = rgb;
    }
  }

  return merged;
}
