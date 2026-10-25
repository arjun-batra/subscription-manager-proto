import { sub, settings } from './fixtures';
import {
  diffReminders,
  IOS_PENDING_LIMIT,
  nextReminder,
  planReminders,
  reminderHealth,
  RENEWAL_BUDGET,
} from './reminders';

const now = new Date(2026, 9, 25, 10, 0); // Oct 25 2026, 10:00 local

describe('reminders', () => {
  it('fires 2 days before at 9:00 local by default', () => {
    const r = nextReminder(sub({ id: 'a', anchorDate: '2026-11-05' }), settings(), now)!;
    expect(r.id).toBe('renew:a:2026-11-05');
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
});
