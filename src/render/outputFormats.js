// ======================================================
// Blackbox-Overlay — OUTPUT FORMATS
// ======================================================
//
// The codec registry behind the GUI's FMT dropdown. Each
// entry is one ffmpeg encoder configuration; the VideoWriter
// turns an entry into its encoder argument list.
//
// Alpha entries (transparent overlays):
//   D  png-rgba        PNG lossless          .mov   (default)
//   A  vp9-yuva420p    VP9 alpha 4:2:0       .webm  (small)
//   C  prores4444-12   ProRes 4444 (12-bit)  .mov   (large)
//
// Opaque entry (filled with the theme background):
//   h264-yuv420p       H.264 .mp4            .mp4
//
// VP9 alpha (WebM) stores alpha as a side data flag
// (alpha_mode=1); players such as Chrome, VLC and editors
// with WebM support key it correctly.
//
// ======================================================

/**
 * One output format. `args` are the encoder arguments
 * appended after the rawvideo input; `extension` drives the
 * output-path rules and the container. `alpha` marks codecs
 * that carry a transparency channel; `opaqueOnly` marks the
 * background-filled H.264 entry the dropdown hides when
 * Transparency is on.
 *
 * @typedef {object} OutputFormat
 * @property {string}   id          stable identifier (dropdown value)
 * @property {string}   label       GUI text
 * @property {string}   extension   output extension incl. dot
 * @property {string[]} args        ffmpeg encoder arguments
 * @property {boolean}  [alpha]     carries transparency
 * @property {boolean}  [opaqueOnly] hidden while Transparency is on
 */

/**
 * The render menu, in dropdown order. Index 0 is the default.
 * @type {OutputFormat[]}
 */
export const OUTPUT_FORMATS = [
  {
    id: "png-rgba",
    label: "PNG lossless (Medium)",
    extension: ".mov",
    alpha: true,
    args: ["-c:v", "png", "-pix_fmt", "rgba"]
  },
  {
    id: "vp9-yuva420p",
    label: "VP9 alpha 4:2:0 (Small)",
    extension: ".webm",
    alpha: true,
    args: ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "30", "-b:v", "0"]
  },
  {
    id: "prores4444-12",
    label: "ProRes 4444 12-bit (Large)",
    extension: ".mov",
    alpha: true,
    args: ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p12le"]
  },
  {
    id: "h264-yuv420p",
    label: "H.264 MP4 (Small)",
    extension: ".mp4",
    alpha: false,
    opaqueOnly: true,
    args: ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]
  }
];

export const DEFAULT_OUTPUT_FORMAT = OUTPUT_FORMATS[0].id;

const FORMAT_BY_ID = new Map(
  OUTPUT_FORMATS.map((format) => [format.id, format])
);

/**
 * Resolve a requested format id, falling back to the default
 * (PNG lossless) for null/garbage.
 *
 * @param {string|null} [id]
 * @returns {OutputFormat}
 */
export function resolveOutputFormat(id) {
  if (typeof id === "string" && FORMAT_BY_ID.has(id)) {
    return FORMAT_BY_ID.get(id);
  }

  return FORMAT_BY_ID.get(DEFAULT_OUTPUT_FORMAT);
}

/**
 * Look up a format strictly; throws for unknown ids so bad
 * client values surface instead of silently re-encoding.
 *
 * @param {string} id
 * @returns {OutputFormat}
 */
export function outputFormatOrThrow(id) {
  const format = typeof id === "string" ? FORMAT_BY_ID.get(id) : null;

  if (!format) {
    throw new Error(
      `Unknown output format "${id}". Known: ${[...FORMAT_BY_ID.keys()].join(", ")}.`
    );
  }

  return format;
}

/**
 * Formats offered for a Transparency setting: alpha codecs
 * when transparent, everything else (H.264) when opaque.
 *
 * @param {boolean} transparent
 * @returns {OutputFormat[]}
 */
export function formatsForMode(transparent) {
  return OUTPUT_FORMATS.filter(
    (format) => (transparent ? format.alpha === true : format.alpha !== true)
  );
}