// ======================================================
// RotorFlight-Blackbox-Video-Overlay — TEXT WIDGET (v2)
// ======================================================
//
// Label + Value card, auto-sized to its measured content:
//
//   alignment "stacked" — value centred under a centred label
//   alignment "inline"  — label then value on one row
//
// Custom Text items paint their own lines (multi-line via
// \n) with no label. Optional card (rounded, colour slot)
// and optional left accent stripe.
//
// ======================================================

import { pixelRectRounded } from "./pixelPrimitives.js";

export const CARD_PADDING = 12;
export const ACCENT_WIDTH = 4;
export const CARD_RADIUS = 6;
export const LABEL_VALUE_GAP = 4;
export const CUSTOM_LINE_LEAD = 1.25;

/**
 * Paint one text card. Geometry must match layoutSchema's
 * measure pass (boxes drive hit-testing).
 *
 *   box         item bounding box { x, y, width, height }
 *   label       label text | null
 *   valueText   display string | null (custom text renders
 *               from props.customText instead)
 *   colors      resolved { label, value, card, accent }
 *   renderer    text renderer (font family already applied)
 *   sizes       { label, value } px
 *   shadowColor [r,g,b,a] | null
 */
export function paintTextWidget(
  buf,
  width,
  height,
  box,
  item,
  valueText,
  colors,
  renderer,
  sizes,
  shadowColor
) {
  const boxX = Math.round(box.x);
  const boxY = Math.round(box.y);
  const boxW = Math.round(box.width);
  const boxH = Math.round(box.height);

  paintCard(buf, width, height, boxX, boxY, boxW, boxH, colors);

  const innerX = boxX + CARD_PADDING;
  const innerY = boxY + CARD_PADDING;
  const innerW = boxW - CARD_PADDING * 2;
  const innerH = boxH - CARD_PADDING * 2;

  if (item.props.source === "custom") {
    paintCustomLines(
      buf,
      width,
      height,
      innerX,
      innerY,
      innerW,
      innerH,
      item,
      colors.value,
      renderer,
      sizes.value,
      shadowColor
    );
    return;
  }

  const label = item.props.showLabel ? labelOrDefault(item) : null;
  const display = valueText ?? "--";

  if (label && item.props.alignment === "inline") {
    paintInline(
      buf,
      width,
      height,
      innerX,
      innerY,
      innerW,
      innerH,
      label,
      display,
      colors,
      renderer,
      sizes,
      shadowColor
    );
    return;
  }

  if (label) {
    paintStacked(
      buf,
      width,
      height,
      innerX,
      innerY,
      innerW,
      innerH,
      label,
      display,
      colors,
      renderer,
      sizes,
      shadowColor
    );
    return;
  }

  // Value only: centred.
  const vH = inkSize(renderer, sizes.value);
  const vW = renderer.measureText(display, sizes.value);

  renderer.drawText(
    buf,
    width,
    height,
    Math.round(innerX + innerW / 2 - vW / 2),
    Math.round(innerY + innerH / 2 - vH / 2),
    display,
    colors.value,
    sizes.value,
    { shadowColor }
  );
}

/** Card + accent behind the content (both optional). */
export function paintCard(buf, width, height, x, y, w, h, colors) {
  if (colors.card) {
    pixelRectRounded(buf, width, height, x, y, w, h, CARD_RADIUS, colors.card);
  }

  if (colors.accent) {
    pixelRectRounded(buf, width, height, x, y, ACCENT_WIDTH, h, CARD_RADIUS, colors.accent);
  }
}

/**
 * Stacked: label centred on top, value centred beneath,
 * the pair vertically+horizontally centred in the card.
 */
function paintStacked(
  buf,
  width,
  height,
  innerX,
  innerY,
  innerW,
  innerH,
  label,
  valueText,
  colors,
  renderer,
  sizes,
  shadowColor
) {
  const labelH = inkSize(renderer, sizes.label);
  const valueH = inkSize(renderer, sizes.value);
  const labelW = renderer.measureText(label, sizes.label);
  const valueW = renderer.measureText(valueText, sizes.value);

  const blockH = labelH + LABEL_VALUE_GAP + valueH;
  let y = Math.round(innerY + Math.max(0, (innerH - blockH) / 2));

  const lx = Math.round(innerX + (innerW - labelW) / 2);

  renderer.drawText(buf, width, height, lx, y, label, colors.label, sizes.label, { shadowColor });
  y += labelH + LABEL_VALUE_GAP;

  const vx = Math.round(innerX + (innerW - valueW) / 2);

  renderer.drawText(buf, width, height, vx, y, valueText, colors.value, sizes.value, { shadowColor });
}

/** Inline: label left, gap, value after it, vertically centred. */
function paintInline(
  buf,
  width,
  height,
  innerX,
  innerY,
  innerW,
  innerH,
  label,
  valueText,
  colors,
  renderer,
  sizes,
  shadowColor
) {
  const labelH = inkSize(renderer, sizes.label);
  const valueH = inkSize(renderer, sizes.value);
  const baselineY = Math.round(
    innerY + Math.max(0, (innerH - Math.max(labelH, valueH)) / 2)
  );

  const cursor = renderer.drawText(
    buf,
    width,
    height,
    innerX,
    baselineY - (labelH - valueH > 0 ? labelH - valueH : 0),
    label,
    colors.label,
    sizes.label,
    { shadowColor }
  );

  renderer.drawText(
    buf,
    width,
    height,
    Math.round(innerX + cursor + LABEL_VALUE_GAP),
    baselineY - 2,
    valueText,
    colors.value,
    sizes.value,
    { shadowColor }
  );
}

/** Custom text: one \n-split line per row, left-aligned. */
function paintCustomLines(
  buf,
  width,
  height,
  innerX,
  innerY,
  innerW,
  innerH,
  item,
  color,
  renderer,
  size,
  shadowColor
) {
  const text = String(item.props.customText ?? "");
  const lines = text.split("\n");
  let y = innerY;

  for (const line of lines) {
    renderer.drawText(
      buf,
      width,
      height,
      innerX,
      Math.round(y),
      line,
      color,
      size,
      { shadowColor }
    );

    y += Math.round(inkSize(renderer, size) * CUSTOM_LINE_LEAD);
  }
}

function inkSize(renderer, sizePx) {
  if (renderer.source === "bitmap") {
    return 7 * Math.max(1, Math.round(sizePx / 7));
  }

  return renderer.glyphCache(sizePx).capHeightPx;
}

function labelOrDefault(item) {
  if (item.props.labelOverride !== null && item.props.labelOverride !== undefined) {
    return item.props.labelOverride;
  }

  return defaultLabel(item.props.source);
}

import { defaultLabel } from "./valueFormat.js";