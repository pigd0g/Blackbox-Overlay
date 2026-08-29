#!/usr/bin/env node
// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TERMINAL BLACKBOX (.bbl) READER
// ======================================================
//
// Usage:
//   rotorflight-blackbox-video-overlay <file.bbl> [--fields] [--json] [--flight N]
//                         [--video [out.mp4]] [--fps N]
//
//   --fields    list every main-frame field name per flight
//   --json      machine-readable summary (JSON on stdout)
//   --flight N  only report flight N (1-based)
//   --video     render a green-screen gimbal-stick .mp4
//   --fps N     video frame rate (default 30)
//
// Analysis arrives in phase 2; today this decodes the log,
// describes it, and renders stick-position video.
//
// ======================================================

import { readFileSync, statSync } from "node:fs";

import { decodeBblFile, looksLikeBinaryBbl } from "./src/bbl/bblDecoder.js";
import {
  renderStickVideo,
  defaultVideoPath,
  checkFfmpegAvailable
} from "./src/render/videoRender.js";
import { resolveTheme, THEME_NAMES } from "./src/render/themes.js";
import { summarizeFlight } from "./src/summarize.js";

function printUsage() {
  console.log(`RotorFlight-Blackbox-Video-Overlay — Rotorflight blackbox (.bbl) log reader

Usage:
  rotorflight-blackbox-video-overlay <file.bbl> [options]

Options:
  --fields          list main-frame field names for each flight
  --json            emit the summary as JSON
  --flight N        only show flight N (1-based)
  --video [out.mp4] render a green-screen gimbal-stick video
                    (default: <logname>-sticks.mp4)
  --fps N           video frame rate (default 30)
  --theme NAME      color theme for the video:
                    ${THEME_NAMES.join(", ")} (default: default)
  --help            show this help`);
}

function parseArgs(argv) {
  const options = {
    file: null,
    fields: false,
    json: false,
    video: null,
    fps: null,
    theme: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--fields") {
      options.fields = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--video") {
      // --video may carry its output path ("--video out.mp4");
      // plain --video falls back to the default naming.
      const next = argv[i + 1];

      if (next && !next.startsWith("--")) {
        options.video = next;
        i += 1;
      } else {
        options.video = true;
      }
    } else if (arg === "--fps") {
      i += 1;
      const value = Number(argv[i]);

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--fps must be a positive number");
      }

      options.fps = value;
    } else if (arg === "--theme") {
      i += 1;
      const name = argv[i];

      if (!name) {
        throw new Error(
          `--theme expects a name: ${THEME_NAMES.join(", ")}`
        );
      }

      // Validate early so a typo fails before any work.
      resolveTheme(name);
      options.theme = name.toLowerCase();
    } else if (arg === "--flight") {
      i += 1;
      const value = Number(argv[i]);

      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--flight expects a 1-based flight number");
      }

      options.flight = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.file === null) {
      options.file = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }

  return options;
}

function describeStats(stats) {
  const frames = stats.intraFrames + stats.interFrames;
  const parts = [`${frames} frames (${stats.intraFrames} I / ${stats.interFrames} P)`];

  if (stats.slowFrames > 0) {
    parts.push(`${stats.slowFrames} slow`);
  }

  if (stats.gpsFrames > 0) {
    parts.push(`${stats.gpsFrames} GPS`);
  }

  if (stats.eventFrames > 0) {
    parts.push(`${stats.eventFrames} events`);
  }

  if (stats.corruptFrames > 0) {
    parts.push(`${stats.corruptFrames} corrupt skipped`);
  }

  return parts.join(", ");
}

function printFlightSummary(summary, options) {
  console.log(`Flight ${summary.flight}`);
  console.log(`  Craft:        ${summary.craftName ?? "(unnamed)"}`);
  console.log(`  Firmware:     ${summary.firmware ?? "(unknown)"}`);

  if (summary.firmwareDate) {
    console.log(`  FW date:      ${summary.firmwareDate}`);
  }

  if (summary.board) {
    console.log(`  Board:        ${summary.board}`);
  }

  if (summary.logStart) {
    console.log(`  Log start:    ${summary.logStart}`);
  }

  console.log(`  Data version: ${summary.dataVersion}`);
  console.log(`  Duration:     ${summary.durationSeconds} s`);
  console.log(`  Frames:       ${describeStats({
    intraFrames: summary.mainFrameCount,
    interFrames: 0,
    slowFrames: summary.slowFrameCount,
    gpsFrames: summary.gpsFrameCount,
    eventFrames: summary.eventCount,
    corruptFrames: summary.corruptFrames
  })}`);
  console.log(`  Main fields:  ${summary.mainFieldCount}`);

  if (options.fields && summary.mainFields) {
    for (const name of summary.mainFields) {
      console.log(`    - ${name}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (!options.file) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let bytes;

  try {
    const size = statSync(options.file).size;
    bytes = new Uint8Array(
      readFileSync(options.file).buffer,
      0,
      size
    );
  } catch (error) {
    console.error(`Cannot read ${options.file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!looksLikeBinaryBbl(bytes)) {
    console.error(
      `${options.file} does not look like a binary blackbox log (.bbl).`
    );
    process.exitCode = 1;
    return;
  }

  const { flightCount, flights } = decodeBblFile(bytes);

  const usable = flights.filter((flight) => flight.mainFrames.length > 0);

  if (usable.length === 0) {
    console.error(`No flights with frames decoded from ${options.file}.`);
    process.exitCode = 1;
    return;
  }

  const selected =
    options.flight !== undefined
      ? usable.filter((flight) => flight.index + 1 === options.flight)
      : usable;

  if (selected.length === 0) {
    console.error(
      `Flight ${options.flight} not found (this log holds ${flightCount}).`
    );
    process.exitCode = 1;
    return;
  }

  const summaries = selected.map(summarizeFlight);

  if (options.json) {
    const payload = {
      file: options.file,
      flightCount,
      flights: summaries
    };

    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    `${options.file}: ${flightCount} flight(s), ` +
      `${usable.length} with decodable frames`
  );

  for (const summary of summaries) {
    console.log("");
    printFlightSummary(summary, options);
  }

  if (options.video) {
    try {
      await renderVideos(selected, options);
    } catch (error) {
      console.error(`\nVideo render failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

async function renderVideos(selected, options) {
  if (!(await checkFfmpegAvailable())) {
    console.error(
      "ffmpeg was not found on PATH — install it or add it to PATH to render video."
    );
    process.exitCode = 1;
    return;
  }

  for (const flight of selected) {
    const outputPath =
      typeof options.video === "string"
        ? options.video
        : defaultVideoPath(options.file);

    console.log(
      `\nRendering sticks video for flight ${flight.index + 1}` +
        `${options.theme ? ` (theme: ${options.theme})` : ""}` +
        ` -> ${outputPath}`
    );

    const result = await renderStickVideo(flight, outputPath, {
      fps: options.fps ?? undefined,
      theme: options.theme ?? undefined,
      onProgress: (message) => {
        process.stdout.write(`\r  ${message}    `);
      }
    });

    process.stdout.write("\n");

    console.log(
      `  Done: ${result.frames} frames at ${result.fps} fps ` +
        `(${result.durationSeconds.toFixed(1)} s of flight)`
    );
  }
}

main().catch((error) => {
  console.error(`Unexpected failure: ${error.message}`);
  process.exitCode = 1;
});