/**
 * Runs the real storage SQL against SQLite in Node (node:sqlite), through the same
 * small interface db.ts gives expo-sqlite. On the phone, expo-sqlite's
 * withExclusiveTransactionAsync does BEGIN EXCLUSIVE / COMMIT / ROLLBACK the same way.
 */
import type { ImportDraft } from '../domain/csv';
import {
  DuplicateCategoryError,
  importDraftsInto,
  loadSnapshot,
  migrate,
  saveCategoryIn,
  SCHEMA_VERSION,
  writeSub,
  type SqlDb, type SqlExec, type SqlParam } from './sql';

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

function nodeDb(opts: { failOnSubscriptionInsert?: number; failOnExec?: RegExp } = {}): SqlDb & { raw: NodeSqlite } {
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
      if (opts.failOnExec?.test(source)) throw new Error('app killed (simulated)');
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
  trialEndDate: null,
  totalPayments: null,
  variable: false,
  actuals: [],
  logo: null,
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

const V1_SCHEMA = `
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
`;
const userVersion = (db: ReturnType<typeof nodeDb>) =>
  (db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const columns = (db: ReturnType<typeof nodeDb>) =>
  (db.raw.prepare('PRAGMA table_info(subscriptions)').all() as { name: string }[]).map((c) => c.name);

describe('migrations', () => {
  it('upgrades a version 1 database and keeps its rows', async () => {
    const db = nodeDb();
    db.raw.exec(V1_SCHEMA);
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    const snap = await loadSnapshot(db);
    expect(snap.subscriptions).toEqual([expect.objectContaining({ id: 's1', name: 'Netflix', startDate: null })]);
  });

  it('creates a fresh database at the current version', async () => {
    const db = nodeDb();
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(columns(db)).toContain('start_date');
    await migrate(db); // no-op the second time
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
  });

  it('rolls the v2 step back if the app dies before user_version is bumped, then retries cleanly', async () => {
    const crashing = nodeDb({ failOnExec: /user_version = 2/ });
    crashing.raw.exec(V1_SCHEMA);
    await expect(migrate(crashing)).rejects.toThrow('app killed (simulated)');
    // The ALTER was rolled back with the failed step: still a clean v1 database.
    expect(userVersion(crashing)).toBe(1);
    expect(columns(crashing)).not.toContain('start_date');
  });

  it('upgrades after an interrupted attempt without "duplicate column name"', async () => {
    const db = nodeDb();
    db.raw.exec(V1_SCHEMA);
    // Same database: a first attempt dies before the bump, the next launch runs it again.
    let calls = 0;
    const first: SqlDb = {
      ...db,
      async withExclusiveTransactionAsync(task) {
        return db.withExclusiveTransactionAsync(async (txn) => {
          await task({
            ...txn,
            async execAsync(source: string) {
              calls += 1;
              if (/user_version = 2/.test(source)) throw new Error('app killed (simulated)');
              await txn.execAsync(source);
            },
          });
        });
      },
    };
    await expect(migrate(first)).rejects.toThrow('app killed (simulated)');
    expect(calls).toBe(2);
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(columns(db).filter((c) => c === 'start_date')).toHaveLength(1);
    expect((await loadSnapshot(db)).subscriptions.map((x) => x.name)).toEqual(['Netflix']);
  });
});

const V2_SCHEMA = `${V1_SCHEMA.replace('PRAGMA user_version = 1;', '')}
  ALTER TABLE subscriptions ADD COLUMN start_date TEXT;
  INSERT INTO subscriptions (id, name, amount, currency, cycle_unit, cycle_every, anchor_date, start_date, notes,
    manage_url, reminders_enabled, cancelled, created_at, updated_at)
    VALUES ('s2','Gym',40,'CAD','month',1,'2026-11-01','2026-11-01','','',0,1,'t','t');
  INSERT INTO categories VALUES ('c1','Health');
  INSERT INTO subscription_categories VALUES ('s2','c1');
  INSERT INTO settings VALUES ('homeCurrency','"USD"');
  PRAGMA user_version = 2;
`;

describe('migration to v3 (trials and plans)', () => {
  it('upgrades a version 2 database and keeps every row, link and setting', async () => {
    const db = nodeDb();
    db.raw.exec(V2_SCHEMA);
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(columns(db)).toEqual(expect.arrayContaining(['trial_end_date', 'total_payments']));
    const snap = await loadSnapshot(db);
    expect(snap.settings.homeCurrency).toBe('USD');
    expect(snap.subscriptions.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      expect.objectContaining({ id: 's1', name: 'Netflix', startDate: null, trialEndDate: null, totalPayments: null }),
      expect.objectContaining({
        id: 's2',
        startDate: '2026-11-01',
        cancelled: true,
        remindersEnabled: false,
        categoryIds: ['c1'],
        trialEndDate: null,
        totalPayments: null,
      }),
    ]);
  });

  it('upgrades a version 1 database straight to the latest version', async () => {
    const db = nodeDb();
    db.raw.exec(V1_SCHEMA);
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect((await loadSnapshot(db)).subscriptions.map((x) => x.name)).toEqual(['Netflix']);
  });

  it('rolls the v3 step back if the app dies before user_version is bumped', async () => {
    const crashing = nodeDb({ failOnExec: /user_version = 3/ });
    crashing.raw.exec(V2_SCHEMA);
    await expect(migrate(crashing)).rejects.toThrow('app killed (simulated)');
    expect(userVersion(crashing)).toBe(2);
    expect(columns(crashing)).not.toContain('trial_end_date');
    expect(columns(crashing)).not.toContain('total_payments');
  });

  it('rolls back a crash between the two ALTERs, then retries without "duplicate column name"', async () => {
    const db = nodeDb();
    db.raw.exec(V2_SCHEMA);
    const first: SqlDb = {
      ...db,
      async withExclusiveTransactionAsync(task) {
        return db.withExclusiveTransactionAsync(async (txn) => {
          await task({
            ...txn,
            async execAsync(source: string) {
              if (/total_payments/.test(source)) throw new Error('app killed (simulated)');
              await txn.execAsync(source);
            },
          });
        });
      },
    };
    await expect(migrate(first)).rejects.toThrow('app killed (simulated)');
    expect(userVersion(db)).toBe(2);
    expect(columns(db)).not.toContain('trial_end_date');
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(columns(db).filter((c) => c === 'trial_end_date')).toHaveLength(1);
    expect((await loadSnapshot(db)).subscriptions).toHaveLength(2);
  });

  it('saves and loads a trial and a plan, and imports them', async () => {
    const db = nodeDb();
    await migrate(db);
    await importDraftsInto(
      db,
      [
        draft({ name: 'Trial', trialEndDate: '2026-11-05' }),
        draft({ name: 'Phone', amount: 50, startDate: '2026-06-10', anchorDate: '2026-11-10', totalPayments: 12 }),
      ],
      makeId,
    );
    const snap = await loadSnapshot(db);
    expect(snap.subscriptions.find((s) => s.name === 'Trial')).toMatchObject({ trialEndDate: '2026-11-05', totalPayments: null });
    expect(snap.subscriptions.find((s) => s.name === 'Phone')).toMatchObject({ totalPayments: 12, startDate: '2026-06-10', trialEndDate: null });
    // Editing clears the trial (upsert writes the new columns too).
    const t = snap.subscriptions.find((s) => s.name === 'Trial')!;
    await db.withExclusiveTransactionAsync((txn) => writeSub(txn, { ...t, trialEndDate: null }));
    expect((await loadSnapshot(db)).subscriptions.find((s) => s.name === 'Trial')!.trialEndDate).toBeNull();
  });
});

const V3_SCHEMA = `${V2_SCHEMA.replace('PRAGMA user_version = 2;', '')}
  ALTER TABLE subscriptions ADD COLUMN trial_end_date TEXT;
  ALTER TABLE subscriptions ADD COLUMN total_payments INTEGER;
  INSERT INTO subscriptions (id, name, amount, currency, cycle_unit, cycle_every, anchor_date, start_date, trial_end_date,
    total_payments, notes, manage_url, reminders_enabled, cancelled, created_at, updated_at)
    VALUES ('s3','Phone',50,'CAD','month',1,'2026-11-10','2026-06-10',NULL,12,'','',1,0,'t','t'),
           ('s4','Trial',9,'CAD','month',1,'2026-11-20','2026-11-20','2026-11-20',NULL,'','',1,0,'t','t');
  PRAGMA user_version = 3;
`;

describe('migration to v4 (weekday schedules and variable bills)', () => {
  it('upgrades a version 3 database and keeps trials, plans, links and settings', async () => {
    const db = nodeDb();
    db.raw.exec(V3_SCHEMA);
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(columns(db)).toEqual(expect.arrayContaining(['cycle_weekday_nth', 'cycle_weekday', 'variable', 'actuals']));
    const snap = await loadSnapshot(db);
    expect(snap.settings.homeCurrency).toBe('USD');
    const byId = new Map(snap.subscriptions.map((x) => [x.id, x]));
    expect(byId.get('s2')).toMatchObject({ categoryIds: ['c1'], cancelled: true, variable: false, actuals: [] });
    expect(byId.get('s3')).toMatchObject({ totalPayments: 12, startDate: '2026-06-10', cycle: { unit: 'month', every: 1, weekday: null } });
    expect(byId.get('s4')).toMatchObject({ trialEndDate: '2026-11-20', variable: false });
  });

  it('upgrades a version 1 database all the way', async () => {
    const db = nodeDb();
    db.raw.exec(V1_SCHEMA);
    await migrate(db);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect((await loadSnapshot(db)).subscriptions[0]).toMatchObject({ name: 'Netflix', variable: false, actuals: [], logo: null });
  });

  it.each([/cycle_weekday_nth/, /ADD COLUMN cycle_weekday INTEGER/, /ADD COLUMN variable/, /ADD COLUMN actuals/, /user_version = 4/])(
    'rolls back a crash at %s to v3, then retries cleanly',
    async (at) => {
      const db = nodeDb();
      db.raw.exec(V3_SCHEMA);
      const first: SqlDb = {
        ...db,
        async withExclusiveTransactionAsync(task) {
          return db.withExclusiveTransactionAsync(async (txn) => {
            await task({
              ...txn,
              async execAsync(source: string) {
                if (at.test(source)) throw new Error('app killed (simulated)');
                await txn.execAsync(source);
              },
            });
          });
        },
      };
      await expect(migrate(first)).rejects.toThrow('app killed (simulated)');
      expect(userVersion(db)).toBe(3);
      for (const c of ['cycle_weekday_nth', 'cycle_weekday', 'variable', 'actuals']) expect(columns(db)).not.toContain(c);
      await migrate(db);
      expect(userVersion(db)).toBe(SCHEMA_VERSION);
      expect(columns(db).filter((c) => c === 'variable')).toHaveLength(1);
      expect((await loadSnapshot(db)).subscriptions).toHaveLength(4);
    },
  );

  it('saves and loads a weekday schedule, a variable bill and its actuals', async () => {
    const db = nodeDb();
    await migrate(db);
    await importDraftsInto(
      db,
      [
        draft({ name: 'Club', cycle: { unit: 'month', every: 1, weekday: { nth: 2, day: 2 } }, anchorDate: '2026-11-10' }),
        draft({ name: 'Hydro', amount: 85, variable: true, actuals: [{ date: '2026-09-20', amount: 92.15 }] }),
      ],
      makeId,
    );
    let snap = await loadSnapshot(db);
    expect(snap.subscriptions.find((x) => x.name === 'Club')!.cycle).toEqual({ unit: 'month', every: 1, weekday: { nth: 2, day: 2 } });
    const hydro = snap.subscriptions.find((x) => x.name === 'Hydro')!;
    expect(hydro).toMatchObject({ variable: true, actuals: [{ date: '2026-09-20', amount: 92.15 }] });
    // Switching back to a day-of-month schedule and a fixed amount clears the columns.
    await db.withExclusiveTransactionAsync((txn) => writeSub(txn, { ...hydro, variable: false, actuals: [] }));
    snap = await loadSnapshot(db);
    expect(snap.subscriptions.find((x) => x.name === 'Hydro')).toMatchObject({ variable: false, actuals: [] });
  });

  it('ignores an unreadable actuals value instead of failing to load', async () => {
    const db = nodeDb();
    await migrate(db);
    await importDraftsInto(db, [draft({ name: 'Hydro', variable: true })], makeId);
    db.raw.exec(`UPDATE subscriptions SET actuals = 'not json'`);
    expect((await loadSnapshot(db)).subscriptions[0].actuals).toEqual([]);
    db.raw.exec(`UPDATE subscriptions SET actuals = '[{"date":"2026-09-20","amount":"x"},{"date":"2026-10-20","amount":90}]'`);
    expect((await loadSnapshot(db)).subscriptions[0].actuals).toEqual([{ date: '2026-10-20', amount: 90 }]);
  });
});

const V4_SCHEMA = `${V3_SCHEMA.replace('PRAGMA user_version = 3;', '')}
  ALTER TABLE subscriptions ADD COLUMN cycle_weekday_nth INTEGER;
  ALTER TABLE subscriptions ADD COLUMN cycle_weekday INTEGER;
  ALTER TABLE subscriptions ADD COLUMN variable INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE subscriptions ADD COLUMN actuals TEXT;
  UPDATE subscriptions SET variable = 1, actuals = '[{"date":"2026-10-10","amount":51}]' WHERE id = 's3';
  PRAGMA user_version = 4;
`;

describe('migration to v5 (logo picker)', () => {
  it('upgrades a version 4 database; every existing item stays Automatic and keeps its data', async () => {
    const db = nodeDb();
    db.raw.exec(V4_SCHEMA);
    await migrate(db);
    expect(userVersion(db)).toBe(5);
    expect(columns(db)).toContain('logo');
    const snap = await loadSnapshot(db);
    expect(snap.subscriptions).toHaveLength(4);
    expect(snap.subscriptions.every((x) => x.logo === null)).toBe(true);
    expect(snap.subscriptions.find((x) => x.id === 's3')).toMatchObject({ variable: true, actuals: [{ date: '2026-10-10', amount: 51 }] });
  });

  it.each([/ADD COLUMN logo/, /user_version = 5/])('rolls back a crash at %s to v4, then retries cleanly', async (at) => {
    const db = nodeDb();
    db.raw.exec(V4_SCHEMA);
    const first: SqlDb = {
      ...db,
      async withExclusiveTransactionAsync(task) {
        return db.withExclusiveTransactionAsync(async (txn) => {
          await task({
            ...txn,
            async execAsync(source: string) {
              if (at.test(source)) throw new Error('app killed (simulated)');
              await txn.execAsync(source);
            },
          });
        });
      },
    };
    await expect(migrate(first)).rejects.toThrow('app killed (simulated)');
    expect(userVersion(db)).toBe(4);
    expect(columns(db)).not.toContain('logo');
    await migrate(db);
    expect(userVersion(db)).toBe(5);
    expect(columns(db).filter((c) => c === 'logo')).toHaveLength(1);
  });

  it('saves, changes and clears a picked logo; unreadable values load as Automatic', async () => {
    const db = nodeDb();
    await migrate(db);
    await importDraftsInto(db, [draft({ name: 'My phone', logo: 'brand:rogers' }), draft({ name: 'Hydro', logo: 'icon:bolt:teal' })], makeId);
    let snap = await loadSnapshot(db);
    const phone = snap.subscriptions.find((x) => x.name === 'My phone')!;
    expect(phone.logo).toBe('brand:rogers');
    expect(snap.subscriptions.find((x) => x.name === 'Hydro')!.logo).toBe('icon:bolt:teal');
    await db.withExclusiveTransactionAsync((txn) => writeSub(txn, { ...phone, logo: null }));
    snap = await loadSnapshot(db);
    expect(snap.subscriptions.find((x) => x.name === 'My phone')!.logo).toBeNull();
    db.raw.exec(`UPDATE subscriptions SET logo = 'brand:no-such-brand'`);
    expect((await loadSnapshot(db)).subscriptions.every((x) => x.logo === null)).toBe(true);
  });
});

describe('saveCategoryIn', () => {
  it('creates and renames inside the exclusive transaction', async () => {
    const db = nodeDb();
    await migrate(db);
    await saveCategoryIn(db, { id: 'c1', name: '  Streaming ' });
    await saveCategoryIn(db, { id: 'c1', name: 'Video' });
    expect((await loadSnapshot(db)).categories).toEqual([expect.objectContaining({ id: 'c1', name: 'Video' })]);
  });

  it('rejects a name that clashes ignoring case and writes nothing', async () => {
    const db = nodeDb();
    await migrate(db);
    await saveCategoryIn(db, { id: 'c1', name: 'Family' });
    await expect(saveCategoryIn(db, { id: 'c2', name: 'family' })).rejects.toBeInstanceOf(DuplicateCategoryError);
    expect(count(db, 'categories')).toBe(1);
    await expect(saveCategoryIn(db, { id: 'c3', name: '   ' })).rejects.toThrow('Name is required');
  });
});
