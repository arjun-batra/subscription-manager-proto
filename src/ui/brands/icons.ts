/**
 * Generic artwork for items with no brand logo: an SF Symbol on a coloured tile. Pure data, no
 * native imports. White on every colour passes 4.5:1 (look.test.ts).
 */
import type { SFSymbol } from 'expo-symbols';

export const ICON_COLORS = {
  red: '#B3261E',
  amber: '#8A4B00',
  green: '#2E7D32',
  teal: '#00695C',
  blue: '#1565C0',
  indigo: '#4527A0',
  purple: '#6A1B9A',
  pink: '#AD1457',
  graphite: '#37474F',
  brown: '#5D4037',
} as const;

export type IconColor = keyof typeof ICON_COLORS;
export const ICON_COLOR_NAMES = Object.keys(ICON_COLORS) as IconColor[];

export interface GenericIcon {
  key: string;
  title: string;
  symbol: SFSymbol;
  /** Colour used unless the person picks another. */
  color: IconColor;
  /** Extra search words. */
  keywords: string[];
}

export const GENERIC_ICONS: GenericIcon[] = [
  { key: 'bolt', title: 'Electricity', symbol: 'bolt.fill', color: 'amber', keywords: ['utilities', 'hydro', 'power', 'electric'] },
  { key: 'drop', title: 'Water', symbol: 'drop.fill', color: 'blue', keywords: ['utilities', 'water'] },
  { key: 'flame', title: 'Gas', symbol: 'flame.fill', color: 'red', keywords: ['utilities', 'heating', 'natural gas'] },
  { key: 'wifi', title: 'Internet', symbol: 'wifi', color: 'indigo', keywords: ['wifi', 'broadband', 'isp'] },
  { key: 'phone', title: 'Phone', symbol: 'phone.fill', color: 'green', keywords: ['mobile', 'cell', 'wireless'] },
  { key: 'tv', title: 'TV', symbol: 'tv.fill', color: 'graphite', keywords: ['cable', 'streaming', 'television'] },
  { key: 'film', title: 'Movies', symbol: 'film.fill', color: 'purple', keywords: ['streaming', 'cinema', 'video'] },
  { key: 'music', title: 'Music', symbol: 'music.note', color: 'pink', keywords: ['audio', 'songs', 'radio'] },
  { key: 'cloud', title: 'Cloud storage', symbol: 'cloud.fill', color: 'blue', keywords: ['storage', 'backup', 'drive'] },
  { key: 'game', title: 'Games', symbol: 'gamecontroller.fill', color: 'indigo', keywords: ['gaming', 'console'] },
  { key: 'gym', title: 'Gym', symbol: 'dumbbell.fill', color: 'red', keywords: ['fitness', 'workout', 'health club'] },
  { key: 'news', title: 'News', symbol: 'newspaper.fill', color: 'graphite', keywords: ['newspaper', 'magazine'] },
  { key: 'book', title: 'Books', symbol: 'book.fill', color: 'brown', keywords: ['reading', 'audiobooks', 'ebooks'] },
  { key: 'cart', title: 'Groceries', symbol: 'cart.fill', color: 'green', keywords: ['shopping', 'delivery', 'food'] },
  { key: 'car', title: 'Car', symbol: 'car.fill', color: 'blue', keywords: ['auto', 'lease', 'parking'] },
  { key: 'fuel', title: 'Fuel', symbol: 'fuelpump.fill', color: 'amber', keywords: ['gas station', 'petrol'] },
  { key: 'transit', title: 'Transit', symbol: 'bus.fill', color: 'teal', keywords: ['bus', 'subway', 'train', 'pass'] },
  { key: 'house', title: 'Rent / home', symbol: 'house.fill', color: 'brown', keywords: ['rent', 'mortgage', 'condo', 'property'] },
  { key: 'shield', title: 'Insurance', symbol: 'shield.fill', color: 'teal', keywords: ['insurance', 'security', 'vpn'] },
  { key: 'heart', title: 'Health', symbol: 'heart.fill', color: 'pink', keywords: ['health', 'medical', 'dental'] },
  { key: 'pill', title: 'Pharmacy', symbol: 'pills.fill', color: 'red', keywords: ['medicine', 'prescription'] },
  { key: 'school', title: 'Education', symbol: 'graduationcap.fill', color: 'indigo', keywords: ['school', 'tuition', 'course', 'learning'] },
  { key: 'ticket', title: 'Events', symbol: 'ticket.fill', color: 'purple', keywords: ['tickets', 'season pass', 'theme park'] },
  { key: 'pet', title: 'Pets', symbol: 'pawprint.fill', color: 'brown', keywords: ['dog', 'cat', 'vet'] },
  { key: 'card', title: 'Loan / card', symbol: 'creditcard.fill', color: 'graphite', keywords: ['loan', 'credit', 'finance', 'bank'] },
  { key: 'gift', title: 'Gift', symbol: 'gift.fill', color: 'pink', keywords: ['donation', 'present', 'charity'] },
  { key: 'ai', title: 'AI', symbol: 'sparkles', color: 'purple', keywords: ['assistant', 'chatbot'] },
  { key: 'coffee', title: 'Coffee', symbol: 'cup.and.saucer.fill', color: 'brown', keywords: ['cafe', 'food', 'drinks'] },
];
