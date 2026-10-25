/** A calendar date in the device's local time zone, formatted YYYY-MM-DD. */
export type LocalDate = string;

export type CycleUnit = 'day' | 'week' | 'month' | 'year';

/** "Every N units", e.g. { unit: 'month', every: 3 } is quarterly. */
export interface Cycle {
  unit: CycleUnit;
  every: number;
  /**
   * Monthly cycles only: charge on the nth weekday of the month (e.g. the 2nd Tuesday, or the
   * last Friday) instead of a day of the month. Null or absent: same day of the month as the anchor.
   */
  weekday?: WeekdayRule | null;
}

/** 0 = Sunday ... 6 = Saturday (JavaScript's getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** "The 2nd Tuesday": nth 1-4, or -1 for the last one in the month. */
export interface WeekdayRule {
  nth: 1 | 2 | 3 | 4 | -1;
  day: Weekday;
}

/** An amount the user logged for a past charge of a variable bill. */
export interface ActualCharge {
  /** The charge date it belongs to. */
  date: LocalDate;
  /** In the subscription's own currency. */
  amount: number;
}

/**
 * A charge the user marked as paid (possibly before its due date). Keyed by the charge date it
 * settles; `paidOn` is the day it was marked. Paying early moves the next due date on and
 * removes that charge's reminder.
 */
export interface PaymentRecord {
  /** The charge date this payment settles (one of the item's charge dates). */
  date: LocalDate;
  /** The local day the user marked it paid. */
  paidOn: LocalDate;
  /** What was paid, in the item's currency. */
  amount: number;
  /** True when marking it paid also logged the variable bill's actual (so undo removes both). */
  loggedActual?: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  /** Charge amount in the subscription's own currency (major units, e.g. 9.99). */
  amount: number;
  /** ISO-4217 code, upper case. */
  currency: string;
  cycle: Cycle;
  /**
   * The charge date the user entered ("next charge date"). Every other charge is
   * computed from this anchor, so a Jan 31 anchor stays on the 31st when it can
   * (Jan 31 -> Feb 28 -> Mar 31).
   */
  anchorDate: LocalDate;
  /**
   * Set when the anchor is the very first charge (a new subscription), so no earlier
   * charge is projected backwards as "paid". Null or absent means it was already running.
   */
  startDate?: LocalDate | null;
  /**
   * Free trial (subscriptions only): the day the trial ends and the first paid charge happens,
   * at `amount` (the price after the trial). Nothing is charged before it. Null or absent: no trial.
   */
  trialEndDate?: LocalDate | null;
  /**
   * Instalment plan: total number of payments of `amount`, the first on `startDate`.
   * The plan stops after the last payment. Null or absent: an ordinary subscription.
   */
  totalPayments?: number | null;
  /**
   * Variable bill (hydro, phone usage...): `amount` is the user's estimate. Once actual amounts are
   * logged, future charges use the average of the last 3 (see expectedAmount). Plans never vary.
   */
  variable?: boolean;
  /** Logged actual amounts for past charges, at most one per charge date. */
  actuals?: ActualCharge[];
  /**
   * Picked logo: `brand:<slug>`, `icon:<key>` or `icon:<key>:<colour>` (see domain/logo.ts).
   * Null or absent: Automatic (match a brand by name, else a coloured first letter).
   */
  logo?: string | null;
  /** Charges marked paid, at most one per charge date. */
  payments?: PaymentRecord[];
  /**
   * Promotional price: `amount` is the promo price, charged before this date; charges on or after
   * it are `regularAmount` (e.g. Rogers' first-12-months price). Not for plans or variable bills.
   */
  promoEndDate?: LocalDate | null;
  /** The regular price after the promo, in the item's currency. Set together with promoEndDate. */
  regularAmount?: number | null;
  /** Optional deadline to cancel by (a trial, a contract notice period). Reminders 3 and 1 day before. */
  cancelByDate?: LocalDate | null;
  /**
   * When a deadline (trial end, cancel-by, promo end) was last set or changed (ISO). A catch-up
   * reminder for a deadline saved too late for its lead reminders keys on this, not on updatedAt,
   * so marking paid or other edits don't send it again.
   */
  deadlineSetAt?: string | null;
  categoryIds: string[];
  notes: string;
  manageUrl: string;
  remindersEnabled: boolean;
  cancelled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Settings {
  homeCurrency: string;
  /** Hand-entered rates: 1 unit of the key currency = rate units of homeCurrency. */
  rates: Record<string, number>;
  ratesUpdatedAt: string | null;
  /** Days before a charge that the reminder fires. */
  leadDays: number;
  /** Local hour (0-23) that reminders fire. */
  reminderHour: number;
}

export const DEFAULT_SETTINGS: Settings = {
  homeCurrency: 'CAD',
  rates: {},
  ratesUpdatedAt: null,
  leadDays: 2,
  reminderHour: 9,
};

export const UNCATEGORIZED_ID = '__uncategorized__';
export const UNCATEGORIZED_NAME = 'Uncategorized';
