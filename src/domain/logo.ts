/**
 * The logo a person picked for an item, stored as a short string so it fits one column and one
 * CSV cell: `brand:<slug>`, `icon:<key>` or `icon:<key>:<colour>`. Null (blank) means Automatic:
 * match a brand by the item's name, else a coloured first letter. Pure TypeScript.
 */
import { BRANDS } from '../ui/brands/data';
import { GENERIC_ICONS, ICON_COLORS, type IconColor } from '../ui/brands/icons';

export type LogoRef = { kind: 'brand'; slug: string } | { kind: 'icon'; key: string; color: IconColor | null };

const AUTO_WORDS = ['', 'auto', 'automatic'];

/** Parses a stored or CSV logo value. Blank, "auto" or "automatic" is Automatic (null). */
export function parseLogo(raw: string | null | undefined): { ref: LogoRef | null } | { error: string } {
  const v = (raw ?? '').trim().toLowerCase();
  if (AUTO_WORDS.includes(v)) return { ref: null };
  const parts = v.split(':').map((p) => p.trim());
  if (parts[0] === 'brand' && parts.length === 2) {
    if (!BRANDS.some((b) => b.slug === parts[1])) return { error: `logo brand “${parts[1]}” isn’t one the app knows` };
    return { ref: { kind: 'brand', slug: parts[1] } };
  }
  if (parts[0] === 'icon' && (parts.length === 2 || parts.length === 3)) {
    if (!GENERIC_ICONS.some((i) => i.key === parts[1])) return { error: `logo icon “${parts[1]}” isn’t one the app knows` };
    const color = parts[2] ?? null;
    if (color !== null && !Object.prototype.hasOwnProperty.call(ICON_COLORS, color)) {
      return { error: `logo colour “${color}” must be one of ${Object.keys(ICON_COLORS).join(', ')}` };
    }
    return { ref: { kind: 'icon', key: parts[1], color: color as IconColor | null } };
  }
  return { error: 'logo must be blank (automatic), brand:<name> or icon:<name>, for example brand:netflix or icon:bolt' };
}

export function formatLogo(ref: LogoRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'brand') return `brand:${ref.slug}`;
  return ref.color ? `icon:${ref.key}:${ref.color}` : `icon:${ref.key}`;
}

/** The canonical stored form, or null (Automatic) for blank or anything unreadable. */
export function normalizeLogo(raw: string | null | undefined): string | null {
  const r = parseLogo(raw);
  return 'ref' in r && r.ref ? formatLogo(r.ref) : null;
}
