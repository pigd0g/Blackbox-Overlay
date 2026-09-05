// ======================================================
// Blackbox-Overlay — SCENE PAINTER (v2)
// ======================================================
//
// The ONE renderer for both the GUI preview and the final
// video (the WYSIWYG guarantee): given a normalized layout,
// a resolved scene state, and a theme, paints the whole
// canvas as RGBA.
//
//   paintScene(layout, sceneState, theme, options)
//
// Options:
//   alpha     leave the background transparent (layout.alpha
//             drives this; opaque fills theme background)
//   shadow    theme textShadow under glyphs (global toggle)
//
// Preview-specific decorations (pastel green, dashed grid,
// selection outlines) are BROWSER-ONLY and never painted
// here — the interview locked that boundary.
//
// ======================================================

import { pixelRect } from "./pixelPrimitives.js";
import { paintStickWidget } from "./widgetStick.js";
import { paintTextWidget } from "./widgetText.js";
import { paintBarWidget } from "./widgetBar.js";
import { paintDonutWidget } from "./widgetDonut.js";
import { buildSceneState, resolveItemValue, resolveFraction } from "./sceneState.js";
import { colorOf } from "../themes.js";
import { createOverlayTextRenderer } from "../textRenderer.js";
import { WIDGET_SIZES } from "./layoutSchema.js";

const rendererCache = new Map();

// Resolved palettes per (theme, item) — colours are pure
// functions of the item props and theme, and re-parsing hex
// strings per widget per frame is pure waste in the render
// loop, where the same theme/item objects are painted
// thousands of times.
const itemColorCache = new WeakMap();

export function clearSceneCaches() {
  rendererCache.clear();
  itemColorCache.clear();
}

function rendererFor(fontId) {
  if (!rendererCache.has(fontId)) {
    rendererCache.set(fontId, createOverlayTextRenderer(fontId));
  }

  return rendererCache.get(fontId);
}

// ------------------------------------------------------
// Colour resolution: item → theme slot → fallback
// ------------------------------------------------------

const THEME_SLOT_BY_PROP = {
  boxColor: "stick.box",
  crosshairColor: "stick.crosshair",
  dotColor: "stick.dot",
  labelColor: "fonts.label.color",
  valueColor: "fonts.value.color",
  trackColor: "bar.track",
  fillColor: "bar.fill",
  cardColor: "card.color",
  accentColor: "card.accent"
};

function themeSlotColor(theme, path, fallback) {
  const parts = String(path).split(".");
  let node = theme;

  for (const part of parts) {
    if (!node || typeof node !== "object" || !(part in node)) {
      return colorOf(fallback);
    }

    node = node[part];
  }

  if (!node) {
    return null;
  }

  return colorOf(node, fallback);
}

/**
 * Resolve the colour palette for one widget from its props
 * and the theme. Donut fill/track share the bar slots; the
 * donut's fillColour prop maps onto donut.fill when set.
 *
 * Memoized per (theme object, item object) — both are stable
 * across a render loop (normalizeLayout/resolveTheme run once
 * per render), so the hex parsing happens once, not per frame.
 */
export function resolveItemColors(item, theme) {
  let perTheme = itemColorCache.get(theme);

  if (!perTheme) {
    perTheme = new WeakMap();
    itemColorCache.set(theme, perTheme);
  }

  let colors = perTheme.get(item);

  if (!colors) {
    colors = computeItemColors(item, theme);
    perTheme.set(item, colors);
  }

  return colors;
}

function computeItemColors(item, theme) {
  const pick = (propKey, fallback) => {
    const explicit = item.props[propKey];

    if (explicit) {
      return colorOf(explicit, fallback);
    }

    const slot = THEME_SLOT_BY_PROP[propKey];

    if (!slot) {
      return null;
    }

    // card.color defaults to NONE (no card) unless set.
    if (slot === "card.color") {
      return null;
    }

    return themeSlotColor(theme, slot, fallback);
  };

  const colors = {
    box: pick("boxColor", "#404040") ?? [64, 64, 64, 255],
    crosshair: pick("crosshairColor", "#92898A") ?? [146, 137, 138, 255],
    dot: pick("dotColor", "#EE4266") ?? [238, 66, 102, 255],
    label: pick("labelColor", "#3E4A46") ?? [62, 74, 70, 255],
    value: pick("valueColor", "#14201C") ?? [20, 32, 28, 255],
    track: pick("trackColor", "#B9C2BB") ?? [185, 194, 187, 255],
    fill: pick("fillColor", "#2E7D32") ?? [46, 125, 50, 255],
    card: pick("cardColor", null),
    accent: pick("accentColor", null)
  };

  return colors;
}

// ------------------------------------------------------
// The entry point
// ------------------------------------------------------

/**
 * Paint one complete frame.
 *
 * @param {object} layout      normalized layout doc
 * @param {object} boxes       id → { x, y, width, height }
 * @param {object} sceneState  from buildSceneState()
 * @param {object} theme       resolved + overridden theme
 * @param {object} [options]   { alpha, shadow }
 * @returns {Uint8Array} W×H×4 RGBA
 */
export function paintScene(layout, boxes, sceneState, theme, options = {}) {
  const width = layout.canvas.width;
  const height = layout.canvas.height;
  const frame = new Uint8Array(width * height * 4).fill(0);

  if (options.alpha !== true) {
    pixelRect(frame, width, height, 0, 0, width, height, colorOf(theme.background));
  }

  const shadowColor = options.shadow === true ? colorOf(theme.textShadow) : null;
  const renderer = rendererFor(layout.font);

  const roleSizes = {
    label: theme.fonts?.label?.size ?? 16,
    value: theme.fonts?.value?.size ?? 22
  };

  for (const item of layout.items) {
    const box = boxes.get(item.id);

    if (!box) {
      continue;
    }

    paintItem(frame, width, height, item, box, sceneState, theme, renderer, roleSizes, shadowColor);
  }

  return frame;
}

function paintItem(frame, width, height, item, box, state, theme, renderer, roleSizes, shadowColor) {
  const colors = resolveItemColors(item, theme);

  if (item.type === "stick") {
    paintStickWidget(
      frame,
      width,
      height,
      box,
      WIDGET_SIZES[item.props.size] ?? WIDGET_SIZES.med,
      state.channels,
      item.props,
      colors,
      renderer,
      item.props.labelSize ?? roleSizes.label,
      shadowColor
    );
    return;
  }

  if (item.type === "text") {
    const resolved = resolveItemValue(item, state);
    const valueText =
      item.props.source === "custom"
        ? null
        : resolved.flag ?? resolved.text;

    paintTextWidget(
      frame,
      width,
      height,
      box,
      item,
      item.props.source === "custom" ? null : valueText,
      colors,
      renderer,
      {
        label: item.props.labelSize ?? roleSizes.label,
        value: item.props.valueSize ?? roleSizes.value
      },
      shadowColor
    );
    return;
  }

  if (item.type === "bar") {
    const resolved = resolveItemValue(item, state);
    const { fraction } = resolveFraction(item, state);

    paintBarWidget(
      frame,
      width,
      height,
      box,
      item.props,
      fraction,
      colors,
      renderer,
      item.props.labelSize ?? roleSizes.label,
      shadowColor
    );
    return;
  }

  if (item.type === "donut") {
    const resolved = resolveItemValue(item, state);
    const { fraction } = resolveFraction(item, state);

    paintDonutWidget(
      frame,
      width,
      height,
      box,
      item.props,
      fraction,
      resolved.flag ?? resolved.text,
      colors,
      renderer,
      {
        label: item.props.labelSize ?? roleSizes.label,
        value: item.props.valueSize ?? roleSizes.value
      },
      shadowColor
    );
  }
}

// sceneState re-exports for the API layer.
export { buildSceneState, resolveItemValue, resolveFraction };