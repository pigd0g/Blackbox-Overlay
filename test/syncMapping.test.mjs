// ======================================================
// RotorFlight-Blackbox-Video-Overlay — SYNC DRIFT TESTS
// ======================================================
//
// Pure tests for the sync drift compensation layer:
// timestamp conversion, clock-scale math, the spec's worked
// examples, normalization/clamping, and the identity
// guarantee when the feature is off.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SYNC_MODES,
  SYNC_FPS_CHOICES,
  DRIFT_PERCENT_MIN,
  defaultSyncConfig,
  normalizeSyncConfig,
  timestampSeconds,
  videoTimeForBlackboxTime,
  blackboxTimeForVideoTime,
  computeSync,
  formatSigned
} from "../src/render/syncMapping.js";

// ------------------------------------------------------
// Timestamp conversion
// ------------------------------------------------------

test("timestampSeconds: mm:ss:frame at the footage fps", () => {
  assert.ok(Math.abs(timestampSeconds({ minutes: 0, seconds: 12, frame: 18 }, 60) - 12.3) < 1e-9);
  assert.ok(Math.abs(timestampSeconds({ minutes: 1, seconds: 48, frame: 42 }, 60) - 108.7) < 1e-9);
  assert.ok(Math.abs(timestampSeconds({ minutes: 0, seconds: 0, frame: 15 }, 30) - 0.5) < 1e-9);
  assert.ok(Math.abs(timestampSeconds({ minutes: 0, seconds: 2, frame: 40 }, 120) - 2.3333333333) < 1e-8);
  assert.equal(timestampSeconds({ minutes: 0, seconds: 0, frame: 0 }, 60), 0);
});

test("timestampSeconds tolerates junk components", () => {
  assert.equal(timestampSeconds(null, 60), 0);
  assert.equal(timestampSeconds({}, 60), 0);
  assert.equal(timestampSeconds({ minutes: "x" }, 60), 0);
  assert.equal(timestampSeconds({ minutes: 1 }, 0), 60);
});

// ------------------------------------------------------
// The spec's worked example (spec §5 + §7)
// ------------------------------------------------------

function specCalculateSync() {
  return {
    mode: "calculate",
    calculate: {
      fps: 60,
      start: { minutes: 0, seconds: 12, frame: 18 },
      end: { minutes: 1, seconds: 48, frame: 42 },
      disarmGracePeriod: 5
    },
    manual: { clockDriftPercent: 0 }
  };
}

test("calculate: clean rates give exact drift and corrections", () => {
  // Footage arm→disarm 120s vs log ARM span 100s → 1.2 → +20%.
  const sync = computeSync(
    {
      mode: "calculate",
      calculate: {
        fps: 30,
        start: { minutes: 0, seconds: 0, frame: 0 },
        end: { minutes: 2, seconds: 0, frame: 0 },
        disarmGracePeriod: 0
      }
    },
    { logDurationSeconds: 130, flightSpanSeconds: 100 }
  );

  assert.equal(sync.active, true);
  assert.equal(sync.error, null);
  assert.equal(sync.armSpanUsed, true);
  assert.ok(Math.abs(sync.externalDurationSeconds - 120) < 1e-9);
  assert.ok(Math.abs(sync.blackboxDurationSeconds - 100) < 1e-9);
  assert.ok(Math.abs(sync.clockScale - 1.2) < 1e-9);
  assert.equal(sync.driftLabel, "+20.00%");
  assert.equal(sync.correction60Label, "+12.00s");
  assert.equal(sync.correctionEndLabel, "+20.00s");
  // The render still covers the FULL log × scale.
  assert.ok(Math.abs(sync.videoDurationSeconds - 130 * 1.2) < 1e-9);
});

test("calculate: grace field is ignored (span comes from ARM flags)", () => {
  // Pre-arm + post-disarm logging: log 135s, ARM span 120s.
  // A legacy grace value in the config must not move the math.
  const sync = computeSync(
    {
      mode: "calculate",
      calculate: {
        fps: 60,
        start: { minutes: 0, seconds: 0, frame: 0 },
        end: { minutes: 2, seconds: 0, frame: 0 },
        disarmGracePeriod: 5
      }
    },
    { logDurationSeconds: 135, flightSpanSeconds: 120 }
  );

  assert.ok(Math.abs(sync.blackboxDurationSeconds - 120) < 1e-9);
  assert.ok(Math.abs(sync.clockScale - 1) < 1e-9);
  assert.equal(sync.driftLabel, "0.00%");
  assert.ok(Math.abs(sync.videoDurationSeconds - 135) < 1e-9);
});

test("spec example: corrections at 60s and at end", () => {
  // Direct scale 1.0131 → +1.31%, +0.786s@60, +1.5s@114.52.
  const sync = computeSync(
    { mode: "manual", manual: { clockDriftPercent: 1.31 } },
    114.52
  );

  assert.ok(Math.abs(sync.clockScale - 1.0131) < 1e-12);
  assert.equal(sync.driftLabel, "+1.31%");
  assert.equal(sync.correction60Label, "+0.79s");
  assert.ok(Math.abs(sync.correctionEnd - 114.52 * 0.0131) < 1e-9);
  assert.equal(sync.correctionEndLabel, "+1.50s");
});

test("manual @END prefers the ARM span when available", () => {
  const sync = computeSync(
    { mode: "manual", manual: { clockDriftPercent: 1.31 } },
    { logDurationSeconds: 134.52, flightSpanSeconds: 114.52 }
  );

  assert.ok(Math.abs(sync.correctionEnd - 114.52 * 0.0131) < 1e-9);
  assert.ok(Math.abs(sync.videoDurationSeconds - 134.52 * 1.0131) < 1e-9);
});

test("negative drift: blackbox events move earlier", () => {
  const sync = computeSync(
    { mode: "manual", manual: { clockDriftPercent: -1.31 } },
    114.52
  );

  assert.ok(Math.abs(sync.clockScale - 0.9869) < 1e-12);
  assert.equal(sync.driftLabel, "-1.31%");
  assert.equal(sync.correction60Label, "-0.79s");
  assert.equal(sync.correctionEndLabel, "-1.50s");
  assert.ok(sync.videoDurationSeconds < 114.52);
});

// ------------------------------------------------------
// Mapping round-trips + the Off identity
// ------------------------------------------------------

test("video↔blackbox mappers are inverse and identity at scale 1", () => {
  assert.ok(Math.abs(videoTimeForBlackboxTime(60, 1.0131) - 60.786) < 1e-9);
  assert.ok(Math.abs(blackboxTimeForVideoTime(60.786, 1.0131) - 60) < 1e-9);
  assert.equal(videoTimeForBlackboxTime(42, 1), 42);
  assert.equal(blackboxTimeForVideoTime(42, 1), 42);

  // Degenerate scales fall back to identity rather than NaN.
  assert.equal(videoTimeForBlackboxTime(42, 0), 42);
  assert.equal(blackboxTimeForVideoTime(42, 0), 42);
});

test("off mode is the legacy identity mapping", () => {
  for (const mode of [undefined, null, "off", "banana"]) {
    const sync = computeSync(
      mode === undefined
        ? defaultSyncConfig()
        : { mode, calculate: {}, manual: {} },
      120.5
    );

    assert.equal(sync.active, false);
    assert.equal(sync.clockScale, 1);
    assert.ok(Math.abs(sync.videoDurationSeconds - 120.5) < 1e-9);
    assert.equal(sync.error, null);
  }
});

// ------------------------------------------------------
// Calculate-mode validation (spec §12)
// ------------------------------------------------------

test("calculate: end <= start is a validation error", () => {
  const base = specCalculateSync();

  base.calculate.end = { minutes: 0, seconds: 12, frame: 18 };

  const sync = computeSync(base, { logDurationSeconds: 119.52, flightSpanSeconds: 100 });

  assert.match(sync.error, /end must be after/);
  assert.equal(sync.active, false);
  assert.equal(sync.clockScale, 1);
});

test("calculate: missing ARM span points to Manual mode", () => {
  for (const timing of [
    { logDurationSeconds: 119.52, flightSpanSeconds: null },
    { logDurationSeconds: 119.52 },
    { logDurationSeconds: 119.52, flightSpanSeconds: 0 },
    { logDurationSeconds: 119.52, flightSpanSeconds: Number.NaN }
  ]) {
    const sync = computeSync(specCalculateSync(), timing);

    assert.match(sync.error, /Manual mode/);
    assert.equal(sync.active, false);
    assert.equal(sync.clockScale, 1);
    assert.equal(sync.armSpanUsed, false);
  }
});

test("calculate: zero/absent blackbox duration still needs an ARM span", () => {
  const sync = computeSync(specCalculateSync(), null);

  assert.match(sync.error, /Manual mode/);

  const bareNumber = computeSync(specCalculateSync(), 120);

  // Bare-number timing = no ARM span known → error.
  assert.match(bareNumber.error, /Manual mode/);
});

// ------------------------------------------------------
// Manual-mode validation (spec §12)
// ------------------------------------------------------

test("manual: scale <= 0 is a validation error", () => {
  const sync = computeSync(
    { mode: "manual", manual: { clockDriftPercent: -100 } },
    100
  );

  assert.match(sync.error, /scale/);
  assert.equal(sync.active, false);
  assert.equal(sync.clockScale, 1);
});

test("manual: raw -150% still resolves safely", () => {
  const sync = computeSync(
    { mode: "manual", manual: { clockDriftPercent: -150 } },
    100
  );

  assert.match(sync.error, /scale/);
});

// ------------------------------------------------------
// Normalization + clamping (config-model rules)
// ------------------------------------------------------

test("normalizeSyncConfig fills defaults for absent/junk config", () => {
  const bare = normalizeSyncConfig(undefined);

  assert.deepEqual(bare, defaultSyncConfig());
  assert.deepEqual(normalizeSyncConfig(null), defaultSyncConfig());
  assert.deepEqual(normalizeSyncConfig("junk"), defaultSyncConfig());
});

test("normalizeSyncConfig drops unknown keys with warnings", () => {
  const warnings = [];
  const sync = normalizeSyncConfig(
    {
      mode: "manual",
      bogus: 1,
      manual: { clockDriftPercent: 2.5, extra: true },
      calculate: { fps: 60, nope: 1 }
    },
    warnings
  );

  assert.equal(sync.mode, "manual");
  assert.ok(warnings.some((w) => /sync: unknown property dropped \(bogus\)/.test(w)));
  assert.ok(warnings.some((w) => /sync\.manual: unknown property dropped \(extra\)/.test(w)));
  assert.ok(warnings.some((w) => /sync\.calculate: unknown property dropped \(nope\)/.test(w)));
  assert.ok(!("bogus" in sync) && !("extra" in sync.manual) && !("nope" in sync.calculate));
});

test("normalizeSyncConfig clamps timestamps to the fps frame bound", () => {
  const warnings = [];
  const sync = normalizeSyncConfig(
    {
      mode: "calculate",
      calculate: {
        fps: 30,
        start: { minutes: -3, seconds: 75, frame: 40 },
        end: { minutes: 1200, seconds: 0, frame: 5 }
      }
    },
    warnings
  );

  assert.deepEqual(sync.calculate.start, { minutes: 0, seconds: 59, frame: 29 });
  assert.deepEqual(sync.calculate.end, { minutes: 599, seconds: 0, frame: 5 });
  assert.ok(warnings.length >= 3);
});

test("normalizeSyncConfig canonicalizes fps from the choice list", () => {
  const warnings = [];

  assert.deepEqual(
    normalizeSyncConfig({ calculate: { fps: 120 } }, warnings).calculate.fps,
    120
  );
  assert.deepEqual(
    normalizeSyncConfig({ calculate: { fps: 59.94 } }, warnings).calculate.fps,
    60
  );
  assert.ok(warnings.some((w) => /footage fps/.test(w)));
  assert.ok(SYNC_FPS_CHOICES.includes(normalizeSyncConfig({}).calculate.fps));
});

test("normalizeSyncConfig clamps grace and manual drift", () => {
  const warnings = [];
  const sync = normalizeSyncConfig(
    {
      mode: "manual",
      calculate: { disarmGracePeriod: -7 },
      manual: { clockDriftPercent: -500 }
    },
    warnings
  );

  assert.equal(sync.calculate.disarmGracePeriod, 0);
  assert.equal(sync.manual.clockDriftPercent, DRIFT_PERCENT_MIN);
  assert.ok(warnings.some((w) => /clock drift .* clamped/.test(w)));
});

test("normalizeSyncConfig rounds drift to 2 decimals; junk → 0", () => {
  assert.equal(
    normalizeSyncConfig({ manual: { clockDriftPercent: 1.3151 } }).manual.clockDriftPercent,
    1.32
  );
  assert.equal(
    normalizeSyncConfig({ manual: { clockDriftPercent: "banana" } }).manual.clockDriftPercent,
    0
  );
  assert.equal(
    normalizeSyncConfig({ manual: {} }).manual.clockDriftPercent,
    0
  );
});

test("mode falls back to off with a warning", () => {
  const warnings = [];
  const sync = normalizeSyncConfig({ mode: "auto" }, warnings);

  assert.equal(sync.mode, "off");
  assert.ok(warnings.some((w) => /unknown mode/.test(w)));
  assert.deepEqual(SYNC_MODES, ["off", "calculate", "manual"]);
});

// ------------------------------------------------------
// Readout formatting
// ------------------------------------------------------

test("formatSigned: explicit sign, 2 dp, zero unsigned", () => {
  assert.equal(formatSigned(1.31, 2, "%"), "+1.31%");
  assert.equal(formatSigned(-0.786, 2, "s"), "-0.79s");
  assert.equal(formatSigned(0, 2, "s"), "0.00s");
  assert.equal(formatSigned(0.004, 2, "s"), "0.00s");
  assert.equal(formatSigned(-0.004, 2, "s"), "0.00s");
  assert.equal(formatSigned(1.505, 2, "s"), "+1.51s");
  assert.equal(formatSigned(Number.NaN), "0.00");
});