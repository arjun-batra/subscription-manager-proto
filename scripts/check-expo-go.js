#!/usr/bin/env node
/**
 * Keeps the committed project loadable in Expo Go from `npx expo start`.
 * `eas update` / `eas update:configure` write `runtimeVersion` + `updates.url` into app.json
 * and add expo-updates; Expo's docs say updates with a runtimeVersion can't be loaded in Expo Go
 * (https://docs.expo.dev/build/updates/#previewing-updates-in-development-builds), and
 * expo-updates would make the app check a server. Fail CI if either lands on a branch.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { expo = {} } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const problems = [];
for (const [where, cfg] of [['expo', expo], ['expo.ios', expo.ios || {}], ['expo.android', expo.android || {}]]) {
  if (cfg.runtimeVersion !== undefined) problems.push(`app.json ${where}.runtimeVersion is set`);
}
if (expo.updates && expo.updates.url) problems.push('app.json expo.updates.url is set');
for (const field of ['dependencies', 'devDependencies']) {
  if (pkg[field] && pkg[field]['expo-updates']) problems.push(`package.json ${field} has expo-updates`);
}

if (problems.length) {
  console.error('Expo Go check failed:\n  ' + problems.join('\n  '));
  console.error('Publish EAS Updates from a scratch copy and do not commit these changes (see README).');
  process.exit(1);
}
console.log('app.json has no runtimeVersion or updates.url, and expo-updates is not installed.');
