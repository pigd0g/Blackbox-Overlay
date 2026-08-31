// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GUI SERVER SMOKE TESTS
// ======================================================
//
// Boots the real GUI server on an ephemeral port and walks
// its API against the fixture log. Skips cleanly when the
// fixture is absent; render endpoints additionally skip
// when ffmpeg is not on PATH.
//
// ======================================================

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = join(
  import.meta.dirname,
  "fixtures",
  "Kraken_20260522_025600.bbl"
);

const hasFixture = existsSync(FIXTURE);

let server = null;
let base = null;

async function waitForServer(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/state`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }

  throw new Error("GUI server did not start in time");
}

before(async () => {
  if (!hasFixture) return;

  server = spawn(
    process.execPath,
    [join(import.meta.dirname, "..", "src", "gui", "serve.js"), "--no-open"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  base = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("no server banner")),
      10_000
    );

    server.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/);

      if (match) {
        clearTimeout(timeout);
        resolvePromise(`http://127.0.0.1:${match[1]}`);
      }
    });

    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early (code ${code})`));
    });
  });

  await waitForServer(base);
});

after(() => {
  if (server) {
    server.kill();
  }
});

test("serves the console shell", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);

  const html = await response.text();

  assert.match(html, /id="screen"/);
  assert.match(html, /app\.js/);
});

test("static assets are served with sane types", async () => {
  if (!hasFixture) return;

  for (const [path, type] of [
    ["/app.css", /text\/css/],
    ["/app.js", /javascript/]
  ]) {
    const response = await fetch(`${base}${path}`);

    assert.equal(response.status, 200, `${path} should exist`);
    assert.match(response.headers.get("content-type"), type);
  }
});

test("blocks path escapes outside public/", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/..%2f..%2f..%2fpackage.json`);

  assert.equal(response.status, 403);
});

test("state reports themes and ffmpeg availability", async () => {
  if (!hasFixture) return;

  const payload = await (await fetch(`${base}/api/state`)).json();

  assert.equal(typeof payload.ffmpeg, "boolean");
  assert.ok(Array.isArray(payload.themes.names));
  assert.ok(payload.themes.names.length >= 6);
  assert.ok(Array.isArray(payload.themes.keys));
  assert.equal(payload.themes.keys.length, 16);
  assert.match(payload.themes.themes.default.dot, /^#[0-9a-f]{6}$/i);
  assert.match(payload.themes.themes.default.barMotor, /^#[0-9a-f]{6}$/i);
  assert.match(payload.themes.themes.light.dot, /^#[0-9a-f]{6}$/i);
});

test("state carries the font catalog with vt323 default", async () => {
  if (!hasFixture) return;

  const { existsSync } = await import("node:fs");
  const fontsDir = join(import.meta.dirname, "..", "fonts");

  if (!existsSync(join(fontsDir, "VT323", "VT323-Regular.ttf"))) {
    return; // fonts pruned; catalog shape is covered by unit tests
  }

  const payload = await (await fetch(`${base}/api/state`)).json();

  assert.ok(Array.isArray(payload.fonts.ids));
  assert.ok(payload.fonts.ids.includes("vt323"));
  assert.ok(payload.fonts.ids.includes("bitmap"));
  assert.equal(payload.fonts.default, "vt323");
  assert.equal(payload.fonts.fonts.vt323.name, "VT323");
  assert.match(payload.fonts.fonts.vt323.weights["400"], /^fonts\//);
});

test("font files are served with the right media type", async () => {
  if (!hasFixture) return;

  const { existsSync } = await import("node:fs");
  const fontPath = join(import.meta.dirname, "..", "fonts", "VT323", "VT323-Regular.ttf");

  if (!existsSync(fontPath)) {
    return;
  }

  const response = await fetch(`${base}/fonts/VT323/VT323-Regular.ttf`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /font\/ttf/);
  assert.ok((await response.arrayBuffer()).byteLength > 10_000);
});

test("font file routes refuse path escapes", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/fonts/..%2f..%2fpackage.json`);

  assert.equal(response.status, 403);
});

test("preview honors the font option", async () => {
  if (!hasFixture) return;

  const { existsSync } = await import("node:fs");

  if (!existsSync(join(import.meta.dirname, "..", "fonts"))) {
    return;
  }

  const probe = async (font) => {
    const response = await fetch(`${base}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: FIXTURE,
        flight: 1,
        t: 1.5,
        theme: "default",
        ...(font ? { font } : {})
      })
    });

    assert.equal(response.status, 200);

    return Buffer.from(await response.arrayBuffer());
  };

  const vt323 = await probe("vt323");
  const geist = await probe("geist");

  assert.notDeepEqual(vt323, geist, "fonts must paint different frames");
});

test("browse lists directories and .bbl files", async () => {
  if (!hasFixture) return;

  const dir = join(import.meta.dirname, "fixtures");
  const payload = await (
    await fetch(`${base}/api/browse?dir=${encodeURIComponent(dir)}`)
  ).json();

  assert.equal(payload.path, dir);
  assert.ok(payload.files.some((file) => file.name.endsWith(".bbl")));
});

test("log endpoint summarizes flights", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: FIXTURE })
  });

  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.flights.length >= 1);

  const first = payload.flights[0];

  assert.equal(first.flight, 1);
  assert.equal(first.renderable, true);
  assert.ok(first.videoDurationSeconds > 0);
  assert.ok(first.mainFields.length > 0);
});

test("preview returns a RGBA frame with dimensions", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: FIXTURE, flight: 1, t: 1.5, theme: "gunmetal" })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Frame-Width"), "800");
  assert.equal(response.headers.get("X-Frame-Height"), "262");

  const buffer = Buffer.from(await response.arrayBuffer());

  assert.equal(buffer.length, 800 * 262 * 4);

  // RGBA: alpha channel is 255 every fourth byte (sampled).
  for (const index of [3, 4003, 10003]) {
    assert.equal(buffer[index], 255);
  }
});

test("preview with alpha leaves the background transparent", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: FIXTURE,
      flight: 1,
      t: 1.5,
      theme: "gunmetal",
      alpha: true
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Frame-Width"), "800");
  assert.equal(response.headers.get("X-Frame-Height"), "262");

  const buffer = Buffer.from(await response.arrayBuffer());

  // Top-left corner stays transparent; a gimbal-box pixel
  // (first gimbal center-ish) stays opaque.
  const alphaAt = (x, y) => buffer[(y * 800 + x) * 4 + 3];

  assert.equal(alphaAt(2, 2), 0);

  // The left gimbal spans 192..392 x 32..232: its center is
  // inside the box.
  assert.equal(alphaAt(292, 132), 255);
});

test("preview honors per-key theme overrides", async () => {
  if (!hasFixture) return;

  const probe = async (overrides) => {
    const response = await fetch(`${base}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: FIXTURE,
        flight: 1,
        t: 1.5,
        theme: "default",
        ...(overrides ? { themeOverrides: overrides } : {})
      })
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    // The stick dot at t=1.5s sits somewhere inside the left
    // gimbal — compare the count of exact dot-colored pixels.
    let dotish = 0;

    for (let i = 0; i < buffer.length; i += 4) {
      if (buffer[i] === 0xee && buffer[i + 1] === 0x42 && buffer[i + 2] === 0x66) {
        dotish += 1;
      }
    }

    return dotish;
  };

  const baseline = await probe(null);
  const overridden = await probe({ dot: "#00FF88" });

  assert.ok(baseline > 0, "default dot should be present");
  assert.equal(overridden, 0, "overridden dot color replaces #EE4266");
});

test("preview rejects unknown flights", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: FIXTURE, flight: 999, t: 0, theme: "default" })
  });

  assert.equal(response.status, 400);

  const payload = await response.json();

  assert.match(payload.error, /Flight 999 not found/);
});

test("trace returns downsampled collective points", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: FIXTURE, flight: 1 })
  });

  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.points.length > 50);
  assert.ok(payload.points.length <= 1201);

  for (const [, y] of payload.points.slice(0, 10)) {
    assert.ok(y >= -1 && y <= 1);
  }
});

/**
 * Minimal SSE consumer for Node: reads the event stream to
 * completion, invoking onEvent for every `data:` payload.
 */
async function consumeSse(url, onEvent, timeoutMs = 120_000) {
  const response = await fetch(url);
  assert.equal(response.status, 200);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done || timedOut) {
        if (timedOut) throw new Error("SSE stream timed out");
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let boundary;

      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            // onEvent returns true to mean "stop reading" —
            // used to abort right after a terminal event,
            // like a browser closing the stream.
            if (onEvent(JSON.parse(line.slice(6))) === true) {
              reader.cancel().catch(() => {});
              return;
            }
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

test("render job runs end-to-end with SSE progress and downloadable media", async () => {
  if (!hasFixture) return;

  const state = await (await fetch(`${base}/api/state`)).json();

  if (!state.ffmpeg) {
    return; // CI/test boxes without ffmpeg still validate the API surface.
  }

  // Render outputs always land in <cwd>/out/ — the name is
  // all the client controls.
  const output = "gui-test-theme-overrides.mp4";

  try {
    const startResponse = await fetch(`${base}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: FIXTURE,
        flight: 1,
        fps: 30,
        theme: "charcoal",
        themeOverrides: { dot: "#00FF88", barMotor: "#FF8800" },
        output
      })
    });

    assert.equal(startResponse.status, 202);

    const { jobId } = await startResponse.json();

    const finalJob = await new Promise((resolvePromise, reject) => {
      consumeSse(`${base}/api/jobs/${jobId}/events`, (event) => {
        if (event.type === "done") {
          resolvePromise(event.job);
          return true; // stop reading, like the browser does
        } else if (event.type === "error") {
          reject(new Error(event.job.error || "render failed"));
          return true;
        }
        return false;
      }).catch(reject);
    });

    assert.equal(finalJob.state, "done");
    assert.ok(finalJob.frames > 100);
    assert.ok(existsSync(finalJob.output));

    // The overrides ride along on the job snapshot.
    assert.deepEqual(finalJob.themeOverrides, {
      dot: "#00FF88",
      barMotor: "#FF8800"
    });

    const media = await fetch(
      `${base}/api/media?path=${encodeURIComponent(finalJob.output)}`
    );

    assert.equal(media.status, 200);
    assert.match(media.headers.get("content-type"), /video\/mp4/);

    const bytes = Buffer.from(await media.arrayBuffer());

    assert.ok(bytes.length > 10_000, "mp4 should have real content");
    assert.deepEqual(bytes.slice(4, 8).toString(), "ftyp");
  } finally {
    rmSync(finalJobOutput(), { recursive: true, force: true });
  }
});

function finalJobOutput() {
  return join(process.cwd(), "out", "gui-test-theme-overrides.mp4");
}

test("media endpoint refuses paths that never rendered", async () => {
  if (!hasFixture) return;

  const response = await fetch(
    `${base}/api/media?path=${encodeURIComponent(FIXTURE)}`
  );

  assert.equal(response.status, 404);
});

test("server survives SSE close after the render settles", async () => {
  if (!hasFixture) return;

  const state = await (await fetch(`${base}/api/state`)).json();

  if (!state.ffmpeg) return;

  const output = "sse-close-alpha.mp4";

  try {
    const startResponse = await fetch(`${base}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: FIXTURE,
        flight: 1,
        fps: 30,
        theme: "slate",
        alpha: true,
        output
      })
    });

    assert.equal(startResponse.status, 202);

    const { jobId } = await startResponse.json();

    // Wait for the done event, then abort the stream — the
    // browser's EventSource/fetch always closes right after
    // it sees a terminal event. Previously this crashed the
    // server (unsubscribe touched nulled activeJob).
    const finalJob = await new Promise((resolvePromise, rejectPromise) => {
      let failed = false;

      consumeSse(`${base}/api/jobs/${jobId}/events`, (event) => {
        if (event.type === "error") {
          failed = true;
          rejectPromise(new Error(event.job.error || "render failed"));
          return true;
        }
        if (event.type === "done") {
          resolvePromise(event.job);
          return true;
        }
        return false;
      }).catch(rejectPromise);
    });

    // Alpha renders must land as .mov (ProRes 4444).
    assert.match(finalJob.output, /\.mov$/);
    assert.equal(finalJob.alpha, true);
    assert.ok(existsSync(finalJob.output));

    // Give the server a beat to run the close handler that
    // used to throw.
    await new Promise((r) => setTimeout(r, 500));

    // The crash killed the whole process; if the state
    // endpoint still answers, the fix holds.
    const probe = await fetch(`${base}/api/state`);

    assert.equal(probe.status, 200);

    // Finished jobs stay queryable even after activeJob is
    // cleared — late status polls and media fetches work.
    const status = await fetch(`${base}/api/jobs/${jobId}`);

    assert.equal(status.status, 200);

    const snapshot = await status.json();

    assert.equal(snapshot.state, "done");
  } finally {
    // Nothing to clean: outputs live in <cwd>/out/.
  }
});