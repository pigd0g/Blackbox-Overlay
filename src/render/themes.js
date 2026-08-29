// ======================================================
// RotorFlight-Blackbox-Video-Overlay — COLOR THEMES
// ======================================================
//
// One object per theme with the 11 interface colors, in
// paint order:
//
//   background   frame backdrop (green-screen-free chroma
//                base the editor keys out)
//   box          gimbal square fill
//   crosshair    axis lines inside the gimbal
//   dot          stick-position dot
//   toggleOff    toggle track, switch off
//   toggleOn     toggle track, switch on
//   knob         toggle knob
//   labelOff     toggle/status text when off
//   labelOn      toggle text when on
//   battery      battery volts-per-cell text
//   rpm          RPM readout text
//
// Every value is an [r, g, b] triplet.
//
// ======================================================

function hex(color) {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16)
  ];
}

function theme(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, hex(value)])
  );
}

export const THEME_NAMES = [
  "default",
  "gunmetal",
  "charcoal",
  "slate",
  "lime"
];

export const THEMES = {
  // The original palette.
  default: theme({
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
  }),

  // Gunmetal + Electric Cyan — clean, modern flight
  // instrumentation; the cyan dot is the focal point and
  // the amber RPM a subtle energy accent.
  gunmetal: theme({
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
  }),

  // Charcoal + Amber — aviation / military instrumentation.
  charcoal: theme({
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
  }),

  // Slate + Magenta — modern FPV; close to the default
  // design but more cohesive.
  slate: theme({
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
  }),

  // Black + Lime — aggressive FPV racing / motorsport.
  lime: theme({
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
  })
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
        `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
      ])
    )
  ])
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
      `Unknown theme "${name}". Valid themes: ${THEME_NAMES.join(", ")}`
    );
  }

  return THEMES[key];
}