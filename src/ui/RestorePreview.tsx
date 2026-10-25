import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, FlatList, Text, View } from 'react-native';

import { describeBackup, type BackupFile } from '../domain/backup';
import { describeCycle } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { BrandLogo } from './BrandLogo';
import { Button } from './components';
import { useStore } from './store';
import { usePalette } from './theme';

/**
 * Restore preview: what the backup holds and what it replaces. Nothing changes until the user
 * taps Replace All and confirms; then everything is swapped in one transaction.
 */
export function RestorePreview({ backup, migratedFrom, onDone }: { backup: BackupFile; migratedFrom: number | null; onDone: (restored: boolean) => void }) {
  const p = usePalette();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const subs = [...backup.data.subscriptions].sort((a, b) => a.name.localeCompare(b.name));
  const made = backup.exportedAt.slice(0, 10);

  function confirm() {
    Alert.alert(
      'Replace all data?',
      `Your ${store.subscriptions.length} item${store.subscriptions.length === 1 ? '' : 's'}, ${store.categories.length} categor${store.categories.length === 1 ? 'y' : 'ies'} and settings on this phone are replaced by the backup (${describeBackup(backup)}). This can’t be undone, so back up first if you might want them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace All', style: 'destructive', onPress: run },
      ],
    );
  }

  async function run() {
    setBusy(true);
    try {
      const n = await store.restoreAll(backup.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Restore complete', `Restored ${n} item${n === 1 ? '' : 's'}. Reminders were rescheduled.`);
      onDone(true);
    } catch (e) {
      Alert.alert('Restore failed', `Nothing was changed. ${String(e)}`);
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 }}>
        <Button title="Cancel" onPress={() => onDone(false)} />
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>
          Restore Preview
        </Text>
        <View style={{ width: 70 }} />
      </View>
      <Text style={{ color: p.text, fontSize: 15, marginHorizontal: 16, marginBottom: 4 }}>
        Backup from {made}: {describeBackup(backup)}, home currency {backup.data.settings.homeCurrency}.
      </Text>
      <Text style={{ color: p.secondaryText, fontSize: 14, marginHorizontal: 16, marginBottom: 8 }}>
        {migratedFrom !== null ? `Made by an older version (format ${migratedFrom}); it was upgraded for this one. ` : ''}
        Restoring replaces everything on this phone: items, categories, logos, logged amounts, paid records and
        settings. Nothing changes until you confirm.
      </Text>
      <FlatList
        data={subs}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingBottom: 16 }}
        ListEmptyComponent={<Text style={{ color: p.secondaryText, padding: 16 }}>This backup has no items.</Text>}
        renderItem={({ item: s }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: p.surface,
              marginHorizontal: 16,
              marginTop: 8,
              padding: 12,
              borderRadius: 10,
              opacity: s.cancelled ? 0.6 : 1,
            }}
          >
            <BrandLogo name={s.name} logo={s.logo} size={32} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: p.text, fontSize: 17 }}>{s.name}</Text>
              <Text style={{ color: p.secondaryText, fontSize: 14 }}>
                {formatMoney(s.amount, s.currency)} · {describeCycle(s.cycle)}
                {s.cancelled ? ' · cancelled' : ''}
                {s.payments?.length ? ` · ${s.payments.length} paid` : ''}
              </Text>
            </View>
          </View>
        )}
      />
      <View style={{ padding: 16 }}>
        <Button title={busy ? 'Restoring…' : 'Replace All'} kind="danger" disabled={busy} onPress={confirm} />
      </View>
    </View>
  );
}
