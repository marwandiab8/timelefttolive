import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import QuickCapture from './QuickCapture.jsx';

describe('QuickCapture', () => {
  it('asks for a line for today and offers a photo, private unless shared', () => {
    const html = renderToStaticMarkup(<QuickCapture calendar={{ id: 'c1' }} today="2026-11-26" uid="u1" onDone={() => {}} />);
    expect(html).toContain('What happened today?');
    expect(html).toContain('Save to today');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('capture="environment"');
    expect(html).toMatch(/<input type="checkbox"\/>Share with viewers/);
  });
});

describe('the web app manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  it('installs as a standalone app with a quick-capture shortcut', () => {
    expect(manifest).toMatchObject({ start_url: '/', display: 'standalone', short_name: 'Time Left' });
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual(['/#capture']);
    manifest.icons.forEach((icon) => expect(readFileSync(new URL(`../../public${icon.src}`, import.meta.url)).length).toBeGreaterThan(0));
  });

  it('is linked from the page, with the iPhone home-screen tags', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-touch-icon');
  });
});

describe('hosting cache headers', () => {
  // The Hosting emulator ignores custom headers, so this checks the config; the live headers were checked with curl
  // after the deploy. Firebase applies matching rules in order, so the hashed bundles' rule must come last.
  const hosting = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8')).hosting;
  const cacheControl = (rule) => rule.headers.find((header) => header.key === 'Cache-Control')?.value;

  it('asks for the page to be checked every time and keeps the hashed bundles for a year', () => {
    expect(hosting.headers.map((rule) => [rule.source, cacheControl(rule)])).toEqual([
      ['**', 'no-cache'],
      ['/assets/**', 'public, max-age=31536000, immutable']
    ]);
  });
});
