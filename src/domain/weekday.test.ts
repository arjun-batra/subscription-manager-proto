/**
 * Nth-weekday monthly schedules ("the 2nd Tuesday", "the last Friday").
 * Jest runs in America/Toronto (jest.global-setup.js), so the reminder-time checks cross the
 * real DST changes (Nov 1 2026 back to EST, Mar 14 2027 forward to EDT).
 */

import { previewImport, toCsv } from './csv';
import {
  describeCycle,
  isValidCycle,
  nextWeekdayRuleDate,
  nthWeekdayOfMonth,
  occurrence,
  occurrencesBetween,
  parseWeekdayRule,
  weekdayOf,
  weekdayRulesFor,
} from './dates';
import { settings, sub } from './fixtures';
import { planReminders } from './reminders';
import { chargesBetween, nextCharge, planFromInputs, planStatus } from './schedule';
import { computeMonthTotals, computeTotals } from './totals';
import type { Cycle } from './types';

const secondTue: Cycle = { unit: 'month', every: 1, weekday: { nth: 2, day: 2 } };
const lastFri: Cycle = { unit: 'month', every: 1, weekday: { nth: -1, day: 5 } };
const firstSun: Cycle = { unit: 'month', every: 1, weekday: { nth: 1, day: 0 } };

describe('nth weekday dates', () => {
  it('finds the nth and last weekday of a month', () => {
    expect(nthWeekdayOfMonth(2026, 11, { nth: 2, day: 2 })).toBe('2026-11-10');
    expect(nthWeekdayOfMonth(2026, 12, { nth: 1, day: 2 })).toBe('2026-12-01'); // month starts on the weekday
    expect(nthWeekdayOfMonth(2026, 12, { nth: 4, day: 3 })).toBe('2026-12-23');
    expect(nthWeekdayOfMonth(2026, 10, { nth: -1, day: 5 })).toBe('2026-10-30');
    expect(nthWeekdayOfMonth(2026, 10, { nth: -1, day: 6 })).toBe('2026-10-31'); // last day of the month
    expect(nthWeekdayOfMonth(2027, 2, { nth: -1, day: 0 })).toBe('2027-02-28');
    expect(nthWeekdayOfMonth(2028, 2, { nth: -1, day: 2 })).toBe('2028-02-29'); // leap day
    expect(weekdayOf('2026-10-25')).toBe(0);
  });

  it('"last" picks the 5th weekday in a 5-week month and the 4th otherwise', () => {
    // Fridays in Oct 2026: 2, 9, 16, 23, 30 (five). Nov 2026: 6, 13, 20, 27 (four).
    expect(occurrencesBetween('2026-10-30', lastFri, '2026-10-01', '2026-12-31')).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
    // The 4th Friday is never the 5th one.
    const fourthFri: Cycle = { unit: 'month', every: 1, weekday: { nth: 4, day: 5 } };
    expect(occurrence('2026-10-23', fourthFri, 0)).toBe('2026-10-23');
  });

  it('counts from the anchor both ways and across years', () => {
    expect(occurrence('2026-11-10', secondTue, 1)).toBe('2026-12-08');
    expect(occurrence('2026-11-10', secondTue, 2)).toBe('2027-01-12');
    expect(occurrence('2026-11-10', secondTue, -1)).toBe('2026-10-13');
    expect(occurrence('2026-11-10', secondTue, -10)).toBe('2026-01-13');
    const everyTwo: Cycle = { ...secondTue, every: 2 };
    expect(occurrencesBetween('2026-11-10', everyTwo, '2026-11-01', '2027-05-31')).toEqual(['2026-11-10', '2027-01-12', '2027-03-09', '2027-05-11']);
  });

  it('works at month boundaries: the next charge after the rule date moves to next month', () => {
    const s = sub({ anchorDate: '2026-11-10', cycle: secondTue });
    expect(nextCharge(s, '2026-11-10')).toBe('2026-11-10');
    expect(nextCharge(s, '2026-11-11')).toBe('2026-12-08');
    expect(nextCharge(s, '2026-12-31')).toBe('2027-01-12');
    expect(nextWeekdayRuleDate('2026-11-11', { nth: 2, day: 2 })).toBe('2026-12-08');
    expect(nextWeekdayRuleDate('2026-11-30', { nth: -1, day: 1 })).toBe('2026-11-30');
  });

  it('offers the rules a picked date satisfies', () => {
    expect(weekdayRulesFor('2026-11-10')).toEqual([{ nth: 2, day: 2 }]);
    expect(weekdayRulesFor('2026-11-24')).toEqual([{ nth: 4, day: 2 }, { nth: -1, day: 2 }]);
    expect(weekdayRulesFor('2026-10-30')).toEqual([{ nth: -1, day: 5 }]); // a 5th Friday only has "last"
  });

  it('describes, parses and validates rules', () => {
    expect(describeCycle(secondTue)).toBe('Monthly on the 2nd Tuesday');
    expect(describeCycle({ ...lastFri, every: 3 })).toBe('Quarterly on the last Friday');
    expect(parseWeekdayRule('Last FRI')).toEqual({ nth: -1, day: 5 });
    expect(parseWeekdayRule('3rd wednesday')).toEqual({ nth: 3, day: 3 });
    expect(parseWeekdayRule('5th mon')).toBeNull();
    expect(parseWeekdayRule('2nd tu')).toBeNull();
    expect(isValidCycle(secondTue)).toBe(true);
    expect(isValidCycle({ unit: 'week', every: 1, weekday: { nth: 1, day: 1 } })).toBe(false);
  });
});

it('runs in America/Toronto', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Toronto');
});

describe('weekday schedules in totals, plans and reminders', () => {
  it('counts the right charges this month', () => {
    const s = sub({ amount: 20, anchorDate: '2026-10-30', cycle: lastFri });
    expect(chargesBetween(s, '2026-11-01', '2026-11-30')).toEqual(['2026-11-27']);
    const m = computeMonthTotals([s], settings(), '2026-11-15');
    expect(m).toMatchObject({ thisMonth: 20, stillDue: 20, paidSoFar: 0 });
    expect(computeTotals([s], [], settings(), '2026-11-15').overall.monthly).toBe(20);
  });

  it('counts plan payments on the weekday schedule', () => {
    const plan = planFromInputs({ nextPayment: '2026-11-10', cycle: secondTue, paymentsMade: 2, totalPayments: 4 })!;
    expect(plan).toEqual({ anchorDate: '2026-11-10', startDate: '2026-09-08', totalPayments: 4 });
    const s = sub({ ...plan, amount: 25, cycle: secondTue });
    expect(planStatus(s, '2026-11-10')).toMatchObject({ paid: 2, remaining: 2, lastPayment: '2026-12-08', remainingAmount: 50 });
    expect(planStatus(s, '2026-12-09')).toMatchObject({ paid: 4, completed: true });
  });

  it('keeps the reminder at the local reminder hour across the November DST change', () => {
    // 1st Sunday of Nov 2026 is Nov 1, the day clocks go back. Lead 2 days: Oct 30 (EDT).
    const s = sub({ id: 'club', anchorDate: '2026-11-01', cycle: firstSun });
    const [r] = planReminders([s], settings({ leadDays: 2, reminderHour: 9 }), new Date('2026-10-20T12:00:00Z'));
    expect(r.chargeDate).toBe('2026-11-01');
    expect(r.fireAt.toISOString()).toBe('2026-10-30T13:00:00.000Z'); // 9:00 EDT
    // After that charge, Dec 6 (EST): 9:00 local is 14:00 UTC.
    const [next] = planReminders([s], settings({ leadDays: 0, reminderHour: 9 }), new Date('2026-11-02T12:00:00Z'));
    expect(next.chargeDate).toBe('2026-12-06');
    expect(next.fireAt.toISOString()).toBe('2026-12-06T14:00:00.000Z');
    expect([next.fireAt.getHours(), r.fireAt.getHours()]).toEqual([9, 9]);
  });

  it('keeps the reminder hour across the March DST change', () => {
    // 2nd Sunday of Mar 2027 is Mar 14, when clocks go forward.
    const s = sub({ anchorDate: '2027-03-14', cycle: { unit: 'month', every: 1, weekday: { nth: 2, day: 0 } } });
    const [r] = planReminders([s], settings({ leadDays: 0, reminderHour: 9 }), new Date('2027-03-01T12:00:00Z'));
    expect(r.chargeDate).toBe('2027-03-14');
    expect(r.fireAt.toISOString()).toBe('2027-03-14T13:00:00.000Z'); // 9:00 EDT
  });
});

describe('weekday schedules in CSV', () => {
  const head = 'name,amount,currency,cycle,next charge date\n';
  it('round-trips through the cycle column', () => {
    const s = sub({ name: 'Club', anchorDate: '2026-11-10', cycle: secondTue });
    const csv = toCsv([s, sub({ name: 'Rent', anchorDate: '2026-10-30', cycle: { ...lastFri, every: 2 } })], []);
    expect(csv).toContain('monthly on the 2nd tue');
    expect(csv).toContain('every 2 months on the last fri');
    const p = previewImport(csv, []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => r.draft?.cycle)).toEqual([secondTue, { ...lastFri, every: 2 }]);
  });

  it('rejects a weekday rule on a non-monthly cycle, or a next charge date off the rule', () => {
    const p = previewImport(`${head}A,5,CAD,weekly on the 2nd tue,2026-11-10\nB,5,CAD,monthly on the 2nd tue,2026-11-11\n`, []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => r.reason)).toEqual(['cycle not recognised', "next charge date isn't the 2nd Tuesday of its month"]);
  });
});
