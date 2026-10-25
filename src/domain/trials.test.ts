import { toCsv, previewImport } from './csv';
import { sub, settings } from './fixtures';
import {
  diffReminders,
  IOS_PENDING_LIMIT,
  nextReminder,
  planReminders,
  RENEWAL_BUDGET,
  remindersFor,
  TEST_SLOTS,
  trialReminders,
} from './reminders';
import { chargesBetween, describeTrialLeft, inTrial, nextCharge, trialDaysLeft } from './schedule';
import { computeMonthTotals, computeTotals } from './totals';

const now = new Date(2026, 9, 25, 10, 0); // Oct 25 2026, 10:00 local
const trial = (over: Parameters<typeof sub>[0] = {}) =>
  sub({ id: 't', name: 'Disney+', amount: 12, trialEndDate: '2026-11-05', anchorDate: '2026-11-05', ...over });

describe('free trials (FR-004)', () => {
  it('counts down the days and says when it ends', () => {
    expect(trialDaysLeft(trial(), '2026-10-25')).toBe(11);
    expect(trialDaysLeft(trial(), '2026-11-04')).toBe(1);
    expect(trialDaysLeft(trial(), '2026-11-05')).toBe(0);
    expect(trialDaysLeft(trial(), '2026-11-06')).toBeNull();
    expect(trialDaysLeft(sub(), '2026-10-25')).toBeNull();
    expect(describeTrialLeft(11)).toBe('ends in 11 days');
    expect(describeTrialLeft(1)).toBe('ends tomorrow');
    expect(describeTrialLeft(0)).toBe('ends today');
  });

  it('first charges on the trial end date at the post-trial price, never before', () => {
    // Even with an anchor before the trial end, nothing is projected inside the trial.
    const t = trial({ anchorDate: '2026-10-05' });
    expect(nextCharge(t, '2026-10-25')).toBe('2026-11-05');
    expect(chargesBetween(t, '2026-10-01', '2026-10-31')).toEqual([]);
    expect(chargesBetween(t, '2026-11-01', '2026-12-31')).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('counts as $0 in the averages until it ends, then at the post-trial price', () => {
    const s = [trial(), sub({ amount: 10 })];
    expect(computeTotals(s, [], settings(), '2026-10-25').overall.monthly).toBeCloseTo(10);
    expect(computeTotals(s, [], settings(), '2026-10-25').overall.count).toBe(2);
    expect(computeTotals(s, [], settings(), '2026-11-05').overall.monthly).toBeCloseTo(22);
    expect(inTrial(trial(), '2026-11-04')).toBe(true);
    expect(inTrial(trial(), '2026-11-05')).toBe(false);
  });

  it('adds nothing to this month before the end, and the first charge in the month it ends', () => {
    expect(computeMonthTotals([trial({ trialEndDate: '2026-11-05', anchorDate: '2026-11-05' })], settings(), '2026-10-25').thisMonth).toBe(0);
    const nov = computeMonthTotals([trial()], settings(), '2026-11-02');
    expect(nov.thisMonth).toBe(12);
    expect(nov.stillDue).toBe(12);
    expect(computeMonthTotals([trial()], settings(), '2026-11-06').paidSoFar).toBe(12);
  });

  it('a cancelled trial counts nowhere and has no reminders', () => {
    const t = trial({ cancelled: true });
    expect(computeTotals([t], [], settings(), '2026-11-10').overall.count).toBe(0);
    expect(computeMonthTotals([t], settings(), '2026-11-10').thisMonth).toBe(0);
    expect(remindersFor(t, settings(), now)).toEqual([]);
  });
});

describe('trial reminders (FR-010)', () => {
  it('schedules 3 days and 1 day before the trial ends at the reminder hour', () => {
    const rs = trialReminders(trial(), settings(), now);
    expect(rs.map((r) => r.fireAt)).toEqual([new Date(2026, 10, 2, 9, 0), new Date(2026, 10, 4, 9, 0)]);
    expect(rs.every((r) => r.kind === 'trial' && r.id.startsWith('trial:t:2026-11-05:'))).toBe(true);
    expect(rs[0].title).toBe('Disney+ free trial ends in 3 days');
    expect(rs[1].title).toBe('Disney+ free trial ends tomorrow');
    expect(rs[0].body).toBe('Cancel before 2026-11-05 if you don’t want it. After that it’s CA$12.00 monthly.');
  });

  it('replaces the renewal reminder for the first charge during the trial', () => {
    const rs = remindersFor(trial(), settings(), now);
    expect(rs).toHaveLength(2);
    expect(rs.some((r) => r.kind === 'renewal')).toBe(false);
  });

  it('drops reminders that already fired and moves on to renewals after the trial', () => {
    // Nov 3 10:00: the 3-day reminder has passed, the 1-day one is still ahead.
    expect(remindersFor(trial(), settings(), new Date(2026, 10, 3, 10)).map((r) => r.kind)).toEqual(['trial']);
    // Nov 4 10:00: both trial reminders passed; the next reminder is for Dec 5, not the trial-end charge.
    const after = remindersFor(trial(), settings(), new Date(2026, 10, 4, 10));
    expect(after.map((r) => [r.kind, r.chargeDate])).toEqual([['renewal', '2026-12-05']]);
    expect(nextReminder(trial(), settings(), now)!.chargeDate).toBe('2026-12-05');
  });

  it('respects reminders off', () => {
    expect(remindersFor(trial({ remindersEnabled: false }), settings(), now)).toEqual([]);
  });

  it('re-syncs when the trial end date moves or the trial is cancelled', () => {
    const before = planReminders([trial()], settings(), now);
    const pending = before.map((r) => r.id);
    const moved = planReminders([trial({ trialEndDate: '2026-11-08', anchorDate: '2026-11-08' })], settings(), now);
    const d1 = diffReminders(moved, pending);
    expect(d1.toCancel.sort()).toEqual([...pending].sort());
    expect(d1.toSchedule).toHaveLength(2);
    const cancelled = planReminders([trial({ cancelled: true })], settings(), now);
    expect(diffReminders(cancelled, pending).toCancel.sort()).toEqual([...pending].sort());
    // Unchanged: nothing to do.
    expect(diffReminders(before, pending)).toEqual({ toSchedule: [], toCancel: [] });
  });

  it('shares the 60-reminder budget with renewals, soonest first (100 items, 10 trials)', () => {
    const subs = [
      ...Array.from({ length: 90 }, (_, i) =>
        sub({ id: `r${i}`, anchorDate: `2026-${i < 45 ? '11' : '12'}-${String((i % 28) + 1).padStart(2, '0')}` }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        trial({ id: `t${i}`, trialEndDate: `2026-11-${String(i + 5).padStart(2, '0')}`, anchorDate: `2026-11-${String(i + 5).padStart(2, '0')}` }),
      ),
    ];
    const plan = planReminders(subs, settings(), now);
    expect(plan).toHaveLength(RENEWAL_BUDGET);
    expect(plan.length + TEST_SLOTS).toBeLessThanOrEqual(IOS_PENDING_LIMIT);
    // Both kinds compete for the same window.
    expect(plan.some((r) => r.kind === 'trial')).toBe(true);
    expect(plan.some((r) => r.kind === 'renewal')).toBe(true);
    const times = plan.map((r) => r.fireAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const all = subs.flatMap((s) => remindersFor(s, settings(), now));
    const cutoff = times[times.length - 1];
    // Everything sooner than the last one kept is in the window, trial or renewal; nothing later is.
    expect(all.filter((r) => r.fireAt.getTime() < cutoff).every((r) => plan.some((p) => p.id === r.id))).toBe(true);
    expect(plan.every((p) => p.fireAt.getTime() <= cutoff)).toBe(true);
    expect(all.filter((r) => r.kind === 'trial' && r.fireAt.getTime() > cutoff).length).toBeGreaterThan(0);
  });
});

describe('trials in CSV', () => {
  it('round-trips the trial end date', () => {
    const p = previewImport(toCsv([trial()], []), []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows[0].draft).toMatchObject({ trialEndDate: '2026-11-05', amount: 12, totalPayments: null });
  });

  it('rejects a bad trial end date or a next charge before it', () => {
    const head = 'name,amount,currency,cycle,next charge date,trial end date\n';
    const p = previewImport(`${head}A,5,CAD,monthly,2026-11-05,2026-13-01\nB,5,CAD,monthly,2026-11-01,2026-11-05\n`, []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => r.reason)).toEqual([
      'trial end date must be YYYY-MM-DD',
      "next charge date can't be before the trial end date",
    ]);
  });
});
