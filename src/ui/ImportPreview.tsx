import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';

import { describeCycle } from '../domain/dates';
import { importAllValidRows, importSelectedRows, type PreviewRow } from '../domain/csv';
import { formatMoney } from '../domain/money';
import { Button } from './components';
import { useStore } from './store';
import { usePalette } from './theme';

export function ImportPreview({ initial, onDone }: { initial: PreviewRow[]; onDone: () => void }) {
  const p = usePalette();
  const store = useStore();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const allValid = importAllValidRows(rows);
  const selected = importSelectedRows(rows);
  const invalid = rows.filter((r) => r.status === 'invalid').length;

  const setAll = (checked: boolean) => setRows((rs) => rs.map((r) => (r.status === 'invalid' ? r : { ...r, checked })));

  async function run(chosen: PreviewRow[]) {
    setBusy(true);
    try {
      const n = await store.importDrafts(chosen.map((r) => r.draft!));
      Alert.alert('Import complete', `Imported ${n}, skipped ${rows.length - n}.`);
      onDone();
    } catch (e) {
      Alert.alert('Import failed', `Nothing was saved. ${String(e)}`);
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 }}>
        <Button title="Cancel" onPress={onDone} />
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>
          Import Preview
        </Text>
        <View style={{ width: 70 }} />
      </View>
      <Text style={{ color: p.secondaryText, fontSize: 14, marginHorizontal: 16, marginBottom: 8 }}>
        {rows.length} rows · possible duplicates start unticked{invalid ? ` · ${invalid} can’t be imported` : ''}. Nothing is
        saved until you import.
      </Text>
      <View style={{ flexDirection: 'row', marginHorizontal: 8 }}>
        <Button title="Select All" onPress={() => setAll(true)} />
        <Button title="Select None" onPress={() => setAll(false)} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.line)}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item: r, index }) => {
          const disabled = r.status === 'invalid';
          return (
            <Pressable
              disabled={disabled}
              onPress={() => setRows((rs) => rs.map((x, i) => (i === index ? { ...x, checked: !x.checked } : x)))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: r.checked, disabled }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: p.surface,
                marginHorizontal: 16,
                marginTop: 6,
                borderRadius: 10,
                padding: 12,
              }}
            >
              <Text style={{ color: disabled ? p.secondaryText : p.accent, fontSize: 22, width: 32 }}>
                {disabled ? '–' : r.checked ? '☑' : '☐'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: p.text, fontSize: 17 }} numberOfLines={1}>
                  {r.draft ? r.draft.name : `Line ${r.line}`}
                </Text>
                <Text style={{ color: r.status === 'valid' ? p.secondaryText : r.status === 'invalid' ? p.danger : p.warningText, fontSize: 14 }}>
                  {r.draft ? `${formatMoney(r.draft.amount, r.draft.currency)} · ${describeCycle(r.draft.cycle)} · ${r.draft.anchorDate}` : ''}
                  {r.status !== 'valid' ? `${r.draft ? ' · ' : ''}${r.status === 'duplicate' ? 'Possible duplicate' : `Line ${r.line}: ${r.reason}`}` : ''}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
      <View style={{ padding: 16, gap: 8, borderTopWidth: 0.5, borderTopColor: p.separator }}>
        <Button title={`Import All Valid (${allValid.length})`} kind="filled" disabled={busy || !allValid.length} onPress={() => run(allValid)} />
        <Button title={`Import Selected (${selected.length})`} disabled={busy || !selected.length} onPress={() => run(selected)} />
      </View>
    </View>
  );
}
