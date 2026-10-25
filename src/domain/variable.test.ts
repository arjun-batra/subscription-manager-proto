import { formatActuals, parseActualsCell, previewImport, toCsv } from './csv';
import { settings, sub } from './fixtures';
import { planReminders } from './reminders';
import {
  amountForCharge,
  ESTIMATE_WINDOW,
  expectedAmount,
  isVariable,
  pastCharges,
  withActual,
  withoutActual,
} from './schedule';
import { computeMonthTotals, computeTotals } from './totals';

// Hydro: every month on the 20th, estimate CA$85.
const hydro = (over: Parameters<typeof sub>[0] = {}) =>
  sub({ id: 'h', name: 'Hydro', amount: 85, anchorDate: '2026-11-20', variable: true, ...over });

describe('variable bills', () => {
  it('uses the estimate until actuals are logged', () => {
    expect(isVariable(hydro())).toBe(true);
    expect(expectedAmount(hydro())).toBe(85);
    expect(computeTotals([hydro()], [], settings(), '2026-10-25').overall.monthly).toBe(85);
  });

  it('averages the last 3 actuals (fewer if fewer exist), by date not by entry order', () => {
    expect(ESTIMATE_WINDOW).toBe(3);
    let h = withActual(hydro(), '2026-10-20', 90);
    expect(expectedAmount(h)).toBe(90);
    h = withActual(h, '2026-08-20', 70);
    expect(expectedAmount(h)).toBe(80);
    h = withActual(h, '2026-09-20', 110);
    h = withActual(h, '2026-07-20', 1000); // oldest: outside the window
    expect(expectedAmount(h)).toBeCloseTo((70 + 110 + 90) / 3, 10);
    // Logging the same charge again replaces it.
    h = withActual(h, '2026-10-20', 120);
    expect(h.actuals!.filter((a) => a.date === '2026-10-20')).toEqual([{ date: '2026-10-20', amount: 120 }]);
    expect(expectedAmount(h)).toBeCloseTo((70 + 110 + 120) / 3, 10);
    expect(expectedAmount(withoutActual(h, '2026-10-20'))).toBeCloseTo((1000 + 70 + 110) / 3, 10);
  });

  it('uses the new estimate for the averages', () => {
    const h = withActual(withActual(hydro(), '2026-09-20', 80), '2026-10-20', 100);
    const t = computeTotals([h], [], settings(), '2026-10-25');
    expect(t.overall.monthly).toBe(90);
    expect(t.overall.yearly).toBe(1080);
  });

  it('paid so far uses the logged actual, still due uses the estimate', () => {
    // Twice a month (1st and 15th... as two items is clumsy), so use a 2-week cycle anchored Nov 2.
    const h = hydro({ cycle: { unit: 'week', every: 2 }, anchorDate: '2026-11-02', actuals: [{ date: '2026-10-19', amount: 60 }] });
    // Nov charges: 2, 16, 30. Log the Nov 2 actual: 100.
    const logged = withActual(h, '2026-11-02', 100);
    const m = computeMonthTotals([logged], settings(), '2026-11-10');
    // Estimate = avg(60, 100) = 80. Paid: 100 (actual). Still due: Nov 16 + Nov 30 at 80.
    expect(m.paidSoFar).toBe(100);
    expect(m.stillDue).toBe(160);
    expect(m.thisMonth).toBe(260);
    // A past charge with nothing logged counts at the estimate.
    const m2 = computeMonthTotals([h], settings(), '2026-11-10');
    expect(m2.paidSoFar).toBe(60);
  });

  it('a logged actual for a past charge counts, a fixed item ignores actuals', () => {
    const h = hydro({ actuals: [{ date: '2026-10-20', amount: 70 }] });
    expect(amountForCharge(h, '2026-10-20')).toBe(70);
    expect(amountForCharge(h, '2026-11-20')).toBe(70); // the estimate is now the 1 actual
    const fixed = sub({ amount: 10, actuals: [{ date: '2026-10-05', amount: 99 }] });
    expect(amountForCharge(fixed, '2026-10-05')).toBe(10);
    expect(expectedAmount(fixed)).toBe(10);
    // Plans never vary.
    expect(isVariable(sub({ variable: true, totalPayments: 3, startDate: '2026-11-05' }))).toBe(false);
  });

  it('converts with the exchange rate and reports a missing one', () => {
    const usd = hydro({ currency: 'USD', actuals: [{ date: '2026-10-20', amount: 100 }] });
    expect(computeTotals([usd], [], settings({ rates: { USD: 1.4 } }), '2026-10-25').overall.monthly).toBeCloseTo(140, 10);
    expect(computeTotals([usd], [], settings(), '2026-10-25').missingRate.map((s) => s.id)).toEqual(['h']);
  });

  it('lists recent past charges to log against, newest first, not before the first charge', () => {
    expect(pastCharges(hydro(), '2026-10-25', 3)).toEqual(['2026-10-20', '2026-09-20', '2026-08-20']);
    expect(pastCharges(hydro(), '2026-10-20', 1)).toEqual(['2026-10-20']); // today's charge counts
    expect(pastCharges(hydro({ startDate: '2026-09-20' }), '2026-10-25', 5)).toEqual(['2026-10-20', '2026-09-20']);
    expect(pastCharges(hydro({ startDate: '2026-11-20' }), '2026-10-25', 5)).toEqual([]);
  });

  it('keeps reminders the same, with "about" and the current estimate in the text', () => {
    const now = new Date(2026, 9, 25, 10, 0);
    const [r] = planReminders([hydro({ actuals: [{ date: '2026-10-20', amount: 91.5 }] })], settings(), now);
    expect(r.kind).toBe('renewal');
    expect(r.chargeDate).toBe('2026-11-20');
    expect(r.title).toBe('Hydro renews in 2 days');
    expect(r.body).toBe('about CA$91.50 on 2026-11-20');
    // A changed estimate changes the id, so the diff replaces the pending one.
    const [r2] = planReminders([hydro({ actuals: [{ date: '2026-10-20', amount: 80 }] })], settings(), now);
    expect(r2.id).not.toBe(r.id);
    expect(r2.fireAt.getTime()).toBe(r.fireAt.getTime());
  });
});

describe('variable bills in CSV', () => {
  it('round-trips varies and the actuals column', () => {
    const h = hydro({ actuals: [{ date: '2026-10-20', amount: 91.3 }, { date: '2026-09-20', amount: 84.12 }] });
    const csv = toCsv([h, sub({ name: 'Fixed' })], []);
    expect(csv.split('\r\n')[1]).toContain(',yes,2026-09-20=84.12; 2026-10-20=91.3');
    const p = previewImport(csv, []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows[0].draft).toMatchObject({ variable: true, amount: 85, actuals: [{ date: '2026-09-20', amount: 84.12 }, { date: '2026-10-20', amount: 91.3 }] });
    expect(p.rows[1].draft).toMatchObject({ variable: false, actuals: [] });
  });

  it('encodes and parses the compact actuals cell', () => {
    expect(formatActuals([{ date: '2026-10-20', amount: 9 }, { date: '2026-09-20', amount: 8.5 }])).toBe('2026-09-20=8.5; 2026-10-20=9');
    expect(parseActualsCell(' 2026-09-20 = 8.5 ;2026-10-20=9; ')).toEqual({ actuals: [{ date: '2026-09-20', amount: 8.5 }, { date: '2026-10-20', amount: 9 }] });
    expect(parseActualsCell('')).toEqual({ actuals: [] });
    expect(parseActualsCell('2026-09-20=-1')).toHaveProperty('error');
    expect(parseActualsCell('2026-02-30=5')).toHaveProperty('error');
    expect(parseActualsCell('2026-09-20=5; 2026-09-20=6')).toEqual({ error: 'actuals list 2026-09-20 twice' });
  });

  it('rejects bad varies values, actuals without varies, off-schedule actuals and varying plans', () => {
    const head = 'name,amount,currency,cycle,next charge date,total payments,varies,actuals\n';
    const p = previewImport(
      head +
        'A,85,CAD,monthly,2026-11-20,,maybe,\n' +
        'B,85,CAD,monthly,2026-11-20,,,2026-10-20=90\n' +
        'C,85,CAD,monthly,2026-11-20,,yes,2026-10-21=90\n' +
        'D,85,CAD,monthly,2026-11-20,12,yes,\n' +
        'E,85,CAD,monthly,2026-11-20,,yes,oops\n',
      [],
    );
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => r.reason)).toEqual([
      'varies must be yes or no',
      'actuals need varies set to yes',
      "actual for 2026-10-21 isn't a charge date",
      "a payment plan's payments can't vary",
      'actuals must look like 2026-09-01=84.12; “oops” doesn’t',
    ]);
  });

  it('keeps the formula guard for the new columns', () => {
    const p = previewImport("name,amount,currency,cycle,next charge date,varies\n'=1+1,5,CAD,monthly,2026-11-20,yes\n", []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows[0].draft).toMatchObject({ name: '=1+1', variable: true });
    expect(toCsv([hydro({ name: '=1+1' })], []).split('\r\n')[1].startsWith("'=1+1")).toBe(true);
  });
});
