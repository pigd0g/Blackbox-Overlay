// ======================================================
// Blackbox-Overlay — LAYOUT LIBRARY TESTS
// ======================================================
//
// Exercises /api/layouts (list, load, save, delete) against
// a spawned GUI server whose cwd is a temp directory, so
// user layouts never touch the repo's layouts/ folder.
// Skips cleanly when the fixture is absent.
//
// ======================================================

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FIXTURE = join(
  import.meta.dirname,
  "fixtures",
  "Kraken_20260522_025600.bbl"
);

const hasFixture = existsSync(FIXTURE);

let server = null;
let base = null;
let workDir = null;

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

  workDir = mkdtempSync(join(tmpdir(), "rfbvo-layouts-"));

  server = spawn(
    process.execPath,
    [
      join(import.meta.dirname, "..", "src", "gui", "serve.js"),
      "--no-open"
    ],
    { cwd: workDir, stdio: ["ignore", "pipe", "pipe"] }
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

after(async () => {
  if (server) {
    server.kill();
  }

  // Windows keeps the spawned server's cwd locked until the
  // process exits — retry briefly, then leave the temp dir.
  if (workDir && existsSync(workDir)) {
    const deadline = Date.now() + 3000;

    while (Date.now() < deadline) {
      try {
        rmSync(workDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
});

function testLayout(overrides = {}) {
  return {
    version: 2,
    canvas: { width: 400, height: 240 },
    grid: { cols: 4, rows: 2 },
    alpha: true,
    shadow: false,
    theme: "default",
    font: "vt323",
    themeOverrides: {},
    items: [
      { id: "t-a", type: "stick", col: 0, row: 0,
        props: { size: "med", xChannel: 0, yChannel: 1, showCaption: false,
                 boxColor: null, crosshairColor: null, dotColor: null } }
    ],
    ...overrides
  };
}

test("lists the five bundled presets with humanized names", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/layouts`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.presets));
  assert.ok(Array.isArray(payload.user));
  assert.equal(payload.user.length, 0, "fresh cwd has no user layouts");

  const ids = payload.presets.map((preset) => preset.id);

  for (const expected of [
    "simple",
    "simple-sticks",
    "minimal-dash",
    "donuts",
    "dark-with-sticks"
  ]) {
    assert.ok(ids.includes(expected), `preset ${expected} listed`);
  }

  for (const preset of payload.presets) {
    assert.ok(preset.name.length > 0, "preset name humanized");
  }
});

test("loads a preset through the normalized endpoint", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/layouts/${encodeURIComponent("simple")}`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.layout.version, 2);
  assert.ok(payload.layout.canvas.width > 0);
  assert.ok(payload.boxes, "normalized response carries boxes");
  assert.equal(Array.isArray(payload.warnings), true);
});

test("unknown layout id returns 404", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/layouts/${encodeURIComponent("nope")}`);

  assert.equal(response.status, 404);
});

test("save, list, load, overwrite, delete round-trip", async () => {
  if (!hasFixture) return;

  const saved = await fetch(`${base}/api/layouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "My Test Layout", layout: testLayout() })
  });
  const savedPayload = await saved.json();

  assert.equal(saved.status, 201);
  assert.equal(savedPayload.id, "My Test Layout");
  assert.equal(savedPayload.name, "My Test Layout");

  const list1 = await (await fetch(`${base}/api/layouts`)).json();
  assert.equal(list1.user.length, 1);
  assert.equal(list1.user[0].id, "My Test Layout");

  // Overwrite under the same name (id is case-preserved).
  await fetch(`${base}/api/layouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "My Test Layout",
      layout: testLayout({ canvas: { width: 640, height: 360 } })
    })
  });

  const list2 = await (await fetch(`${base}/api/layouts`)).json();
  assert.equal(list2.user.length, 1, "overwrite does not duplicate");

  const loaded = await (
    await fetch(`${base}/api/layouts/${encodeURIComponent("My Test Layout")}`)
  ).json();

  assert.equal(loaded.layout.canvas.width, 640, "saved doc was normalized");

  const deleted = await fetch(
    `${base}/api/layouts/${encodeURIComponent("My Test Layout")}`,
    { method: "DELETE" }
  );
  assert.equal(deleted.status, 200);

  const list3 = await (await fetch(`${base}/api/layouts`)).json();
  assert.equal(list3.user.length, 0);

  const fileOnDisk = join(workDir, "layouts", "My Test Layout.gimbal.json");
  assert.equal(existsSync(fileOnDisk), false, "file removed from layouts/");
});

test("rejects unsafe names with 400", async () => {
  if (!hasFixture) return;

  for (const name of ["", "   ", "..", "../evil", "a/b", "a\\b"]) {
    const response = await fetch(`${base}/api/layouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, layout: testLayout() })
    });

    assert.equal(response.status, 400, `name ${JSON.stringify(name)} rejected`);
  }

  const list = await (await fetch(`${base}/api/layouts`)).json();
  assert.equal(list.user.length, 0, "no layouts written by bad names");
});

test("deleting an unknown user layout returns 404", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/layouts/${encodeURIComponent("ghost")}`, {
    method: "DELETE"
  });

  assert.equal(response.status, 404);
});

test("preview accepts maxWidth for card thumbnails", async () => {
  if (!hasFixture) return;

  const response = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: testLayout(), maxWidth: 160 })
  });

  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get("X-Frame-Width")) <= 160);
  assert.ok(Number(response.headers.get("X-Frame-Height")) > 0);

  const buffer = await response.arrayBuffer();
  assert.ok(buffer.byteLength > 0);
  assert.equal(buffer.byteLength % 4, 0, "RGBA payload");
});

test("saved layout file on disk is normalized v2 JSON", async () => {
  if (!hasFixture) return;

  await fetch(`${base}/api/layouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "diskcheck",
      // Junk the server must drop/clamp.
      layout: {
        ...testLayout(),
        junkTopLevel: true,
        items: [
          ...testLayout().items,
          { id: "junk", type: "nonsense", col: 0, row: 0, props: {} }
        ]
      }
    })
  });

  const raw = JSON.parse(
    readFileSync(join(workDir, "layouts", "diskcheck.gimbal.json"), "utf8")
  );

  assert.equal(raw.version, 2);
  assert.equal(raw.junkTopLevel, undefined);
  assert.equal(raw.items.some((item) => item.id === "junk"), false);

  await fetch(`${base}/api/layouts/${encodeURIComponent("diskcheck")}`, {
    method: "DELETE"
  });
});