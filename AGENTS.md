# AGENTS.md

Zero-dependency Node.js (ESM) GUI app that decodes Rotorflight blackbox `.bbl` logs and renders user-designed gimbal-stick overlay MP4/MOV videos via ffmpeg. v2 is GUI-driven only — there is no terminal CLI.

## Commands

- `npm test` — runs `node --test` (no other scripts exist; there is no lint/typecheck/build setup, so don't look for one).
- Single test file: `node --test test/stickMapping.test.mjs` (or any `test/*.test.mjs`).
- Run the app: `npm run gui` (or `node src/gui/serve.js [--port N] [--no-open]`) — binds 127.0.0.1 and opens the browser console.
- Verify a render end-to-end: start the GUI, load `test/fixtures/Kraken_20260522_025600.bbl`, build a layout, render (requires ffmpeg on PATH). Video output goes to `out/` — it is gitignored.

## Conventions

- ESM everywhere: `"type": "module"` in package.json, so `.js` files use `import`/`export`. Tests are `.mjs`. Node's built-in test runner only — do not add test frameworks or runtime dependencies; the project deliberately avoids image libraries (frames are hand-painted `Uint8Array` RGBA buffers piped to ffmpeg stdin).
- The **layout document** (`src/render/layout/layoutSchema.js`) is the single source of truth: defaults, validation, clamping, and geometry. The browser never duplicates measurement rules — it renders with the server-normalized doc and the boxes the server returns.
- The **scene painter** (`src/render/layout/scenePainter.js`) is the ONE renderer: GUI previews and final video renders both paint through it (WYSIWYG by construction). Editor-only decorations (pastel-green backdrop `#D8ECD0`, dashed grid, selection outlines, drag ghosts) live in the browser layer and must never enter the video pipeline.
- Colour model: item property → theme slot → fallback. `null` means "inherit from theme". Saved colours are `{ hex, alpha }`. Themes (`src/render/themes.js`) are STRUCTURAL slots (fonts.label/.value, card.color/.accent, stick.box/.crosshair/.dot, bar.track/.fill, donut.track/.fill, background, textShadow) — never add per-widget colour keys like v1's `escTemp`.
- Font weights resolve to the bundled static instances (`fonts/*/static/*`), never the variable-font files. One font FAMILY per layout (layout.font); sizes are per-item label/value px (null → theme). Default font is `vt323`. New fonts: drop the `.ttf` (+ OFL.txt) under `fonts/` and add a registry entry with size metrics.
- Preview transport caps at 960px wide (`PREVIEW_MAX_W` in `src/gui/api.js`): full-res render, box-filtered down; the response headers carry both payload and layout dimensions.
- Alpha (transparent) is the default render mode; opaque renders are H.264 .mp4 filled with the theme background. Frame width/height must stay even for yuv420p.
- **Output formats** (`src/render/outputFormats.js`) are the single registry of codecs behind the GUI's FMT dropdown: alpha entries `png-rgba` (default), `vp9-yuva420p` (.webm), `prores4444-12` (.mov) plus opaque `h264-yuv420p` (.mp4). Transparency ON offers the alpha codecs only; OFF offers H.264 only (`formatsForMode`). Add a codec there and the dropdown, path rules, and encoder args follow. VP9 alpha stores alpha as a WebM `alpha_mode=1` tag, not in the pix_fmt name. Render options: `format` id on `renderLayoutVideo`, `/api/render`, and `startRenderJob`.
- Config files: strict v2 JSON (`version: 2`, `.gimbal.json`); unknown types/props are dropped with warnings, values clamped, positions (cell anchors) clamped into bounds. No server-side config storage — save/load is browser download/upload.

## Domain quirks (Rotorflight)

- rcCommand channels: `[0]`=roll, `[1]`=pitch, `[2]`=yaw, `[3]`=collective, `[4]`=throttle. Betaflight-style 4-channel logs fall back to `rcCommand[3]` as throttle — preserve that fallback in `src/render/stickMapping.js` (channelIndexes + per-channel detectScale).
- Axis convention (uniform): right = positive, up = positive — no per-channel sign flips.
- Arming = `flightModeFlags` bit 0 from slow frames (carried forward to main frames); falls back to `motor[0] > 0` when absent.
- Stick scaling uses the log's observed extremes with a ±500 floor (`detectScale`), applied per channel; throttle (rcCommand[4]) gets its own scale.
- Percentage sources (`motorPct`, `motor[n]` — logged ×10 of percent) lock Max Value mode to `percent`; other fields normalize fraction from the flight MIN (`zero = flight min` rule for signed fields).
- Dynamic max mode = running prefix max up to the current frame (never shrinks mid-flight); Flight Maximum = whole-log constants. Both come from `fieldStats.js`, computed lazily per field and cached per flight.

## Tests

- `test/fixtures/*.bbl` is a 7.4 MB real-log fixture; the integration test (`bblDecode.integration.test.mjs`) skips cleanly if the directory is empty, so a passing suite doesn't prove the decoder ran against real data.
- Scene-painter tests assert pixels at known coordinates; layout-measure tests assert bounding boxes — keep widget geometry rules in `layoutSchema.js`/widget painters only, never in the browser.