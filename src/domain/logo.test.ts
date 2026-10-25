import { formatLogo, normalizeLogo, parseLogo } from './logo';

describe('logo values', () => {
  it.each(['', '  ', 'auto', 'Automatic', null, undefined])('%p is Automatic', (raw) => {
    expect(parseLogo(raw)).toEqual({ ref: null });
    expect(normalizeLogo(raw)).toBeNull();
  });

  it('reads brands and icons, any case and spacing', () => {
    expect(parseLogo(' Brand:Netflix ')).toEqual({ ref: { kind: 'brand', slug: 'netflix' } });
    expect(parseLogo('icon:bolt')).toEqual({ ref: { kind: 'icon', key: 'bolt', color: null } });
    expect(parseLogo('ICON: bolt : Amber')).toEqual({ ref: { kind: 'icon', key: 'bolt', color: 'amber' } });
  });

  it.each([
    ['brand:nope', /brand “nope”/],
    ['icon:nope', /icon “nope”/],
    ['icon:bolt:toString', /colour “tostring”/],
    ['icon:bolt:chartreuse', /colour “chartreuse”/],
    ['netflix', /brand:<name>/],
    ['brand:', /brand “”/],
    ['icon:bolt:red:extra', /brand:<name>/],
  ])('rejects %s', (raw, msg) => {
    const r = parseLogo(raw);
    expect('error' in r && r.error).toMatch(msg);
  });

  it('formats back to the canonical string', () => {
    expect(formatLogo(null)).toBe('');
    expect(formatLogo({ kind: 'brand', slug: 'rogers' })).toBe('brand:rogers');
    expect(formatLogo({ kind: 'icon', key: 'bolt', color: null })).toBe('icon:bolt');
    expect(formatLogo({ kind: 'icon', key: 'bolt', color: 'teal' })).toBe('icon:bolt:teal');
    expect(normalizeLogo(' ICON:Bolt:Teal')).toBe('icon:bolt:teal');
    expect(normalizeLogo('brand:gone')).toBeNull();
  });
});
