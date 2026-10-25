import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { brandTile, letterTile, matchBrand } from './look';

/**
 * A rounded tile with the service's mark (bundled Simple Icons path, see brands/NOTICE.md) or,
 * for anything we have no mark for, its first letter on a colour picked from the name.
 * Decorative: the row already says the name.
 */
export function BrandLogo({ name, size = 36 }: { name: string; size?: number }) {
  const brand = matchBrand(name);
  const radius = size * 0.24;
  if (brand) {
    const t = brandTile(brand);
    const inner = size * 0.6;
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}
      >
        <Svg width={inner} height={inner} viewBox="0 0 24 24">
          <Path d={brand.path} fill={t.fg} />
        </Svg>
      </View>
    );
  }
  const t = letterTile(name);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text allowFontScaling={false} style={{ color: t.fg, fontSize: size * 0.46, fontWeight: '700' }}>
        {t.letter}
      </Text>
    </View>
  );
}
