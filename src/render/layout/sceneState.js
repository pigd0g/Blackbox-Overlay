// ======================================================
// RotorFlight-Blackbox-Video-Overlay — SCENE STATE (v2)
// ======================================================
//
// Resolves what every item displays for one sampled moment:
// item value resolution + per-widget Max Value modes.
//
// A "scene state" is built from:
//   • a decoded flight + sampler.sampledAt(t)  — real data
//   • or nothing at all                        — placeholder
//
// Placeholder state renders the editor's always-on preview
// with no log loaded: numeric values read "--", channels
// sit at centre, flags read OFF. The interview decision:
// one pipeline, placeholder values.
//
// ======================================================

import { clamp, detectScales } from "../stickMapping.js";
import { readTelemetry, detectCells, CURRENT_SCALE, VBAT_SCALE } from "../telemetry.js";
import { describeSource, defaultLabel, formatValue, isFlagSource } from "./valueFormat.js";

const FLAG_TEXT = {
  "derived:armed": ["ARMED", "DISARMED"],
  "derived:motorOn": ["MOTOR ON", "MOTOR OFF"],
  "derived:throttle": ["THROTTLE UP", "THROTTLE DOWN"]
};

/**
 * Build the scene state for one moment.
 *
 * Real flight:
 *   buildSceneState({ flight, sampler, t, stats })
 * Placeholder:
 *   buildSceneState({})
 *
 * Returns {
 *   t, placeholder,
 *   channels: [c0..c4] normalized [-1,1] (null absent),
 *   raw: (fieldName) => decoded number | null,
 *   derived: (key) => value | null,
 *   toggles: { armed, motorOn, throttle },
 *   stats: fieldStats | null
 * }
 */
export function buildSceneState({ flight, sampler, t, stats }) {
  if (!flight || !sampler) {
    return placeholderState(t);
  }

  const clampedT = Math.min(Math.max(Number(t) || 0, 0), Math.max(sampler.durationSeconds, 0));
  const sampled = sampler.frameAt(clampedT);

  if (!sampled) {
    return placeholderState(t);
  }

  const binding = detectScales(flight);
  const row = sampled.row;
  const frame = flight.mainFrames[row];

  const channels = readChannels(frame, binding);

  const state = {
    placeholder: false,
    t: clampedT,
    row,
    channels,
    toggles: {
      armed: sampled.toggles.armed === true,
      motorOn: sampled.toggles.motorOn === true,
      throttle: sampled.toggles.throttle === true
    },
    stats,
    frameNames: flight.mainFieldNames
  };

  state.raw = (fieldName) => {
    const index = flight.mainFieldNames.indexOf(fieldName);

    if (index < 0) {
      return null;
    }

    return decodeRawField(fieldName, Number(frame[index]));
  };

  state.derived = (key) => {
    const telemetry = sampled.telemetry ?? {};
    return telemetry[key] ?? null;
  };

  return state;
}

/** rcCommand channels normalized per-axis (detectScale rules). */
export function readChannels(frame, binding) {
  if (!frame || !binding) {
    return [null, null, null, null, null];
  }

  const { channelIndexes, scales } = binding;

  return [0, 1, 2, 3, 4].map((channel) => {
    const index = channelIndexes[channel];

    if (index === undefined || index < 0) {
      return null;
    }

    const scale = scales_ensure(binding, channel);

    if (!scale) {
      return null;
    }

    return Math.max(-1, Math.min(1, Number(frame[index]) / scale));
  });
}

function scales_ensure(binding, channel) {
  const names = ["roll", "pitch", "yaw", "collective", "throttle"];
  const key = names[channel];

  return binding.scales?.[key] ?? null;
}

function decodeRawField(fieldName, raw) {
  if (!Number.isFinite(raw)) {
    return null;
  }

  if (fieldName === "Vbat") return raw / VBAT_SCALE > 0 ? raw / VBAT_SCALE : null;
  if (fieldName === "Ibat") return raw / CURRENT_SCALE;
  if (/^motor\[\d+\]$/.test(fieldName)) return raw / 10;

  return raw;
}

// ------------------------------------------------------
// Placeholder (no log / before flight selection)
// ------------------------------------------------------

export function placeholderState(t = 0) {
  return {
    placeholder: true,
    t,
    row: 0,
    channels: [null, null, null, null, null],
    toggles: { armed: false, motorOn: false, throttle: false },
    stats: null,
    raw: () => null,
    derived: () => null
  };
}

// ------------------------------------------------------
// Item value + display resolution
// ------------------------------------------------------

/**
 * The runtime value for one item's source:
 *   { value, text } — value numeric (null unknown), text
 *   the display string ("--", "1996", "ARMED", …).
 */
export function resolveItemValue(item, state) {
  const source = item.props.source;

  if (source === "custom") {
    return { value: null, text: null, flag: null };
  }

  const flagTexts = FLAG_TEXT[source];

  if (flagTexts) {
    const key = source.slice("derived:".length);
    const on = state.toggles?.[keyFromSource(source)] === true;

    return { value: on ? 1 : 0, text: null, flag: on ? flagTexts[0] : flagTexts[1] };
  }

  let value = null;

  if (source.startsWith("derived:")) {
    value = state.derived
      ? state.derived(source.slice("derived:".length))
      : null;
  } else if (source.startsWith("field:")) {
    value = state.raw ? state.raw(source.slice("field:".length)) : null;
  }

  return {
    value,
    text: formatValue(value, source),
    flag: null
  };
}

function keyFromSource(source) {
  return source.slice("derived:".length);
}

/**
 * The max denominator for bar/donut fraction computation:
 *   percent   → 100 (source-driven lock)
 *   flightMax → whole-log min/max normalization
 *   dynamic   → running max up to the current row
 *
 * Fractions use the flight-min baseline (signed fields,
 * e.g. gyroADC, normalize from their most-negative reading
 * — the interview's "zero = flight min" rule). Percent mode
 * stays anchored at 0..100. Returns { max, fraction } with
 * fraction null when the value or range is unknown.
 */
export function resolveFraction(item, state) {
  const mode = item.props.maxValue?.mode ?? "flightMax";
  const source = item.props.source;

  if (isFlagSourceSafe(source)) {
    return { max: 1, fraction: 0 };
  }

  const value = resolveItemValue(item, state).value;

  if (!state.stats) {
    // No stats (placeholder mode): no meaningful fraction.
    return { max: null, fraction: null };
  }

  const flightStats = state.stats.flightStats(source);

  if (!flightStats || !Number.isFinite(flightStats.max)) {
    return { max: null, fraction: null };
  }

  if (value === null || value === undefined) {
    return { max: flightStats.max, fraction: null };
  }

  if (mode === "percent") {
    return { max: 100, fraction: clamp01(value / 100) };
  }

  if (mode === "dynamic") {
    const movingMaxFn = state.stats.movingMax(source);
    const dynamicMax = movingMaxFn
      ? movingMaxFn(state.row) ?? flightStats.max
      : flightStats.max;

    // Signed fields: dynamic max scales from the flight min
    // so the baseline matches flightMax mode. A so-far-flat
    // range (max == min) reads as empty, not full.
    const span = dynamicMax - flightStats.min;

    if (span <= 0) {
      return { max: dynamicMax, fraction: 0 };
    }

    return fractionFrom(flightStats.min, Math.max(dynamicMax, value), value);
  }

  // flightMax.
  return fractionFrom(flightStats.min, flightStats.max, value);
}

function fractionFrom(min, max, value) {
  if (value === null || value === undefined) {
    return { max, fraction: null };
  }

  const span = max - min;

  if (!Number.isFinite(span) || span <= 0) {
    return { max, fraction: null };
  }

  return { max, fraction: clamp01((value - min) / span) };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function isFlagSourceSafe(source) {
  return FLAG_TEXT[source] !== undefined;
}