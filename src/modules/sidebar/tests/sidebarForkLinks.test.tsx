import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { test, vi } from 'vitest';

import SidebarCollapsed from '@/modules/sidebar/SidebarCollapsed';
import SidebarFooter from '@/modules/sidebar/SidebarFooter';

const t = ((key: string) => key) as TFunction;

test('expanded desktop and mobile footers omit upstream issue/community links but retain settings', () => {
  const settings = vi.fn();
  const { container } = render(<SidebarFooter updateAvailable={false} restartRequired={false}
    releaseInfo={null} latestVersion={null} currentVersion="1.37.3"
    onShowVersionModal={() => {}} onShowSettings={settings} t={t} />);
  assert.equal(container.querySelector('a[href*="discord.gg"], a[href*="/issues"]'), null);
  assert.equal(screen.queryByText('actions.reportIssue'), null);
  assert.equal(screen.queryByText('actions.joinCommunity'), null);
  const buttons = screen.getAllByRole('button', { name: 'actions.settings' });
  assert.equal(buttons.length, 2);
  for (const button of buttons) fireEvent.click(button);
  assert.equal(settings.mock.calls.length, 2);
});

test('collapsed sidebar omits issue/community icons while retaining expand, settings and updates', () => {
  const { container } = render(<SidebarCollapsed onExpand={() => {}} onShowSettings={() => {}}
    updateAvailable restartRequired onShowVersionModal={() => {}} t={t} />);
  assert.equal(container.querySelector('a'), null);
  screen.getByRole('button', { name: 'actions.settings' });
  screen.getByRole('button', { name: 'common:versionUpdate.ariaLabels.showSidebar' });
  screen.getByRole('button', { name: 'common:versionUpdate.ariaLabels.updateAvailable' });
});
