import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const omittedDirectories = ['packages', 'website', 'src-tauri', 'examples', 'tools', 'bench', 'docs', 'jsdoc'];
const requiredFiles = [
  'app/package.json',
  'app/electron.vite.config.ts',
  'app/scripts/verify-native-identity.mjs',
  'app/build/icon.png',
  'app/build/icon.svg',
  'app/src/renderer/minimalOutput.mjs',
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
  'UPSTREAM-SOURCES.md',
];
const sourceFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => existsSync(join(root, file)));

const missingDirectories = omittedDirectories.filter((directory) => existsSync(join(root, directory)));
if (missingDirectories.length > 0) {
  throw new Error(`omitted upstream directories are present: ${missingDirectories.join(', ')}`);
}

const missingFiles = requiredFiles.filter((file) => !existsSync(join(root, file)));
if (missingFiles.length > 0) {
  throw new Error(`wrapper files are missing: ${missingFiles.join(', ')}`);
}

const forbiddenCoupling =
  /(?:workspace:\*|\.\.\/packages(?:\/|['"]|$)|(?:^|['"])packages\/(?:core|webaudio|desktopbridge|osc)|(?:^|['"])src-tauri\/(?:|tauri\.conf)|(?:^|['"])website\/(?:|src))/;
const scannedFiles = sourceFiles.filter(
  (file) =>
    /\.(?:cjs|js|mjs|json|ts|tsx|yaml|yml)$/.test(file) &&
    !file.startsWith('app/.external/') &&
    file !== 'scripts/fetch-upstream-artifacts.mjs',
);
const couplingFiles = scannedFiles.filter((file) => forbiddenCoupling.test(readFileSync(join(root, file), 'utf8')));
if (couplingFiles.length > 0) {
  throw new Error(`tracked wrapper files still couple to omitted upstream paths: ${couplingFiles.join(', ')}`);
}

const trackedOutsideWrapper = sourceFiles.filter(
  (file) =>
    !file.startsWith('app/') &&
    !['.github/', 'scripts/'].some((prefix) => file.startsWith(prefix)) &&
    ![
      '.gitignore',
      '.nvmrc',
      '.prettierignore',
      '.prettierrc',
      'AGENTS.md',
      'CLAUDE.md',
      'CONTRIBUTING.md',
      'LICENSE',
      'README.md',
      'THIRD-PARTY-NOTICES.md',
      'UPSTREAM-SOURCES.md',
      'eslint.config.mjs',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ].includes(file),
);
if (trackedOutsideWrapper.length > 0) {
  throw new Error(`unrelated tracked files remain: ${trackedOutsideWrapper.join(', ')}`);
}

console.log(`wrapper boundary ok: ${sourceFiles.length} tracked files; no omitted upstream tree or local coupling`);
