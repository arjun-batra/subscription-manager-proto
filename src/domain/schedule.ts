import { nextOnOrAfter, occurrencesBetween } from './dates';
import type { Cycle, LocalDate, Subscription } from './types';

/** The earliest date a charge can fall on: the first charge for new items, otherwise unbounded. */
function floor(sub: Subscription, date: LocalDate): LocalDate {
  return sub.startDate && sub.startDate > date ? sub.startDate : date;
}

/** Next charge on or after `date`, never before the first charge of a new subscription. */
export function nextCharge(sub: Subscription, date: LocalDate): LocalDate {
  return nextOnOrAfter(sub.anchorDate, sub.cycle, floor(sub, date));
}

/** Charges in [start, end], excluding projected charges before a new subscription's first charge. */
export function chargesBetween(sub: Subscription, start: LocalDate, end: LocalDate): LocalDate[] {
  return occurrencesBetween(sub.anchorDate, sub.cycle, start, end).filter(
    (d) => !sub.startDate || d >= sub.startDate,
  );
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
