import { chmodSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * node-pty 1.1.0 ships its macOS spawn helper without the executable bit, so
 * every harness start dies with node-pty's "posix_spawnp failed." no matter
 * what PATH the app has (upstream fixed the tarball mode in 1.2.0 betas only).
 * Give the bit back right after install, before a build packs node_modules
 * into the app bundle; the packaged app also repairs it at launch.
 */
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function findSpawnHelpers(nodePtyRoot) {
  const helpers = [];
  const prebuilds = join(nodePtyRoot, 'prebuilds');
  let platforms = [];
  try {
    platforms = readdirSync(prebuilds);
  } catch {
    return helpers; // No prebuilds layout; nothing to repair here.
  }
  for (const platform of platforms) {
    const helper = join(prebuilds, platform, 'spawn-helper');
    try {
      if (statSync(helper).isFile()) {
        helpers.push(helper);
      }
    } catch {
      // A platform directory without the helper is fine (win32, linux).
    }
  }
  return helpers;
}

const appDirectory = resolve(scriptDirectory, '../app');
let nodePtyRoot;
try {
  nodePtyRoot = dirname(createRequire(join(appDirectory, 'package.json')).resolve('node-pty/package.json'));
} catch (error) {
  console.error(`[ensure-pty-helper] node-pty is not installed under ${appDirectory}: ${error.message}`);
  process.exit(1);
}

const helpers = findSpawnHelpers(nodePtyRoot);
if (helpers.length === 0) {
  console.error(`[ensure-pty-helper] no spawn-helper found under ${nodePtyRoot}`);
  process.exit(1);
}

let failed = false;
for (const helper of helpers) {
  try {
    if ((statSync(helper).mode & 0o100) === 0) {
      chmodSync(helper, 0o755);
      console.log(`[ensure-pty-helper] made executable: ${helper}`);
    }
  } catch (error) {
    failed = true;
    console.error(`[ensure-pty-helper] could not repair ${helper}: ${error.message}`);
  }
}
if (failed) {
  process.exit(1);
}
