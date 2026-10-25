import { monthBounds, toLocalDate } from './dates';
import { toHome } from './money';
import { chargesBetween, inTrial, isCompleted, planStatus } from './schedule';
import {
  UNCATEGORIZED_ID,
  UNCATEGORIZED_NAME,
  type Category,
  type Cycle,
  type LocalDate,
  type Settings,
  type Subscription,
} from './types';

/**
 * Charges per month for one cycle. Documented formulas:
 * day: 365/12/N, week: 52/12/N, month: 1/N, year: 1/(12N).
 */
export function chargesPerMonth(cycle: Cycle): number {
  switch (cycle.unit) {
    case 'day':
      return 365 / 12 / cycle.every;
    case 'week':
      return 52 / 12 / cycle.every;
    case 'month':
      return 1 / cycle.every;
    case 'year':
      return 1 / (12 * cycle.every);
  }
}

export function monthlyEquivalent(sub: Subscription): number {
  return sub.amount * chargesPerMonth(sub.cycle);
}

export interface NormalizedTotal {
  monthly: number;
  yearly: number;
  count: number;
}

export interface CategoryTotal extends NormalizedTotal {
  id: string;
  name: string;
  /** Active items in this category left out because their currency has no rate yet. */
  missingRate: Subscription[];
}

export interface TotalsResult {
  overall: NormalizedTotal;
  categories: CategoryTotal[]; // user categories sorted by name, then Uncategorized last
  /** Active subscriptions left out of totals because their currency has no rate yet. */
  missingRate: Subscription[];
  /** True when category totals add up to more than the overall total (multi-category items). */
  categorySumExceedsOverall: boolean;
  /** What's left to pay on unfinished instalment plans, in the home currency (plans with a rate). */
  plansRemaining: number;
  /** Unfinished plans counted in plansRemaining. */
  planCount: number;
}

const active = (subs: Subscription[]) => subs.filter((s) => !s.cancelled);

/**
 * Normalized totals overall and per category, in the home currency.
 * Each subscription counts once overall and in full in each of its categories.
 * Items with no exchange rate are excluded and listed in missingRate (Decision D2).
 * A trial counts as 0 until its end date, then at its post-trial price (FR-004, FR-007).
 * An instalment plan counts while payments remain, and drops out once it's completed.
 */
export function computeTotals(
  subs: Subscription[],
  categories: Category[],
  settings: Settings,
  today: LocalDate = toLocalDate(new Date()),
): TotalsResult {
  const known = new Set(categories.map((c) => c.id));
  const catIds = (sub: Subscription) => {
    const ids = [...new Set(sub.categoryIds.filter((id) => known.has(id)))];
    return ids.length ? ids : [UNCATEGORIZED_ID];
  };
  const missingPerCat = new Map<string, Subscription[]>();
  const perCat = new Map<string, NormalizedTotal>();
  for (const c of categories) perCat.set(c.id, { monthly: 0, yearly: 0, count: 0 });
  perCat.set(UNCATEGORIZED_ID, { monthly: 0, yearly: 0, count: 0 });

  const overall: NormalizedTotal = { monthly: 0, yearly: 0, count: 0 };
  const missingRate: Subscription[] = [];
  let plansRemaining = 0;
  let planCount = 0;

  for (const sub of active(subs).filter((s) => !isCompleted(s, today))) {
    const monthly = toHome(inTrial(sub, today) ? 0 : monthlyEquivalent(sub), sub.currency, settings);
    if (monthly === null) {
      missingRate.push(sub);
      for (const id of catIds(sub)) missingPerCat.set(id, [...(missingPerCat.get(id) ?? []), sub]);
      continue;
    }
    overall.monthly += monthly;
    overall.yearly += monthly * 12;
    overall.count += 1;
    const plan = planStatus(sub, today);
    if (plan) {
      plansRemaining += toHome(plan.remainingAmount, sub.currency, settings) ?? 0;
      planCount += 1;
    }

    for (const id of catIds(sub)) {
      const t = perCat.get(id)!;
      t.monthly += monthly;
      t.yearly += monthly * 12;
      t.count += 1;
    }
  }

  const sorted = [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  const result: CategoryTotal[] = sorted.map((c) => ({
    id: c.id,
    name: c.name,
    ...perCat.get(c.id)!,
    missingRate: missingPerCat.get(c.id) ?? [],
  }));
  result.push({
    id: UNCATEGORIZED_ID,
    name: UNCATEGORIZED_NAME,
    ...perCat.get(UNCATEGORIZED_ID)!,
    missingRate: missingPerCat.get(UNCATEGORIZED_ID) ?? [],
  });

  const sum = result.reduce((acc, c) => acc + c.monthly, 0);
  return {
    overall,
    categories: result,
    missingRate,
    categorySumExceedsOverall: sum - overall.monthly > 1e-9,
    plansRemaining,
    planCount,
  };
}

export interface MonthCharge {
  sub: Subscription;
  date: LocalDate;
  homeAmount: number | null;
}

export interface MonthTotals {
  /** Every charge due this calendar month. */
  thisMonth: number;
  /** Charges due today or later this month (a charge due today is still due). */
  stillDue: number;
  /** thisMonth - stillDue. */
  paidSoFar: number;
  charges: MonthCharge[];
  /** Subscriptions with a charge this month but no exchange rate. */
  missingRate: Subscription[];
}

/**
 * Current-calendar-month totals for the device's local "today". Trials add nothing before their
 * end date (the first paid charge counts on that day); plans stop after their last payment.
 */
export function computeMonthTotals(
  subs: Subscription[],
  settings: Settings,
  today: LocalDate,
): MonthTotals {
  const { start, end } = monthBounds(today);
  let thisMonth = 0;
  let stillDue = 0;
  const charges: MonthCharge[] = [];
  const missing = new Map<string, Subscription>();

  for (const sub of active(subs)) {
    for (const date of chargesBetween(sub, start, end)) {
      const homeAmount = toHome(sub.amount, sub.currency, settings);
      charges.push({ sub, date, homeAmount });
      if (homeAmount === null) {
        missing.set(sub.id, sub);
        continue;
      }
      thisMonth += homeAmount;
      if (date >= today) stillDue += homeAmount;
    }
  }
  charges.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    thisMonth,
    stillDue,
    paidSoFar: Math.max(0, thisMonth - stillDue),
    charges,
    missingRate: [...missing.values()],
  };
}
