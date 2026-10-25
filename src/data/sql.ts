/**
 * Storage logic written against a tiny SQLite interface, so it runs on the phone
 * (expo-sqlite, see db.ts) and in Jest (node:sqlite, see sql.test.ts).
 * Nothing here talks to a network.
 */
import { normalizeLogo } from '../domain/logo';
import type { ImportDraft } from '../domain/csv';
import {
  DEFAULT_SETTINGS,
  type ActualCharge,
  type Category,
  type PaymentRecord,
  type Settings,
  type Subscription,
  type WeekdayRule,
} from '../domain/types';

export type SqlParam = string | number | null;

export interface SqlExec {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: SqlParam[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: SqlParam[]): Promise<T[]>;
}

export interface SqlDb extends SqlExec {
  /** Exclusive: no other query can run on this connection until it commits or rolls back. */
  withExclusiveTransactionAsync(task: (txn: SqlExec) => Promise<void>): Promise<void>;
}

export const SCHEMA_VERSION = 6;

/**
 * Brings the schema up to SCHEMA_VERSION. Each step runs in its own exclusive transaction
 * together with its `user_version` bump (SQLite DDL and user_version are transactional), so
 * a crash mid-step rolls back to the previous version and the step simply runs again.
 */
export async function migrate(db: SqlDb): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) {
    await healColumns(db);
    return;
  }
  // journal_mode can't change inside a transaction, so it goes first, on its own.
  await db.execAsync('PRAGMA journal_mode = WAL');
  if (version < 1) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        cycle_unit TEXT NOT NULL,
        cycle_every INTEGER NOT NULL,
        anchor_date TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        manage_url TEXT NOT NULL DEFAULT '',
        reminders_enabled INTEGER NOT NULL DEFAULT 1,
        cancelled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS categories_name_nocase ON categories (name COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS subscription_categories (
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (subscription_id, category_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      `);
      await txn.execAsync('PRAGMA user_version = 1');
    });
  }
  if (version < 2) {
    // First charge date for new subscriptions (no backwards-projected "paid" charge).
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN start_date TEXT');
      await txn.execAsync('PRAGMA user_version = 2');
    });
  }
  if (version < 3) {
    // Free trials and instalment plans. Both columns are nullable, so existing rows stay
    // ordinary subscriptions. Same crash-safety as v2: both ALTERs and the bump in one step.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN trial_end_date TEXT');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN total_payments INTEGER');
      await txn.execAsync('PRAGMA user_version = 3');
    });
  }
  if (version < 4) {
    // Nth-weekday monthly schedules and variable bills. All nullable or defaulted, so existing
    // rows keep their day-of-month schedule and fixed amount. Four ALTERs and the bump, one step.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN cycle_weekday_nth INTEGER');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN cycle_weekday INTEGER');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN variable INTEGER NOT NULL DEFAULT 0');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN actuals TEXT');
      await txn.execAsync('PRAGMA user_version = 4');
    });
  }
  if (version < 5) {
    // Logo picker. Nullable, so existing rows stay Automatic. The ALTER and the bump, one step.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN logo TEXT');
      await txn.execAsync('PRAGMA user_version = 5');
    });
  }
  if (version < 6) {
    // Marked payments (JSON), promo end + regular price, cancel-by deadline. All nullable, so
    // existing rows have no payments, no promo and no deadline; deadline_set_at keys catch-up
    // reminders. Five ALTERs and the bump, one step.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN payments TEXT');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN promo_end_date TEXT');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN regular_amount REAL');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN cancel_by_date TEXT');
      await txn.execAsync('ALTER TABLE subscriptions ADD COLUMN deadline_set_at TEXT');
      await txn.execAsync('PRAGMA user_version = 6');
    });
  }
}

/**
 * Columns added to an unreleased schema step after a dev build already ran it: a v6 database
 * from build 47aa4b5 has user_version 6 but no deadline_set_at. Adds any that are missing
 * (cheap: one PRAGMA per launch). Released steps never change, so this list only grows while a
 * version is unreleased.
 */
const LATE_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'deadline_set_at', ddl: 'ALTER TABLE subscriptions ADD COLUMN deadline_set_at TEXT' },
];

async function healColumns(db: SqlDb): Promise<void> {
  const have = new Set((await db.getAllAsync<{ name: string }>('PRAGMA table_info(subscriptions)')).map((c) => c.name));
  const missing = LATE_COLUMNS.filter((c) => !have.has(c.name));
  if (!missing.length) return;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const c of missing) await txn.execAsync(c.ddl);
  });
}

/** Logged actuals are stored as JSON [{date, amount}]; anything unreadable is dropped, never fatal. */
export function parseActuals(raw: string | null | undefined): ActualCharge[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (a): a is ActualCharge =>
        !!a && typeof a.date === 'string' && typeof a.amount === 'number' && Number.isFinite(a.amount) && a.amount >= 0,
    );
  } catch {
    return [];
  }
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Marked payments are JSON [{date, paidOn, amount, loggedActual?}]; unreadable entries are dropped. */
export function parsePayments(raw: string | null | undefined): PaymentRecord[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: PaymentRecord[] = [];
    for (const p of v) {
      if (!p || typeof p.date !== 'string' || !LOCAL_DATE.test(p.date)) continue;
      if (typeof p.paidOn !== 'string' || !LOCAL_DATE.test(p.paidOn)) continue;
      if (typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount < 0) continue;
      if (out.some((o) => o.date === p.date)) continue;
      out.push({ date: p.date, paidOn: p.paidOn, amount: p.amount, ...(p.loggedActual === true ? { loggedActual: true } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

function serializePayments(list: PaymentRecord[] | undefined): string | null {
  if (!list?.length) return null;
  return JSON.stringify(
    list.map((p) => ({ date: p.date, paidOn: p.paidOn, amount: p.amount, ...(p.loggedActual ? { loggedActual: true } : {}) })),
  );
}

function weekdayFromRow(nth: number | null, day: number | null): WeekdayRule | null {
  if (nth === null || nth === undefined || day === null || day === undefined) return null;
  return { nth: nth as WeekdayRule['nth'], day: day as WeekdayRule['day'] };
}

interface SubRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cycle_unit: Subscription['cycle']['unit'];
  cycle_every: number;
  anchor_date: string;
  start_date: string | null;
  trial_end_date: string | null;
  total_payments: number | null;
  cycle_weekday_nth: number | null;
  cycle_weekday: number | null;
  variable: number | null;
  actuals: string | null;
  logo: string | null;
  payments: string | null;
  promo_end_date: string | null;
  regular_amount: number | null;
  cancel_by_date: string | null;
  deadline_set_at: string | null;
  notes: string;
  manage_url: string;
  reminders_enabled: number;
  cancelled: number;
  created_at: string;
  updated_at: string;
}

export interface Snapshot {
  subscriptions: Subscription[];
  categories: Category[];
  settings: Settings;
}

export async function loadSnapshot(db: SqlExec): Promise<Snapshot> {
  const rows = await db.getAllAsync<SubRow>('SELECT * FROM subscriptions');
  const cats = await db.getAllAsync<Category>('SELECT id, name FROM categories');
  const links = await db.getAllAsync<{ subscription_id: string; category_id: string }>(
    'SELECT subscription_id, category_id FROM subscription_categories',
  );
  const settingRows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const byId = new Map<string, string[]>();
  for (const l of links) byId.set(l.subscription_id, [...(byId.get(l.subscription_id) ?? []), l.category_id]);
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const r of settingRows) {
    try {
      (settings as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
    } catch {
      // ignore a corrupt value and keep the default
    }
  }
  return {
    subscriptions: rows.map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      currency: r.currency,
      cycle: { unit: r.cycle_unit, every: r.cycle_every, weekday: weekdayFromRow(r.cycle_weekday_nth, r.cycle_weekday) },
      anchorDate: r.anchor_date,
      startDate: r.start_date ?? null,
      trialEndDate: r.trial_end_date ?? null,
      totalPayments: r.total_payments ?? null,
      variable: !!r.variable,
      actuals: parseActuals(r.actuals),
      logo: normalizeLogo(r.logo),
      payments: parsePayments(r.payments),
      promoEndDate: r.promo_end_date ?? null,
      regularAmount: r.regular_amount ?? null,
      cancelByDate: r.cancel_by_date ?? null,
      deadlineSetAt: r.deadline_set_at ?? null,
      categoryIds: byId.get(r.id) ?? [],
      notes: r.notes,
      manageUrl: r.manage_url,
      remindersEnabled: !!r.reminders_enabled,
      cancelled: !!r.cancelled,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    categories: cats,
    settings,
  };
}

export async function writeSub(db: SqlExec, s: Subscription): Promise<void> {
  await db.runAsync(
    `INSERT INTO subscriptions (id, name, amount, currency, cycle_unit, cycle_every, anchor_date, start_date,
       trial_end_date, total_payments, cycle_weekday_nth, cycle_weekday, variable, actuals, logo,
       payments, promo_end_date, regular_amount, cancel_by_date, deadline_set_at,
       notes, manage_url, reminders_enabled, cancelled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount, currency = excluded.currency,
       cycle_unit = excluded.cycle_unit, cycle_every = excluded.cycle_every, anchor_date = excluded.anchor_date,
       start_date = excluded.start_date, trial_end_date = excluded.trial_end_date,
       total_payments = excluded.total_payments, cycle_weekday_nth = excluded.cycle_weekday_nth,
       cycle_weekday = excluded.cycle_weekday, variable = excluded.variable, actuals = excluded.actuals, logo = excluded.logo,
       payments = excluded.payments, promo_end_date = excluded.promo_end_date, regular_amount = excluded.regular_amount,
       cancel_by_date = excluded.cancel_by_date, deadline_set_at = excluded.deadline_set_at, notes = excluded.notes, manage_url = excluded.manage_url,
       reminders_enabled = excluded.reminders_enabled, cancelled = excluded.cancelled, updated_at = excluded.updated_at`,
    s.id,
    s.name,
    s.amount,
    s.currency,
    s.cycle.unit,
    s.cycle.every,
    s.anchorDate,
    s.startDate ?? null,
    s.trialEndDate ?? null,
    s.totalPayments ?? null,
    s.cycle.weekday ? s.cycle.weekday.nth : null,
    s.cycle.weekday ? s.cycle.weekday.day : null,
    s.variable ? 1 : 0,
    s.actuals?.length ? JSON.stringify(s.actuals.map((a) => ({ date: a.date, amount: a.amount }))) : null,
    normalizeLogo(s.logo),
    serializePayments(s.payments),
    s.promoEndDate ?? null,
    s.regularAmount ?? null,
    s.cancelByDate ?? null,
    s.deadlineSetAt ?? null,
    s.notes,
    s.manageUrl,
    s.remindersEnabled ? 1 : 0,
    s.cancelled ? 1 : 0,
    s.createdAt,
    s.updatedAt,
  );
  await db.runAsync('DELETE FROM subscription_categories WHERE subscription_id = ?', s.id);
  for (const cid of new Set(s.categoryIds)) {
    await db.runAsync(
      'INSERT OR IGNORE INTO subscription_categories (subscription_id, category_id) SELECT ?, id FROM categories WHERE id = ?',
      s.id,
      cid,
    );
  }
}

/**
 * All-or-nothing import in one exclusive transaction: any failure rolls back every
 * subscription and category it created, and the error is re-thrown to the caller.
 */
export async function importDraftsInto(
  db: SqlDb,
  drafts: ImportDraft[],
  makeId: () => string,
  now: () => string = () => new Date().toISOString(),
): Promise<number> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const cats = await txn.getAllAsync<Category>('SELECT id, name FROM categories');
    const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    for (const d of drafts) {
      const categoryIds: string[] = [];
      for (const raw of d.categoryNames) {
        const key = raw.trim().toLowerCase();
        if (!key) continue;
        let id = byName.get(key);
        if (!id) {
          id = makeId();
          await txn.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', id, raw.trim());
          byName.set(key, id);
        }
        categoryIds.push(id);
      }
      const stamp = now();
      await writeSub(txn, {
        id: makeId(),
        name: d.name,
        amount: d.amount,
        currency: d.currency,
        cycle: d.cycle,
        anchorDate: d.anchorDate,
        startDate: d.startDate,
        trialEndDate: d.trialEndDate,
        totalPayments: d.totalPayments,
        variable: d.variable,
        actuals: d.actuals,
        logo: d.logo,
        payments: d.payments,
        promoEndDate: d.promoEndDate,
        regularAmount: d.regularAmount,
        cancelByDate: d.cancelByDate,
        deadlineSetAt: d.trialEndDate || d.cancelByDate || d.promoEndDate ? stamp : null,
        categoryIds,
        notes: d.notes,
        manageUrl: d.manageUrl,
        remindersEnabled: d.remindersEnabled,
        cancelled: d.cancelled,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
  });
  return drafts.length;
}

export class DuplicateCategoryError extends Error {}

/** Creates or renames a category; names are unique ignoring case. One exclusive transaction. */
export async function saveCategoryIn(db: SqlDb, c: { id: string; name: string }): Promise<void> {
  const name = c.name.trim();
  if (!name) throw new Error('Name is required');
  await db.withExclusiveTransactionAsync(async (txn) => {
    const clash = await txn.getFirstAsync<{ id: string }>(
      'SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?',
      name,
      c.id,
    );
    if (clash) throw new DuplicateCategoryError(`“${name}” already exists`);
    await txn.runAsync(
      'INSERT INTO categories (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
      c.id,
      name,
    );
  });
}

/** Writes every setting as a key/JSON row (the same format saveSettings uses). */
export async function writeSettings(db: SqlExec, settings: Settings): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    await db.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }
}

/**
 * Restore from a backup: replaces every item, category, link and setting in one exclusive
 * transaction. Any failure rolls back to exactly what was there before, and is re-thrown.
 */
export async function replaceAllIn(db: SqlDb, snap: Snapshot): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM subscription_categories');
    await txn.runAsync('DELETE FROM subscriptions');
    await txn.runAsync('DELETE FROM categories');
    await txn.runAsync('DELETE FROM settings');
    for (const c of snap.categories) {
      await txn.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', c.id, c.name);
    }
    for (const sub of snap.subscriptions) await writeSub(txn, sub);
    await writeSettings(txn, snap.settings);
  });
}
