#!/usr/bin/env node
/**
 * Keeps the committed project loadable in Expo Go from `npx expo start`.
 * - `eas update` / `eas update:configure` write `runtimeVersion` + `updates.url` into app.json
 *   and add expo-updates; Expo's docs say updates with a runtimeVersion can't be loaded in Expo Go
 *   (https://docs.expo.dev/build/updates/#previewing-updates-in-development-builds), and
 *   expo-updates would make the app check a server.
 * - expo-dev-client makes `expo start` target a development build instead of Expo Go (E1).
 * - app.config.js/ts/json can set any of the above in code, out of this check's sight, so the
 *   config lives in app.json only (E1).
 * - Every native module must be one Expo Go ships, at the version it ships: each dependency
 *   is either in expo/bundledNativeModules.json with the same version range `npx expo install`
 *   writes, or a JS-only package on the short list below (checked for native code).
 * Fail CI if any of these lands on a branch.
 */
const fs = require('fs');
const path = require('path');

/** Plain JavaScript packages (no ios/ or android/ code, no podspec) that Expo Go can run. */
const JS_ONLY = ['expo', 'react-native-gifted-charts'];
const BANNED = ['expo-updates', 'expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu'];

function hasNativeCode(dir) {
  if (!fs.existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      if (e.isDirectory() && (e.name === 'ios' || e.name === 'android')) return true;
      if (e.isFile() && /\.(podspec|m|mm|swift|java|kt)$/.test(e.name)) return true;
      if (e.isDirectory()) stack.push(path.join(d, e.name));
    }
  }
  return false;
}

function check(root) {
  const problems = [];
  const { expo = {} } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [where, cfg] of [['expo', expo], ['expo.ios', expo.ios || {}], ['expo.android', expo.android || {}]]) {
    if (cfg.runtimeVersion !== undefined) problems.push(`app.json ${where}.runtimeVersion is set`);
  }
  if (expo.updates && expo.updates.url) problems.push('app.json expo.updates.url is set');
  for (const f of fs.readdirSync(root)) {
    if (/^app\.config\.(js|cjs|mjs|ts|json)$/.test(f)) problems.push(`${f} exists (keep the config in app.json)`);
  }
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of BANNED) if (pkg[field] && pkg[field][name]) problems.push(`package.json ${field} has ${name}`);
  }
  const bundledPath = path.join(root, 'node_modules', 'expo', 'bundledNativeModules.json');
  if (!fs.existsSync(bundledPath)) {
    problems.push('node_modules/expo/bundledNativeModules.json is missing (run npm ci first)');
  } else {
    const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
    for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
      if (bundled[name] !== undefined) {
        if (bundled[name] !== spec) problems.push(`${name} is ${spec}, Expo Go ships ${bundled[name]} (use npx expo install)`);
      } else if (!JS_ONLY.includes(name)) {
        problems.push(`${name} isn't a module Expo Go ships (not in bundledNativeModules.json)`);
      } else if (name !== 'expo' && hasNativeCode(path.join(root, 'node_modules', name))) {
        problems.push(`${name} is on the JS-only list but contains native code`);
      }
    }
  }
  return problems;
}

module.exports = { check, JS_ONLY, BANNED };

if (require.main === module) {
  const problems = check(path.join(__dirname, '..'));
  if (problems.length) {
    console.error('Expo Go check failed:\n  ' + problems.join('\n  '));
    console.error('Publish EAS Updates from a scratch copy and do not commit these changes (see README).');
    process.exit(1);
  }
  console.log(
    'Expo Go config is clean: no runtimeVersion, updates.url, app.config.*, expo-updates or expo-dev-client; ' +
      'every native module is one Expo Go ships at its version.',
  );
}
