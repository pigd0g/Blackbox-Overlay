// ======================================================
// Blackbox-Overlay — MINIMAL TTF ENGINE
// ======================================================
//
// Pure-JS TrueType outline parser — no dependencies, same
// hand-rolled spirit as the rest of the render pipeline.
// Only the tables needed to measure and outline glyphs of
// static font instances are read:
//
//   sfnt header + table directory
//   head  unitsPerEm, indexToLocFormat
//   hhea  ascent, descent, numberOfHMetrics
//   maxp  numGlyphs
//   hmtx  advance widths
//   cmap  codepoint → glyph id (format 12 and 4)
//   loca  glyph offsets (short and long forms)
//   glyf  quadratic contours — simple AND composite glyphs
//
// Out of scope by design: variable fonts (fvar/gvar — the
// registry resolves weights to static instance files),
// hinting instructions (skipped), GPOS/GSUB kerning, and
// CFF outlines ('OTTO' boxes throw a clear error; every
// bundled font is TrueType quadratic).
//
// Coordinates stay in font units; Y grows UP (TrueType
// convention). The rasterizer handles scaling.
//
// Parsed faces are cached per absolute path so renders and
// GUI previews share one parse.
//
// ======================================================

import { readFileSync } from "node:fs";

// Composite glyph component flags (glyf spec).
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

/** Per-glyph recursion/visit guard for composite graphs. */
const MAX_COMPONENT_DEPTH = 16;

const cache = new Map();

/**
 * Load (and cache) a TrueType font file. Returns a face:
 *
 *   unitsPerEm       design units per em square
 *   ascent/descent   hhea metrics, font units (descent < 0)
 *   numGlyphs        glyph count
 *   glyphId(char)    cmap lookup → glyph id (0 = .notdef)
 *   advance(char)    advance width, font units (0 if unknown)
 *   outline(glyphId) contours: [{ points: [{x, y, onCurve}] }]
 *                    composites resolved recursively
 */
export function loadTtfFont(filePath) {
  const key = String(filePath);

  if (cache.has(key)) {
    return cache.get(key);
  }

  const face = parseTtf(filePath);

  cache.set(key, face);

  return face;
}

/** Test hook: drop cached parses. */
export function clearTtfCache() {
  cache.clear();
}

function parseTtf(filePath) {
  const buffer = readFileSync(filePath);
  const reader = new Reader(buffer);

  const version = reader.u32();

  if (version === 0x4f54544f) {
    throw new Error(
      `${filePath}: CFF-outline font ('OTTO') — only TrueType outlines are supported`
    );
  }

  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new Error(
      `${filePath}: not a TrueType font (sfnt version 0x${version.toString(16)})`
    );
  }

  const tableCount = reader.u16();
  reader.skip(6); // searchRange, entrySelector, rangeShift

  const tables = new Map();

  for (let i = 0; i < tableCount; i += 1) {
    const tag = String.fromCharCode(
      reader.u8(),
      reader.u8(),
      reader.u8(),
      reader.u8()
    );
    reader.u32(); // checksum
    const offset = reader.u32();
    const length = reader.u32();
    tables.set(tag, { offset, length });
  }

  const head = parseHead(reader, tables);
  const maxp = parseMaxp(reader, tables);
  const hhea = parseHhea(reader, tables);
  const hmtx = parseHmtx(reader, hhea, maxp, tables);
  const codeToGlyph = parseCmap(reader, tables);
  const loca = parseLoca(reader, head, maxp, tables);
  const glyf = tableRequired(tables, "glyf");

  function glyphId(char) {
    const code = typeof char === "number" ? char : char.codePointAt(0);
    return codeToGlyph.get(code) ?? 0;
  }

  function advance(char) {
    const id = glyphId(char);

    return id < hmtx.advances.length ? hmtx.advances[id] : 0;
  }

  function outline(glyphIndex, depth = 0) {
    if (glyphIndex < 0 || glyphIndex >= loca.length - 1) {
      return [];
    }

    const start = loca[glyphIndex];
    const end = loca[glyphIndex + 1];

    if (end <= start) {
      return []; // empty glyph (space) — no contours
    }

    // Fresh reader per glyph: composite parsing recurses into
    // component glyphs, which must not disturb this glyph's
    // cursor position.
    const glyphReader = new Reader(buffer);

    glyphReader.seek(glyf.offset + start);
    const numberOfContours = glyphReader.i16();
    glyphReader.skip(8); // xMin, yMin, xMax, yMax

    if (numberOfContours >= 0) {
      return parseSimpleGlyph(glyphReader, numberOfContours);
    }

    if (depth >= MAX_COMPONENT_DEPTH) {
      return [];
    }

    return parseCompositeGlyph(glyphReader, outline, depth);
  }

  return {
    unitsPerEm: head.unitsPerEm,
    ascent: hhea.ascent,
    descent: hhea.descent,
    numGlyphs: maxp.numGlyphs,
    glyphId,
    advance,
    outline
  };
}

// ------------------------------------------------------
// Low-level readers
// ------------------------------------------------------

/** Big-endian byte cursor over a Buffer. */
class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.pos = 0;
  }

  seek(position) {
    this.pos = position;
    return this;
  }

  u8() {
    return this.buffer[this.pos++];
  }

  i8() {
    const value = this.buffer.readInt8(this.pos);
    this.pos += 1;

    return value;
  }

  u16() {
    const value = this.buffer.readUInt16BE(this.pos);
    this.pos += 2;

    return value;
  }

  i16() {
    const value = this.buffer.readInt16BE(this.pos);
    this.pos += 2;

    return value;
  }

  u32() {
    const value = this.buffer.readUInt32BE(this.pos);
    this.pos += 4;

    return value;
  }

  skip(bytes) {
    this.pos += bytes;
    return this;
  }
}

function tableRequired(tables, tag) {
  const entry = tables.get(tag);

  if (!entry) {
    throw new Error(`Missing required TTF table: ${tag}`);
  }

  return entry;
}

function parseHead(reader, tables) {
  const entry = tableRequired(tables, "head");
  reader.seek(entry.offset + 18); // unitsPerEm

  const unitsPerEm = reader.u16();

  if (unitsPerEm <= 0) {
    throw new Error("Invalid unitsPerEm in head table");
  }

  reader.seek(entry.offset + 50); // indexToLocFormat
  const indexToLocFormat = reader.i16();

  return { unitsPerEm, indexToLocFormat };
}

function parseMaxp(reader, tables) {
  const entry = tableRequired(tables, "maxp");
  // Layout: version i32, numGlyphs u16.
  reader.seek(entry.offset + 4);

  const numGlyphs = reader.u16();

  return { numGlyphs };
}

function parseHhea(reader, tables) {
  const entry = tableRequired(tables, "hhea");
  // Layout: version u32, ascender i16, descender i16, lineGap
  // i16, advanceWidthMax + 6 more shorts, 4 reserved, then
  // metricDataFormat and numberOfHMetrics.
  reader.seek(entry.offset + 4);

  const ascent = reader.i16();
  const descent = reader.i16();

  reader.skip(2); // lineGap
  reader.skip(2); // advanceWidthMax
  reader.skip(2); // minLeftSideBearing
  reader.skip(2); // minRightSideBearing
  reader.skip(2); // xMaxExtent
  reader.skip(2); // caretSlopeRise
  reader.skip(2); // caretSlopeRun
  reader.skip(2); // caretOffset
  reader.skip(8); // 4 x reserved
  reader.skip(2); // metricDataFormat
  const numberOfHMetrics = reader.u16();

  return { ascent, descent, numberOfHMetrics };
}

function parseHmtx(reader, hhea, maxp, tables) {
  const entry = tableRequired(tables, "hmtx");
  reader.seek(entry.offset);

  const advances = new Array(maxp.numGlyphs);

  let advance = 0;

  for (let i = 0; i < maxp.numGlyphs; i += 1) {
    if (i < hhea.numberOfHMetrics) {
      advance = reader.u16();
      reader.skip(2); // left side bearing
    } else {
      reader.skip(2); // only a side bearing for the tail glyphs
    }

    advances[i] = advance;
  }

  return { advances };
}

/**
 * Pick the best Unicode subtable: Windows (3,10) full
 * repertoire, then Unicode (0,4|6), then Windows BMP (3,1),
 * then the remaining Unicode-platform entries.
 */
function parseCmap(reader, tables) {
  const entry = tableRequired(tables, "cmap");
  reader.seek(entry.offset);

  const version = reader.u16();
  const numTables = reader.u16();

  if (version !== 0) {
    throw new Error(`Unsupported cmap version ${version}`);
  }

  let best = null;
  let bestScore = -1;

  for (let i = 0; i < numTables; i += 1) {
    const platformId = reader.u16();
    const encodingId = reader.u16();
    const subtableOffset = reader.u32();

    let score = -1;

    if (platformId === 3 && encodingId === 10) {
      score = 4;
    } else if (platformId === 0 && (encodingId === 4 || encodingId === 6)) {
      score = 3;
    } else if (platformId === 3 && encodingId === 1) {
      score = 2;
    } else if (platformId === 0 && encodingId >= 3) {
      score = 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = { platformId, encodingId, subtableOffset };
    }
  }

  if (!best || bestScore < 0) {
    throw new Error("No Unicode cmap subtable found");
  }

  reader.seek(entry.offset + best.subtableOffset);
  const format = reader.u16();

  if (format === 4) {
    return parseCmapFormat4(reader);
  }

  if (format === 12) {
    return parseCmapFormat12(reader);
  }

  throw new Error(
    `Unsupported cmap format ${format}` +
      ` (platform ${best.platformId}, encoding ${best.encodingId})`
  );
}

function parseCmapFormat4(reader) {
  reader.skip(4); // length, language
  const segCount = reader.u16() / 2;
  reader.skip(6); // searchRange, entrySelector, rangeShift

  const endCodes = [];

  for (let i = 0; i < segCount; i += 1) {
    endCodes.push(reader.u16());
  }

  reader.skip(2); // reservedPad

  const startCodes = [];

  for (let i = 0; i < segCount; i += 1) {
    startCodes.push(reader.u16());
  }

  const idDeltas = [];

  for (let i = 0; i < segCount; i += 1) {
    idDeltas.push(reader.i16());
  }

  const idRangeOffsetPositions = [];

  for (let i = 0; i < segCount; i += 1) {
    idRangeOffsetPositions.push(reader.pos);
    reader.u16(); // idRangeOffset (re-read later via position)
  }

  const map = new Map();

  for (let segment = 0; segment < segCount; segment += 1) {
    const start = startCodes[segment];
    const end = endCodes[segment];

    if (start === 0xffff) {
      continue;
    }

    const rangePosition = idRangeOffsetPositions[segment];
    const idRangeOffset = reader.buffer.readUInt16BE(rangePosition);

    for (let code = start; code <= end; code += 1) {
      let glyph;

      if (idRangeOffset === 0) {
        glyph = (code + idDeltas[segment]) & 0xffff;
      } else {
        // Glyph ids live in the glyphIdArray starting right
        // after THIS segment's idRangeOffset entry.
        const glyphPosition =
          rangePosition + idRangeOffset + (code - start) * 2;

        if (glyphPosition + 1 >= reader.buffer.length) {
          continue; // malformed font: skip rather than throw
        }

        glyph = reader.buffer.readUInt16BE(glyphPosition);

        if (glyph !== 0) {
          glyph = (glyph + idDeltas[segment]) & 0xffff;
        }
      }

      if (glyph !== 0) {
        map.set(code, glyph);
      }
    }
  }

  return map;
}

function parseCmapFormat12(reader) {
  reader.skip(8); // length(4) + language(4)
  const nGroups = reader.u32();

  const map = new Map();

  for (let g = 0; g < nGroups; g += 1) {
    const startCharCode = reader.u32();
    const endCharCode = reader.u32();
    const startGlyph = reader.u32();

    // Defensive bound: fonts do not map more than the whole
    // Unicode range; skip absurd groups instead of looping.
    const span = endCharCode - startCharCode;

    if (span > 0x10ffff) {
      continue;
    }

    for (let code = startCharCode; code <= endCharCode; code += 1) {
      map.set(code, startGlyph + (code - startCharCode));
    }
  }

  return map;
}

function parseLoca(reader, head, maxp, tables) {
  const loca = tableRequired(tables, "loca");
  reader.seek(loca.offset);

  const offsets = [];

  if (head.indexToLocFormat === 0) {
    for (let i = 0; i <= maxp.numGlyphs; i += 1) {
      offsets.push(reader.u16() * 2);
    }
  } else if (head.indexToLocFormat === 1) {
    for (let i = 0; i <= maxp.numGlyphs; i += 1) {
      offsets.push(reader.u32());
    }
  } else {
    throw new Error(`Invalid indexToLocFormat ${head.indexToLocFormat}`);
  }

  return offsets;
}

// ------------------------------------------------------
// glyf outlines
// ------------------------------------------------------

/** One simple glyph: end points → per-contour point lists. */
function parseSimpleGlyph(reader, numberOfContours) {
  const endPoints = [];

  for (let i = 0; i < numberOfContours; i += 1) {
    endPoints.push(reader.u16());
  }

  const pointCount = endPoints[numberOfContours - 1] + 1;

  const instructionLength = reader.u16();
  reader.skip(instructionLength); // hinting — deliberately unused

  // Flags (bit 0 on-curve, bit 1 x-short, bit 2 y-short,
  // bit 3 repeat, bits 4/5 x sign & same, bits 6/7 y sign & same)
  const flags = new Uint8Array(pointCount);

  let read = 0;

  while (read < pointCount) {
    const flag = reader.u8();

    flags[read++] = flag;

    if (flag & 0x08) {
      const repeat = reader.u8();

      for (let r = 0; r < repeat && read < pointCount; r += 1) {
        flags[read++] = flag;
      }
    }
  }

  const xs = new Int32Array(pointCount);
  let x = 0;

  for (let i = 0; i < pointCount; i += 1) {
    const flag = flags[i];

    if (flag & 0x02) {
      const delta = reader.u8();

      x += flag & 0x10 ? delta : -delta;
    } else if (!(flag & 0x10)) {
      x += reader.i16();
    }
    // else: 16-bit with sign bit set means "same as previous"

    xs[i] = x;
  }

  const ys = new Int32Array(pointCount);
  let y = 0;

  for (let i = 0; i < pointCount; i += 1) {
    const flag = flags[i];

    if (flag & 0x04) {
      const delta = reader.u8();

      y += flag & 0x20 ? delta : -delta;
    } else if (!(flag & 0x20)) {
      y += reader.i16();
    }

    ys[i] = y;
  }

  const contours = [];
  let start = 0;

  for (const end of endPoints) {
    const points = [];

    for (let i = start; i <= end; i += 1) {
      points.push({
        x: xs[i],
        y: ys[i],
        onCurve: (flags[i] & 0x01) !== 0
      });
    }

    contours.push(points);
    start = end + 1;
  }

  return contours;
}

/**
 * Composite glyphs: component glyphs with 2x2 transforms and
 * offsets, resolved recursively. Offsets for ARGS_ARE_XY_VALUES
 * are applied in the composite's (unscaled) font-unit space.
 * Point-matching components (args are point indices) fall back
 * to identity placement — none of the bundled fonts use them.
 */
function parseCompositeGlyph(reader, outlineFn, depth) {
  const contours = [];

  let hasMore = true;

  while (hasMore) {
    const flags = reader.u16();
    const glyphIndex = reader.u16();

    let arg1;
    let arg2;

    if (flags & ARG_1_AND_2_ARE_WORDS) {
      arg1 = reader.i16();
      arg2 = reader.i16();
    } else {
      arg1 = reader.i8();
      arg2 = reader.i8();
    }

    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;

    if (flags & WE_HAVE_A_SCALE) {
      a = reader.i16() / 16384;
      d = a;
    } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
      a = reader.i16() / 16384;
      d = reader.i16() / 16384;
    } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
      a = reader.i16() / 16384;
      b = reader.i16() / 16384;
      c = reader.i16() / 16384;
      d = reader.i16() / 16384;
    }

    hasMore = (flags & MORE_COMPONENTS) !== 0;

    const useOffsets = (flags & ARGS_ARE_XY_VALUES) !== 0;

    for (const contour of outlineFn(glyphIndex, depth + 1)) {
      const points = contour.map((point) => {
        const tx = a * point.x + c * point.y;
        const ty = b * point.x + d * point.y;

        return {
          x: useOffsets ? tx + arg1 : tx,
          y: useOffsets ? ty + arg2 : ty,
          onCurve: point.onCurve
        };
      });

      contours.push(points);
    }
  }

  return contours;
}