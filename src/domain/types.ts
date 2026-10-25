/** A calendar date in the device's local time zone, formatted YYYY-MM-DD. */
export type LocalDate = string;

export type CycleUnit = 'day' | 'week' | 'month' | 'year';

/** "Every N units", e.g. { unit: 'month', every: 3 } is quarterly. */
export interface Cycle {
  unit: CycleUnit;
  every: number;
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
