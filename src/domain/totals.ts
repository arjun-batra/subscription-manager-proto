import { addDays, monthBounds, toLocalDate } from './dates';
import { toHome } from './money';
import { amountForCharge, chargesBetween, expectedAmount, hasPromo, inTrial, isCompleted, isPlan, isVariable, paymentFor, planStatus, priceOn } from './schedule';
import {
  UNCATEGORIZED_ID,
  UNCATEGORIZED_NAME,
  type Category,
  type Cycle,
  type LocalDate,
  type PaymentRecord,
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

/**
 * Average per month at the expected amount (a variable bill's estimate). With `on`, at the price
 * that applies on that day (the regular price once a promo has ended).
 */
export function monthlyEquivalent(sub: Subscription, on?: LocalDate): number {
  return (on ? priceOn(sub, on) : expectedAmount(sub)) * chargesPerMonth(sub.cycle);
}

/** Every category an item counts in: its known categories, or Uncategorized. */
export function categoryIdsOf(sub: Subscription, categories: Category[]): string[] {
  const known = new Set(categories.map((c) => c.id));
  const ids = [...new Set(sub.categoryIds.filter((id) => known.has(id)))];
  return ids.length ? ids : [UNCATEGORIZED_ID];
}

/** The category filter on Home: null means All. */
export function filterByCategory(subs: Subscription[], categories: Category[], categoryId: string | null): Subscription[] {
  if (categoryId === null) return subs;
  return subs.filter((s) => categoryIdsOf(s, categories).includes(categoryId));
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
  /** Unfinished plans left out of plansRemaining because their currency has no rate yet (T5). */
  plansMissingRate: Subscription[];
  /** Active items whose promo price hasn't ended yet. */
  promoCount: number;
  /** overall.monthly as it will be once every current promo has ended (regular prices). */
  monthlyAfterPromos: number;
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
  const catIds = (sub: Subscription) => categoryIdsOf(sub, categories);
  const missingPerCat = new Map<string, Subscription[]>();
  const perCat = new Map<string, NormalizedTotal>();
  for (const c of categories) perCat.set(c.id, { monthly: 0, yearly: 0, count: 0 });
  perCat.set(UNCATEGORIZED_ID, { monthly: 0, yearly: 0, count: 0 });

  const overall: NormalizedTotal = { monthly: 0, yearly: 0, count: 0 };
  const missingRate: Subscription[] = [];
  let plansRemaining = 0;
  let planCount = 0;
  const plansMissingRate: Subscription[] = [];
  let promoCount = 0;
  let monthlyAfterPromos = 0;

  for (const sub of active(subs).filter((s) => !isCompleted(s, today))) {
    // Promos: the price that applies today (the regular price once the promo has ended).
    const monthly = toHome(inTrial(sub, today) ? 0 : monthlyEquivalent(sub, today), sub.currency, settings);
    if (monthly === null) {
      missingRate.push(sub);
      if (isPlan(sub)) plansMissingRate.push(sub);
      for (const id of catIds(sub)) missingPerCat.set(id, [...(missingPerCat.get(id) ?? []), sub]);
      continue;
    }
    overall.monthly += monthly;
    overall.yearly += monthly * 12;
    overall.count += 1;
    if (hasPromo(sub) && today < sub.promoEndDate!) {
      promoCount += 1;
      monthlyAfterPromos += toHome(sub.regularAmount! * chargesPerMonth(sub.cycle), sub.currency, settings) ?? 0;
    } else {
      monthlyAfterPromos += monthly;
    }
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
    plansMissingRate,
    promoCount,
    monthlyAfterPromos,
  };
}

export interface MonthCharge {
  sub: Subscription;
  date: LocalDate;
  homeAmount: number | null;
  /** Due before today, or marked paid. */
  paid: boolean;
}

/**
 * One payment in the "Paid this month" list: a charge that was billed (its date has passed and it
 * wasn't marked) or a charge marked paid during this month, including one paid early for a later
 * charge. A charge marked in an earlier month isn't here (that money went out then).
 */
export interface PaidEntry {
  sub: Subscription;
  /** The charge date it settles. */
  chargeDate: LocalDate;
  /** The day the money went out: the day it was marked, else the charge date. */
  paidOn: LocalDate;
  /** In the item's currency: the logged actual, else the marked amount, else the price on that date. */
  amount: number;
  /** In the home currency; null when the currency has no rate yet (left out of the total). */
  homeAmount: number | null;
  /** A variable bill with no logged actual: the amount is an estimate. */
  estimated: boolean;
  /** The marked payment, when there is one (Undo Paid reverts it). */
  record: PaymentRecord | null;
  /** Marked before its charge date. */
  early: boolean;
}

/** Newest first: by the day paid, then the charge date, then name. */
function byRecent(a: PaidEntry, b: PaidEntry): number {
  if (a.paidOn !== b.paidOn) return a.paidOn > b.paidOn ? -1 : 1;
  if (a.chargeDate !== b.chargeDate) return a.chargeDate > b.chargeDate ? -1 : 1;
  return a.sub.name.localeCompare(b.sub.name);
}

/**
 * Everything paid in the calendar month of `today`, up to today, newest first. Unmarked charges
 * count once their date has passed (a charge due today is still due, as in stillDue) and only on
 * items that aren't cancelled; marked payments count on the day they were marked, even on an item
 * cancelled since. Trials add nothing until their first paid charge; each plan instalment is a charge.
 */
export function paidEntries(subs: Subscription[], settings: Settings, today: LocalDate): PaidEntry[] {
  const { start } = monthBounds(today);
  const out: PaidEntry[] = [];
  const entry = (sub: Subscription, chargeDate: LocalDate, record: PaymentRecord | null): PaidEntry => {
    const amount = amountForCharge(sub, chargeDate);
    const logged = sub.actuals?.some((a) => a.date === chargeDate) ?? false;
    return {
      sub,
      chargeDate,
      paidOn: record?.paidOn ?? chargeDate,
      amount,
      homeAmount: toHome(amount, sub.currency, settings),
      estimated: isVariable(sub) && !logged,
      record,
      early: !!record && chargeDate > record.paidOn,
    };
  };
  if (today > start) {
    const yesterday = addDays(today, -1);
    for (const sub of active(subs)) {
      for (const date of chargesBetween(sub, start, yesterday)) {
        if (!paymentFor(sub, date)) out.push(entry(sub, date, null));
      }
    }
  }
  for (const sub of subs) {
    for (const p of sub.payments ?? []) {
      if (p.paidOn >= start && p.paidOn <= today) out.push(entry(sub, p.date, p));
    }
  }
  return out.sort(byRecent);
}

export interface MonthTotals {
  /** paidSoFar + stillDue: the money going out this calendar month, paid or still to pay. */
  thisMonth: number;
  /** Charges due today or later this month and not marked paid (a charge due today is still due). */
  stillDue: number;
  /** The sum of `paid` (the "Paid this month" list), in the home currency. */
  paidSoFar: number;
  /** The "Paid this month" list, newest first. */
  paid: PaidEntry[];
  /** First day of this calendar month. */
  monthStart: LocalDate;
  charges: MonthCharge[];
  /** Subscriptions with a charge or payment this month but no exchange rate. */
  missingRate: Subscription[];
}

/**
 * Current-calendar-month totals for the device's local "today", counted by the day money goes out
 * (Decision 54, revised): paid so far is the "Paid this month" list; still due is this month's
 * charges from today on that aren't marked. A charge of this month paid early last month is in
 * neither (it was paid last month). Trials add nothing before their end date; plans stop after
 * their last payment.
 */
export function computeMonthTotals(
  subs: Subscription[],
  settings: Settings,
  today: LocalDate,
): MonthTotals {
  const { start, end } = monthBounds(today);
  let stillDue = 0;
  const charges: MonthCharge[] = [];
  const missing = new Map<string, Subscription>();

  for (const sub of active(subs)) {
    for (const date of chargesBetween(sub, start, end)) {
      // Variable bills: the logged actual where there is one, else the estimate. Promos: the
      // regular price from the end date. Marked payments: what was paid.
      const homeAmount = toHome(amountForCharge(sub, date), sub.currency, settings);
      const paid = date < today || !!paymentFor(sub, date);
      charges.push({ sub, date, homeAmount, paid });
      if (homeAmount === null) {
        if (!paid) missing.set(sub.id, sub);
        continue;
      }
      if (!paid) stillDue += homeAmount;
    }
  }
  const paid = paidEntries(subs, settings, today);
  let paidSoFar = 0;
  for (const e of paid) {
    if (e.homeAmount === null) missing.set(e.sub.id, e.sub);
    else paidSoFar += e.homeAmount;
  }
  charges.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    thisMonth: paidSoFar + stillDue,
    stillDue,
    paidSoFar,
    paid,
    monthStart: start,
    charges,
    missingRate: [...missing.values()],
  };
}
