// Colour helpers for the Activity time wheel's crystal material. Pure, so the
// slice gradients can be derived from the category colours in tests and in the
// image export without a DOM.

const hexToRgb = (hex) => {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [139, 152, 161]; // Other's grey
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
};

const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** Mixes `hex` toward `other` by `amount` (0 keeps `hex`, 1 gives `other`). */
export function mixHex(hex, other, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  const t = Math.max(0, Math.min(1, Number(amount) || 0));
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * t));
}

export const darkenHex = (hex, amount) => mixHex(hex, '#000000', amount);
export const lightenHex = (hex, amount) => mixHex(hex, '#ffffff', amount);

/** WCAG relative luminance of a hex colour, 0 (black) to 1 (white). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const DARK_INK = '#17252d';
const LIGHT_INK = '#ffffff';

/**
 * The text colour that reads on a slice of this colour: dark ink on yellow,
 * orange and other bright slices, white on blue, purple and green.
 */
export function labelColorFor(hex) {
  // White is preferred on the glass (the body darkens toward the hole, and the labels carry a
  // shadow), so dark ink only wins where it is clearly more readable: yellows, oranges, pale teals.
  return contrastRatio(DARK_INK, hex) >= contrastRatio(LIGHT_INK, hex) * 1.6 ? DARK_INK : LIGHT_INK;
}

// The chosen material: the "Clear crystal" study variant (Marwan picked it over Jewel on
// 2026-11-14 after seeing Jewel live): a light body, a strong glancing highlight and a thin bright
// rim. Every number is in viewBox units or opacities; the colours come from the category colour alone.
export const CRYSTAL = Object.freeze({
  innerDark: 0.24,
  outerLight: 0.22,
  specular: { dark: 0.42, light: 0.3 },
  band: { width: 0.8, alpha: { dark: 0.75, light: 0.65 } },
  rim: { light: { dark: 0.34, light: 0.24 }, dark: 0.35 },
  glow: { alpha: { dark: 0.42, light: 0.26 }, blur: 2.6 },
  gapAngle: 2.2,
  shadow: { dark: 0.55, light: 0.3 }
});

/** The three body stops of a slice: dark at the hole, true colour in the middle, light at the edge. */
export function sliceStops(color, material = CRYSTAL) {
  return {
    inner: darkenHex(color, material.innerDark),
    middle: color,
    outer: lightenHex(color, material.outerLight)
  };
}

/** The frosted, uncoloured look of the untracked segment. */
export function frostedStops(theme = 'dark') {
  return theme === 'dark'
    ? { inner: '#1b242c', middle: '#2a3540', outer: '#3a4652' }
    : { inner: '#c3ccd1', middle: '#d9e0e3', outer: '#eef2f4' };
}
