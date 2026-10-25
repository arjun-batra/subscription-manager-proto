import type { CategoryTotal } from '../domain/totals';
import { UNCATEGORIZED_ID } from '../domain/types';
import { BRANDS } from './brands/data';
import {
  autoLogoTile,
  brandLogoTile,
  brandTile,
  categorySymbol,
  CHART_COLORS,
  donutSlices,
  filterOptions,
  inkOn,
  LETTER_COLORS,
  letterTile,
  logoSummary,
  matchBrand,
  monogramFontSize,
  normalizeName,
  resolveLogo,
  searchLogos,
} from './look';
import { GENERIC_ICONS, ICON_COLORS, ICON_COLOR_NAMES } from './brands/icons';
import { contrast, dark, light } from './palette';

describe('brand marks', () => {
  it('bundles single-path 24x24 marks and brand-colour monograms', () => {
    expect(BRANDS.filter((b) => b.path).length).toBeGreaterThanOrEqual(40);
    expect(BRANDS.filter((b) => !b.path).length).toBeGreaterThanOrEqual(30);
    expect(new Set(BRANDS.map((b) => b.slug)).size).toBe(BRANDS.length);
    for (const b of BRANDS) {
      expect(b.hex).toMatch(/^[0-9A-F]{6}$/);
      expect(b.aliases.length).toBeGreaterThan(0);
      if (b.path) {
        expect(b.path).toMatch(/^[Mm][-0-9. ,a-zA-Z]+$/);
        expect(b.monogram).toBeUndefined();
      } else {
        expect(b.monogram).toMatch(/^.{1,3}$/u);
      }
    }
  });

  it('no alias points at two brands', () => {
    const seen = new Map<string, string>();
    for (const b of BRANDS) {
      for (const a of b.aliases) {
        const k = normalizeName(a);
        expect([k, seen.get(k) ?? b.slug]).toEqual([k, b.slug]);
        seen.set(k, b.slug);
      }
    }
  });

  it.each([
    ['Netflix', 'netflix'],
    ['netflix standard', 'netflix'],
    ['Spotify Premium Family', 'spotify'],
    ['YouTube Premium', 'youtube'],
    ['Apple TV+', 'appletv'],
    ['Apple Music', 'applemusic'],
    ['iCloud+ 200 GB', 'icloud'],
    ['HBO Max', 'max'],
    ['Max', 'max'],
    ['Google One', 'googledrive'],
    ['PlayStation Plus', 'playstation'],
    ['Proton Unlimited', 'protonmail'],
    ['Crème Crunchyroll', null],
    ['Maximum Fitness', null],
    ['Disney+', 'disneyplus'],
    // Requested Canadian brands (monograms).
    ['Rogers', 'rogers'],
    ['Rogers Wireless', 'rogers'],
    ['Sonnet', 'sonnet'],
    ['Sonnet Insurance', 'sonnet'],
    ["Canada's Wonderland", 'wonderland'],
    ['Canada’s Wonderland Season Pass', 'wonderland'],
    ['Wonderland', 'wonderland'],
    ['Bell', 'bell'],
    ['Telus', 'telus'],
    ['Fido', 'fido'],
    ['Koodo', 'koodo'],
    ['Freedom Mobile', 'freedommobile'],
    ['Crave', 'crave'],
    ['Hydro One', 'hydroone'],
    ['Toronto Hydro', 'torontohydro'],
    ['Enbridge Gas', 'enbridge'],
    ['GoodLife Fitness', 'goodlife'],
    ['Presto', 'prestocard'],
    ['CBC Gem', 'cbc'],
    // Requested global brands.
    ['Amazon', 'amazon'],
    ['Prime', 'amazon'],
    ['Amazon Prime', 'amazon'],
    ['Prime Video', 'primevideo'],
    ['Microsoft 365', 'microsoft365'],
    ['Office 365', 'microsoft365'],
    ['Microsoft', 'microsoft365'],
    ['Xbox Game Pass', 'xbox'],
    ['Cloudflare', 'cloudflare'],
    ['Costco', 'costco'],
    ['Costco Membership', 'costco'],
    ['Grok', 'grok'],
    ['SuperGrok', 'grok'],
    ['ChatGPT', 'chatgpt'],
    ['ChatGPT Plus', 'chatgpt'],
    ['Claude', 'claude'],
    ['Claude Pro', 'claude'],
    ['Gemini', 'googlegemini'],
    ['Gemini Advanced', 'googlegemini'],
    ['Google Workspace', 'google'],
    ['Office supplies', null],
    ['', null],
    ['Hydro', null],
  ])('%s -> %s', (name, slug) => {
    expect(matchBrand(name)?.slug ?? null).toBe(slug);
  });

  it.each([
    ['Prime Gym', null],
    ['Max Fitness', null],
    ['Copilot Money', null],
    ['Nitro PDF', null],
    ['Freedom 55', null],
    ['Freedom 55 Financial', null],
    ['Shaw Academy', null],
    ['Bell Media Club', null],
    ['Medium Roast Coffee Club', null],
    ['Zoom Car Rental', null],
    ['Presto Pizza', null],
    ['Crave Cookies', null],
    ['Slack Line Gym', null],
    ['Notion Press', null],
    ['Prime Home', null],
    ['Prime Phone', null],
    ['Freedom Phone', null],
    ['Slack Business Card', null],
    ['Slack Card', null],
    ['Shaw Phone', null],
  ])('ambiguous one-word alias, other business: %s -> no brand', (name, slug) => {
    expect(matchBrand(name)?.slug ?? null).toBe(slug);
  });

  it.each([
    ['Max', 'max'],
    ['HBO Max', 'max'],
    ['Max Ad-Free', 'max'],
    ['Max Ultimate', 'max'],
    ['HBO', 'max'],
    ['Prime', 'amazon'],
    ['Prime Monthly', 'amazon'],
    ['Prime Membership', 'amazon'],
    ['Amazon Prime', 'amazon'],
    ['Prime Video', 'primevideo'],
    ['Copilot', 'github'],
    ['GitHub Copilot', 'github'],
    ['Copilot Pro', 'microsoft365'],
    ['Nitro', 'discord'],
    ['Discord Nitro', 'discord'],
    ['Freedom', 'freedommobile'],
    ['Freedom Mobile', 'freedommobile'],
    ['Freedom Home Internet', 'freedommobile'],
    ['Shaw', 'shaw'],
    ['Shaw Internet', 'shaw'],
    ['Shaw TV', 'shaw'],
    ['Bell Fibe', 'bell'],
    ['Bell Canada', 'bell'],
    ['Notion Plus', 'notion'],
    ['Zoom Pro', 'zoom'],
    ['Spotify Premium Family', 'spotify'],
    ['Netflix Standard with Ads', 'netflix'],
    ['Rogers Ignite', 'rogers'],
    ['Sonnet Car Insurance', 'sonnet'],
    ['Crave Total', 'crave'],
    ['Bell Home Phone', 'bell'],
    ['Bell Phone', 'bell'],
    ['Bell Home', 'bell'],
    ['Crave', 'crave'],
    ['Slack Business+', 'slack'],
    ['Slack Pro', 'slack'],
    ['Shaw Home Internet', 'shaw'],
  ])('true positives still match: %s -> %s', (name, slug) => {
    expect(matchBrand(name)?.slug ?? null).toBe(slug);
  });

  it('a picked logo always wins over the name match', () => {
    expect(resolveLogo('Prime Gym', 'brand:amazon')).toMatchObject({ brand: { slug: 'amazon' } });
    expect(resolveLogo('Max', 'icon:gym')).toMatchObject({ kind: 'icon' });
    expect(resolveLogo('Prime Gym', null).kind).toBe('letter');
  });

  it('normalizes names', () => {
    expect(normalizeName('  Apple TV+ (Family) ')).toBe('apple tv+ family');
    expect(normalizeName('Crème')).toBe('creme');
  });

  it('every brand mark reads on its tile (3:1 for graphics)', () => {
    for (const b of BRANDS) {
      const t = brandTile(b);
      expect(contrast(t.fg, t.bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(BRANDS.filter((b) => !b.path).map((b) => [b.title, b] as const))('%s monogram text passes AA 4.5:1', (_t, b) => {
    const t = brandTile(b);
    expect(contrast(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('picks the better ink', () => {
    expect(inkOn('#000000')).toBe('#FFFFFF');
    expect(inkOn('#FFFFFF')).toBe('#000000');
    expect(inkOn('#1ED760')).toBe('#000000');
  });
});

describe('letter tiles', () => {
  it('uses the first letter or digit and a stable colour', () => {
    expect(letterTile('hydro one').letter).toBe('H');
    expect(letterTile('  1Life').letter).toBe('1');
    expect(letterTile('(émile)').letter).toBe('É');
    expect(letterTile('—').letter).toBe('?');
    expect(letterTile('Hydro')).toEqual(letterTile('hydro'));
    expect(LETTER_COLORS).toContain(letterTile('Gym').bg);
  });

  it.each(LETTER_COLORS)('white letters on %s pass AA 4.5:1', (bg) => {
    expect(contrast('#FFFFFF', bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('category symbols', () => {
  it.each([
    ['Streaming', 'tv'],
    ['Music', 'music.note'],
    ['Cloud storage', 'icloud'],
    ['News', 'newspaper'],
    ['Fitness', 'figure.run'],
    ['Gaming', 'gamecontroller'],
    ['Utilities', 'bolt'],
    ['Phone & internet', 'phone'],
    ['Insurance', 'shield'],
    ['Food', 'fork.knife'],
    ['Books', 'book'],
    ['Something else', 'tag'],
  ])('%s -> %s', (name, symbol) => {
    expect(categorySymbol('c1', name)).toBe(symbol);
  });

  it('has fixed symbols for All and Uncategorized', () => {
    expect(categorySymbol(null, 'whatever')).toBe('square.grid.2x2');
    expect(categorySymbol(UNCATEGORIZED_ID, 'Uncategorized')).toBe('tray');
  });
});

describe('filter options', () => {
  it('lists All, categories by name, then Uncategorized if used', () => {
    const cats = [
      { id: 'b', name: 'Streaming' },
      { id: 'a', name: 'Music' },
    ];
    expect(filterOptions(cats, true).map((o) => o.id)).toEqual([null, 'a', 'b', UNCATEGORIZED_ID]);
    expect(filterOptions(cats, false).map((o) => o.name)).toEqual(['All', 'Music', 'Streaming']);
  });
});

describe('spend donut', () => {
  const cat = (id: string, monthly: number): CategoryTotal => ({ id, name: id.toUpperCase(), monthly, yearly: monthly * 12, count: 1, missingRate: [] });

  it('sorts biggest first, drops zero, and shares add to 1', () => {
    const s = donutSlices([cat('a', 10), cat('b', 30), cat('z', 0), cat('c', 20)], 'light');
    expect(s.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(s.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1);
    expect(s[0].share).toBeCloseTo(0.5);
    expect(new Set(s.map((x) => x.color)).size).toBe(3);
  });

  it('folds the tail into Other', () => {
    const s = donutSlices([1, 2, 3, 4, 5, 6, 7, 8].map((n) => cat(`c${n}`, n)), 'dark', 6);
    expect(s).toHaveLength(6);
    expect(s[5]).toMatchObject({ id: 'other', name: 'Other', monthly: 1 + 2 + 3, color: CHART_COLORS.dark[6] });
  });

  it('is empty with nothing to show', () => {
    expect(donutSlices([cat('a', 0)], 'light')).toEqual([]);
  });

  it.each([
    ['light', light.surface],
    ['dark', dark.surface],
  ] as const)('%s chart colours are 3:1 on the card and distinct', (mode, surface) => {
    for (const c of CHART_COLORS[mode]) expect(contrast(c, surface)).toBeGreaterThanOrEqual(3);
    expect(new Set(CHART_COLORS[mode]).size).toBe(CHART_COLORS[mode].length);
  });
});

describe('generic icons', () => {
  it('has about two dozen icons with unique keys and symbols', () => {
    expect(GENERIC_ICONS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(GENERIC_ICONS.map((i) => i.key)).size).toBe(GENERIC_ICONS.length);
    expect(new Set(GENERIC_ICONS.map((i) => i.symbol)).size).toBe(GENERIC_ICONS.length);
    for (const i of GENERIC_ICONS) {
      expect(i.key).toMatch(/^[a-z]+$/);
      expect(ICON_COLOR_NAMES).toContain(i.color);
    }
  });

  it.each(ICON_COLOR_NAMES)('white icons on %s pass AA 4.5:1 in both modes', (c) => {
    expect(contrast('#FFFFFF', ICON_COLORS[c])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('resolveLogo', () => {
  it('is Automatic by default: brand by name, else a letter', () => {
    expect(resolveLogo('Netflix', null)).toMatchObject({ kind: 'mark', label: 'Netflix', bg: '#E50914' });
    expect(resolveLogo('Rogers', undefined)).toMatchObject({ kind: 'monogram', text: 'R', bg: '#DA291C' });
    expect(resolveLogo('Book club', '')).toMatchObject({ kind: 'letter', text: 'B' });
    expect(resolveLogo('Netflix', null)).toEqual(autoLogoTile('Netflix'));
  });

  it('uses a picked brand or icon over the name', () => {
    expect(resolveLogo('Phone', 'brand:rogers')).toMatchObject({ kind: 'monogram', label: 'Rogers' });
    expect(resolveLogo('Netflix', 'icon:tv')).toMatchObject({ kind: 'icon', label: 'TV', color: 'graphite' });
    expect(resolveLogo('Hydro', 'icon:bolt:teal')).toMatchObject({ kind: 'icon', bg: ICON_COLORS.teal, fg: '#FFFFFF' });
  });

  it('falls back to Automatic for values it no longer knows', () => {
    expect(resolveLogo('Netflix', 'brand:gone')).toEqual(autoLogoTile('Netflix'));
    expect(resolveLogo('Netflix', 'icon:nope')).toEqual(autoLogoTile('Netflix'));
    expect(resolveLogo('Netflix', 'nonsense')).toEqual(autoLogoTile('Netflix'));
  });

  it('labels the edit row', () => {
    expect(logoSummary('Netflix', null)).toBe('Automatic: Netflix');
    expect(logoSummary('Zzz', null)).toBe('Automatic: first letter');
    expect(logoSummary('Zzz', 'brand:sonnet')).toBe('Sonnet');
    expect(logoSummary('Zzz', 'brand:gone')).toBe('Automatic: first letter');
    expect(logoSummary('Hydro', 'icon:bolt')).toBe(`${GENERIC_ICONS.find((i) => i.key === 'bolt')!.title} icon`);
  });

  it('sizes monogram text down for longer initials', () => {
    expect(monogramFontSize('R', 40)).toBeGreaterThan(monogramFontSize('CW', 40));
    expect(monogramFontSize('CW', 40)).toBeGreaterThan(monogramFontSize('TTC', 40));
  });

  it('builds monogram tiles from the brand colour', () => {
    const wonderland = BRANDS.find((b) => b.slug === 'wonderland')!;
    expect(brandLogoTile(wonderland)).toMatchObject({ kind: 'monogram', text: 'CW', label: 'Canada\'s Wonderland' });
  });
});

describe('searchLogos', () => {
  it('lists everything for a blank search, brands by name', () => {
    const all = searchLogos('  ');
    expect(all.brands).toHaveLength(BRANDS.length);
    expect(all.icons).toHaveLength(GENERIC_ICONS.length);
    const titles = all.brands.map((b) => b.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it('finds brands by alias and icons by keyword', () => {
    expect(searchLogos('rogers').brands.map((b) => b.slug)).toContain('rogers');
    expect(searchLogos('supergrok').brands.map((b) => b.slug)).toEqual(['grok']);
    expect(searchLogos('office 365').brands.map((b) => b.slug)).toEqual(['microsoft365']);
    expect(searchLogos('electric').icons.map((i) => i.key)).toContain('bolt');
    expect(searchLogos('zzzz')).toEqual({ brands: [], icons: [] });
  });
});
