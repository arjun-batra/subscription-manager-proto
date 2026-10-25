/** The privacy guard (scripts/check-no-network.js) against scratch projects. */
// Node built-ins, typed locally to avoid adding @types/node (as in sql.test.ts).
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  mkdtempSync(prefix: string): string;
  writeFileSync(file: string, data: string): void;
  mkdirSync(dir: string, opts: { recursive: boolean }): void;
};
const os = require('os') as { tmpdir(): string };
const path = require('path') as { join(...parts: string[]): string };
const { spawnSync } = require('child_process') as {
  spawnSync(cmd: string, args: string[], opts: { cwd: string; encoding: 'utf8' }): { status: number | null; stdout: string; stderr: string };
};
declare const process: { execPath: string };
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;
const script = path.join(__dirname, '..', '..', 'scripts', 'check-no-network.js');

function run(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-network-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), source);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
  return spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
}

describe('check-no-network', () => {
  it('passes clean code', () => {
    expect(run("import { File, Paths } from 'expo-file-system';\nnew File(Paths.cache, 'a.json').write('{}');\n").status).toBe(0);
  });

  it.each([
    'await File.downloadFileAsync(url, Paths.cache);',
    'await FileSystem.downloadAsync(remote, dest);',
    'const d = FileSystem.createDownloadResumable(u, dest);',
    'await FileSystem.uploadAsync(endpoint, file.uri);',
    'FileSystem.createUploadTask(endpoint, uri);',
  ])('flags an expo-file-system transfer with a variable URL: %s', (line) => {
    const r = run(`import * as FileSystem from 'expo-file-system/legacy';\n${line}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('[expo-file-system network transfer]');
  });

  it('still flags fetch()', () => {
    expect(run('fetch(u);\n').stderr).toContain('[fetch()]');
  });
});
