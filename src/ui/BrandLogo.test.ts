// Step-0 render check: what <BrandLogo> actually puts on screen, rendered with jest-expo's test renderer.
import { act, createElement } from 'react';
import { createRoot } from 'test-renderer';

import { BrandLogo } from './BrandLogo';
import { BRANDS } from './brands/data';

async function render(name: string, logo?: string | null) {
  const root = createRoot();
  await act(async () => {
    root.render(createElement(BrandLogo, { name, logo, size: 36 }));
  });
  // SymbolView's `fallback` prop is a React element; keep just its presence.
  return JSON.stringify(root.container.toJSON(), (k, v: unknown) => (k === 'fallback' ? '[fallback]' : v));
}

const path = (slug: string) => BRANDS.find((b) => b.slug === slug)!.path!;

describe('BrandLogo render', () => {
  it('draws the Netflix mark as an SVG path on the brand colour', async () => {
    const out = await render('Netflix');
    expect(out).toContain('RNSVGPath');
    expect(out).toContain(JSON.stringify(path('netflix')));
    expect(out).toContain('#E50914');
  });

  it('draws a brand-colour monogram for Rogers by name', async () => {
    const out = await render('Rogers Wireless');
    expect(out).not.toContain('RNSVGPath');
    expect(out).toContain('#DA291C');
    expect(out).toMatch(/\["R"\]|"R"/);
  });

  it('uses the picked brand over the name', async () => {
    const out = await render('My phone bill', 'brand:cloudflare');
    expect(out).toContain(JSON.stringify(path('cloudflare')));
  });

  it('draws a generic icon tile in the picked colour', async () => {
    const out = await render('Hydro', 'icon:bolt:amber');
    expect(out).toContain('#8A4B00');
    expect(out).toContain('bolt');
  });

  it('falls back to a letter tile for unknown names and unreadable logos', async () => {
    const out = await render('Zzz club', 'brand:not-a-brand');
    expect(out).not.toContain('RNSVGPath');
    expect(out).toContain('"Z"');
  });
});
