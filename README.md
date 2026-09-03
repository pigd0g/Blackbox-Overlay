# RotorFlight-Blackbox-Video-Overlay

A **Rotorflight blackbox (`.bbl`) log tool** with a local GUI overlay designer. RotorFlight-Blackbox-Video-Overlay decodes binary blackbox logs, summarizes each recorded flight, and lets you design a custom overlay layout — telemetry cards, stick displays, progress bars, and donut charts on a user-defined canvas and grid — rendered to video (`.mp4`, or alpha-capable `.mov`).

## Features

- **Decode `.bbl` logs** — reads Betaflight-style binary blackbox files written by Rotorflight, including I/P frame decoding, slow/GPS/event frames, and corrupt-frame skipping.
- **Flight summaries** — craft name, firmware, board, log start time, data version, duration, frame counts, and main-frame field names.
- **Layout designer (v2)** — a custom-canvas overlay editor:
  - user-defined resolution (64–7680 px, even) and an editable grid (cols/rows) shown as dashed lines in the preview,
  - telemetry items for every value in the log plus derived metrics (RPM, battery, current, ESC temp, motor %…),
  - Stick Displays (small/med/large, any X/Y pair of rcCommand[0–4] with friendly names),
  - Text cards (label + value, stacked or inline, optional Custom Text),
  - Progress Bars (horizontal/vertical, max: 100% for percentage fields, Flight Maximum, or Dynamic),
  - Donut Charts (value in the centre, sizes matching Stick Displays),
  - drag items with cell snapping, arrow-key nudging, duplicate, z-order, per-item colours with opacity,
  - themes supply per-slot defaults; items inherit unless overridden,
  - alpha (transparent ProRes 4444 `.mov`) on by default,
  - save/load the layout as a `.json` file.
- **No image libraries** — every video frame is painted pixel-by-pixel into `Uint8Array` RGBA buffers and piped straight into `ffmpeg` (H.264 `yuv420p` CRF 18, or ProRes 4444 `yuva444p10le` with alpha).
- **Selectable text font** — the overlay paints its telemetry through a from-scratch TrueType engine (no dependencies): VT323 (default), Geist, Orbitron, Audiowide, Space Mono, Zen Dots, or the classic 5×7 bitmap.
- **GUI console** — a local web app: browse logs, live preview, design layouts, pick themes and fonts, and launch renders with live progress.

## Requirements

- [Node.js](https://nodejs.org/) (ESM, tested with modern Node versions)
- [ffmpeg](https://ffmpeg.org/) on your `PATH` (video rendering only)

## Installation

Clone the repository, then either run it directly or install globally:

```sh
# Run directly
npm run gui

# Or link it as the `rotorflight-blackbox-video-overlay` command
npm install -g .
rotorflight-blackbox-video-overlay [--port N] [--no-open]
```

## GUI console

```sh
npm run gui            # or: node src/gui/serve.js [--port N] [--no-open]
```

This starts a local server (bound to `127.0.0.1` only) and opens the console in your browser. The console is a four-column overlay designer:

- **SOURCE** — browse or drop a log, pick a flight, choose theme/font, toggle transparency and text shadow, set fps and output name.
- **TELEMETRY** — every field the log carries plus derived metrics; click **+** to add (first free cell) or drag onto the canvas to place. Add Stick Displays and Custom Text from the pinned buttons.
- **MONITOR** — the always-on preview. The pastel-green backdrop and dashed grid are editing aids only, never rendered. Set canvas W/H and grid cols/rows; drag items (snapping ghosts commit on drop), arrow keys nudge a cell, Delete removes, Ctrl+D duplicates, click selects.
- **PROPERTIES** — the selected item's properties: widget type (text/bar/donut), source, sizes, max-value mode, colours via picker + opacity (cleared = theme default), label/value typography, z-order and duplicate/delete.

**Save layout** downloads `overlay.gimbal.json`; **Load layout…** reads one back (strictly normalized — unknown properties are dropped with a warning).

**Render** pipes the layout through the same scene painter the preview uses (WYSIWYG) into `out/<logname>-flight<N>-overlay.mp4`, or `.mov` (ProRes 4444 + a browser-playable flattened `.preview.mp4`) when Transparent is on.

## Layout file

A `version: 2` JSON document:

```json
{
  "version": 2,
  "canvas": { "width": 1920, "height": 1080 },
  "grid": { "cols": 12, "rows": 6 },
  "alpha": true,
  "shadow": false,
  "theme": "default",
  "font": "vt323",
  "themeOverrides": { "stick.dot": "#00FF88" },
  "items": [
    { "id": "i7x9k2qp", "type": "stick", "col": 0, "row": 0,
      "props": { "size": "med", "xChannel": 0, "yChannel": 1, "showCaption": false,
                 "boxColor": null, "crosshairColor": null, "dotColor": null } },
    { "id": "i92ka1xz", "type": "text", "col": 1, "row": 0,
      "props": { "source": "derived:rpm", "showLabel": true, "alignment": "stacked",
                 "labelSize": null, "labelColor": null, "valueSize": null,
                 "valueColor": null, "cardColor": null, "accentColor": null } },
    { "id": "i5m2vd0a", "type": "bar", "col": 3, "row": 0,
      "props": { "source": "derived:current", "orientation": "vertical",
                 "width": 13, "height": 200, "maxValue": { "mode": "dynamic" } } },
    { "id": "iq81pz4k", "type": "donut", "col": 5, "row": 0,
      "props": { "source": "derived:motorPct", "size": "med", "showValue": true,
                 "maxValue": { "mode": "percent" } } }
  ]
}
```

Colour slots are `null` (inherit from the theme) or `{ "hex": "#rrggbb", "alpha": 0–100 }`. Items anchor their **top-left** to a grid cell's top-left and may overflow into neighbours; shrinking the grid clamps items back into bounds; the first free cell is where the **+** button drops a new item.

## Architecture

- `src/bbl/` — `.bbl` decoding (byte stream, header parser, frame decoder).
- `src/render/layout/` — v2 engine: `layoutSchema.js` (the layout document: defaults, validation, geometry), `valueFormat.js` (field knowledge: units, friendly names, percentage detection), `fieldStats.js` (per-field min/max + running max), `pixelPrimitives.js` (parametrized src-over painters incl. the donut ring), the widget painters, and `scenePainter.js` — the single renderer for preview and video.
- `src/render/` — themes (structural per-slot defaults), fonts (registry), the from-scratch TTF engine, and the ffmpeg `VideoWriter`.
- `src/gui/` — the local server (`serve.js`), API handlers (`api.js`), and the browser console (`public/`).

## Tests

`npm test` — Node's built-in runner, no test frameworks, no runtime dependencies. The integration test skips cleanly when `test/fixtures/` is empty.