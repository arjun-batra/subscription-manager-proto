/**
 * Pure helpers for the Home look: brand matching, letter tiles, category SF Symbols and the
 * spend donut. No native imports, so Jest can test them.
 */
import type { SFSymbol } from 'expo-symbols';

import type { CategoryTotal } from '../domain/totals';
import { UNCATEGORIZED_ID } from '../domain/types';
import { parseLogo } from '../domain/logo';
import { BRANDS, type Brand } from './brands/data';
import { GENERIC_ICONS, ICON_COLORS, type GenericIcon, type IconColor } from './brands/icons';
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
 * Words that only describe a plan or tier. After an ambiguous alias (below) only these may follow,
 * so "Max Ad-Free" and "Prime Monthly" still match but "Max Fitness" and "Prime Gym" don't.
 */
export const PLAN_WORDS = new Set(
  (
    'premium plus family membership member subscription sub monthly month annual annually yearly year plan pro basic ' +
    'standard student individual duo ultimate unlimited internet mobile wireless tv video music account ' +
    'ad ads free with no essential essentials deluxe extra trial gift card pass'
  ).split(' '),
);

/**
 * Single-word aliases that are also ordinary words or other companies' names (Prime Gym,
 * Max Fitness, Copilot Money, Nitro PDF, Freedom 55, Shaw Academy). These match only as the whole
 * name, or followed by plan words, or by the few product words listed for them.
 */
export const AMBIGUOUS_ALIASES: Record<string, string[]> = {
  max: [],
  hbo: ['now', 'go'],
  prime: [],
  kindle: [],
  copilot: [],
  nitro: [],
  freedom: ['home'],
  shaw: ['home'],
  bell: ['canada', 'mobility', 'fibe'],
  fibe: [],
  medium: [],
  notion: ['ai', 'calendar', 'mail'],
  zoom: ['workplace', 'one', 'meetings'],
  slack: ['business', 'enterprise'],
  sonnet: ['insurance', 'car', 'auto'],
  crave: ['total'],
  presto: [],
  wonderland: ['season'],
  proton: ['drive', 'pass', 'mail', 'vpn'],
  gemini: ['advanced', 'ai'],
  paramount: [],
  optik: [],
  twitter: ['blue'],
};

function aliasMatches(n: string, a: string): boolean {
  if (n === a) return true;
  if (!n.startsWith(a + ' ')) return false;
  if (!Object.prototype.hasOwnProperty.call(AMBIGUOUS_ALIASES, a)) return true;
  const extra = AMBIGUOUS_ALIASES[a];
  // Anchored: every following word must be a plan word or one of this alias's product words.
  return n
    .slice(a.length + 1)
    .split(' ')
    .map((w) => w.replace(/\+$/, '')) // "Business+" reads as "business"
    .every((w) => !w || PLAN_WORDS.has(w) || extra.includes(w));
}

/**
 * The brand a subscription name means, or null. An alias matches when it is the whole name or
 * its first words ("Spotify Premium Family" is Spotify; "Maximum Fitness" is not Max). Ambiguous
 * one-word aliases (AMBIGUOUS_ALIASES) need the whole name, or only plan words after them.
 * The longest matching alias wins ("Apple TV" over "Apple"). A picked logo always wins over this
 * (resolveLogo).
 */
export function matchBrand(name: string): Brand | null {
  const n = normalizeName(name);
  if (!n) return null;
  let best: { brand: Brand; len: number } | null = null;
  for (const brand of BRANDS) {
    for (const alias of brand.aliases) {
      const a = normalizeName(alias);
      if (aliasMatches(n, a) && (!best || a.length > best.len)) best = { brand, len: a.length };
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
export const LETTER_COLORS: string[] = Object.values(ICON_COLORS);

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

/** What a logo tile draws. Every kind is a rounded square with a colour and an ink. */
export type LogoTile =
  | { kind: 'mark'; brand: Brand; path: string; bg: string; fg: string; label: string }
  | { kind: 'monogram'; brand: Brand; text: string; bg: string; fg: string; label: string }
  | { kind: 'icon'; icon: GenericIcon; color: IconColor; bg: string; fg: string; label: string }
  | { kind: 'letter'; text: string; bg: string; fg: string; label: string };

export function brandLogoTile(brand: Brand): LogoTile {
  const { bg, fg } = brandTile(brand);
  return brand.path
    ? { kind: 'mark', brand, path: brand.path, bg, fg, label: brand.title }
    : { kind: 'monogram', brand, text: brand.monogram ?? brand.title.slice(0, 1), bg, fg, label: brand.title };
}

export function iconLogoTile(icon: GenericIcon, color: IconColor | null = null): LogoTile {
  const c = color ?? icon.color;
  return { kind: 'icon', icon, color: c, bg: ICON_COLORS[c], fg: '#FFFFFF', label: icon.title };
}

/** The automatic tile: a brand matched by name, else a coloured first letter. */
export function autoLogoTile(name: string): LogoTile {
  const brand = matchBrand(name);
  if (brand) return brandLogoTile(brand);
  const t = letterTile(name);
  return { kind: 'letter', text: t.letter, bg: t.bg, fg: t.fg, label: 'Letter' };
}

/**
 * The tile for an item: its picked logo (`brand:…` / `icon:…`), or Automatic when none is picked
 * or the stored value no longer names something the app has.
 */
export function resolveLogo(name: string, logo: string | null | undefined): LogoTile {
  const r = parseLogo(logo);
  if ('ref' in r && r.ref) {
    const ref = r.ref;
    if (ref.kind === 'brand') {
      const brand = BRANDS.find((b) => b.slug === ref.slug);
      if (brand) return brandLogoTile(brand);
    } else {
      const icon = GENERIC_ICONS.find((i) => i.key === ref.key);
      if (icon) return iconLogoTile(icon, ref.color);
    }
  }
  return autoLogoTile(name);
}

/** Font size for monogram initials, smaller for longer ones. */
export function monogramFontSize(text: string, size: number): number {
  const n = [...text].length;
  return size * (n <= 1 ? 0.46 : n === 2 ? 0.38 : 0.28);
}

/** Picker search: brands by title or alias, icons by title, key or keyword. Blank returns all. */
export function searchLogos(query: string): { brands: Brand[]; icons: GenericIcon[] } {
  const q = normalizeName(query);
  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
  if (!q) return { brands: [...BRANDS].sort(byTitle), icons: GENERIC_ICONS };
  const hit = (words: string[]) => words.some((w) => normalizeName(w).includes(q));
  return {
    brands: BRANDS.filter((b) => hit([b.title, b.slug, ...b.aliases])).sort(byTitle),
    icons: GENERIC_ICONS.filter((i) => hit([i.title, i.key, ...i.keywords])),
  };
}

/** What the edit screen's Logo row says: "Automatic: Netflix", "Rogers", "Electricity icon". */
export function logoSummary(name: string, logo: string | null | undefined): string {
  const r = parseLogo(logo);
  const tile = resolveLogo(name, logo);
  const ref = 'ref' in r ? r.ref : null;
  const picked =
    !!ref &&
    (ref.kind === 'icon'
      ? tile.kind === 'icon'
      : (tile.kind === 'mark' || tile.kind === 'monogram') && tile.brand.slug === ref.slug);
  const what = tile.kind === 'letter' ? 'first letter' : tile.kind === 'icon' ? `${tile.label} icon` : tile.label;
  return picked ? what : `Automatic: ${what}`;
}
