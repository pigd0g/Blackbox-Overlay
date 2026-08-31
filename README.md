# RotorFlight-Blackbox-Video-Overlay

A **Rotorflight blackbox (`.bbl`) log tool** with a terminal reader and a local GUI console. RotorFlight-Blackbox-Video-Overlay decodes binary blackbox logs, summarizes each recorded flight, and can render the flight's gimbal stick positions to a video overlay (`.mp4`, or alpha-capable `.mov`).

## Features

- **Decode `.bbl` logs** — reads Betaflight-style binary blackbox files written by Rotorflight, including I/P frame decoding, slow/GPS/event frames, and corrupt-frame skipping.
- **Flight summaries** — craft name, firmware, board, log start time, data version, duration, frame counts, and main-frame field names.
- **JSON output** — machine-readable summary for scripting and automation.
- **Stick-position video** — renders a green-screen-style 800×262 overlay video showing both gimbals (mode-2): left stick = yaw / collective, right stick = roll / pitch, plus armed and throttle toggle indicators.
- **No image libraries** — every video frame is painted pixel-by-pixel into `Uint8Array` RGBA buffers and piped straight into `ffmpeg` (H.264 `yuv420p` CRF 18, or ProRes 4444 `yuva444p10le` with alpha).
- **Selectable text font** — the overlay paints its telemetry through a from-scratch TrueType engine (no dependencies): VT323 (default), Geist, Orbitron, Audiowide, Space Mono, Zen Dots, or the classic 5×7 bitmap.
- **GUI console** — a local web app for browsing logs, previewing real rendered frames, picking themes and fonts, and launching renders with live progress.

## Requirements

- [Node.js](https://nodejs.org/) (ESM, tested with modern Node versions)
- [ffmpeg](https://ffmpeg.org/) on your `PATH` (video rendering only)

## Installation

Clone the repository, then either run it directly or install globally:

```sh
# Run directly
node index.js <file.bbl> [options]

# Or link it as the `rotorflight-blackbox-video-overlay` command
npm install -g .
rotorflight-blackbox-video-overlay <file.bbl> [options]
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
- **Font picker** — font cards beside the theme strip, each previewed in its own typeface.
- **Render** — choose fps and output name (defaults to `out/<logname>-flight<N>-sticks.mp4`), watch progress, and play the finished MP4 inline.

## CLI usage

```
rotorflight-blackbox-video-overlay <file.bbl> [options]

Options:
  --fields          list main-frame field names for each flight
  --json            emit the summary as JSON
  --flight N        only show flight N (1-based)
  --video [out.ext] render the gimbal-stick overlay video
                    (default: <logname>-sticks.mp4; with --alpha,
                     <logname>-sticks.mov)
  --fps N           video frame rate (default 30)
  --theme NAME      color theme for the video: default, light,
                    gunmetal, charcoal, slate, lime (default: default)
  --font NAME       overlay text font: vt323, bitmap, geist,
                    orbitron, audiowide, spacemono, zendots
                    (default: vt323)
  --alpha           transparent background - renders
                    alpha-capable ProRes 4444 QuickTime (.mov)
  --shadow          draw the theme's drop shadow under text
                    (default: off)
  --help            show this help
```

## Examples

Summarize every flight in a log:

```sh
rotorflight-blackbox-video-overlay Kraken_20260522_025600.bbl
```

List every main-frame field name:

```sh
rotorflight-blackbox-video-overlay flight.bbl --fields
```

Get a machine-readable JSON summary:

```sh
rotorflight-blackbox-video-overlay flight.bbl --json
```

Inspect only the third flight:

```sh
rotorflight-blackbox-video-overlay flight.bbl --flight 3
```

Render a stick-position video next to the log (`flight-sticks.mp4`):

```sh
rotorflight-blackbox-video-overlay flight.bbl --video
```

Render a video to a custom path at 60 fps:

```sh
rotorflight-blackbox-video-overlay flight.bbl --video out/my-sticks.mp4 --fps 60
```

Render with a different overlay font:

```sh
rotorflight-blackbox-video-overlay flight.bbl --video --font orbitron
```

Render a transparent-background overlay (ProRes 4444 .mov):

```sh
rotorflight-blackbox-video-overlay flight.bbl --alpha
```

Combine options — JSON summary of flight 2, then render its video:

```sh
rotorflight-blackbox-video-overlay flight.bbl --flight 2 --json
rotorflight-blackbox-video-overlay flight.bbl --flight 2 --video
```

## Stick video layout

Each 800x262 frame contains:

- **Two gimbals** (dark grey squares with crosshair axes):
  - **Left**: x = yaw, y = collective (mode-2 style)
  - **Right**: x = roll, y = pitch
- **Stick dot** showing stick position, scaled per-axis from the log's own deflection range (±500 floor).
- **Left column** - `ARMED` / `DISARMED` flag (from `flightModeFlags` bit 0), `MOTOR ON/OFF` flag, `MOTOR %`, and a vertical motor-% progress bar hugging the left edge of the left gimbal.
- **Right column** - RPM, volts-per-cell, pack voltage, live current, running max current, ESC temperature, and a vertical current-vs-max progress bar hugging the right edge of the right gimbal.

Frame timing comes from the log's own `time` column, so any `--fps` plays back at true flight speed - higher fps just adds smoothness.

## Themes and transparency

Six built-in themes ship with the command (`default`, `light`, `gunmetal`, `charcoal`, `slate`, `lime`). The GUI's color pickers can override every theme color individually.

## Fonts

Seven overlay fonts ship in `fonts/` (all OFL-licensed, licenses included):

| Font | Look |
|---|---|
| `vt323` (default) | Retro CRT terminal |
| `bitmap` | The original 5×7 pixel font |
| `geist` | Clean / professional (static weights 100–900) |
| `orbitron` | Futuristic FPV / HUD |
| `audiowide` | Aggressive / sporty |
| `spacemono` | Technical instrumentation |
| `zendots` | Futuristic / experimental |

Weights resolve to the bundled static instances (nearest weight wins); text is rasterized by an in-repo TrueType engine (`src/render/fontEngine.js` + `fontRaster.js`) — no font libraries are used.

With `--alpha` (or the GUI's transparent-background toggle) the backdrop is not painted and the video is encoded as ProRes 4444 QuickTime (`yuva444p10le`) - video editors see a fully transparent background behind the overlay widgets, ready for compositing.

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
src/render/fonts.js         font registry (ids, weights, metrics)
src/render/fontEngine.js    minimal TrueType outline parser
src/render/fontRaster.js    glyph rasterizer + cache
src/render/textRenderer.js  text draw facade (ttf + bitmap)
src/render/videoRender.js   render orchestration
src/render/videoWriter.js   ffmpeg raw-RGBA pipe writer (H.264 / ProRes 4444)
fonts/                      bundled OFL typefaces used by the overlay
test/                       node --test suites + sample .bbl fixture
```

## Development

Run the test suite:

```sh
npm test
```

## License

[GPL-3.0-only](https://www.gnu.org/licenses/gpl-3.0.html)