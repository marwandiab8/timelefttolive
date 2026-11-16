// Saves the time wheel as a PNG: the live SVG is cloned, its watermark embedded, the hub text and
// a caption added as SVG text (the hub is HTML on screen), and the result drawn on a canvas.

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 8;
const CAPTION_ROOM = 14;
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const PAGE = { dark: { page: '#090d11', text: '#f4f7f8', muted: '#91a0aa' }, light: { page: '#f2f5f5', text: '#17252d', muted: '#65757d' } };

async function toDataUrl(href) {
  const response = await fetch(href);
  if (!response.ok) throw new Error(`Could not load ${href}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${href}`));
    reader.readAsDataURL(blob);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The wheel image could not be rendered.'));
    image.src = url;
  });
}

function addText(parent, x, y, text, { size, weight = 500, fill }) {
  if (!text) return;
  const node = document.createElementNS(SVG_NS, 'text');
  node.setAttribute('x', x);
  node.setAttribute('y', y);
  node.setAttribute('text-anchor', 'middle');
  node.setAttribute('dominant-baseline', 'central');
  node.setAttribute('font-size', size);
  node.setAttribute('font-weight', weight);
  node.setAttribute('fill', fill);
  node.textContent = text;
  parent.appendChild(node);
}

/**
 * Builds the export SVG markup from the on-screen wheel. Exported for tests; `exportWheelImage`
 * is what the button calls.
 */
export async function buildWheelExportSvg(svg, { title, total, subtitle = 'tracked time', caption, theme = 'dark' }) {
  const colors = PAGE[theme] || PAGE.dark;
  const clone = svg.cloneNode(true);
  const width = 100 + PAD * 2;
  const height = width + CAPTION_ROOM;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('viewBox', `${-PAD} ${-PAD} ${width} ${height}`);
  clone.setAttribute('font-family', FONT);
  clone.setAttribute('color', colors.text);
  clone.removeAttribute('class');
  clone.removeAttribute('role');

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('x', -PAD);
  background.setAttribute('y', -PAD);
  background.setAttribute('width', width);
  background.setAttribute('height', height);
  background.setAttribute('fill', colors.page);
  clone.insertBefore(background, clone.firstChild);

  // An SVG drawn as an image cannot fetch, so the etched logo goes in as data.
  for (const image of clone.querySelectorAll('image')) {
    const href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href && !href.startsWith('data:')) image.setAttribute('href', await toDataUrl(href));
  }
  clone.querySelectorAll('.life-wheel-live').forEach((node) => node.remove());

  const hub = document.createElementNS(SVG_NS, 'g');
  addText(hub, 50, 45.2, title, { size: 3, fill: colors.muted });
  addText(hub, 50, 51.2, total, { size: 6.4, weight: 800, fill: colors.text });
  addText(hub, 50, 56.4, subtitle, { size: 2.7, fill: colors.muted });
  clone.appendChild(hub);
  addText(clone, 50, 100 + PAD + CAPTION_ROOM / 2 - 1.5, caption, { size: 2.9, fill: colors.muted });

  return { markup: new XMLSerializer().serializeToString(clone), width, height, page: colors.page };
}

function deliver(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  if ('download' in anchor) {
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Renders the wheel to a square PNG (`size` px wide, a little taller for the caption) and hands it
 * to the browser as a download, or opens it in a new tab where downloads are blocked.
 */
/** Renders the wheel to a PNG blob, `size` px wide and a little taller for the caption. */
export async function renderWheelPng({ svg, title, total, subtitle, caption, theme = 'dark', size = 2048 }) {
  if (!svg) throw new Error('The wheel is not on screen yet.');
  const { markup, width, height, page } = await buildWheelExportSvg(svg, { title, total, subtitle, caption, theme });
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.round((size * height) / width);
    const context = canvas.getContext('2d');
    context.fillStyle = page;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The wheel image could not be saved.');
    return png;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** Saves the wheel as a PNG download, or opens it in a new tab where downloads are blocked. */
export async function exportWheelImage({ fileName = 'time-wheel.png', ...options }) {
  const png = await renderWheelPng(options);
  deliver(png, fileName);
  return fileName;
}
