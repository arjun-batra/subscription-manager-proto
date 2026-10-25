/** What a Home row says. Pure, so it is tested in rows.test.ts. */
import { describeCycle, shortDate } from '../domain/dates';
import { formatMoney } from '../domain/money';
import {
  chargesBetween,
  describeTrialLeft,
  expectedAmount,
  isVariable,
  pastCharges,
  planStatus,
  trialDaysLeft,
  withActual,
  withoutActual,
} from '../domain/schedule';
import type { ActualCharge, LocalDate, Subscription } from '../domain/types';

export interface RowModel {
  title: string;
  subtitle: string;
  badge?: { label: string; tone: 'trial' | 'neutral' };
  /** The amount on the right: "Free", "CA$16.49" or "about CA$85.00". */
  right: string;
  accessibilityLabel: string;
}

/** "CA$85.00" or, for a variable bill, "about CA$85.00" (the current estimate). */
export function amountLabel(s: Subscription): string {
  const money = formatMoney(expectedAmount(s), s.currency);
  return isVariable(s) ? `about ${money}` : money;
}

export function upcomingRow(s: Subscription, next: LocalDate, today: LocalDate): RowModel {
  const when = next === today ? 'Today' : shortDate(next, today);
  const off = s.remindersEnabled ? '' : ' · reminder off';
  const trialLeft = trialDaysLeft(s, today);
  let model: Omit<RowModel, 'accessibilityLabel'>;
  if (trialLeft !== null) {
    model = {
      title: s.name,
      subtitle: `Trial ${describeTrialLeft(trialLeft)} · then ${amountLabel(s)} ${describeCycle(s.cycle).toLowerCase()}${off}`,
      badge: { label: 'Trial', tone: 'trial' },
      right: trialLeft > 0 ? 'Free' : amountLabel(s),
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
        ...(isVariable(s) ? { badge: { label: 'Varies', tone: 'neutral' as const } } : {}),
        right: amountLabel(s),
      };
    }
  }
  return {
    ...model,
    accessibilityLabel: `${s.name}${model.badge ? `, ${model.badge.label}` : ''}, ${model.right}, ${model.subtitle}`,
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
