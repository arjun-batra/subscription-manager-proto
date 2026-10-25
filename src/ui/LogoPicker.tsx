import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { formatLogo, parseLogo } from '../domain/logo';
import { LogoTileView } from './BrandLogo';
import { ICON_COLORS, ICON_COLOR_NAMES, type IconColor } from './brands/icons';
import { Button, SectionHeader } from './components';
import { autoLogoTile, brandLogoTile, iconLogoTile, searchLogos, type LogoTile } from './look';
import { usePalette } from './theme';

const TILE = 48;
const CELL = 84;

/**
 * The logo sheet: a search box, then Automatic, Brands and Generic icons in a grid. Picking a
 * cell saves the choice (as a `brand:` / `icon:` string, or null for Automatic) and closes.
 * Generic icons take the colour picked in the swatch row, or their own colour.
 */
export function LogoPicker({
  visible,
  name,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  name: string;
  value: string | null;
  onPick: (logo: string | null) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const [query, setQuery] = useState('');
  const current = parseLogo(value);
  const ref = 'ref' in current ? current.ref : null;
  const [color, setColor] = useState<IconColor | null>(ref?.kind === 'icon' ? ref.color : null);
  const results = useMemo(() => searchLogos(query), [query]);

  // Closing any way (Cancel, swipe down, or a pick) clears the search for next time.
  const close = () => {
    setQuery('');
    onClose();
  };

  const pick = (logo: string | null) => {
    Haptics.selectionAsync().catch(() => {});
    onPick(logo);
    close();
  };

  const cell = (key: string, tile: LogoTile, label: string, selected: boolean, logo: string | null, hint?: string) => (
    <Pressable
      key={key}
      onPress={() => pick(logo)}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      accessibilityState={{ selected }}
      style={{ width: CELL, alignItems: 'center', paddingVertical: 8 }}
    >
      <View style={{ padding: 3, borderRadius: TILE * 0.3, borderWidth: 2, borderColor: selected ? p.accent : 'transparent' }}>
        <LogoTileView tile={tile} size={TILE} />
      </View>
      <Text numberOfLines={2} style={{ color: p.text, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
        {label}
      </Text>
    </Pressable>
  );

  const grid = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, paddingHorizontal: 8 };
  const auto = autoLogoTile(name);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: p.background }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 }}>
          <Button title="Cancel" onPress={close} />
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>
            Logo
          </Text>
          <View style={{ width: 64 }} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search brands and icons"
          placeholderTextColor={p.secondaryText}
          accessibilityLabel="Search brands and icons"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: p.chipBg, color: p.text, fontSize: 17 }}
        />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>
          {query.trim() === '' ? (
            <View style={grid}>
              {cell('auto', auto, 'Automatic (match by name)', ref === null, null, auto.kind === 'letter' ? 'shows the first letter' : `shows ${auto.label}`)}
            </View>
          ) : null}

          <SectionHeader>Brands</SectionHeader>
          {results.brands.length ? (
            <View style={grid}>
              {results.brands.map((b) =>
                cell(`b-${b.slug}`, brandLogoTile(b), b.title, ref?.kind === 'brand' && ref.slug === b.slug, formatLogo({ kind: 'brand', slug: b.slug })),
              )}
            </View>
          ) : (
            <Text style={{ color: p.secondaryText, paddingHorizontal: 16 }}>No brands match. Try a generic icon.</Text>
          )}

          <SectionHeader>Generic icons</SectionHeader>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 4 }} accessibilityRole="radiogroup">
            <Pressable
              onPress={() => setColor(null)}
              accessibilityRole="radio"
              accessibilityLabel="Icon’s own colour"
              accessibilityState={{ checked: color === null }}
              style={{ height: 32, paddingHorizontal: 10, borderRadius: 16, justifyContent: 'center', borderWidth: 2, borderColor: color === null ? p.accent : p.separator }}
            >
              <Text style={{ color: p.text, fontSize: 13 }}>Default</Text>
            </Pressable>
            {ICON_COLOR_NAMES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                accessibilityRole="radio"
                accessibilityLabel={`${c} colour`}
                accessibilityState={{ checked: color === c }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: ICON_COLORS[c], borderWidth: 3, borderColor: color === c ? p.accent : 'transparent' }}
              />
            ))}
          </View>
          {results.icons.length ? (
            <View style={grid}>
              {results.icons.map((i) =>
                cell(
                  `i-${i.key}`,
                  iconLogoTile(i, color),
                  i.title,
                  ref?.kind === 'icon' && ref.key === i.key && (ref.color ?? null) === color,
                  formatLogo({ kind: 'icon', key: i.key, color }),
                  'icon',
                ),
              )}
            </View>
          ) : (
            <Text style={{ color: p.secondaryText, paddingHorizontal: 16 }}>No icons match.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
