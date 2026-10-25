import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { newId } from '../data/db';
import {
  daysBetween,
  describeWeekdayRule,
  formatYMD,
  isValidLocalDate,
  nextWeekdayRuleDate,
  parseLocalDate,
  shortDate,
  toLocalDate,
  weekdayRulesFor,
} from '../domain/dates';
import { COMMON_CURRENCIES, formatMoney, isValidCurrency } from '../domain/money';
import {
  cycleShorterThanLead,
  describeTrialLeft,
  expectedAmount,
  isPlan,
  lastPaymentDate,
  MAX_PLAN_PAYMENTS,
  nextCharge,
  nextDue,
  pastCharges,
  planEndDate,
  planFromInputs,
  planStatus,
  trialDaysLeft,
} from '../domain/schedule';
import { trialLeadsPassed } from '../domain/reminders';
import type { Cycle, Subscription, Weekday, WeekdayRule } from '../domain/types';
import { BrandLogo } from './BrandLogo';
import { Button, Card, Chip, Field, Row, SectionHeader } from './components';
import { logoSummary } from './look';
import { LogoPicker } from './LogoPicker';
import { MenuPicker, Segmented } from './native';
import { keepPayments } from '../domain/payments';
import { mergeActuals, parseAmount } from './rows';
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

const sameRule = (a?: WeekdayRule | null, b?: WeekdayRule | null) => (a ?? null) === (b ?? null) || (!!a && !!b && a.nth === b.nth && a.day === b.day);
const sameCycle = (a: Cycle, b: Cycle) => a.unit === b.unit && a.every === b.every && sameRule(a.weekday, b.weekday);
/** The preset chips compare length only; the weekday rule is its own control. */
const sameLength = (a: Cycle, b: Cycle) => a.unit === b.unit && a.every === b.every;

const NTH_CHOICES: { value: WeekdayRule['nth']; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];
const DAY_CHOICES: { value: Weekday; label: string }[] = (
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
).map((label, i) => ({ value: i as Weekday, label }));

type Kind = 'subscription' | 'plan';

function DateRow({ label, value, onChange }: { label: string; value: string; onChange: (d: string) => void }) {
  const p = usePalette();
  const ymd = parseLocalDate(value) ?? parseLocalDate(toLocalDate(new Date()))!;
  const onDate = (_: DateTimePickerEvent, d?: Date) => {
    if (d) onChange(formatYMD({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }));
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
      <Text style={{ color: p.text, fontSize: 17 }}>{label}</Text>
      <DateTimePicker
        value={new Date(ymd.y, ymd.m - 1, ymd.d)}
        mode="date"
        display={Platform.OS === 'ios' ? 'compact' : 'default'}
        onChange={onDate}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function EditSubscription({ existing, onDone }: { existing?: Subscription; onDone: () => void }) {
  const p = usePalette();
  const store = useStore();
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [currency, setCurrency] = useState(existing?.currency ?? store.settings.homeCurrency);
  const [cycle, setCycle] = useState<Cycle>(existing?.cycle ?? { unit: 'month', every: 1 });
  const [custom, setCustom] = useState(existing ? !CYCLES.slice(0, 4).some((c) => sameLength(c.cycle, existing.cycle)) : false);
  // Show the next upcoming charge, not the stored anchor (which can be months back).
  // A charge marked paid early is skipped (the next unpaid one shows), except during a trial,
  // where this date is the trial end.
  const [initialDate] = useState(() =>
    existing
      ? trialDaysLeft(existing, store.today) === null
        ? (nextDue(existing, store.today) ?? nextCharge(existing, store.today))
        : nextCharge(existing, store.today)
      : store.today,
  );
  const [date, setDate] = useState(initialDate);
  const [firstCharge, setFirstCharge] = useState(!!existing?.startDate);
  const [categoryIds, setCategoryIds] = useState<string[]>(existing?.categoryIds ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [manageUrl, setManageUrl] = useState(existing?.manageUrl ?? '');
  const [reminders, setReminders] = useState(existing?.remindersEnabled ?? true);
  const [cancelled, setCancelled] = useState(existing?.cancelled ?? false);
  const [kind, setKind] = useState<Kind>(existing && isPlan(existing) ? 'plan' : 'subscription');
  // A trial that is over is just a paid subscription now, so the switch starts off.
  const [trial, setTrial] = useState(!!existing && trialDaysLeft(existing, store.today) !== null);
  const [initialPlan] = useState(() => (existing ? planStatus(existing, store.today) : null));
  const [paymentsMade, setPaymentsMade] = useState(initialPlan ? String(initialPlan.paid) : '0');
  const [lengthMode, setLengthMode] = useState<'count' | 'end'>('count');
  const [totalPayments, setTotalPayments] = useState(initialPlan ? String(initialPlan.total) : '');
  const [lastPayment, setLastPayment] = useState(() => (existing && isPlan(existing) ? planEndDate(existing)! : store.today));
  const [variable, setVariable] = useState(existing?.variable ?? false);
  const [logo, setLogo] = useState<string | null>(existing?.logo ?? null);
  const [pickingLogo, setPickingLogo] = useState(false);
  const [promo, setPromo] = useState(!!existing?.promoEndDate && !!existing?.regularAmount);
  const [promoEnd, setPromoEnd] = useState(existing?.promoEndDate ?? store.today);
  const [regular, setRegular] = useState(existing?.regularAmount ? String(existing.regularAmount) : '');
  const [cancelByOn, setCancelByOn] = useState(!!existing?.cancelByDate);
  const [cancelBy, setCancelBy] = useState(existing?.cancelByDate ?? initialDate);
  /** Amounts typed for past charges, by date ('' clears one). Only edited dates are here. */
  const [typedActuals, setTypedActuals] = useState<Record<string, string>>({});
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
    // A weekday rule moves the date to the next matching day ("2nd Tuesday" on or after it).
    const ruled = cycle.unit === 'month' && cycle.weekday && isValidLocalDate(date) ? nextWeekdayRuleDate(date, cycle.weekday) : date;
    const cycleToSave: Cycle = cycle.unit === 'month' && cycle.weekday ? cycle : { unit: cycle.unit, every: cycle.every };
    const isTrial = kind === 'subscription' && trial;
    if (isTrial && isValidLocalDate(date) && date < store.today) e.date = 'A trial has to end today or later.';
    if (isTrial && cycleToSave.weekday && ruled !== date) e.date = `A trial ends on the day you pick; pick a ${describeWeekdayRule(cycleToSave.weekday)}.`;
    let planFields: { anchorDate: string; startDate: string; totalPayments: number } | null = null;
    if (kind === 'plan') {
      const made = Number(paymentsMade);
      const total = Number(totalPayments);
      // Unchanged plan (including a completed one): keep what's stored, so month-end anchors survive.
      const unchanged =
        !!existing &&
        !!initialPlan &&
        date === initialDate &&
        sameCycle(cycleToSave, existing.cycle) &&
        made === initialPlan.paid &&
        lengthMode === 'count' &&
        total === initialPlan.total;
      if (unchanged) {
        planFields = { anchorDate: existing!.anchorDate, startDate: existing!.startDate ?? existing!.anchorDate, totalPayments: total };
      } else if (!/^\d+$/.test(paymentsMade.trim())) {
        e.paymentsMade = 'Enter how many payments you’ve made (0 if none).';
      } else if (lengthMode === 'count' && (!/^\d+$/.test(totalPayments.trim()) || total < 1 || total > MAX_PLAN_PAYMENTS)) {
        e.totalPayments = `Enter a whole number from 1 to ${MAX_PLAN_PAYMENTS}.`;
      } else if (isValidLocalDate(date)) {
        planFields = planFromInputs({
          nextPayment: ruled,
          cycle: cycleToSave,
          paymentsMade: made,
          ...(lengthMode === 'count' ? { totalPayments: total } : { lastPayment }),
        });
        if (!planFields) {
          e[lengthMode === 'count' ? 'totalPayments' : 'lastPayment'] =
            lengthMode === 'count'
              ? 'The total has to be more than the payments already made.'
              : 'The last payment can’t be before the next one.';
        }
      }
    }
    const isVariableBill = kind === 'subscription' && variable;
    const promoApplies = promo && kind === 'subscription' && !isVariableBill;
    const regularNum = parseAmount(regular);
    if (promoApplies) {
      if (!isValidLocalDate(promoEnd)) e.promoEnd = 'Pick the day the regular price starts.';
      if (regularNum === null) e.regular = 'Enter the regular price, more than 0.';
    }
    if (cancelByOn && !isValidLocalDate(cancelBy)) e.cancelBy = 'Pick the date to cancel by.';
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    const now = new Date().toISOString();
    // Keep the original anchor when neither the date nor the cycle changed, so month-end
    // rules still follow it (Jan 31 -> Feb 28 -> Mar 31).
    const keepAnchor = !!existing && date === initialDate && sameCycle(cycleToSave, existing.cycle);
    let anchorDate = keepAnchor ? existing!.anchorDate : ruled;
    // A trial's first charge is the trial end, so nothing before it counts as paid.
    let startDate = isTrial ? ruled : firstCharge ? (keepAnchor ? (existing!.startDate ?? ruled) : ruled) : null;
    if (planFields) {
      anchorDate = planFields.anchorDate;
      startDate = planFields.startDate;
    }
    const draft: Subscription = {
      id: existing?.id ?? newId(),
      name: name.trim(),
      amount: amountNum,
      currency: currency.trim().toUpperCase(),
      cycle: cycleToSave,
      anchorDate,
      startDate,
      trialEndDate: isTrial ? ruled : null,
      totalPayments: planFields ? planFields.totalPayments : null,
      categoryIds,
      notes: notes.trim(),
      manageUrl: manageUrl.trim(),
      remindersEnabled: reminders,
      cancelled,
      variable: isVariableBill,
      actuals: isVariableBill ? (existing?.actuals ?? []) : [],
      logo,
      payments: existing?.payments ?? [],
      promoEndDate: promoApplies ? promoEnd : null,
      regularAmount: promoApplies ? regularNum : null,
      cancelByDate: cancelByOn ? cancelBy : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (isVariableBill) {
      const merged = mergeActuals(draft, typedActuals);
      if ('error' in merged) {
        setErrors({ actuals: merged.error });
        return;
      }
      draft.actuals = merged.actuals;
    }
    // Paid marks stay only on dates that are still charge dates of the edited schedule.
    draft.payments = keepPayments(draft).payments;
    setErrors({});
    setSaving(true);
    try {
      await store.saveSubscription(draft);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          await store.deleteSubscription(existing.id);
          onDone();
        },
      },
    ]);
  }

  const isTrialForm = kind === 'subscription' && trial;
  const variableForm = kind === 'subscription' && variable;
  const ruleNote =
    cycle.unit === 'month' && cycle.weekday && isValidLocalDate(date)
      ? (() => {
          const first = nextWeekdayRuleDate(date, cycle.weekday!);
          const every = cycle.every === 1 ? 'each month' : `every ${cycle.every} months`;
          return `Charges on the ${describeWeekdayRule(cycle.weekday!)} ${every}${first !== date ? `; the next one is ${shortDate(first, store.today)}` : ''}.`;
        })()
      : '';
  // Past charges of the stored schedule (the list below edits those dates).
  const loggable = existing && variableForm ? pastCharges(existing, store.today, 6) : [];
  const estimateText = existing ? formatMoney(expectedAmount({ ...existing, amount: Number.isFinite(amountNum) && amountNum > 0 ? amountNum : existing.amount }), currency) : '';
  const trialLeft = isTrialForm && isValidLocalDate(date) && date >= store.today ? daysBetween(store.today, date) : null;
  const preview =
    kind === 'plan' && isValidLocalDate(date) && /^\d+$/.test(paymentsMade.trim())
      ? planFromInputs({
          nextPayment: date,
          cycle,
          paymentsMade: Number(paymentsMade),
          ...(lengthMode === 'count' ? { totalPayments: Number(totalPayments) } : { lastPayment }),
        })
      : null;
  const previewEnd = preview ? lastPaymentDate(preview.anchorDate, cycle, preview.startDate, preview.totalPayments) : null;
  const previewLeft = preview ? (preview.totalPayments - Number(paymentsMade)) * (Number.isFinite(amountNum) ? amountNum : 0) : 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 }}>
        <Button title="Cancel" onPress={onDone} />
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>
          {existing ? 'Edit' : kind === 'plan' ? 'New Payment Plan' : 'New Subscription'}
        </Text>
        <Button title="Save" onPress={save} disabled={saving} />
      </View>
      <LogoPicker visible={pickingLogo} name={name} value={logo} onPick={setLogo} onClose={() => setPickingLogo(false)} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>
        <Segmented<Kind>
          label="Kind"
          value={kind}
          onChange={setKind}
          choices={[
            { value: 'subscription', label: 'Subscription' },
            { value: 'plan', label: 'Payment plan' },
          ]}
        />
        <Card style={{ marginTop: 8 }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder={kind === 'plan' ? 'iPhone 17' : 'Netflix'}
            error={errors.name}
            autoFocus={!existing}
          />
          <Pressable
            onPress={() => setPickingLogo(true)}
            accessibilityRole="button"
            accessibilityLabel={`Logo, ${logoSummary(name, logo)}`}
            accessibilityHint="Opens the logo picker"
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.separator }}
          >
            <Text style={{ color: p.text, fontSize: 17, flex: 1 }}>Logo</Text>
            <Text style={{ color: p.secondaryText, fontSize: 15, marginRight: 8, flexShrink: 1 }} numberOfLines={1}>
              {logoSummary(name, logo)}
            </Text>
            <BrandLogo name={name} logo={logo} size={32} />
            <Text style={{ color: p.secondaryText, fontSize: 20, marginLeft: 8 }}>›</Text>
          </Pressable>
          <Field
            label={
              kind === 'plan'
                ? 'Amount per payment'
                : isTrialForm
                  ? variableForm
                    ? 'Estimated price after trial'
                    : 'Price after trial'
                  : variableForm
                    ? 'Estimated amount'
                    : 'Amount'
            }
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder={kind === 'plan' ? '45.00' : '16.49'}
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
          {kind === 'subscription' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 4 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: p.text, fontSize: 17 }}>Varies</Text>
                <Text style={{ color: p.secondaryText, fontSize: 14 }}>
                  For bills like hydro or phone. The amount is an estimate; log what you’re charged and future charges use
                  the average of the last 3.
                </Text>
              </View>
              <Switch value={variable} onValueChange={setVariable} accessibilityLabel="Amount varies" />
            </View>
          ) : null}
        </Card>

        <SectionHeader>Billing</SectionHeader>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, paddingBottom: 4 }}>
            {CYCLES.map((c) => {
              const selected = c.label === 'Custom' ? custom : !custom && sameLength(c.cycle, cycle);
              return (
                <Chip
                  key={c.label}
                  label={c.label}
                  selected={selected}
                  onPress={() => {
                    setCustom(c.label === 'Custom');
                    if (c.label !== 'Custom') setCycle(c.cycle.unit === 'month' ? { ...c.cycle, weekday: cycle.weekday } : c.cycle);
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
          {cycle.unit === 'month' ? (
            <>
              <Segmented<'day' | 'weekday'>
                label="Repeats on"
                value={cycle.weekday ? 'weekday' : 'day'}
                onChange={(v) =>
                  setCycle({
                    ...cycle,
                    weekday: v === 'weekday' ? (weekdayRulesFor(isValidLocalDate(date) ? date : store.today)[0] ?? { nth: -1, day: 0 }) : null,
                  })
                }
                choices={[
                  { value: 'day', label: 'Same date' },
                  { value: 'weekday', label: 'Same weekday' },
                ]}
              />
              {cycle.weekday ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <Text style={{ color: p.text, fontSize: 17 }}>On the</Text>
                    <MenuPicker<WeekdayRule['nth']>
                      label="Which week"
                      value={cycle.weekday.nth}
                      onChange={(nth) => setCycle({ ...cycle, weekday: { ...cycle.weekday!, nth } })}
                      choices={NTH_CHOICES}
                    />
                    <MenuPicker<Weekday>
                      label="Weekday"
                      value={cycle.weekday.day}
                      onChange={(day) => setCycle({ ...cycle, weekday: { ...cycle.weekday!, day } })}
                      choices={DAY_CHOICES}
                    />
                  </View>
                  <Text style={{ color: p.secondaryText, fontSize: 14, marginTop: 4 }}>
                    {ruleNote}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
          {kind === 'subscription' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 0 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: p.text, fontSize: 17 }}>Free trial</Text>
                <Text style={{ color: p.secondaryText, fontSize: 14 }}>
                  Counts as $0 until it ends. Reminders 3 days and 1 day before.
                </Text>
              </View>
              <Switch value={trial} onValueChange={setTrial} accessibilityLabel="Free trial" />
            </View>
          ) : null}
          <DateRow
            label={kind === 'plan' ? 'Next payment' : isTrialForm ? 'Trial ends' : 'Next charge'}
            value={date}
            onChange={setDate}
          />
          {errors.date ? <Text style={{ color: p.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{errors.date}</Text> : null}
          {isTrialForm && reminders && !cancelled && isValidLocalDate(date) && trialLeadsPassed(date, store.settings, new Date()) ? (
            <Text style={{ color: p.text, fontSize: 14, paddingHorizontal: 16, paddingBottom: 8 }}>
              It’s past the usual reminder time for this trial, so you’ll get one reminder about a minute after you save.
            </Text>
          ) : null}
          {isTrialForm ? (
            <Text style={{ color: p.secondaryText, fontSize: 14, paddingHorizontal: 16, paddingBottom: 12 }}>
              {trialLeft !== null
                ? `Trial ${describeTrialLeft(trialLeft)}. First charge of ${amountNum > 0 ? formatMoney(amountNum, currency) : 'the price after trial'} on ${shortDate(date, store.today)}, unless you cancel.`
                : 'Pick the day the trial ends. That’s when the first charge happens.'}
            </Text>
          ) : null}
          {kind === 'plan' ? (
            <>
              <Field
                label="Payments made so far"
                value={paymentsMade}
                onChangeText={(t) => setPaymentsMade(t.replace(/\D/g, ''))}
                keyboardType="number-pad"
                error={errors.paymentsMade}
              />
              <Segmented<'count' | 'end'>
                label="Plan length"
                value={lengthMode}
                onChange={setLengthMode}
                choices={[
                  { value: 'count', label: 'Number of payments' },
                  { value: 'end', label: 'Last payment' },
                ]}
              />
              {lengthMode === 'count' ? (
                <Field
                  label="Total number of payments"
                  value={totalPayments}
                  onChangeText={(t) => setTotalPayments(t.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  placeholder="24"
                  error={errors.totalPayments}
                />
              ) : (
                <>
                  <DateRow label="Last payment" value={lastPayment} onChange={setLastPayment} />
                  {errors.lastPayment ? (
                    <Text style={{ color: p.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{errors.lastPayment}</Text>
                  ) : null}
                </>
              )}
              <Text style={{ color: p.secondaryText, fontSize: 14, padding: 16, paddingTop: 8 }}>
                {preview && previewEnd
                  ? `Payment ${Number(paymentsMade) + 1} of ${preview.totalPayments} is next. ${formatMoney(previewLeft, currency)} left to pay, last payment ${shortDate(previewEnd, store.today)}. Stops after that.`
                  : 'Enter the payments made and how many there are in total.'}
              </Text>
            </>
          ) : null}
          {kind === 'subscription' && !trial ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 0 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: p.text, fontSize: 17 }}>This is the first charge</Text>
              <Text style={{ color: p.secondaryText, fontSize: 14 }}>
                Turn on for a new subscription, so nothing earlier counts as paid this month
              </Text>
            </View>
            <Switch value={firstCharge} onValueChange={setFirstCharge} accessibilityLabel="This is the first charge" />
          </View>
          ) : null}
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

        {variableForm ? (
          <>
            <SectionHeader>Actual amounts</SectionHeader>
            <Card>
              {loggable.length === 0 ? (
                <Text style={{ color: p.secondaryText, fontSize: 15, padding: 16 }}>
                  {existing
                    ? 'No charges yet. Once one has happened, log what you were charged here or from the list (swipe right, or touch and hold).'
                    : 'Save first. Then log what you were charged for each past charge here or from the list.'}
                </Text>
              ) : (
                loggable.map((d, i) => {
                  const stored = existing?.actuals?.find((a) => a.date === d);
                  const value = d in typedActuals ? typedActuals[d] : stored ? String(stored.amount) : '';
                  return (
                    <View
                      key={d}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderBottomWidth: i === loggable.length - 1 ? 0 : 0.5,
                        borderBottomColor: p.separator,
                      }}
                    >
                      <Text style={{ color: p.text, fontSize: 17, flex: 1 }}>{shortDate(d, store.today)}</Text>
                      <TextInput
                        value={value}
                        onChangeText={(t) => setTypedActuals((m) => ({ ...m, [d]: t }))}
                        keyboardType="decimal-pad"
                        placeholder={`est. ${estimateText}`}
                        placeholderTextColor={p.secondaryText}
                        accessibilityLabel={`Actual amount for ${shortDate(d, store.today)}`}
                        style={{ color: p.text, fontSize: 17, minWidth: 110, textAlign: 'right', fontVariant: ['tabular-nums'] }}
                      />
                    </View>
                  );
                })
              )}
              {errors.actuals ? <Text style={{ color: p.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{errors.actuals}</Text> : null}
              <Text style={{ color: p.secondaryText, fontSize: 14, padding: 16, paddingTop: 4 }}>
                Leave a charge blank to use the estimate. Paid-so-far uses what you log. Changing the date or schedule drops
                amounts logged for days that are no longer charge days.
              </Text>
            </Card>
          </>
        ) : null}

        <SectionHeader>Deals and deadlines</SectionHeader>
        <Card>
          {kind === 'subscription' && !variableForm ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: promo ? 0 : 16 }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: p.text, fontSize: 17 }}>Promo price ends</Text>
                  <Text style={{ color: p.secondaryText, fontSize: 14 }}>
                    The amount above is the promo price. Reminders a week and a day before it goes up.
                  </Text>
                </View>
                <Switch value={promo} onValueChange={setPromo} accessibilityLabel="Promo price ends" />
              </View>
              {promo ? (
                <>
                  <DateRow label="Regular price from" value={promoEnd} onChange={setPromoEnd} />
                  {errors.promoEnd ? <Text style={{ color: p.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{errors.promoEnd}</Text> : null}
                  <Field
                    label={`Regular price (${currency || 'currency'})`}
                    value={regular}
                    onChangeText={setRegular}
                    keyboardType="decimal-pad"
                    placeholder="75.00"
                    error={errors.regular}
                  />
                  <Text style={{ color: p.secondaryText, fontSize: 14, paddingHorizontal: 16, paddingBottom: 12 }}>
                    Charges on or after {isValidLocalDate(promoEnd) ? shortDate(promoEnd, store.today) : 'that day'} are counted at the
                    regular price in totals and reminders.
                  </Text>
                </>
              ) : null}
            </>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: cancelByOn ? 0 : 16 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: p.text, fontSize: 17 }}>Cancel by</Text>
              <Text style={{ color: p.secondaryText, fontSize: 14 }}>
                A deadline to cancel, like a trial’s or a contract’s notice date. Reminders 3 days and 1 day before.
              </Text>
            </View>
            <Switch value={cancelByOn} onValueChange={setCancelByOn} accessibilityLabel="Cancel by" />
          </View>
          {cancelByOn ? (
            <>
              <DateRow label="Cancel by" value={cancelBy} onChange={setCancelBy} />
              {errors.cancelBy ? <Text style={{ color: p.danger, paddingHorizontal: 16, paddingBottom: 8 }}>{errors.cancelBy}</Text> : null}
              {isTrialForm ? (
                <Text style={{ color: p.secondaryText, fontSize: 14, paddingHorizontal: 16, paddingBottom: 12 }}>
                  These reminders replace the usual trial-end ones.
                </Text>
              ) : null}
            </>
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
            <Text style={{ color: p.text, fontSize: 17 }}>{kind === 'plan' ? 'Payment reminders' : isTrialForm ? 'Trial and renewal reminders' : 'Renewal reminder'}</Text>
            <Switch value={reminders} onValueChange={setReminders} accessibilityLabel="Reminders" />
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
              <Button title={kind === 'plan' ? 'Delete Payment Plan' : 'Delete Subscription'} kind="danger" onPress={confirmDelete} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
