#!/usr/bin/env node
// Privacy guard: our own code must not make network calls (no analytics, no backend).
const fs = require('fs');
const path = require('path');

const roots = ['src', 'App.tsx', 'index.ts'];
const banned = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /navigator\.sendBeacon/,
  /from ['"](axios|expo-updates|expo-insights|@sentry\/[^'"]+|firebase[^'"]*|@react-native-firebase\/[^'"]+|expo-network)['"]/,
  /getExpoPushTokenAsync|getDevicePushTokenAsync/,
];

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
  else if (/\.(ts|tsx|js|jsx)$/.test(p) && !/\.test\./.test(p)) out.push(p);
  return out;
}

const files = roots.filter((r) => fs.existsSync(r)).flatMap((r) => walk(r, []));
const hits = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const re of banned) if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
}
if (hits.length) {
  console.error('Network or telemetry usage found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`No network calls found in ${files.length} source files.`);
