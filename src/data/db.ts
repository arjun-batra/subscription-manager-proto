import * as SQLite from 'expo-sqlite';

import type { ImportDraft } from '../domain/csv';
import type { Category, Settings, Subscription } from '../domain/types';
import { importDraftsInto, loadSnapshot, migrate, writeSub, type Snapshot, type SqlDb } from './sql';

export type { Snapshot } from './sql';

/** On-device SQLite only. Nothing here talks to a network. */
const DB_NAME = 'subscriptions.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      await db.execAsync('PRAGMA foreign_keys = ON');
      return db;
    })();
  }
  return dbPromise;
}

async function sqlDb(): Promise<SqlDb> {
  return getDb();
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadAll(): Promise<Snapshot> {
  return loadSnapshot(await sqlDb());
}

export async function saveSubscription(s: Subscription): Promise<void> {
  const db = await sqlDb();
  await db.withExclusiveTransactionAsync((txn) => writeSub(txn, s));
}

export async function deleteSubscription(id: string): Promise<void> {
  const db = await sqlDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM subscription_categories WHERE subscription_id = ?', id);
    await txn.runAsync('DELETE FROM subscriptions WHERE id = ?', id);
  });
}

export class DuplicateCategoryError extends Error {}

/** Category names are trimmed and unique regardless of case. */
export async function saveCategory(c: Category): Promise<void> {
  const db = await sqlDb();
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
  const db = await sqlDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM subscription_categories WHERE category_id = ?', id);
    await txn.runAsync('DELETE FROM categories WHERE id = ?', id);
  });
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await sqlDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const [key, value] of Object.entries(s)) {
      await txn.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        JSON.stringify(value),
      );
    }
  });
}

/** All-or-nothing import (see importDraftsInto). */
export async function importDrafts(drafts: ImportDraft[]): Promise<number> {
  return importDraftsInto(await sqlDb(), drafts, newId);
}
