import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

const nativeCatalog = (): ProviderModelsDefinition => ({
  DEFAULT: 'native-model',
  OPTIONS: [{ value: 'native-model', label: 'Native model', effort: {
    default: 'high', values: [{ value: 'low' }, { value: 'high' }, { value: 'future-level', description: 'Future' }],
  } }],
});

test('discovery caches model and effort metadata together, expires, and supports forced refresh', async () => {
  let calls = 0;
  let now = 1_000;
  const adapter = new CodexProviderModels({
    discover: async () => { calls++; return nativeCatalog(); }, environmentKey: async () => 'one', now: () => now,
  });
  const first = await adapter.getSupportedModels();
  assert.equal(first.DEFAULT, 'native-model');
  assert.equal(first.OPTIONS[0].effort?.default, 'high');
  assert.equal(first.SYNC?.source, 'native');
  first.OPTIONS.length = 0;
  assert.equal((await adapter.getSupportedModels()).OPTIONS.length, 1, 'callers cannot mutate the cache');
  assert.equal(calls, 1);
  await adapter.getSupportedModels({ forceRefresh: true });
  assert.equal(calls, 2);
  now += 300_001;
  await adapter.getSupportedModels();
  assert.equal(calls, 3);
});

test('concurrent refreshes share one discovery', async () => {
  let calls = 0;
  let finish!: (value: ProviderModelsDefinition) => void;
  const adapter = new CodexProviderModels({ environmentKey: async () => 'one', discover: () => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const pending = [adapter.getSupportedModels(), adapter.getSupportedModels({ forceRefresh: true })];
  await Promise.resolve();
  finish(nativeCatalog());
  const results = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
});

test('failure retains last successful metadata only for the same identity and uses retry backoff', async () => {
  let key = 'account-one';
  let fail = false;
  let calls = 0;
  const adapter = new CodexProviderModels({ environmentKey: async () => key, discover: async () => {
    calls++;
    if (fail) throw new Error('private upstream failure');
    return nativeCatalog();
  } });
  const first = await adapter.getSupportedModels();
  fail = true;
  const stale = await adapter.getSupportedModels({ forceRefresh: true });
  assert.deepEqual(stale.OPTIONS, first.OPTIONS);
  assert.deepEqual(stale.SYNC, { ...first.SYNC, source: 'cache', stale: true });
  await adapter.getSupportedModels();
  assert.equal(calls, 2);
  key = 'account-two';
  const changed = await adapter.getSupportedModels();
  assert.equal(changed.SYNC?.source, 'fallback');
  assert.equal(changed.SYNC?.updatedAt, null);
  assert.equal(changed.OPTIONS.some((model) => model.value === 'native-model'), false);
  assert.equal(JSON.stringify(changed).includes('private upstream failure'), false);
});
