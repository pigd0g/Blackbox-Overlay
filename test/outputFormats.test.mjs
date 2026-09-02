// ======================================================
// RotorFlight-Blackbox-Video-Overlay — OUTPUT FORMAT TESTS
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OUTPUT_FORMATS,
  DEFAULT_OUTPUT_FORMAT,
  resolveOutputFormat,
  outputFormatOrThrow,
  formatsForMode
} from "../src/render/outputFormats.js";

test("registry carries the alpha trio plus opaque H.264", () => {
  assert.deepEqual(
    OUTPUT_FORMATS.map((format) => format.id),
    [
      "vp9-yuva420p",
      "png-rgba",
      "prores4444-12",
      "h264-yuv420p"
    ]
  );
});

test("default format is VP9 alpha (first entry)", () => {
  assert.equal(DEFAULT_OUTPUT_FORMAT, OUTPUT_FORMATS[0].id);
  assert.equal(DEFAULT_OUTPUT_FORMAT, "vp9-yuva420p");
});

test("each format exposes id/label/extension/args", () => {
  for (const format of OUTPUT_FORMATS) {
    assert.equal(typeof format.id, "string");
    assert.ok(format.id.length > 0);
    assert.equal(typeof format.label, "string");
    assert.ok(format.label.length > 0);
    assert.match(format.extension, /^\.(mov|webm|mp4)$/);
    assert.ok(Array.isArray(format.args));
    assert.ok(format.args.length > 0);
  }
});

test("labels carry the size hint", () => {
  const byId = Object.fromEntries(
    OUTPUT_FORMATS.map((format) => [format.id, format])
  );

  assert.match(byId["prores4444-12"].label, /\(Large\)$/);
  assert.match(byId["png-rgba"].label, /\(Medium\)$/);
  assert.match(byId["vp9-yuva420p"].label, /\(Small\)$/);
  assert.match(byId["h264-yuv420p"].label, /\(Small\)$/);
});

test("encoder args match the agreed parameter sets", () => {
  const byId = Object.fromEntries(
    OUTPUT_FORMATS.map((format) => [format.id, format])
  );

  assert.deepEqual(byId["png-rgba"].args, [
    "-c:v", "png", "-pix_fmt", "rgba"
  ]);
  assert.deepEqual(byId["vp9-yuva420p"].args, [
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "30", "-b:v", "0"
  ]);
  assert.deepEqual(byId["prores4444-12"].args, [
    "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p12le"
  ]);
  assert.deepEqual(byId["h264-yuv420p"].args, [
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"
  ]);
});

test("containers: ProRes/PNG land in .mov, VP9 in .webm, H.264 in .mp4", () => {
  const byId = Object.fromEntries(
    OUTPUT_FORMATS.map((format) => [format.id, format])
  );

  assert.equal(byId["prores4444-12"].extension, ".mov");
  assert.equal(byId["png-rgba"].extension, ".mov");
  assert.equal(byId["vp9-yuva420p"].extension, ".webm");
  assert.equal(byId["h264-yuv420p"].extension, ".mp4");
});

test("alpha flags split the registry along the transparency line", () => {
  const byId = Object.fromEntries(
    OUTPUT_FORMATS.map((format) => [format.id, format])
  );

  assert.equal(byId["png-rgba"].alpha, true);
  assert.equal(byId["vp9-yuva420p"].alpha, true);
  assert.equal(byId["prores4444-12"].alpha, true);
  assert.equal(byId["h264-yuv420p"].alpha, false);
  assert.equal(byId["h264-yuv420p"].opaqueOnly, true);
});

test("formatsForMode filters by transparency", () => {
  const transparent = formatsForMode(true).map((format) => format.id);
  const opaque = formatsForMode(false).map((format) => format.id);

  assert.deepEqual(transparent, [
    "vp9-yuva420p",
    "png-rgba",
    "prores4444-12"
  ]);
  assert.deepEqual(opaque, ["h264-yuv420p"]);
});

test("resolveOutputFormat falls back to the default", () => {
  assert.equal(
    resolveOutputFormat("png-rgba").id,
    "png-rgba"
  );
  assert.equal(
    resolveOutputFormat("banana").id,
    DEFAULT_OUTPUT_FORMAT
  );
  assert.equal(resolveOutputFormat(null).id, DEFAULT_OUTPUT_FORMAT);
  assert.equal(resolveOutputFormat(undefined).id, DEFAULT_OUTPUT_FORMAT);
});

test("outputFormatOrThrow rejects unknown ids loudly", () => {
  assert.equal(outputFormatOrThrow("prores4444-12").id, "prores4444-12");
  assert.throws(() => outputFormatOrThrow("banana"), /Unknown output format/);
  assert.throws(() => outputFormatOrThrow(null), /Unknown output format/);
});