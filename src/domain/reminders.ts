import { addDays, atLocalTime, describeCycle, firstIndexOnOrAfter, occurrence, shortDate, toLocalDate } from './dates';
import { formatMoney } from './money';
import {
  amountForCharge,
  expectedAmount,
  firstChargeDate,
  hasPromo,
  hasTrial,
  isPlan,
  isVariable,
  minCycleDays,
  paymentFor,
  paymentNumber,
  planEndDate,
} from './schedule';
import type { LocalDate, Settings, Subscription } from './types';

/** iOS keeps at most 64 pending local notifications per app. */
export const IOS_PENDING_LIMIT = 64;
/**
 * Reminders we keep pending, at most 60 ("scheduling window"). Deadlines (cancel-by, trial end,
 * promo end) are picked first, soonest first; routine renewal and payment reminders fill the rest,
 * soonest first. Each item contributes its next renewal or payment reminder, or, during a trial,
 * its trial reminders, plus any cancel-by and promo-end reminders.
 */
export const RENEWAL_BUDGET = 60;
/** One slot is kept for "send test notification"; the rest are spare. */
export const TEST_SLOTS = 1;

export const REMINDER_PREFIX = 'renew:';
export const PAYMENT_PREFIX = 'pay:';
export const TRIAL_PREFIX = 'trial:';
export const CANCEL_BY_PREFIX = 'cancel:';
export const PROMO_PREFIX = 'promo:';
/** Every id prefix the app owns; the diff cancels stale ids with any of them. */
export const OWNED_PREFIXES = [REMINDER_PREFIX, PAYMENT_PREFIX, TRIAL_PREFIX, CANCEL_BY_PREFIX, PROMO_PREFIX];
export const TEST_ID = 'test-notification';
/** Trial reminders fire this many days before the trial ends (FR-010). */
export const TRIAL_LEAD_DAYS = [3, 1];
/** Cancel-by reminders: 3 days and 1 day before the deadline. */
export const CANCEL_BY_LEAD_DAYS = [3, 1];
/** Promo-end reminders: a week before (time to call and ask for a better deal) and the day before. */
export const PROMO_LEAD_DAYS = [7, 1];
/** Deadline reminders firing within this many days outrank routine ones under the cap. */
export const DEADLINE_PRIORITY_DAYS = 60;
/**
 * T1: a trial saved too late for its 1-day reminder still gets one notice, this long after the
 * save (as long as the trial hasn't ended). Anchored to deadlineSetAt (when the deadline was set) so the id stays stable across syncs.
 */
export const TRIAL_CATCH_UP_MS = 60_000;

export type ReminderKind = 'renewal' | 'payment' | 'trial' | 'cancelBy' | 'promoEnd';

/** Deadlines outrank routine renewals and payments when the 60-reminder window is full. */
export function isDeadline(kind: ReminderKind): boolean {
  return kind === 'trial' || kind === 'cancelBy' || kind === 'promoEnd';
}

const PREFIX: Record<ReminderKind, string> = {
  renewal: 'renew:',
  payment: 'pay:',
  trial: 'trial:',
  cancelBy: 'cancel:',
  promoEnd: 'promo:',
};

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
  return {
    id: `${PREFIX[kind]}${sub.id}:${chargeDate}:${fireAt.getTime().toString(36)}:${contentHash(`${title}\n${body}`)}`,
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
  // Variable bills say "about" and use the current estimate (average of the last 3 actuals);
  // promos use the price on that charge's date.
  const money = `${isVariable(sub) ? 'about ' : ''}${formatMoney(amountForCharge(sub, chargeDate), sub.currency)}`;
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

/**
 * FR-010: 3 days and 1 day before the trial ends, at the reminder hour; only those still ahead.
 * T1: when the item was saved after the last of those times and the trial hasn't ended yet, one
 * catch-up notice fires a minute after the save instead ("ends tomorrow" / "ends today").
 */
export function trialReminders(sub: Subscription, settings: Settings, now: Date): PlannedReminder[] {
  if (sub.cancelled || !sub.remindersEnabled || !hasTrial(sub)) return [];
  // A cancel-by date is the real deadline, so its reminders replace the trial's. A trial whose
  // first charge is already marked paid has been kept on purpose: no "cancel before" nag.
  if (hasCancelBy(sub) || paymentFor(sub, sub.trialEndDate!)) return [];
  const end = sub.trialEndDate!;
  const price = `${isVariable(sub) ? 'about ' : ''}${formatMoney(expectedAmount(sub), sub.currency)}`;
  const after = `${price} ${describeCycle(sub.cycle).toLowerCase()}`;
  const body = `Cancel before ${end} if you don’t want it. After that it’s ${after}.`;
  const scheduled = TRIAL_LEAD_DAYS.map((days) => {
    const fireAt = atLocalTime(addDays(end, -days), settings.reminderHour);
    return build('trial', sub, end, fireAt, `${sub.name} free trial ends ${whenText(days)}`, body);
  });
  const ahead = scheduled.filter((r) => r.fireAt.getTime() > now.getTime());
  if (ahead.length) return ahead;
  const catchUp = trialCatchUp(sub, end, body, scheduled);
  return catchUp && catchUp.fireAt.getTime() > now.getTime() ? [catchUp] : [];
}

/**
 * True when saving a trial now would be too late for its usual 1-day reminder but the trial
 * hasn't ended: the edit screen says the catch-up notice is coming instead (T1).
 */
export function trialLeadsPassed(trialEnd: LocalDate, settings: Settings, now: Date): boolean {
  const lastLead = Math.max(...TRIAL_LEAD_DAYS.map((d) => atLocalTime(addDays(trialEnd, -d), settings.reminderHour).getTime()));
  return now.getTime() >= lastLead && toLocalDate(now) <= trialEnd;
}

function trialCatchUp(sub: Subscription, end: LocalDate, body: string, scheduled: PlannedReminder[]): PlannedReminder | null {
  return catchUp('trial', sub, end, scheduled, (days) => `${sub.name} free trial ends ${whenText(days)}`, body);
}

/**
 * T1-style catch-up for any deadline: when the item was saved after the last lead reminder's time
 * and the deadline day hasn't passed, one notice fires a minute after the save.
 */
function catchUp(
  kind: ReminderKind,
  sub: Subscription,
  end: LocalDate,
  scheduled: PlannedReminder[],
  title: (days: number) => string,
  body: string,
): PlannedReminder | null {
  // Keyed on when the deadline was set, so marking paid or editing other fields doesn't resend it.
  const saved = Date.parse(sub.deadlineSetAt ?? '');
  if (!Number.isFinite(saved)) return null;
  const lastLead = Math.max(...scheduled.map((r) => r.fireAt.getTime()));
  // Only when no lead reminder could have fired after the save, and the deadline day hasn't passed.
  if (saved < lastLead) return null;
  const savedDay = toLocalDate(new Date(saved));
  if (savedDay > end) return null;
  const days = Math.round((atLocalTime(end, 12).getTime() - atLocalTime(savedDay, 12).getTime()) / 86_400_000);
  return build(kind, sub, end, new Date(saved + TRIAL_CATCH_UP_MS), title(days), body);
}

/** Lead reminders still ahead, else one catch-up if the item was saved too late for them. */
function deadlineReminders(
  kind: ReminderKind,
  sub: Subscription,
  end: LocalDate,
  leads: number[],
  settings: Settings,
  now: Date,
  title: (days: number) => string,
  body: string,
): PlannedReminder[] {
  const scheduled = leads.map((days) => build(kind, sub, end, atLocalTime(addDays(end, -days), settings.reminderHour), title(days), body));
  const ahead = scheduled.filter((r) => r.fireAt.getTime() > now.getTime());
  if (ahead.length) return ahead;
  const late = catchUp(kind, sub, end, scheduled, title, body);
  return late && late.fireAt.getTime() > now.getTime() ? [late] : [];
}

/**
 * The deadlineSetAt to save: `now` when a deadline (trial end, cancel-by, promo end) is new or
 * changed, or reminders for the item were just turned back on (un-cancelled, reminders on), else the
 * previous stamp. Null when the item has no deadline. Marking paid never calls this.
 */
export function nextDeadlineStamp(prev: Subscription | null | undefined, next: Subscription, now: string): string | null {
  const key = (s: Subscription) => [hasTrial(s) ? s.trialEndDate : null, s.cancelByDate ?? null, hasPromo(s) ? s.promoEndDate : null];
  const k = key(next);
  if (k.every((d) => !d)) return null;
  if (!prev) return now;
  const changed = key(prev).some((d, i) => d !== k[i]);
  const reenabled = (prev.cancelled && !next.cancelled) || (!prev.remindersEnabled && next.remindersEnabled);
  return changed || reenabled ? now : (prev.deadlineSetAt ?? null);
}

export function hasCancelBy(sub: Subscription): boolean {
  return !!sub.cancelByDate;
}

/** "Cancel Crave by Nov 20": 3 days and 1 day before the deadline (catch-up if saved late). */
export function cancelByReminders(sub: Subscription, settings: Settings, now: Date): PlannedReminder[] {
  if (sub.cancelled || !sub.remindersEnabled || !hasCancelBy(sub)) return [];
  const end = sub.cancelByDate!;
  const after = hasTrial(sub) && sub.trialEndDate! >= end ? ' before the free trial turns into a paid one' : '';
  const body = `Cancel by ${shortDate(end, end)}${after}, if you don’t want to keep it.`;
  const title = (days: number) => `Cancel ${sub.name} ${days <= 0 ? 'today' : days === 1 ? 'by tomorrow' : `by ${shortDate(end, end)} (${days} days)`}`;
  return deadlineReminders('cancelBy', sub, end, CANCEL_BY_LEAD_DAYS, settings, now, title, body);
}

/** "Rogers promo price ends in 7 days": a week and a day before the regular price starts. */
export function promoEndReminders(sub: Subscription, settings: Settings, now: Date): PlannedReminder[] {
  if (sub.cancelled || !sub.remindersEnabled || !hasPromo(sub)) return [];
  const end = sub.promoEndDate!;
  const body = `${formatMoney(expectedAmount(sub), sub.currency)} goes up to ${formatMoney(sub.regularAmount!, sub.currency)} for charges from ${shortDate(end, end)}. A good time to ask for a new deal or cancel.`;
  return deadlineReminders('promoEnd', sub, end, PROMO_LEAD_DAYS, settings, now, (days) => `${sub.name} promo price ends ${whenText(days)}`, body);
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
  // Charges marked paid (early) get no reminder; the next unpaid one does.
  const paid = (sub.payments ?? []).filter((p) => p.date >= from).length;
  for (let k = start; k < start + tries + paid; k += 1) {
    const date = occurrence(sub.anchorDate, sub.cycle, k);
    if (last && date > last) return null;
    if (paymentFor(sub, date)) continue;
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
  const deadlines = [...cancelByReminders(sub, settings, now), ...promoEndReminders(sub, settings, now)];
  const trial = trialReminders(sub, settings, now);
  if (trial.length) return [...trial, ...deadlines];
  // A trial with a cancel-by date has no trial reminders, but its first charge is still covered
  // by the deadline, so the renewal reminder starts after the trial as usual.
  const next = nextReminder(sub, settings, now);
  return next ? [...deadlines, next] : deadlines;
}

const soonest = (a: PlannedReminder, b: PlannedReminder) =>
  a.fireAt.getTime() - b.fireAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Selection across all subscriptions, capped at the budget, so the app never asks iOS for more
 * than 64 pending notifications. Deadlines (cancel-by, trial, promo end) firing within the next
 * DEADLINE_PRIORITY_DAYS are taken first, soonest first, then everything else (renewals, payments,
 * later deadlines) fills what's left, soonest first. The result is in
 * firing order. Ties break on id so it is deterministic.
 */
export function planReminders(
  subs: Subscription[],
  settings: Settings,
  now: Date,
  budget: number = RENEWAL_BUDGET,
): PlannedReminder[] {
  const all = subs.flatMap((s) => remindersFor(s, settings, now));
  const cap = Math.max(0, Math.min(budget, IOS_PENDING_LIMIT - TEST_SLOTS));
  // Only deadlines firing within the horizon jump the queue; later ones compete as routine, so a
  // pile of far-off deadlines can't push out next week's renewals.
  const horizon = now.getTime() + DEADLINE_PRIORITY_DAYS * 86_400_000;
  const urgent = (r: PlannedReminder) => isDeadline(r.kind) && r.fireAt.getTime() <= horizon;
  const deadlines = all.filter(urgent).sort(soonest);
  const routine = all.filter((r) => !urgent(r)).sort(soonest);
  return [...deadlines, ...routine].slice(0, cap).sort(soonest);
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
