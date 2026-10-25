import { sub } from '../domain/fixtures';
import { amountLabel, chargeToLog, mergeActuals, parseAmount, upcomingRow } from './rows';

const today = '2026-10-25';

describe('Home rows', () => {
  it('shows a fixed amount plainly', () => {
    const s = sub({ name: 'Netflix', amount: 16.49, anchorDate: '2026-11-03' });
    const r = upcomingRow(s, '2026-11-03', today);
    expect(r.right).toBe('CA$16.49');
    expect(r.badge).toBeUndefined();
    expect(r.subtitle).toContain('Monthly');
  });

  it('shows "about" the estimate for a variable bill', () => {
    const s = sub({
      name: 'Hydro',
      amount: 85,
      variable: true,
      cycle: { unit: 'month', every: 2 },
      anchorDate: '2026-07-20',
      actuals: [
        { date: '2026-07-20', amount: 80 },
        { date: '2026-09-20', amount: 90 },
      ],
    });
    expect(amountLabel(s)).toBe('about CA$85.00');
    const r = upcomingRow(s, '2026-11-20', today);
    expect(r.right).toBe('about CA$85.00');
    expect(r.badge).toEqual({ label: 'Varies', tone: 'neutral' });
    expect(r.subtitle).toContain('varies');
    expect(r.accessibilityLabel).toContain('about CA$85.00');
  });

  it('describes a weekday schedule', () => {
    const s = sub({ name: 'Book club', cycle: { unit: 'month', every: 1, weekday: { nth: 2, day: 2 } }, anchorDate: '2026-11-10' });
    expect(upcomingRow(s, '2026-11-10', today).subtitle).toContain('on the 2nd Tuesday');
  });

  it('shows trials as Free with the price after', () => {
    const s = sub({ name: 'Trial', amount: 9.99, anchorDate: '2026-10-30', startDate: '2026-10-30', trialEndDate: '2026-10-30' });
    const r = upcomingRow(s, '2026-10-30', today);
    expect(r.right).toBe('Free');
    expect(r.badge?.label).toBe('Trial');
  });

  it('picks the newest charge without an actual to log', () => {
    const s = sub({ variable: true, anchorDate: '2026-08-20', startDate: '2026-08-20', actuals: [{ date: '2026-10-20', amount: 90 }] });
    expect(chargeToLog(s, today)).toBe('2026-09-20');
    const all = { ...s, actuals: [...s.actuals!, { date: '2026-09-20', amount: 1 }, { date: '2026-08-20', amount: 1 }] };
    expect(chargeToLog(all, today)).toBe('2026-10-20');
    expect(chargeToLog(sub({ anchorDate: '2026-11-01', startDate: '2026-11-01', variable: true }), today)).toBeNull();
  });

  it.each([
    ['84.12', 84.12],
    ['84,5', 84.5],
    [' 90 ', 90],
    ['0', null],
    ['-3', null],
    ['abc', null],
    ['1e3', null],
    ['', null],
  ])('parseAmount(%j) = %p', (t, n) => {
    expect(parseAmount(t)).toBe(n);
  });
});

describe('mergeActuals (edit screen)', () => {
  const base = sub({
    variable: true,
    anchorDate: '2026-08-20',
    actuals: [
      { date: '2026-08-20', amount: 80 },
      { date: '2026-09-20', amount: 90 },
    ],
  });

  it('adds, replaces and removes', () => {
    expect(mergeActuals(base, { '2026-10-20': '95,5', '2026-09-20': '91', '2026-08-20': ' ' })).toEqual({
      actuals: [
        { date: '2026-09-20', amount: 91 },
        { date: '2026-10-20', amount: 95.5 },
      ],
      dropped: [],
    });
  });

  it('rejects a bad amount', () => {
    expect(mergeActuals(base, { '2026-10-20': 'abc' })).toEqual({ error: 'The amount for 2026-10-20 isn’t a number greater than 0.' });
  });

  it('drops actuals that are no longer charge dates after a schedule change', () => {
    const moved = { ...base, anchorDate: '2026-08-21' };
    expect(mergeActuals(moved, {})).toEqual({ actuals: [], dropped: ['2026-08-20', '2026-09-20'] });
  });
});
