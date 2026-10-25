/**
 * Storage logic written against a tiny SQLite interface, so it runs on the phone
 * (expo-sqlite, see db.ts) and in Jest (node:sqlite, see sql.test.ts).
 * Nothing here talks to a network.
 */
import type { ImportDraft } from '../domain/csv';
import { DEFAULT_SETTINGS, type Category, type Settings, type Subscription } from '../domain/types';

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

export const SCHEMA_VERSION = 2;

/**
 * Brings the schema up to SCHEMA_VERSION. Each step runs in its own exclusive transaction
 * together with its `user_version` bump (SQLite DDL and user_version are transactional), so
 * a crash mid-step rolls back to the previous version and the step simply runs again.
 */
export async function migrate(db: SqlDb): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
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
      cycle: { unit: r.cycle_unit, every: r.cycle_every },
      anchorDate: r.anchor_date,
      startDate: r.start_date ?? null,
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
    `INSERT INTO subscriptions (id, name, amount, currency, cycle_unit, cycle_every, anchor_date, start_date, notes,
       manage_url, reminders_enabled, cancelled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount, currency = excluded.currency,
       cycle_unit = excluded.cycle_unit, cycle_every = excluded.cycle_every, anchor_date = excluded.anchor_date,
       start_date = excluded.start_date, notes = excluded.notes, manage_url = excluded.manage_url,
       reminders_enabled = excluded.reminders_enabled, cancelled = excluded.cancelled, updated_at = excluded.updated_at`,
    s.id,
    s.name,
    s.amount,
    s.currency,
    s.cycle.unit,
    s.cycle.every,
    s.anchorDate,
    s.startDate ?? null,
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
