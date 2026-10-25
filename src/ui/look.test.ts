import type { CategoryTotal } from '../domain/totals';
import { UNCATEGORIZED_ID } from '../domain/types';
import { BRANDS } from './brands/data';
import {
  brandTile,
  categorySymbol,
  CHART_COLORS,
  donutSlices,
  filterOptions,
  inkOn,
  LETTER_COLORS,
  letterTile,
  matchBrand,
  normalizeName,
} from './look';
import { contrast, dark, light } from './palette';

describe('brand marks', () => {
  it('bundles about 30 single-path 24x24 marks with colours', () => {
    expect(BRANDS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(BRANDS.map((b) => b.slug)).size).toBe(BRANDS.length);
    for (const b of BRANDS) {
      expect(b.hex).toMatch(/^[0-9A-F]{6}$/);
      expect(b.path).toMatch(/^[Mm][-0-9. ,a-zA-Z]+$/);
      expect(b.aliases.length).toBeGreaterThan(0);
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
    ['Disney+', null],
    ['', null],
    ['Hydro', null],
  ])('%s -> %s', (name, slug) => {
    expect(matchBrand(name)?.slug ?? null).toBe(slug);
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
