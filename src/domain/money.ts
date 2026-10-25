import type { Settings } from './types';

/**
 * Converts an amount into the home currency with the hand-entered rate.
 * Returns null when no rate exists yet; callers must surface that, never drop it silently.
 */
export function toHome(amount: number, currency: string, settings: Settings): number | null {
  const code = currency.toUpperCase();
  if (code === settings.homeCurrency.toUpperCase()) return amount;
  const rate = settings.rates[code];
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) return null;
  return amount * rate;
}

/** Currency codes whose symbol alone is ambiguous get a country prefix (US$, CA$, A$). */
const SYMBOLS: Record<string, string> = {
  USD: 'US$',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  JPY: '¥',
};

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

/** Rounds only here, at display time. */
export function formatMoney(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits = ZERO_DECIMAL.has(code) ? 0 : 2;
  const fixed = Math.abs(amount).toFixed(digits);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${grouped}.${frac}` : grouped;
  const sign = amount < 0 && Number(fixed) !== 0 ? '-' : '';
  const symbol = SYMBOLS[code];
  return symbol ? `${sign}${symbol}${body}` : `${sign}${body} ${code}`;
}

export const COMMON_CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'INR', 'AUD', 'JPY'];

export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code.trim().toUpperCase());
}

/**
 * Rates are stored as "1 X = r home", so they mean nothing once the home currency
 * changes. Changing it clears every rate; affected items then show "rate needed".
 * Returns the codes that were cleared so the UI can tell the user.
 */
export function changeHomeCurrency(settings: Settings, code: string): { settings: Settings; cleared: string[] } {
  const next = code.trim().toUpperCase();
  if (next === settings.homeCurrency.toUpperCase()) return { settings, cleared: [] };
  return {
    settings: { ...settings, homeCurrency: next, rates: {}, ratesUpdatedAt: null },
    cleared: Object.keys(settings.rates).sort(),
  };
}
