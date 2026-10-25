import { useMemo } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { describeCycle, shortDate } from '../domain/dates';
import { describeTrialLeft, isCompleted, isPlan, nextCharge, planStatus, trialDaysLeft } from '../domain/schedule';
import { formatMoney } from '../domain/money';
import { computeMonthTotals, computeTotals } from '../domain/totals';
import type { Subscription } from '../domain/types';
import { requestPermission } from '../services/notifications';
import { Button, Card, Row, SectionHeader } from './components';
import { useStore } from './store';
import { usePalette } from './theme';

export function HomeScreen({ onEdit, onAdd }: { onEdit: (s: Subscription) => void; onAdd: () => void }) {
  const p = usePalette();
  const { subscriptions, categories, settings, today, health, refresh } = useStore();
  const home = settings.homeCurrency;
  const month = useMemo(() => computeMonthTotals(subscriptions, settings, today), [subscriptions, settings, today]);
  const totals = useMemo(
    () => computeTotals(subscriptions, categories, settings, today),
    [subscriptions, categories, settings, today],
  );
  const missingRate = [...new Map([...totals.missingRate, ...month.missingRate].map((s) => [s.id, s])).values()];

  const active = useMemo(
    () =>
      subscriptions
        .filter((s) => !s.cancelled && !isCompleted(s, today))
        .map((s) => ({ s, next: nextCharge(s, today) }))
        .sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : a.s.name.localeCompare(b.s.name))),
    [subscriptions, today],
  );
  const cancelled = subscriptions.filter((s) => s.cancelled).sort((a, b) => a.name.localeCompare(b.name));
  const completed = subscriptions
    .filter((s) => !s.cancelled && isCompleted(s, today))
    .sort((a, b) => a.name.localeCompare(b.name));

  /** What a row says: trial countdown, "N of M paid", or the plain renewal line. */
  function describe(s: Subscription, next: string): { subtitle: string; badge?: { label: string; tone: 'trial' | 'neutral' } } {
    const when = next === today ? 'Today' : shortDate(next, today);
    const off = s.remindersEnabled ? '' : ' · reminder off';
    const trialLeft = trialDaysLeft(s, today);
    if (trialLeft !== null) {
      return {
        subtitle: `Trial ${describeTrialLeft(trialLeft)} · then ${formatMoney(s.amount, s.currency)} ${describeCycle(s.cycle).toLowerCase()}${off}`,
        badge: { label: 'Trial', tone: 'trial' },
      };
    }
    const plan = planStatus(s, today);
    if (plan) {
      return {
        subtitle: `${when} · ${plan.paid} of ${plan.total} paid · ${formatMoney(plan.remainingAmount, s.currency)} left${off}`,
        badge: { label: 'Plan', tone: 'neutral' },
      };
    }
    return { subtitle: `${when} · ${describeCycle(s.cycle)}${off}` };
  }
  const progress = month.thisMonth > 0 ? month.paidSoFar / month.thisMonth : 0;

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

  return (
    <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={{ paddingBottom: 32 }}>
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

      <Card style={{ marginTop: 16, padding: 16 }}>
        <Text style={{ color: p.secondaryText, fontSize: 15 }}>Still due this month</Text>
        <Text style={{ color: p.text, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {formatMoney(month.stillDue, home)}
        </Text>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Paid this month"
          accessibilityValue={{ text: `Paid ${formatMoney(month.paidSoFar, home)} of ${formatMoney(month.thisMonth, home)}` }}
          style={{ height: 8, borderRadius: 4, backgroundColor: p.chipBg, marginTop: 12, overflow: 'hidden' }}
        >
          <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: p.accent }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ color: p.secondaryText, fontSize: 15 }}>Paid {formatMoney(month.paidSoFar, home)}</Text>
          <Text style={{ color: p.secondaryText, fontSize: 15 }}>This month {formatMoney(month.thisMonth, home)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
          <Text style={{ color: p.text, fontSize: 15 }}>Average {formatMoney(totals.overall.monthly, home)}/mo</Text>
          <Text style={{ color: p.text, fontSize: 15 }}>{formatMoney(totals.overall.yearly, home)}/yr</Text>
        </View>
        {totals.planCount ? (
          <Text style={{ color: p.secondaryText, fontSize: 15, marginTop: 8 }}>
            Left on {totals.planCount} payment plan{totals.planCount === 1 ? '' : 's'}: {formatMoney(totals.plansRemaining, home)}
          </Text>
        ) : null}
        {missingRate.length ? (
          <Text style={{ color: p.danger, fontSize: 14, marginTop: 10 }}>
            Not in totals: {missingRate.map((s) => `${s.name} (${s.currency})`).join(', ')}. Add a rate in Settings.
          </Text>
        ) : null}
      </Card>

      <SectionHeader>Upcoming</SectionHeader>
      {active.length === 0 ? (
        <Card style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>No subscriptions yet</Text>
          <Text style={{ color: p.secondaryText, fontSize: 15, marginTop: 4, textAlign: 'center' }}>
            Add one, or import a CSV from Settings. Everything stays on this phone.
          </Text>
          <View style={{ marginTop: 12 }}>
            <Button title="Add Subscription" kind="filled" onPress={onAdd} />
          </View>
        </Card>
      ) : (
        <Card>
          {active.map(({ s, next }, i) => {
            const d = describe(s, next);
            const trialLeft = trialDaysLeft(s, today);
            return (
              <Row
                key={s.id}
                title={s.name}
                badge={d.badge}
                subtitle={d.subtitle}
                right={trialLeft !== null && trialLeft > 0 ? 'Free' : formatMoney(s.amount, s.currency)}
                onPress={() => onEdit(s)}
                accessibilityLabel={`${s.name}${d.badge ? `, ${d.badge.label}` : ''}, ${d.subtitle}`}
                last={i === active.length - 1}
              />
            );
          })}
        </Card>
      )}

      {completed.length ? (
        <>
          <SectionHeader>Completed plans</SectionHeader>
          <Card>
            {completed.map((s, i) => {
              const plan = planStatus(s, today)!;
              return (
                <Row
                  key={s.id}
                  title={s.name}
                  badge={{ label: 'Completed', tone: 'neutral' }}
                  subtitle={`All ${plan.total} paid · last payment ${shortDate(plan.lastPayment, today)}`}
                  right={formatMoney(plan.total * s.amount, s.currency)}
                  onPress={() => onEdit(s)}
                  last={i === completed.length - 1}
                />
              );
            })}
          </Card>
        </>
      ) : null}

      {cancelled.length ? (
        <>
          <SectionHeader>Cancelled</SectionHeader>
          <Card>
            {cancelled.map((s, i) => (
              <Row
                key={s.id}
                title={s.name}
                subtitle={isPlan(s) ? `Payment plan · ${describeCycle(s.cycle)}` : describeCycle(s.cycle)}
                right={formatMoney(s.amount, s.currency)}
                onPress={() => onEdit(s)}
                last={i === cancelled.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
