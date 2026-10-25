import { settings } from './fixtures';
import { changeHomeCurrency, toHome } from './money';

describe('changeHomeCurrency', () => {
  it('clears rates set against the old home currency and reports which', () => {
    const before = settings({ homeCurrency: 'CAD', rates: { USD: 1.4, EUR: 1.5 }, ratesUpdatedAt: '2026-10-25T00:00:00.000Z' });
    const { settings: after, cleared } = changeHomeCurrency(before, 'eur');
    expect(after).toMatchObject({ homeCurrency: 'EUR', rates: {}, ratesUpdatedAt: null });
    expect(cleared).toEqual(['EUR', 'USD']);
    // USD items now need a rate instead of silently using the CAD rate.
    expect(toHome(10, 'USD', before)).toBeCloseTo(14);
    expect(toHome(10, 'USD', after)).toBeNull();
    expect(toHome(10, 'EUR', after)).toBe(10);
  });

  it('keeps rates when the code is unchanged (any case or spacing)', () => {
    const before = settings({ homeCurrency: 'CAD', rates: { USD: 1.4 } });
    const r = changeHomeCurrency(before, ' cad ');
    expect(r.settings).toBe(before);
    expect(r.cleared).toEqual([]);
  });
});
