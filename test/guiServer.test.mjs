// ======================================================
// RotorFlight-Blackbox-Video-Overlay — GUI SERVER SMOKE TESTS (v2)
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
import { existsSync, rmSync } from "node:fs";
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

// A canonical small layout for endpoint tests.
function testLayout(overrides = {}) {
  return {
    version: 2,
    canvas: { width: 400, height: 240 },
    grid: { cols: 4, rows: 2 },
    alpha: true,
    shadow: false,
    theme: "default",
    font: "vt323",
    themeOverrides: overrides.themeOverrides ?? {},
    items: [
      { id: "t-a", type: "stick", col: 0, row: 0,
        props: { size: "med", xChannel: 0, yChannel: 1, showCaption: false,
                 boxColor: null, crosshairColor: null, dotColor: null } },
      { id: "t-b", type: "text", col: 2, row: 0,
        props: { source: "derived:rpm", showLabel: true, alignment: "stacked",
                 labelSize: null, labelColor: null, valueSize: null,
                 valueColor: null, cardColor: null, accentColor: null } }
    ],
    ...overrides
  };
}

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

test("state reports themes, fonts, ffmpeg, and the default layout", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/state`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(typeof payload.ffmpeg, "boolean");
  assert.deepEqual(payload.themes.names, [
    "default", "light", "gunmetal", "charcoal", "slate", "lime"
  ]);
  assert.ok(payload.themes.maps.default["stick.dot"], "theme map carries dot");
  assert.ok(payload.fonts.fonts.vt323, "font catalog present");
  assert.equal(payload.defaultLayout.version, 2);
  assert.ok(payload.defaultLayout.canvas.width > 0);
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

test("log endpoint summarizes flights with renderability", async () => {
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
  assert.ok(first.durationSeconds > 0);
  assert.ok(first.mainFields.length > 0);
});

test("layout normalize validates, clamps, and measures", async () => {
  if (!hasFixture) return;

  const raw = testLayout();

  // Inject junk: unknown type, unknown prop, out-of-bounds.
  raw.items.push({ id: "junk", type: "sparkline", col: 0, row: 0, props: {} });
  raw.items.push({ id: "t-b2", type: "text", col: 99, row: 99,
    props: { source: "derived:rpm", bogusProp: 1 } });
  raw.canvas.width = 333; // odd → rounds down to even

  const response = await fetch(`${base}/api/layout/normalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: raw })
  });

  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.layout.canvas.width, 332);

  // Junk item dropped; survives-props normalized.
  assert.equal(payload.layout.items.some((i) => i.id === "junk"), false);

  const textItem = payload.layout.items.find((i) => i.id === "t-b2");

  assert.ok(textItem, "unknown props don't drop otherwise-valid items");
  assert.equal("bogusProp" in textItem.props, false);
  assert.ok(textItem.col <= payload.layout.grid.cols - 1, "clamped into grid");

  // Boxes come back per item.
  assert.ok(payload.boxes["t-a"].width > 0);

  assert.ok(payload.warnings.length > 0, "warnings reported");
});

test("preview returns a RGBA frame with layout + payload dimensions", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layout: testLayout(),
      file: FIXTURE,
      flight: 1,
      t: 1.5
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Frame-Width"), "400");
  assert.equal(response.headers.get("X-Frame-Height"), "240");
  assert.equal(response.headers.get("X-Layout-Width"), "400");

  const buffer = Buffer.from(await response.arrayBuffer());

  assert.equal(buffer.length, 400 * 240 * 4);
});

test("preview works with no log (placeholder state)", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: testLayout() })
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());

  // Stick box corner is opaque #404040 even with no flight;
  // a far region stays transparent (alpha on).
  const alphaAt = (x, y) => buffer[(y * 400 + x) * 4 + 3];

  assert.equal(alphaAt(210, 190), 0, "far region transparent");
  assert.equal(alphaAt(10, 10), 255, "stick box painted");
});

test("preview downsamples large canvases to the 960px cap", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layout: testLayout({ canvas: { width: 1920, height: 1080 } }),
      file: FIXTURE,
      flight: 1,
      t: 1.5
    })
  });

  assert.equal(response.status, 200);

  const width = Number(response.headers.get("X-Frame-Width"));
  const height = Number(response.headers.get("X-Frame-Height"));
  const layoutW = Number(response.headers.get("X-Layout-Width"));

  assert.equal(layoutW, 1920);
  assert.equal(width, 960);
  assert.equal(height, 540);

  const buffer = Buffer.from(await response.arrayBuffer());

  assert.equal(buffer.length, 960 * 540 * 4);
});

test("preview leaves the background transparent with alpha on", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layout: testLayout(),
      file: FIXTURE,
      flight: 1,
      t: 1.5
    })
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  // The stick (200px med, top-left anchored at cell 0,0)
  // paints its box; a far corner stays transparent (alpha on).
  const alphaAt = (x, y) => buffer[(y * 400 + x) * 4 + 3];

  assert.equal(alphaAt(150 + 60, 190), 0, "far region transparent");
  assert.equal(alphaAt(10, 10), 255, "stick box painted");
});

test("opaque preview fills the theme background", async () => {
  if (!hasFixture) return;

  const layout = testLayout();
  layout.alpha = false;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout, file: FIXTURE, flight: 1, t: 1.5 })
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const alphaAt = (x, y) => buffer[(y * 400 + x) * 4 + 3];

  // Default theme background #C6D8D3, fully opaque.
  assert.equal(alphaAt(2, 2), 255);
  assert.equal(buffer[0], 0xc6);
  assert.equal(buffer[1], 0xd8);
  assert.equal(buffer[2], 0xd3);
});

test("preview honors path-keyed theme overrides", async () => {
  if (!hasFixture) return;

  const probe = async (overrides) => {
    const response = await fetch(`${base}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: testLayout(overrides ? { themeOverrides: overrides } : {}),
        file: FIXTURE,
        flight: 1,
        t: 1.5
      })
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    // Count exact green-dot pixels (the override colour).
    let green = 0;

    for (let i = 0; i < buffer.length; i += 4) {
      if (buffer[i] === 0x00 && buffer[i + 1] === 0xff && buffer[i + 2] === 0x88) {
        green += 1;
      }
    }

    return green;
  };

  const baseline = await probe(null);
  const overridden = await probe({ "stick.dot": "#00FF88" });

  assert.equal(baseline, 0, "no green pixels in the default theme");
  assert.ok(overridden > 0, "stick.dot override paints the dot green");
});

test("preview differentiates fonts", async () => {
  if (!hasFixture) return;

  const probe = async (font) => {
    const layout = testLayout();
    layout.font = font;

    const response = await fetch(`${base}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout, file: FIXTURE, flight: 1, t: 1.5 })
    });

    assert.equal(response.status, 200);

    return Buffer.from(await response.arrayBuffer());
  };

  const vt323 = await probe("vt323");
  const geist = await probe("geist");

  assert.notDeepEqual(vt323, geist, "fonts must paint different frames");
});

test("preview rejects unknown flights", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: testLayout(), file: FIXTURE, flight: 999, t: 0 })
  });

  assert.equal(response.status, 400);

  const payload = await response.json();

  assert.match(payload.error, /Flight 999 not found/);
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

  const layout = testLayout();
  layout.theme = "charcoal";
  layout.themeOverrides = { "stick.dot": "#00FF88" };

  const output = "gui-test-v2-overlay.mp4";

  try {
    const startResponse = await fetch(`${base}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: FIXTURE,
        flight: 1,
        fps: 10,
        layout,
        output
      })
    });

    assert.equal(startResponse.status, 202);

    const { jobId } = await startResponse.json();

    const finalJob = await new Promise((resolvePromise, reject) => {
      consumeSse(`${base}/api/jobs/${jobId}/events`, (event) => {
        if (event.type === "done") {
          resolvePromise(event.job);
          return true;
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

    const media = await fetch(
      `${base}/api/media?path=${encodeURIComponent(finalJob.output)}`
    );

    assert.equal(media.status, 200);
    assert.match(media.headers.get("content-type"), /video\/mp4/);

    const bytes = Buffer.from(await media.arrayBuffer());

    assert.ok(bytes.length > 10_000, "mp4 should have real content");
    assert.deepEqual(bytes.slice(4, 8).toString(), "ftyp");
  } finally {
    rmSync(join(process.cwd(), "out", output), { force: true });
  }
});

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

  const layout = testLayout({ alpha: true });
  const output = "sse-close-v2-overlay";

  try {
    const startResponse = await fetch(`${base}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: FIXTURE,
        flight: 1,
        fps: 10,
        layout,
        output
      })
    });

    assert.equal(startResponse.status, 202);

    const { jobId } = await startResponse.json();

    const finalJob = await new Promise((resolvePromise, rejectPromise) => {
      consumeSse(`${base}/api/jobs/${jobId}/events`, (event) => {
        if (event.type === "error") {
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
    assert.ok(existsSync(finalJob.output));

    await new Promise((r) => setTimeout(r, 500));

    const probe = await fetch(`${base}/api/state`);

    assert.equal(probe.status, 200);

    const status = await fetch(`${base}/api/jobs/${jobId}`);

    assert.equal(status.status, 200);

    const snapshot = await status.json();

    assert.equal(snapshot.state, "done");
  } finally {
    rmSync(join(process.cwd(), "out", `${output}.mov`), { force: true });
    rmSync(join(process.cwd(), "out", `${output}.preview.mp4`), { force: true });
  }
});