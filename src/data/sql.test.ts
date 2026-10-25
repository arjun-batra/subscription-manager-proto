/**
 * Runs the real storage SQL against SQLite in Node (node:sqlite), through the same
 * small interface db.ts gives expo-sqlite. On the phone, expo-sqlite's
 * withExclusiveTransactionAsync does BEGIN EXCLUSIVE / COMMIT / ROLLBACK the same way.
 */
import type { ImportDraft } from '../domain/csv';
import { importDraftsInto, loadSnapshot, migrate, SCHEMA_VERSION, type SqlDb, type SqlExec, type SqlParam } from './sql';

interface Stmt {
  run(...p: SqlParam[]): unknown;
  get(...p: SqlParam[]): unknown;
  all(...p: SqlParam[]): unknown[];
}
interface NodeSqlite {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
}
// node:sqlite ships with Node 22.13+ (CI uses Node 22). Typed locally to avoid @types/node.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeSqlite };

function nodeDb(opts: { failOnSubscriptionInsert?: number } = {}): SqlDb & { raw: NodeSqlite } {
  const raw = new DatabaseSync(':memory:');
  let subInserts = 0;
  let inTxn = false;
  // Like expo-sqlite, the exclusive transaction gets its own handle; using the outer
  // database while it is open is a bug (on the phone it would run outside the transaction).
  const outer = <F extends (...a: never[]) => unknown>(f: F): F =>
    ((...a: never[]) => {
      if (inTxn) throw new Error('query on the outer database during an exclusive transaction');
      return f(...a);
    }) as F;
  const exec: SqlExec = {
    async execAsync(source) {
      raw.exec(source);
    },
    async runAsync(source: string, ...params: SqlParam[]) {
      if (/^\s*INSERT INTO subscriptions\b/.test(source)) {
        subInserts += 1;
        if (subInserts === opts.failOnSubscriptionInsert) throw new Error('disk full (simulated)');
      }
      return raw.prepare(source).run(...params);
    },
    async getFirstAsync<T>(source: string, ...params: SqlParam[]) {
      return (raw.prepare(source).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(source: string, ...params: SqlParam[]) {
      return raw.prepare(source).all(...params) as T[];
    },
  };
  return {
    execAsync: outer(exec.execAsync),
    runAsync: outer(exec.runAsync),
    getFirstAsync: outer(exec.getFirstAsync),
    getAllAsync: outer(exec.getAllAsync),
    raw,
    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN EXCLUSIVE');
      inTxn = true;
      try {
        await task(exec);
        inTxn = false;
        raw.exec('COMMIT');
      } catch (e) {
        inTxn = false;
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const draft = (over: Partial<ImportDraft> = {}): ImportDraft => ({
  name: 'Netflix',
  amount: 16.49,
  currency: 'CAD',
  cycle: { unit: 'month', every: 1 },
  anchorDate: '2026-11-05',
  categoryNames: [],
  notes: '',
  manageUrl: '',
  cancelled: false,
  remindersEnabled: true,
  startDate: null,
  ...over,
});

let ids = 0;
const makeId = () => `id${(ids += 1)}`;
const count = (db: ReturnType<typeof nodeDb>, table: string) =>
  (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('import transaction', () => {
  it('writes every row, creates categories by name, and keeps flags', async () => {
    const db = nodeDb();
    await migrate(db);
    const n = await importDraftsInto(
      db,
      [
        draft({ categoryNames: ['Streaming', 'Family'] }),
        draft({ name: 'Old gym', categoryNames: ['family'], cancelled: true, remindersEnabled: false, startDate: '2026-11-05' }),
      ],
      makeId,
    );
    expect(n).toBe(2);
    const snap = await loadSnapshot(db);
    expect(snap.categories.map((c) => c.name).sort()).toEqual(['Family', 'Streaming']);
    const gym = snap.subscriptions.find((s) => s.name === 'Old gym')!;
    expect(gym).toMatchObject({ cancelled: true, remindersEnabled: false, startDate: '2026-11-05' });
    expect(gym.categoryIds).toHaveLength(1);
  });

  it('rolls back everything when a row fails mid-import', async () => {
    const db = nodeDb({ failOnSubscriptionInsert: 3 });
    await migrate(db);
    const drafts = [
      draft({ name: 'A', categoryNames: ['New cat'] }),
      draft({ name: 'B', categoryNames: ['Other cat'] }),
      draft({ name: 'C' }),
      draft({ name: 'D' }),
    ];
    await expect(importDraftsInto(db, drafts, makeId)).rejects.toThrow('disk full (simulated)');
    expect(count(db, 'subscriptions')).toBe(0);
    expect(count(db, 'categories')).toBe(0);
    expect(count(db, 'subscription_categories')).toBe(0);
  });

  it('leaves earlier data untouched when a later import fails', async () => {
    const db = nodeDb({ failOnSubscriptionInsert: 2 });
    await migrate(db);
    await importDraftsInto(db, [draft({ name: 'Kept', categoryNames: ['Keep'] })], makeId);
    await expect(importDraftsInto(db, [draft({ name: 'X', categoryNames: ['Gone'] })], makeId)).rejects.toThrow();
    const snap = await loadSnapshot(db);
    expect(snap.subscriptions.map((s) => s.name)).toEqual(['Kept']);
    expect(snap.categories.map((c) => c.name)).toEqual(['Keep']);
  });
});

describe('migrations', () => {
  it('upgrades a version 1 database and keeps its rows', async () => {
    const db = nodeDb();
    db.raw.exec(`
      CREATE TABLE subscriptions (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, amount REAL NOT NULL,
        currency TEXT NOT NULL, cycle_unit TEXT NOT NULL, cycle_every INTEGER NOT NULL, anchor_date TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '', manage_url TEXT NOT NULL DEFAULT '', reminders_enabled INTEGER NOT NULL DEFAULT 1,
        cancelled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
      CREATE TABLE subscription_categories (subscription_id TEXT NOT NULL, category_id TEXT NOT NULL,
        PRIMARY KEY (subscription_id, category_id));
      CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO subscriptions VALUES ('s1','Netflix',16.49,'CAD','month',1,'2026-01-31','','',1,0,'t','t');
      PRAGMA user_version = 1;
    `);
    await migrate(db);
    expect((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    const snap = await loadSnapshot(db);
    expect(snap.subscriptions).toEqual([expect.objectContaining({ id: 's1', name: 'Netflix', startDate: null })]);
  });
});
