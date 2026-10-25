import { SymbolView } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import type { SFSymbol } from './look';

/** An SF Symbol (iOS); nothing on platforms without SF Symbols, since the label carries the meaning. */
export function CategoryIcon({ symbol, color, size = 16 }: { symbol: SFSymbol; color: ColorValue; size?: number }) {
  return <SymbolView name={symbol} tintColor={color} size={size} type="monochrome" fallback={null} style={{ width: size, height: size }} />;
}
