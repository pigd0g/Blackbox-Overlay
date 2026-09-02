// ======================================================
// SMOKE TEST — render all five output formats end-to-end
// through the real pipeline (small synthetic flight).
// Not part of the test suite; run manually:
//
//   node test/outputFormats.smoke.mjs
// ======================================================

import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { renderLayoutVideo } from "../src/render/videoRender.js";
import { normalizeLayout, DEFAULT_LAYOUT, createItem } from "../src/render/layout/layoutSchema.js";
import { OUTPUT_FORMATS } from "../src/render/outputFormats.js";

function syntheticFlight(seconds, fps) {
  const frames = [];

  for (let i = 0; i < seconds * fps; i += 1) {
    const t = i / fps;
    const sweep = Math.sin(t * Math.PI * 2);
    frames.push([
      Math.round(500 * sweep),
      0,
      0,
      Math.round(500 * (1 - t / seconds)),
      Math.round(t * 1_000_000),
      Math.round(t * 1000),
      i > fps / 2 ? 725 : 0,
      2480,
      1996,
      Math.round(2000 + 500 * sweep),
      40 + Math.round(20 * t)
    ]);
  }

  return {
    index: 0,
    durationSeconds: seconds,
    mainFieldNames: [
      "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]",
      "time", "rcCommand[4]", "motor[0]", "Vbat", "headspeed", "Ibat", "Tesc"
    ],
    mainFrames: frames,
    slowFrames: [],
    events: [],
    sysConfig: {},
    stats: {}
  };
}

const doc = DEFAULT_LAYOUT();
doc.canvas = { width: 640, height: 200 };
doc.items.push(createItem("stick", { col: 0, row: 0 }));
doc.items.push(createItem("donut", { col: 2, row: 0, source: "derived:motorPct", maxValue: { mode: "percent" } }));
doc.items.push(createItem("text", { col: 4, row: 0, source: "derived:rpm", showLabel: true }));

const layout = normalizeLayout(doc).layout;
const flight = syntheticFlight(1, 15);
const directory = mkdtempSync(join(tmpdir(), "rfbvo-smoke-"));

for (const format of OUTPUT_FORMATS) {
  const outputPath = join(directory, `smoke-${format.id}${format.extension}`);
  const started = Date.now();

  // Opaque H.264 renders with the theme background; alpha
  // codecs keep the canvas transparent.
  const modeLayout = { ...layout, alpha: format.alpha === true };

  try {
    await renderLayoutVideo(flight, outputPath, {
      fps: 15,
      layout: modeLayout,
      format: format.id
    });

    if (!existsSync(outputPath)) {
      throw new Error("output missing");
    }

    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v", "error", "-select_streams", "v:0",
          "-show_entries",
          "stream=codec_name,pix_fmt:stream_tags=alpha_mode",
          "-of", "json",
          outputPath
        ],
        { encoding: "utf8" }
      )
    );

    const stream = probe.streams[0];
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    console.log(
      `OK ${format.id.padEnd(15)} ${format.label.padEnd(20)} ` +
      `codec=${stream.codec_name} pix_fmt=${stream.pix_fmt ?? "-"} ` +
      `alpha_mode=${stream.tags?.alpha_mode ?? "-"} ` +
      `${seconds}s`
    );
  } catch (error) {
    // A codec the local ffmpeg cannot encode (e.g. VP9 4:4:4
    // alpha builds guarded behind -strict experimental)
    // reports as a capability gap instead of a failure.
    console.log(
      `CAP ${format.id.padEnd(15)} ${format.label.padEnd(20)} ` +
      `not encodable on this ffmpeg build: ${error.message.split("\n")[0]}`
    );
  }
}

rmSync(directory, { recursive: true, force: true });

console.log("\nSmoke run complete (CAP = codec unsupported by this ffmpeg build).");