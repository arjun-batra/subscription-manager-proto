/** The Expo Go guard (scripts/check-expo-go.js) against scratch projects (E1). */
// Node built-ins, typed locally to avoid adding @types/node (as in sql.test.ts).
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  mkdtempSync(prefix: string): string;
  writeFileSync(file: string, data: string): void;
  mkdirSync(dir: string, opts: { recursive: boolean }): void;
};
const os = require('os') as { tmpdir(): string };
const path = require('path') as { join(...parts: string[]): string };
const { check } = require('../../scripts/check-expo-go.js') as { check: (root: string) => string[] };
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;
const repo = path.join(__dirname, '..', '..');

function project(opts: { app?: object; deps?: Record<string, string>; dev?: Record<string, string>; files?: string[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-go-'));
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ expo: { name: 'x', ...(opts.app ?? {}) } }));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { 'expo-haptics': '~58.0.7', ...(opts.deps ?? {}) }, devDependencies: opts.dev ?? {} }),
  );
  fs.mkdirSync(path.join(dir, 'node_modules', 'expo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'expo', 'bundledNativeModules.json'), JSON.stringify({ 'expo-haptics': '~58.0.7' }));
  for (const f of opts.files ?? []) fs.writeFileSync(path.join(dir, f), '');
  return dir;
}

describe('check-expo-go', () => {
  it('passes on this repo', () => {
    expect(check(repo)).toEqual([]);
  });

  it('passes a clean project', () => {
    expect(check(project())).toEqual([]);
  });

  it('blocks expo-dev-client and expo-updates in either dependency list', () => {
    expect(check(project({ deps: { 'expo-dev-client': '~6.0.0' } }))).toContain('package.json dependencies has expo-dev-client');
    expect(check(project({ dev: { 'expo-updates': '~1.0.0' } }))).toContain('package.json devDependencies has expo-updates');
  });

  it.each(['app.config.js', 'app.config.ts', 'app.config.json'])('blocks %s', (f) => {
    expect(check(project({ files: [f] }))).toContain(`${f} exists (keep the config in app.json)`);
  });

  it('blocks runtimeVersion and updates.url', () => {
    const problems = check(project({ app: { runtimeVersion: '1', ios: { runtimeVersion: '1' }, updates: { url: 'u' } } }));
    expect(problems).toEqual(
      expect.arrayContaining(['app.json expo.runtimeVersion is set', 'app.json expo.ios.runtimeVersion is set', 'app.json expo.updates.url is set']),
    );
  });

  it('blocks native modules Expo Go does not ship, or at another version', () => {
    expect(check(project({ deps: { 'react-native-mmkv': '3.0.0' } }))).toEqual([
      "react-native-mmkv isn't a module Expo Go ships (not in bundledNativeModules.json)",
    ]);
    expect(check(project({ deps: { 'expo-haptics': '^58.0.0' } }))).toEqual([
      'expo-haptics is ^58.0.0, Expo Go ships ~58.0.7 (use npx expo install)',
    ]);
  });

  it('checks the JS-only list for native code', () => {
    const dir = project({ deps: { 'react-native-gifted-charts': '1.4.81' } });
    expect(check(dir)).toEqual([]);
    fs.mkdirSync(path.join(dir, 'node_modules', 'react-native-gifted-charts', 'ios'), { recursive: true });
    expect(check(dir)).toEqual(['react-native-gifted-charts is on the JS-only list but contains native code']);
  });
});
