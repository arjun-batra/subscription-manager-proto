import { addDays, atLocalTime, firstIndexOnOrAfter, occurrence, toLocalDate } from './dates';
import { formatMoney } from './money';
import type { LocalDate, Settings, Subscription } from './types';

/** iOS keeps at most 64 pending local notifications per app. */
export const IOS_PENDING_LIMIT = 64;
/** Renewal reminders we keep pending: the soonest 60 ("scheduling window"). */
export const RENEWAL_BUDGET = 60;
/** One slot is kept for "send test notification"; the rest are spare. */
export const TEST_SLOTS = 1;

export const REMINDER_PREFIX = 'renew:';
export const TEST_ID = 'test-notification';

export interface PlannedReminder {
  /** Deterministic id so re-planning is idempotent: renew:<subId>:<chargeDate>. */
  id: string;
  subId: string;
  chargeDate: LocalDate;
  fireAt: Date;
  title: string;
  body: string;
}

function reminderFor(sub: Subscription, chargeDate: LocalDate, settings: Settings): PlannedReminder {
  const fireAt = atLocalTime(addDays(chargeDate, -settings.leadDays), settings.reminderHour);
  const when =
    settings.leadDays === 0 ? 'today' : settings.leadDays === 1 ? 'tomorrow' : `in ${settings.leadDays} days`;
  return {
    id: `${REMINDER_PREFIX}${sub.id}:${chargeDate}`,
    subId: sub.id,
    chargeDate,
    fireAt,
    title: `${sub.name} renews ${when}`,
    body: `${formatMoney(sub.amount, sub.currency)} on ${chargeDate}`,
  };
}

/**
 * The next reminder for one subscription whose fire time is still in the future.
 * If the reminder for the next charge has already passed (e.g. charge is tomorrow
 * with a 2-day lead), the following charge's reminder is used instead.
 */
export function nextReminder(
  sub: Subscription,
  settings: Settings,
  now: Date,
): PlannedReminder | null {
  if (sub.cancelled || !sub.remindersEnabled) return null;
  const today = toLocalDate(now);
  const start = firstIndexOnOrAfter(sub.anchorDate, sub.cycle, today);
  for (let k = start; k < start + 3; k += 1) {
    const r = reminderFor(sub, occurrence(sub.anchorDate, sub.cycle, k), settings);
    if (r.fireAt.getTime() > now.getTime()) return r;
  }
  return null;
}

/**
 * Soonest-first selection across all subscriptions, capped at the budget, so the
 * app never asks iOS for more than 64 pending notifications.
 * Sorting ties break on id so the result is deterministic.
 */
export function planReminders(
  subs: Subscription[],
  settings: Settings,
  now: Date,
  budget: number = RENEWAL_BUDGET,
): PlannedReminder[] {
  const all = subs
    .map((s) => nextReminder(s, settings, now))
    .filter((r): r is PlannedReminder => r !== null);
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all.slice(0, Math.max(0, Math.min(budget, IOS_PENDING_LIMIT - TEST_SLOTS)));
}

export interface ReminderDiff {
  toSchedule: PlannedReminder[];
  /** Pending ids that we own (renew:*) but are no longer in the plan. */
  toCancel: string[];
}

/** What to change so the pending set matches the plan. Leaves non-renewal ids alone. */
export function diffReminders(plan: PlannedReminder[], pendingIds: string[]): ReminderDiff {
  const pending = new Set(pendingIds);
  const planned = new Set(plan.map((p) => p.id));
  return {
    toSchedule: plan.filter((p) => !pending.has(p.id)),
    toCancel: pendingIds.filter((id) => id.startsWith(REMINDER_PREFIX) && !planned.has(id)),
  };
}

export type PermissionState = 'granted' | 'provisional' | 'denied' | 'undetermined';

export type ReminderHealth =
  | { ok: true }
  | { ok: false; reason: 'permission'; permission: PermissionState; message: string }
  | { ok: false; reason: 'missing'; missing: PlannedReminder[]; message: string };

/**
 * Home warning: reminders can't fire when permission isn't fully granted, or when
 * any reminder inside the scheduling window isn't pending. Items outside the window
 * don't trigger it.
 */
export function reminderHealth(
  permission: PermissionState,
  plan: PlannedReminder[],
  pendingIds: string[],
): ReminderHealth {
  if (permission !== 'granted') {
    const message =
      permission === 'provisional'
        ? 'Reminders are delivered quietly. Allow alerts so you see them.'
        : permission === 'undetermined'
          ? 'Reminders are off. Allow notifications to get renewal reminders.'
          : 'Notifications are turned off, so renewal reminders can’t fire.';
    return { ok: false, reason: 'permission', permission, message };
  }
  const pending = new Set(pendingIds);
  const missing = plan.filter((p) => !pending.has(p.id));
  if (missing.length) {
    return {
      ok: false,
      reason: 'missing',
      missing,
      message: `${missing.length} reminder${missing.length === 1 ? ' isn’t' : 's aren’t'} scheduled.`,
    };
  }
  return { ok: true };
}
