import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useCodeEditorDocument } from '@/modules/code-editor/hooks/useCodeEditorDocument';
import { api } from '@/shared/api';

afterEach(() => vi.restoreAllMocks());

const file = { name: 'report.txt', path: '/workspace/reports/report.txt', projectId: 'project-1' };

it('keeps workspace read and save routing for files outside the selected project', async () => {
  const read = vi.spyOn(api, 'readWorkspaceFile').mockResolvedValue(Response.json({ content: 'report' }));
  const save = vi.spyOn(api, 'saveWorkspaceFile').mockResolvedValue(Response.json({ success: true }));
  const projectRead = vi.spyOn(api, 'readFile');
  const projectSave = vi.spyOn(api, 'saveFile');
  const { result } = renderHook(() => useCodeEditorDocument({ file, projectPath: '/workspace/project' }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.content).toBe('report');
  expect(read).toHaveBeenCalledWith(file.path);
  await act(async () => { await result.current.handleSave(); });
  expect(save).toHaveBeenCalledWith(file.path, 'report');
  expect(projectRead).not.toHaveBeenCalled();
  expect(projectSave).not.toHaveBeenCalled();
});

it('shows structured workspace API errors instead of only the HTTP status', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(api, 'readWorkspaceFile').mockResolvedValue(Response.json({
    success: false, error: { message: 'Workspace policy denied this path', code: 'INVALID_WORKSPACE_PATH' },
  }, { status: 403 }));
  const { result } = renderHook(() => useCodeEditorDocument({ file, projectPath: '/workspace/project' }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.content).toContain('Workspace policy denied this path');
});

it('keeps project file requests scoped to the project identifier', async () => {
  const projectFile = { ...file, path: '/workspace/project/report.txt' };
  const read = vi.spyOn(api, 'readFile').mockResolvedValue(Response.json({ content: 'project report' }));
  const workspaceRead = vi.spyOn(api, 'readWorkspaceFile');
  const { result } = renderHook(() => useCodeEditorDocument({ file: projectFile, projectPath: '/workspace/project' }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(read).toHaveBeenCalledWith('project-1', projectFile.path);
  expect(workspaceRead).not.toHaveBeenCalled();
});
