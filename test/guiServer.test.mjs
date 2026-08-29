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
  assert.ok(payload.themes.names.length >= 5);
  assert.match(payload.themes.themes.default.dot, /^#[0-9a-f]{6}$/i);
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
  assert.equal(response.headers.get("X-Frame-Width"), "500");
  assert.equal(response.headers.get("X-Frame-Height"), "300");

  const buffer = Buffer.from(await response.arrayBuffer());

  assert.equal(buffer.length, 500 * 300 * 4);

  // RGBA: alpha channel is 255 every fourth byte (sampled).
  for (const index of [3, 4003, 10003]) {
    assert.equal(buffer[index], 255);
  }
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
  const timeout = setTimeout(() => {
    reader.cancel().catch(() => {});
    throw new Error("SSE stream timed out");
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary;

      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            onEvent(JSON.parse(line.slice(6)));
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

  const outDir = mkdtempSync(join(tmpdir(), "rfbvo-gui-"));
  const output = join(outDir, "gui-test.mp4");

  try {
    const startResponse = await fetch(`${base}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: FIXTURE,
        flight: 1,
        fps: 30,
        theme: "charcoal",
        output
      })
    });

    assert.equal(startResponse.status, 202);

    const { jobId } = await startResponse.json();

    const finalJob = await new Promise((resolvePromise, reject) => {
      consumeSse(`${base}/api/jobs/${jobId}/events`, (event) => {
        if (event.type === "done") {
          resolvePromise(event.job);
        } else if (event.type === "error") {
          reject(new Error(event.job.error || "render failed"));
        }
      }).catch(reject);
    });

    assert.equal(finalJob.state, "done");
    assert.ok(finalJob.frames > 100);
    assert.ok(existsSync(finalJob.output));

    const media = await fetch(
      `${base}/api/media?path=${encodeURIComponent(finalJob.output)}`
    );

    assert.equal(media.status, 200);
    assert.match(media.headers.get("content-type"), /video\/mp4/);

    const bytes = Buffer.from(await media.arrayBuffer());

    assert.ok(bytes.length > 10_000, "mp4 should have real content");
    assert.deepEqual(bytes.slice(4, 8).toString(), "ftyp");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("media endpoint refuses paths that never rendered", async () => {
  if (!hasFixture) return;

  const response = await fetch(
    `${base}/api/media?path=${encodeURIComponent(FIXTURE)}`
  );

  assert.equal(response.status, 404);
});