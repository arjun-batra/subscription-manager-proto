import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, Switch, Text, View } from 'react-native';

import { newId } from '../data/db';
import { formatYMD, isValidLocalDate, parseLocalDate, toLocalDate } from '../domain/dates';
import { COMMON_CURRENCIES, isValidCurrency } from '../domain/money';
import { cycleShorterThanLead, nextCharge } from '../domain/schedule';
import type { Cycle, Subscription } from '../domain/types';
import { Button, Card, Chip, Field, Row, SectionHeader } from './components';
import { useStore } from './store';
import { usePalette } from './theme';

const CYCLES: { label: string; cycle: Cycle }[] = [
  { label: 'Weekly', cycle: { unit: 'week', every: 1 } },
  { label: 'Monthly', cycle: { unit: 'month', every: 1 } },
  { label: 'Quarterly', cycle: { unit: 'month', every: 3 } },
  { label: 'Yearly', cycle: { unit: 'year', every: 1 } },
  { label: 'Custom', cycle: { unit: 'day', every: 30 } },
];
const UNITS: Cycle['unit'][] = ['day', 'week', 'month', 'year'];

const sameCycle = (a: Cycle, b: Cycle) => a.unit === b.unit && a.every === b.every;

export function EditSubscription({ existing, onDone }: { existing?: Subscription; onDone: () => void }) {
  const p = usePalette();
  const store = useStore();
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [currency, setCurrency] = useState(existing?.currency ?? store.settings.homeCurrency);
  const [cycle, setCycle] = useState<Cycle>(existing?.cycle ?? { unit: 'month', every: 1 });
  const [custom, setCustom] = useState(existing ? !CYCLES.slice(0, 4).some((c) => sameCycle(c.cycle, existing.cycle)) : false);
  // Show the next upcoming charge, not the stored anchor (which can be months back).
  const [initialDate] = useState(() => (existing ? nextCharge(existing, store.today) : store.today));
  const [date, setDate] = useState(initialDate);
  const [firstCharge, setFirstCharge] = useState(!!existing?.startDate);
  const [categoryIds, setCategoryIds] = useState<string[]>(existing?.categoryIds ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [manageUrl, setManageUrl] = useState(existing?.manageUrl ?? '');
  const [reminders, setReminders] = useState(existing?.remindersEnabled ?? true);
  const [cancelled, setCancelled] = useState(existing?.cancelled ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const amountNum = Number(amount.replace(',', '.'));

  async function save() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter a name.';
    if (!amount.trim() || !Number.isFinite(amountNum) || amountNum <= 0) e.amount = 'Enter an amount greater than 0.';
    if (!isValidCurrency(currency)) e.currency = 'Use a 3-letter code, like CAD or USD.';
    if (!Number.isInteger(cycle.every) || cycle.every < 1 || cycle.every > 365) e.cycle = 'Enter a whole number from 1 to 365.';
    if (!isValidLocalDate(date)) e.date = 'Pick a date.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    const now = new Date().toISOString();
    // Keep the original anchor when neither the date nor the cycle changed, so month-end
    // rules still follow it (Jan 31 -> Feb 28 -> Mar 31).
    const keepAnchor = !!existing && date === initialDate && sameCycle(cycle, existing.cycle);
    const anchorDate = keepAnchor ? existing!.anchorDate : date;
    const startDate = firstCharge ? (keepAnchor ? (existing!.startDate ?? date) : date) : null;
    try {
      await store.saveSubscription({
        id: existing?.id ?? newId(),
        name: name.trim(),
        amount: amountNum,
        currency: currency.trim().toUpperCase(),
        cycle,
        anchorDate,
        startDate,
        categoryIds,
        notes: notes.trim(),
        manageUrl: manageUrl.trim(),
        remindersEnabled: reminders,
        cancelled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      onDone();
    } catch (err) {
      Alert.alert('Couldn’t save', String(err));
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!existing) return;
    Alert.alert(`Delete ${existing.name}?`, 'This removes it and its reminders. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await store.deleteSubscription(existing.id);
          onDone();
        },
      },
    ]);
  }

  const ymd = parseLocalDate(date) ?? parseLocalDate(toLocalDate(new Date()))!;
  const pickerValue = new Date(ymd.y, ymd.m - 1, ymd.d);
  const onDate = (_: DateTimePickerEvent, d?: Date) => {
    if (d) setDate(formatYMD({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }));
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 }}>
        <Button title="Cancel" onPress={onDone} />
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>
          {existing ? 'Edit' : 'New Subscription'}
        </Text>
        <Button title="Save" onPress={save} disabled={saving} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>
        <Card style={{ marginTop: 8 }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Netflix" error={errors.name} autoFocus={!existing} />
          <Field
            label="Amount"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="16.49"
            error={errors.amount}
          />
          <Field
            label="Currency"
            value={currency}
            onChangeText={(t) => setCurrency(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={3}
            error={errors.currency}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 8 }}>
            {COMMON_CURRENCIES.map((c) => (
              <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
            ))}
          </View>
        </Card>

        <SectionHeader>Billing</SectionHeader>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, paddingBottom: 4 }}>
            {CYCLES.map((c) => {
              const selected = c.label === 'Custom' ? custom : !custom && sameCycle(c.cycle, cycle);
              return (
                <Chip
                  key={c.label}
                  label={c.label}
                  selected={selected}
                  onPress={() => {
                    setCustom(c.label === 'Custom');
                    if (c.label !== 'Custom') setCycle(c.cycle);
                  }}
                />
              );
            })}
          </View>
          {custom ? (
            <>
              <Field
                label="Every"
                value={String(cycle.every || '')}
                onChangeText={(t) => setCycle({ ...cycle, every: Number(t.replace(/\D/g, '')) || 0 })}
                keyboardType="number-pad"
                error={errors.cycle}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, paddingBottom: 4 }}>
                {UNITS.map((u) => (
                  <Chip key={u} label={`${u}s`} selected={cycle.unit === u} onPress={() => setCycle({ ...cycle, unit: u })} />
                ))}
              </View>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
            <Text style={{ color: p.text, fontSize: 17 }}>Next charge</Text>
            <DateTimePicker value={pickerValue} mode="date" display={Platform.OS === 'ios' ? 'compact' : 'default'} onChange={onDate} />
          </View>
          {errors.date ? <Text style={{ color: p.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{errors.date}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 0 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: p.text, fontSize: 17 }}>This is the first charge</Text>
              <Text style={{ color: p.secondaryText, fontSize: 14 }}>
                Turn on for a new subscription, so nothing earlier counts as paid this month
              </Text>
            </View>
            <Switch value={firstCharge} onValueChange={setFirstCharge} accessibilityLabel="This is the first charge" />
          </View>
          {reminders && !cancelled && cycleShorterThanLead(cycle, store.settings.leadDays) ? (
            <View
              accessibilityRole="alert"
              style={{ backgroundColor: p.warningBg, margin: 12, marginTop: 0, padding: 12, borderRadius: 10 }}
            >
              <Text style={{ color: p.warningText, fontSize: 15 }}>
                This renews more often than your reminder lead time ({store.settings.leadDays} days), so a reminder can
                arrive before the previous charge, or skip ahead a charge. Choose a shorter lead in Settings.
              </Text>
            </View>
          ) : null}
        </Card>

        <SectionHeader>Categories</SectionHeader>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, paddingBottom: 4 }}>
            {store.categories.length === 0 ? (
              <Text style={{ color: p.secondaryText, fontSize: 15, paddingBottom: 8 }}>
                No categories yet. Add them in the Categories tab.
              </Text>
            ) : (
              [...store.categories]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    selected={categoryIds.includes(c.id)}
                    onPress={() =>
                      setCategoryIds((ids) => (ids.includes(c.id) ? ids.filter((i) => i !== c.id) : [...ids, c.id]))
                    }
                  />
                ))
            )}
          </View>
        </Card>

        <SectionHeader>More</SectionHeader>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
            <Text style={{ color: p.text, fontSize: 17 }}>Renewal reminder</Text>
            <Switch value={reminders} onValueChange={setReminders} accessibilityLabel="Renewal reminder" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 0 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: p.text, fontSize: 17 }}>Cancelled</Text>
              <Text style={{ color: p.secondaryText, fontSize: 14 }}>Kept in the list, left out of totals and reminders</Text>
            </View>
            <Switch value={cancelled} onValueChange={setCancelled} accessibilityLabel="Cancelled" />
          </View>
          <Field label="Manage URL (optional)" value={manageUrl} onChangeText={setManageUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </Card>

        {existing ? (
          <>
            <SectionHeader>Manage</SectionHeader>
            <Card>
              {existing.manageUrl ? (
                <Row title="Manage Subscription" subtitle={existing.manageUrl} onPress={() => Linking.openURL(existing.manageUrl)} />
              ) : null}
              <Row
                title="App Store subscriptions"
                subtitle="Opens your Apple subscriptions page"
                onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
                last
              />
            </Card>
            <View style={{ marginTop: 24 }}>
              <Button title="Delete Subscription" kind="danger" onPress={confirmDelete} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
