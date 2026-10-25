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
    trialEndDate: partial.trialEndDate ?? null,
    totalPayments: partial.totalPayments ?? null,
    variable: partial.variable ?? false,
    actuals: partial.actuals ?? [],
    logo: partial.logo ?? null,
    payments: partial.payments ?? [],
    promoEndDate: partial.promoEndDate ?? null,
    regularAmount: partial.regularAmount ?? null,
    cancelByDate: partial.cancelByDate ?? null,
    // Tests that pass updatedAt for a late save get the same deadline stamp unless they say otherwise.
    deadlineSetAt: partial.deadlineSetAt !== undefined ? partial.deadlineSetAt : (partial.updatedAt ?? '2026-10-25T00:00:00.000Z'),
    categoryIds: partial.categoryIds ?? [],
    notes: partial.notes ?? '',
    manageUrl: partial.manageUrl ?? '',
    remindersEnabled: partial.remindersEnabled ?? true,
    cancelled: partial.cancelled ?? false,
    createdAt: partial.createdAt ?? '2026-10-25T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-10-25T00:00:00.000Z',
  };
}

export const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
