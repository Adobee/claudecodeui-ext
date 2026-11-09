import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type { ProviderModelsDefinition } from '@/shared/types';

/**
 * A new browser adopts the discovered catalog default. This fork preserves
 * an explicit saved model even when discovery omits it, so custom models,
 * hidden models and existing conversations do not silently switch models.
 */

const CODEX_CATALOG: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { value: 'gpt-5.5', label: 'GPT-5.5' },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

// What GET /api/providers/codex/models answers with; null keeps the catalog
// unloaded, which is the window the composer's pre-catalog fallback covers.
let codexCatalog: ProviderModelsDefinition | null = null;

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: (provider: string) => okJson({
        success: true,
        data: provider === 'codex' && codexCatalog ? { models: codexCatalog } : null,
      }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
    },
  },
}));

const renderCodexProviderState = async () => {
  // The provider follows the user through the preference store, while the
  // per-provider model is per-browser localStorage.
  writeUserPreference('selectedProvider', 'codex');
  const { useChatProviderState } = await import(
    '@/modules/chat/hooks/useChatProviderState'
  );
  return renderHook(() =>
    useChatProviderState({ selectedSession: null, selectedProject: null }),
  );
};

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  codexCatalog = null;
});

afterEach(() => {
  vi.resetModules();
});

test('a new browser starts Codex chats on the catalog default before the catalog loads', async () => {
  const { result } = await renderCodexProviderState();

  await waitFor(() => {
    assert.equal(result.current.provider, 'codex');
  });
  assert.equal(result.current.currentProviderModel, 'gpt-5.6-sol');
});

test('a browser preserves its explicitly saved model when the catalog omits it', async () => {
  localStorage.setItem('codex-model', 'gpt-5.4');
  codexCatalog = CODEX_CATALOG;

  const { result } = await renderCodexProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModelCatalog.codex?.DEFAULT, 'gpt-5.6-sol');
    assert.equal(result.current.currentProviderModel, 'gpt-5.4');
  });
  assert.equal(localStorage.getItem('codex-model'), 'gpt-5.4');
});

test('a new browser adopts the discovered default after the catalog loads', async () => {
  codexCatalog = { ...CODEX_CATALOG, DEFAULT: 'gpt-6.1-sol' };
  const { result } = await renderCodexProviderState();
  await waitFor(() => {
    assert.equal(result.current.currentProviderModel, 'gpt-6.1-sol');
  });
  assert.equal(localStorage.getItem('codex-model'), 'gpt-6.1-sol');
});
