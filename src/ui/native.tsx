/**
 * Small native controls: SwiftUI pickers on iOS (through @expo/ui), chips elsewhere.
 * Each sits in its own Host that sizes itself to the SwiftUI content.
 */
import { Host, Picker, Text as UIText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Platform, useColorScheme, View } from 'react-native';

import { Chip } from './components';
import { usePalette } from './theme';

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

function select<T extends string | number>(value: T, current: T, onChange: (v: T) => void) {
  if (value === current) return;
  Haptics.selectionAsync().catch(() => {});
  onChange(value);
}

/** A segmented control (2-4 short options). */
export function Segmented<T extends string | number>({
  choices,
  value,
  onChange,
  label,
}: {
  choices: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const p = usePalette();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  if (Platform.OS === 'ios') {
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <Host matchContents={{ vertical: true }} colorScheme={scheme} seedColor={p.accent}>
          <Picker<T> label={label} selection={value} onSelectionChange={(v) => select(v, value, onChange)} modifiers={[pickerStyle('segmented')]}>
            {choices.map((c) => (
              <UIText key={String(c.value)} modifiers={[tag(c.value)]}>
                {c.label}
              </UIText>
            ))}
          </Picker>
        </Host>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 8 }} accessibilityLabel={label}>
      {choices.map((c) => (
        <Chip key={String(c.value)} label={c.label} selected={c.value === value} onPress={() => select(c.value, value, onChange)} />
      ))}
    </View>
  );
}

/** A menu picker (a native pop-up list on iOS) for longer lists, like weekdays. */
export function MenuPicker<T extends string | number>({
  choices,
  value,
  onChange,
  label,
}: {
  choices: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const p = usePalette();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  if (Platform.OS === 'ios') {
    return (
      <Host matchContents colorScheme={scheme} seedColor={p.accent}>
        <Picker<T> label={label} selection={value} onSelectionChange={(v) => select(v, value, onChange)} modifiers={[pickerStyle('menu')]}>
          {choices.map((c) => (
            <UIText key={String(c.value)} modifiers={[tag(c.value)]}>
              {c.label}
            </UIText>
          ))}
        </Picker>
      </Host>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityLabel={label}>
      {choices.map((c) => (
        <Chip key={String(c.value)} label={c.label} selected={c.value === value} onPress={() => select(c.value, value, onChange)} />
      ))}
    </View>
  );
}
