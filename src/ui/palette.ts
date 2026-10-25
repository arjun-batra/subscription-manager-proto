/** Light and dark palettes. Text/background pairs are checked for WCAG AA in palette.test.ts. */
export interface Palette {
  background: string; // grouped background
  surface: string; // cards, rows
  text: string;
  secondaryText: string;
  accent: string; // tint used for buttons and links on surface/background
  onAccent: string; // text on accent-filled buttons
  danger: string;
  warningBg: string;
  warningText: string;
  separator: string;
  chipBg: string;
  chipText: string;
  chipSelectedBg: string;
  chipSelectedText: string;
}

export const light: Palette = {
  background: '#F2F2F7',
  surface: '#FFFFFF',
  text: '#000000',
  secondaryText: '#5C5C62',
  accent: '#0062CC',
  onAccent: '#FFFFFF',
  danger: '#C4170C',
  warningBg: '#FFF4CC',
  warningText: '#5C3D00',
  separator: '#C6C6C8',
  chipBg: '#E5E5EA',
  chipText: '#1C1C1E',
  chipSelectedBg: '#0062CC',
  chipSelectedText: '#FFFFFF',
};

export const dark: Palette = {
  background: '#000000',
  surface: '#1C1C1E',
  text: '#FFFFFF',
  secondaryText: '#AEAEB2',
  accent: '#4DA3FF',
  onAccent: '#000000',
  danger: '#FF6961',
  warningBg: '#3D2E00',
  warningText: '#FFE08A',
  separator: '#38383A',
  chipBg: '#2C2C2E',
  chipText: '#FFFFFF',
  chipSelectedBg: '#4DA3FF',
  chipSelectedText: '#000000',
};

/**
 * Fills of the iOS swipe-action buttons. iOS draws their label and glyph in white in both light
 * and dark mode, so one set works for both; each passes 4.5:1 against white (palette.test.ts).
 * System green, orange and red (and the dark-mode accent) don't.
 */
export const SWIPE_COLORS = {
  paid: '#2E7D32',
  log: '#0062CC',
  cancel: '#A34700',
  delete: '#B3261E',
} as const;

/** The swipe-action label colour iOS uses, in both modes. */
export const SWIPE_LABEL = '#FFFFFF';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every foreground/background pair the UI actually draws. */
export function textPairs(p: Palette): [string, string, string][] {
  return [
    ['text on background', p.text, p.background],
    ['text on surface', p.text, p.surface],
    ['secondary on background', p.secondaryText, p.background],
    ['secondary on surface', p.secondaryText, p.surface],
    ['accent on surface', p.accent, p.surface],
    ['accent on background', p.accent, p.background],
    ['onAccent on accent', p.onAccent, p.accent],
    ['danger on surface', p.danger, p.surface],
    ['danger on background', p.danger, p.background],
    ['warning text on warning bg', p.warningText, p.warningBg],
    ['warning text on surface', p.warningText, p.surface],
    ['chip text on chip', p.chipText, p.chipBg],
    ['selected chip text', p.chipSelectedText, p.chipSelectedBg],
  ];
}
