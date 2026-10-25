import { describeCycle, isValidCycle, isValidLocalDate } from './dates';
import { isValidCurrency } from './money';
import type { Category, Cycle, LocalDate, Subscription } from './types';

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
  start: ['first charge date', 'start date', 'first charge'],
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

/** "monthly", "every 2 weeks", "quarterly", "every 10 days", ... */
export function parseCycle(raw: string): Cycle | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
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

/** Parses a CSV into a preview. Nothing is written here. */
export function previewImport(text: string, existing: Subscription[]): ImportPreview {
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
  if (c.every === 1) return describeCycle(c).toLowerCase();
  return `every ${c.every} ${c.unit}s`;
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
      ]
        .map(esc)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export const CSV_TEMPLATE =
  CSV_COLUMNS.join(',') +
  '\r\nNetflix,16.49,CAD,monthly,2026-11-05,Streaming,Family plan,https://www.netflix.com/account,active,on,\r\n';
