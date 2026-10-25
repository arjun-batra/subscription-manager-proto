import * as SQLite from 'expo-sqlite';

import type { ImportDraft } from '../domain/csv';
import { DEFAULT_SETTINGS, type Category, type Settings, type Subscription } from '../domain/types';

/** On-device SQLite only. Nothing here talks to a network. */
const DB_NAME = 'subscriptions.db';
const SCHEMA_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  if (version < 1) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
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
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface SubRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cycle_unit: Subscription['cycle']['unit'];
  cycle_every: number;
  anchor_date: string;
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

export async function loadAll(): Promise<Snapshot> {
  const db = await getDb();
  await db.execAsync('PRAGMA foreign_keys = ON');
  const [rows, cats, links, settingRows] = await Promise.all([
    db.getAllAsync<SubRow>('SELECT * FROM subscriptions'),
    db.getAllAsync<Category>('SELECT id, name FROM categories'),
    db.getAllAsync<{ subscription_id: string; category_id: string }>('SELECT * FROM subscription_categories'),
    db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings'),
  ]);
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

async function writeSub(db: SQLite.SQLiteDatabase, s: Subscription): Promise<void> {
  await db.runAsync(
    `INSERT INTO subscriptions (id, name, amount, currency, cycle_unit, cycle_every, anchor_date, notes,
       manage_url, reminders_enabled, cancelled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount, currency = excluded.currency,
       cycle_unit = excluded.cycle_unit, cycle_every = excluded.cycle_every, anchor_date = excluded.anchor_date,
       notes = excluded.notes, manage_url = excluded.manage_url, reminders_enabled = excluded.reminders_enabled,
       cancelled = excluded.cancelled, updated_at = excluded.updated_at`,
    s.id,
    s.name,
    s.amount,
    s.currency,
    s.cycle.unit,
    s.cycle.every,
    s.anchorDate,
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

export async function saveSubscription(s: Subscription): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(() => writeSub(db, s));
}

export async function deleteSubscription(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM subscription_categories WHERE subscription_id = ?', id);
    await db.runAsync('DELETE FROM subscriptions WHERE id = ?', id);
  });
}

export class DuplicateCategoryError extends Error {}

/** Category names are trimmed and unique regardless of case. */
export async function saveCategory(c: Category): Promise<void> {
  const db = await getDb();
  const name = c.name.trim();
  if (!name) throw new Error('Name is required');
  const clash = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?',
    name,
    c.id,
  );
  if (clash) throw new DuplicateCategoryError(`“${name}” already exists`);
  await db.runAsync(
    'INSERT INTO categories (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
    c.id,
    name,
  );
}

/** Deletes only the category and its links; subscriptions are kept. */
export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM subscription_categories WHERE category_id = ?', id);
    await db.runAsync('DELETE FROM categories WHERE id = ?', id);
  });
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(s)) {
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        JSON.stringify(value),
      );
    }
  });
}

/** All-or-nothing import: one transaction; any failure rolls everything back. */
export async function importDrafts(drafts: ImportDraft[]): Promise<number> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const cats = await db.getAllAsync<Category>('SELECT id, name FROM categories');
    const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    for (const d of drafts) {
      const categoryIds: string[] = [];
      for (const raw of d.categoryNames) {
        const key = raw.trim().toLowerCase();
        if (!key) continue;
        let id = byName.get(key);
        if (!id) {
          id = newId();
          await db.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', id, raw.trim());
          byName.set(key, id);
        }
        categoryIds.push(id);
      }
      const now = new Date().toISOString();
      await writeSub(db, {
        id: newId(),
        name: d.name,
        amount: d.amount,
        currency: d.currency,
        cycle: d.cycle,
        anchorDate: d.anchorDate,
        categoryIds,
        notes: d.notes,
        manageUrl: d.manageUrl,
        remindersEnabled: true,
        cancelled: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return drafts.length;
}
