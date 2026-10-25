/** Promo-end prices and cancel-by deadlines: projection, reminders, priority, CSV, home rows. */
import { previewImport, toCsv } from './csv';
import { sub, settings } from './fixtures';
import { cancelByReminders, planReminders, promoEndReminders, remindersFor } from './reminders';
import { amountForCharge, hasPromo, priceOn } from './schedule';
import { computeMonthTotals, computeTotals, monthlyEquivalent } from './totals';
import { deadlineRows, rowNotes, upcomingRow } from '../ui/rows';

const now = new Date(2026, 9, 25, 10, 0); // Oct 25 2026, 10:00 local
const rogers = (over: Parameters<typeof sub>[0] = {}) =>
  sub({ id: 'r', name: 'Rogers', amount: 55, anchorDate: '2026-11-15', promoEndDate: '2027-03-15', regularAmount: 75, ...over });

describe('promo price ends', () => {
  it('charges before the end date are at the promo price, from it on at the regular price', () => {
    const r = rogers();
    expect(hasPromo(r)).toBe(true);
    expect(priceOn(r, '2027-02-15')).toBe(55);
    expect(priceOn(r, '2027-03-15')).toBe(75);
    expect(amountForCharge(r, '2027-04-15')).toBe(75);
    expect(monthlyEquivalent(r, '2026-10-25')).toBe(55);
    expect(monthlyEquivalent(r, '2027-03-15')).toBe(75);
  });

  it('only fixed, non-plan items with both fields have a promo', () => {
    expect(hasPromo(rogers({ regularAmount: null }))).toBe(false);
    expect(hasPromo(rogers({ promoEndDate: null }))).toBe(false);
    expect(hasPromo(rogers({ variable: true }))).toBe(false);
    expect(hasPromo(rogers({ totalPayments: 12, startDate: '2026-11-15' }))).toBe(false);
  });

  it('totals project the regular price after the end date', () => {
    const t = computeTotals([rogers(), sub({ id: 'n', amount: 20 })], [], settings(), '2026-10-25');
    expect(t.overall.monthly).toBe(75);
    expect(t.promoCount).toBe(1);
    expect(t.monthlyAfterPromos).toBe(95);
    const later = computeTotals([rogers(), sub({ id: 'n', amount: 20 })], [], settings(), '2027-03-20');
    expect(later).toMatchObject({ promoCount: 0, monthlyAfterPromos: 95 });
    expect(later.overall.monthly).toBe(95);
    const march = computeMonthTotals([rogers()], settings(), '2027-03-01');
    expect(march.thisMonth).toBe(75);
    const feb = computeMonthTotals([rogers()], settings(), '2027-02-01');
    expect(feb.thisMonth).toBe(55);
  });

  it('reminds a week and a day before, with the new price', () => {
    const rs = promoEndReminders(rogers(), settings(), now);
    expect(rs.map((r) => [r.kind, r.chargeDate, r.fireAt.getDate()])).toEqual([
      ['promoEnd', '2027-03-15', 8],
      ['promoEnd', '2027-03-15', 14],
    ]);
    expect(rs[0].title).toBe('Rogers promo price ends in 7 days');
    expect(rs[0].body).toContain('CA$55.00 goes up to CA$75.00 for charges from Mar 15');
    expect(rs[0].id.startsWith('promo:')).toBe(true);
    expect(promoEndReminders(rogers({ remindersEnabled: false }), settings(), now)).toEqual([]);
    expect(promoEndReminders(rogers({ cancelled: true }), settings(), now)).toEqual([]);
  });

  it('the renewal reminder quotes the price on that charge date', () => {
    const r = rogers({ anchorDate: '2027-03-15', promoEndDate: '2027-03-15' });
    const renewal = remindersFor(r, settings(), new Date(2027, 2, 1, 10)).find((x) => x.kind === 'renewal');
    expect(renewal?.body).toContain('75');
  });
});

describe('cancel-by deadlines', () => {
  const gym = (over: Parameters<typeof sub>[0] = {}) =>
    sub({ id: 'g', name: 'GoodLife', amount: 60, anchorDate: '2026-12-01', cancelByDate: '2026-11-20', ...over });

  it('reminds 3 days and 1 day before', () => {
    const rs = cancelByReminders(gym(), settings(), now);
    expect(rs.map((r) => r.title)).toEqual(['Cancel GoodLife by Nov 20 (3 days)', 'Cancel GoodLife by tomorrow']);
    expect(rs.every((r) => r.kind === 'cancelBy' && r.id.startsWith('cancel:'))).toBe(true);
    expect(rs[0].fireAt).toEqual(new Date(2026, 10, 17, 9, 0));
  });

  it('saved too late for both: one catch-up a minute after saving, unless the day has passed', () => {
    const late = gym({ cancelByDate: '2026-10-26', updatedAt: new Date(2026, 9, 25, 9, 59, 30).toISOString() });
    const rs = cancelByReminders(late, settings(), now);
    expect(rs).toHaveLength(1);
    expect(rs[0].title).toBe('Cancel GoodLife by tomorrow');
    expect(rs[0].fireAt).toEqual(new Date(2026, 9, 25, 10, 0, 30));
    const past = gym({ cancelByDate: '2026-10-20', updatedAt: new Date(2026, 9, 25, 9, 30).toISOString() });
    expect(cancelByReminders(past, settings(), now)).toEqual([]);
  });

  it('on a trial it replaces the trial reminders, and says why', () => {
    const t = sub({ id: 't', name: 'Crave', trialEndDate: '2026-11-30', anchorDate: '2026-11-30', cancelByDate: '2026-11-28' });
    const rs = remindersFor(t, settings(), now);
    expect(rs.map((r) => r.kind)).toEqual(['cancelBy', 'cancelBy', 'renewal']);
    expect(rs[0].body).toContain('before the free trial turns into a paid one');
    expect(rs[2].chargeDate).toBe('2026-12-30');
  });

  it('deadlines outrank routine renewals when the 60-reminder cap is reached', () => {
    const routine = Array.from({ length: 70 }, (_, i) => sub({ id: `w${i}`, name: `Weekly ${i}`, cycle: { unit: 'week', every: 1 }, anchorDate: '2026-10-28' }));
    const far = [gym({ cancelByDate: '2027-06-01', anchorDate: '2027-06-05' }), rogers({ promoEndDate: '2027-09-15' })];
    const plan = planReminders([...routine, ...far], settings(), now);
    expect(plan).toHaveLength(60);
    expect(plan.filter((r) => r.kind === 'cancelBy')).toHaveLength(2);
    expect(plan.filter((r) => r.kind === 'promoEnd')).toHaveLength(2);
    expect(plan.filter((r) => r.kind === 'renewal')).toHaveLength(56);
    const times = plan.map((r) => r.fireAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('CSV columns for paid, promo and cancel-by', () => {
  const today = '2026-10-25';
  it('round-trips all three', () => {
    const s = rogers({ cancelByDate: '2027-03-01', payments: [{ date: '2026-11-15', paidOn: '2026-10-25', amount: 55 }] });
    const csv = toCsv([s], []);
    expect(csv.split('\r\n')[0].split(',').slice(-4)).toEqual(['promo ends', 'regular price', 'cancel by', 'paid']);
    const p = previewImport(csv, [], today);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows[0].status).toBe('valid');
    expect(p.rows[0].draft).toMatchObject({
      promoEndDate: '2027-03-15',
      regularAmount: 75,
      cancelByDate: '2027-03-01',
      payments: [{ date: '2026-11-15', paidOn: '2026-10-25', amount: 55 }],
    });
  });

  const head = 'name,amount,currency,cycle,next charge,promo ends,regular price,cancel by,paid,varies,actuals,payments,first charge';
  it.each([
    ['A,10,CAD,monthly,2026-11-05,2027-01-05,,,,,,,', 'promo ends and regular price go together'],
    ['A,10,CAD,monthly,2026-11-05,,12,,,,,,', 'promo ends and regular price go together'],
    ['A,10,CAD,monthly,2026-11-05,2027-13-05,12,,,,,,', 'promo ends must be YYYY-MM-DD'],
    ['A,10,CAD,monthly,2026-11-05,2027-01-05,0,,,,,,', 'regular price must be more than 0'],
    ['A,10,CAD,monthly,2026-11-05,2027-01-05,12,,,yes,,,', "a bill that varies can't have a promo price"],
    ['A,10,CAD,monthly,2026-11-05,2027-01-05,12,,,,,6,2026-11-05', "a payment plan can't have a promo price"],
    ['A,10,CAD,monthly,2026-11-05,,,soon,,,,,', 'cancel by must be YYYY-MM-DD'],
    ['A,10,CAD,monthly,2026-11-05,,,,2026-11-06@2026-10-20=10,,,,', "paid charge 2026-11-06 isn't a charge date"],
    ['A,10,CAD,monthly,2026-11-05,,,,2026-11-05@2026-10-30=10,,,,', 'paid on 2026-10-30 is in the future'],
    ['A,10,CAD,monthly,2026-11-05,,,,,yes,2026-11-05=12,,', 'actual for 2026-11-05 is in the future'],
  ])('%s -> %s', (row, reason) => {
    const p = previewImport(`${head}\n${row}\n`, [], today);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows[0].status).toBe('invalid');
    expect(p.rows[0].reason).toContain(reason);
  });
});

describe('home rows', () => {
  it('row notes show the promo, the cancel-by date and a mark that can be undone', () => {
    const s = rogers({ cancelByDate: '2026-11-28', payments: [{ date: '2026-11-15', paidOn: '2026-10-25', amount: 55 }] });
    expect(rowNotes(s, '2026-10-25')).toBe(' · promo until Mar 15, 2027, then CA$75.00 · cancel by Nov 28 · Nov 15 paid');
    expect(rowNotes(rogers(), '2027-03-15')).toBe('');
    expect(upcomingRow(rogers(), '2026-11-15', '2026-10-25').badge?.label).toBe('Promo');
    expect(upcomingRow(rogers(), '2027-03-15', '2026-10-25').right).toBe('CA$75.00');
  });

  it('the deadlines section lists cancel-by dates and promo ends, soonest first', () => {
    const rows = deadlineRows(
      [rogers(), sub({ id: 'g', name: 'Gym', cancelByDate: '2026-10-26' }), sub({ id: 'x', name: 'Old', cancelByDate: '2026-10-01' }), sub({ id: 'c', name: 'Gone', cancelled: true, cancelByDate: '2026-11-01' })],
      '2026-10-25',
    );
    expect(rows.map((r) => [r.s.name, r.kind, r.date])).toEqual([
      ['Gym', 'cancelBy', '2026-10-26'],
      ['Rogers', 'promoEnd', '2027-03-15'],
    ]);
    expect(rows[0].model.subtitle).toBe('Cancel by Oct 26, tomorrow');
  });
});
