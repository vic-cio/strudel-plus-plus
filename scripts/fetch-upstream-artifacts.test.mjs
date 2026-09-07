import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { prepareArtifacts, sha256 } from './fetch-upstream-artifacts.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeOutputDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'strudel-artifacts-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function responseFor(contents, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    arrayBuffer: async () => Uint8Array.from(contents).buffer,
  };
}

test('reuses a complete checksum-valid cache without fetching', async () => {
  const outputDirectory = await makeOutputDirectory();
  const contents = Buffer.from('cached artifact');
  const artifact = {
    source: 'packages/example.mjs',
    target: 'example.mjs',
    sha256: sha256(contents),
  };
  await writeFile(join(outputDirectory, artifact.target), contents);

  let fetchCalls = 0;
  const result = await prepareArtifacts({
    outputDirectory,
    artifacts: [artifact],
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('network should not be used for a valid cache');
    },
  });

  assert.deepEqual(result, { source: 'cache', count: 1 });
  assert.equal(fetchCalls, 0);
  assert.deepEqual(await readFile(join(outputDirectory, artifact.target)), contents);
});

test('retries transient gateway failures before writing a verified artifact', async () => {
  const outputDirectory = await makeOutputDirectory();
  const contents = Buffer.from('fresh artifact');
  const artifact = {
    source: 'packages/example.mjs',
    target: 'example.mjs',
    sha256: sha256(contents),
  };
  const responses = [
    responseFor([], 504, 'Gateway Timeout'),
    responseFor([], 503, 'Service Unavailable'),
    responseFor(contents),
  ];
  const delays = [];

  const result = await prepareArtifacts({
    outputDirectory,
    artifacts: [artifact],
    fetchImpl: async () => responses.shift(),
    sleep: async (delay) => delays.push(delay),
    retryDelayMs: 25,
  });

  assert.deepEqual(result, { source: 'network', count: 1 });
  assert.deepEqual(delays, [25, 50]);
  assert.deepEqual(await readFile(join(outputDirectory, artifact.target)), contents);
});

test('does not retry permanent HTTP failures', async () => {
  const outputDirectory = await makeOutputDirectory();
  const contents = Buffer.from('never written');
  const artifact = {
    source: 'packages/example.mjs',
    target: 'example.mjs',
    sha256: sha256(contents),
  };
  let fetchCalls = 0;

  await assert.rejects(
    prepareArtifacts({
      outputDirectory,
      artifacts: [artifact],
      fetchImpl: async () => {
        fetchCalls += 1;
        return responseFor([], 404, 'Not Found');
      },
      sleep: async () => assert.fail('permanent failures must not sleep'),
    }),
    /could not fetch packages\/example\.mjs after 1 attempt/,
  );
  assert.equal(fetchCalls, 1);
});
