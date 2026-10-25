import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { usePalette } from './theme';

export function SectionHeader({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text accessibilityRole="header" style={[styles.sectionHeader, { color: p.secondaryText }]}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  return <View style={[styles.card, { backgroundColor: p.surface }, style]}>{children}</View>;
}

export function Row({
  title,
  subtitle,
  right,
  onPress,
  last,
  accessibilityLabel,
  danger,
  badge,
  leading,
  onLongPress,
}: {
  title: string;
  /** Shown before the title, e.g. a logo. */
  leading?: ReactNode;
  onLongPress?: () => void;
  /** Small pill after the title, e.g. "Trial" or "Plan". */
  badge?: { label: string; tone: 'trial' | 'neutral' };
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  accessibilityLabel?: string;
  danger?: boolean;
}) {
  const p = usePalette();
  const content = (
    <View style={[styles.row, !last && { borderBottomColor: p.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      {leading ? <View style={{ marginRight: 12 }}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[styles.rowTitle, { color: danger ? p.danger : p.text, flexShrink: 1 }]} numberOfLines={1}>
            {title}
          </Text>
          {badge ? (
            <View
              style={[styles.badge, { backgroundColor: badge.tone === 'trial' ? p.warningBg : p.chipBg }]}
              accessibilityLabel={badge.label}
            >
              <Text style={[styles.badgeText, { color: badge.tone === 'trial' ? p.warningText : p.chipText }]}>{badge.label}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: p.secondaryText }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {typeof right === 'string' ? <Text style={[styles.rowRight, { color: p.text }]}>{right}</Text> : right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = 'plain',
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: 'plain' | 'filled' | 'danger';
  disabled?: boolean;
}) {
  const p = usePalette();
  const filled = kind === 'filled';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        filled && { backgroundColor: p.accent },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: filled ? p.onAccent : kind === 'danger' ? p.danger : p.accent },
          filled && { fontWeight: '600' },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.field, { borderBottomColor: p.separator }]}>
      <Text style={[styles.fieldLabel, { color: p.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={p.secondaryText}
        accessibilityLabel={label}
        {...props}
        style={[styles.fieldInput, { color: p.text }, props.style]}
      />
      {error ? (
        <Text style={[styles.fieldError, { color: p.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={[styles.chip, { backgroundColor: selected ? p.chipSelectedBg : p.chipBg }]}
    >
      <Text style={{ color: selected ? p.chipSelectedText : p.chipText, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: 13,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 6,
    marginHorizontal: 20,
  },
  card: { borderRadius: 12, marginHorizontal: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, minHeight: 48 },
  rowTitle: { fontSize: 17 },
  rowSubtitle: { fontSize: 14, marginTop: 2 },
  rowRight: { fontSize: 17, fontVariant: ['tabular-nums'], marginLeft: 12 },
  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { fontSize: 17 },
  field: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  fieldLabel: { fontSize: 13, marginBottom: 4 },
  fieldInput: { fontSize: 17, paddingVertical: 4 },
  fieldError: { fontSize: 13, marginTop: 4 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, marginRight: 8, marginBottom: 8 },
});
