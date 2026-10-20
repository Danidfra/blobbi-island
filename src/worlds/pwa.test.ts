/**
 * The installable Island: a valid web app manifest the page links to, icons that exist at the sizes they claim (a
 * maskable one among them), the Apple touch icon and favicons in the page's head, every world card's icon shipped on
 * this origin, and no service worker registered (public/sw.js only unregisters the old one).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { worlds } from './worlds';

const html = readFileSync('index.html', 'utf8');
const manifest = JSON.parse(readFileSync(join('public', 'manifest.webmanifest'), 'utf8')) as {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

/** The size a PNG file's header declares. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii'), file).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('the web app manifest', () => {
  it('names the app, starts at the root, opens standalone, and the page links to it', () => {
    expect(manifest.name).toBe('Blobbi Island');
    expect(manifest.short_name.length).toBeLessThanOrEqual(13);
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toMatch(/manifest-src 'self'/);
  });

  it('lists a 192 and a 512 "any" icon and a 512 maskable icon, each a PNG of exactly that size', () => {
    const by = (sizes: string, purpose: string) => manifest.icons.find((i) => i.sizes === sizes && (i.purpose ?? 'any') === purpose);
    expect(by('192x192', 'any')).toBeDefined();
    expect(by('512x512', 'any')).toBeDefined();
    expect(by('512x512', 'maskable')).toBeDefined();
    for (const icon of manifest.icons) {
      const file = join('public', icon.src);
      expect(existsSync(file), file).toBe(true);
      expect(icon.type).toBe('image/png');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(file), icon.src).toEqual([w, h]);
    }
  });
});

describe('the page head and the world cards', () => {
  it('links the SVG and PNG favicons and a 180 px Apple touch icon, all shipped; the header wordmark is the same icon', () => {
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />');
    expect(html).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />');
    expect(pngSize(join('public', 'icons', 'favicon-32.png'))).toEqual([32, 32]);
    expect(pngSize(join('public', 'icons', 'apple-touch-icon.png'))).toEqual([180, 180]);
    expect(readFileSync(join('public', 'icons', 'icon.svg'), 'utf8').startsWith('<svg')).toBe(true);
    expect(readFileSync(join('src', 'components', 'shell', 'BlobbiShellHeader.tsx'), 'utf8')).toContain('src="/icons/icon-192.png"');
  });

  it("every world card's icon is shipped by this app, 192 px square, on this origin", () => {
    for (const w of worlds({})) {
      expect(w.icon.startsWith('/icons/worlds/')).toBe(true);
      const file = join('public', w.icon);
      expect(existsSync(file), file).toBe(true);
      expect(pngSize(file), w.icon).toEqual([192, 192]);
    }
  });

  it('nothing registers a service worker (public/sw.js only unregisters the old one)', () => {
    expect(html).not.toMatch(/serviceWorker/);
    expect(readFileSync(join('public', 'sw.js'), 'utf8')).toContain('registration.unregister()');
  });
});
