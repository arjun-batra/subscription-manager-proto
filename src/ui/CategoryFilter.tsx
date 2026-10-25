import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, Text } from 'react-native';

import { CategoryIcon } from './CategoryIcon';
import type { FilterOption } from './look';
import { usePalette } from './theme';

/** Horizontal chips: All, then each category. Selecting one filters the list and the totals. */
export function CategoryFilter({
  options,
  selected,
  onSelect,
}: {
  options: FilterOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const p = usePalette();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4, gap: 8 }}
    >
      {options.map((o) => {
        const on = o.id === selected;
        return (
          <Pressable
            key={o.id ?? 'all'}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.name}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync().catch(() => {});
              onSelect(o.id);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 7,
              paddingHorizontal: 12,
              borderRadius: 16,
              backgroundColor: on ? p.chipSelectedBg : p.chipBg,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <CategoryIcon symbol={o.symbol} color={on ? p.chipSelectedText : p.chipText} size={14} />
            <Text style={{ color: on ? p.chipSelectedText : p.chipText, fontSize: 15, fontWeight: on ? '600' : '400' }}>{o.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
