import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { PreviewRow } from './src/domain/csv';
import type { Subscription } from './src/domain/types';
import { CategoriesScreen } from './src/ui/CategoriesScreen';
import { EditSubscription } from './src/ui/EditSubscription';
import { HomeScreen } from './src/ui/HomeScreen';
import { ImportPreview } from './src/ui/ImportPreview';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { StoreProvider, useStore } from './src/ui/store';
import { usePalette } from './src/ui/theme';

type Tab = 'home' | 'categories' | 'settings';
const TABS: { id: Tab; label: string; icon: string; symbol: SFSymbol }[] = [
  { id: 'home', label: 'Home', icon: '◉', symbol: 'house.fill' },
  { id: 'categories', label: 'Categories', icon: '▦', symbol: 'square.grid.2x2.fill' },
  { id: 'settings', label: 'Settings', icon: '⚙︎', symbol: 'gearshape.fill' },
];

function Shell() {
  const p = usePalette();
  const { ready, error } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.background }} edges={['top', 'left', 'right']}>
      {error ? <Text style={{ color: p.danger, padding: 16 }}>Couldn’t open the database: {error}</Text> : null}
      <View style={{ flex: 1 }}>
        {tab === 'home' ? <HomeScreen onAdd={() => setEditing('new')} onEdit={setEditing} /> : null}
        {tab === 'categories' ? <CategoriesScreen /> : null}
        {tab === 'settings' ? <SettingsScreen onPreview={setPreview} /> : null}
      </View>
      <SafeAreaView
        edges={['bottom']}
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: p.separator, backgroundColor: p.surface }}
      >
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t.label}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}
            >
              <SymbolView
                name={t.symbol}
                size={22}
                tintColor={selected ? p.accent : p.secondaryText}
                style={{ width: 24, height: 24 }}
                fallback={<Text style={{ fontSize: 20, color: selected ? p.accent : p.secondaryText }}>{t.icon}</Text>}
              />
              <Text style={{ fontSize: 11, color: selected ? p.accent : p.secondaryText, fontWeight: selected ? '600' : '400' }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </SafeAreaView>

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
        {editing !== null ? (
          <EditSubscription existing={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
      <Modal visible={preview !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPreview(null)}>
        {preview ? (
          <ImportPreview
            initial={preview}
            onDone={() => {
              setPreview(null);
              setTab('home');
            }}
          />
        ) : null}
      </Modal>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
