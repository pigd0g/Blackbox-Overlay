// ======================================================
// RotorFlight-Blackbox-Video-Overlay — PROGRESS BAR WIDGET (v2)
// ======================================================
//
// Horizontal or vertical progress bar with the rounded-pill
// treatment of v1's paintVerticalBar:
//
//   vertical    fill rises from the bottom ("up = more")
//   horizontal  fill grows left → right
//
// Fraction ∈ [0,1] arrives pre-resolved (sceneState's
// min-max / percent / dynamic maths). Optional label row
// above the bar. Optional card behind everything (card +
// accent colour slots).
//
// ======================================================

import { pixelRectRounded } from "./pixelPrimitives.js";
import { defaultLabel } from "./valueFormat.js";
import { paintCard } from "./widgetText.js";

export const BAR_TRACK_RADIUS = 3;
export const BAR_FILL_INSET = 1;
export const BAR_FILL_RADIUS = 2;
export const BAR_LABEL_GAP = 4;

/**
 * Paint one progress bar into its bounding box.
 *   box    { x, y, width, height } from the layout measure
 *   props  normalized bar item props
 *   fraction      0..1 | null (null paints empty)
 *   colors        { track, fill, label, card, accent }
 *   renderer, labelSize, shadowColor — caption typography
 */
export function paintBarWidget(
  buf,
  width,
  height,
  box,
  props,
  fraction,
  colors,
  renderer,
  labelSize,
  shadowColor
) {
  const horizontal = props.orientation === "horizontal";
  const barW = Math.round(props.width);
  const barH = Math.round(props.height);
  const boxX = Math.round(box.x);
  const boxY = Math.round(box.y);

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

  // Default bar placement: top-left of the box (the item's
  // anchor), with the label (when shown) above it.
  let barX = boxX;
  let barY = boxY;

  const label = props.showLabel ? labelOrDefault(props) : null;

  if (label) {
    const labelH = inkSize(renderer, labelSize);
    const labelW = renderer.measureText(label, labelSize);
    const labelX =
      horizontal ? boxX : Math.round(boxX + barW / 2 - labelW / 2);

    renderer.drawText(
      buf,
      width,
      height,
      labelX,
      boxY,
      label,
      colors.label,
      labelSize,
      { shadowColor }
    );

    barY = boxY + labelH + BAR_LABEL_GAP;
  }

  if (horizontal) {
    paintHorizontalBar(buf, width, height, barX, barY, barW, barH, fraction, colors);
  } else {
    paintVerticalBar(buf, width, height, barX, barY, barW, barH, fraction, colors);
  }
}

/** Vertical: track full-height, fill rises from the bottom. */
function paintVerticalBar(buf, width, height, x, y, barW, barH, fraction, colors) {
  pixelRectRounded(buf, width, height, x, y, barW, barH, BAR_TRACK_RADIUS, colors.track);

  const clamped = Math.min(1, Math.max(0, fraction ?? 0));
  const fillHeight = Math.round(barH * clamped);

  if (fillHeight > 0) {
    pixelRectRounded(
      buf,
      width,
      height,
      x + BAR_FILL_INSET,
      y + barH - fillHeight,
      barW - BAR_FILL_INSET * 2,
      fillHeight,
      BAR_FILL_RADIUS,
      colors.fill
    );
  }
}

/** Horizontal: track full-width, fill grows left → right. */
function paintHorizontalBar(buf, width, height, x, y, barW, barH, fraction, colors) {
  pixelRectRounded(buf, width, height, x, y, barW, barH, BAR_TRACK_RADIUS, colors.track);

  const clamped = Math.max(0, Math.min(1, fraction ?? 0));
  const fillW = Math.round(barW * clamped);

  if (fillW > 0) {
    pixelRectRounded(
      buf,
      width,
      height,
      x + BAR_FILL_INSET,
      y + BAR_FILL_INSET,
      fillW,
      barH - BAR_FILL_INSET * 2,
      BAR_FILL_RADIUS,
      colors.fill
    );
  }
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