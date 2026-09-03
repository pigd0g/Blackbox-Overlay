// ======================================================
// RotorFlight-Blackbox-Video-Overlay — SYNC DRIFT COMPENSATION
// ======================================================
//
// The dedicated time-mapping layer between the blackbox
// timeline and the external-video timeline (e.g. a GoPro).
// Camera clocks and the FC's log clock run at slightly
// different rates, so the two timelines drift apart over a
// flight; a single clock-rate correction re-aligns them.
//
// The renderer and preview keep working in BLACKBOX time;
// the only affected boundary is the conversion
//
//   blackbox seconds → video seconds
//
//   videoTime = (blackboxTime − blackboxStart) × clockScale
//
// with blackboxStart = 0 (the sampler normalizes the log
// timeline to its first main frame). Telemetry values,
// blackbox timestamps and animation data are never touched —
// compensation is a time MAPPING, not a data edit.
//
// Modes:
//   off       → clockScale = 1 (the legacy FPS mapping, bit-identical)
//   calculate → clockScale = footage(arm→disarm) / log(arm→disarm):
//               the user marks the arm/disarm switch moments in
//               their footage; the log contributes the same two
//               points via the ARM flag (flightModeFlags bit 0).
//               No grace period is involved — post-disarm
//               logging simply sits outside the two known points.
//   manual    → clockScale = 1 + clockDriftPercent / 100
//
// Sign convention: POSITIVE drift means the external footage
// timeline is LONGER (slower) than the blackbox timeline, so
// blackbox events progressively move LATER in the video;
// negative drift moves them earlier.
//
// This module is pure: no imports, no I/O — the layout
// schema uses normalizeSyncConfig as its sync authority and
// the renderer/preview use computeSync + the time mappers.
//
// ======================================================

export const SYNC_MODES = ["off", "calculate", "manual"];

/** External footage FPS choices for Calculate mode. */
export const SYNC_FPS_CHOICES = [30, 60, 120];
export const SYNC_FPS_DEFAULT = 60;

/** Manual drift band: clockScale = 1 + drift/100 must stay > 0. */
export const DRIFT_PERCENT_MIN = -99.99;
export const DRIFT_PERCENT_MAX = 1000;

/** Disarm grace period: integer seconds, 0–3600. */
export const SYNC_GRACE_MAX = 3600;

/** mm:ss:frame field clamps (minutes up to 9:59:xx). */
export const SYNC_MINUTES_MAX = 599;

// ------------------------------------------------------
// Defaults + normalization (config-model authority)
// ------------------------------------------------------

/** Canonical default sync config (mode off → legacy mapping). */
export function defaultSyncConfig() {
  return {
    mode: "off",
    calculate: {
      fps: SYNC_FPS_DEFAULT,
      start: { minutes: 0, seconds: 0, frame: 0 },
      end: { minutes: 0, seconds: 0, frame: 0 },
      disarmGracePeriod: 0
    },
    manual: { clockDriftPercent: 0 }
  };
}

function clampInt(value, min, max, fallback) {
  const num = Math.round(Number(value));

  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, num));
}

function warn(warnings, message) {
  if (Array.isArray(warnings)) {
    warnings.push(message);
  }
}

function normalizeTimestamp(raw, label, fps, warnings, fallback) {
  const source = raw && typeof raw === "object" ? raw : {};

  for (const key of Object.keys(source)) {
    if (key !== "minutes" && key !== "seconds" && key !== "frame") {
      warn(warnings, `sync.${label}: unknown property dropped (${key})`);
    }
  }

  const minutes = clampInt(source.minutes, 0, SYNC_MINUTES_MAX, fallback.minutes);

  if (source.minutes !== undefined && Number(source.minutes) !== minutes) {
    warn(warnings, `sync.${label}: minutes ${JSON.stringify(source.minutes)} clamped to ${minutes}`);
  }

  const seconds = clampInt(source.seconds, 0, 59, fallback.seconds);

  if (source.seconds !== undefined && Number(source.seconds) !== seconds) {
    warn(warnings, `sync.${label}: seconds ${JSON.stringify(source.seconds)} clamped to ${seconds}`);
  }

  const frame = clampInt(source.frame, 0, Math.max(fps - 1, 0), fallback.frame);

  if (source.frame !== undefined && Number(source.frame) !== frame) {
    warn(
      warnings,
      `sync.${label}: frame ${JSON.stringify(source.frame)} clamped to ${frame} for ${fps} fps`
    );
  }

  return { minutes, seconds, frame };
}

/**
 * Strict-normalizing sync config (layout-schema conventions:
 * unknown keys dropped with a warning, invalid values
 * clamped, missing values filled from defaults). An absent
 * config yields the defaults silently (older docs).
 */
export function normalizeSyncConfig(raw, warnings = []) {
  const sync = defaultSyncConfig();

  if (!raw || typeof raw !== "object") {
    return sync;
  }

  for (const key of Object.keys(raw)) {
    if (key !== "mode" && key !== "calculate" && key !== "manual") {
      warn(warnings, `sync: unknown property dropped (${key})`);
    }
  }

  if (raw.mode !== undefined && !SYNC_MODES.includes(raw.mode)) {
    warn(warnings, `sync: unknown mode ${JSON.stringify(raw.mode)} → off`);
  }

  sync.mode = SYNC_MODES.includes(raw.mode) ? raw.mode : sync.mode;

  // ---- calculate ----
  const calc = raw.calculate && typeof raw.calculate === "object" ? raw.calculate : {};

  for (const key of Object.keys(calc)) {
    if (key !== "fps" && key !== "start" && key !== "end" && key !== "disarmGracePeriod") {
      warn(warnings, `sync.calculate: unknown property dropped (${key})`);
    }
  }

  if (calc.fps !== undefined && !SYNC_FPS_CHOICES.includes(calc.fps)) {
    warn(warnings, `sync: footage fps ${JSON.stringify(calc.fps)} → ${SYNC_FPS_DEFAULT}`);
  }

  sync.calculate.fps = SYNC_FPS_CHOICES.includes(calc.fps)
    ? calc.fps
    : sync.calculate.fps;

  sync.calculate.start = normalizeTimestamp(
    calc.start, "start", sync.calculate.fps, warnings, sync.calculate.start
  );
  sync.calculate.end = normalizeTimestamp(
    calc.end, "end", sync.calculate.fps, warnings, sync.calculate.end
  );

  sync.calculate.disarmGracePeriod = clampInt(
    calc.disarmGracePeriod, 0, SYNC_GRACE_MAX, sync.calculate.disarmGracePeriod
  );

  // ---- manual ----
  const manual = raw.manual && typeof raw.manual === "object" ? raw.manual : {};

  for (const key of Object.keys(manual)) {
    if (key !== "clockDriftPercent") {
      warn(warnings, `sync.manual: unknown property dropped (${key})`);
    }
  }

  if (manual.clockDriftPercent !== undefined) {
    const parsed = Math.round(Number(manual.clockDriftPercent) * 100) / 100;

    if (!Number.isFinite(parsed)) {
      warn(
        warnings,
        `sync: bad clock drift ${JSON.stringify(manual.clockDriftPercent)}, using 0`
      );
    } else {
      const clamped = Math.min(DRIFT_PERCENT_MAX, Math.max(DRIFT_PERCENT_MIN, parsed));

      if (clamped !== parsed) {
        warn(
          warnings,
          `sync: clock drift ${parsed}% clamped to ${clamped}% (clock scale must stay > 0)`
        );
      }

      sync.manual.clockDriftPercent = clamped;
    }
  }

  return sync;
}

// ------------------------------------------------------
// Timestamps: mm:ss:frame ↔ seconds (at the footage fps)
// ------------------------------------------------------

/** mm:ss:frame → seconds = minutes*60 + seconds + frame/fps. */
export function timestampSeconds(timestamp, fps) {
  const ts = timestamp && typeof timestamp === "object" ? timestamp : {};
  const minutes = Math.max(0, Math.round(Number(ts.minutes)) || 0);
  const seconds = Math.max(0, Math.round(Number(ts.seconds)) || 0);
  const frame = Math.max(0, Math.round(Number(ts.frame)) || 0);
  const rate = Number(fps);

  return minutes * 60 + seconds + (rate > 0 ? frame / rate : 0);
}

// ------------------------------------------------------
// Time mapping (the one conversion the pipeline applies)
// ------------------------------------------------------

/**
 * blackbox seconds → video seconds:
 *   videoTime = (blackboxTime − blackboxStart) × clockScale
 * The sampler normalizes blackboxStart to 0 (first main
 * frame), so the mapping is a plain scale.
 */
export function videoTimeForBlackboxTime(blackboxTimeSeconds, clockScale) {
  const scale = Number(clockScale);
  const time = Number(blackboxTimeSeconds);

  if (!Number.isFinite(time)) {
    return time;
  }

  return Number.isFinite(scale) && scale > 0 ? time * scale : time;
}

/**
 * video seconds → blackbox seconds (the inverse the render
 * loop and preview use: output frame N is at video time
 * N / fps, and the log row for it is sampled at video / scale).
 */
export function blackboxTimeForVideoTime(videoTimeSeconds, clockScale) {
  const scale = Number(clockScale);
  const time = Number(videoTimeSeconds);

  if (!Number.isFinite(time)) {
    return time;
  }

  return Number.isFinite(scale) && scale > 0 ? time / scale : time;
}

// ------------------------------------------------------
// Sync resolution (per render / per evaluate request)
// ------------------------------------------------------

/**
 * Resolve a sync config against the blackbox timing into the
 * values the renderer and readouts need.
 *
 * @param {object|null} sync  normalized sync config
 * @param {object|number} timing  the blackbox timeline:
 *        { logDurationSeconds, flightSpanSeconds } — or a
 *        bare number (log duration, no ARM span) for
 *        back-compat with tests/callers without a sampler.
 *        flightSpanSeconds is the detected ARM→DISARM span
 *        (frameSampler's flightSpanSeconds: first ARM flag on
 *        → first ARM flag off) or null when undetectable.
 * @returns {object} {
 *   active, mode,
 *   clockScale, driftPercent,
 *   correction60, correctionEnd,
 *   blackboxDurationSeconds,   // span the drift math used
 *   videoDurationSeconds,      // render span = log span × scale
 *   externalDurationSeconds,   // calculate mode only, else null
 *   armSpanUsed,               // calculate mode used ARM flags
 *   error,                     // validation error or null
 *   driftLabel, correction60Label, correctionEndLabel
 * }
 *
 * Calculate mode divides footage(arm→disarm) by the log's
 * detected ARM span: the user marks the arm and disarm switch
 * moments in the footage (Start/End), the log contributes the
 * same two points via flightModeFlags bit 0. No grace period
 * is involved — post-disarm logging is simply not part of the
 * span between the two known points.
 *
 * An invalid config (error set) resolves to the legacy
 * identity mapping (clockScale 1) so rendering never breaks —
 * the GUI surfaces the error and no drift value is shown.
 *
 * The render covers the FULL log span × scale (pre-arm and
 * post-disarm logging are rendered; only the scale derives
 * from the ARM span).
 */
export function computeSync(sync, timing = null) {
  const resolvedTiming = typeof timing === "number"
    ? { logDurationSeconds: timing, flightSpanSeconds: null }
    : (timing && typeof timing === "object" ? timing : {});

  const rawLog = Number(resolvedTiming.logDurationSeconds);
  const logDuration = Number.isFinite(rawLog) && rawLog > 0 ? rawLog : 0;

  const rawSpan = Number(resolvedTiming.flightSpanSeconds);
  const flightSpan = Number.isFinite(rawSpan) && rawSpan > 0 ? rawSpan : null;
  const mode = sync && typeof sync === "object" ? sync.mode : "off";

  const resolved = (overrides = {}) => ({
    active: false,
    mode: SYNC_MODES.includes(mode) ? mode : "off",
    clockScale: 1,
    driftPercent: 0,
    correction60: 0,
    correctionEnd: 0,
    blackboxDurationSeconds: logDuration,
    videoDurationSeconds: logDuration,
    externalDurationSeconds: null,
    armSpanUsed: false,
    error: null,
    driftLabel: formatSigned(0, 2, "%"),
    correction60Label: formatSigned(0, 2, "s"),
    correctionEndLabel: formatSigned(0, 2, "s"),
    ...overrides
  });

  if (!SYNC_MODES.includes(mode) || mode === "off") {
    return resolved();
  }

  if (mode === "manual") {
    const manual = sync.manual && typeof sync.manual === "object" ? sync.manual : {};
    const drift = Number(manual.clockDriftPercent);
    const clockScale = 1 + (Number.isFinite(drift) ? drift : 0) / 100;

    // A normalized config always clamps into the valid band;
    // this guard keeps raw callers safe too.
    if (!(clockScale > 0)) {
      return resolved({
        error: "Clock drift would collapse the video timeline (scale ≤ 0)."
      });
    }

    const driftPercent = (clockScale - 1) * 100;
    const correction60 = 60 * (clockScale - 1);
    const correctionEnd = (flightSpan ?? logDuration) * (clockScale - 1);

    return resolved({
      active: true,
      clockScale,
      driftPercent,
      correction60,
      correctionEnd,
      blackboxDurationSeconds: flightSpan ?? logDuration,
      videoDurationSeconds: logDuration * clockScale,
      driftLabel: formatSigned(driftPercent, 2, "%"),
      correction60Label: formatSigned(correction60, 2, "s"),
      correctionEndLabel: formatSigned(correctionEnd, 2, "s")
    });
  }

  // mode === "calculate"
  const calc = sync.calculate && typeof sync.calculate === "object" ? sync.calculate : {};
  const fps = Number(calc.fps);
  const startSeconds = timestampSeconds(calc.start, fps);
  const endSeconds = timestampSeconds(calc.end, fps);
  const externalDuration = endSeconds - startSeconds;

  if (!(externalDuration > 0)) {
    return resolved({ error: "External footage end must be after its start." });
  }

  if (flightSpan === null) {
    return resolved({
      error:
        "No ARM→DISARM span found in this log — mark the drift manually (Manual mode)."
    });
  }

  const clockScale = externalDuration / flightSpan;
  const driftPercent = (clockScale - 1) * 100;
  const correction60 = 60 * (clockScale - 1);
  const correctionEnd = flightSpan * (clockScale - 1);

  return resolved({
    active: true,
    clockScale,
    driftPercent,
    correction60,
    correctionEnd,
    blackboxDurationSeconds: flightSpan,
    videoDurationSeconds: logDuration * clockScale,
    externalDurationSeconds: externalDuration,
    armSpanUsed: true,
    driftLabel: formatSigned(driftPercent, 2, "%"),
    correction60Label: formatSigned(correction60, 2, "s"),
    correctionEndLabel: formatSigned(correctionEnd, 2, "s")
  });
}

// ------------------------------------------------------
// Readout formatting (explicit sign, 2 decimals)
// ------------------------------------------------------

/**
 * +1.31% / -0.79s / 0.00s — sign from the ROUNDED value, so
 * ±0.004 prints "0.00" without a sign (spec convention).
 */
export function formatSigned(value, digits = 2, suffix = "") {
  const factor = 10 ** digits;
  const rounded = Math.round(Number(value) * factor) / factor;

  if (!Number.isFinite(rounded)) {
    return `${(0).toFixed(digits)}${suffix}`;
  }

  const magnitude = Math.abs(rounded).toFixed(digits);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";

  return `${sign}${magnitude}${suffix}`;
}