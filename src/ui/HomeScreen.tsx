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
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';

import { describeCycle, shortDate } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { markNextPaid, undoablePayment, unmarkPaid } from '../domain/payments';
import { nextDeadlineStamp } from '../domain/reminders';
import { isCompleted, isPlan, isVariable, nextCharge, nextDue, planStatus, withActual } from '../domain/schedule';
import { categoryIdsOf, computeMonthTotals, computeTotals, filterByCategory } from '../domain/totals';
import { UNCATEGORIZED_ID, type Subscription } from '../domain/types';
import { requestPermission } from '../services/notifications';
import { BrandLogo } from './BrandLogo';
import { CategoryFilter } from './CategoryFilter';
import { Button, Card, Row, SectionHeader } from './components';
import { donutSlices, filterOptions } from './look';
import { amountLabel, chargeToLog, deadlineRows, paidRow, parseAmount, upcomingRow, type RowModel } from './rows';
import { SWIPE_COLORS } from './palette';
import { useStore } from './store';
import { TotalsCard } from './TotalsCard';
import { usePalette } from './theme';

/** SwiftUI list on iOS (swipe actions and context menus); the plain React Native list elsewhere. */
const NATIVE_LIST = Platform.OS === 'ios';

interface ListItem {
  s: Subscription;
  model: RowModel;
  /** Rows in the Deadlines section repeat an item, so they need their own key. */
  key?: string;
}

/** A "Paid this month" row: undoDate is the marked charge Undo Paid reverts (null if not marked). */
interface PaidItem {
  s: Subscription;
  model: RowModel;
  key: string;
  undoDate: string | null;
}

/** "Paid this month" shows the most recent few; the rest are one tap away. */
const PAID_PREVIEW = 5;

/** How long the "Marked paid · Undo" bar stays up. */
const UNDO_MS = 8000;

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
        // The next charge still to pay: one marked paid early moves the row on to the next.
        .map((s) => ({ s, next: nextDue(s, today) ?? nextCharge(s, today) }))
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
  const paidItems: PaidItem[] = useMemo(
    () =>
      month.paid.map((e) => ({
        s: e.sub,
        model: paidRow(e, today),
        key: `paid:${e.sub.id}:${e.chargeDate}`,
        undoDate: e.record ? e.record.date : null,
      })),
    [month, today],
  );
  const [showAllPaid, setShowAllPaid] = useState(false);
  const paidShown = showAllPaid ? paidItems : paidItems.slice(0, PAID_PREVIEW);
  const paidMore = paidItems.length > PAID_PREVIEW ? (showAllPaid ? 'Show Fewer' : `Show All ${paidItems.length}`) : null;
  const paidEmpty = { title: 'Nothing paid yet this month', body: 'Charges move here once their date passes or you mark them paid.' };
  const deadlines: ListItem[] = deadlineRows(shown, today).map((d) => ({ s: d.s, model: d.model, key: `${d.kind}:${d.s.id}` }));
  const [undo, setUndo] = useState<{ id: string; date: string; text: string } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);
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

  async function applyPaid(s: Subscription, actual: number | null) {
    const res = markNextPaid(s, today, { actual });
    if (!res) return;
    await store.saveSubscription(res.sub);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setUndo({
      id: s.id,
      date: res.date,
      text: `${s.name}: ${res.date === today ? 'today’s' : shortDate(res.date, today)} charge marked paid${res.early ? ' early' : ''}`,
    });
  }

  /** Marks the next due charge paid. A variable bill can capture what was charged (or skip). */
  function markPaid(s: Subscription) {
    const date = nextDue(s, today);
    if (!date || s.cancelled) return;
    if (!isVariable(s) || Platform.OS !== 'ios') {
      void applyPaid(s, null).catch((e) => Alert.alert('Couldn’t save', String(e)));
      return;
    }
    Alert.prompt(
      `${s.name}: ${shortDate(date, today)}`,
      `How much did you pay? Leave it blank to use the estimate (${amountLabel(s)}).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Paid',
          onPress: (text?: string) => {
            const typed = (text ?? '').trim();
            const amount = typed ? parseAmount(typed) : null;
            if (typed && amount === null) {
              Alert.alert('That isn’t an amount', 'Enter a number greater than 0, like 84.12, or leave it blank.');
              return;
            }
            void applyPaid(s, amount).catch((e) => Alert.alert('Couldn’t save', String(e)));
          },
        },
      ],
      'plain-text',
      '',
      'decimal-pad',
    );
  }

  async function undoPaid(id: string, date: string) {
    const s = store.subscriptions.find((x) => x.id === id);
    setUndo(null);
    if (!s) return;
    await store.saveSubscription(unmarkPaid(s, date));
    Haptics.selectionAsync().catch(() => {});
  }

  /** Context-menu label: "Mark Paid (Nov 5)"; null when there's nothing to pay. */
  function markPaidLabel(s: Subscription): string | null {
    if (s.cancelled) return null;
    const date = nextDue(s, today);
    return date ? `Mark Paid (${date === today ? 'today' : shortDate(date, today)})` : null;
  }

  /** Touch and hold on a "Paid this month" row (plain list). */
  function paidActions({ s, undoDate }: PaidItem) {
    Alert.alert(s.name, undefined, [
      ...(undoDate ? [{ text: `Undo Paid (${shortDate(undoDate, today)})`, onPress: () => void undoPaid(s.id, undoDate) }] : []),
      { text: 'Edit', onPress: () => onEdit(s) },
      { text: 'Close', style: 'cancel' as const },
    ]);
  }

  /** The plain list has no context menu: touch and hold opens the same actions. */
  function moreActions(s: Subscription) {
    const paidLabel = markPaidLabel(s);
    const undoable = undoablePayment(s, today);
    Alert.alert(s.name, undefined, [
      ...(paidLabel ? [{ text: paidLabel, onPress: () => markPaid(s) }] : []),
      ...(undoable ? [{ text: `Undo Paid (${shortDate(undoable.date, today)})`, onPress: () => void undoPaid(s.id, undoable.date) }] : []),
      ...(isVariable(s) && !s.cancelled ? [{ text: 'Log Amount', onPress: () => logAmount(s) }] : []),
      { text: 'Edit', onPress: () => onEdit(s) },
      { text: 'Close', style: 'cancel' as const },
    ]);
  }

  async function setCancelled(s: Subscription, value: boolean) {
    const now = new Date().toISOString();
    const next = { ...s, cancelled: value, updatedAt: now };
    await store.saveSubscription({ ...next, deadlineSetAt: nextDeadlineStamp(s, next, now) });
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
      {undo ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: p.surface, marginHorizontal: 16, marginTop: 12, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}
        >
          <Text style={{ color: p.text, fontSize: 15, flex: 1 }}>{undo.text}</Text>
          <Pressable onPress={() => void undoPaid(undo.id, undo.date)} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: p.accent, fontSize: 15, fontWeight: '600' }}>Undo</Text>
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
    /** Logo, name and badge, date line, amount: shared by every section. */
    const rowBody = (s: Subscription, model: RowModel) => (
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
          <BrandLogo name={s.name} logo={s.logo} size={36} />
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
    );

    const paidNativeRow = (item: PaidItem) => {
      const { s, model, key, undoDate } = item;
      const menu = (
        <ContextMenu key={undoDate ? undefined : key}>
          <ContextMenu.Items>
            <UIButton label="Edit" systemImage="pencil" onPress={() => onEdit(s)} />
            {undoDate ? (
              <UIButton
                label={`Undo Paid (${shortDate(undoDate, today)})`}
                systemImage="arrow.uturn.backward.circle"
                onPress={() => void undoPaid(s.id, undoDate)}
              />
            ) : null}
          </ContextMenu.Items>
          <ContextMenu.Trigger>{rowBody(s, model)}</ContextMenu.Trigger>
        </ContextMenu>
      );
      if (!undoDate) return menu;
      return (
        <SwipeActions key={key}>
          {menu}
          <SwipeActions.Actions edge="leading">
            <UIButton
              label="Undo"
              systemImage="arrow.uturn.backward.circle"
              onPress={() => void undoPaid(s.id, undoDate)}
              modifiers={[tint(SWIPE_COLORS.undo)]}
            />
          </SwipeActions.Actions>
        </SwipeActions>
      );
    };

    const row = ({ s, model, key }: ListItem) => {
      const paidLabel = markPaidLabel(s);
      const undoable = undoablePayment(s, today);
      return (
      <SwipeActions key={key ?? s.id}>
        <ContextMenu>
          <ContextMenu.Items>
            <UIButton label="Edit" systemImage="pencil" onPress={() => onEdit(s)} />
            {paidLabel ? <UIButton label={paidLabel} systemImage="checkmark.circle" onPress={() => markPaid(s)} /> : null}
            {undoable ? (
              <UIButton
                label={`Undo Paid (${shortDate(undoable.date, today)})`}
                systemImage="arrow.uturn.backward.circle"
                onPress={() => void undoPaid(s.id, undoable.date)}
              />
            ) : null}
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
          <ContextMenu.Trigger>{rowBody(s, model)}</ContextMenu.Trigger>
        </ContextMenu>
        <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
          <UIButton label="Delete" systemImage="trash" role="destructive" onPress={() => confirmDelete(s)} modifiers={[tint(SWIPE_COLORS.delete)]} />
          <UIButton
            label={s.cancelled ? 'Restore' : 'Cancel'}
            systemImage={s.cancelled ? 'arrow.uturn.backward' : 'xmark.circle'}
            onPress={() => setCancelled(s, !s.cancelled)}
            modifiers={[tint(SWIPE_COLORS.cancel)]}
          />
        </SwipeActions.Actions>
        {paidLabel || (isVariable(s) && !s.cancelled) ? (
          <SwipeActions.Actions edge="leading">
            {paidLabel ? <UIButton label="Paid" systemImage="checkmark.circle" onPress={() => markPaid(s)} modifiers={[tint(SWIPE_COLORS.paid)]} /> : null}
            {isVariable(s) && !s.cancelled ? (
              <UIButton label="Log" systemImage="square.and.pencil" onPress={() => logAmount(s)} modifiers={[tint(SWIPE_COLORS.log)]} />
            ) : null}
          </SwipeActions.Actions>
        ) : null}
      </SwipeActions>
      );
    };

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
            {shown.length ? (
              <Section title="Paid this month">
                {paidItems.length === 0 ? (
                  <VStack alignment="leading" spacing={4}>
                    <UIText modifiers={[font({ textStyle: 'headline' }), foregroundStyle(p.text)]}>{paidEmpty.title}</UIText>
                    <UIText modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(p.secondaryText)]}>{paidEmpty.body}</UIText>
                  </VStack>
                ) : (
                  paidShown.map(paidNativeRow)
                )}
                {paidMore ? (
                  <HStack
                    modifiers={[
                      contentShape(shapes.rectangle()),
                      onTapGesture(() => setShowAllPaid((v) => !v)),
                      accessibilityElement('combine'),
                      accessibilityLabel(paidMore),
                    ]}
                  >
                    <UIText modifiers={[font({ textStyle: 'body' }), foregroundStyle(p.accent)]}>{paidMore}</UIText>
                    <Spacer />
                  </HStack>
                ) : null}
              </Section>
            ) : null}
            {deadlines.length ? <Section title="Deadlines">{deadlines.map(row)}</Section> : null}
            {completed.length ? <Section title="Completed plans">{completed.map(row)}</Section> : null}
            {cancelled.length ? <Section title="Cancelled">{cancelled.map(row)}</Section> : null}
          </List>
        </Host>
      </View>
    );
  }

  const rnRows = (items: ListItem[]) => (
    <Card>
      {items.map(({ s, model, key }, i) => (
        <Row
          key={key ?? s.id}
          leading={<BrandLogo name={s.name} logo={s.logo} size={32} />}
          title={model.title}
          badge={model.badge}
          subtitle={model.subtitle}
          right={model.right}
          onPress={() => onEdit(s)}
          onLongPress={s.cancelled ? undefined : () => moreActions(s)}
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
      {shown.length ? (
        <>
          <SectionHeader>Paid this month</SectionHeader>
          {paidItems.length === 0 ? (
            <Card style={{ padding: 20, alignItems: 'center' }}>
              <Text style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>{paidEmpty.title}</Text>
              <Text style={{ color: p.secondaryText, fontSize: 15, marginTop: 4, textAlign: 'center' }}>{paidEmpty.body}</Text>
            </Card>
          ) : (
            <Card>
              {paidShown.map((item, i) => (
                <Row
                  key={item.key}
                  leading={<BrandLogo name={item.s.name} logo={item.s.logo} size={32} />}
                  title={item.model.title}
                  badge={item.model.badge}
                  subtitle={item.model.subtitle}
                  right={item.model.right}
                  onPress={() => onEdit(item.s)}
                  onLongPress={() => paidActions(item)}
                  accessibilityLabel={item.model.accessibilityLabel}
                  last={i === paidShown.length - 1}
                />
              ))}
            </Card>
          )}
          {paidMore ? (
            <Pressable onPress={() => setShowAllPaid((v) => !v)} accessibilityRole="button" hitSlop={8} style={{ paddingHorizontal: 20, paddingTop: 8 }}>
              <Text style={{ color: p.accent, fontSize: 15, fontWeight: '600' }}>{paidMore}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {deadlines.length ? (
        <>
          <SectionHeader>Deadlines</SectionHeader>
          {rnRows(deadlines)}
        </>
      ) : null}
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
