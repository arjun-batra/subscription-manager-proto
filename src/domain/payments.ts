/**
 * Marking charges paid, including paying early. Pure TypeScript: the Home screen calls these and
 * saves the result. A payment is keyed by the charge date it settles, so the schedule itself never
 * moves; paying early just makes the next unpaid charge the "next due" one, and its reminder drops
 * out of the plan on the next sync (see reminders.ts).
 */
import { amountForCharge, chargesBetween, isVariable, nextDue, paymentFor, withActual, withoutActual } from './schedule';
import type { LocalDate, PaymentRecord, Subscription } from './types';

export interface MarkPaidResult {
  sub: Subscription;
  /** The charge date that was marked. */
  date: LocalDate;
  /** True when it was marked before its due date. */
  early: boolean;
}

/**
 * Marks the next due charge (today's, or the next one) paid on `today`. For a variable bill an
 * `actual` amount can be given: it is what the record says was paid and, for a charge due today,
 * it is logged as that charge's actual too, so estimates learn from it.
 * Null when nothing is left to pay (a finished plan) or the item is cancelled.
 */
export function markNextPaid(sub: Subscription, today: LocalDate, opts: { actual?: number | null; now?: string } = {}): MarkPaidResult | null {
  if (sub.cancelled) return null;
  const date = nextDue(sub, today);
  if (!date) return null;
  const actual = isVariable(sub) && typeof opts.actual === 'number' && opts.actual > 0 ? opts.actual : null;
  // The amount is logged as the charge's actual only once the charge is due (today): actuals are
  // for charges that happened. Paying early keeps the amount on the payment record instead.
  const logActual = actual !== null && date <= today;
  const next: Subscription = logActual ? withActual(sub, date, actual) : sub;
  const record: PaymentRecord = {
    date,
    paidOn: today,
    amount: actual ?? amountForCharge(sub, date),
    ...(logActual && !sub.actuals?.some((a) => a.date === date) ? { loggedActual: true } : {}),
  };
  const updated: Subscription = {
    ...next,
    payments: [...(sub.payments ?? []).filter((p) => p.date !== date), record].sort((a, b) => (a.date < b.date ? -1 : 1)),
    updatedAt: opts.now ?? new Date().toISOString(),
  };
  return { sub: updated, date, early: date > today };
}

/** Undoes a marked payment (and the actual it logged, if it logged one). */
export function unmarkPaid(sub: Subscription, date: LocalDate, now: string = new Date().toISOString()): Subscription {
  const record = paymentFor(sub, date);
  if (!record) return sub;
  const base = record.loggedActual ? withoutActual(sub, date) : sub;
  return { ...base, payments: (sub.payments ?? []).filter((p) => p.date !== date), updatedAt: now };
}

/**
 * The marked payment an "Undo Paid" action reverts: the latest one for a charge due today or later
 * (charges in the past count as paid anyway). Null when there is none.
 */
export function undoablePayment(sub: Subscription, today: LocalDate): PaymentRecord | null {
  const upcoming = (sub.payments ?? []).filter((p) => p.date >= today);
  return upcoming.length ? upcoming.reduce((a, b) => (b.date > a.date ? b : a)) : null;
}

/** Payments a saved edit keeps: only those still on a charge date of the edited schedule. */
export function keepPayments(draft: Subscription): { payments: PaymentRecord[]; dropped: LocalDate[] } {
  const all = draft.payments ?? [];
  const keep = all.filter((p) => chargesBetween(draft, p.date, p.date).length > 0);
  return { payments: keep, dropped: all.filter((p) => !keep.includes(p)).map((p) => p.date) };
}
