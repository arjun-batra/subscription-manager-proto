import type { Cycle, LocalDate, Weekday, WeekdayRule } from './types';

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

/**
 * Today's date in the device's current time zone. The app always uses the device zone;
 * `timeZone` (IANA name) exists so tests can show what a zone change does at one instant.
 */
export function toLocalDate(now: Date, timeZone?: string): LocalDate {
  if (!timeZone) return formatYMD({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(now)
    .reduce<Record<string, number>>((acc, p) => (p.type === 'literal' ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  return formatYMD({ y: parts.year, m: parts.month, d: parts.day });
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

/** Day of the week of a local date, 0 = Sunday. */
export function weekdayOf(date: LocalDate): Weekday {
  const { y, m, d } = mustParse(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

/** The date of "the nth weekday" in a month (nth -1 = the last one). */
export function nthWeekdayOfMonth(y: number, m: number, rule: WeekdayRule): LocalDate {
  if (rule.nth === -1) {
    const last = daysInMonth(y, m);
    const lastDow = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
    return formatYMD({ y, m, d: last - ((lastDow - rule.day + 7) % 7) });
  }
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return formatYMD({ y, m, d: 1 + ((rule.day - firstDow + 7) % 7) + (rule.nth - 1) * 7 });
}

/**
 * The rules a date satisfies, for offering them in the editor: "the 3rd Tuesday" (days 1-28)
 * and, in the last 7 days of the month, "the last Tuesday". Day 29-31 only has "last".
 */
export function weekdayRulesFor(date: LocalDate): WeekdayRule[] {
  const { y, m, d } = mustParse(date);
  const day = weekdayOf(date);
  const out: WeekdayRule[] = [];
  const nth = Math.ceil(d / 7);
  if (nth <= 4) out.push({ nth: nth as 1 | 2 | 3 | 4, day });
  if (d + 7 > daysInMonth(y, m)) out.push({ nth: -1, day });
  return out;
}

/** The first date on or after `date` that matches the rule. */
export function nextWeekdayRuleDate(date: LocalDate, rule: WeekdayRule): LocalDate {
  const { y, m } = mustParse(date);
  const here = nthWeekdayOfMonth(y, m, rule);
  if (here >= date) return here;
  const next = addMonthsClamped(formatYMD({ y, m, d: 1 }), 1);
  const n = mustParse(next);
  return nthWeekdayOfMonth(n.y, n.m, rule);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last' };

/** "2nd Tuesday", "last Friday"; short: "2nd Tue". */
export function describeWeekdayRule(rule: WeekdayRule, short = false): string {
  const name = WEEKDAY_NAMES[rule.day];
  return `${ORDINALS[String(rule.nth)]} ${short ? name.slice(0, 3) : name}`;
}

/** Parses "2nd tue", "last friday", "3rd Wednesday". */
export function parseWeekdayRule(raw: string): WeekdayRule | null {
  const m = /^(1st|2nd|3rd|4th|last)\s+([a-z]+)$/.exec(raw.trim().toLowerCase().replace(/\s+/g, ' '));
  if (!m) return null;
  const nth = ({ '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, last: -1 } as const)[m[1] as '1st'];
  const day = WEEKDAY_NAMES.findIndex((n) => {
    const l = n.toLowerCase();
    return m[2] === l || (m[2].length >= 3 && l.startsWith(m[2]));
  });
  return day < 0 ? null : { nth, day: day as Weekday };
}

export function isValidWeekdayRule(r: WeekdayRule): boolean {
  return [1, 2, 3, 4, -1].includes(r.nth) && Number.isInteger(r.day) && r.day >= 0 && r.day <= 6;
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
    case 'month': {
      if (!cycle.weekday) return addMonthsClamped(anchor, n);
      // "2nd Tuesday": same rule in the anchor's month + n months. Pure calendar maths, so DST
      // and time zones don't move it.
      const { y, m } = mustParse(addMonthsClamped(anchor, n));
      return nthWeekdayOfMonth(y, m, cycle.weekday);
    }
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
    c.every <= 365 &&
    (!c.weekday || (c.unit === 'month' && isValidWeekdayRule(c.weekday)))
  );
}

export function describeCycle(c: Cycle): string {
  const base = describeBaseCycle(c);
  return c.unit === 'month' && c.weekday ? `${base} on the ${describeWeekdayRule(c.weekday)}` : base;
}

function describeBaseCycle(c: Cycle): string {
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
