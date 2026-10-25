import { addDays, atLocalTime, describeCycle, firstIndexOnOrAfter, occurrence, toLocalDate } from './dates';
import { formatMoney } from './money';
import { firstChargeDate, hasTrial, isPlan, minCycleDays, paymentNumber, planEndDate } from './schedule';
import type { LocalDate, Settings, Subscription } from './types';

/** iOS keeps at most 64 pending local notifications per app. */
export const IOS_PENDING_LIMIT = 64;
/**
 * Renewal, payment and trial reminders we keep pending, soonest 60 across all kinds ("scheduling
 * window"): each item's next renewal or payment reminder, or, during a trial, its trial reminders.
 */
export const RENEWAL_BUDGET = 60;
/** One slot is kept for "send test notification"; the rest are spare. */
export const TEST_SLOTS = 1;

export const REMINDER_PREFIX = 'renew:';
export const PAYMENT_PREFIX = 'pay:';
export const TRIAL_PREFIX = 'trial:';
/** Every id prefix the app owns; the diff cancels stale ids with any of them. */
export const OWNED_PREFIXES = [REMINDER_PREFIX, PAYMENT_PREFIX, TRIAL_PREFIX];
export const TEST_ID = 'test-notification';
/** Trial reminders fire this many days before the trial ends (FR-010). */
export const TRIAL_LEAD_DAYS = [3, 1];

export type ReminderKind = 'renewal' | 'payment' | 'trial';

export interface PlannedReminder {
  /**
   * Deterministic id: <prefix><subId>:<chargeDate>:<fireAt>:<contentHash>, prefix renew:, pay: or trial:.
   * Any change to the fire time or the text changes the id, so the diff cancels the
   * stale notification and schedules the new one. Unchanged plans stay idempotent.
   */
  id: string;
  kind: ReminderKind;
  subId: string;
  /** The charge it warns about (for a trial: the trial end, when the first charge happens). */
  chargeDate: LocalDate;
  fireAt: Date;
  title: string;
  body: string;
}

/** Small stable string hash (FNV-1a, 32-bit), base 36. Not for security, just change detection. */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const whenText = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

function build(
  kind: ReminderKind,
  sub: Subscription,
  chargeDate: LocalDate,
  fireAt: Date,
  title: string,
  body: string,
): PlannedReminder {
  const prefix = kind === 'trial' ? TRIAL_PREFIX : kind === 'payment' ? PAYMENT_PREFIX : REMINDER_PREFIX;
  return {
    id: `${prefix}${sub.id}:${chargeDate}:${fireAt.getTime().toString(36)}:${contentHash(`${title}\n${body}`)}`,
    kind,
    subId: sub.id,
    chargeDate,
    fireAt,
    title,
    body,
  };
}

function reminderFor(sub: Subscription, chargeDate: LocalDate, settings: Settings): PlannedReminder {
  const fireAt = atLocalTime(addDays(chargeDate, -settings.leadDays), settings.reminderHour);
  const when = whenText(settings.leadDays);
  const money = formatMoney(sub.amount, sub.currency);
  if (isPlan(sub)) {
    const n = paymentNumber(sub, chargeDate);
    const total = sub.totalPayments!;
    const left = total - n;
    const title = `${sub.name} payment ${n} of ${total} due ${when}`;
    const body =
      left === 0
        ? `${money} on ${chargeDate}. Last payment.`
        : `${money} on ${chargeDate}. ${formatMoney(left * sub.amount, sub.currency)} left after this.`;
    return build('payment', sub, chargeDate, fireAt, title, body);
  }
  return build('renewal', sub, chargeDate, fireAt, `${sub.name} renews ${when}`, `${money} on ${chargeDate}`);
}

/** FR-010: 3 days and 1 day before the trial ends, at the reminder hour; only those still ahead. */
export function trialReminders(sub: Subscription, settings: Settings, now: Date): PlannedReminder[] {
  if (sub.cancelled || !sub.remindersEnabled || !hasTrial(sub)) return [];
  const end = sub.trialEndDate!;
  const after = `${formatMoney(sub.amount, sub.currency)} ${describeCycle(sub.cycle).toLowerCase()}`;
  return TRIAL_LEAD_DAYS.map((days) => {
    const fireAt = atLocalTime(addDays(end, -days), settings.reminderHour);
    const title = `${sub.name} free trial ends ${whenText(days)}`;
    const body = `Cancel before ${end} if you don’t want it. After that it’s ${after}.`;
    return build('trial', sub, end, fireAt, title, body);
  }).filter((r) => r.fireAt.getTime() > now.getTime());
}

/**
 * The next renewal (or plan payment) reminder whose fire time is still in the future.
 * If the reminder for the next charge has already passed (e.g. charge is tomorrow
 * with a 2-day lead), the following charge's reminder is used instead.
 * A trial's first charge is covered by the trial reminders, so this starts after the trial end.
 * A plan gets nothing after its last payment.
 */
export function nextReminder(
  sub: Subscription,
  settings: Settings,
  now: Date,
): PlannedReminder | null {
  if (sub.cancelled || !sub.remindersEnabled) return null;
  const today = toLocalDate(now);
  const first = firstChargeDate(sub);
  let from = first && first > today ? first : today;
  if (hasTrial(sub) && from <= sub.trialEndDate!) from = addDays(sub.trialEndDate!, 1);
  const last = planEndDate(sub);
  const start = firstIndexOnOrAfter(sub.anchorDate, sub.cycle, from);
  // When the cycle is shorter than the lead time, several upcoming charges can already
  // be inside the lead window; keep looking until one's reminder is still in the future.
  const tries = Math.ceil(settings.leadDays / minCycleDays(sub.cycle)) + 2;
  for (let k = start; k < start + tries; k += 1) {
    const date = occurrence(sub.anchorDate, sub.cycle, k);
    if (last && date > last) return null;
    const r = reminderFor(sub, date, settings);
    if (r.fireAt.getTime() > now.getTime()) return r;
  }
  return null;
}

/**
 * What one item wants pending: during a trial, its trial reminders that are still ahead;
 * otherwise (or once both have fired) its next renewal or payment reminder.
 */
export function remindersFor(sub: Subscription, settings: Settings, now: Date): PlannedReminder[] {
  const trial = trialReminders(sub, settings, now);
  if (trial.length) return trial;
  const next = nextReminder(sub, settings, now);
  return next ? [next] : [];
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
  const all = subs.flatMap((s) => remindersFor(s, settings, now));
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all.slice(0, Math.max(0, Math.min(budget, IOS_PENDING_LIMIT - TEST_SLOTS)));
}

export interface ReminderDiff {
  toSchedule: PlannedReminder[];
  /** Pending ids that we own (renew:, pay:, trial:) but are no longer in the plan. */
  toCancel: string[];
}

/** What to change so the pending set matches the plan. Leaves ids we don't own (e.g. the test) alone. */
export function diffReminders(plan: PlannedReminder[], pendingIds: string[]): ReminderDiff {
  const pending = new Set(pendingIds);
  const planned = new Set(plan.map((p) => p.id));
  return {
    toSchedule: plan.filter((p) => !pending.has(p.id)),
    toCancel: pendingIds.filter((id) => OWNED_PREFIXES.some((p) => id.startsWith(p)) && !planned.has(id)),
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
