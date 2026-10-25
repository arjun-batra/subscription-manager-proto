import { DEFAULT_SETTINGS, type Cycle, type Settings, type Subscription } from './types';

let n = 0;
export function sub(partial: Partial<Subscription> & { cycle?: Cycle } = {}): Subscription {
  n += 1;
  return {
    id: partial.id ?? `s${n}`,
    name: partial.name ?? `Sub ${n}`,
    amount: partial.amount ?? 10,
    currency: partial.currency ?? 'CAD',
    cycle: partial.cycle ?? { unit: 'month', every: 1 },
    anchorDate: partial.anchorDate ?? '2026-11-05',
    startDate: partial.startDate ?? null,
    categoryIds: partial.categoryIds ?? [],
    notes: partial.notes ?? '',
    manageUrl: partial.manageUrl ?? '',
    remindersEnabled: partial.remindersEnabled ?? true,
    cancelled: partial.cancelled ?? false,
    createdAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-25T00:00:00.000Z',
  };
}

export const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
