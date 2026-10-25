import { addDays, daysBetween, firstIndexOnOrAfter, nextOnOrAfter, occurrence, occurrencesBetween } from './dates';
import type { ActualCharge, Cycle, LocalDate, Subscription } from './types';

/** An instalment plan: a fixed number of payments, then it stops. */
export function isPlan(sub: Subscription): boolean {
  return typeof sub.totalPayments === 'number' && sub.totalPayments > 0;
}

/** A subscription with a free trial (plans never have one). */
export function hasTrial(sub: Subscription): boolean {
  return !!sub.trialEndDate && !isPlan(sub);
}

/**
 * The earliest date a charge can fall on, or null when unbounded (an item that was already running).
 * New subscriptions: the first charge. Trials: the trial end date. Plans: the first payment.
 */
export function firstChargeDate(sub: Subscription): LocalDate | null {
  let first: LocalDate | null = sub.startDate ?? (isPlan(sub) ? sub.anchorDate : null);
  if (hasTrial(sub) && (!first || sub.trialEndDate! > first)) first = sub.trialEndDate!;
  return first;
}

/** The last of `total` payments, the first on `first`, counted from the anchor (keeps month-end days). */
export function lastPaymentDate(anchor: LocalDate, cycle: Cycle, first: LocalDate, total: number): LocalDate {
  return occurrence(anchor, cycle, firstIndexOnOrAfter(anchor, cycle, first) + total - 1);
}

/** A plan's last payment date (inclusive). Null for subscriptions, which never end. */
export function planEndDate(sub: Subscription): LocalDate | null {
  if (!isPlan(sub)) return null;
  return lastPaymentDate(sub.anchorDate, sub.cycle, firstChargeDate(sub)!, sub.totalPayments!);
}

function floor(sub: Subscription, date: LocalDate): LocalDate {
  const first = firstChargeDate(sub);
  return first && first > date ? first : date;
}

/**
 * Next charge on or after `date`, never before the first charge (new item, trial end or first
 * payment). For a finished plan this is past its last payment; use upcomingCharge to get null.
 */
export function nextCharge(sub: Subscription, date: LocalDate): LocalDate {
  return nextOnOrAfter(sub.anchorDate, sub.cycle, floor(sub, date));
}

/** Like nextCharge, but null once a plan has made its last payment. */
export function upcomingCharge(sub: Subscription, date: LocalDate): LocalDate | null {
  const next = nextCharge(sub, date);
  const end = planEndDate(sub);
  return end && next > end ? null : next;
}

/** Charges in [start, end]: none before the first charge, none after a plan's last payment. */
export function chargesBetween(sub: Subscription, start: LocalDate, end: LocalDate): LocalDate[] {
  const first = firstChargeDate(sub);
  const last = planEndDate(sub);
  const from = first && first > start ? first : start;
  const to = last && last < end ? last : end;
  if (from > to) return [];
  return occurrencesBetween(sub.anchorDate, sub.cycle, from, to);
}

/** 1-based number of the plan payment due on `date` (counted from the first payment). */
export function paymentNumber(sub: Subscription, date: LocalDate): number {
  const k0 = firstIndexOnOrAfter(sub.anchorDate, sub.cycle, firstChargeDate(sub) ?? sub.anchorDate);
  return firstIndexOnOrAfter(sub.anchorDate, sub.cycle, date) - k0 + 1;
}

export interface PlanStatus {
  total: number;
  /** Payments due before today. A payment due today still counts as due (like "still due"). */
  paid: number;
  remaining: number;
  /** remaining x amount, in the plan's own currency. */
  remainingAmount: number;
  lastPayment: LocalDate;
  /** True once the last payment's day has passed. */
  completed: boolean;
}

export function planStatus(sub: Subscription, today: LocalDate): PlanStatus | null {
  if (!isPlan(sub)) return null;
  const total = sub.totalPayments!;
  const lastPayment = planEndDate(sub)!;
  const next = upcomingCharge(sub, today);
  const paid = next === null ? total : Math.max(0, Math.min(total, paymentNumber(sub, next) - 1));
  const remaining = total - paid;
  return { total, paid, remaining, remainingAmount: remaining * sub.amount, lastPayment, completed: today > lastPayment };
}

export function isCompleted(sub: Subscription, today: LocalDate): boolean {
  const end = planEndDate(sub);
  return !!end && today > end;
}

/**
 * Days until a trial ends: 0 on the end day (the first charge is that day), null when the item
 * has no trial or the trial is over. While this is > 0 the item counts as $0 in averages.
 */
export function trialDaysLeft(sub: Subscription, today: LocalDate): number | null {
  if (!hasTrial(sub) || today > sub.trialEndDate!) return null;
  return daysBetween(today, sub.trialEndDate!);
}

export function inTrial(sub: Subscription, today: LocalDate): boolean {
  return (trialDaysLeft(sub, today) ?? 0) > 0;
}

/** "ends today", "ends tomorrow", "ends in 5 days". */
export function describeTrialLeft(days: number): string {
  return days === 0 ? 'ends today' : days === 1 ? 'ends tomorrow' : `ends in ${days} days`;
}

export const MAX_PLAN_PAYMENTS = 1000;

/**
 * Builds a plan from what the user knows: the next payment date, payments already made, and
 * either the total number of payments or the last payment date. Returns the stored fields, or
 * null when the inputs leave no payment still to make.
 */
export function planFromInputs(input: {
  nextPayment: LocalDate;
  cycle: Cycle;
  paymentsMade: number;
  totalPayments?: number;
  lastPayment?: LocalDate;
}): { anchorDate: LocalDate; startDate: LocalDate; totalPayments: number } | null {
  const { nextPayment, cycle, paymentsMade } = input;
  if (!Number.isInteger(paymentsMade) || paymentsMade < 0) return null;
  let total = input.totalPayments;
  if (input.lastPayment !== undefined) {
    if (input.lastPayment < nextPayment) return null;
    total = paymentsMade + occurrencesBetween(nextPayment, cycle, nextPayment, input.lastPayment).length;
  }
  if (total === undefined || !Number.isInteger(total) || total <= paymentsMade || total > MAX_PLAN_PAYMENTS) return null;
  return {
    anchorDate: nextPayment,
    startDate: occurrence(nextPayment, cycle, -paymentsMade),
    totalPayments: total,
  };
}

/** Shortest possible gap between two charges, in days (months can be 28 days). */
export function minCycleDays(cycle: Cycle): number {
  switch (cycle.unit) {
    case 'day':
      return cycle.every;
    case 'week':
      return 7 * cycle.every;
    case 'month':
      return 28 * cycle.every;
    case 'year':
      return 365 * cycle.every;
  }
}

/** True when the item can renew more often than the reminder lead time. */
export function cycleShorterThanLead(cycle: Cycle, leadDays: number): boolean {
  return minCycleDays(cycle) < leadDays;
}

/** A variable bill (plans never vary: their payments are fixed). */
export function isVariable(sub: Subscription): boolean {
  return !!sub.variable && !isPlan(sub);
}

/** How many recent actuals the estimate averages. */
export const ESTIMATE_WINDOW = 3;

/** Logged actuals, oldest first. */
export function sortedActuals(sub: Subscription): ActualCharge[] {
  return [...(sub.actuals ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * What a future charge is expected to cost, in the item's currency. Fixed items: `amount`.
 * Variable bills: the average of the last 3 logged actuals (fewer if fewer are logged), or the
 * user's estimate (`amount`) until anything is logged.
 */
export function expectedAmount(sub: Subscription): number {
  if (!isVariable(sub)) return sub.amount;
  const recent = sortedActuals(sub).slice(-ESTIMATE_WINDOW);
  if (!recent.length) return sub.amount;
  return recent.reduce((acc, a) => acc + a.amount, 0) / recent.length;
}

/** The amount for one charge: the logged actual for that date if there is one, else the expected amount. */
export function amountForCharge(sub: Subscription, date: LocalDate): number {
  if (isVariable(sub)) {
    const actual = sub.actuals?.find((a) => a.date === date);
    if (actual) return actual.amount;
  }
  return expectedAmount(sub);
}

/** The most recent `count` charge dates on or before `today`, newest first (none before the first charge). */
export function pastCharges(sub: Subscription, today: LocalDate, count: number): LocalDate[] {
  const first = firstChargeDate(sub);
  const end = planEndDate(sub);
  const out: LocalDate[] = [];
  for (let k = firstIndexOnOrAfter(sub.anchorDate, sub.cycle, addDays(today, 1)) - 1; out.length < count; k -= 1) {
    const d = occurrence(sub.anchorDate, sub.cycle, k);
    if (first && d < first) break;
    if (end && d > end) continue;
    out.push(d);
  }
  return out;
}

/** Returns the subscription with an actual logged for `date` (replacing any earlier one). */
export function withActual(sub: Subscription, date: LocalDate, amount: number): Subscription {
  const rest = (sub.actuals ?? []).filter((a) => a.date !== date);
  return { ...sub, actuals: [...rest, { date, amount }].sort((a, b) => (a.date < b.date ? -1 : 1)) };
}

export function withoutActual(sub: Subscription, date: LocalDate): Subscription {
  return { ...sub, actuals: (sub.actuals ?? []).filter((a) => a.date !== date) };
}
