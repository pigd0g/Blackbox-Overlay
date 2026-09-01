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
//       -i pipe:0 -c:v prores_ks -profile:v 4444 \
//       -pix_fmt yuva444p10le out.mov
//
// ProRes 4444 carries a full alpha channel — the format
// editors (Premiere, FCP, Resolve, VEGAS) key as an
// overlay. MP4/H.264 cannot store alpha.
//
// No image library: every frame is a Uint8Array sized
// WIDTH * HEIGHT * 4, written in playback order.
//
// ======================================================

import { spawn } from "node:child_process";

export class VideoWriter {
  /**
   * @param {string} outputPath destination .mp4 or .mov
   * @param {number} fps        frames per second
   * @param {number} width      frame width in pixels (even)
   * @param {number} height     frame height in pixels (even)
   * @param {object} [options]
   * @param {boolean} [options.alpha] encode with alpha
   *        (ProRes 4444 .mov) instead of H.264 .mp4
   */
  constructor(outputPath, fps, width, height, { alpha = false } = {}) {
    this.outputPath = outputPath;
    this.fps = fps;
    this.width = width;
    this.height = height;
    this.alpha = alpha === true;
    this.frameSize = width * height * 4;
    this.framesWritten = 0;
    this.closed = false;

    const encoderArgs = this.alpha
      ? ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"]
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
      await new Promise((resolve) => stdin.once("drain", resolve));
    }

    this.framesWritten += 1;
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
      const stderr = Buffer
        .concat(this.stderrChunks)
        .toString()
        .trim();

      throw new Error(
        `ffmpeg exited with code ${this.exitCode}` +
          (stderr ? `: ${stderr}` : "")
      );
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