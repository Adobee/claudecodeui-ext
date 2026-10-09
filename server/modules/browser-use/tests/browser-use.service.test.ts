import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

test('browser runtime installation is anchored to the application root', {
  skip: process.platform === 'win32',
}, async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'browser-runtime-install-'));
  const npmShimPath = path.join(temporaryDirectory, 'npm');
  const invocationLogPath = path.join(temporaryDirectory, 'invocations.log');
  const originalPath = process.env.PATH;
  const originalWorkingDirectory = process.cwd();

  await writeFile(
    npmShimPath,
    `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(invocationLogPath)}, process.cwd() + '\\n');\n`,
  );
  await chmod(npmShimPath, 0o755);

  try {
    process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath || ''}`;
    process.chdir('/');

    const result = await browserUseService.installRuntime();

    assert.equal(result.success, true);
    const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
    const invocationDirectories = (await readFile(invocationLogPath, 'utf8')).trim().split('\n');
    assert.deepEqual(invocationDirectories, [applicationRoot, applicationRoot, applicationRoot]);
  } finally {
    process.chdir(originalWorkingDirectory);
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
