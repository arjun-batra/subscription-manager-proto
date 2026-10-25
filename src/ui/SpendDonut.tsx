import { Text, useColorScheme, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { formatMoney } from '../domain/money';
import type { DonutSlice } from './look';
import { usePalette } from './theme';

/** Average monthly spend by category as a donut, with a legend that repeats every value as text. */
export function SpendDonut({ slices, currency }: { slices: DonutSlice[]; currency: string }) {
  const p = usePalette();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  if (slices.length === 0) return null;
  const label = slices.map((s) => `${s.name} ${formatMoney(s.monthly, currency)} a month, ${Math.round(s.share * 100)}%`).join('; ');
  return (
    <View
      accessible
      accessibilityLabel={`Monthly spend by category: ${label}`}
      style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 16 }}
    >
      <PieChart
        key={scheme}
        donut
        radius={52}
        innerRadius={34}
        innerCircleColor={p.surface}
        strokeWidth={slices.length > 1 ? 2 : 0}
        strokeColor={p.surface}
        data={slices.map((s) => ({ value: s.monthly, color: s.color }))}
      />
      <View style={{ flex: 1, gap: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {slices.map((s) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
            <Text style={{ color: p.text, fontSize: 14, flex: 1 }} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={{ color: p.secondaryText, fontSize: 14, fontVariant: ['tabular-nums'] }}>
              {formatMoney(s.monthly, currency)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
