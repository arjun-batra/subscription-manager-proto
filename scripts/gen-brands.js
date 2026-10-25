#!/usr/bin/env node
// Regenerates src/ui/brands/data.ts. Not part of the app or CI; run by hand:
//   npm pack simple-icons@16.36.0 && tar xzf simple-icons-16.36.0.tgz
//   node scripts/gen-brands.js ./package
// Marks come only from the Simple Icons package (CC0). A brand Simple Icons doesn't have is a
// monogram: initials on the brand's colour, drawn by the app. No logo artwork is copied from
// brand websites.
const fs = require('fs');
const path = require('path');

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: node scripts/gen-brands.js <path to the unpacked simple-icons package>');
const d = require(path.resolve(pkg, 'data/simple-icons.json'));
const icons = Array.isArray(d) ? d : d.icons;
const version = require(path.resolve(pkg, 'package.json')).version;

// [simple-icons slug, aliases, optional title override]
const marks = [
  ['netflix', ['netflix']],
  ['spotify', ['spotify']],
  ['youtube', ['youtube', 'youtube premium', 'youtube music', 'youtube tv']],
  ['applemusic', ['apple music']],
  ['icloud', ['icloud', 'icloud+']],
  ['appletv', ['apple tv', 'apple tv+']],
  ['applearcade', ['apple arcade']],
  ['max', ['max', 'hbo max', 'hbo']],
  ['paramountplus', ['paramount+', 'paramount plus', 'paramount']],
  ['crunchyroll', ['crunchyroll']],
  ['twitch', ['twitch']],
  ['discord', ['discord', 'discord nitro', 'nitro']],
  ['dropbox', ['dropbox']],
  ['googledrive', ['google drive', 'google one', 'google storage']],
  ['notion', ['notion']],
  ['zoom', ['zoom']],
  ['github', ['github', 'github copilot', 'copilot']],
  ['duolingo', ['duolingo', 'duolingo super']],
  ['audible', ['audible']],
  ['playstation', ['playstation', 'playstation plus', 'ps plus', 'psn']],
  ['patreon', ['patreon']],
  ['medium', ['medium']],
  ['peloton', ['peloton']],
  ['strava', ['strava']],
  ['headspace', ['headspace']],
  ['1password', ['1password']],
  ['nordvpn', ['nordvpn', 'nord vpn']],
  ['expressvpn', ['expressvpn', 'express vpn']],
  ['protonmail', ['proton', 'proton mail', 'protonmail', 'proton vpn', 'proton unlimited']],
  ['figma', ['figma']],
  ['soundcloud', ['soundcloud']],
  ['ubereats', ['uber eats', 'uber one']],
  ['claude', ['claude', 'claude pro', 'claude max']],
  ['substack', ['substack']],
  // Added for the logo picker (batch 3).
  ['cloudflare', ['cloudflare', 'cloudflare zero trust', 'cloudflare workers']],
  ['cbc', ['cbc gem', 'cbc', 'cbc gem premium'], 'CBC Gem'],
  ['googlegemini', ['gemini', 'gemini advanced', 'google gemini', 'google ai pro', 'google ai ultra'], 'Gemini'],
  ['google', ['google', 'google workspace', 'g suite', 'gsuite'], 'Google / Google Workspace'],
  ['anthropic', ['anthropic', 'anthropic api']],
  ['apple', ['apple one', 'apple', 'applecare', 'apple care', 'applecare+'], 'Apple / Apple One'],
  ['x', ['x premium', 'x premium+', 'twitter blue', 'twitter'], 'X Premium'],
  ['perplexity', ['perplexity', 'perplexity pro']],
];

// [slug, title, brand colour (well-known, approximate), initials, aliases]
const monograms = [
  ['rogers', 'Rogers', 'DA291C', 'R', ['rogers', 'rogers wireless', 'rogers internet', 'rogers ignite', 'rogers mobile']],
  ['sonnet', 'Sonnet', '5B2C86', 'S', ['sonnet', 'sonnet insurance', 'sonnet home insurance', 'sonnet car insurance']],
  ['wonderland', "Canada's Wonderland", '0055A5', 'CW', ['canadas wonderland', 'canada s wonderland', 'wonderland', 'wonderland season pass']],
  ['bell', 'Bell', '00549A', 'B', ['bell', 'bell canada', 'bell mobility', 'bell fibe', 'fibe']],
  ['telus', 'Telus', '4B286D', 'T', ['telus', 'telus mobility', 'telus internet', 'optik']],
  ['fido', 'Fido', 'FFD200', 'F', ['fido', 'fido mobile']],
  ['koodo', 'Koodo', '6CC24A', 'K', ['koodo', 'koodo mobile']],
  ['freedommobile', 'Freedom Mobile', 'F26722', 'FM', ['freedom mobile', 'freedom']],
  ['virginplus', 'Virgin Plus', 'D0021B', 'V+', ['virgin plus', 'virgin mobile', 'virgin+']],
  ['shaw', 'Shaw', '0082C9', 'S', ['shaw', 'shaw internet', 'shaw mobile']],
  ['videotron', 'Vidéotron', 'FFD100', 'V', ['videotron', 'videotron mobile']],
  ['crave', 'Crave', '1B4DFF', 'C', ['crave', 'crave tv', 'cravetv']],
  ['hydroone', 'Hydro One', '0072CE', 'H1', ['hydro one', 'hydroone']],
  ['torontohydro', 'Toronto Hydro', '00539B', 'TH', ['toronto hydro']],
  ['enbridge', 'Enbridge', 'FDB813', 'E', ['enbridge', 'enbridge gas']],
  ['pcoptimum', "PC Optimum / PC Express", 'D52B1E', 'PC', ['pc optimum', 'pc express', 'pc express pass', 'pc insiders', 'presidents choice', 'president s choice']],
  ['canadiantire', 'Canadian Tire Triangle', 'D7282F', 'CT', ['canadian tire', 'triangle rewards', 'canadian tire triangle']],
  ['airmiles', 'Air Miles', '0083CA', 'AM', ['air miles', 'airmiles']],
  ['goodlife', 'GoodLife Fitness', '6D2077', 'GL', ['goodlife', 'goodlife fitness', 'good life fitness']],
  ['globeandmail', 'The Globe and Mail', '1F1F1F', 'G&M', ['the globe and mail', 'globe and mail', 'globe & mail']],
  ['torontostar', 'Toronto Star', '0F4C81', 'TS', ['toronto star', 'thestar']],
  ['prestocard', 'Presto', '5C9E31', 'P', ['presto', 'presto card']],
  ['ttc', 'TTC', 'DA251D', 'TTC', ['ttc', 'ttc pass', 'ttc monthly pass']],
  ['amazon', 'Amazon', 'FF9900', 'a', ['amazon', 'amazon prime', 'prime', 'prime membership', 'amazon music', 'kindle unlimited', 'kindle']],
  ['primevideo', 'Prime Video', '00A8E1', 'PV', ['prime video', 'amazon prime video', 'amazon video']],
  ['microsoft365', 'Microsoft 365', 'D83B01', 'M', ['microsoft 365', 'office 365', 'microsoft', 'm365', 'o365', 'onedrive', 'microsoft copilot', 'copilot pro']],
  ['xbox', 'Xbox', '107C10', 'X', ['xbox', 'xbox game pass', 'game pass', 'xbox live']],
  ['costco', 'Costco', 'E31837', 'C', ['costco', 'costco membership', 'costco executive']],
  ['grok', 'Grok / xAI', '000000', 'G', ['grok', 'supergrok', 'super grok', 'xai', 'x ai', 'grok premium']],
  ['chatgpt', 'ChatGPT / OpenAI', '10A37F', 'AI', ['chatgpt', 'chatgpt plus', 'chatgpt pro', 'chat gpt', 'openai', 'open ai', 'openai api']],
  ['disneyplus', 'Disney+', '113CCF', 'D+', ['disney+', 'disney plus', 'disney']],
  ['adobe', 'Adobe', 'FA0F00', 'A', ['adobe', 'adobe creative cloud', 'creative cloud', 'photoshop', 'lightroom', 'acrobat', 'adobe acrobat']],
  ['linkedin', 'LinkedIn Premium', '0A66C2', 'in', ['linkedin', 'linkedin premium', 'linkedin learning']],
  ['canva', 'Canva', '00C4CC', 'C', ['canva', 'canva pro']],
  ['slack', 'Slack', '4A154B', 'S', ['slack', 'slack pro']],
];

// Simple Icons entries that share a name with a monogram brand but are a different organisation.
const NOT_THE_SAME = {
  prestocard: 'Simple Icons "Presto" is the Presto SQL engine (prestodb), not the Ontario transit card',
};

const out = [];
for (const [slug, aliases, title] of marks) {
  const icon = icons.find((i) => (i.slug || '') === slug);
  if (!icon) throw new Error(`missing in simple-icons ${version}: ${slug}`);
  const svg = fs.readFileSync(path.resolve(pkg, `icons/${slug}.svg`), 'utf8');
  const m = /<path d="([^"]+)"/.exec(svg);
  if (!m || (svg.match(/<path/g) || []).length !== 1) throw new Error(`path ${slug}`);
  if (!/viewBox="0 0 24 24"/.test(svg)) throw new Error(`viewBox ${slug}`);
  out.push({ slug, title: title ?? icon.title, hex: icon.hex, aliases, path: m[1] });
}
for (const [slug, title, hex, monogram, aliases] of monograms) {
  // A Simple Icons entry with the same slug or title must be used instead, unless it's a
  // different organisation with the same name.
  const same = icons.find((i) => (i.slug || '') === slug || i.title.toLowerCase() === title.toLowerCase());
  if (same && !NOT_THE_SAME[slug]) throw new Error(`${slug} is in simple-icons (${same.title}); use its mark`);
  out.push({ slug, title, hex, aliases, monogram });
}
const slugs = new Set();
for (const b of out) {
  if (slugs.has(b.slug)) throw new Error(`duplicate ${b.slug}`);
  slugs.add(b.slug);
}

let ts = `/**
 * Brand marks for common subscriptions, bundled in the app (no network). Generated by
 * scripts/gen-brands.js. Entries with \`path\` use SVG path data and colours from Simple Icons
 * ${version}, CC0 1.0. Entries with \`monogram\` are brands Simple Icons doesn't carry: the app draws
 * the initials on the brand's colour, and no logo artwork is copied. See NOTICE.md in this folder.
 * Brand names and logos are trademarks of their owners; they are shown only to identify the
 * service the user typed or picked.
 */
export interface Brand {
  slug: string;
  title: string;
  /** Brand colour, RRGGBB, no #. */
  hex: string;
  /** Lower-case names that mean this brand (matched as whole leading words). */
  aliases: string[];
  /** Simple Icons SVG path data in a 24 x 24 viewBox. */
  path?: string;
  /** Initials drawn on the brand colour when there is no Simple Icons mark. */
  monogram?: string;
}

export const BRANDS: Brand[] = [
`;
for (const b of out) {
  ts += `  {\n    slug: ${JSON.stringify(b.slug)},\n    title: ${JSON.stringify(b.title)},\n    hex: ${JSON.stringify(b.hex)},\n    aliases: ${JSON.stringify(b.aliases).replace(/","/g, '", "')},\n`;
  ts += b.path ? `    path: ${JSON.stringify(b.path)},\n` : `    monogram: ${JSON.stringify(b.monogram)},\n`;
  ts += '  },\n';
}
ts += '];\n';
fs.writeFileSync(path.join(__dirname, '..', 'src/ui/brands/data.ts'), ts);
console.log(`${out.filter((b) => b.path).length} marks, ${out.filter((b) => b.monogram).length} monograms`);
