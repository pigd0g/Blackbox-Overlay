// ======================================================
// RotorFlight-Blackbox-Video-Overlay — VALUE FORMAT / FIELD KNOWLEDGE
// ======================================================
//
// Single table of field knowledge for the v2 layout editor:
//
//   • derived telemetry sources (Armed, RPM, Volts, …) with
//     friendly labels, units, and value readers
//   • known raw-field decoders (Vbat is logged ×100, motor
//     output ×1000, …)
//   • percentage detection for the Max Value mode lock
//   • the display formatter (unit table picks decimals;
//     unknown fields print their raw logged integer)
//
// A "source id" addresses one value:
//   derived:<key>   one of DERIVED_KEYS
//   field:<name>    a main-frame column by its log name
//
// ======================================================

// Unit table → display formatting. `decimals` feeds the
// toFixed; raw fallback prints the integer as logged.
const UNIT_FORMATS = {
  V: { decimals: 2 },
  VPerCell: { decimals: 2 },
  A: { decimals: 1 },
  "°C": { decimals: 0 },
  RPM: { decimals: 0 },
  "%": { decimals: 1 },
  ms: { decimals: 0 },
  "µs": { decimals: 0 },
  g: { decimals: 2 },
  deg: { decimals: 0 }
};

// rcCommand channel knowledge: index → { field, name }.
export const RC_CHANNELS = [
  { channel: 0, field: "rcCommand[0]", name: "Roll" },
  { channel: 1, channelName: null, field: "rcCommand[1]", name: "Pitch" },
  { channel: 2, field: "rcCommand[2]", name: "Yaw" },
  { channel: 3, field: "rcCommand[3]", name: "Collective" },
  { channel: 4, field: "rcCommand[4]", name: "Throttle" }
].map(({ channel, channelName, field, name }) => ({
  channel,
  channelName,
  field,
  name
}));

const RC_BY_FIELD = new Map(RC_CHANNELS.map((c) => [c.field, c]));

// Derived telemetry entries: label, unit, read from the
// sampler state (see sceneState.js). Booleans are flags.
export const DERIVED_ENTRIES = [
  { key: "armed", label: "Armed", kind: "flag" },
  { key: "motorOn", label: "Motor On", kind: "flag" },
  { key: "throttle", label: "Throttle", kind: "flag" },
  { key: "rpm", label: "RPM", unit: "RPM", kind: "number" },
  { key: "packVolts", label: "Battery Volts", unit: "V", kind: "number" },
  { key: "perCell", label: "Volts/Cell", unit: "VPerCell", kind: "number" },
  { key: "current", label: "Current", unit: "A", kind: "number" },
  { key: "maxCurrent", label: "Max Current", unit: "A", kind: "number" },
  { key: "escTemp", label: "ESC Temp", unit: "°C", kind: "number" },
  { key: "motorPct", label: "Motor %", unit: "%", kind: "number" }
];

const DERIVED_BY_KEY = new Map(DERIVED_ENTRIES.map((e) => [e.key, e]));

// Known raw-field decoders: name → { label, unit, scale,
// offset }. Values outside the table print raw.
const RAW_DECODERS = {
  Vbat: { label: "Pack Voltage", unit: "V", scale: 1 / 100 },
  Ibat: { label: "Current", unit: "A", scale: 1 / 100 },
  Tesc: { label: "ESC Temp", unit: "°C", scale: 1 },
  headspeed: { label: "Head Speed", unit: "RPM", scale: 1 }
};

const MOTOR_RE = /^motor\[\d+\]$/;

function unitFormatter(unit) {
  const fmt = UNIT_FORMATS[unit];

  if (!fmt) {
    return null;
  }

  return (value) => value.toFixed(fmt.decimals);
}

/**
 * Source descriptor for a source id, or null when the id is
 * not recognized. Shape:
 *   { kind: "flag" | "number" | "unit" | "raw",
 *     label, unit?, scale? }
 *   kind "unit"  → decoded raw field with a unit from its
 *                  scale; formatted through the unit table
 *   kind "raw"   → unknown field: prints the logged integer
 */
export function describeSource(sourceId) {
  if (typeof sourceId === "boolean") {
    return null;
  }

  const id = String(sourceId ?? "");

  if (id.startsWith("derived:")) {
    const entry = DERIVED_BY_KEY.get(id.slice("derived:".length));

    if (!entry) {
      return null;
    }

    return {
      kind: entry.kind === "flag" ? "flag" : "unit",
      label: entry.label,
      unit: entry.unit ?? null,
      scale: 1,
      format: unitFormatter(entry.unit)
    };
  }

  if (id.startsWith("field:")) {
    const name = id.slice("field:".length);

    if (!name) {
      return null;
    }

    const rc = RC_BY_FIELD.get(name);

    if (rc) {
      return {
        kind: "number",
        label: rc.name,
        unit: "rc",
        scale: 1,
        format: (value) => String(Math.round(value))
      };
    }

    const decoder = RAW_DECODERS[name];

    if (decoder) {
      return {
        kind: "unit",
        label: decoder.label,
        unit: decoder.unit,
        scale: decoder.scale,
        format: unitFormatter(decoder.unit)
      };
    }

    if (MOTOR_RE.test(name)) {
      return {
        kind: "unit",
        label: name,
        unit: "%",
        scale: 1 / 10,
        percent: true,
        format: unitFormatter("%")
      };
    }

    return {
      kind: "raw",
      label: name,
      unit: null,
      scale: 1,
      format: (value) => `${Math.round(value)}`
    };
  }

  return null;
}

export function isFlagSource(sourceId) {
  const desc = describeSource(sourceId);

  return desc !== null && desc.kind === "flag";
}

/**
 * Percentage-based sources get a max mode locked to 100%
 * (the interview's source-driven rule): the Motor % derived
 * entry and raw motor[n] fields (logged ×10 of a percent).
 */
export function isPercentageSource(sourceId) {
  if (sourceId === "derived:motorPct") {
    return true;
  }

  return (
    typeof sourceId === "string" &&
    sourceId.startsWith("field:") &&
    MOTOR_RE.test(sourceId.slice("field:".length))
  );
}

const FLAG_ON_OFF = {
  "derived:armed": ["ARMED", "DISARMED"],
  "derived:motorOn": ["MOTOR ON", "MOTOR OFF"],
  "derived:throttle": ["THROTTLE UP", "THROTTLE DOWN"]
};

/**
 * Default label text for a source (before any per-item
 * override). Unknown sources fall back to their id.
 */
export function defaultLabel(sourceId) {
  if (sourceId === "derived:motorPct") return "MOTOR %";

  const desc = describeSource(sourceId);

  return desc ? desc.label : String(sourceId ?? "");
}

/**
 * Format one numeric value for on-screen display. Value is
 * already decoded (real volts, amps, …); the unit decides
 * decimals. Unknown units print a rounded integer.
 */
export function formatValue(value, sourceId) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  const desc = describeSource(sourceId);

  if (desc && desc.format) {
    return desc.format(value);
  }

  return `${Math.round(value)}`;
}

/** Friendly name for a stick axis pair caption, e.g. Roll · Pitch. */
export function axisPairCaption(xChannel, yChannel) {
  const name = (channel) =>
    RC_CHANNELS.find((c) => c.channel === channel)?.name ?? `RC${channel}`;

  return `${name(xChannel)} · ${name(yChannel)}`;
}