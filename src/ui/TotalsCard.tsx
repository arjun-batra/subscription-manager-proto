import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { formatMoney } from '../domain/money';
import type { MonthTotals, TotalsResult } from '../domain/totals';
import type { Subscription } from '../domain/types';
import type { DonutSlice } from './look';
import { SpendDonut } from './SpendDonut';
import { usePalette } from './theme';

/** The totals card: still due, paid progress, averages, plans, and the spend donut. */
export function TotalsCard({
  month,
  totals,
  currency,
  slices,
  estimated,
  scopeName,
}: {
  month: MonthTotals;
  totals: TotalsResult;
  currency: string;
  slices: DonutSlice[];
  /** Some amounts are estimates of variable bills: prefix "about". */
  estimated: boolean;
  /** The filtered category's name, or null for All. */
  scopeName: string | null;
}) {
  const p = usePalette();
  const about = estimated ? 'about ' : '';
  const money = (n: number) => `${about}${formatMoney(n, currency)}`;
  const progress = month.thisMonth > 0 ? Math.min(1, month.paidSoFar / month.thisMonth) : 0;
  const width = useSharedValue(progress);
  useEffect(() => {
    width.value = withTiming(progress, { duration: 450 });
  }, [progress, width]);
  const bar = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  const missingRate = [...new Map([...totals.missingRate, ...month.missingRate].map((s) => [s.id, s])).values()];
  const names = (subs: Subscription[]) => subs.map((s) => `${s.name} (${s.currency})`).join(', ');

  return (
    <View>
      <Text style={{ color: p.secondaryText, fontSize: 15 }}>{scopeName ? `${scopeName} · still due this month` : 'Still due this month'}</Text>
      <Text style={{ color: p.text, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{money(month.stillDue)}</Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Paid this month"
        accessibilityValue={{ text: `Paid ${money(month.paidSoFar)} of ${money(month.thisMonth)}` }}
        style={{ height: 8, borderRadius: 4, backgroundColor: p.chipBg, marginTop: 12, overflow: 'hidden' }}
      >
        <Animated.View style={[{ height: '100%', backgroundColor: p.accent }, bar]} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
        <Text style={{ color: p.secondaryText, fontSize: 15 }}>Paid {money(month.paidSoFar)}</Text>
        <Text style={{ color: p.secondaryText, fontSize: 15 }}>This month {money(month.thisMonth)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        <Text style={{ color: p.text, fontSize: 15 }}>Average {money(totals.overall.monthly)}/mo</Text>
        <Text style={{ color: p.text, fontSize: 15 }}>{money(totals.overall.yearly)}/yr</Text>
      </View>
      {totals.planCount ? (
        <Text style={{ color: p.secondaryText, fontSize: 15, marginTop: 8 }}>
          Left on {totals.planCount} payment plan{totals.planCount === 1 ? '' : 's'}: {formatMoney(totals.plansRemaining, currency)}
        </Text>
      ) : null}
      {totals.plansMissingRate.length ? (
        <Text style={{ color: p.danger, fontSize: 14, marginTop: 8 }}>
          What’s left on plans leaves out {names(totals.plansMissingRate)}: no exchange rate yet.
        </Text>
      ) : null}
      {missingRate.length ? (
        <Text style={{ color: p.danger, fontSize: 14, marginTop: 8 }}>
          Not in totals: {names(missingRate)}. Add a rate in Settings.
        </Text>
      ) : null}
      <SpendDonut slices={slices} currency={currency} />
    </View>
  );
}
