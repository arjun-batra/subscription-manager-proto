import { contrast, dark, light, SWIPE_COLORS, SWIPE_LABEL, textPairs } from './palette';
// Node built-ins, typed locally to avoid adding @types/node (as in sql.test.ts).
/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('fs') as { readFileSync(file: string, enc: 'utf8'): string };
const { join } = require('path') as { join(...parts: string[]): string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

describe.each([
  ['light', light],
  ['dark', dark],
])('%s palette', (_name, p) => {
  it.each(textPairs(p))('%s meets WCAG AA 4.5:1', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('swipe-action buttons (white label and glyph in light and dark mode)', () => {
  it.each(['light', 'dark'])('every fill passes 4.5:1 against the label in %s mode', () => {
    for (const [name, fill] of Object.entries(SWIPE_COLORS)) {
      expect([name, contrast(SWIPE_LABEL, fill) >= 4.5]).toEqual([name, true]);
    }
  });

  it('every swipe action in the home list is tinted with one of these fills', () => {
    const src = readFileSync(join(__dirname, 'HomeScreen.tsx'), 'utf8');
    // Each <SwipeActions.Actions> block on its own (rows of different sections have their own).
    const blocks = src.match(/<SwipeActions\.Actions[\s\S]*?<\/SwipeActions\.Actions>/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const buttons = blocks.flatMap((b) => b.match(/<UIButton[\s\S]*?\/>/g) ?? []);
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    const keys = Object.keys(SWIPE_COLORS).join('|');
    for (const b of buttons) expect(b).toMatch(new RegExp(`modifiers=\\{\\[tint\\(SWIPE_COLORS\\.(${keys})\\)\\]\\}`));
    // No system colour names or palette accents anywhere a tint is applied.
    expect(src).not.toMatch(/tint\((?!SWIPE_COLORS\.)/);
  });
});
