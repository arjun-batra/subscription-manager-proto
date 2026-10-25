import { SymbolView } from 'expo-symbols';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { monogramFontSize, resolveLogo, type LogoTile } from './look';

/**
 * A rounded tile with the item's logo: its picked brand or icon, or (Automatic) a brand matched by
 * name, else its first letter. Brand marks are bundled Simple Icons paths; brands Simple Icons
 * doesn't carry are initials on the brand colour (see brands/NOTICE.md). Nothing is downloaded.
 * Decorative by default: the row already says the name.
 */
export function BrandLogo({ name, logo, size = 36 }: { name: string; logo?: string | null; size?: number }) {
  return <LogoTileView tile={resolveLogo(name, logo)} size={size} />;
}

export function LogoTileView({ tile, size = 36, decorative = true }: { tile: LogoTile; size?: number; decorative?: boolean }) {
  const radius = size * 0.24;
  const inner = size * 0.6;
  let content: React.ReactNode;
  if (tile.kind === 'mark') {
    content = (
      <Svg width={inner} height={inner} viewBox="0 0 24 24">
        <Path d={tile.path} fill={tile.fg} />
      </Svg>
    );
  } else if (tile.kind === 'icon') {
    const letter = (
      <Text allowFontScaling={false} style={{ color: tile.fg, fontSize: size * 0.46, fontWeight: '700' }}>
        {tile.icon.title.slice(0, 1)}
      </Text>
    );
    content = <SymbolView name={tile.icon.symbol} size={size * 0.56} tintColor={tile.fg} type="monochrome" fallback={letter} />;
  } else {
    content = (
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ color: tile.fg, fontSize: monogramFontSize(tile.text, size), fontWeight: '700', letterSpacing: tile.text.length > 2 ? -0.3 : 0 }}
      >
        {tile.text}
      </Text>
    );
  }
  return (
    <View
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: tile.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      {content}
    </View>
  );
}
