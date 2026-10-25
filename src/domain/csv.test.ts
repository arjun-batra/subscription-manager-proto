import { CSV_TEMPLATE, importAllValidRows, importSelectedRows, parseCsv, parseCycle, previewImport, toCsv } from './csv';
import { sub } from './fixtures';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const text = '\uFEFFname,notes\r\n"Disney, Plus","said ""hi"""\r\n\r\nB,\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'notes'],
      ['Disney, Plus', 'said "hi"'],
      ['B', ''],
    ]);
  });
  it('detects semicolon-separated files', () => {
    expect(parseCsv('name;amount\nA;9,99')).toEqual([
      ['name', 'amount'],
      ['A', '9,99'],
    ]);
  });
});

describe('parseCycle', () => {
  it.each([
    ['Monthly', { unit: 'month', every: 1 }],
    ['quarterly', { unit: 'month', every: 3 }],
    ['every 2 weeks', { unit: 'week', every: 2 }],
    ['Every 10 days', { unit: 'day', every: 10 }],
    ['yearly', { unit: 'year', every: 1 }],
  ])('%s', (raw, expected) => expect(parseCycle(raw)).toEqual(expected));
  it('rejects junk', () => expect(parseCycle('sometimes')).toBeNull());
});

describe('previewImport', () => {
  it('imports a 20-row template with fields intact', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `Svc ${i},${i + 1}.5,USD,monthly,2026-11-${String(i + 1).padStart(2, '0')},A; B,n${i},https://x.example/${i}`);
    const p = previewImport(CSV_TEMPLATE.split('\r\n')[0] + '\n' + rows.join('\n'), []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows).toHaveLength(20);
    expect(p.rows.every((r) => r.status === 'valid' && r.checked)).toBe(true);
    expect(p.rows[3].draft).toEqual({
      name: 'Svc 3',
      amount: 4.5,
      currency: 'USD',
      cycle: { unit: 'month', every: 1 },
      anchorDate: '2026-11-04',
      categoryNames: ['A', 'B'],
      notes: 'n3',
      manageUrl: 'https://x.example/3',
    });
  });

  it('accepts reordered and extra columns, any case', () => {
    const p = previewImport(' Next Charge Date ,EXTRA,Cycle,Currency,Amount,Name\n2026-11-01,zz,yearly,cad,99,Notion', []);
    expect(p.ok && p.rows[0].draft).toMatchObject({ name: 'Notion', amount: 99, currency: 'CAD' });
  });

  it('rejects a file missing amount, naming the column', () => {
    const p = previewImport('name,currency,cycle,next charge date\nA,CAD,monthly,2026-11-01', []);
    expect(p).toEqual({ ok: false, error: 'Missing column: amount. Nothing was imported.' });
  });

  it('flags duplicates unchecked (in-file and vs existing) and invalid rows unselectable', () => {
    const existing = [sub({ name: 'Netflix', amount: 16.49 })];
    const text = [
      'name,amount,currency,cycle,next charge date',
      'netflix ,16.49,CAD,monthly,2026-11-05', // dup of existing
      'Spotify,11.99,CAD,monthly,2026-11-07',
      'Spotify,11.99,CAD,monthly,2026-11-08', // dup within file
      'Bad,-1,CAD,monthly,2026-11-31',
      'iCloud,3.99,CAD,monthly,2026-11-09',
      'Disney,13.99,CAD,monthly,2026-11-10',
    ].join('\n');
    const p = previewImport(text, existing);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => [r.status, r.checked])).toEqual([
      ['duplicate', false],
      ['valid', true],
      ['duplicate', false],
      ['invalid', false],
      ['valid', true],
      ['valid', true],
    ]);
    expect(p.rows[3].reason).toMatch(/amount/);
    expect(p.rows[3].reason).toMatch(/date/);
    // "Import all valid (3)"; after ticking one duplicate it is (4).
    expect(importAllValidRows(p.rows)).toHaveLength(3);
    p.rows[0].checked = true;
    expect(importAllValidRows(p.rows)).toHaveLength(4);
    // Select none -> nothing
    expect(importSelectedRows(p.rows.map((r) => ({ ...r, checked: false })))).toHaveLength(0);
  });
});

describe('toCsv', () => {
  it('round-trips through the importer', () => {
    const cats = [{ id: 'c1', name: 'Streaming' }];
    const subs = [
      sub({ name: 'A, "quoted"', amount: 9.5, cycle: { unit: 'week', every: 2 }, categoryIds: ['c1'], notes: 'line1\nline2' }),
      sub({ name: 'B', amount: 100, cycle: { unit: 'year', every: 1 }, anchorDate: '2027-01-31' }),
    ];
    const p = previewImport(toCsv(subs, cats), []);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => r.draft)).toEqual([
      { name: 'A, "quoted"', amount: 9.5, currency: 'CAD', cycle: { unit: 'week', every: 2 }, anchorDate: '2026-11-05', categoryNames: ['Streaming'], notes: 'line1\nline2', manageUrl: '' },
      { name: 'B', amount: 100, currency: 'CAD', cycle: { unit: 'year', every: 1 }, anchorDate: '2027-01-31', categoryNames: [], notes: '', manageUrl: '' },
    ]);
  });
});
