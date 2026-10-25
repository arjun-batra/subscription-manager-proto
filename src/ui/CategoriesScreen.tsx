import { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';

import { newId } from '../data/db';
import { formatMoney } from '../domain/money';
import { computeTotals } from '../domain/totals';
import { UNCATEGORIZED_ID, type Category } from '../domain/types';
import { Button, Card, Row, SectionHeader } from './components';
import { useStore } from './store';
import { usePalette } from './theme';

export function CategoriesScreen() {
  const p = usePalette();
  const store = useStore();
  const { subscriptions, categories, settings } = store;
  const totals = useMemo(() => computeTotals(subscriptions, categories, settings), [subscriptions, categories, settings]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function save() {
    try {
      await store.saveCategory({ id: editing?.id ?? newId(), name });
      setEditing(null);
      setName('');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function remove(c: Category) {
    const used = subscriptions.filter((s) => s.categoryIds.includes(c.id)).length;
    Alert.alert(
      `Delete “${c.name}”?`,
      `${used} subscription${used === 1 ? ' uses' : 's use'} it. Subscriptions are kept; any left with no category move to Uncategorized.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => store.deleteCategory(c.id) },
      ],
    );
  }

  return (
    <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 34, fontWeight: '700', paddingHorizontal: 20, paddingTop: 8 }}>
        Categories
      </Text>

      <SectionHeader>{editing ? `Rename “${editing.name}”` : 'New category'}</SectionHeader>
      <Card style={{ padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              setError('');
            }}
            placeholder="e.g. Streaming"
            placeholderTextColor={p.secondaryText}
            accessibilityLabel="Category name"
            onSubmitEditing={save}
            style={{ flex: 1, color: p.text, fontSize: 17, paddingVertical: 8 }}
          />
          {editing ? (
            <Button
              title="Cancel"
              onPress={() => {
                setEditing(null);
                setName('');
                setError('');
              }}
            />
          ) : null}
          <Button title={editing ? 'Save' : 'Add'} onPress={save} disabled={!name.trim()} />
        </View>
        {error ? <Text style={{ color: p.danger, fontSize: 14 }}>{error}</Text> : null}
      </Card>

      <SectionHeader>Monthly totals in {settings.homeCurrency}</SectionHeader>
      <Card>
        {totals.categories.map((c, i) => {
          const isUncat = c.id === UNCATEGORIZED_ID;
          const cat = categories.find((x) => x.id === c.id);
          return (
            <Row
              key={c.id}
              title={c.name}
              subtitle={`${c.count} subscription${c.count === 1 ? '' : 's'} · ${formatMoney(c.yearly, settings.homeCurrency)}/yr${isUncat ? '' : ' · tap to rename or delete'}`}
              right={formatMoney(c.monthly, settings.homeCurrency)}
              last={i === totals.categories.length - 1}
              onPress={
                isUncat || !cat
                  ? undefined
                  : () =>
                      Alert.alert(cat.name, undefined, [
                        {
                          text: 'Rename',
                          onPress: () => {
                            setEditing(cat);
                            setName(cat.name);
                          },
                        },
                        { text: 'Delete', style: 'destructive', onPress: () => remove(cat) },
                        { text: 'Cancel', style: 'cancel' },
                      ])
              }
            />
          );
        })}
      </Card>
      {totals.categorySumExceedsOverall ? (
        <Text style={{ color: p.secondaryText, fontSize: 14, marginHorizontal: 20, marginTop: 8 }}>
          Subscriptions in more than one category are counted in each, so category totals can add up to more than your
          overall total ({formatMoney(totals.overall.monthly, settings.homeCurrency)}/mo).
        </Text>
      ) : null}
    </ScrollView>
  );
}
