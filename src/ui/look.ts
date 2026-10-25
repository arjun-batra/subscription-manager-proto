/**
 * Pure helpers for the Home look: brand matching, letter tiles, category SF Symbols and the
 * spend donut. No native imports, so Jest can test them.
 */
import type { SFSymbol } from 'expo-symbols';

import type { CategoryTotal } from '../domain/totals';
import { UNCATEGORIZED_ID } from '../domain/types';
import { BRANDS, type Brand } from './brands/data';
import { contrast } from './palette';

export type { SFSymbol };

/** Lower case, "+" kept (Apple TV+), everything else that isn't a letter or digit becomes a space. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

/**
 * The brand a subscription name means, or null. An alias matches when it is the whole name or
 * its first words ("Spotify Premium Family" is Spotify; "Maximum Fitness" is not Max).
 * The longest matching alias wins ("Apple TV" over "Apple").
 */
export function matchBrand(name: string): Brand | null {
  const n = normalizeName(name);
  if (!n) return null;
  let best: { brand: Brand; len: number } | null = null;
  for (const brand of BRANDS) {
    for (const alias of brand.aliases) {
      const a = normalizeName(alias);
      if ((n === a || n.startsWith(a + ' ')) && (!best || a.length > best.len)) best = { brand, len: a.length };
    }
  }
  return best?.brand ?? null;
}

/** White or black, whichever reads better on the colour. */
export function inkOn(bg: string): '#FFFFFF' | '#000000' {
  return contrast('#FFFFFF', bg) >= contrast('#000000', bg) ? '#FFFFFF' : '#000000';
}

/** Tile colours for a brand: brand colour background with a white or black mark. */
export function brandTile(brand: Brand): { bg: string; fg: string } {
  const bg = `#${brand.hex}`;
  return { bg, fg: inkOn(bg) };
}

/** Letter tile backgrounds; white text on each passes 4.5:1 (look.test.ts). */
export const LETTER_COLORS = ['#B3261E', '#8A4B00', '#2E7D32', '#00695C', '#1565C0', '#4527A0', '#6A1B9A', '#AD1457', '#37474F', '#5D4037'];

/** First letter or digit of the name, and a colour picked from the name so it stays the same. */
export function letterTile(name: string): { letter: string; bg: string; fg: string } {
  const trimmed = name.trim();
  const m = /[\p{L}\p{N}]/u.exec(trimmed);
  const letter = (m ? m[0] : '?').toUpperCase();
  let h = 0;
  for (const ch of trimmed.toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return { letter, bg: LETTER_COLORS[h % LETTER_COLORS.length], fg: '#FFFFFF' };
}

const CATEGORY_SYMBOLS: [RegExp, SFSymbol][] = [
  [/stream|video|tv|movie|film|watch/, 'tv'],
  [/music|audio|podcast|radio/, 'music.note'],
  [/cloud|storage|backup|drive/, 'icloud'],
  [/news|magazine|reading|press|journal/, 'newspaper'],
  [/fitness|gym|health|sport|workout|run|yoga/, 'figure.run'],
  [/gam|play/, 'gamecontroller'],
  [/utilit|hydro|power|electric|energy|gas|water|bill/, 'bolt'],
  [/phone|mobile|cell|internet|wifi|telecom/, 'phone'],
  [/insur|security|vpn|password|privacy/, 'shield'],
  [/food|meal|grocer|dining|coffee|restaurant/, 'fork.knife'],
  [/book|learn|educat|course|school|study/, 'book'],
  [/work|software|productiv|tool|app|dev/, 'hammer'],
  [/loan|finance|bank|plan|instal|car|auto/, 'creditcard'],
  [/home|rent|house/, 'house'],
];

/** An SF Symbol for a category, picked from words in its name; a tag when nothing fits. */
export function categorySymbol(id: string | null, name: string): SFSymbol {
  if (id === null) return 'square.grid.2x2';
  if (id === UNCATEGORIZED_ID) return 'tray';
  const n = normalizeName(name);
  for (const [re, symbol] of CATEGORY_SYMBOLS) if (re.test(n)) return symbol;
  return 'tag';
}

/**
 * Donut colours. Each is checked (look.test.ts) for 3:1 against the card surface in its mode,
 * the WCAG 1.4.11 level for meaningful graphics, and the legend repeats every value as text.
 */
export const CHART_COLORS: Record<'light' | 'dark', string[]> = {
  light: ['#0062CC', '#C4170C', '#2E7D32', '#8A4B00', '#6A1B9A', '#00695C', '#5C5C62'],
  dark: ['#4DA3FF', '#FF6961', '#30D158', '#FFB340', '#BF5AF2', '#40C8E0', '#AEAEB2'],
};

export interface DonutSlice {
  id: string;
  name: string;
  monthly: number;
  color: string;
  /** Share of the donut, 0..1. */
  share: number;
}

/**
 * Slices of average monthly spend by category: biggest first, at most `max` slices with the rest
 * as "Other". Items in two categories count in both, as the category totals do, so shares are of
 * the slice sum. Zero categories are left out.
 */
export function donutSlices(categories: CategoryTotal[], mode: 'light' | 'dark', max = 6): DonutSlice[] {
  const palette = CHART_COLORS[mode];
  const sorted = categories.filter((c) => c.monthly > 0).sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name));
  const head = sorted.length > max ? sorted.slice(0, max - 1) : sorted;
  const rest = sorted.length > max ? sorted.slice(max - 1) : [];
  const parts = head.map((c) => ({ id: c.id, name: c.name, monthly: c.monthly }));
  if (rest.length) parts.push({ id: 'other', name: 'Other', monthly: rest.reduce((s, c) => s + c.monthly, 0) });
  const sum = parts.reduce((s, c) => s + c.monthly, 0);
  return parts.map((c, i) => ({
    ...c,
    color: c.id === 'other' ? palette[palette.length - 1] : palette[i % (palette.length - 1)],
    share: sum > 0 ? c.monthly / sum : 0,
  }));
}

export interface FilterOption {
  id: string | null;
  name: string;
  symbol: SFSymbol;
}

/** All, then each category by name, then Uncategorized when something is in it. */
export function filterOptions(categories: { id: string; name: string }[], hasUncategorized: boolean): FilterOption[] {
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));
  return [
    { id: null, name: 'All', symbol: categorySymbol(null, 'All') },
    ...sorted.map((c) => ({ id: c.id, name: c.name, symbol: categorySymbol(c.id, c.name) })),
    ...(hasUncategorized ? [{ id: UNCATEGORIZED_ID, name: 'Uncategorized', symbol: categorySymbol(UNCATEGORIZED_ID, '') }] : []),
  ];
}
