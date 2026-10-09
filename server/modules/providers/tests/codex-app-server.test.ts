import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';

test('model discovery paginates, filters hidden entries and preserves per-model efforts without opening a thread', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-model-list-'));
  const executable = path.join(directory, 'codex');
  const requests = path.join(directory, 'requests.jsonl');
  const originalPath = process.env.PATH;
  try {
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(requests)}, line + '\\n');
  if (!m.id) return;
  let result = {};
  if (m.method === 'model/list') result = m.params.cursor ? {
    data: [{ model: 'small', displayName: 'Small', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], nextCursor: null
  } : { data: [
    { model: 'hidden', hidden: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
    { id: 'internal-id', model: 'new-model', displayName: 'New model', isDefault: true, defaultReasoningEffort: 'future', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep' }, { reasoningEffort: 'future', description: 'New tier' }] }
  ], nextCursor: 'page-two' };
  process.stdout.write(JSON.stringify({ id: m.id, result }) + '\\n');
});
`);
    await chmod(executable, 0o755);
    process.env.PATH = directory;
    const catalog = await codexAppServer.listModels();
    assert.equal(catalog.DEFAULT, 'new-model');
    assert.deepEqual(catalog.OPTIONS.map((option) => option.value), ['new-model', 'small']);
    assert.equal(catalog.OPTIONS[0].effort?.default, 'future');
    assert.deepEqual(catalog.OPTIONS[0].effort?.values, [{ value: 'high', description: 'Deep' }, { value: 'future', description: 'New tier' }]);
    const messages = (await readFile(requests, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(messages.map((m) => m.method), ['initialize', 'initialized', 'model/list', 'model/list']);
    assert.equal(messages[2].params.includeHidden, true);
    assert.equal(catalog.HIDDEN_OPTIONS?.[0].value, 'hidden');
    assert.equal(messages[3].params.cursor, 'page-two');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Codex forks use the system PATH executable and preserve the requested anchor', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-codex-path-'));
  const executable = path.join(directory, 'codex');
  const transcript = path.join(directory, 'fork.jsonl');
  const requests = path.join(directory, 'requests.jsonl');
  const originalPath = process.env.PATH;
  try {
    await writeFile(transcript, '');
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
if (process.argv[2] !== 'app-server') process.exit(2);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(requests)}, line + '\\n');
  if (!message.id) return;
  const result = message.method === 'thread/fork'
    ? { thread: { id: 'system-fork', path: ${JSON.stringify(transcript)} } }
    : {};
  process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n');
});
`);
    await chmod(executable, 0o755);
    process.env.PATH = directory;
    const fork = await codexAppServer.forkThread({
      threadId: 'source-thread', lastTurnId: 'turn-2', cwd: directory,
    });
    assert.deepEqual(fork, { threadId: 'system-fork', path: transcript });
    const messages = (await readFile(requests, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(messages.map((message) => message.method), ['initialize', 'initialized', 'thread/fork']);
    assert.deepEqual(messages[2].params, { threadId: 'source-thread', lastTurnId: 'turn-2', cwd: directory });
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});
