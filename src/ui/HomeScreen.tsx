import {
  Button as UIButton,
  ContextMenu,
  HStack,
  Host,
  List,
  RNHostView,
  Section,
  Spacer,
  SwipeActions,
  Text as UIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityElement,
  accessibilityLabel,
  background,
  contentShape,
  font,
  foregroundStyle,
  lineLimit,
  listStyle,
  monospacedDigit,
  onTapGesture,
  padding,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';

import { describeCycle, shortDate } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { isCompleted, isPlan, isVariable, nextCharge, planStatus, withActual } from '../domain/schedule';
import { categoryIdsOf, computeMonthTotals, computeTotals, filterByCategory } from '../domain/totals';
import { UNCATEGORIZED_ID, type Subscription } from '../domain/types';
import { requestPermission } from '../services/notifications';
import { BrandLogo } from './BrandLogo';
import { CategoryFilter } from './CategoryFilter';
import { Button, Card, Row, SectionHeader } from './components';
import { donutSlices, filterOptions } from './look';
import { amountLabel, chargeToLog, parseAmount, upcomingRow, type RowModel } from './rows';
import { useStore } from './store';
import { TotalsCard } from './TotalsCard';
import { usePalette } from './theme';

/** SwiftUI list on iOS (swipe actions and context menus); the plain React Native list elsewhere. */
const NATIVE_LIST = Platform.OS === 'ios';

interface ListItem {
  s: Subscription;
  model: RowModel;
}

export function HomeScreen({ onEdit, onAdd }: { onEdit: (s: Subscription) => void; onAdd: () => void }) {
  const p = usePalette();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const store = useStore();
  const { subscriptions, categories, settings, today, health, refresh, categoryFilter, setCategoryFilter } = store;
  const home = settings.homeCurrency;

  const options = useMemo(
    () => filterOptions(categories, subscriptions.some((s) => categoryIdsOf(s, categories).includes(UNCATEGORIZED_ID))),
    [categories, subscriptions],
  );
  // A remembered category that was deleted falls back to All.
  const filter = options.some((o) => o.id === categoryFilter) ? categoryFilter : null;
  const scopeName = filter === null ? null : (options.find((o) => o.id === filter)?.name ?? null);
  const shown = useMemo(() => filterByCategory(subscriptions, categories, filter), [subscriptions, categories, filter]);

  const month = useMemo(() => computeMonthTotals(shown, settings, today), [shown, settings, today]);
  const totals = useMemo(() => computeTotals(shown, categories, settings, today), [shown, categories, settings, today]);
  const slices = useMemo(() => (filter === null ? donutSlices(totals.categories, scheme) : []), [filter, totals, scheme]);
  const estimated = shown.some((s) => !s.cancelled && isVariable(s));

  const active: ListItem[] = useMemo(
    () =>
      shown
        .filter((s) => !s.cancelled && !isCompleted(s, today))
        .map((s) => ({ s, next: nextCharge(s, today) }))
        .sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : a.s.name.localeCompare(b.s.name)))
        .map(({ s, next }) => ({ s, model: upcomingRow(s, next, today) })),
    [shown, today],
  );
  const completed: ListItem[] = shown
    .filter((s) => !s.cancelled && isCompleted(s, today))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const plan = planStatus(s, today)!;
      return {
        s,
        model: {
          title: s.name,
          subtitle: `All ${plan.total} paid · last payment ${shortDate(plan.lastPayment, today)}`,
          badge: { label: 'Completed', tone: 'neutral' },
          right: formatMoney(plan.total * s.amount, s.currency),
          accessibilityLabel: `${s.name}, completed, all ${plan.total} paid`,
        },
      };
    });
  const cancelled: ListItem[] = shown
    .filter((s) => s.cancelled)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const subtitle = isPlan(s) ? `Payment plan · ${describeCycle(s.cycle)}` : describeCycle(s.cycle);
      return { s, model: { title: s.name, subtitle, right: amountLabel(s), accessibilityLabel: `${s.name}, cancelled, ${subtitle}` } };
    });

  async function fixReminders() {
    if (!health.ok && health.reason === 'permission' && health.permission === 'undetermined') {
      await requestPermission();
      await refresh();
    } else if (!health.ok && health.reason === 'permission') {
      await Linking.openSettings();
    } else {
      await refresh();
    }
  }

  function logAmount(s: Subscription) {
    const date = chargeToLog(s, today);
    if (!date) {
      Alert.alert('Nothing to log yet', `${s.name}’s first charge hasn’t happened.`);
      return;
    }
    if (Platform.OS !== 'ios') {
      onEdit(s); // Alert.prompt is iOS-only; the edit screen has the same field.
      return;
    }
    const existing = s.actuals?.find((a) => a.date === date);
    Alert.prompt(
      `${s.name}: ${shortDate(date, today)}`,
      `What was actually charged? Future charges are estimated from the last 3 you log. Now ${amountLabel(s)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async (text?: string) => {
            const amount = parseAmount(text ?? '');
            if (amount === null) {
              Alert.alert('That isn’t an amount', 'Enter a number greater than 0, like 84.12.');
              return;
            }
            await store.saveSubscription({ ...withActual(s, date, amount), updatedAt: new Date().toISOString() });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          },
        },
      ],
      'plain-text',
      existing ? String(existing.amount) : '',
      'decimal-pad',
    );
  }

  async function setCancelled(s: Subscription, value: boolean) {
    await store.saveSubscription({ ...s, cancelled: value, updatedAt: new Date().toISOString() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function confirmDelete(s: Subscription) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Alert.alert(`Delete ${s.name}?`, 'This removes it and its reminders. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => store.deleteSubscription(s.id) },
    ]);
  }

  const header = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 34, fontWeight: '700' }}>
          Subscriptions
        </Text>
        <Button title="Add" kind="filled" onPress={onAdd} />
      </View>
      {!health.ok ? (
        <View
          accessibilityRole="alert"
          style={{ backgroundColor: p.warningBg, marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 14 }}
        >
          <Text style={{ color: p.warningText, fontSize: 15, fontWeight: '600' }}>Reminders can’t fire</Text>
          <Text style={{ color: p.warningText, fontSize: 15, marginTop: 4 }}>{health.message}</Text>
          <Pressable onPress={fixReminders} accessibilityRole="button" style={{ marginTop: 8 }}>
            <Text style={{ color: p.warningText, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' }}>
              {health.reason === 'permission'
                ? health.permission === 'undetermined'
                  ? 'Allow Notifications'
                  : 'Turn On in Settings'
                : 'Try Again'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {options.length > 1 ? (
        <View style={{ marginTop: 12 }}>
          <CategoryFilter options={options} selected={filter} onSelect={setCategoryFilter} />
        </View>
      ) : null}
    </>
  );

  const totalsCard = (
    <TotalsCard month={month} totals={totals} currency={home} slices={slices} estimated={estimated} scopeName={scopeName} />
  );

  const empty =
    filter === null ? (
      { title: 'No subscriptions yet', body: 'Add one, or import a CSV from Settings. Everything stays on this phone.' }
    ) : (
      { title: `Nothing in ${scopeName}`, body: 'Pick All to see everything, or add a category to a subscription when you edit it.' }
    );

  if (NATIVE_LIST) {
    const row = ({ s, model }: ListItem) => (
      <SwipeActions key={s.id}>
        <ContextMenu>
          <ContextMenu.Items>
            <UIButton label="Edit" systemImage="pencil" onPress={() => onEdit(s)} />
            {isVariable(s) && !s.cancelled ? (
              <UIButton label="Log Amount" systemImage="square.and.pencil" onPress={() => logAmount(s)} />
            ) : null}
            {s.manageUrl ? <UIButton label="Manage" systemImage="safari" onPress={() => Linking.openURL(s.manageUrl)} /> : null}
            <UIButton
              label={s.cancelled ? 'Restore' : 'Mark Cancelled'}
              systemImage={s.cancelled ? 'arrow.uturn.backward' : 'xmark.circle'}
              onPress={() => setCancelled(s, !s.cancelled)}
            />
            <UIButton label="Delete" systemImage="trash" role="destructive" onPress={() => confirmDelete(s)} />
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <HStack
              spacing={12}
              modifiers={[
                contentShape(shapes.rectangle()),
                onTapGesture(() => onEdit(s)),
                accessibilityElement('combine'),
                accessibilityLabel(model.accessibilityLabel),
              ]}
            >
              <RNHostView matchContents>
                <BrandLogo name={s.name} size={36} />
              </RNHostView>
              <VStack alignment="leading" spacing={2}>
                <HStack spacing={6}>
                  <UIText modifiers={[font({ textStyle: 'body' }), foregroundStyle(p.text), lineLimit(1)]}>{model.title}</UIText>
                  {model.badge ? (
                    <UIText
                      modifiers={[
                        font({ textStyle: 'caption', weight: 'semibold' }),
                        foregroundStyle(model.badge.tone === 'trial' ? p.warningText : p.chipText),
                        padding({ leading: 6, trailing: 6, top: 2, bottom: 2 }),
                        background(model.badge.tone === 'trial' ? p.warningBg : p.chipBg, shapes.roundedRectangle({ cornerRadius: 6 })),
                      ]}
                    >
                      {model.badge.label}
                    </UIText>
                  ) : null}
                </HStack>
                <UIText modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(p.secondaryText), lineLimit(2)]}>
                  {model.subtitle}
                </UIText>
              </VStack>
              <Spacer />
              <UIText modifiers={[font({ textStyle: 'body' }), foregroundStyle(p.text), monospacedDigit()]}>{model.right}</UIText>
            </HStack>
          </ContextMenu.Trigger>
        </ContextMenu>
        <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
          <UIButton label="Delete" systemImage="trash" role="destructive" onPress={() => confirmDelete(s)} />
          <UIButton
            label={s.cancelled ? 'Restore' : 'Cancel'}
            systemImage={s.cancelled ? 'arrow.uturn.backward' : 'xmark.circle'}
            onPress={() => setCancelled(s, !s.cancelled)}
            modifiers={[tint('orange')]}
          />
        </SwipeActions.Actions>
        {isVariable(s) && !s.cancelled ? (
          <SwipeActions.Actions edge="leading">
            <UIButton label="Log" systemImage="square.and.pencil" onPress={() => logAmount(s)} modifiers={[tint(p.accent)]} />
          </SwipeActions.Actions>
        ) : null}
      </SwipeActions>
    );

    return (
      <View style={{ flex: 1, backgroundColor: p.background }}>
        {header}
        <Host style={{ flex: 1 }} colorScheme={scheme} seedColor={p.accent}>
          <List modifiers={[listStyle('insetGrouped')]}>
            <Section>
              <RNHostView matchContents={{ vertical: true }}>
                <View style={{ paddingVertical: 8 }}>{totalsCard}</View>
              </RNHostView>
            </Section>
            <Section title="Upcoming">
              {active.length === 0 ? (
                <VStack alignment="leading" spacing={4}>
                  <UIText modifiers={[font({ textStyle: 'headline' }), foregroundStyle(p.text)]}>{empty.title}</UIText>
                  <UIText modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(p.secondaryText)]}>{empty.body}</UIText>
                </VStack>
              ) : (
                active.map(row)
              )}
            </Section>
            {completed.length ? <Section title="Completed plans">{completed.map(row)}</Section> : null}
            {cancelled.length ? <Section title="Cancelled">{cancelled.map(row)}</Section> : null}
          </List>
        </Host>
      </View>
    );
  }

  const rnRows = (items: ListItem[]) => (
    <Card>
      {items.map(({ s, model }, i) => (
        <Row
          key={s.id}
          leading={<BrandLogo name={s.name} size={32} />}
          title={model.title}
          badge={model.badge}
          subtitle={model.subtitle}
          right={model.right}
          onPress={() => onEdit(s)}
          onLongPress={isVariable(s) && !s.cancelled ? () => logAmount(s) : undefined}
          accessibilityLabel={model.accessibilityLabel}
          last={i === items.length - 1}
        />
      ))}
    </Card>
  );

  return (
    <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={{ paddingBottom: 32 }}>
      {header}
      <Card style={{ marginTop: 16, padding: 16 }}>{totalsCard}</Card>
      <SectionHeader>Upcoming</SectionHeader>
      {active.length === 0 ? (
        <Card style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>{empty.title}</Text>
          <Text style={{ color: p.secondaryText, fontSize: 15, marginTop: 4, textAlign: 'center' }}>{empty.body}</Text>
          {filter === null ? (
            <View style={{ marginTop: 12 }}>
              <Button title="Add Subscription" kind="filled" onPress={onAdd} />
            </View>
          ) : null}
        </Card>
      ) : (
        rnRows(active)
      )}
      {completed.length ? (
        <>
          <SectionHeader>Completed plans</SectionHeader>
          {rnRows(completed)}
        </>
      ) : null}
      {cancelled.length ? (
        <>
          <SectionHeader>Cancelled</SectionHeader>
          {rnRows(cancelled)}
        </>
      ) : null}
    </ScrollView>
  );
}
