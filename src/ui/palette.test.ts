import { contrast, dark, light, textPairs } from './palette';

describe.each([
  ['light', light],
  ['dark', dark],
])('%s palette', (_name, p) => {
  it.each(textPairs(p))('%s meets WCAG AA 4.5:1', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
