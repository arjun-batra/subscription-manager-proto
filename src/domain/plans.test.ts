import { previewImport, toCsv } from './csv';
import { sub, settings } from './fixtures';
import { diffReminders, nextReminder, planReminders, remindersFor } from './reminders';
import {
  chargesBetween,
  isCompleted,
  lastPaymentDate,
  planEndDate,
  planFromInputs,
  planStatus,
  upcomingCharge,
} from './schedule';
import { computeMonthTotals, computeTotals } from './totals';

// A phone: $50 a month, 12 payments, first on Jun 10 2026, last on May 10 2027.
const phone = (over: Parameters<typeof sub>[0] = {}) =>
  sub({ id: 'p', name: 'Phone', amount: 50, anchorDate: '2026-11-10', startDate: '2026-06-10', totalPayments: 12, ...over });
const now = new Date(2026, 9, 25, 10, 0); // Oct 25 2026, 10:00 local

describe('instalment plans', () => {
  it('builds the stored fields from next payment, payments made and a count', () => {
    expect(planFromInputs({ nextPayment: '2026-11-10', cycle: { unit: 'month', every: 1 }, paymentsMade: 5, totalPayments: 12 })).toEqual({
      anchorDate: '2026-11-10',
      startDate: '2026-06-10',
      totalPayments: 12,
    });
  });

  it('or from a last payment date', () => {
    expect(
      planFromInputs({ nextPayment: '2026-11-10', cycle: { unit: 'month', every: 1 }, paymentsMade: 5, lastPayment: '2027-05-10' }),
    ).toMatchObject({ totalPayments: 12 });
    // A date between payments rounds down to the last payment on or before it.
    expect(
      planFromInputs({ nextPayment: '2026-11-10', cycle: { unit: 'month', every: 1 }, paymentsMade: 0, lastPayment: '2027-01-20' }),
    ).toMatchObject({ totalPayments: 3 });
  });

  it('rejects inputs with nothing left to pay or nonsense counts', () => {
    const base = { nextPayment: '2026-11-10', cycle: { unit: 'month' as const, every: 1 } };
    expect(planFromInputs({ ...base, paymentsMade: 12, totalPayments: 12 })).toBeNull();
    expect(planFromInputs({ ...base, paymentsMade: -1, totalPayments: 12 })).toBeNull();
    expect(planFromInputs({ ...base, paymentsMade: 0, totalPayments: 1.5 })).toBeNull();
    expect(planFromInputs({ ...base, paymentsMade: 0, totalPayments: 1001 })).toBeNull();
    expect(planFromInputs({ ...base, paymentsMade: 0, lastPayment: '2026-11-01' })).toBeNull();
  });

  it('keeps month-end days when counting back (Jan 31 with 2 made starts Nov 30)', () => {
    const f = planFromInputs({ nextPayment: '2027-01-31', cycle: { unit: 'month', every: 1 }, paymentsMade: 2, totalPayments: 4 })!;
    const s = sub({ ...f, cycle: { unit: 'month', every: 1 } });
    expect(chargesBetween(s, '2026-01-01', '2027-12-31')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  });

  it('shows N of M paid and what is left', () => {
    expect(planStatus(phone(), '2026-10-25')).toEqual({
      total: 12,
      paid: 5,
      remaining: 7,
      remainingAmount: 350,
      lastPayment: '2027-05-10',
      completed: false,
    });
    // A payment due today is still due.
    expect(planStatus(phone(), '2026-11-10')!.paid).toBe(5);
    expect(planStatus(phone(), '2026-11-11')!.paid).toBe(6);
    expect(planStatus(sub(), '2026-10-25')).toBeNull();
  });

  it('stops after the last payment and shows as completed', () => {
    expect(planEndDate(phone())).toBe('2027-05-10');
    expect(chargesBetween(phone(), '2027-04-01', '2027-12-31')).toEqual(['2027-04-10', '2027-05-10']);
    expect(upcomingCharge(phone(), '2027-05-10')).toBe('2027-05-10');
    expect(upcomingCharge(phone(), '2027-05-11')).toBeNull();
    expect(isCompleted(phone(), '2027-05-10')).toBe(false);
    expect(isCompleted(phone(), '2027-05-11')).toBe(true);
    expect(planStatus(phone(), '2027-06-01')).toMatchObject({ paid: 12, remaining: 0, remainingAmount: 0, completed: true });
  });

  it('counts in this month, still due and paid so far, and not after it ends', () => {
    const nov = computeMonthTotals([phone()], settings(), '2026-11-15');
    expect([nov.thisMonth, nov.stillDue, nov.paidSoFar]).toEqual([50, 0, 50]);
    expect(computeMonthTotals([phone()], settings(), '2026-11-01').stillDue).toBe(50);
    expect(computeMonthTotals([phone()], settings(), '2027-06-15').thisMonth).toBe(0);
    // The month of the last payment still shows it as paid.
    expect(computeMonthTotals([phone()], settings(), '2027-05-20').paidSoFar).toBe(50);
  });

  it('counts in the averages while unfinished, and reports what is left', () => {
    const t = computeTotals([phone(), sub({ amount: 10 })], [], settings(), '2026-10-25');
    expect(t.overall.monthly).toBeCloseTo(60);
    expect(t.plansRemaining).toBe(350);
    expect(t.planCount).toBe(1);
    const done = computeTotals([phone()], [], settings(), '2027-06-01');
    expect(done.overall).toEqual({ monthly: 0, yearly: 0, count: 0 });
    expect(done.planCount).toBe(0);
  });

  it('converts what is left with the exchange rate', () => {
    const t = computeTotals([phone({ currency: 'USD' })], [], settings({ rates: { USD: 1.4 } }), '2026-10-25');
    expect(t.plansRemaining).toBeCloseTo(490);
  });
});

describe('plan reminders', () => {
  it('reminds before each payment with N of M and what is left', () => {
    const r = nextReminder(phone(), settings(), now)!;
    expect(r.kind).toBe('payment');
    expect(r.id).toMatch(/^pay:p:2026-11-10:/);
    expect(r.fireAt).toEqual(new Date(2026, 10, 8, 9, 0));
    expect(r.title).toBe('Phone payment 6 of 12 due in 2 days');
    expect(r.body).toBe('CA$50.00 on 2026-11-10. CA$300.00 left after this.');
  });

  it('says "Last payment" for the last one, then nothing more', () => {
    const r = nextReminder(phone(), settings(), new Date(2027, 3, 20, 10))!;
    expect(r.chargeDate).toBe('2027-05-10');
    expect(r.title).toBe('Phone payment 12 of 12 due in 2 days');
    expect(r.body).toBe('CA$50.00 on 2027-05-10. Last payment.');
    expect(nextReminder(phone(), settings(), new Date(2027, 4, 9, 10))).toBeNull();
    expect(remindersFor(phone(), settings(), new Date(2027, 5, 1))).toEqual([]);
  });

  it('cancels the pending reminder when a plan is edited to end sooner or is cancelled', () => {
    const pending = planReminders([phone()], settings(), now).map((r) => r.id);
    const shorter = planReminders([phone({ totalPayments: 8 })], settings(), now);
    expect(diffReminders(shorter, pending).toCancel).toEqual(pending); // "6 of 8" replaces "6 of 12"
    expect(diffReminders(planReminders([phone({ cancelled: true })], settings(), now), pending).toCancel).toEqual(pending);
  });
});

describe('reminder ownership', () => {
  it('cancels stale trial: and pay: ids but never the test notification or foreign ids', () => {
    const d = diffReminders([], ['trial:x:1', 'pay:y:2', 'renew:z:3', 'test-notification', 'other']);
    expect(d.toCancel).toEqual(['trial:x:1', 'pay:y:2', 'renew:z:3']);
  });
});

describe('last payment date for the edit-screen preview', () => {
  it('counts from the anchor, so month-end plans keep the 31st', () => {
    // Anchor Jan 31, first payment Nov 30, 4 payments: Nov 30, Dec 31, Jan 31, Feb 28.
    expect(lastPaymentDate('2027-01-31', { unit: 'month', every: 1 }, '2026-11-30', 3)).toBe('2027-01-31');
    expect(lastPaymentDate('2027-01-31', { unit: 'month', every: 1 }, '2026-11-30', 4)).toBe('2027-02-28');
  });
});

describe('plans in CSV', () => {
  it('round-trips total payments and the first payment date', () => {
    const p = previewImport(toCsv([phone()], []), []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows[0].draft).toMatchObject({ totalPayments: 12, startDate: '2026-06-10', anchorDate: '2026-11-10', trialEndDate: null });
  });

  it('rejects bad counts and a plan with a trial', () => {
    const head = 'name,amount,currency,cycle,next charge date,total payments,trial end date\n';
    const p = previewImport(`${head}A,5,CAD,monthly,2026-11-05,0,\nB,5,CAD,monthly,2026-11-05,2.5,\nC,5,CAD,monthly,2026-11-05,3,2026-11-05\n`, []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => r.reason)).toEqual([
      'total payments must be a whole number from 1 to 1000',
      'total payments must be a whole number from 1 to 1000',
      "a payment plan can't have a free trial",
    ]);
  });

  it('treats the next charge date as the first payment when no first charge date is given', () => {
    const p = previewImport('name,amount,currency,cycle,next charge date,total payments\nLaptop,100,CAD,monthly,2026-11-05,3\n', []);
    if (!p.ok) throw new Error(p.error);
    const d = p.rows[0].draft!;
    const s = sub({ ...d, categoryIds: [] });
    expect(chargesBetween(s, '2026-01-01', '2027-12-31')).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
  });
});
