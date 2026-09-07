import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UPSTREAM_COMMIT = '8f81463b9cb5ddd5f117ed7baef6a1fde9445dc2';
const UPSTREAM_BASE_URL = `https://codeberg.org/uzu/strudel/raw/commit/${UPSTREAM_COMMIT}`;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, '../app/.external/strudel');
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// These are the only upstream modules that are not available as published npm
// packages at the pinned Strudel release. They are fetched individually into a
// build cache, never copied into this repository or added to its Git history.
export const ARTIFACTS = [
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
    outputSha256: '0a48bcef1f209b6e0b8dd131324a84d03ee85b13138fe78b82fe653af2404c00',
  },
  {
    source: 'packages/tidal/tidal.mjs',
    target: 'tidal/tidal.mjs',
    sha256: '1174047e456b06683a4f255217ddeda7aa6ab4657d1ba3ce967589bc30f9a81d',
  },
];

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function attemptsLabel(attempts) {
  return `${attempts} attempt${attempts === 1 ? '' : 's'}`;
}

function cacheDigest(artifact) {
  return artifact.outputSha256 ?? artifact.sha256;
}

async function hasValidCache(directory, artifacts) {
  try {
    await Promise.all(
      artifacts.map(async (artifact) => {
        const contents = await readFile(join(directory, artifact.target));
        if (sha256(contents) !== cacheDigest(artifact)) {
          throw new Error(`checksum mismatch for cached ${artifact.target}`);
        }
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function adaptArtifact(artifact, contents) {
  if (artifact.target !== 'dough/dough.mjs') return contents;

  const source = contents.toString('utf8');
  const adapted = source.replace(
    "import { getAudioContext, ensureMinimalOutput } from '@strudel/webaudio';",
    "import { getAudioContext } from '@strudel/webaudio';\nimport { ensureMinimalOutput } from '../../../src/renderer/minimalOutput.mjs';",
  );
  if (adapted === source) {
    throw new Error(`could not apply the published-webaudio compatibility adapter to ${artifact.source}`);
  }
  return Buffer.from(adapted);
}

async function fetchArtifact(
  artifact,
  {
    baseUrl = UPSTREAM_BASE_URL,
    fetchImpl = globalThis.fetch,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    sleep = (delay) => new Promise((resolveSleep) => setTimeout(resolveSleep, delay)),
  } = {},
) {
  let lastError;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/${artifact.source}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts) break;
      await sleep(retryDelayMs * 2 ** (attempt - 1));
      continue;
    }

    if (!response.ok) {
      const reason = `${response.status} ${response.statusText}`.trim();
      lastError = new Error(`could not fetch ${artifact.source}: ${reason}`);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) break;
      await sleep(retryDelayMs * 2 ** (attempt - 1));
      continue;
    }

    const contents = Buffer.from(await response.arrayBuffer());
    const digest = sha256(contents);
    if (digest !== artifact.sha256) {
      throw new Error(`checksum mismatch for ${artifact.source}: expected ${artifact.sha256}, got ${digest}`);
    }
    return { artifact, contents: adaptArtifact(artifact, contents) };
  }

  throw new Error(
    `could not fetch ${artifact.source} after ${attemptsLabel(attemptsMade)}: ${lastError?.message ?? 'unknown error'}`,
  );
}

export async function prepareArtifacts({
  outputDirectory: destination = outputDirectory,
  artifacts = ARTIFACTS,
  ...fetchOptions
} = {}) {
  if (await hasValidCache(destination, artifacts)) {
    return { source: 'cache', count: artifacts.length };
  }

  const fetched = await Promise.all(artifacts.map((artifact) => fetchArtifact(artifact, fetchOptions)));
  await rm(destination, { recursive: true, force: true });

  for (const { artifact, contents } of fetched) {
    const target = join(destination, artifact.target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

  return { source: 'network', count: fetched.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await prepareArtifacts();
  console.log(`prepared ${result.count} pinned upstream modules from ${result.source} at ${outputDirectory}`);
}
