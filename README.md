# GimbalVid

A **Rotorflight blackbox (`.bbl`) log tool** with a terminal reader and a local GUI console. GimbalVid decodes binary blackbox logs, summarizes each recorded flight, and can render the flight's gimbal stick positions to an `.mp4` video.

## Features

- **Decode `.bbl` logs** — reads Betaflight-style binary blackbox files written by Rotorflight, including I/P frame decoding, slow/GPS/event frames, and corrupt-frame skipping.
- **Flight summaries** — craft name, firmware, board, log start time, data version, duration, frame counts, and main-frame field names.
- **JSON output** — machine-readable summary for scripting and automation.
- **Stick-position video** — renders a green-screen-style 500×300 MP4 showing both gimbals (mode-2): left stick = yaw / collective, right stick = roll / pitch, plus armed and throttle toggle indicators.
- **No image libraries** — every video frame is painted pixel-by-pixel into `Uint8Array` RGB24 buffers and piped straight into `ffmpeg` (H.264, CRF 18, `+faststart`).
- **GUI console** — a local web app for browsing logs, previewing real rendered frames, picking themes, and launching renders with live progress.

## Requirements

- [Node.js](https://nodejs.org/) (ESM, tested with modern Node versions)
- [ffmpeg](https://ffmpeg.org/) on your `PATH` (video rendering only)

## Installation

Clone the repository, then either run it directly or install globally:

```sh
# Run directly
node index.js <file.bbl> [options]

# Or link it as the `gimbalvid` command
npm install -g .
gimbalvid <file.bbl> [options]
```

## GUI console

```sh
npm run gui            # or: node src/gui/serve.js [--port N] [--no-open]
```

This starts a local server (bound to `127.0.0.1` only) and opens the console in your browser:

- **Browse or drop a log** — pick a `.bbl` from any folder via the built-in file browser, or drag one onto the source panel.
- **Flight list** — per-flight craft, firmware, duration, frame counts, and the main-field name list.
- **Live monitor** — the preview canvas paints real frames from the same pipeline that renders the video; scrub through the flight over its collective trace, press Space to play, arrow keys to step frames.
- **Theme swatches** — each theme's swatch is a live mini-frame from your own flight; the console's accent color follows the selected theme's stick-dot color.
- **Render** — choose fps and output name (defaults to `out/<logname>-flight<N>-sticks.mp4`), watch progress, and play the finished MP4 inline.

## CLI usage

```
gimbalvid <file.bbl> [options]

Options:
  --fields          list main-frame field names for each flight
  --json            emit the summary as JSON
  --flight N        only show flight N (1-based)
  --video [out.mp4] render a green-screen gimbal-stick video
                    (default: <logname>-sticks.mp4)
  --fps N           video frame rate (default 30)
  --help            show this help
```

## Examples

Summarize every flight in a log:

```sh
gimbalvid Kraken_20260522_025600.bbl
```

List every main-frame field name:

```sh
gimbalvid flight.bbl --fields
```

Get a machine-readable JSON summary:

```sh
gimbalvid flight.bbl --json
```

Inspect only the third flight:

```sh
gimbalvid flight.bbl --flight 3
```

Render a stick-position video next to the log (`flight-sticks.mp4`):

```sh
gimbalvid flight.bbl --video
```

Render a video to a custom path at 60 fps:

```sh
gimbalvid flight.bbl --video out/my-sticks.mp4 --fps 60
```

Combine options — JSON summary of flight 2, then render its video:

```sh
gimbalvid flight.bbl --flight 2 --json
gimbalvid flight.bbl --flight 2 --video
```

## Stick video layout

Each rendered frame contains:

- **Two gimbals** (dark grey squares with crosshair axes):
  - **Left**: x = yaw, y = collective (mode-2 style)
  - **Right**: x = roll, y = pitch
- **Stick dot** — red dot showing stick position, scaled per-axis from the log's own deflection range (±500 floor).
- **Toggles** — `ARMED` lights when the arming channel (`rcCommand[4]`) is high; `THROTTLE` lights when collective (`rcCommand[3]`) is above 0.

Frame timing comes from the log's own `time` column, so any `--fps` plays back at true flight speed — higher fps just adds smoothness.

## Project layout

```
index.js                    CLI entry point
src/gui/serve.js            local GUI server (127.0.0.1)
src/gui/api.js              GUI backend (decode cache, preview, jobs)
src/gui/public/             console frontend (vanilla HTML/CSS/JS)
src/bbl/                    .bbl decoding (byte stream, header, frames)
src/render/gimbalFrame.js   pixel painter for stick frames
src/render/stickMapping.js  rcCommand → gimbal position mapping
src/render/frameSampler.js  shared time-sampling of flights
src/render/videoRender.js   render orchestration
src/render/videoWriter.js   ffmpeg raw-RGB pipe writer
test/                       node --test suites + sample .bbl fixture
```

## Development

Run the test suite:

```sh
npm test
```

## License

[GPL-3.0-only](https://www.gnu.org/licenses/gpl-3.0.html)