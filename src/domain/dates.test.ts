import {
  addMonthsClamped,
  nextOnOrAfter,
  occurrence,
  occurrencesBetween,
  parseLocalDate,
  toLocalDate,
} from './dates';

describe('dates', () => {
  it('validates dates including leap years', () => {
    expect(parseLocalDate('2028-02-29')).not.toBeNull();
    expect(parseLocalDate('2027-02-29')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('11/05/2026')).toBeNull();
  });

  it('clamps month-end and returns to the original day (Jan 31 -> Feb 28 -> Mar 31)', () => {
    const c = { unit: 'month' as const, every: 1 };
    expect(occurrence('2027-01-31', c, 1)).toBe('2027-02-28');
    expect(occurrence('2027-01-31', c, 2)).toBe('2027-03-31');
    expect(occurrence('2027-01-31', c, 3)).toBe('2027-04-30');
    expect(occurrence('2028-01-31', c, 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('handles yearly Feb 29', () => {
    const y = { unit: 'year' as const, every: 1 };
    expect(occurrence('2028-02-29', y, 1)).toBe('2029-02-28');
    expect(occurrence('2028-02-29', y, 4)).toBe('2032-02-29');
  });

  it('rolls forward for every cycle kind', () => {
    expect(nextOnOrAfter('2026-10-01', { unit: 'week', every: 1 }, '2026-10-25')).toBe('2026-10-29');
    expect(nextOnOrAfter('2026-10-01', { unit: 'week', every: 2 }, '2026-10-25')).toBe('2026-10-29');
    expect(nextOnOrAfter('2026-10-01', { unit: 'day', every: 10 }, '2026-10-25')).toBe('2026-10-31');
    expect(nextOnOrAfter('2026-01-31', { unit: 'month', every: 1 }, '2026-10-25')).toBe('2026-10-31');
    expect(nextOnOrAfter('2026-01-15', { unit: 'month', every: 3 }, '2026-10-25')).toBe('2027-01-15');
    expect(nextOnOrAfter('2025-03-10', { unit: 'year', every: 1 }, '2026-10-25')).toBe('2027-03-10');
    // A charge today is "on or after" today.
    expect(nextOnOrAfter('2026-10-25', { unit: 'month', every: 1 }, '2026-10-25')).toBe('2026-10-25');
  });

  it('projects backwards from an anchor in the future', () => {
    expect(occurrencesBetween('2026-11-05', { unit: 'month', every: 1 }, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-05',
    ]);
  });

  it('lists every weekly charge in a month', () => {
    expect(occurrencesBetween('2026-10-02', { unit: 'week', every: 1 }, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-02',
      '2026-10-09',
      '2026-10-16',
      '2026-10-23',
      '2026-10-30',
    ]);
  });

  it('uses the local calendar day, not UTC', () => {
    expect(toLocalDate(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31');
    expect(toLocalDate(new Date(2026, 10, 1, 0, 0))).toBe('2026-11-01');
  });
});
