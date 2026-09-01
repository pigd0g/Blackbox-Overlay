// ======================================================
// RotorFlight-Blackbox-Video-Overlay — STICK WIDGET (v2)
// ======================================================
//
// One configurable stick display: theme box + crosshair +
// live dot, sized small/med/large, X/Y driven by any
// rcCommand[0..4] channel pair (uniform convention: right =
// positive, up = positive). Optional friendly-name caption
// below the box ("ROLL · PITCH").
//
// ======================================================

import { blendPixel, pixelCircle, pixelRectRounded, pixelLineH, pixelLineV } from "./pixelPrimitives.js";
import { axisPairCaption } from "./valueFormat.js";

// Tailwind "rounded-md" corner radius — v1 parity.
export const CORNER_RADIUS_MD = 6;
export const STICK_CAPTION_GAP = 4;

/**
 * Paint one stick display.
 *
 *   box         { x, y }      pixel anchor (top-left)
 *   side        px side length
 *   channels    [c0..c4] normalized values (null → centre)
 *   props       item props (size is pre-resolved to side)
 *   colors      resolved { box, crosshair, dot, label } [r,g,b,a]
 *   renderer    text renderer (caption)
 *   labelSize   caption px size
 *   shadowColor shadow [r,g,b,a] | null
 */
export function paintStickWidget(
  buf,
  width,
  height,
  box,
  side,
  channels,
  props,
  colors,
  renderer,
  labelSize,
  shadowColor
) {
  const x0 = Math.round(box.x);
  const y0 = Math.round(box.y);

  pixelRectRounded(buf, width, height, x0, y0, side, side, CORNER_RADIUS_MD, colors.box);

  const cx = x0 + side / 2;
  const cy = y0 + side / 2;
  const half = side / 2;

  pixelLineH(buf, width, height, x0 + CORNER_RADIUS_MD, x0 + side - 1 - CORNER_RADIUS_MD, Math.round(cy), colors.crosshair);
  pixelLineV(buf, width, height, Math.round(cx), y0 + CORNER_RADIUS_MD, y0 + side - 1 - CORNER_RADIUS_MD, colors.crosshair);

  // Dot at the channel pair; radius 15px = v1 parity for
  // the 200px med size, scaled gently with widget size.
  const dotRadius = 15;
  const inset = Math.max(4, half - dotRadius - 4);
  const xVal = channelValue(channels, props.xChannel);
  const yVal = channelValue(channels, props.yChannel);

  const dotX = Math.round(cx + xVal * inset);
  const dotY = Math.round(cy - yVal * inset);

  pixelCircle(buf, width, height, dotX, dotY, dotRadius, colors.dot);

  if (props.showCaption) {
    paintStickCaption(
      buf,
      width,
      height,
      x0,
      y0 + side + STICK_CAPTION_GAP,
      side,
      props.xChannel,
      props.yChannel,
      colors.label,
      renderer,
      labelSize,
      shadowColor
    );
  }
}

function channelValue(channels, channel) {
  const value = channels?.[channel];

  return Number.isFinite(value) ? value : 0;
}

function paintStickCaption(
  buf,
  width,
  height,
  x0,
  textY,
  side,
  xChannel,
  yChannel,
  labelColor,
  renderer,
  labelSize,
  shadowColor
) {
  const caption = axisPairCaption(xChannel, yChannel);
  const textW = renderer.measureText(caption, labelSize);
  const textX = Math.round(x0 + side / 2 - textW / 2);

  renderer.drawText(
    buf,
    width,
    height,
    textX,
    Math.round(textY),
    caption,
    labelColor,
    labelSize,
    { shadowColor }
  );
}