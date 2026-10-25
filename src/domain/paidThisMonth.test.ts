/** The "Paid this month" list on Home and the "Paid so far" figure it adds up to. */
import { toLocalDate } from './dates';
import { sub, settings } from './fixtures';
import { markNextPaid } from './payments';
import { computeMonthTotals, filterByCategory, paidEntries, type PaidEntry } from './totals';
import { UNCATEGORIZED_ID, type Subscription } from './types';

const s = settings({ rates: { USD: 1.4 } });
const NOW = '2026-10-25T14:00:00.000Z';
const mark = (x: Subscription, today: string, actual?: number) => markNextPaid(x, today, { actual, now: NOW })!.sub;
const brief = (list: PaidEntry[]) => list.map((e) => [e.sub.name, e.chargeDate, e.paidOn, e.amount, e.estimated, e.early]);
const sum = (list: PaidEntry[]) => list.reduce((a, e) => a + (e.homeAmount ?? 0), 0);

describe('Paid this month list', () => {
  it('lists charges whose date has passed, newest first; today’s and later ones are still due', () => {
    const a = sub({ name: 'A', amount: 10, anchorDate: '2026-10-03' });
    const b = sub({ name: 'B', amount: 20, anchorDate: '2026-10-20' });
    const c = sub({ name: 'C', amount: 5, anchorDate: '2026-10-25' }); // due today: still due
    const w = sub({ name: 'W', amount: 2, anchorDate: '2026-10-06', cycle: { unit: 'week', every: 1 } });
    const list = paidEntries([a, b, c, w], s, '2026-10-25');
    expect(brief(list)).toEqual([
      ['B', '2026-10-20', '2026-10-20', 20, false, false],
      ['W', '2026-10-20', '2026-10-20', 2, false, false],
      ['W', '2026-10-13', '2026-10-13', 2, false, false],
      ['W', '2026-10-06', '2026-10-06', 2, false, false],
      ['A', '2026-10-03', '2026-10-03', 10, false, false],
    ]);
  });

  it('is empty on the 1st before anything is marked', () => {
    expect(paidEntries([sub({ anchorDate: '2026-11-01' })], s, '2026-11-01')).toEqual([]);
  });

  it('includes charges marked paid, early ones on the day they were paid', () => {
    const today = mark(sub({ name: 'Today', amount: 5, anchorDate: '2026-10-25' }), '2026-10-25');
    const early = mark(sub({ name: 'Early', amount: 16, anchorDate: '2026-11-05' }), '2026-10-25'); // Oct 5 past, Nov 5 early
    const list = paidEntries([today, early], s, '2026-10-25');
    expect(brief(list)).toEqual([
      ['Early', '2026-11-05', '2026-10-25', 16, false, true],
      ['Today', '2026-10-25', '2026-10-25', 5, false, false],
      ['Early', '2026-10-05', '2026-10-05', 16, false, false],
    ]);
    expect(list[0].record).toEqual({ date: '2026-11-05', paidOn: '2026-10-25', amount: 16 });
    expect(list[2].record).toBeNull();
  });

  it('a charge marked late (last month’s, paid this month) is listed on the day paid', () => {
    const x = sub({ name: 'X', amount: 10, anchorDate: '2026-09-30', payments: [{ date: '2026-09-30', paidOn: '2026-10-02', amount: 10 }] });
    expect(brief(paidEntries([x], s, '2026-10-25'))).toEqual([['X', '2026-09-30', '2026-10-02', 10, false, false]]);
    // ...and no longer in September's list, where it counted before it was marked.
    expect(paidEntries([x], s, '2026-09-30')).toEqual([]);
  });

  it('variable bills: the logged actual, else "about" the estimate', () => {
    const logged = sub({ name: 'Hydro', amount: 85, variable: true, anchorDate: '2026-10-10', actuals: [{ date: '2026-10-10', amount: 97.12 }] });
    const guess = sub({ name: 'Gas', amount: 60, variable: true, anchorDate: '2026-10-12', actuals: [{ date: '2026-08-12', amount: 70 }] });
    expect(brief(paidEntries([logged, guess], s, '2026-10-25'))).toEqual([
      ['Gas', '2026-10-12', '2026-10-12', 70, true, false],
      ['Hydro', '2026-10-10', '2026-10-10', 97.12, false, false],
    ]);
    // Marking today's bill paid with what was charged logs it: no longer an estimate.
    const phone = mark(sub({ name: 'Phone', amount: 50, variable: true, anchorDate: '2026-10-25' }), '2026-10-25', 63.4);
    expect(brief(paidEntries([phone], s, '2026-10-25'))[0]).toEqual(['Phone', '2026-10-25', '2026-10-25', 63.4, false, false]);
  });

  it('trials: nothing during the free period; the first paid charge once it passes', () => {
    const t = sub({ name: 'Trial', amount: 12, trialEndDate: '2026-10-28', anchorDate: '2026-10-28', startDate: '2026-10-01' });
    expect(paidEntries([t], s, '2026-10-25')).toEqual([]);
    expect(brief(paidEntries([t], s, '2026-10-29'))).toEqual([['Trial', '2026-10-28', '2026-10-28', 12, false, false]]);
  });

  it('plan instalments: one row each, in the item’s currency, converted for the total', () => {
    const plan = sub({ name: 'Phone plan', amount: 50, currency: 'USD', anchorDate: '2026-09-05', startDate: '2026-09-05', totalPayments: 3 });
    const done = mark(plan, '2026-10-25'); // Nov 5, the last, paid early
    const list = paidEntries([done], s, '2026-10-25');
    expect(brief(list)).toEqual([
      ['Phone plan', '2026-11-05', '2026-10-25', 50, false, true],
      ['Phone plan', '2026-10-05', '2026-10-05', 50, false, false],
    ]);
    expect(list.map((e) => e.homeAmount)).toEqual([70, 70]);
  });

  it('cancelled items: marked payments stay, unmarked charges don’t', () => {
    const marked = { ...mark(sub({ name: 'M', amount: 9, anchorDate: '2026-10-25' }), '2026-10-25'), cancelled: true };
    const unmarked = sub({ name: 'U', amount: 7, anchorDate: '2026-10-03', cancelled: true });
    expect(brief(paidEntries([marked, unmarked], s, '2026-10-25'))).toEqual([['M', '2026-10-25', '2026-10-25', 9, false, false]]);
  });

  it('respects the category filter', () => {
    const cats = [{ id: 'c1', name: 'Streaming' }, { id: 'c2', name: 'Home' }];
    const tv = sub({ name: 'TV', amount: 10, anchorDate: '2026-10-03', categoryIds: ['c1'] });
    const hydro = sub({ name: 'Hydro', amount: 80, anchorDate: '2026-10-04', categoryIds: ['c2'] });
    const none = sub({ name: 'None', amount: 3, anchorDate: '2026-10-05' });
    const all = [tv, hydro, none];
    const m = (id: string | null) => computeMonthTotals(filterByCategory(all, cats, id), s, '2026-10-25');
    expect(m(null).paid.map((e) => e.sub.name)).toEqual(['None', 'Hydro', 'TV']);
    expect(m('c1').paid.map((e) => e.sub.name)).toEqual(['TV']);
    expect(m('c1').paidSoFar).toBe(10);
    expect(m('c2').paidSoFar).toBe(80);
    expect(m(UNCATEGORIZED_ID).paid.map((e) => e.sub.name)).toEqual(['None']);
  });

  it('month boundary: the same instant is October in Toronto and November in UTC', () => {
    const instant = new Date(Date.UTC(2026, 10, 1, 2, 0)); // Oct 31 22:00 in Toronto
    const subs = [sub({ name: 'Oct30', amount: 10, anchorDate: '2026-10-30' }), sub({ name: 'Oct31', amount: 4, anchorDate: '2026-10-31' })];
    const toronto = toLocalDate(instant, 'America/Toronto');
    const utc = toLocalDate(instant, 'UTC');
    expect([toronto, utc]).toEqual(['2026-10-31', '2026-11-01']);
    const oct = computeMonthTotals(subs, s, toronto);
    expect(oct.paid.map((e) => e.sub.name)).toEqual(['Oct30']); // Oct 31 is due today
    expect(oct).toMatchObject({ paidSoFar: 10, stillDue: 4, thisMonth: 14 });
    const nov = computeMonthTotals(subs, s, utc);
    expect(nov.paid).toEqual([]);
    expect(nov).toMatchObject({ paidSoFar: 0, stillDue: 14, thisMonth: 14 }); // Nov 30 and Nov 30 (clamped from 31)
  });

  it('a currency with no rate is listed but left out of the total, and flagged', () => {
    const eur = sub({ name: 'Euro', amount: 9, currency: 'EUR', anchorDate: '2026-10-02' });
    const m = computeMonthTotals([eur], s, '2026-10-25');
    expect(m.paid).toHaveLength(1);
    expect(m.paid[0].homeAmount).toBeNull();
    expect(m.paidSoFar).toBe(0);
    expect(m.missingRate.map((x) => x.name)).toEqual(['Euro']);
  });
});

describe('Paid so far equals the list', () => {
  const portfolio = (): Subscription[] => [
    sub({ name: 'Netflix', amount: 16.49, anchorDate: '2026-11-05' }),
    mark(sub({ name: 'Rogers', amount: 85, promoEndDate: '2027-01-15', regularAmount: 110, anchorDate: '2026-10-15' }), '2026-10-12'),
    mark(sub({ name: 'Spotify', amount: 11.99, anchorDate: '2026-11-02' }), '2026-10-20'),
    sub({ name: 'Hydro', amount: 85, variable: true, anchorDate: '2026-10-10', actuals: [{ date: '2026-10-10', amount: 97.12 }] }),
    sub({ name: 'Gas', amount: 60, variable: true, anchorDate: '2026-10-28' }),
    sub({ name: 'iCloud', amount: 2.99, currency: 'USD', anchorDate: '2026-10-21' }),
    sub({ name: 'Weekly', amount: 7, anchorDate: '2026-10-02', cycle: { unit: 'week', every: 1 } }),
    sub({ name: 'Plan', amount: 50, anchorDate: '2026-08-14', startDate: '2026-08-14', totalPayments: 6 }),
    sub({ name: 'Trial', amount: 12, trialEndDate: '2026-10-30', anchorDate: '2026-10-30' }),
    { ...mark(sub({ name: 'Gone', amount: 9, anchorDate: '2026-11-08' }), '2026-10-05'), cancelled: true },
    sub({ name: 'Euro', amount: 9, currency: 'EUR', anchorDate: '2026-10-02' }),
  ];

  it.each(['2026-10-01', '2026-10-02', '2026-10-12', '2026-10-15', '2026-10-25', '2026-10-31', '2026-11-01', '2026-11-20'])(
    'on %s: paidSoFar = sum of the list, and thisMonth = paidSoFar + stillDue',
    (today) => {
      const m = computeMonthTotals(portfolio(), s, today);
      expect(m.paidSoFar).toBeCloseTo(sum(m.paid), 9);
      expect(m.thisMonth).toBeCloseTo(m.paidSoFar + m.stillDue, 9);
      for (const e of m.paid) {
        expect(e.paidOn <= today).toBe(true);
        expect(e.paidOn.slice(0, 7)).toBe(today.slice(0, 7));
      }
    },
  );

  it('on Oct 25 the figures are what the rows say', () => {
    const m = computeMonthTotals(portfolio(), s, '2026-10-25');
    // Weekly ×4 (Oct 2/9/16/23) 28, Hydro 97.12, Rogers 85 (marked Oct 12), Spotify 11.99 (early),
    // and Oct 2 11.99, iCloud 2.99 USD = 4.186, Plan Oct 14 50, Gone 9 (marked Oct 5, cancelled
    // since), Netflix Oct 5 16.49. Euro has no rate: listed, not added.
    expect(m.paidSoFar).toBeCloseTo(28 + 97.12 + 85 + 11.99 * 2 + 4.186 + 50 + 9 + 16.49, 6);
    expect(m.paid.map((e) => e.sub.name)).toEqual(['Weekly', 'iCloud', 'Spotify', 'Weekly', 'Plan', 'Rogers', 'Hydro', 'Weekly', 'Gone', 'Netflix', 'Euro', 'Spotify', 'Weekly']);
  });
});
