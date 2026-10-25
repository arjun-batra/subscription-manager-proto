/**
 * Backup and restore: every item, category, logo, actual, paid record and setting in one
 * versioned JSON file. Pure TypeScript: no file, share sheet or network access here (the Settings
 * screen writes the file and hands it to the iOS share sheet; restore reads a picked file).
 *
 * Format (version 1):
 *   { format: 'subscription-manager-backup', version: 1, exportedAt, schemaVersion, data: {
 *       subscriptions: Subscription[], categories: Category[], settings: Settings } }
 *
 * `version` is the backup format; files from a newer format are refused with a clear message, older
 * formats are upgraded step by step through BACKUP_MIGRATIONS. `schemaVersion` records which
 * database schema wrote the file; fields added after it (e.g. paid records in schema 6) are filled
 * with their defaults, so a backup from an older build restores cleanly. A file from a newer schema
 * than this app's is refused, since it could hold fields this build would silently drop.
 */
import { isValidCycle, isValidLocalDate } from './dates';
import { normalizeLogo } from './logo';
import { isValidCurrency } from './money';
import { MAX_PLAN_PAYMENTS } from './schedule';
import { SCHEMA_VERSION } from '../data/sql';
import {
  DEFAULT_SETTINGS,
  type ActualCharge,
  type Category,
  type Cycle,
  type PaymentRecord,
  type Settings,
  type Subscription,
} from './types';

export const BACKUP_FORMAT = 'subscription-manager-backup';
export const BACKUP_VERSION = 1;
/** Refuse anything bigger than this before parsing (a real backup is a few hundred KB at most). */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export interface BackupData {
  subscriptions: Subscription[];
  categories: Category[];
  settings: Settings;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  schemaVersion: number;
  data: BackupData;
}

export function makeBackup(data: BackupData, schemaVersion: number, now: Date = new Date()): BackupFile {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), schemaVersion, data };
}

export function backupJson(file: BackupFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

/** "subscriptions-backup-2026-10-25.json" */
export function backupFileName(localDate: string): string {
  return `subscriptions-backup-${localDate}.json`;
}

/**
 * Steps that turn a format-N file's raw object into format N+1, keyed by N. None yet: version 1
 * is the first format. A future format adds `1: (raw) => …` here, and older files keep restoring.
 */
export type BackupMigration = (raw: Record<string, unknown>) => Record<string, unknown>;
export const BACKUP_MIGRATIONS: Record<number, BackupMigration> = {};

export type ParsedBackup =
  | { ok: true; backup: BackupFile; migratedFrom: number | null }
  | { ok: false; error: string };

/** Names and values echoed in error messages are cut to this many characters. */
export const ERROR_TEXT_MAX = 40;
const clip = (s: string): string => (s.length > ERROR_TEXT_MAX ? `${s.slice(0, ERROR_TEXT_MAX - 1)}…` : s);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && isValidLocalDate(v) ? v : null);

class BadBackup extends Error {}

function fail(msg: string): never {
  throw new BadBackup(msg);
}

function readCycle(v: unknown, where: string): Cycle {
  if (!isObj(v)) fail(`${where}: the billing cycle is missing.`);
  const unit = v.unit as Cycle['unit'];
  const every = v.every as number;
  const w = isObj(v.weekday) ? { nth: v.weekday.nth as NonNullable<Cycle['weekday']>['nth'], day: v.weekday.day as NonNullable<Cycle['weekday']>['day'] } : null;
  const cycle: Cycle = w ? { unit, every, weekday: w } : { unit, every };
  if (!isValidCycle(cycle)) fail(`${where}: the billing cycle isn’t valid.`);
  return cycle;
}

function readActuals(v: unknown): ActualCharge[] {
  if (!Array.isArray(v)) return [];
  const out: ActualCharge[] = [];
  for (const a of v) {
    if (!isObj(a) || !dateOrNull(a.date) || typeof a.amount !== 'number' || !Number.isFinite(a.amount) || a.amount < 0) continue;
    if (out.some((o) => o.date === a.date)) continue;
    out.push({ date: a.date as string, amount: a.amount });
  }
  return out;
}

function readPayments(v: unknown): PaymentRecord[] {
  if (!Array.isArray(v)) return [];
  const out: PaymentRecord[] = [];
  for (const p of v) {
    if (!isObj(p) || !dateOrNull(p.date) || !dateOrNull(p.paidOn)) continue;
    if (typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount < 0) continue;
    if (out.some((o) => o.date === p.date)) continue;
    out.push({ date: p.date as string, paidOn: p.paidOn as string, amount: p.amount, ...(p.loggedActual === true ? { loggedActual: true } : {}) });
  }
  return out;
}

function readSubscription(v: unknown, i: number, categoryIds: Set<string>, stamp: string): Subscription {
  const label = isObj(v) && typeof v.name === 'string' && v.name.trim() ? `Item ${i + 1} (“${clip(v.name.trim())}”)` : `Item ${i + 1}`;
  if (!isObj(v)) fail(`${label} isn’t a subscription.`);
  const id = str(v.id).trim();
  if (!id) fail(`${label} has no id.`);
  const name = str(v.name).trim();
  if (!name) fail(`${label} has no name.`);
  if (typeof v.amount !== 'number' || !Number.isFinite(v.amount) || v.amount <= 0) fail(`${label}: the amount must be a number above 0.`);
  const currency = str(v.currency).trim().toUpperCase();
  if (!isValidCurrency(currency)) fail(`${label}: “${clip(str(v.currency))}” isn’t a currency code.`);
  const cycle = readCycle(v.cycle, label);
  const anchorDate = str(v.anchorDate);
  if (!isValidLocalDate(anchorDate)) fail(`${label}: the charge date isn’t a valid date.`);
  const total = v.totalPayments;
  const totalPayments =
    total === null || total === undefined
      ? null
      : typeof total === 'number' && Number.isInteger(total) && total >= 1 && total <= MAX_PLAN_PAYMENTS
        ? total
        : fail(`${label}: the number of payments isn’t valid.`);
  const regular = v.regularAmount;
  const regularAmount = typeof regular === 'number' && Number.isFinite(regular) && regular > 0 ? regular : null;
  const promoEndDate = regularAmount !== null ? dateOrNull(v.promoEndDate) : null;
  const variable = v.variable === true;
  const trialEndDate = dateOrNull(v.trialEndDate);
  // The same combinations the edit screen and CSV import refuse.
  if (trialEndDate && totalPayments !== null) fail(`${label}: a payment plan can’t have a free trial.`);
  if (variable && totalPayments !== null) fail(`${label}: a payment plan’s payments can’t vary.`);
  if (promoEndDate && variable) fail(`${label}: a bill that varies can’t have a promo price.`);
  if (promoEndDate && totalPayments !== null) fail(`${label}: a payment plan can’t have a promo price.`);
  return {
    id,
    name,
    amount: v.amount,
    currency,
    cycle,
    anchorDate,
    startDate: dateOrNull(v.startDate),
    trialEndDate,
    totalPayments,
    variable,
    actuals: variable ? readActuals(v.actuals) : [],
    logo: normalizeLogo(typeof v.logo === 'string' ? v.logo : null),
    payments: readPayments(v.payments),
    promoEndDate,
    regularAmount: promoEndDate ? regularAmount : null,
    cancelByDate: dateOrNull(v.cancelByDate),
    deadlineSetAt: typeof v.deadlineSetAt === 'string' && Number.isFinite(Date.parse(v.deadlineSetAt)) ? v.deadlineSetAt : null,
    categoryIds: Array.isArray(v.categoryIds) ? [...new Set(v.categoryIds.filter((c): c is string => typeof c === 'string' && categoryIds.has(c)))] : [],
    notes: str(v.notes),
    manageUrl: str(v.manageUrl),
    remindersEnabled: v.remindersEnabled !== false,
    cancelled: v.cancelled === true,
    createdAt: str(v.createdAt, stamp) || stamp,
    updatedAt: str(v.updatedAt, stamp) || stamp,
  };
}

function readSettings(v: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, rates: {} };
  if (!isObj(v)) return out;
  if (typeof v.homeCurrency === 'string' && isValidCurrency(v.homeCurrency.toUpperCase())) out.homeCurrency = v.homeCurrency.toUpperCase();
  if (isObj(v.rates)) {
    for (const [k, r] of Object.entries(v.rates)) {
      if (isValidCurrency(k.toUpperCase()) && typeof r === 'number' && Number.isFinite(r) && r > 0) out.rates[k.toUpperCase()] = r;
    }
  }
  out.ratesUpdatedAt = typeof v.ratesUpdatedAt === 'string' ? v.ratesUpdatedAt : null;
  if (typeof v.leadDays === 'number' && Number.isInteger(v.leadDays) && v.leadDays >= 0 && v.leadDays <= 30) out.leadDays = v.leadDays;
  if (typeof v.reminderHour === 'number' && Number.isInteger(v.reminderHour) && v.reminderHour >= 0 && v.reminderHour <= 23) out.reminderHour = v.reminderHour;
  return out;
}

/**
 * Reads a backup file's text. Never throws: every problem comes back as a message the Settings
 * screen can show as-is. Nothing is written here; restoring is a separate, confirmed step.
 */
export function parseBackup(
  text: string,
  migrations: Record<number, BackupMigration> = BACKUP_MIGRATIONS,
  current: number = BACKUP_VERSION,
  maxSchema: number = SCHEMA_VERSION,
): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'This file is too big to be a backup from this app. Nothing was changed.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, error: 'This file isn’t a backup: it isn’t valid JSON. Pick a .json file made with “Back Up All Data”. (To bring in a spreadsheet, use Import CSV.) Nothing was changed.' };
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'This JSON file isn’t a Subscription Manager backup. Pick a file made with “Back Up All Data”. Nothing was changed.' };
  }
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'This backup has no readable format version, so it can’t be restored safely. Nothing was changed.' };
  }
  if (version > current) {
    return { ok: false, error: `This backup was made by a newer version of the app (backup format ${version}; this app reads up to ${current}). Update the app, then restore it. Nothing was changed.` };
  }
  // The database schema the file was written from. Format 1 files from a newer schema could hold
  // fields this app would silently drop, so they're refused like a newer format.
  const schema = raw.schemaVersion;
  if (schema !== undefined && (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 0)) {
    return { ok: false, error: 'This backup’s data version isn’t readable, so it can’t be restored safely. Nothing was changed.' };
  }
  if (typeof schema === 'number' && schema > maxSchema) {
    return { ok: false, error: `This backup was made by a newer version of the app (data version ${schema}; this app reads up to ${maxSchema}). Update the app, then restore it. Nothing was changed.` };
  }
  let obj: Record<string, unknown> = raw;
  for (let v = version; v < current; v += 1) {
    const step = migrations[v];
    if (!step) return { ok: false, error: `This app can’t upgrade a backup in format ${version}. Nothing was changed.` };
    obj = { ...step(obj), version: v + 1 };
  }
  try {
    const data = obj.data;
    if (!isObj(data)) fail('The backup has no data section.');
    if (!Array.isArray(data.subscriptions)) fail('The backup has no list of subscriptions.');
    if (data.categories !== undefined && !Array.isArray(data.categories)) fail('The backup’s categories aren’t a list.');
    const exportedAt = str(obj.exportedAt, new Date(0).toISOString());
    const categories: Category[] = [];
    const names = new Set<string>();
    for (const [i, c] of ((data.categories as unknown[]) ?? []).entries()) {
      if (!isObj(c) || !str(c.id).trim() || !str(c.name).trim()) fail(`Category ${i + 1} needs an id and a name.`);
      const id = str(c.id).trim();
      const name = str(c.name).trim();
      if (categories.some((x) => x.id === id)) fail(`Category “${clip(name)}” appears twice (same id).`);
      if (names.has(name.toLowerCase())) fail(`There are two categories named “${clip(name)}”.`);
      names.add(name.toLowerCase());
      categories.push({ id, name });
    }
    const catIds = new Set(categories.map((c) => c.id));
    const subscriptions: Subscription[] = [];
    for (const [i, s] of (data.subscriptions as unknown[]).entries()) {
      const sub = readSubscription(s, i, catIds, exportedAt);
      if (subscriptions.some((x) => x.id === sub.id)) fail(`“${clip(sub.name)}” appears twice (same id), so the file looks damaged.`);
      subscriptions.push(sub);
    }
    const schemaVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;
    return {
      ok: true,
      backup: { format: BACKUP_FORMAT, version: current, exportedAt, schemaVersion, data: { subscriptions, categories, settings: readSettings(data.settings) } },
      migratedFrom: version < current ? version : null,
    };
  } catch (e) {
    if (e instanceof BadBackup) return { ok: false, error: `${e.message} Nothing was changed.` };
    throw e;
  }
}

/** One-line summary for the restore preview: "12 items (2 cancelled), 4 categories". */
export function describeBackup(b: BackupFile): string {
  const subs = b.data.subscriptions;
  const cancelled = subs.filter((s) => s.cancelled).length;
  const cats = b.data.categories.length;
  return `${subs.length} item${subs.length === 1 ? '' : 's'}${cancelled ? ` (${cancelled} cancelled)` : ''}, ${cats} categor${cats === 1 ? 'y' : 'ies'}`;
}
