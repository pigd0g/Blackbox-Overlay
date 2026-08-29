#!/usr/bin/env node
// ======================================================
// GIMBALVID — LOCAL GUI SERVER
// ======================================================
//
// Serves the GimbalVid console (src/gui/public) and its
// JSON/preview/SSE API from src/gui/api.js.
//
//   node src/gui/serve.js [--port N] [--no-open]
//
// Binds 127.0.0.1 only — nothing leaves the machine.
//
// ======================================================

import { createServer } from "node:http";
import { statSync, createReadStream, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  browseDirectory,
  describeLog,
  renderPreviewFrame,
  flightTrace,
  startRenderJob,
  jobStatus,
  currentJob,
  subscribeJob,
  themeCatalog,
  ffmpegAvailable,
  resolveOutputPath,
  isCompletedOutput,
  tempDir
} from "./api.js";

const PUBLIC_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "public"
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4"
};

// ------------------------------------------------------
// HTTP helpers
// ------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, status, message, code) {
  const payload = { error: message };

  if (code) {
    payload.code = code;
  }

  sendJson(res, status, payload);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > limit) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolvePromise({});
        return;
      }

      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(join(PUBLIC_DIR, relative));

  // Reject escapes AND anything that smuggles separators the
  // URL parser did not decode for us (e.g. %2f, backslashes).
  const isInside =
    (target === PUBLIC_DIR || target.startsWith(PUBLIC_DIR + sep)) &&
    !relative.includes("%2e") &&
    !relative.includes("%2f") &&
    !relative.includes("%5c") &&
    !relative.includes("\\") &&
    !relative.includes("..");

  if (!isInside) {
    sendError(res, 403, "Forbidden");
    return;
  }

  let stats;

  try {
    stats = statSync(target);

    if (stats.isDirectory()) {
      sendError(res, 403, "Forbidden");
      return;
    }
  } catch {
    sendError(res, 404, "Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": "no-store"
  });
  createReadStream(target).pipe(res);
}

// ------------------------------------------------------
// SSE
// ------------------------------------------------------

function serveJobEvents(req, res, jobId) {
  // Headers first: subscribing delivers an initial snapshot
  // through res.write(), which would otherwise implicitly
  // send default headers and make writeHead throw.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });

  const unsubscribe = subscribeJob(jobId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  if (!unsubscribe) {
    sendError(res, 404, "No such job");
    return;
  }

  // Northbound keepalive comment so proxies do not sit on
  // the stream; also detects closed sockets.
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
}

// ------------------------------------------------------
// Routing
// ------------------------------------------------------

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === "GET" && pathname === "/api/state") {
    const [ffmpeg] = await Promise.all([ffmpegAvailable()]);
    return sendJson(res, 200, {
      ffmpeg: ffmpeg,
      themes: themeCatalog(),
      activeJob: currentJob(),
      home: tempDir()
    });
  }

  if (req.method === "GET" && pathname === "/api/browse") {
    try {
      return sendJson(res, 200, browseDirectory(searchParams.get("dir")));
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/log") {
    const body = await readBody(req);

    try {
      return sendJson(res, 200, describeLog(body.path ?? body.file));
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  if (req.method === "POST" && pathname === "/api/preview") {
    const body = await readBody(req);

    let result;

    try {
      result = renderPreviewFrame(body);
    } catch (error) {
      return sendError(res, 400, error.message);
    }

    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "X-Frame-Width": String(result.width),
      "X-Frame-Height": String(result.height),
      "Content-Length": result.pixels.length,
      "Cache-Control": "no-store"
    });
    return void res.end(result.pixels);
  }

  if (req.method === "POST" && pathname === "/api/trace") {
    const body = await readBody(req);

    try {
      return sendJson(res, 200, flightTrace(body));
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  if (
    req.method === "POST" &&
    (pathname === "/api/trace" || pathname === "/api/preview")
  ) {
    // Both handlers read JSON bodies; fall through below.
  }

  if (req.method === "POST" && pathname === "/api/upload") {
    // Drag-and-drop lands here: raw bytes -> temp dir, then
    // decoded like any other log path.
    const chunks = [];
    let size = 0;

    await new Promise((resolvePromise, reject) => {
      req.on("data", (chunk) => {
        size += chunk.length;

        if (size > 512 * 1024 * 1024) {
          reject(new Error("File too large (512 MB limit)."));
          req.destroy();
          return;
        }

        chunks.push(chunk);
      });
      req.on("end", resolvePromise);
      req.on("error", reject);
    });

    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0) {
      return sendError(res, 400, "No file content received.");
    }

    const stamp = Date.now().toString(36);
    const dir = join(tempDir(), "gimbalvid-uploads");
    mkdirSync(dir, { recursive: true });

    const target = join(dir, `drop-${stamp}.bbl`);
    writeFileSync(target, buffer);

    return sendJson(res, 201, { path: target });
  }

  if (req.method === "POST" && pathname === "/api/render") {
    const body = await readBody(req);

    if (!body.path && !body.file) {
      return sendError(res, 400, "path and flight are required.");
    }

    const sourceFile = body.path ?? body.file;
    // Renders always land in <cwd>/out/ — a bare name keeps
    // its stem, anything path-like is flattened.
    const output = resolveOutputPath(body.output, sourceFile, body.flight);

    try {
      const started = startRenderJob({
        file: sourceFile,
        flight: body.flight,
        fps: body.fps,
        theme: body.theme,
        output
      });

      return sendJson(res, 202, started);
    } catch (error) {
      const status = error.code === "busy" ? 409 : 400;

      return sendError(res, status, error.message, error.code);
    }
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);

  if (req.method === "GET" && jobMatch) {
    return serveJobEvents(req, res, jobMatch[1]);
  }

  const statusMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);

  if (req.method === "GET" && statusMatch) {
    const snapshot = jobStatus(statusMatch[1]);

    return snapshot
      ? sendJson(res, 200, snapshot)
      : sendError(res, 404, "No such job");
  }

  if (req.method === "GET" && pathname === "/api/media") {
    const filePath = resolve(String(searchParams.get("path") ?? ""));

    if (!isCompletedOutput(filePath) || !existsSync(filePath)) {
      return sendError(res, 404, "Rendered file not available");
    }

    const stats = statSync(filePath);

    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stats.size,
      "Cache-Control": "no-store"
    });
    return void createReadStream(filePath).pipe(res);
  }

  return sendError(res, 404, `No such API route: ${req.method} ${pathname}`);
}

// ------------------------------------------------------
// Bootstrap
// ------------------------------------------------------

function parseServeArgs(argv) {
  const options = { port: 0, open: true };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--port") {
      i += 1;
      const value = Number(argv[i]);

      if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error("--port expects a valid port number");
      }

      options.port = value;
    } else if (arg === "--no-open") {
      options.open = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printServeUsage() {
  console.log(`gimbalvid GUI — local console for decoding and rendering .bbl logs

Usage:
  node src/gui/serve.js [options]

Options:
  --port N   listen on a specific port (default: pick a free port)
  --no-open  do not open the browser automatically
  --help     show this help`);
}

async function main() {
  const options = parseServeArgs(process.argv.slice(2));

  if (options.help) {
    printServeUsage();
    return;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    Promise.resolve(url.pathname.startsWith("/api/")
        ? handleApi(req, res, url)
        : serveStatic(req, res, url.pathname)
    ).catch((error) => {
      if (!res.headersSent) {
        sendError(res, 500, error.message);
      } else {
        res.end();
      }
    });
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolvePromise());
  });

  const address = `http://127.0.0.1:${server.address().port}`;

  console.log(`gimbalvid console running at ${address}`);
  console.log("Press Ctrl+C to stop.");

  if (options.open) {
    const { spawn } = await import("node:child_process");

    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", address], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [address], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [address], { detached: true, stdio: "ignore" }).unref();
    }
  }
}

main().catch((error) => {
  console.error(`gimbalvid GUI failed: ${error.message}`);
  process.exitCode = 1;
});