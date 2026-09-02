// ======================================================
// RotorFlight-Blackbox-Video-Overlay — VIDEO WRITER
// ======================================================
//
// Streams raw RGBA frames into an ffmpeg process via
// stdin. Two output modes:
//
//   opaque (default)
//     ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r fps \
//       -i pipe:0 -c:v libx264 -pix_fmt yuv420p out.mp4
//
//   alpha (transparent background)
//     ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r fps \
//       -i pipe:0 <encoder args from outputFormats.js> out.mov|.webm
//
// Alpha formats (src/render/outputFormats.js) carry a full
// alpha channel — editors (Premiere, FCP, Resolve, VEGAS)
// key them as an overlay. MP4/H.264 cannot store alpha.
//
// No image library: every frame is a Uint8Array sized
// WIDTH * HEIGHT * 4, written in playback order.
//
// ======================================================

import { spawn } from "node:child_process";
import { resolveOutputFormat } from "./outputFormats.js";

export class VideoWriter {
  /**
   * @param {string} outputPath destination .mp4, .mov or .webm
   * @param {number} fps        frames per second
   * @param {number} width      frame width in pixels (even)
   * @param {number} height     frame height in pixels (even)
   * @param {object} [options]
   * @param {boolean} [options.alpha] encode with alpha instead
   *        of background-filled H.264 .mp4
   * @param {string} [options.format] codec id from
   *        outputFormats.js (alpha default: png-rgba)
   */
  constructor(outputPath, fps, width, height, { alpha = false, format } = {}) {
    this.outputPath = outputPath;
    this.fps = fps;
    this.width = width;
    this.height = height;
    this.alpha = alpha === true;
    // The opaque H.264 path stays hardcoded (it predates the
    // registry); alpha codecs resolve through it.
    this.format = this.alpha ? resolveOutputFormat(format) : null;
    this.frameSize = width * height * 4;
    this.framesWritten = 0;
    this.closed = false;

    const encoderArgs = this.alpha
      ? [...this.format.args]
      : ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"];

    // faststart's moov rewrite only helps web streaming;
    // skipping it avoids a full-file rewrite of ProRes .mov.
    const muxerArgs = this.alpha
      ? []
      : ["-movflags", "+faststart"];

    this.ffmpeg = spawn("ffmpeg", [
      "-y",
      "-loglevel", "error",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${width}x${height}`,
      "-r", String(fps),
      "-i", "pipe:0",
      ...encoderArgs,
      ...muxerArgs,
      outputPath
    ], {
      stdio: ["pipe", "ignore", "pipe"]
    });

    this.stderrChunks = [];

    this.ffmpeg.stderr.on("data", (chunk) => {
      this.stderrChunks.push(chunk);
    });

    this.exited = new Promise((resolve) => {
      this.ffmpeg.on("close", (code) => {
        this.exitCode = code;
        resolve(code);
      });
    });

    this.ffmpeg.stdin.on("error", (error) => {
      // EPIPE when ffmpeg dies mid-stream: the close handler
      // reports the real failure, ignore the write-side noise.
      if (error.code !== "EPIPE") {
        this.writeError = error;
      }
    });
  }

  /**
   * Write one frame (Uint8Array of WIDTH*HEIGHT*4 RGBA bytes).
   * Backpressure-aware: returns a promise when the pipe
   * buffer fills, so the caller can await between frames.
   * If ffmpeg dies while we wait for a drain, the wait
   * resolves through the exit race and throws with the
   * encoder's stderr — a dead encoder must never hang the
   * render loop.
   */
  async writeFrame(frame) {
    if (this.closed) {
      throw new Error("VideoWriter already closed");
    }

    if (frame.length !== this.frameSize) {
      throw new Error(
        `Frame size mismatch: expected ${this.frameSize} bytes, got ${frame.length}`
      );
    }

    const stdin = this.ffmpeg.stdin;

    if (!stdin.write(frame)) {
      await Promise.race([
        new Promise((resolve) => stdin.once("drain", resolve)),
        this.exited
      ]);

      if (this.exitCode !== undefined && this.exitCode !== 0) {
        throw new Error(this.errorMessage());
      }
    }

    this.framesWritten += 1;
  }

  /** Full error text for a non-zero ffmpeg exit. */
  errorMessage() {
    const stderr = Buffer
      .concat(this.stderrChunks)
      .toString()
      .trim();

    return `ffmpeg exited with code ${this.exitCode}` +
      (stderr ? `: ${stderr}` : "");
  }

  /** Finish encoding; resolves when ffmpeg exits. */
  async finish() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await new Promise((resolve) => this.ffmpeg.stdin.end(resolve));
    await this.exited;

    if (this.exitCode !== 0) {
      throw new Error(this.errorMessage());
    }
  }

  /** Abort on error paths; kills ffmpeg so nothing hangs. */
  async abort() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.ffmpeg.kill();
    await this.exited;
  }
}

/** Verify ffmpeg is usable before starting a render. */
export function checkFfmpegAvailable() {
  return new Promise((resolve) => {
    const probe = spawn("ffmpeg", ["-version"], {
      stdio: ["ignore", "ignore", "ignore"]
    });

    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
}

// Checkerboard cell + colours for the flattened alpha preview
// — mirrors the GUI's transparency affordance so the browser
// dialog shows exactly what an editor would key.
const PREVIEW_CHECKER_SIZE = 20;
const PREVIEW_CHECKER_A = [201, 205, 210]; // #C9CDD2
const PREVIEW_CHECKER_B = [236, 239, 242]; // #ECEFF2

/**
 * Flatten a finished alpha .mov over a static checkerboard and
 * encode a browser-playable H.264 .preview.mp4 — one ffmpeg
 * post-pass instead of a second live encoder during the render.
 *
 * The checkerboard is generated inside ffmpeg (color source +
 * per-channel geq), so no JS pixel loop and no image library:
 * the pattern reproduces the 20px checker grid (#C9CDD2 /
 * #ECEFF2) the render loop used to composite in JS, and
 * overlay() does the alpha blend at C speed.
 */
export function flattenAlphaPreview(movPath, outputPath, fps, width, height) {
  const checker =
    `color=c=#C9CDD2:s=${width}x${height}:r=${fps},format=rgb24,` +
    `geq=` +
    `r='if(mod(floor(X/${PREVIEW_CHECKER_SIZE})+floor(Y/${PREVIEW_CHECKER_SIZE}),2),` +
    `${PREVIEW_CHECKER_A[0]},${PREVIEW_CHECKER_B[0]})'` +
    `:g='if(mod(floor(X/${PREVIEW_CHECKER_SIZE})+floor(Y/${PREVIEW_CHECKER_SIZE}),2),` +
    `${PREVIEW_CHECKER_A[1]},${PREVIEW_CHECKER_B[1]})'` +
    `:b='if(mod(floor(X/${PREVIEW_CHECKER_SIZE})+floor(Y/${PREVIEW_CHECKER_SIZE}),2),` +
    `${PREVIEW_CHECKER_A[2]},${PREVIEW_CHECKER_B[2]})'`;

  const ffmpeg = spawn("ffmpeg", [
    "-y",
    "-loglevel", "error",
    "-i", movPath,
    "-f", "lavfi", "-i", checker,
    "-filter_complex",
    // Overlay the keyed overlay over the checkerboard; the
    // color source is infinite, so shortest ends at the .mov.
    "[0:v]format=yuva444p[fg];[1:v][fg]overlay=0:0:shortest=1,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-movflags", "+faststart",
    outputPath
  ], {
    stdio: ["ignore", "ignore", "pipe"]
  });

  const stderrChunks = [];

  ffmpeg.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  return new Promise((resolve, reject) => {
    ffmpeg.on("error", (error) => reject(error));

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = Buffer
        .concat(stderrChunks)
        .toString()
        .trim();

      reject(new Error(
        `ffmpeg preview flatten exited with code ${code}` +
        (stderr ? `: ${stderr}` : "")
      ));
    });
  });
}