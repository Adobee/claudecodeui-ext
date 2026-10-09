import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useChatProviderState } from '@/modules/chat/hooks/useChatProviderState';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type { ProviderModelsDefinition } from '@/shared/types';

const state = vi.hoisted(() => ({
  catalog: null as ProviderModelsDefinition | null,
  models: vi.fn(),
}));
vi.mock('@/shared/api', () => ({ api: {
  user: { preferences: async () => ({ ok: true, json: async () => ({ success: true, preferences: {} }) }), savePreferences: async () => ({ ok: true, json: async () => ({ success: true }) }) },
  providers: {
    models: (...args: unknown[]) => state.models(...args),
    capabilities: async () => ({ ok: true, json: async () => ({ success: true, data: null }) }),
    sessionActiveModel: async () => ({ ok: true, json: async () => ({ success: true, data: null }) }),
  },
} }));

const catalog = (stale = false): ProviderModelsDefinition => ({
  DEFAULT: 'new-model', OPTIONS: [{ value: 'new-model', label: 'New model', effort: { default: 'high', values: [{ value: 'high' }, { value: 'future' }] } }],
  SYNC: { source: stale ? 'cache' : 'native', stale, updatedAt: '2026-10-08T00:00:00Z' },
});

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  writeUserPreference('selectedProvider', 'codex');
  state.catalog = catalog();
  state.models.mockReset().mockImplementation(async (provider: string) => ({
    ok: true, json: async () => ({ success: true, data: provider === 'codex' ? { models: state.catalog } : null }),
  }));
});

test('native discovery exposes new efforts without clearing a stored future level during hydration', async () => {
  localStorage.setItem('codex-model', 'new-model');
  localStorage.setItem('codex-effort', 'future');
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderEffort, 'future');
  assert.deepEqual(result.current.currentProviderEffortOptions.map((option) => option.value), ['high', 'future']);
  assert.equal(localStorage.getItem('codex-effort'), 'future');
});

test('a fresh user gets the discovered default rather than the frontend fallback', async () => {
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderModel, 'new-model');
});

test('hidden models keep effort metadata for existing selections without entering the picker', async () => {
  localStorage.setItem('codex-model', 'legacy');
  localStorage.setItem('codex-effort', 'high');
  state.catalog = { ...catalog(), HIDDEN_OPTIONS: [{ value: 'legacy', label: 'Legacy', effort: { values: [{ value: 'high' }] } }] };
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderModel, 'legacy');
  assert.equal(result.current.currentProviderEffort, 'high');
  assert.deepEqual(result.current.currentProviderEffortOptions, [{ value: 'high' }]);
  assert.equal(result.current.currentProviderModelOptions.some((model) => model.value === 'legacy'), false);
});

test('forced refresh updates catalog but preserves missing model selections and unrelated providers', async () => {
  localStorage.setItem('codex-model', 'old-model');
  localStorage.setItem('codex-effort', 'ultra');
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  const claude = result.current.providerModels.claude;
  await act(async () => { await result.current.refreshCodexModels(true); });
  assert.equal(result.current.currentProviderModel, 'old-model');
  assert.equal(result.current.currentProviderEffort, 'ultra');
  assert.equal(result.current.providerModels.claude, claude);
  assert.equal(state.models.mock.calls.some((args) => args[0] === 'codex' && args[1] === true), true);
});

test('focus refresh failure and stale catalog never erase the current choice', async () => {
  localStorage.setItem('codex-model', 'new-model');
  localStorage.setItem('codex-effort', 'ultra');
  state.catalog = catalog(true);
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));
  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  state.models.mockRejectedValue(new Error('offline'));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  assert.equal(result.current.currentProviderEffort, 'ultra');
  assert.equal(result.current.providerModelCatalog.codex?.SYNC?.stale, true);
  await act(async () => { await assert.rejects(result.current.refreshCodexModels(true), /offline/); });
});
