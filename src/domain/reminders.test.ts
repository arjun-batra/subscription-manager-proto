import { sub, settings } from './fixtures';
import {
  diffReminders,
  IOS_PENDING_LIMIT,
  nextReminder,
  planReminders,
  reminderHealth,
  RENEWAL_BUDGET,
} from './reminders';
import { cycleShorterThanLead } from './schedule';

const now = new Date(2026, 9, 25, 10, 0); // Oct 25 2026, 10:00 local

describe('reminders', () => {
  it('fires 2 days before at 9:00 local by default', () => {
    const r = nextReminder(sub({ id: 'a', anchorDate: '2026-11-05' }), settings(), now)!;
    expect(r.id).toMatch(/^renew:a:2026-11-05:/);
    expect(r.fireAt).toEqual(new Date(2026, 10, 3, 9, 0));
  });

  it('skips to the following charge when this reminder time has passed', () => {
    const r = nextReminder(sub({ id: 'b', anchorDate: '2026-10-26' }), settings(), now)!;
    expect(r.chargeDate).toBe('2026-11-26');
  });

  it('respects per-item off and cancelled', () => {
    expect(nextReminder(sub({ remindersEnabled: false }), settings(), now)).toBeNull();
    expect(nextReminder(sub({ cancelled: true }), settings(), now)).toBeNull();
  });

  it('with 100 items keeps the 60 soonest and stays under the iOS 64 limit', () => {
    const subs = Array.from({ length: 100 }, (_, i) =>
      sub({ id: `x${i}`, anchorDate: `2026-${i < 50 ? '11' : '12'}-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    const plan = planReminders(subs, settings(), now);
    expect(plan).toHaveLength(RENEWAL_BUDGET);
    expect(plan.length + 1).toBeLessThanOrEqual(IOS_PENDING_LIMIT);
    const times = plan.map((p) => p.fireAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const cutoff = times[times.length - 1];
    const all = subs.map((s) => nextReminder(s, settings(), now)!);
    expect(all.filter((r) => r.fireAt.getTime() < cutoff).every((r) => plan.some((p) => p.id === r.id))).toBe(true);
  });

  it('adds the next one in line after the soonest passes', () => {
    const subs = Array.from({ length: 70 }, (_, i) =>
      sub({ id: `y${i}`, anchorDate: `2026-11-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    const first = planReminders(subs, settings(), now);
    const later = planReminders(subs, settings(), new Date(first[0].fireAt.getTime() + 60_000));
    expect(later).toHaveLength(60);
    expect(later.map((p) => p.id)).not.toContain(first[0].id);
    const { toSchedule, toCancel } = diffReminders(later, first.map((p) => p.id));
    expect(toCancel.length).toBeGreaterThan(0);
    expect(toSchedule.length).toBeGreaterThan(0);
  });

  it('diff leaves non-renewal notifications alone', () => {
    const plan = planReminders([sub({ id: 'k' })], settings(), now);
    expect(diffReminders(plan, ['test-notification', 'renew:old:2026-01-01'])).toEqual({
      toSchedule: plan,
      toCancel: ['renew:old:2026-01-01'],
    });
  });

  describe('home warning', () => {
    const plan = planReminders([sub({ id: 'h1' }), sub({ id: 'h2', anchorDate: '2026-12-01' })], settings(), now);
    const ids = plan.map((p) => p.id);
    it('shows when permission is denied', () => {
      expect(reminderHealth('denied', plan, ids)).toMatchObject({ ok: false, reason: 'permission' });
      expect(reminderHealth('provisional', plan, ids).ok).toBe(false);
    });
    it('hides when granted and everything in the window is pending', () => {
      expect(reminderHealth('granted', plan, ids)).toEqual({ ok: true });
    });
    it('shows when one in-window reminder is missing', () => {
      const h = reminderHealth('granted', plan, ids.slice(1));
      expect(h).toMatchObject({ ok: false, reason: 'missing' });
    });
  });

  describe('re-sync after edits (FR-009)', () => {
    const base = sub({ id: 'e1', name: 'Netflix', amount: 16.49, anchorDate: '2026-11-05' });
    const pendingFor = (subs: ReturnType<typeof sub>[], st = settings()) =>
      planReminders(subs, st, now).map((p) => p.id);

    it('changes nothing when nothing changed', () => {
      const plan = planReminders([base], settings(), now);
      expect(diffReminders(plan, pendingFor([base]))).toEqual({ toSchedule: [], toCancel: [] });
    });

    it('replaces the reminder after a rename', () => {
      const pending = pendingFor([base]);
      const plan = planReminders([{ ...base, name: 'Netflix Premium' }], settings(), now);
      const d = diffReminders(plan, pending);
      expect(d.toCancel).toEqual(pending);
      expect(d.toSchedule).toHaveLength(1);
      expect(d.toSchedule[0].title).toBe('Netflix Premium renews in 2 days');
    });

    it('replaces the reminder after an amount or currency change', () => {
      const pending = pendingFor([base]);
      for (const edited of [{ ...base, amount: 22.99 }, { ...base, currency: 'USD' }]) {
        const plan = planReminders([edited], settings(), now);
        const d = diffReminders(plan, pending);
        expect(d.toCancel).toEqual(pending);
        expect(d.toSchedule.map((r) => r.body)).toEqual([plan[0].body]);
      }
      expect(planReminders([{ ...base, amount: 22.99 }], settings(), now)[0].body).toBe('CA$22.99 on 2026-11-05');
    });

    it('replaces every reminder after a lead-time or time-of-day change', () => {
      const subs = [base, sub({ id: 'e2', anchorDate: '2026-11-20' })];
      const pending = pendingFor(subs);
      const lead = planReminders(subs, settings({ leadDays: 7 }), now);
      const d1 = diffReminders(lead, pending);
      expect(d1.toCancel.sort()).toEqual([...pending].sort());
      expect(d1.toSchedule.map((r) => r.fireAt)).toEqual([new Date(2026, 9, 29, 9, 0), new Date(2026, 10, 13, 9, 0)]);
      expect(d1.toSchedule[0].title).toBe('Netflix renews in 7 days');

      const hour = planReminders(subs, settings({ reminderHour: 20 }), now);
      const d2 = diffReminders(hour, pending);
      expect(d2.toCancel.sort()).toEqual([...pending].sort());
      expect(d2.toSchedule.map((r) => r.fireAt.getHours())).toEqual([20, 20]);
    });

    it('replaces the reminder after the date moves', () => {
      const pending = pendingFor([base]);
      const d = diffReminders(planReminders([{ ...base, anchorDate: '2026-11-12' }], settings(), now), pending);
      expect(d.toCancel).toEqual(pending);
      expect(d.toSchedule[0].chargeDate).toBe('2026-11-12');
    });
  });

  describe('cycle shorter than the lead time', () => {
    it('still finds a future reminder for a daily item with a 2-day lead after 9:00', () => {
      const r = nextReminder(sub({ anchorDate: '2026-10-01', cycle: { unit: 'day', every: 1 } }), settings(), now)!;
      expect(r).not.toBeNull();
      expect(r.fireAt.getTime()).toBeGreaterThan(now.getTime());
      expect(r.chargeDate).toBe('2026-10-28'); // fires Oct 26 9:00
    });

    it('still finds one for every 3 days with a 7-day lead', () => {
      const r = nextReminder(
        sub({ anchorDate: '2026-10-01', cycle: { unit: 'day', every: 3 } }),
        settings({ leadDays: 7 }),
        now,
      )!;
      expect(r).not.toBeNull();
      expect(r.fireAt.getTime()).toBeGreaterThan(now.getTime());
      expect(r.chargeDate).toBe('2026-11-03');
      expect(r.fireAt).toEqual(new Date(2026, 9, 27, 9, 0)); // Oct 31's reminder (Oct 24) already passed
    });

    it('flags the cycle as shorter than the lead', () => {
      expect(cycleShorterThanLead({ unit: 'day', every: 1 }, 2)).toBe(true);
      expect(cycleShorterThanLead({ unit: 'day', every: 3 }, 7)).toBe(true);
      expect(cycleShorterThanLead({ unit: 'week', every: 1 }, 7)).toBe(false);
      expect(cycleShorterThanLead({ unit: 'month', every: 1 }, 7)).toBe(false);
    });
  });

  it('never reminds before the first charge of a new subscription', () => {
    const r = nextReminder(
      sub({ anchorDate: '2026-12-15', startDate: '2026-12-15', cycle: { unit: 'week', every: 1 } }),
      settings(),
      now,
    )!;
    expect(r.chargeDate).toBe('2026-12-15');
  });
});

