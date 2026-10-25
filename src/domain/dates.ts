import type { Cycle, LocalDate } from './types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export function daysInMonth(y: number, m: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseLocalDate(s: string): YMD | null {
  const match = ISO_RE.exec(s.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isValidLocalDate(s: string): boolean {
  return parseLocalDate(s) !== null;
}

function mustParse(s: LocalDate): YMD {
  const p = parseLocalDate(s);
  if (!p) throw new Error(`Invalid date: ${s}`);
  return p;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatYMD({ y, m, d }: YMD): LocalDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Today's date in the device's local time zone. */
export function toLocalDate(now: Date): LocalDate {
  return formatYMD({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

/** A local Date at the given hour on the given local date. */
export function atLocalTime(date: LocalDate, hour: number, minute = 0): Date {
  const { y, m, d } = mustParse(date);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { y, m, d } = mustParse(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatYMD({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Adds months, clamping to the last day of shorter months (Jan 31 + 1 = Feb 28/29). */
export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const { y, m, d } = mustParse(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatYMD({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const pa = mustParse(a);
  const pb = mustParse(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000,
  );
}

/**
 * The k-th charge date counted from the anchor (k may be negative).
 * Always computed from the anchor, never from the previous charge, so month-end
 * dates return to their original day after a short month.
 */
export function occurrence(anchor: LocalDate, cycle: Cycle, k: number): LocalDate {
  const n = k * cycle.every;
  switch (cycle.unit) {
    case 'day':
      return addDays(anchor, n);
    case 'week':
      return addDays(anchor, n * 7);
    case 'month':
      return addMonthsClamped(anchor, n);
    case 'year':
      return addMonthsClamped(anchor, n * 12);
  }
}

/** Approximate cycle length in days; only used to jump close to a target date. */
function approxCycleDays(cycle: Cycle): number {
  const per = { day: 1, week: 7, month: 30.436875, year: 365.2425 }[cycle.unit];
  return per * cycle.every;
}

/** Smallest k such that occurrence(anchor, cycle, k) >= date. */
export function firstIndexOnOrAfter(anchor: LocalDate, cycle: Cycle, date: LocalDate): number {
  let k = Math.floor(daysBetween(anchor, date) / approxCycleDays(cycle)) - 1;
  while (occurrence(anchor, cycle, k) >= date) k -= 1;
  while (occurrence(anchor, cycle, k) < date) k += 1;
  return k;
}

/** The first charge on or after `date`, projecting backwards or forwards from the anchor. */
export function nextOnOrAfter(anchor: LocalDate, cycle: Cycle, date: LocalDate): LocalDate {
  return occurrence(anchor, cycle, firstIndexOnOrAfter(anchor, cycle, date));
}

/** All charge dates d with start <= d <= end (inclusive), projecting both ways from the anchor. */
export function occurrencesBetween(
  anchor: LocalDate,
  cycle: Cycle,
  start: LocalDate,
  end: LocalDate,
): LocalDate[] {
  const out: LocalDate[] = [];
  for (let k = firstIndexOnOrAfter(anchor, cycle, start); ; k += 1) {
    const d = occurrence(anchor, cycle, k);
    if (d > end) break;
    out.push(d);
  }
  return out;
}

export function monthBounds(today: LocalDate): { start: LocalDate; end: LocalDate } {
  const { y, m } = mustParse(today);
  return {
    start: formatYMD({ y, m, d: 1 }),
    end: formatYMD({ y, m, d: daysInMonth(y, m) }),
  };
}

export function isValidCycle(c: Cycle): boolean {
  return (
    ['day', 'week', 'month', 'year'].includes(c.unit) &&
    Number.isInteger(c.every) &&
    c.every >= 1 &&
    c.every <= 365
  );
}

export function describeCycle(c: Cycle): string {
  if (c.every === 1) {
    return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[c.unit];
  }
  if (c.unit === 'month' && c.every === 3) return 'Quarterly';
  return `Every ${c.every} ${c.unit}s`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 5" or "Nov 5, 2027" when not in the reference year. */
export function shortDate(date: LocalDate, referenceToday?: LocalDate): string {
  const { y, m, d } = mustParse(date);
  const sameYear = referenceToday ? mustParse(referenceToday).y === y : false;
  return `${MONTHS[m - 1]} ${d}${sameYear ? '' : `, ${y}`}`;
}
