import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';

import { backupFileName, backupJson, makeBackup, MAX_BACKUP_BYTES, parseBackup, type ParsedBackup } from '../domain/backup';
import { CSV_TEMPLATE, previewImport, toCsv, type PreviewRow } from '../domain/csv';
import { toLocalDate } from '../domain/dates';
import { SCHEMA_VERSION } from '../data/sql';
import { changeHomeCurrency, isValidCurrency } from '../domain/money';
import { cycleShorterThanLead } from '../domain/schedule';
import { sendTestNotification, requestPermission } from '../services/notifications';
import { Card, Chip, Field, Row, SectionHeader } from './components';
import { useStore } from './store';
import { usePalette } from './theme';

/** Deletes a file in the app's cache, ignoring errors (it may already be gone). */
function removeCached(file: File) {
  try {
    if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
  } catch {
    // nothing to clean up
  }
}

/**
 * Writes the text to a cache file, opens the share sheet, and deletes the file once the sheet is
 * closed (Files and AirDrop have their own copy by then), so no plain-text copy is left behind.
 */
async function shareText(filename: string, text: string, type: { mimeType: string; UTI: string } = { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' }) {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  try {
    await file.write(text);
    await Sharing.shareAsync(file.uri, { ...type, dialogTitle: filename });
  } finally {
    removeCached(file);
  }
}

/**
 * Reads a picked file's text, refusing anything bigger than `maxBytes` before reading it, then
 * deletes the picker's copy in the cache. Returns an error message instead of throwing.
 */
async function readPicked(asset: DocumentPicker.DocumentPickerAsset, maxBytes: number): Promise<{ text: string } | { error: string }> {
  const file = new File(asset.uri);
  try {
    const size = asset.size ?? file.size;
    if (typeof size === 'number' && size > maxBytes) {
      return { error: `This file is ${(size / 1024 / 1024).toFixed(1)} MB, too big for this app (the limit is ${Math.round(maxBytes / 1024 / 1024)} MB). Nothing was changed.` };
    }
    return { text: await file.text() };
  } catch (e) {
    return { error: `The file couldn’t be read. Nothing was changed. (${String(e).slice(0, 200)})` };
  } finally {
    removeCached(file);
  }
}

export type RestoreRequest = Extract<ParsedBackup, { ok: true }>;

export function SettingsScreen({ onPreview, onRestore }: { onPreview: (rows: PreviewRow[]) => void; onRestore: (r: RestoreRequest) => void }) {
  const p = usePalette();
  const store = useStore();
  const { settings, subscriptions, categories } = store;
  const [home, setHome] = useState(settings.homeCurrency);
  const [homeError, setHomeError] = useState('');

  const foreign = [...new Set(subscriptions.map((s) => s.currency))]
    .filter((c) => c !== settings.homeCurrency)
    .sort();

  async function saveHome() {
    const code = home.trim().toUpperCase();
    if (!isValidCurrency(code)) return setHomeError('Use a 3-letter code, like CAD.');
    setHomeError('');
    const { settings: next, cleared } = changeHomeCurrency(settings, code);
    if (next === settings) return;
    await store.saveSettings(next);
    if (cleared.length) {
      Alert.alert(
        'Exchange rates cleared',
        `Your rates were set against ${settings.homeCurrency}, so they no longer apply. Enter new rates to ${code} for ${cleared.join(', ')}. Until then, those items are left out of totals.`,
      );
    }
  }

  async function setRate(code: string, text: string) {
    const rate = Number(text.replace(',', '.'));
    const rates = { ...settings.rates };
    if (!text.trim()) delete rates[code];
    else if (Number.isFinite(rate) && rate > 0) rates[code] = rate;
    else return;
    await store.saveSettings({ ...settings, rates, ratesUpdatedAt: new Date().toISOString() });
  }

  async function pickCsv() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'public.comma-separated-values-text'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const read = await readPicked(res.assets[0], MAX_BACKUP_BYTES);
    if ('error' in read) return Alert.alert('Can’t import this file', read.error);
    const preview = previewImport(read.text, subscriptions, store.today);
    if (!preview.ok) return Alert.alert('Can’t import this file', preview.error);
    if (!preview.rows.length) return Alert.alert('Nothing to import', 'The file has a header row but no data rows.');
    onPreview(preview.rows);
  }

  /** One file with everything; the share sheet saves it to Files, AirDrops it, and so on. */
  async function backUp() {
    const file = makeBackup({ subscriptions, categories, settings }, SCHEMA_VERSION);
    await shareText(backupFileName(toLocalDate(new Date())), backupJson(file), { mimeType: 'application/json', UTI: 'public.json' });
  }

  async function pickBackup() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'public.json', 'text/plain'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const read = await readPicked(res.assets[0], MAX_BACKUP_BYTES);
    if ('error' in read) return Alert.alert('Can’t read this file', read.error);
    const parsed = parseBackup(read.text);
    if (!parsed.ok) return Alert.alert('Can’t restore this file', parsed.error);
    onRestore(parsed);
  }

  return (
    <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 34, fontWeight: '700', paddingHorizontal: 20, paddingTop: 8 }}>
        Settings
      </Text>

      <SectionHeader>Currency</SectionHeader>
      <Card>
        <Field
          label="Home currency"
          value={home}
          onChangeText={(t) => setHome(t.toUpperCase())}
          onEndEditing={saveHome}
          onSubmitEditing={saveHome}
          autoCapitalize="characters"
          maxLength={3}
          error={homeError}
        />
        {foreign.length === 0 ? (
          <Text style={{ color: p.secondaryText, fontSize: 14, padding: 16 }}>
            All subscriptions are in {settings.homeCurrency}. Rates appear here when you add another currency.
          </Text>
        ) : (
          foreign.map((code) => (
            <View key={code} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
              <Text style={{ color: p.text, fontSize: 17, flex: 1 }}>
                1 {code} = {settings.rates[code] === undefined ? '?' : ''}
              </Text>
              <TextInput
                // Uncontrolled, so the key carries everything the default depends on: a home
                // currency change (which clears rates) or a saved rate remounts the field.
                key={`${code}:${settings.homeCurrency}:${settings.rates[code] ?? ''}`}
                defaultValue={settings.rates[code] === undefined ? '' : String(settings.rates[code])}
                onEndEditing={(e) => setRate(code, e.nativeEvent.text)}
                keyboardType="decimal-pad"
                placeholder="rate needed"
                placeholderTextColor={p.secondaryText}
                accessibilityLabel={`Rate from ${code} to ${settings.homeCurrency}`}
                style={{ color: p.text, fontSize: 17, minWidth: 100, textAlign: 'right' }}
              />
              <Text style={{ color: p.text, fontSize: 17, marginLeft: 6 }}>{settings.homeCurrency}</Text>
            </View>
          ))
        )}
        {settings.ratesUpdatedAt ? (
          <Text style={{ color: p.secondaryText, fontSize: 13, paddingHorizontal: 16, paddingBottom: 12 }}>
            Rates entered by you, last updated {settings.ratesUpdatedAt.slice(0, 10)}. The app never fetches rates.
          </Text>
        ) : null}
      </Card>

      <SectionHeader>Reminders</SectionHeader>
      <Card>
        <Text style={{ color: p.text, fontSize: 17, paddingHorizontal: 16, paddingTop: 12 }}>Remind me</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, paddingBottom: 4 }}>
          {[0, 1, 2, 3, 7].map((d) => (
            <Chip
              key={d}
              label={d === 0 ? 'Same day' : `${d} day${d > 1 ? 's' : ''} before`}
              selected={settings.leadDays === d}
              onPress={() => store.saveSettings({ ...settings, leadDays: d })}
            />
          ))}
        </View>
        {(() => {
          const short = subscriptions.filter(
            (s) => !s.cancelled && s.remindersEnabled && cycleShorterThanLead(s.cycle, settings.leadDays),
          );
          return short.length ? (
            <View accessibilityRole="alert" style={{ backgroundColor: p.warningBg, marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 10 }}>
              <Text style={{ color: p.warningText, fontSize: 15 }}>
                {short.map((s) => s.name).join(', ')} renew{short.length === 1 ? 's' : ''} more often than {settings.leadDays} days,
                so {short.length === 1 ? 'its reminder' : 'their reminders'} can arrive before the previous charge.
              </Text>
            </View>
          ) : null;
        })()}
        <Text style={{ color: p.text, fontSize: 17, paddingHorizontal: 16 }}>At</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, paddingBottom: 4 }}>
          {[8, 9, 12, 18, 20].map((h) => (
            <Chip
              key={h}
              label={`${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`}
              selected={settings.reminderHour === h}
              onPress={() => store.saveSettings({ ...settings, reminderHour: h })}
            />
          ))}
        </View>
        <Row
          title="Send Test Notification"
          subtitle="Arrives in about 5 seconds. Lock your phone to see it."
          onPress={async () => {
            const perm = await requestPermission();
            if (perm === 'denied') return Alert.alert('Notifications are off', 'Turn them on in Settings first.');
            await sendTestNotification();
          }}
          last
        />
      </Card>

      <SectionHeader>Your data</SectionHeader>
      <Card>
        <Row title="Import CSV…" subtitle="Preview before anything is saved" onPress={() => pickCsv().catch((e) => Alert.alert('Import failed', String(e)))} />
        <Row title="Share CSV Template" subtitle="Fill it in on a computer, then import" onPress={() => shareText('subscriptions-template.csv', CSV_TEMPLATE)} />
        <Row
          title="Export CSV"
          subtitle={`${subscriptions.length} subscription${subscriptions.length === 1 ? '' : 's'}`}
          onPress={() => shareText('subscriptions.csv', toCsv(subscriptions, categories))}
          last
        />
      </Card>

      <SectionHeader>Backup</SectionHeader>
      <Card>
        <Row
          title="Back Up All Data"
          subtitle="One file with every item, category, logo, logged amount, paid record and setting. Save it to Files or AirDrop it."
          onPress={() => backUp().catch((e) => Alert.alert('Backup failed', String(e)))}
        />
        <Row
          title="Restore from Backup…"
          subtitle="Pick a backup file. You see what’s in it before anything is replaced."
          onPress={() => pickBackup().catch((e) => Alert.alert('Restore failed', `Nothing was changed. ${String(e)}`))}
          last
        />
      </Card>
      <Text style={{ color: p.secondaryText, fontSize: 13, marginHorizontal: 20, marginTop: 8 }}>
        Your data is stored only on this phone and in your own device backups. This app has no account, no analytics, and
        makes no network calls. Backup and CSV files you export are not encrypted: anyone with the file can read your
        items, notes and links, so keep them somewhere private. The app deletes its own temporary copy after sharing.
      </Text>
    </ScrollView>
  );
}
