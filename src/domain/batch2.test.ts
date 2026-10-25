/** Category filter, and the review non-blockers T1, T3 and T5 from PR #3. */
import { previewImport } from './csv';
import { settings, sub } from './fixtures';
import { planReminders, remindersFor, TRIAL_CATCH_UP_MS, trialLeadsPassed } from './reminders';
import { computeMonthTotals, computeTotals, filterByCategory } from './totals';
import { UNCATEGORIZED_ID, type Category } from './types';

const cats: Category[] = [
  { id: 'c1', name: 'Streaming' },
  { id: 'c2', name: 'Utilities' },
];

describe('category filter', () => {
  const netflix = sub({ id: 'n', amount: 20, categoryIds: ['c1'] });
  const hydro = sub({ id: 'h', amount: 85, categoryIds: ['c2'], variable: true });
  const both = sub({ id: 'b', amount: 10, categoryIds: ['c1', 'c2'] });
  const loose = sub({ id: 'l', amount: 5, categoryIds: ['gone'] }); // deleted category: Uncategorized
  const trial = sub({ id: 't', amount: 12, categoryIds: ['c1'], trialEndDate: '2026-11-05', anchorDate: '2026-11-05' });
  const plan = sub({ id: 'p', amount: 50, categoryIds: ['c2'], startDate: '2026-06-10', anchorDate: '2026-11-10', totalPayments: 12 });
  const all = [netflix, hydro, both, loose, trial, plan];

  it('All shows everything', () => {
    expect(filterByCategory(all, cats, null)).toHaveLength(6);
  });

  it('shows that category’s subscriptions, trials and plans, multi-category items in each', () => {
    expect(filterByCategory(all, cats, 'c1').map((s) => s.id)).toEqual(['n', 'b', 't']);
    expect(filterByCategory(all, cats, 'c2').map((s) => s.id)).toEqual(['h', 'b', 'p']);
    expect(filterByCategory(all, cats, UNCATEGORIZED_ID).map((s) => s.id)).toEqual(['l']);
  });

  it('the filtered totals equal that category’s row in the full totals', () => {
    const today = '2026-10-25';
    const full = computeTotals(all, cats, settings(), today);
    for (const id of ['c1', 'c2', UNCATEGORIZED_ID]) {
      const only = computeTotals(filterByCategory(all, cats, id), cats, settings(), today);
      expect(only.overall.monthly).toBeCloseTo(full.categories.find((c) => c.id === id)!.monthly, 10);
    }
    const m = computeMonthTotals(filterByCategory(all, cats, 'c2'), settings(), today);
    expect(m.charges.map((c) => c.sub.id).sort()).toEqual(['b', 'h', 'p']);
  });
});

describe('T1: a trial saved too late for its 1-day reminder', () => {
  // Trial ends Nov 15; the 1-day reminder was Nov 14 at 9:00. Saved Nov 14 at 20:00.
  const saved = new Date(2026, 10, 14, 20, 0);
  const late = sub({ id: 't', name: 'Max', trialEndDate: '2026-11-15', anchorDate: '2026-11-15', updatedAt: saved.toISOString() });

  it('gets one notice a minute after the save', () => {
    const [r] = remindersFor(late, settings(), new Date(saved.getTime() + 5_000));
    expect(r).toMatchObject({ kind: 'trial', chargeDate: '2026-11-15', title: 'Max free trial ends tomorrow' });
    expect(r.fireAt.getTime()).toBe(saved.getTime() + TRIAL_CATCH_UP_MS);
    // Stable across syncs (same id), and gone once it has fired: then the next renewal follows.
    expect(remindersFor(late, settings(), new Date(saved.getTime() + 30_000))[0].id).toBe(r.id);
    const after = remindersFor(late, settings(), new Date(saved.getTime() + 2 * TRIAL_CATCH_UP_MS));
    expect(after.map((x) => [x.kind, x.chargeDate])).toEqual([['renewal', '2026-12-15']]);
  });

  it('tells the edit screen when the usual reminders are past (reminder hour 9)', () => {
    const s = settings({ reminderHour: 9 });
    expect(trialLeadsPassed('2026-11-15', s, new Date(2026, 10, 14, 8, 59))).toBe(false);
    expect(trialLeadsPassed('2026-11-15', s, new Date(2026, 10, 14, 9, 0))).toBe(true);
    expect(trialLeadsPassed('2026-11-15', s, new Date(2026, 10, 15, 23, 0))).toBe(true);
    expect(trialLeadsPassed('2026-11-15', s, new Date(2026, 10, 16, 0, 1))).toBe(false);
  });

  it('says "ends today" when saved on the end day', () => {
    const onDay = new Date(2026, 10, 15, 8, 0);
    const s = { ...late, updatedAt: onDay.toISOString(), deadlineSetAt: onDay.toISOString() };
    expect(remindersFor(s, settings(), new Date(onDay.getTime() + 1_000))[0].title).toBe('Max free trial ends today');
  });

  it('does nothing extra when the usual reminders were still ahead at save time, or the trial is over', () => {
    const early = { ...late, updatedAt: new Date(2026, 10, 1, 12).toISOString(), deadlineSetAt: new Date(2026, 10, 1, 12).toISOString() };
    expect(remindersFor(early, settings(), new Date(2026, 10, 14, 20, 1)).map((r) => r.kind)).toEqual(['renewal']);
    const over = { ...late, updatedAt: new Date(2026, 10, 16, 9).toISOString(), deadlineSetAt: new Date(2026, 10, 16, 9).toISOString() };
    expect(remindersFor(over, settings(), new Date(2026, 10, 16, 9, 0, 1)).map((r) => r.kind)).toEqual(['renewal']);
    expect(remindersFor({ ...late, remindersEnabled: false }, settings(), new Date(saved.getTime() + 1_000))).toEqual([]);
  });

  it('takes a slot in the shared budget like any other reminder', () => {
    const plan = planReminders([late, sub({ id: 'x', anchorDate: '2026-12-01' })], settings(), new Date(saved.getTime() + 1_000));
    expect(plan[0]).toMatchObject({ subId: 't', kind: 'trial' });
  });
});

describe('T3: a plan’s first payment date must be on its schedule', () => {
  it('rejects an off-cycle first payment and accepts an on-cycle one', () => {
    const head = 'name,amount,currency,cycle,next charge date,first charge date,total payments\n';
    const p = previewImport(
      `${head}Bad,50,CAD,monthly,2026-11-10,2026-03-15,12\nGood,50,CAD,monthly,2026-11-10,2026-03-10,12\nWeekly,5,CAD,every 2 weeks,2026-11-10,2026-10-20,6\n`,
      [],
    );
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => r.reason)).toEqual([
      "first payment date 2026-03-15 isn't on the monthly schedule of the next charge date",
      undefined,
      "first payment date 2026-10-20 isn't on the every 2 weeks schedule of the next charge date",
    ]);
  });

  it('still allows a first charge date that is off-cycle for an ordinary subscription', () => {
    const p = previewImport('name,amount,currency,cycle,next charge date,first charge date\nA,5,CAD,monthly,2026-11-10,2026-11-03\n', []);
    expect(p.ok && p.rows[0].status).toBe('valid');
  });
});

describe('T5: plans left out of "Left on plans" for a missing rate', () => {
  it('lists them so the card can say so', () => {
    const usd = sub({ id: 'u', currency: 'USD', amount: 50, startDate: '2026-06-10', anchorDate: '2026-11-10', totalPayments: 12 });
    const cad = sub({ id: 'c', amount: 40, startDate: '2026-06-10', anchorDate: '2026-11-10', totalPayments: 12 });
    const t = computeTotals([usd, cad, sub({ id: 'x', currency: 'EUR' })], [], settings(), '2026-10-25');
    expect(t.planCount).toBe(1);
    expect(t.plansMissingRate.map((s) => s.id)).toEqual(['u']);
    expect(t.missingRate.map((s) => s.id)).toEqual(['u', 'x']);
    expect(computeTotals([usd], [], settings({ rates: { USD: 1.4 } }), '2026-10-25').plansMissingRate).toEqual([]);
  });
});
