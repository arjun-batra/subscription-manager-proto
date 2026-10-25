#!/usr/bin/env node
// Privacy guard: our own code must not make network calls (no analytics, no backend).
// It scans source for network APIs, banned modules (static import, require() and
// dynamic import()), and http(s) URL literals outside a short allowlist. It also checks
// package.json dependencies against the banned list. A grep can't prove absence, so
// this backs up review rather than replacing it.
const fs = require('fs');
const path = require('path');

const roots = ['src', 'App.tsx', 'index.ts'];

// Modules that exist to send data off the device.
const BANNED_MODULES =
  '(axios|ky|got|superagent|node-fetch|cross-fetch|isomorphic-fetch|expo-updates|expo-insights|expo-network|' +
  'expo-application-services|@sentry\\/[^\'"`]+|sentry-expo|firebase[^\'"`]*|@react-native-firebase\\/[^\'"`]+|' +
  '@segment\\/[^\'"`]+|@amplitude\\/[^\'"`]+|mixpanel[^\'"`]*|posthog[^\'"`]*|@bugsnag\\/[^\'"`]+|' +
  '@datadog\\/[^\'"`]+|@react-native-community\\/netinfo|expo-auth-session|socket\\.io-client)';
const MOD = new RegExp(`^${BANNED_MODULES}$`);

const banned = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\b(globalThis|window|global|self)\s*(\.\s*fetch\b|\[\s*['"`]fetch['"`]\s*\])/, 'aliased fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/navigator\s*\.\s*sendBeacon/, 'sendBeacon'],
  [/getExpoPushTokenAsync|getDevicePushTokenAsync|registerForPushNotifications/, 'push token'],
  [/\bloadAsync\s*\(/, 'Font/Asset loadAsync (check for remote URLs)'],
  // expo-file-system transfers, whatever the URL (a variable URL has no literal to catch).
  [
    /\b(downloadFileAsync|downloadAsync|createDownloadResumable|DownloadResumable|uploadAsync|createUploadTask)\b/,
    'expo-file-system network transfer',
  ],
  [new RegExp(`from\\s+['"\`]${BANNED_MODULES}['"\`]`), 'banned import'],
  [new RegExp(`\\brequire\\s*\\(\\s*['"\`]${BANNED_MODULES}['"\`]`), 'banned require()'],
  [new RegExp(`\\bimport\\s*\\(\\s*['"\`]${BANNED_MODULES}['"\`]`), 'banned dynamic import()'],
  [/\brequire\s*\(\s*[^'"`\s)]/, 'require() with a computed name'],
  [/\bimport\(\s*[^'"`\s)]/, 'import() with a computed name'],
];

// URL literals that are allowed: opened in the browser only when the user taps them,
// or example text. Nothing in the app requests these.
const URL_ALLOW = [
  /^https:\/\/apps\.apple\.com\/account\/subscriptions$/, // "App Store subscriptions" row
  /^https:\/\/www\.netflix\.com\/account$/, // CSV template example row
  /^https?:\/\/$/, // input placeholder
];
const URL_RE = /https?:\/\/[^\s'"`)<>,\\]*/g;

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
  else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !/\.test\./.test(p)) out.push(p);
  return out;
}

const files = roots.filter((r) => fs.existsSync(r)).flatMap((r) => walk(r, []));
const hits = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const where = `${f}:${i + 1}: ${line.trim()}`;
      for (const [re, what] of banned) if (re.test(line)) hits.push(`[${what}] ${where}`);
      for (const url of line.match(URL_RE) ?? []) {
        if (!URL_ALLOW.some((re) => re.test(url))) hits.push(`[URL literal ${url}] ${where}`);
      }
    });
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(pkg[field] ?? {})) {
    if (MOD.test(name)) hits.push(`[banned dependency] package.json ${field}: ${name}`);
  }
}

if (hits.length) {
  console.error('Network or telemetry usage found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`No network calls found in ${files.length} source files; package.json dependencies are clean.`);
