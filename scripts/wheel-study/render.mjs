// Material study for the Activity time wheel (phase 0 of docs/prompts/crystal-wheel-prompt.md).
// Throwaway: renders the current slice geometry and category colours as static pages with three
// glass materials side by side, dark and light, plus a phone-width page. Nothing here is imported
// by the app.
//
//   node scripts/wheel-study/render.mjs
//   (cd scripts/wheel-study/out && python3 -m http.server 8767 --bind 127.0.0.1)
//   open http://127.0.0.1:8767/dark.html, light.html, phone.html

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWheelSegments, describeWheelSegment, getWheelLabelMode, getWheelLabelPosition, WHEEL } from '../../src/utils/wheelGeometry.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

// A realistic day, with the real category colours from lifeEventUtils.js.
const DAY = [
  { label: 'Work', seconds: 8.4 * 3600, color: '#4f8cff' },
  { label: 'Sleep', seconds: 7.2 * 3600, color: '#8178e8' },
  { label: 'Home', seconds: 3.1 * 3600, color: '#58c6a6' },
  { label: 'Gym/Fitness', seconds: 1.3 * 3600, color: '#f47c61' },
  { label: 'Transportation', seconds: 0.9 * 3600, color: '#f2b84b' },
  { label: 'Meals', seconds: 0.7 * 3600, color: '#ef996c' },
  { label: 'Darts', seconds: 0.5 * 3600, color: '#1f9d55' },
  { label: 'Music', seconds: 0.2 * 3600, color: '#db75a6' },
  { label: 'Places', seconds: 0.1 * 3600, color: '#50b8d8' }
];

// Three candidate materials. Every number is relative to the 100 x 100 viewBox.
const MATERIALS = {
  crystal: {
    title: 'Clear crystal',
    note: 'Strong specular, thin bright rim, light body.',
    innerDark: 0.24, outerLight: 0.22, smoke: 0,
    specular: 0.42, band: { width: 0.8, alpha: 0.75 },
    rim: { light: 0.34, dark: 0.35 },
    glow: { alpha: 0.42, blur: 2.6 },
    gap: 2.2
  },
  smoked: {
    title: 'Smoked glass',
    note: 'Denser, darker body, softer and wider glow, quieter rim.',
    innerDark: 0.36, outerLight: 0.1, smoke: 0.16,
    specular: 0.24, band: { width: 0.7, alpha: 0.42 },
    rim: { light: 0.2, dark: 0.45 },
    glow: { alpha: 0.46, blur: 4 },
    gap: 2.2
  },
  jewel: {
    title: 'Jewel',
    note: 'Deep inner darkening, bright outer band, saturated middle.',
    innerDark: 0.46, outerLight: 0.3, smoke: 0,
    specular: 0.34, band: { width: 1.1, alpha: 0.8 },
    rim: { light: 0.4, dark: 0.5 },
    glow: { alpha: 0.44, blur: 2.2 },
    gap: 2.4
  }
};

const THEMES = {
  dark: { page: '#090d11', surface: '#121920', text: '#f4f7f8', muted: '#91a0aa', seat: '#0b1015', seatEdge: 'rgba(255,255,255,0.06)', glowScale: 1, shadowAlpha: 0.55, rimScale: 1, hub: ['#1a242d', '#0e151b'] },
  light: { page: '#f2f5f5', surface: '#ffffff', text: '#17252d', muted: '#65757d', seat: '#c7d1d4', seatEdge: 'rgba(16,38,48,0.18)', glowScale: 0.6, shadowAlpha: 0.32, rimScale: 0.65, hub: ['#ffffff', '#e4eaec'] }
};

// --- colour helpers ---------------------------------------------------------
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (hex, other, amount) => {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * amount));
};
const darken = (hex, amount) => mix(hex, '#000000', amount);
const lighten = (hex, amount) => mix(hex, '#ffffff', amount);
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// Label colour by slice luminance: dark text on yellow and orange, light on blue and purple.
const labelColor = (hex) => (luminance(hex) > 0.36 ? '#17252d' : '#ffffff');

const fmt = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const n = (v) => Number(v.toFixed(3));
const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return `${n(WHEEL.center + r * Math.sin(a))} ${n(WHEEL.center - r * Math.cos(a))}`;
};
// The outer arc of a slice only, pulled in a hair so the band sits inside the rim.
function outerArc(segment, inset) {
  const r = WHEEL.outerRadius - inset;
  const a0 = segment.startAngle + 2.2;
  const a1 = segment.endAngle - 2.2;
  if (a1 <= a0) return '';
  return `M ${polar(r, a0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${polar(r, a1)}`;
}

// --- one wheel ----------------------------------------------------------------
function wheelSvg(materialKey, themeKey, id) {
  const m = MATERIALS[materialKey];
  const t = THEMES[themeKey];
  const segments = buildWheelSegments(DAY, { gapAngle: m.gap });
  const total = DAY.reduce((sum, c) => sum + c.seconds, 0);
  const { center: c, outerRadius: R, innerRadius: r } = WHEEL;

  const defs = [];
  const glow = [];
  const bodies = [];
  const labels = [];

  // Light comes from the upper left: the specular gradient and the band gradient share that source.
  // A glancing highlight from the upper left that is gone before the middle of the wheel,
  // so it reads as light on a curved surface rather than a wash over the top half.
  defs.push(`<linearGradient id="${id}-spec" gradientUnits="userSpaceOnUse" x1="16" y1="8" x2="52" y2="48">
    <stop offset="0" stop-color="#fff" stop-opacity="${m.specular}"/>
    <stop offset="0.28" stop-color="#fff" stop-opacity="${(m.specular * 0.22).toFixed(3)}"/>
    <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>`);
  defs.push(`<radialGradient id="${id}-band" gradientUnits="userSpaceOnUse" cx="24" cy="14" r="78">
    <stop offset="0" stop-color="#fff" stop-opacity="${m.band.alpha}"/>
    <stop offset="0.55" stop-color="#fff" stop-opacity="${(m.band.alpha * 0.35).toFixed(3)}"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0.04"/>
  </radialGradient>`);
  defs.push(`<filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${m.glow.blur}"/></filter>`);
  defs.push(`<filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0.6" dy="1.8" stdDeviation="1.6" flood-color="#000" flood-opacity="${t.shadowAlpha}"/></filter>`);
  defs.push(`<radialGradient id="${id}-hub" gradientUnits="userSpaceOnUse" cx="42" cy="40" r="26">
    <stop offset="0" stop-color="${t.hub[0]}"/><stop offset="1" stop-color="${t.hub[1]}"/>
  </radialGradient>`);
  defs.push(`<radialGradient id="${id}-hubshine" gradientUnits="userSpaceOnUse" cx="40" cy="36" r="22">
    <stop offset="0" stop-color="#fff" stop-opacity="${themeKey === 'dark' ? 0.16 : 0.9}"/><stop offset="0.7" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>`);
  defs.push(`<clipPath id="${id}-hubclip"><circle cx="${c}" cy="${c}" r="${r - 0.6}"/></clipPath>`);
  defs.push(`<radialGradient id="${id}-seat" gradientUnits="userSpaceOnUse" cx="${c}" cy="${c}" r="${R + 2}">
    <stop offset="0.9" stop-color="${t.seat}"/><stop offset="1" stop-color="${darken(t.seat, 0.25)}"/>
  </radialGradient>`);

  segments.forEach((segment, index) => {
    const base = m.smoke ? darken(segment.color, m.smoke) : segment.color;
    const inner = darken(base, m.innerDark);
    const outer = lighten(base, m.outerLight);
    const d = describeWheelSegment(segment);
    const gid = `${id}-body-${index}`;
    // Body: a radial gradient across the ring thickness, dark at the hole, light at the edge.
    defs.push(`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${c}" cy="${c}" r="${R}">
      <stop offset="${n(r / R)}" stop-color="${inner}"/>
      <stop offset="${n((r + (R - r) * 0.55) / R)}" stop-color="${base}"/>
      <stop offset="0.985" stop-color="${outer}"/>
    </radialGradient>`);
    glow.push(`<path d="${d}" fill="${segment.color}"/>`);
    bodies.push(`<g class="slice">
      <path d="${d}" fill="url(#${gid})" fill-rule="evenodd"/>
      <path d="${d}" fill="url(#${id}-spec)" fill-rule="evenodd"/>
      <path d="${outerArc(segment, m.band.width / 2 + 0.25)}" fill="none" stroke="url(#${id}-band)" stroke-width="${m.band.width}" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="${inner}" stroke-opacity="${m.rim.dark}" stroke-width="0.7" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#fff" stroke-opacity="${n(m.rim.light * t.rimScale)}" stroke-width="0.32" stroke-linejoin="round"/>
      ${segment.boosted ? `<path d="${outerArc(segment, 0.15)}" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="0.25" stroke-dasharray="0.6 0.7"/>` : ''}
    </g>`);

    const duration = fmt(segment.seconds);
    const mode = getWheelLabelMode(segment, duration.length);
    if (mode === 'full') {
      const { left, top } = getWheelLabelPosition(segment);
      labels.push(`<div class="label" style="left:${left}%;top:${top}%;color:${labelColor(base)}">${duration}</div>`);
    }
  });

  return `<div class="wheel" data-material="${materialKey}">
  <svg viewBox="0 0 100 100" aria-label="${m.title}, ${themeKey}">
    <defs>${defs.join('\n')}</defs>
    <g filter="url(#${id}-glow)" opacity="${n(m.glow.alpha * t.glowScale)}">${glow.join('')}</g>
    <circle cx="${c}" cy="${c}" r="${R + 1.4}" fill="url(#${id}-seat)" stroke="${t.seatEdge}" stroke-width="0.3"/>
    <g filter="url(#${id}-shadow)">${bodies.join('\n')}</g>
    <g class="hub">
      <circle cx="${c}" cy="${c}" r="${r - 0.6}" fill="url(#${id}-hub)"/>
      <g clip-path="url(#${id}-hubclip)">
        <circle cx="${c}" cy="${c}" r="${r + 1.2}" fill="none" stroke="#000" stroke-opacity="${themeKey === 'dark' ? 0.55 : 0.22}" stroke-width="3.2" filter="url(#${id}-glow)"/>
        <image href="k2-logo-watermark.png" x="${c - 14.3}" y="${c - 13.7}" width="28" height="28" style="filter:brightness(0);opacity:${themeKey === 'dark' ? 0.35 : 0.1}"/>
        <image href="k2-logo-watermark.png" x="${c - 13.7}" y="${c - 14.3}" width="28" height="28" style="filter:brightness(4) grayscale(1);opacity:${themeKey === 'dark' ? 0.05 : 0.5}"/>
      </g>
      <circle cx="${c}" cy="${c}" r="${r - 0.6}" fill="url(#${id}-hubshine)"/>
      <circle cx="${c}" cy="${c}" r="${r - 0.75}" fill="none" stroke="#fff" stroke-opacity="${themeKey === 'dark' ? 0.22 : 0.9}" stroke-width="0.3"/>
    </g>
  </svg>
  <div class="labels">${labels.join('')}</div>
  <div class="center">
    <p>Today</p>
    <strong>${fmt(total)}</strong>
    <span>tracked time</span>
    <small><i></i>1 in progress</small>
  </div>
</div>`;
}

// --- pages --------------------------------------------------------------------
const css = `
*{box-sizing:border-box}
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:var(--page);color:var(--text)}
.theme-dark{--page:#090d11;--surface:#121920;--text:#f4f7f8;--muted:#91a0aa}
.theme-light{--page:#f2f5f5;--surface:#ffffff;--text:#17252d;--muted:#65757d}
.theme{padding:28px 32px 40px;background:var(--page);color:var(--text)}
.theme h1{margin:0 0 4px;font-size:20px;font-weight:650;letter-spacing:-.02em}
.theme > p{margin:0 0 22px;color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
.card{padding:22px 18px 18px;border-radius:28px;background:var(--surface);min-width:0}
.card h2{margin:0 0 2px;font-size:17px;font-weight:650}
.card p{margin:0 0 14px;color:var(--muted);font-size:12.5px;line-height:1.4}
.wheel{position:relative;width:100%;aspect-ratio:1}
.wheel svg{width:100%;height:100%;overflow:visible;display:block}
.labels{position:absolute;inset:0;pointer-events:none}
.label{position:absolute;transform:translate(-50%,-50%);font-size:clamp(11px,1.05vw,15px);font-weight:700;white-space:nowrap;letter-spacing:-.01em}
.center{position:absolute;inset:29.5%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.center p{margin:0 0 2px;color:var(--muted);font-size:clamp(10px,0.95vw,14px)}
.center strong{font-size:clamp(20px,2.3vw,34px);line-height:.95;letter-spacing:-.05em}
.center span{margin-top:3px;color:var(--muted);font-size:clamp(10px,0.9vw,13px)}
.center small{display:flex;align-items:center;gap:5px;margin-top:8px;color:var(--muted);font-size:clamp(9px,0.72vw,11px)}
.center small i{width:6px;height:6px;border-radius:50%;background:#65d6ad;box-shadow:0 0 8px #65d6ad;animation:breathe 2.6s ease-in-out infinite}
@keyframes breathe{50%{opacity:.35;box-shadow:0 0 2px #65d6ad}}
.phone .grid{grid-template-columns:repeat(3,390px);gap:24px;justify-content:start}
.phone .card{padding:18px 12px 20px;border-radius:26px}
.phone .label{font-size:11px}
.phone .center strong{font-size:22px}
.phone .center p,.phone .center span{font-size:10px}
.phone .center small{font-size:8px}
`;

const page = (title, blocks, bodyClass) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body class="${bodyClass}">${blocks}</body></html>`;

const section = (themeKey, phone = false) => `<section class="theme theme-${themeKey}${phone ? ' phone' : ''}">
  <h1>${phone ? 'Phone width (390px)' : 'Desktop'} · ${themeKey} theme</h1>
  <p>Same geometry and category colours as production. Durations only; icons are replaced in phase 1. Dashed outer edge marks a slice drawn at the 8° minimum.</p>
  <div class="grid">${Object.keys(MATERIALS).map((key) => `<article class="card"><h2>${MATERIALS[key].title}</h2><p>${MATERIALS[key].note}</p>${wheelSvg(key, themeKey, `${themeKey}-${key}${phone ? '-p' : ''}`)}</article>`).join('')}</div>
</section>`;

writeFileSync(join(OUT, 'dark.html'), page('Wheel study · dark', section('dark'), 'theme-dark'));
writeFileSync(join(OUT, 'light.html'), page('Wheel study · light', section('light'), 'theme-light'));
writeFileSync(join(OUT, 'phone.html'), page('Wheel study · phone', section('dark', true) + section('light', true), 'theme-dark'));
console.log('wrote', OUT);
