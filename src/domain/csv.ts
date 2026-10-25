import { formatLogo, normalizeLogo, parseLogo } from './logo';
import { describeCycle, describeWeekdayRule, isValidCycle, isValidLocalDate, nextOnOrAfter, parseWeekdayRule, toLocalDate } from './dates';
import { isValidCurrency } from './money';
import { MAX_PLAN_PAYMENTS } from './schedule';
import type { ActualCharge, Category, Cycle, LocalDate, PaymentRecord, Subscription } from './types';

/** RFC 4180-style parser: quoted fields, "" escapes, CRLF/LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // Excel in some locales saves with semicolons; detect from the header line.
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'service', 'subscription'],
  amount: ['amount', 'price', 'cost'],
  currency: ['currency'],
  cycle: ['cycle', 'billing cycle', 'frequency'],
  next: ['next charge date', 'next date', 'next charge', 'next_charge_date', 'date'],
  categories: ['categories', 'category'],
  notes: ['notes', 'note'],
  manageUrl: ['manage url', 'manage_url', 'url', 'link'],
  status: ['status'],
  reminders: ['reminders', 'reminder'],
  start: ['first charge date', 'start date', 'first charge', 'first payment date'],
  trial: ['trial end date', 'trial end', 'trial ends'],
  payments: ['total payments', 'number of payments', 'payments'],
  varies: ['varies', 'variable'],
  actuals: ['actuals', 'actual amounts'],
  logo: ['logo', 'icon'],
  promoEnds: ['promo ends', 'promo end date', 'promo end', 'promo price ends'],
  regular: ['regular price', 'price after promo', 'regular amount'],
  cancelBy: ['cancel by', 'cancel by date', 'cancellation deadline'],
  paid: ['paid', 'marked paid', 'paid charges'],
};
const REQUIRED = ['name', 'amount', 'currency', 'cycle', 'next'] as const;
const LABEL: Record<string, string> = {
  name: 'name',
  amount: 'amount',
  currency: 'currency',
  cycle: 'cycle',
  next: 'next charge date',
};

export const CSV_COLUMNS = [
  'name',
  'amount',
  'currency',
  'cycle',
  'next charge date',
  'categories',
  'notes',
  'manage url',
  'status',
  'reminders',
  'first charge date',
  'trial end date',
  'total payments',
  'varies',
  'actuals',
  'logo',
  'promo ends',
  'regular price',
  'cancel by',
  'paid',
];

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * True when the export prefixes `'`: the value starts like a formula, or is already
 * `'`-prefixed in front of one (so a real leading `'` like "'-quoted" survives the round trip).
 */
function needsGuard(v: string): boolean {
  return FORMULA_START.test(v) || (v.startsWith("'") && needsGuard(v.slice(1)));
}

/** Undoes the export's formula guard: drops the one leading ' that esc() added. */
function unguard(v: string): string {
  return v.startsWith("'") && needsGuard(v.slice(1)) ? v.slice(1) : v;
}

/**
 * "monthly", "every 2 weeks", "quarterly", "every 10 days", ... Monthly cycles can add a weekday
 * rule: "monthly on the 2nd tuesday", "every 2 months on the last fri".
 */
export function parseCycle(raw: string): Cycle | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const on = /^(.+?) on the (.+)$/.exec(s);
  if (on) {
    const base = parseCycle(on[1]);
    const weekday = parseWeekdayRule(on[2]);
    if (!base || !weekday || base.unit !== 'month') return null;
    return { ...base, weekday };
  }
  const simple: Record<string, Cycle> = {
    daily: { unit: 'day', every: 1 },
    weekly: { unit: 'week', every: 1 },
    biweekly: { unit: 'week', every: 2 },
    fortnightly: { unit: 'week', every: 2 },
    monthly: { unit: 'month', every: 1 },
    quarterly: { unit: 'month', every: 3 },
    'semi-annually': { unit: 'month', every: 6 },
    yearly: { unit: 'year', every: 1 },
    annually: { unit: 'year', every: 1 },
    annual: { unit: 'year', every: 1 },
  };
  if (simple[s]) return simple[s];
  const m = /^every (\d+) (day|week|month|year)s?$/.exec(s);
  if (!m) return null;
  const cycle = { unit: m[2] as Cycle['unit'], every: Number(m[1]) };
  return isValidCycle(cycle) ? cycle : null;
}

export interface ImportDraft {
  name: string;
  amount: number;
  currency: string;
  cycle: Cycle;
  anchorDate: LocalDate;
  categoryNames: string[];
  notes: string;
  manageUrl: string;
  cancelled: boolean;
  remindersEnabled: boolean;
  /** Set when the file marks this date as the first charge (nothing paid before it). */
  startDate: LocalDate | null;
  /** Free trial end (the first paid charge); `amount` is the price after the trial. */
  trialEndDate: LocalDate | null;
  /** Instalment plan: number of payments, the first on startDate (or the next charge date). */
  totalPayments: number | null;
  /** Variable bill: `amount` is the estimate. */
  variable: boolean;
  /** Logged actual amounts for past charges. */
  actuals: ActualCharge[];
  /** Picked logo (`brand:…` / `icon:…`), or null for Automatic. */
  logo: string | null;
  /** Promo price (`amount`) ends on this date; charges from then on are `regularAmount`. */
  promoEndDate: LocalDate | null;
  regularAmount: number | null;
  /** Deadline to cancel by. */
  cancelByDate: LocalDate | null;
  /** Charges marked paid. */
  payments: PaymentRecord[];
}

/** Paid cell: "2026-11-05@2026-11-01=16.49; …" (charge date @ day paid = amount, ; separated). */
export function formatPayments(payments: PaymentRecord[] | undefined): string {
  return [...(payments ?? [])]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((p) => `${p.date}@${p.paidOn}=${p.amount}`)
    .join('; ');
}

/** Parses the paid cell, or returns an error message. */
export function parsePaymentsCell(raw: string): { payments: PaymentRecord[] } | { error: string } {
  const out: PaymentRecord[] = [];
  for (const part of raw.split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d{4}-\d{2}-\d{2})\s*@\s*(\d{4}-\d{2}-\d{2})\s*=\s*(\d+(?:\.\d+)?)$/.exec(part);
    if (!m || !isValidLocalDate(m[1]) || !isValidLocalDate(m[2])) {
      return { error: `paid must look like 2026-11-05@2026-11-01=16.49 (charge date@day paid=amount); “${part}” doesn’t` };
    }
    if (out.some((p) => p.date === m[1])) return { error: `paid lists ${m[1]} twice` };
    out.push({ date: m[1], paidOn: m[2], amount: Number(m[3]) });
  }
  return { payments: out };
}

/** Compact actuals cell: "2026-09-01=84.12; 2026-10-01=91.3" (date=amount pairs, ; separated). */
export function formatActuals(actuals: ActualCharge[] | undefined): string {
  return [...(actuals ?? [])]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((a) => `${a.date}=${a.amount}`)
    .join('; ');
}

/** Parses the actuals cell, or returns an error message. */
export function parseActualsCell(raw: string): { actuals: ActualCharge[] } | { error: string } {
  const out: ActualCharge[] = [];
  for (const part of raw.split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d{4}-\d{2}-\d{2})\s*=\s*(\d+(?:\.\d+)?)$/.exec(part);
    if (!m || !isValidLocalDate(m[1])) return { error: `actuals must look like 2026-09-01=84.12; “${part}” doesn’t` };
    if (out.some((a) => a.date === m[1])) return { error: `actuals list ${m[1]} twice` };
    out.push({ date: m[1], amount: Number(m[2]) });
  }
  return { actuals: out };
}

export type RowStatus = 'valid' | 'duplicate' | 'invalid';

export interface PreviewRow {
  line: number; // 1-based line in the file, header is line 1
  status: RowStatus;
  reason?: string;
  draft?: ImportDraft;
  /** Default checkbox state: valid rows checked, duplicates unchecked, invalid never. */
  checked: boolean;
}

export type ImportPreview =
  | { ok: true; rows: PreviewRow[] }
  | { ok: false; error: string };

export function duplicateKey(name: string, amount: number, cycle: Cycle): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, ' ')}|${amount.toFixed(2)}|${cycle.unit}:${cycle.every}`;
}

/**
 * Parses a CSV into a preview. Nothing is written here. `today` (the local day) rejects actuals
 * and payments dated in the future.
 */
export function previewImport(text: string, existing: Subscription[], today: LocalDate = toLocalDate(new Date())): ImportPreview {
  const rows = parseCsv(text);
  if (!rows.length) return { ok: false, error: 'The file is empty.' };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const idx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) idx[key] = i;
  }
  const missing = REQUIRED.filter((k) => idx[k] === undefined);
  if (missing.length) {
    return {
      ok: false,
      error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((k) => LABEL[k]).join(', ')}. Nothing was imported.`,
    };
  }

  const seen = new Set(existing.filter((s) => !s.cancelled).map((s) => duplicateKey(s.name, s.amount, s.cycle)));
  const get = (r: string[], key: string) => (idx[key] === undefined ? '' : unguard((r[idx[key]] ?? '').trim()));

  const out: PreviewRow[] = rows.slice(1).map((r, i) => {
    const line = i + 2;
    const name = get(r, 'name');
    const amountRaw = get(r, 'amount').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
    const amount = Number(amountRaw);
    const currency = get(r, 'currency').toUpperCase();
    const cycle = parseCycle(get(r, 'cycle'));
    const anchorDate = get(r, 'next');
    const problems: string[] = [];
    if (!name) problems.push('name is empty');
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) problems.push('amount must be more than 0');
    if (!isValidCurrency(currency)) problems.push('currency must be a 3-letter code');
    if (!cycle) problems.push('cycle not recognised');
    if (!isValidLocalDate(anchorDate)) problems.push('date must be YYYY-MM-DD');
    const status = get(r, 'status').toLowerCase();
    if (!['', 'active', 'cancelled', 'canceled'].includes(status)) problems.push('status must be active or cancelled');
    const rem = get(r, 'reminders').toLowerCase();
    if (!['', 'on', 'off', 'yes', 'no', 'true', 'false'].includes(rem)) problems.push('reminders must be on or off');
    const startDate = get(r, 'start');
    if (startDate && !isValidLocalDate(startDate)) problems.push('first charge date must be YYYY-MM-DD');
    else if (startDate && isValidLocalDate(anchorDate) && startDate > anchorDate) {
      problems.push("first charge date can't be after the next charge date");
    }
    const onSchedule = (d: string) => !!cycle && isValidLocalDate(anchorDate) && nextOnOrAfter(anchorDate, cycle, d) === d;
    if (cycle?.weekday && isValidLocalDate(anchorDate) && !onSchedule(anchorDate)) {
      problems.push(`next charge date isn't the ${describeWeekdayRule(cycle.weekday)} of its month`);
    }
    const trialEnd = get(r, 'trial');
    if (trialEnd && !isValidLocalDate(trialEnd)) problems.push('trial end date must be YYYY-MM-DD');
    else if (trialEnd && isValidLocalDate(anchorDate) && anchorDate !== trialEnd) {
      // T2: the first charge happens the day the trial ends, so the two dates are the same day.
      problems.push('next charge date must be the trial end date (the first charge is when the trial ends)');
    }
    const paymentsRaw = get(r, 'payments');
    const totalPayments = paymentsRaw ? Number(paymentsRaw) : null;
    if (paymentsRaw && (!/^\d+$/.test(paymentsRaw) || totalPayments! < 1 || totalPayments! > MAX_PLAN_PAYMENTS)) {
      problems.push(`total payments must be a whole number from 1 to ${MAX_PLAN_PAYMENTS}`);
    }
    if (trialEnd && paymentsRaw) problems.push("a payment plan can't have a free trial");
    // T3: a plan's first payment has to be one of its payment dates, or "N of M paid" is off.
    if (paymentsRaw && startDate && isValidLocalDate(startDate) && !onSchedule(startDate)) {
      problems.push(`first payment date ${startDate} isn't on the ${cycle ? describeCycle(cycle).toLowerCase() : ''} schedule of the next charge date`);
    }
    const variesRaw = get(r, 'varies').toLowerCase();
    if (!['', 'yes', 'no', 'true', 'false', 'on', 'off', 'variable', 'fixed'].includes(variesRaw)) {
      problems.push('varies must be yes or no');
    }
    const variable = ['yes', 'true', 'on', 'variable'].includes(variesRaw);
    if (variable && paymentsRaw) problems.push("a payment plan's payments can't vary");
    const actualsCell = parseActualsCell(get(r, 'actuals'));
    let actuals: ActualCharge[] = [];
    if ('error' in actualsCell) problems.push(actualsCell.error);
    else {
      actuals = actualsCell.actuals;
      if (actuals.length && !variable) problems.push('actuals need varies set to yes');
      const off = actuals.find((a) => cycle && isValidLocalDate(anchorDate) && !onSchedule(a.date));
      if (off) problems.push(`actual for ${off.date} isn't a charge date`);
      const future = actuals.find((a) => a.date > today);
      if (future) problems.push(`actual for ${future.date} is in the future; log it after the charge`);
    }
    const promoEnds = get(r, 'promoEnds');
    const regularRaw = get(r, 'regular').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
    const regularAmount = regularRaw ? Number(regularRaw) : null;
    if (promoEnds && !isValidLocalDate(promoEnds)) problems.push('promo ends must be YYYY-MM-DD');
    if (regularRaw && (!Number.isFinite(regularAmount) || regularAmount! <= 0)) problems.push('regular price must be more than 0');
    if (!!promoEnds !== !!regularRaw) problems.push('promo ends and regular price go together');
    if (promoEnds && paymentsRaw) problems.push("a payment plan can't have a promo price");
    if (promoEnds && variable) problems.push("a bill that varies can't have a promo price");
    const cancelBy = get(r, 'cancelBy');
    if (cancelBy && !isValidLocalDate(cancelBy)) problems.push('cancel by must be YYYY-MM-DD');
    const paidCell = parsePaymentsCell(get(r, 'paid'));
    let payments: PaymentRecord[] = [];
    if ('error' in paidCell) problems.push(paidCell.error);
    else {
      payments = paidCell.payments;
      const off = payments.find((p) => cycle && isValidLocalDate(anchorDate) && !onSchedule(p.date));
      if (off) problems.push(`paid charge ${off.date} isn't a charge date`);
      const future = payments.find((p) => p.paidOn > today);
      if (future) problems.push(`paid on ${future.paidOn} is in the future`);
    }
    const logoCell = parseLogo(get(r, 'logo'));
    if ('error' in logoCell) problems.push(logoCell.error);
    if (problems.length || !cycle) {
      return { line, status: 'invalid', reason: problems.join('; '), checked: false };
    }
    const draft: ImportDraft = {
      name,
      amount,
      currency,
      cycle,
      anchorDate,
      categoryNames: get(r, 'categories')
        .split(/[;|]/)
        .map((c) => c.trim())
        .filter(Boolean),
      notes: get(r, 'notes'),
      manageUrl: get(r, 'manageUrl'),
      cancelled: status === 'cancelled' || status === 'canceled',
      remindersEnabled: !['off', 'no', 'false'].includes(rem),
      startDate: startDate || null,
      trialEndDate: trialEnd || null,
      totalPayments,
      variable,
      actuals,
      logo: 'ref' in logoCell ? formatLogo(logoCell.ref) || null : null,
      promoEndDate: promoEnds || null,
      regularAmount: promoEnds ? regularAmount : null,
      cancelByDate: cancelBy || null,
      payments,
    };
    const key = duplicateKey(name, amount, cycle);
    if (seen.has(key)) {
      return { line, status: 'duplicate', reason: 'Looks like one you already have', draft, checked: false };
    }
    seen.add(key);
    return { line, status: 'valid', draft, checked: true };
  });
  return { ok: true, rows: out };
}

/** Rows "Import all valid" writes: valid rows, plus any flagged duplicate the user ticked. */
export function importAllValidRows(rows: PreviewRow[]): PreviewRow[] {
  return rows.filter((r) => r.status === 'valid' || (r.status === 'duplicate' && r.checked));
}

export function importSelectedRows(rows: PreviewRow[]): PreviewRow[] {
  return rows.filter((r) => r.status !== 'invalid' && r.checked);
}

function cycleToCsv(c: Cycle): string {
  const base = c.every === 1 ? describeCycle({ unit: c.unit, every: 1 }).toLowerCase() : `every ${c.every} ${c.unit}s`;
  return c.unit === 'month' && c.weekday ? `${base} on the ${describeWeekdayRule(c.weekday, true).toLowerCase()}` : base;
}

/**
 * Quotes when needed, and prefixes ' to cells that a spreadsheet would run as a
 * formula (= + - @, tab, CR), per OWASP CSV-injection guidance. Import strips it again.
 */
export function esc(v: string): string {
  const safe = needsGuard(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Export in the same columns the importer reads, so files round-trip. */
export function toCsv(subs: Subscription[], categories: Category[]): string {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const lines = [CSV_COLUMNS.join(',')];
  for (const s of subs) {
    lines.push(
      [
        s.name,
        String(s.amount),
        s.currency,
        cycleToCsv(s.cycle),
        s.anchorDate,
        s.categoryIds.map((id) => names.get(id)).filter(Boolean).join('; '),
        s.notes,
        s.manageUrl,
        s.cancelled ? 'cancelled' : 'active',
        s.remindersEnabled ? 'on' : 'off',
        s.startDate ?? '',
        s.trialEndDate ?? '',
        s.totalPayments ? String(s.totalPayments) : '',
        s.variable ? 'yes' : '',
        s.variable ? formatActuals(s.actuals) : '',
        normalizeLogo(s.logo) ?? '',
        s.promoEndDate && s.regularAmount ? s.promoEndDate : '',
        s.promoEndDate && s.regularAmount ? String(s.regularAmount) : '',
        s.cancelByDate ?? '',
        formatPayments(s.payments),
      ]
        .map(esc)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export const CSV_TEMPLATE =
  CSV_COLUMNS.join(',') +
  '\r\nNetflix,16.49,CAD,monthly,2026-11-05,Streaming,Family plan,https://www.netflix.com/account,active,on,,,,,,,,,,\r\n' +
  'Phone,45,CAD,monthly,2026-11-10,Phone,Paying off the phone,,active,on,2026-03-10,,24,,,icon:phone,,,,\r\n' +
  'Trial app,9.99,CAD,monthly,2026-12-01,,Free trial,,active,on,,2026-12-01,,,,,,,2026-11-28,\r\n' +
  'Hydro,85,CAD,every 2 months,2026-11-20,Utilities,Estimate,,active,on,,,,yes,2026-07-20=81.4; 2026-09-20=92.15,icon:bolt:amber,,,,\r\n' +
  'Book club,12,CAD,monthly on the 2nd tue,2026-11-10,,2nd Tuesday,,active,on,,,,,,icon:book,,,,\r\n' +
  'Rogers,55,CAD,monthly,2026-11-15,Phone,First 12 months price,,active,on,,,,,,,2027-03-15,75,,\r\n';
