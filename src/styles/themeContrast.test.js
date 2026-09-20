import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reads the real stylesheet, so a text colour picked for one theme cannot quietly
// end up unreadable in the other (cream text on a white card, pink on a pale page).
const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

const luminance = (hex) => {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (foreground, background) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

// The `--name: #hex;` declarations of the rule that starts with `selector {`.
function tokens(selector) {
  const start = css.search(new RegExp(`^${selector.replace(/[.[\]"=\-]/g, '\\$&')} \\{`, 'm'));
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(([, name, hex]) => [name, hex]));
}

const LIGHT_PAGE = '#eef3f0';
const LIGHT_CARD = '#ffffff';
const DARK_PAGE = '#0d1114';
const DARK_CARD = '#141b20';
const TEXT_TOKENS = ['card-text', 'card-muted', 'card-accent', 'error-text', 'danger-text'];
const MINIMUM = 4.5;

describe('theme text colours', () => {
  it('are readable on the light page and on a white card', () => {
    const light = tokens('.app-shell[data-calendar-theme="light"]');
    for (const name of TEXT_TOKENS) {
      expect(light[name], `--${name} is set for the light theme`).toBeTruthy();
      expect(contrast(light[name], LIGHT_PAGE), `--${name} on the page`).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(light[name], LIGHT_CARD), `--${name} on a card`).toBeGreaterThanOrEqual(MINIMUM);
    }
  });

  it('are readable on the dark page and on a dark card', () => {
    const dark = { ...tokens(':root'), ...tokens('.app-shell') };
    for (const name of TEXT_TOKENS) {
      expect(dark[name], `--${name} is set for the dark theme`).toBeTruthy();
      expect(contrast(dark[name], DARK_PAGE), `--${name} on the page`).toBeGreaterThanOrEqual(MINIMUM);
      expect(contrast(dark[name], DARK_CARD), `--${name} on a card`).toBeGreaterThanOrEqual(MINIMUM);
    }
  });

  it('give the error and danger colours a darker value in the light theme than the dark one', () => {
    const light = tokens('.app-shell[data-calendar-theme="light"]');
    const dark = tokens(':root');
    expect(luminance(light['error-text'])).toBeLessThan(luminance(dark['error-text']));
    expect(luminance(light['danger-text'])).toBeLessThan(luminance(dark['danger-text']));
  });

  it('are readable for every text colour the light theme sets on the page', () => {
    const problems = [];
    for (const [, selector, body] of css.matchAll(/^(\.app-shell\[data-calendar-theme="light"\][^{}]*)\{([^{}]*)\}/gm)) {
      const color = body.match(/(?<![-\w])color:\s*(#[0-9a-fA-F]{6})\b/)?.[1];
      // Text that sits on its own coloured background is checked against that background instead.
      const background = body.match(/background:\s*(#[0-9a-fA-F]{6})\b/)?.[1];
      if (!color) continue;
      const ratio = contrast(color, background || LIGHT_PAGE);
      if (ratio < MINIMUM) problems.push(`${selector.trim().replace(/\s+/g, ' ')} { color: ${color} } is ${ratio.toFixed(2)}:1`);
    }
    expect(problems).toEqual([]);
  });

  it('use the theme variables for text in the shared error and danger rules', () => {
    expect(css).toMatch(/^\.error \{\s*color: var\(--error-text\);/m);
    expect(css).toMatch(/^\.danger \{\s*color: var\(--danger-text\);/m);
  });
});
