import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM_COMMIT = '8f81463b9cb5ddd5f117ed7baef6a1fde9445dc2';
const UPSTREAM_BASE_URL = `https://codeberg.org/uzu/strudel/raw/commit/${UPSTREAM_COMMIT}`;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, '../app/.external/strudel');

// These are the only upstream modules that are not available as published npm
// packages at the pinned Strudel release. They are fetched individually into a
// build cache, never copied into this repository or added to its Git history.
const ARTIFACTS = [
  {
    source: 'packages/edo/index.mjs',
    target: 'edo/index.mjs',
    sha256: '10c2cbbf1a61ebd902c467a39c632983d776f45db1f93459b20bfc49a1394d62',
  },
  {
    source: 'packages/edo/edo.mjs',
    target: 'edo/edo.mjs',
    sha256: '8600a9c7b72ac85be0c285f535d3b57ec8c97a1d73050f55283375a4ac810011',
  },
  {
    source: 'packages/edo/edoscale.mjs',
    target: 'edo/edoscale.mjs',
    sha256: '7c59f9f8eb7da5fcf1aa10bb5a717b119d9790ff64dc509288869cafaf03a72f',
  },
  {
    source: 'packages/edo/intervals.mjs',
    target: 'edo/intervals.mjs',
    sha256: '47b7e83ec9427ec9c118b4b3696ea939a329d6a1bf2758a16adcea375b828723',
  },
  {
    source: 'packages/edo/ratios.mjs',
    target: 'edo/ratios.mjs',
    sha256: '23ba101a9d36ee6afda727b6889decb73a0dac928eb64cd0a76c71dc3b882f48',
  },
  {
    source: 'packages/edo/pitches.mjs',
    target: 'edo/pitches.mjs',
    sha256: 'b323157ec47fcd439ccacfb34e19897507ac8b21a7a07c3757bfe82e70f58f1d',
  },
  {
    source: 'packages/dough/dough.mjs',
    target: 'dough/dough.mjs',
    sha256: '0982f0293cbe90dde566c6ba9f6345c63061a859fb791a17a33f4484ed184c0f',
  },
  {
    source: 'packages/tidal/tidal.mjs',
    target: 'tidal/tidal.mjs',
    sha256: '1174047e456b06683a4f255217ddeda7aa6ab4657d1ba3ce967589bc30f9a81d',
  },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchArtifact(artifact) {
  const response = await fetch(`${UPSTREAM_BASE_URL}/${artifact.source}`);
  if (!response.ok) {
    throw new Error(`could not fetch ${artifact.source}: ${response.status} ${response.statusText}`);
  }
  const contents = Buffer.from(await response.arrayBuffer());
  const digest = sha256(contents);
  if (digest !== artifact.sha256) {
    throw new Error(`checksum mismatch for ${artifact.source}: expected ${artifact.sha256}, got ${digest}`);
  }
  if (artifact.target === 'dough/dough.mjs') {
    const source = contents.toString('utf8');
    const adapted = source.replace(
      "import { getAudioContext, ensureMinimalOutput } from '@strudel/webaudio';",
      "import { getAudioContext } from '@strudel/webaudio';\nimport { ensureMinimalOutput } from '../../../src/renderer/minimalOutput.mjs';",
    );
    if (adapted === source) {
      throw new Error(`could not apply the published-webaudio compatibility adapter to ${artifact.source}`);
    }
    return { artifact, contents: Buffer.from(adapted) };
  }
  return { artifact, contents };
}

const fetched = await Promise.all(ARTIFACTS.map(fetchArtifact));
await rm(outputDirectory, { recursive: true, force: true });

for (const { artifact, contents } of fetched) {
  const target = join(outputDirectory, artifact.target);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

console.log(`prepared ${fetched.length} pinned upstream modules at ${outputDirectory}`);
