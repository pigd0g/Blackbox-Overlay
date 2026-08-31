# AGENTS.md

Zero-dependency Node.js (ESM) CLI that decodes Rotorflight blackbox `.bbl` logs and renders gimbal-stick MP4 videos via ffmpeg.

## Commands

- `npm test` — runs `node --test` (no other scripts exist; there is no lint/typecheck/build setup, so don't look for one).
- Single test file: `node --test test/stickMapping.test.mjs` (or any `test/*.test.mjs`).
- Run the CLI: `node index.js <file.bbl> [--fields] [--json] [--flight N] [--video [out.mp4]] [--fps N] [--theme NAME] [--font NAME]`.
- Verify a render end-to-end: `node index.js test/fixtures/Kraken_20260522_025600.bbl --video out/test.mp4` (requires ffmpeg on PATH). Write video output to `out/` — it is gitignored.

## Conventions

- ESM everywhere: `"type": "module"` in package.json, so `.js` files use `import`/`export`. Tests are `.mjs`. Node's built-in test runner only — do not add test frameworks or runtime dependencies; the project deliberately avoids image libraries (frames are hand-painted `Uint8Array` RGB24 buffers piped to ffmpeg stdin).
- Keep the README's usage/options section in sync with `printUsage()` and `parseArgs()` in `index.js`.

## Architecture (src/)

- `src/bbl/` — `.bbl` decoding: `byteStream.js` (reader), `headerParser.js` (H header → field names/sysConfig), `frameDecoder.js` (I/P frames with predictors + delta unrolling; also slow/GPS/event frames, corrupt-frame skipping). Public API is `decodeBblFile`/`looksLikeBinaryBbl` in `bblDecoder.js`.
- `src/render/` — video pipeline: `gimbalFrame.js` paints pixels (`bitmapFont.js` for the legacy 5×7 text), `videoWriter.js` spawns `ffmpeg -f rawvideo -pix_fmt rgba -i pipe:0` (frame width/height must be even for yuv420p), `videoRender.js` orchestrates.
- Font stack: `fonts.js` (registry: ids, weight→static-file maps, per-font metrics) → `fontEngine.js` (from-scratch TTF parser — glyf outlines only, no gvar/CFF) → `fontRaster.js` (AA glyph mask cache) → `textRenderer.js` (drawText/measureText facade; `bitmap` and TTF backends behind one interface). Weights resolve to the bundled static instances (`fonts/*/static/*`), never the variable-font files. Default font is `vt323`. New fonts: drop the `.ttf` (+ OFL.txt) under `fonts/` and add a registry entry with size metrics.

## Domain quirks (Rotorflight)

- rcCommand channels: `[0]`=roll, `[1]`=pitch, `[2]`=yaw, `[3]`=collective, `[4]`=throttle. Betaflight-style 4-channel logs fall back to `rcCommand[3]` as throttle — preserve that fallback in `src/render/stickMapping.js`.
- Arming = `flightModeFlags` bit 0 from slow frames (carried forward to main frames); falls back to `motor[0] > 0` when absent.
- Stick scaling uses the log's observed extremes with a ±500 floor (`detectScale`).

## Tests

- `test/fixtures/*.bbl` is a 7.4 MB real-log fixture; the integration test (`bblDecode.integration.test.mjs`) skips cleanly if the directory is empty, so a passing suite doesn't prove the decoder ran against real data.