import { sub, settings } from './fixtures';
import { toLocalDate } from './dates';
import { formatMoney } from './money';
import { nextCharge } from './schedule';
import { chargesPerMonth, computeMonthTotals, computeTotals } from './totals';
import { UNCATEGORIZED_ID } from './types';

const cats = [
  { id: 'c1', name: 'Streaming' },
  { id: 'c2', name: 'Family' },
  { id: 'c3', name: 'Work' },
];

describe('normalized totals', () => {
  it('uses the documented formulas', () => {
    expect(chargesPerMonth({ unit: 'week', every: 1 })).toBeCloseTo(52 / 12);
    expect(chargesPerMonth({ unit: 'year', every: 1 })).toBeCloseTo(1 / 12);
    expect(chargesPerMonth({ unit: 'month', every: 3 })).toBeCloseTo(1 / 3);
    expect(chargesPerMonth({ unit: 'day', every: 30 })).toBeCloseTo(365 / 360);
  });

  it('counts a multi-category subscription once overall and in full in each category', () => {
    const subs = [
      sub({ amount: 20, categoryIds: ['c1', 'c2', 'c3'] }),
      sub({ amount: 120, cycle: { unit: 'year', every: 1 }, categoryIds: ['c3'] }),
    ];
    const t = computeTotals(subs, cats, settings());
    expect(t.overall.monthly).toBeCloseTo(30);
    expect(t.overall.yearly).toBeCloseTo(360);
    const by = Object.fromEntries(t.categories.map((c) => [c.id, c.monthly]));
    expect(by.c1).toBeCloseTo(20);
    expect(by.c2).toBeCloseTo(20);
    expect(by.c3).toBeCloseTo(30);
    expect(t.categorySumExceedsOverall).toBe(true);
  });

  it('always lists Uncategorized, with 0 when everything is categorized', () => {
    const t = computeTotals([sub({ categoryIds: ['c1'] })], cats, settings());
    const u = t.categories.find((c) => c.id === UNCATEGORIZED_ID)!;
    expect(u).toMatchObject({ name: 'Uncategorized', monthly: 0, count: 0 });
    expect(t.categories[t.categories.length - 1].id).toBe(UNCATEGORIZED_ID);
    expect(t.categorySumExceedsOverall).toBe(false);
  });

  it('moves subscriptions whose only category was deleted to Uncategorized', () => {
    const t = computeTotals([sub({ amount: 7, categoryIds: ['deleted'] })], cats, settings());
    expect(t.categories.find((c) => c.id === UNCATEGORIZED_ID)!.monthly).toBeCloseTo(7);
  });

  it('excludes cancelled items', () => {
    const t = computeTotals([sub({ amount: 5, cancelled: true }), sub({ amount: 3 })], [], settings());
    expect(t.overall.monthly).toBeCloseTo(3);
  });

  it('converts currencies with stored rates and reports items with no rate', () => {
    const subs = [sub({ amount: 10, currency: 'USD' }), sub({ amount: 10, currency: 'EUR' }), sub({ amount: 1 })];
    const t = computeTotals(subs, [], settings({ rates: { USD: 1.4 } }));
    expect(t.overall.monthly).toBeCloseTo(15);
    expect(t.missingRate.map((s) => s.currency)).toEqual(['EUR']);
  });
});

describe('current-month totals', () => {
  const s = settings();

  it('a charge due today counts as still due; earlier ones count as paid', () => {
    const subs = [
      sub({ amount: 10, anchorDate: '2026-10-25' }), // today
      sub({ amount: 5, anchorDate: '2026-10-03' }), // passed
      sub({ amount: 7, anchorDate: '2026-10-31' }), // later
    ];
    const m = computeMonthTotals(subs, s, '2026-10-25');
    expect(m.thisMonth).toBeCloseTo(22);
    expect(m.stillDue).toBeCloseTo(17);
    expect(m.paidSoFar).toBeCloseTo(5);
  });

  it('counts weekly charges once per due date and yearly only in its month', () => {
    const subs = [
      sub({ amount: 2, anchorDate: '2026-10-02', cycle: { unit: 'week', every: 1 } }),
      sub({ amount: 100, anchorDate: '2027-03-01', cycle: { unit: 'year', every: 1 } }),
    ];
    expect(computeMonthTotals(subs, s, '2026-10-15').thisMonth).toBeCloseTo(10);
    expect(computeMonthTotals(subs, s, '2027-03-15').thisMonth).toBeCloseTo(108);
  });

  it('applies the month-end rule (31st falls on Feb 28)', () => {
    const subs = [sub({ amount: 9, anchorDate: '2027-01-31' })];
    const m = computeMonthTotals(subs, s, '2027-02-28');
    expect(m.charges.map((c) => c.date)).toEqual(['2027-02-28']);
    expect(m.stillDue).toBeCloseTo(9);
  });

  it('switches month at local midnight (fixed clocks 23:59 and 00:00)', () => {
    const subs = [sub({ amount: 4, anchorDate: '2026-10-31', cycle: { unit: 'year', every: 1 } })];
    const at2359 = new Date(2026, 9, 31, 23, 59);
    const at0000 = new Date(2026, 10, 1, 0, 0);
    expect(computeMonthTotals(subs, s, toLocalDate(at2359)).stillDue).toBeCloseTo(4);
    const nov = computeMonthTotals(subs, s, toLocalDate(at0000));
    expect(nov.thisMonth).toBeCloseTo(0);
    expect(nov.stillDue).toBeCloseTo(0);
  });

  it('mixed currencies tie out and still due never exceeds the month total', () => {
    const subs = [
      sub({ amount: 10, currency: 'USD', anchorDate: '2026-10-10' }),
      sub({ amount: 10, currency: 'GBP', anchorDate: '2026-10-28' }),
      sub({ amount: 10, currency: 'EUR', anchorDate: '2026-10-28' }),
    ];
    const m = computeMonthTotals(subs, settings({ rates: { USD: 1.4, GBP: 1.8 } }), '2026-10-25');
    expect(m.thisMonth).toBeCloseTo(32);
    expect(m.stillDue).toBeCloseTo(18);
    expect(m.stillDue).toBeLessThanOrEqual(m.thisMonth);
    expect(m.missingRate.map((x) => x.currency)).toEqual(['EUR']);
  });

  it('is zero with no charges', () => {
    expect(computeMonthTotals([], s, '2026-10-25')).toMatchObject({ thisMonth: 0, stillDue: 0, paidSoFar: 0 });
  });
});

describe('formatMoney', () => {
  it('uses unambiguous symbols and rounds at display', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('US$1,234.50');
    expect(formatMoney(9.999, 'CAD')).toBe('CA$10.00');
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500');
    expect(formatMoney(3, 'CHF')).toBe('3.00 CHF');
  });
});

describe('first charge in the future (new subscription)', () => {
  it('does not count a backwards-projected charge as paid', () => {
    const existing = sub({ amount: 10, anchorDate: '2026-11-15' });
    const fresh = sub({ amount: 10, anchorDate: '2026-11-15', startDate: '2026-11-15' });
    expect(computeMonthTotals([existing], settings(), '2026-10-25')).toMatchObject({ thisMonth: 10, paidSoFar: 10, stillDue: 0 });
    expect(computeMonthTotals([fresh], settings(), '2026-10-25')).toMatchObject({ thisMonth: 0, paidSoFar: 0, stillDue: 0 });
    expect(computeMonthTotals([fresh], settings(), '2026-11-01')).toMatchObject({ thisMonth: 10, paidSoFar: 0, stillDue: 10 });
    expect(computeMonthTotals([fresh], settings(), '2026-11-20')).toMatchObject({ thisMonth: 10, paidSoFar: 10, stillDue: 0 });
  });

  it('starts the upcoming date at the first charge', () => {
    const fresh = sub({ cycle: { unit: 'week', every: 1 }, anchorDate: '2026-11-15', startDate: '2026-11-15' });
    expect(nextCharge(fresh, '2026-10-25')).toBe('2026-11-15');
    expect(nextCharge({ ...fresh, startDate: null }, '2026-10-25')).toBe('2026-10-25');
  });
});

describe('category totals with missing rates', () => {
  it('names the excluded items on each affected category, including Uncategorized', () => {
    const usd = sub({ name: 'GitHub', currency: 'USD', categoryIds: ['c3'] });
    const eur = sub({ name: 'Spotify EU', currency: 'EUR', categoryIds: ['c1', 'c3'] });
    const loose = sub({ name: 'VPN', currency: 'USD' });
    const ok = sub({ name: 'Crave', categoryIds: ['c1'] });
    const t = computeTotals([usd, eur, loose, ok], cats, settings());
    const by = Object.fromEntries(t.categories.map((c) => [c.id, c.missingRate.map((s) => s.name)]));
    expect(by).toEqual({ c1: ['Spotify EU'], c2: [], c3: ['GitHub', 'Spotify EU'], [UNCATEGORIZED_ID]: ['VPN'] });
    expect(t.categories.find((c) => c.id === 'c1')!.count).toBe(1);
  });
});

describe('time-zone change moves "today" (FR-019)', () => {
  // Jest workers can't switch the process time zone, so the zone is passed explicitly.
  // The app calls toLocalDate(new Date()) with the device zone and re-reads it when
  // the app becomes active and every 30 s, so a zone change shows up as a new "today".
  it('matches the device zone when no zone is given', () => {
    const at = new Date(2026, 9, 31, 23, 59);
    expect(toLocalDate(at, Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(toLocalDate(at));
  });

  it('recomputes the month for the new zone at the same instant', () => {
    // 2026-11-01 03:30 UTC is Oct 31 23:30 in Toronto but already Nov 1 in London.
    const instant = new Date(Date.UTC(2026, 10, 1, 3, 30));
    const subs = [sub({ amount: 10, anchorDate: '2026-10-31' }), sub({ amount: 5, anchorDate: '2026-11-01' })];

    const torontoToday = toLocalDate(instant, 'America/Toronto');
    expect(torontoToday).toBe('2026-10-31');
    expect(computeMonthTotals(subs, settings(), torontoToday)).toMatchObject({ thisMonth: 15, stillDue: 10, paidSoFar: 5 });

    const londonToday = toLocalDate(instant, 'Europe/London');
    expect(londonToday).toBe('2026-11-01');
    // New month: Nov 1 is due today (still due) and Nov 30 is still due; October no longer counts.
    expect(computeMonthTotals(subs, settings(), londonToday)).toMatchObject({ thisMonth: 15, stillDue: 15, paidSoFar: 0 });

    // Flying west the other way moves "today" back a day across the month boundary.
    expect(toLocalDate(new Date(Date.UTC(2026, 10, 1, 7, 30)), 'America/Los_Angeles')).toBe('2026-11-01');
    expect(toLocalDate(new Date(Date.UTC(2026, 10, 1, 6, 30)), 'America/Los_Angeles')).toBe('2026-10-31');
  });
});
