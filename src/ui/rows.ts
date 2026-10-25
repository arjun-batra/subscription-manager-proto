/** What a Home row says. Pure, so it is tested in rows.test.ts. */
import { daysBetween, describeCycle, shortDate } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { undoablePayment } from '../domain/payments';
import {
  chargesBetween,
  describeTrialLeft,
  expectedAmount,
  hasPromo,
  isPlan,
  isVariable,
  paymentNumber,
  priceOn,
  pastCharges,
  planStatus,
  trialDaysLeft,
  withActual,
  withoutActual,
} from '../domain/schedule';
import type { PaidEntry } from '../domain/totals';
import type { ActualCharge, LocalDate, Subscription } from '../domain/types';

export interface RowModel {
  title: string;
  subtitle: string;
  badge?: { label: string; tone: 'trial' | 'neutral' };
  /** The amount on the right: "Free", "CA$16.49" or "about CA$85.00". */
  right: string;
  accessibilityLabel: string;
}

/**
 * "CA$85.00" or, for a variable bill, "about CA$85.00" (the current estimate). With a charge date,
 * the price on that date (the regular price once a promo has ended).
 */
export function amountLabel(s: Subscription, date?: LocalDate): string {
  const money = formatMoney(date ? priceOn(s, date) : expectedAmount(s), s.currency);
  return isVariable(s) ? `about ${money}` : money;
}

/** " · promo until Mar 15, then CA$75.00 · cancel by Nov 28 · Nov 5 paid" (each only when it applies). */
export function rowNotes(s: Subscription, today: LocalDate): string {
  const parts: string[] = [];
  if (hasPromo(s) && today < s.promoEndDate!) {
    parts.push(`promo until ${shortDate(s.promoEndDate!, today)}, then ${formatMoney(s.regularAmount!, s.currency)}`);
  }
  if (s.cancelByDate && s.cancelByDate >= today) {
    parts.push(s.cancelByDate === today ? 'cancel by today' : `cancel by ${shortDate(s.cancelByDate, today)}`);
  }
  const paid = undoablePayment(s, today);
  if (paid) parts.push(`${paid.date === today ? 'today’s' : shortDate(paid.date, today)} paid`);
  return parts.map((x) => ` · ${x}`).join('');
}

export function upcomingRow(s: Subscription, next: LocalDate, today: LocalDate): RowModel {
  const when = next === today ? 'Today' : shortDate(next, today);
  const off = `${rowNotes(s, today)}${s.remindersEnabled ? '' : ' · reminder off'}`;
  const trialLeft = trialDaysLeft(s, today);
  let model: Omit<RowModel, 'accessibilityLabel'>;
  if (trialLeft !== null) {
    model = {
      title: s.name,
      subtitle: `Trial ${describeTrialLeft(trialLeft)} · then ${amountLabel(s)} ${describeCycle(s.cycle).toLowerCase()}${off}`,
      badge: { label: 'Trial', tone: 'trial' },
      right: trialLeft > 0 ? 'Free' : amountLabel(s, next),
    };
  } else {
    const plan = planStatus(s, today);
    if (plan) {
      model = {
        title: s.name,
        subtitle: `${when} · ${plan.paid} of ${plan.total} paid · ${formatMoney(plan.remainingAmount, s.currency)} left${off}`,
        badge: { label: 'Plan', tone: 'neutral' },
        right: amountLabel(s),
      };
    } else {
      model = {
        title: s.name,
        subtitle: `${when} · ${describeCycle(s.cycle)}${isVariable(s) ? ' · varies' : ''}${off}`,
        ...(isVariable(s) ? { badge: { label: 'Varies', tone: 'neutral' as const } } : hasPromo(s) && today < s.promoEndDate! ? { badge: { label: 'Promo', tone: 'neutral' as const } } : {}),
        right: amountLabel(s, next),
      };
    }
  }
  return {
    ...model,
    accessibilityLabel: `${s.name}${model.badge ? `, ${model.badge.label}` : ''}, ${model.right}, ${model.subtitle}`,
  };
}

/**
 * A "Paid this month" row, laid out like an Upcoming row: the day it was paid · schedule, then a
 * quiet note for a payment made early (or late, for an earlier month's charge). The amount is the
 * logged actual, else what was marked, else the estimate ("about").
 */
export function paidRow(e: PaidEntry, today: LocalDate): RowModel {
  const s = e.sub;
  const when = e.paidOn === today ? 'Today' : shortDate(e.paidOn, today);
  const schedule = isPlan(s) ? `Payment ${paymentNumber(s, e.chargeDate)} of ${s.totalPayments}` : describeCycle(s.cycle);
  const notes: string[] = [];
  if (e.early) notes.push(`paid early, due ${shortDate(e.chargeDate, today)}`);
  else if (e.record && e.chargeDate < e.paidOn) notes.push(`for ${shortDate(e.chargeDate, today)}`);
  if (s.cancelled) notes.push('cancelled since');
  const subtitle = [`${when} · ${schedule}`, ...notes].join(' · ');
  const promo = hasPromo(s) && e.chargeDate < s.promoEndDate!;
  const badge = isPlan(s)
    ? { label: 'Plan', tone: 'neutral' as const }
    : isVariable(s)
      ? { label: 'Varies', tone: 'neutral' as const }
      : promo
        ? { label: 'Promo', tone: 'neutral' as const }
        : undefined;
  const right = `${e.estimated ? 'about ' : ''}${formatMoney(e.amount, s.currency)}`;
  return {
    title: s.name,
    subtitle,
    ...(badge ? { badge } : {}),
    right,
    accessibilityLabel: `${s.name}${badge ? `, ${badge.label}` : ''}, paid ${right}, ${subtitle}`,
  };
}

/**
 * The charge a "Log amount" action fills in: the most recent charge on or before today that has
 * no actual yet, else the most recent one. Null before the first charge.
 */
export function chargeToLog(s: Subscription, today: LocalDate): LocalDate | null {
  const recent = pastCharges(s, today, 6);
  if (!recent.length) return null;
  const logged = new Set((s.actuals ?? []).map((a) => a.date));
  return recent.find((d) => !logged.has(d)) ?? recent[0];
}

/** Parses a typed amount ("84,12" or "84.12"); null unless it is a positive number. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * The actuals a saved edit keeps: the stored ones, with the edit screen's typed amounts applied
 * (blank removes one), limited to dates that are still charge dates of the edited schedule.
 */
export function mergeActuals(
  draft: Subscription,
  typed: Record<LocalDate, string>,
): { actuals: ActualCharge[]; dropped: LocalDate[] } | { error: string } {
  let next: Subscription = draft;
  for (const [date, text] of Object.entries(typed)) {
    if (!text.trim()) {
      next = withoutActual(next, date);
      continue;
    }
    const amount = parseAmount(text);
    if (amount === null) return { error: `The amount for ${date} isn’t a number greater than 0.` };
    next = withActual(next, date, amount);
  }
  const all = next.actuals ?? [];
  const keep = all.filter((a) => chargesBetween(draft, a.date, a.date).length > 0);
  return { actuals: keep, dropped: all.filter((a) => !keep.includes(a)).map((a) => a.date) };
}

export interface DeadlineRow {
  s: Subscription;
  kind: 'cancelBy' | 'promoEnd';
  date: LocalDate;
  model: RowModel;
}

const inDays = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/** Home's Deadlines section: cancel-by dates and promo ends from today on, soonest first. */
export function deadlineRows(subs: Subscription[], today: LocalDate): DeadlineRow[] {
  const out: DeadlineRow[] = [];
  for (const s of subs) {
    if (s.cancelled) continue;
    if (s.cancelByDate && s.cancelByDate >= today) {
      const days = daysBetween(today, s.cancelByDate);
      const subtitle = `Cancel by ${shortDate(s.cancelByDate, today)}, ${inDays(days)}${s.remindersEnabled ? '' : ' · reminder off'}`;
      out.push({
        s,
        kind: 'cancelBy',
        date: s.cancelByDate,
        model: {
          title: s.name,
          subtitle,
          badge: { label: 'Cancel by', tone: 'trial' },
          right: shortDate(s.cancelByDate, today),
          accessibilityLabel: `${s.name}, ${subtitle}`,
        },
      });
    }
    if (hasPromo(s) && s.promoEndDate! >= today) {
      const days = daysBetween(today, s.promoEndDate!);
      const up = s.regularAmount! - s.amount;
      const subtitle = `Promo ends ${inDays(days)}: ${formatMoney(s.amount, s.currency)} → ${formatMoney(s.regularAmount!, s.currency)} ${describeCycle(s.cycle).toLowerCase()}${up > 0 ? ` (+${formatMoney(up, s.currency)})` : ''}`;
      out.push({
        s,
        kind: 'promoEnd',
        date: s.promoEndDate!,
        model: {
          title: s.name,
          subtitle,
          badge: { label: 'Promo', tone: 'neutral' },
          right: shortDate(s.promoEndDate!, today),
          accessibilityLabel: `${s.name}, ${subtitle}`,
        },
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.s.name.localeCompare(b.s.name)));
}
