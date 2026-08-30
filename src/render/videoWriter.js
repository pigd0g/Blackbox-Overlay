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

    this.ffmpeg = spawn("ffmpeg", [
      "-y",
      "-loglevel", "error",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${width}x${height}`,
      "-r", String(fps),
      "-i", "pipe:0",
      ...encoderArgs,
      "-movflags", "+faststart",
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