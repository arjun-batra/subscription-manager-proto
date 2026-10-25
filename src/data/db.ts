import * as SQLite from 'expo-sqlite';

import type { ImportDraft } from '../domain/csv';
import type { Category, Settings, Subscription } from '../domain/types';
import { importDraftsInto, loadSnapshot, migrate, replaceAllIn, saveCategoryIn, writeSettings, writeSub, type Snapshot, type SqlDb } from './sql';

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

export { DuplicateCategoryError } from './sql';

export async function saveCategory(c: Category): Promise<void> {
  await saveCategoryIn(await sqlDb(), c);
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
  await db.withExclusiveTransactionAsync((txn) => writeSettings(txn, s));
}

/** All-or-nothing import (see importDraftsInto). */
export async function importDrafts(drafts: ImportDraft[]): Promise<number> {
  return importDraftsInto(await sqlDb(), drafts, newId);
}

/** Restore from a backup: replaces everything, all-or-nothing (see replaceAllIn). */
export async function restoreAll(snap: Snapshot): Promise<number> {
  await replaceAllIn(await sqlDb(), snap);
  return snap.subscriptions.length;
}
