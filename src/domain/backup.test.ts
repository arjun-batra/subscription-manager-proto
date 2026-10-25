import { BACKUP_FORMAT, BACKUP_VERSION, backupFileName, backupJson, describeBackup, makeBackup, MAX_BACKUP_BYTES, parseBackup } from './backup';
import { sub, settings } from './fixtures';
import type { BackupMigration } from './backup';
import { SCHEMA_VERSION } from '../data/sql';

const data = () => ({
  categories: [
    { id: 'c1', name: 'Streaming' },
    { id: 'c2', name: 'Utilities' },
  ],
  subscriptions: [
    sub({ id: 'a', name: 'Netflix', categoryIds: ['c1'], logo: 'brand:netflix', payments: [{ date: '2026-11-05', paidOn: '2026-10-25', amount: 10 }] }),
    sub({ id: 'b', name: 'Hydro', variable: true, amount: 85, categoryIds: ['c2'], actuals: [{ date: '2026-09-05', amount: 91 }], logo: 'icon:bolt:amber' }),
    sub({ id: 'c', name: 'Rogers', amount: 55, promoEndDate: '2027-03-15', regularAmount: 75, cancelByDate: '2027-03-01', cancelled: true }),
  ],
  settings: settings({ homeCurrency: 'CAD', rates: { USD: 1.38 }, leadDays: 3, reminderHour: 8 }),
});
const at = new Date('2026-10-25T14:00:00.000Z');
const text = (over: Record<string, unknown> = {}) => JSON.stringify({ ...makeBackup(data(), 6, at), ...over });
const err = (t: string, ...rest: Parameters<typeof parseBackup> extends [string, ...infer R] ? R : never) => {
  const r = parseBackup(t, ...rest);
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

describe('backup file', () => {
  it('round-trips everything: items, categories, logos, actuals, paid records, settings', () => {
    const b = makeBackup(data(), 6, at);
    expect(b).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '2026-10-25T14:00:00.000Z', schemaVersion: 6 });
    const r = parseBackup(backupJson(b));
    if (!r.ok) throw new Error(r.error);
    expect(r.migratedFrom).toBeNull();
    expect(r.backup).toEqual(b);
    expect(describeBackup(r.backup)).toBe('3 items (1 cancelled), 2 categories');
    expect(backupFileName('2026-10-25')).toBe('subscriptions-backup-2026-10-25.json');
  });

  it('reads a file with a byte-order mark', () => {
    expect(parseBackup('\ufeff' + text()).ok).toBe(true);
  });

  it('fills in fields older app versions didn’t write (paid, promo, cancel-by, logo, actuals)', () => {
    const old = JSON.parse(text({ schemaVersion: 2 }));
    for (const s of old.data.subscriptions) {
      for (const k of ['payments', 'promoEndDate', 'regularAmount', 'cancelByDate', 'logo', 'actuals', 'variable', 'createdAt', 'updatedAt']) delete s[k];
    }
    delete old.data.settings;
    const r = parseBackup(JSON.stringify(old));
    if (!r.ok) throw new Error(r.error);
    const s = r.backup.data.subscriptions[0];
    expect(s).toMatchObject({ payments: [], promoEndDate: null, regularAmount: null, cancelByDate: null, logo: null, actuals: [], variable: false, createdAt: '2026-10-25T14:00:00.000Z' });
    expect(r.backup.data.settings).toMatchObject({ homeCurrency: 'CAD', leadDays: 2 });
    expect(r.backup.schemaVersion).toBe(2);
  });

  it('cleans what it can: unknown categories dropped, bad rates and settings ignored, unpaired promo dropped', () => {
    const raw = JSON.parse(text());
    raw.data.subscriptions[0].categoryIds = ['c1', 'nope', 'c1'];
    raw.data.subscriptions[0].payments.push({ date: 'bad', paidOn: '2026-10-01', amount: 1 });
    raw.data.subscriptions[2].regularAmount = null;
    raw.data.settings = { homeCurrency: 'usd', rates: { eur: 1.5, XXX1: 2, GBP: -1 }, leadDays: 99, reminderHour: 'nine' };
    const r = parseBackup(JSON.stringify(raw));
    if (!r.ok) throw new Error(r.error);
    expect(r.backup.data.subscriptions[0].categoryIds).toEqual(['c1']);
    expect(r.backup.data.subscriptions[0].payments).toHaveLength(1);
    expect(r.backup.data.subscriptions[2]).toMatchObject({ promoEndDate: null, regularAmount: null });
    expect(r.backup.data.settings).toEqual({ homeCurrency: 'USD', rates: { EUR: 1.5 }, ratesUpdatedAt: null, leadDays: 2, reminderHour: 9 });
  });

  it('upgrades older formats through the migration ladder', () => {
    const v1 = JSON.parse(text());
    v1.data.items = v1.data.subscriptions; // pretend format 2 renamed the list
    delete v1.data.subscriptions;
    const ladder: Record<number, BackupMigration> = {
      1: (raw) => raw,
      2: (raw) => {
        const d = raw.data as Record<string, unknown>;
        return { ...raw, data: { ...d, subscriptions: d.items } };
      },
    };
    const r = parseBackup(JSON.stringify(v1), ladder, 3);
    if (!r.ok) throw new Error(r.error);
    expect(r.migratedFrom).toBe(1);
    expect(r.backup.version).toBe(3);
    expect(r.backup.data.subscriptions).toHaveLength(3);
    expect(err(JSON.stringify(v1), { 1: (raw) => raw }, 3)).toBe('This app can’t upgrade a backup in format 1. Nothing was changed.');
  });

  it.each([
    ['not json', 'not JSON {', 'it isn’t valid JSON'],
    ['a CSV', 'name,amount\nNetflix,10', 'it isn’t valid JSON'],
    ['other JSON', '{"hello":1}', 'isn’t a Subscription Manager backup'],
    ['an array', '[]', 'isn’t a Subscription Manager backup'],
    ['no version', JSON.stringify({ format: BACKUP_FORMAT, data: {} }), 'no readable format version'],
    ['a newer version', text({ version: BACKUP_VERSION + 1 }), `backup format ${BACKUP_VERSION + 1}; this app reads up to ${BACKUP_VERSION}`],
    ['no data', text({ data: null }), 'The backup has no data section.'],
    ['no subscriptions', text({ data: { categories: [] } }), 'The backup has no list of subscriptions.'],
  ])('rejects %s with a clear message', (_label, t, msg) => {
    const e = err(t);
    expect(e).toContain(msg);
    expect(e.endsWith('Nothing was changed.')).toBe(true);
  });

  const broken = (edit: (raw: { data: { subscriptions: Record<string, unknown>[]; categories: Record<string, unknown>[] } }) => void) => {
    const raw = JSON.parse(text());
    edit(raw);
    return err(JSON.stringify(raw));
  };

  it.each<[string, Parameters<typeof broken>[0], string]>([
    ['no id', (r) => delete r.data.subscriptions[1].id, 'Item 2 (“Hydro”) has no id. Nothing was changed.'],
    ['no name', (r) => (r.data.subscriptions[1].name = '  '), 'Item 2 has no name. Nothing was changed.'],
    ['bad amount', (r) => (r.data.subscriptions[0].amount = '10'), 'Item 1 (“Netflix”): the amount must be a number above 0.'],
    ['bad currency', (r) => (r.data.subscriptions[0].currency = 'dollars'), '“dollars” isn’t a currency code.'],
    ['bad cycle', (r) => (r.data.subscriptions[0].cycle = { unit: 'fortnight', every: 1 }), 'the billing cycle isn’t valid.'],
    ['no cycle', (r) => delete r.data.subscriptions[0].cycle, 'the billing cycle is missing.'],
    ['bad date', (r) => (r.data.subscriptions[2].anchorDate = '2026-02-30'), 'Item 3 (“Rogers”): the charge date isn’t a valid date.'],
    ['bad plan', (r) => (r.data.subscriptions[0].totalPayments = 0), 'the number of payments isn’t valid.'],
    ['duplicate ids', (r) => (r.data.subscriptions[1].id = 'a'), '“Hydro” appears twice (same id)'],
    ['category without name', (r) => (r.data.categories[0].name = ''), 'Category 1 needs an id and a name.'],
    ['duplicate category id', (r) => (r.data.categories[1].id = 'c1'), 'appears twice (same id)'],
    ['duplicate category name', (r) => (r.data.categories[1].name = 'STREAMING'), 'There are two categories named “STREAMING”.'],
  ])('rejects a damaged file: %s', (_label, edit, msg) => {
    expect(broken(edit)).toContain(msg);
  });

  it('refuses a file over the size limit without parsing it', () => {
    expect(err(' '.repeat(MAX_BACKUP_BYTES + 1))).toContain('too big');
  });
});

describe('backup checks added in review', () => {
  it('refuses a file written by a newer database schema, or with an unreadable one', () => {
    expect(err(text({ schemaVersion: 7 }), undefined, undefined, 6)).toBe(
      'This backup was made by a newer version of the app (data version 7; this app reads up to 6). Update the app, then restore it. Nothing was changed.',
    );
    expect(err(text({ schemaVersion: '6' }))).toContain('data version isn’t readable');
    expect(err(text({ schemaVersion: 1.5 }))).toContain('data version isn’t readable');
    expect(parseBackup(text({ schemaVersion: 6 }), undefined, undefined, 6).ok).toBe(true);
    expect(parseBackup(text({ schemaVersion: SCHEMA_VERSION })).ok).toBe(true);
    expect(err(text({ schemaVersion: SCHEMA_VERSION + 1 }))).toContain('newer version of the app');
  });

  it('cuts long names and values in error messages', () => {
    const raw = JSON.parse(text());
    raw.data.subscriptions[0].name = 'N'.repeat(100_000);
    raw.data.subscriptions[0].currency = 'C'.repeat(5_000);
    const e = err(JSON.stringify(raw));
    expect(e.length).toBeLessThan(200);
    expect(e).toBe(`Item 1 (“${'N'.repeat(39)}…”): “${'C'.repeat(39)}…” isn’t a currency code. Nothing was changed.`);
    const dup = JSON.parse(text());
    dup.data.categories[0].name = 'X'.repeat(500);
    dup.data.categories[1].name = 'x'.repeat(500);
    expect(err(JSON.stringify(dup)).length).toBeLessThan(120);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['trial + plan', { trialEndDate: '2026-11-05', totalPayments: 6, startDate: '2026-11-05' }, 'a payment plan can’t have a free trial.'],
    ['variable + plan', { variable: true, totalPayments: 6, startDate: '2026-11-05' }, 'a payment plan’s payments can’t vary.'],
    ['promo + variable', { variable: true, promoEndDate: '2027-01-05', regularAmount: 20 }, 'a bill that varies can’t have a promo price.'],
    ['promo + plan', { promoEndDate: '2027-01-05', regularAmount: 20, totalPayments: 6, startDate: '2026-11-05' }, 'a payment plan can’t have a promo price.'],
  ])('refuses %s, like CSV import and the edit screen', (_label, fields, msg) => {
    const raw = JSON.parse(text());
    Object.assign(raw.data.subscriptions[0], fields);
    expect(err(JSON.stringify(raw))).toBe(`Item 1 (“Netflix”): ${msg} Nothing was changed.`);
  });
});
