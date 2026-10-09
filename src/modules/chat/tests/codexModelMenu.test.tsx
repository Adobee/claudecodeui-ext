import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';

vi.mock('@/modules/chat/hooks/useComposerMenuAnchor', () => ({ useComposerMenuAnchor: () => ({
  triggerRef: { current: null }, menuRef: { current: null }, anchor: { top: 20, left: 20, width: 300 }, updateAnchor: () => {},
}) }));

test('model picker shows sync health, native default and a working refresh action', async () => {
  const refresh = vi.fn(async () => {});
  render(<ComposerModelMenu model="new-model" effort="default" effortOptions={[{ value: 'high', description: 'Deep thinking' }]}
    onSelectEffort={() => {}} modelOptions={[{ value: 'new-model', label: 'New model', effort: { default: 'high', values: [{ value: 'high' }] } }]}
    onSelectModel={() => {}} modelsLoading={false} onRefreshModels={refresh}
    modelSync={{ source: 'cache', stale: true, updatedAt: '2026-10-08T00:00:00Z' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select model and reasoning effort' }));
  assert.match(screen.getByRole('status').textContent || '', /cached or fallback/);
  screen.getByText('Follow Codex configuration');
  screen.getByText(/Model default: high/);
  screen.getByText('Deep thinking');
  assert.equal(refresh.mock.calls.length, 1, 'opening the picker checks the TTL');
  fireEvent.click(screen.getByRole('button', { name: 'Sync models and reasoning levels' }));
  await waitFor(() => assert.equal(refresh.mock.calls.length, 2));
  assert.deepEqual(refresh.mock.calls[1], [true]);
});
