// ======================================================
// Blackbox-Overlay — DONUT CHART WIDGET (v2)
// ======================================================
//
// Analytic ring: track drawn as the full annulus, value arc
// sweeping clockwise from 12 o'clock. Sizes share the
// stick-display px presets (small 120 / med 200 / large
// 280); ring thickness = 22% of the outer diameter.
//
// Optional centre value ("Show Value in Center") and
// optional label row under the ring, both centred.
//
// ======================================================

import { pixelRing, blendPixel } from "./pixelPrimitives.js";
import { defaultLabel } from "./valueFormat.js";

export const DONUT_RING_FRACTION = 0.22;
export const DONUT_CAPTION_GAP = 4;
export const DONUT_HOLE_PAD = 2;

/**
 * Paint one donut chart into its bounding box.
 *   box      { x, y, width, height } from the measure pass
 *   props    normalized donut item props
 *   fraction 0..1 | null (null paints track only)
 *   valueText  centre string | null
 *   colors   { track, fill, label, value, card, accent }
 *   renderer, sizes { label, value }, shadowColor
 */
export function paintDonutWidget(
  buf,
  width,
  height,
  box,
  props,
  fraction,
  valueText,
  colors,
  renderer,
  sizes,
  shadowColor
) {
  const boxX = Math.round(box.x);
  const boxY = Math.round(box.y);
  const side = donutSide(props.size);
  const outerR = Math.round(side / 2);
  const ringW = Math.max(4, Math.round(side * DONUT_RING_FRACTION));
  const innerR = outerR - ringW;

  const cx = boxX + outerR;
  const cy = boxY + outerR;

  if (colors.card || colors.accent) {
    paintCard(
      buf,
      width,
      height,
      boxX,
      boxY,
      Math.round(box.width),
      Math.round(box.height),
      colors
    );
  }

  // Track: full annulus (fraction 1 of the geometry, but
  // painted without the value arc's angular limit).
  pixelRing(buf, width, height, cx, cy, outerR, innerR, 1, colors.track);

  // Value arc.
  const clamped = Math.min(1, Math.max(0, fraction ?? 0));

  if (clamped > 0) {
    pixelRing(buf, width, height, cx, cy, outerR - 1, innerR + 1, clamped, colors.fill);
  }

  // Centre value.
  if (props.showValue && valueText) {
    paintCenterValue(
      buf,
      width,
      height,
      cx,
      cy,
      innerR,
      valueText,
      colors.value,
      renderer,
      sizes.value,
      shadowColor
    );
  }

  // Label below the ring.
  if (props.showLabel) {
    paintDonutLabel(
      buf,
      width,
      height,
      cx,
      boxY + side + DONUT_CAPTION_GAP,
      labelOrDefault(props),
      colors.label,
      renderer,
      sizes.label,
      shadowColor
    );
  }
}

function paintCenterValue(
  buf,
  width,
  height,
  cx,
  cy,
  innerR,
  text,
  color,
  renderer,
  sizePx,
  shadowColor
) {
  const hole = innerR * 2 - DONUT_HOLE_PAD * 2;
  let size = Math.max(8, Math.round(sizePx));
  let textW = renderer.measureText(text, size);

  // Shrink until it fits (deterministic: proportional to
  // the overflow, floor at 8px).
  if (textW > hole && textW > 0) {
    size = Math.max(8, Math.floor(size * (hole / textW)));
    textW = renderer.measureText(text, size);
  }

  const textH = inkSize(renderer, size);

  renderer.drawText(
    buf,
    width,
    height,
    Math.round(cx - textW / 2),
    Math.round(cy - textH / 2),
    text,
    color,
    size,
    { shadowColor }
  );
}

function paintDonutLabel(
  buf,
  width,
  height,
  cx,
  textY,
  label,
  color,
  renderer,
  labelSize,
  shadowColor
) {
  const textW = renderer.measureText(label, labelSize);

  renderer.drawText(
    buf,
    width,
    height,
    Math.round(cx - textW / 2),
    Math.round(textY),
    label,
    color,
    labelSize,
    { shadowColor }
  );
}

function donutSide(sizeKey) {
  return SIZES[sizeKey] ?? SIZES.med;
}

function inkSize(renderer, sizePx) {
  if (renderer.source === "bitmap") {
    return 7 * Math.max(1, Math.round(sizePx / 7));
  }

  return renderer.glyphCache(sizePx).capHeightPx;
}

function labelOrDefault(props) {
  if (props.labelOverride !== null && props.labelOverride !== undefined) {
    return props.labelOverride;
  }

  return defaultLabel(props.source);
}

import { WIDGET_SIZES as SIZES } from "./layoutSchema.js";
import { paintCard } from "./widgetText.js";