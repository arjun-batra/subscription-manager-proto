/** Mark as paid (including early), undo, and how paid records feed totals and reminders. */
import { previewImport, toCsv } from './csv';
import { sub, settings } from './fixtures';
import { keepPayments, markNextPaid, undoablePayment, unmarkPaid } from './payments';
import { nextDeadlineStamp, nextReminder, planReminders, remindersFor } from './reminders';
import { amountForCharge, isCompleted, nextDue, planStatus } from './schedule';
import { computeMonthTotals } from './totals';
import type { Subscription } from './types';

const NOW = '2026-10-25T14:00:00.000Z';
const now = new Date(2026, 9, 25, 10, 0); // Oct 25 2026, 10:00 local
const mark = (s: Subscription, today: string, actual?: number) => {
  const r = markNextPaid(s, today, { actual, now: NOW });
  if (!r) throw new Error('nothing to mark');
  return r;
};

describe('nextDue and marking paid', () => {
  const netflix = () => sub({ id: 'n', name: 'Netflix', amount: 16.49, anchorDate: '2026-11-05' });

  it('the next due charge is today’s until it is marked, then the following one', () => {
    expect(nextDue(netflix(), '2026-11-05')).toBe('2026-11-05');
    const r = mark(netflix(), '2026-11-05');
    expect(r).toMatchObject({ date: '2026-11-05', early: false });
    expect(r.sub.payments).toEqual([{ date: '2026-11-05', paidOn: '2026-11-05', amount: 16.49 }]);
    expect(nextDue(r.sub, '2026-11-05')).toBe('2026-12-05');
  });

  it('paying early advances the next due date, and again for the one after', () => {
    const once = mark(netflix(), '2026-10-25');
    expect(once).toMatchObject({ date: '2026-11-05', early: true });
    expect(nextDue(once.sub, '2026-10-25')).toBe('2026-12-05');
    const twice = mark(once.sub, '2026-10-25');
    expect(twice.date).toBe('2026-12-05');
    expect(nextDue(twice.sub, '2026-10-25')).toBe('2027-01-05');
    expect(twice.sub.updatedAt).toBe(NOW);
  });

  it('undo removes the record and the due date comes back', () => {
    const r = mark(netflix(), '2026-10-25');
    expect(undoablePayment(r.sub, '2026-10-25')).toMatchObject({ date: '2026-11-05' });
    const back = unmarkPaid(r.sub, '2026-11-05', NOW);
    expect(back.payments).toEqual([]);
    expect(nextDue(back, '2026-10-25')).toBe('2026-11-05');
    // Undoing something that isn't marked changes nothing.
    expect(unmarkPaid(back, '2026-11-05')).toBe(back);
  });

  it('undo targets the latest upcoming mark; past ones are history', () => {
    const s = sub({
      anchorDate: '2026-11-05',
      payments: [
        { date: '2026-10-05', paidOn: '2026-10-05', amount: 10 },
        { date: '2026-11-05', paidOn: '2026-10-20', amount: 10 },
        { date: '2026-12-05', paidOn: '2026-10-21', amount: 10 },
      ],
    });
    expect(undoablePayment(s, '2026-10-25')?.date).toBe('2026-12-05');
    expect(undoablePayment(sub({ payments: [{ date: '2026-10-05', paidOn: '2026-10-05', amount: 10 }] }), '2026-10-25')).toBeNull();
  });

  it('a cancelled item, or a plan with nothing left, has nothing to mark', () => {
    expect(markNextPaid(sub({ cancelled: true }), '2026-10-25')).toBeNull();
    const plan = sub({ amount: 50, anchorDate: '2026-09-05', startDate: '2026-09-05', totalPayments: 3 });
    expect(markNextPaid(plan, '2026-12-01')).toBeNull(); // past the last payment (Nov 5)
  });

  it('plans: paying the rest early completes the plan; undo reopens it', () => {
    const plan = sub({ id: 'p', amount: 50, anchorDate: '2026-09-05', startDate: '2026-09-05', totalPayments: 4 }); // Sep 5 .. Dec 5
    expect(planStatus(plan, '2026-10-25')).toMatchObject({ paid: 2, remaining: 2 });
    const a = mark(plan, '2026-10-25');
    expect(planStatus(a.sub, '2026-10-25')).toMatchObject({ paid: 3, remaining: 1, remainingAmount: 50, completed: false });
    const b = mark(a.sub, '2026-10-25');
    expect(b.date).toBe('2026-12-05');
    expect(planStatus(b.sub, '2026-10-25')).toMatchObject({ paid: 4, remaining: 0, completed: true });
    expect(isCompleted(b.sub, '2026-10-25')).toBe(true);
    expect(nextDue(b.sub, '2026-10-25')).toBeNull();
    expect(markNextPaid(b.sub, '2026-10-25')).toBeNull();
    expect(isCompleted(unmarkPaid(b.sub, '2026-12-05'), '2026-10-25')).toBe(false);
  });

  describe('variable bills', () => {
    const hydro = (over: Partial<Subscription> = {}) =>
      sub({ id: 'h', name: 'Hydro', amount: 85, variable: true, anchorDate: '2026-10-25', cycle: { unit: 'month', every: 2 }, ...over });

    it('marking a charge due today can capture the actual; undo removes both', () => {
      const r = mark(hydro(), '2026-10-25', 91.3);
      expect(r.sub.actuals).toEqual([{ date: '2026-10-25', amount: 91.3 }]);
      expect(r.sub.payments).toEqual([{ date: '2026-10-25', paidOn: '2026-10-25', amount: 91.3, loggedActual: true }]);
      expect(amountForCharge(r.sub, '2026-10-25')).toBe(91.3);
      const back = unmarkPaid(r.sub, '2026-10-25');
      expect(back.actuals).toEqual([]);
      expect(back.payments).toEqual([]);
    });

    it('skipping the amount uses the estimate; an actual logged before stays after undo', () => {
      const logged = hydro({ actuals: [{ date: '2026-10-25', amount: 70 }] });
      const r = mark(logged, '2026-10-25');
      expect(r.sub.payments).toEqual([{ date: '2026-10-25', paidOn: '2026-10-25', amount: 70 }]);
      const r2 = mark(logged, '2026-10-25', 72);
      expect(r2.sub.payments![0].loggedActual).toBeUndefined();
      expect(unmarkPaid(r2.sub, '2026-10-25').actuals).toEqual([{ date: '2026-10-25', amount: 72 }]);
      const est = mark(hydro(), '2026-10-25');
      expect(est.sub.payments![0].amount).toBe(85);
      expect(est.sub.actuals).toEqual([]);
    });

    it('paying early keeps the amount on the record, not as an actual for a future charge', () => {
      const r = mark(hydro(), '2026-10-24', 90);
      expect(r.early).toBe(true);
      expect(r.sub.actuals).toEqual([]);
      expect(r.sub.payments).toEqual([{ date: '2026-10-25', paidOn: '2026-10-24', amount: 90 }]);
      expect(amountForCharge(r.sub, '2026-10-25')).toBe(90);
      // CSV round trip keeps it (actuals in the future would be rejected; payments are fine).
      const p = previewImport(toCsv([r.sub], []), [], '2026-10-24');
      if (!p.ok) throw new Error(p.error);
      expect(p.rows[0]).toMatchObject({ status: 'valid' });
      expect(p.rows[0].draft!.payments).toEqual([{ date: '2026-10-25', paidOn: '2026-10-24', amount: 90 }]);
    });
  });

  it('a schedule edit keeps only marks that are still on charge dates', () => {
    const s = sub({ anchorDate: '2026-11-07', payments: [{ date: '2026-11-05', paidOn: '2026-10-25', amount: 10 }, { date: '2026-12-07', paidOn: '2026-10-25', amount: 10 }] });
    expect(keepPayments(s)).toEqual({ payments: [{ date: '2026-12-07', paidOn: '2026-10-25', amount: 10 }], dropped: ['2026-11-05'] });
  });
});

describe('paid so far (cash out this month)', () => {
  const s = settings({ rates: { USD: 1.4 } });

  it('fixed: past charges count on their date, marked ones on the day paid', () => {
    const a = sub({ id: 'a', amount: 10, anchorDate: '2026-10-05' }); // Oct 5: past
    const b = sub({ id: 'b', amount: 20, anchorDate: '2026-10-28' }); // Oct 28: still due
    const m = computeMonthTotals([a, b], s, '2026-10-25');
    expect(m).toMatchObject({ thisMonth: 30, stillDue: 20, paidSoFar: 10 });
    const paid = mark(b, '2026-10-25').sub;
    expect(computeMonthTotals([a, paid], s, '2026-10-25')).toMatchObject({ thisMonth: 30, stillDue: 0, paidSoFar: 30 });
  });

  it('paying next month’s charge early counts in this month, not next month', () => {
    const n = sub({ id: 'n', amount: 16, anchorDate: '2026-11-05' });
    const early = mark(n, '2026-10-25').sub;
    const oct = computeMonthTotals([early], s, '2026-10-25');
    expect(oct).toMatchObject({ thisMonth: 32, stillDue: 0, paidSoFar: 32 }); // Oct 5 + Nov 5 paid early
    const nov = computeMonthTotals([early], s, '2026-11-02');
    expect(nov).toMatchObject({ thisMonth: 0, stillDue: 0, paidSoFar: 0, paid: [] }); // paid in October
    const novLater = computeMonthTotals([early], s, '2026-11-10');
    expect(novLater.paidSoFar).toBe(0);
  });

  it('variable bills: the logged actual when there is one, else the estimate', () => {
    const hydro = sub({ id: 'h', amount: 85, variable: true, anchorDate: '2026-10-10', actuals: [{ date: '2026-08-10', amount: 80 }, { date: '2026-10-10', amount: 97 }] });
    expect(computeMonthTotals([hydro], s, '2026-10-25').paidSoFar).toBe(97);
    const noActual = sub({ id: 'h2', amount: 85, variable: true, anchorDate: '2026-10-10', actuals: [{ date: '2026-08-10', amount: 80 }] });
    expect(computeMonthTotals([noActual], s, '2026-10-25').paidSoFar).toBe(80); // estimate = average of actuals
  });

  it('trials: nothing until converted, then the post-trial price', () => {
    const t = sub({ id: 't', amount: 12, trialEndDate: '2026-10-28', anchorDate: '2026-10-28' });
    expect(computeMonthTotals([t], s, '2026-10-25')).toMatchObject({ paidSoFar: 0, stillDue: 12 });
    expect(computeMonthTotals([t], s, '2026-10-29')).toMatchObject({ paidSoFar: 12, stillDue: 0 });
    const early = mark(t, '2026-10-25').sub; // kept on purpose and paid
    expect(computeMonthTotals([early], s, '2026-10-25').paidSoFar).toBe(12);
  });

  it('plans count each instalment; foreign currency is converted to CA$', () => {
    const plan = sub({ id: 'p', amount: 50, currency: 'USD', anchorDate: '2026-09-05', startDate: '2026-09-05', totalPayments: 3 });
    expect(computeMonthTotals([plan], s, '2026-10-25').paidSoFar).toBeCloseTo(70);
    const done = mark(plan, '2026-10-25').sub; // Nov 5, the last one, paid early
    expect(computeMonthTotals([done], s, '2026-10-25').paidSoFar).toBeCloseTo(140);
  });

  it('a payment marked on an item that was later cancelled still counts as money paid', () => {
    const paid = { ...mark(sub({ id: 'c', amount: 9, anchorDate: '2026-11-05' }), '2026-10-25').sub, cancelled: true };
    expect(computeMonthTotals([paid], s, '2026-10-25')).toMatchObject({ thisMonth: 9, stillDue: 0, paidSoFar: 9 });
  });

  it('marks paid in an earlier month are not counted this month', () => {
    const x = sub({ id: 'x', amount: 10, anchorDate: '2026-10-05', payments: [{ date: '2026-10-05', paidOn: '2026-09-30', amount: 10 }] });
    expect(computeMonthTotals([x], s, '2026-10-25')).toMatchObject({ paidSoFar: 0, stillDue: 0, thisMonth: 0, paid: [] });
  });
});

describe('reminders skip charges marked paid', () => {
  it('paying early drops that charge’s reminder and moves to the next one', () => {
    const n = sub({ id: 'n', name: 'Netflix', anchorDate: '2026-11-05' });
    expect(nextReminder(n, settings(), now)?.chargeDate).toBe('2026-11-05');
    const paid = mark(n, '2026-10-25').sub;
    expect(nextReminder(paid, settings(), now)?.chargeDate).toBe('2026-12-05');
    // Undo brings it back (same deterministic id as before).
    expect(nextReminder(unmarkPaid(paid, '2026-11-05'), settings(), now)?.id).toBe(nextReminder(n, settings(), now)?.id);
  });

  it('several charges paid ahead are all skipped', () => {
    let s = sub({ id: 'w', cycle: { unit: 'week', every: 1 }, anchorDate: '2026-10-27' });
    for (let i = 0; i < 5; i += 1) s = mark(s, '2026-10-25').sub;
    expect(nextReminder(s, settings(), now)?.chargeDate).toBe('2026-12-01');
  });

  it('a plan paid off early has no reminders left', () => {
    let plan = sub({ id: 'p', amount: 50, anchorDate: '2026-09-05', startDate: '2026-09-05', totalPayments: 3 });
    plan = mark(plan, '2026-10-25').sub;
    expect(remindersFor(plan, settings(), now)).toEqual([]);
  });

  it('a trial whose first charge is marked paid gets no "cancel before" reminders', () => {
    const t = sub({ id: 't', name: 'Crave', trialEndDate: '2026-11-05', anchorDate: '2026-11-05' });
    expect(remindersFor(t, settings(), now).map((r) => r.kind)).toEqual(['trial', 'trial']);
    const kept = mark(t, '2026-10-25').sub;
    const after = planReminders([kept], settings(), now);
    expect(after.map((r) => r.kind)).toEqual(['renewal']);
    expect(after[0].chargeDate).toBe('2026-12-05');
  });
});

describe('marking paid never resends a deadline catch-up (keyed on deadlineSetAt, not updatedAt)', () => {
  const s0 = settings();
  // Cancel-by tomorrow, set this morning after both lead reminders' times: one catch-up a minute later.
  const setAt = new Date(2026, 9, 25, 9, 30).toISOString();
  const gym = sub({ id: 'g', name: 'Gym', anchorDate: '2026-10-25', cancelByDate: '2026-10-26', updatedAt: setAt, deadlineSetAt: setAt });

  it('the catch-up fires once after the deadline is set', () => {
    const rs = remindersFor(gym, s0, new Date(2026, 9, 25, 9, 30, 30));
    expect(rs.filter((r) => r.kind === 'cancelBy').map((r) => r.title)).toEqual(['Cancel Gym by tomorrow']);
  });

  it('marking or undoing a payment later the same day schedules no new cancel-by reminder', () => {
    const later = new Date(2026, 9, 25, 15, 0);
    const paid = markNextPaid(gym, '2026-10-25', { now: later.toISOString() })!.sub;
    expect(paid.updatedAt).toBe(later.toISOString());
    expect(paid.deadlineSetAt).toBe(setAt);
    expect(remindersFor(paid, s0, new Date(later.getTime() + 1_000)).filter((r) => r.kind === 'cancelBy')).toEqual([]);
    const undone = unmarkPaid(paid, '2026-10-25', new Date(2026, 9, 25, 15, 5).toISOString());
    expect(remindersFor(undone, s0, new Date(2026, 9, 25, 15, 5, 1)).filter((r) => r.kind === 'cancelBy')).toEqual([]);
  });

  it('the same for a trial ending tomorrow (the PR #4 T1 case): only a changed trial end resends', () => {
    const t = sub({ id: 't', name: 'Crave', trialEndDate: '2026-10-26', anchorDate: '2026-10-26', updatedAt: setAt, deadlineSetAt: setAt });
    const edited = { ...t, notes: 'family', updatedAt: new Date(2026, 9, 25, 15).toISOString() };
    const stamped = { ...edited, deadlineSetAt: nextDeadlineStamp(t, edited, edited.updatedAt) };
    expect(stamped.deadlineSetAt).toBe(setAt);
    expect(remindersFor(stamped, s0, new Date(2026, 9, 25, 15, 0, 1)).filter((r) => r.kind === 'trial')).toEqual([]);
  });
});

describe('nextDeadlineStamp', () => {
  const now = '2026-10-25T19:00:00.000Z';
  const old = '2026-10-01T12:00:00.000Z';
  const base = sub({ cancelByDate: '2026-11-20', deadlineSetAt: old });
  it.each<[string, Subscription | null, Subscription, string | null]>([
    ['a new item with a deadline', null, base, now],
    ['a new item without one', null, sub({ deadlineSetAt: null }), null],
    ['an unrelated edit', base, { ...base, notes: 'x', amount: 12 }, old],
    ['a moved cancel-by date', base, { ...base, cancelByDate: '2026-11-21' }, now],
    ['a new trial end', base, { ...base, trialEndDate: '2026-11-05', anchorDate: '2026-11-05' }, now],
    ['a new promo end', base, { ...base, promoEndDate: '2027-01-05', regularAmount: 20 }, now],
    ['un-cancelling', { ...base, cancelled: true }, base, now],
    ['turning reminders back on', { ...base, remindersEnabled: false }, base, now],
    ['removing the last deadline', base, { ...base, cancelByDate: null }, null],
  ])('%s', (_label, prev, next, want) => {
    expect(nextDeadlineStamp(prev, next, now)).toBe(want);
  });
});
