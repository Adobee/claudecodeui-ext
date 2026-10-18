import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadOptions } from '@openai/codex-sdk';

import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/index.js';
import { createNormalizedMessage } from '@/shared/index.js';

const context: ProviderRuntimeContext = {
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => 'test-model',
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
  normalizeMessage: (raw) => {
    const event = raw as { message?: { content: string } };
    return event.message ? [createNormalizedMessage({ kind: 'text', content: event.message.content, provider: 'codex' })] : [];
  },
  isProviderInstalled: async () => true,
};

test('writer conflicts explain how to resume the same conversation without starting a replacement', async (t) => {
  t.mock.method(console, 'error', () => {});
  const thread = {
    id: 'locked-thread',
    async runStreamed() {
      return { events: (async function* () {
        yield await Promise.reject(new Error('Codex Exec exited with code 1: Reading prompt from stdin...\nthread-store conflict: thread locked-thread already has an active writer'));
      })() };
    },
  } as unknown as Thread;
  const resume = t.mock.method(Codex.prototype, 'resumeThread', () => thread);
  const start = t.mock.method(Codex.prototype, 'startThread', () => thread);
  const messages: NormalizedMessage[] = [];
  await codexRuntime.run('retry existing conversation', { sessionId: 'locked-app-session' }, {
    isWebSocketWriter: true, send: message => { messages.push(message as NormalizedMessage); },
  }, { ...context, resolveProviderSessionId: () => 'locked-thread' });
  const errors = messages.filter(message => message.kind === 'error');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].content), /Exit that terminal/);
  assert.doesNotMatch(String(errors[0].content), /Reading prompt from stdin/);
  assert.equal(messages.find(message => message.kind === 'complete')?.exitCode, 1);
  assert.equal(resume.mock.callCount(), 1);
  assert.equal(resume.mock.calls[0].arguments[0], 'locked-thread');
  assert.equal(start.mock.callCount(), 0);
});

test('runtime rejects unsupported effort rather than silently dropping the selection', async (t) => {
  t.mock.method(console, 'error', () => {});
  const messages: NormalizedMessage[] = [];
  await codexRuntime.run('must not start', { effort: 'ultra', model: 'small' }, {
    isWebSocketWriter: true, send: (message) => { messages.push(message as NormalizedMessage); },
  }, { ...context, resolveResumeModel: async () => 'small', getProviderModels: async () => ({
    DEFAULT: 'small', OPTIONS: [{ value: 'small', label: 'Small', effort: { values: [{ value: 'low' }] } }],
  }) });
  assert.match(String(messages.find((m) => m.kind === 'error')?.content), /ultra.*not available.*small/);
  assert.equal(messages.find((m) => m.kind === 'complete')?.exitCode, 1);
});

test('Codex uses the current PATH executable for each turn, including after a PATH change', {
  skip: process.platform === 'win32',
}, async (t) => {
  const previousPath = process.env.PATH;
  t.after(() => { process.env.PATH = previousPath; });

  for (const marker of ['first-install', 'second-install']) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-codex-path-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const executable = path.join(directory, 'codex');
    await writeFile(executable, `#!${process.execPath}
if (process.argv.includes('--version')) {
  console.log('codex-cli test');
} else {
  let prompt = '';
  process.stdin.on('data', chunk => { prompt += chunk; });
  process.stdin.on('end', () => {
    console.log(JSON.stringify({ type: 'thread.started', thread_id: '${marker}' }));
    console.log(JSON.stringify({ type: 'item.completed', item: {
      type: 'agent_message', text: JSON.stringify({ marker: '${marker}', args: process.argv.slice(2), prompt })
    } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}
`);
    await chmod(executable, 0o755);
    process.env.PATH = directory;
    const messages: NormalizedMessage[] = [];
    await codexRuntime.run('system CLI probe', { cwd: directory, effort: 'future-level' }, {
      isWebSocketWriter: true,
      send: (message) => { messages.push(message as NormalizedMessage); },
    }, { ...context, getProviderModels: async () => ({
      DEFAULT: 'test-model', OPTIONS: [], HIDDEN_OPTIONS: [{ value: 'test-model', label: 'Test', effort: { values: [{ value: 'future-level' }] } }],
    }) });
    const reply = messages.find((message) => message.kind === 'text');
    assert.ok(reply, JSON.stringify(messages));
    const captured = JSON.parse(String(reply.content));
    assert.equal(captured.marker, marker);
    assert.equal(captured.prompt, 'system CLI probe');
    assert.deepEqual(captured.args.slice(0, 2), ['exec', '--experimental-json']);
    assert.ok(captured.args.includes('test-model'));
    assert.ok(captured.args.includes('model_reasoning_effort="future-level"'));
    assert.ok(captured.args.includes('approval_policy="on-request"'));
    assert.equal(captured.args.includes('approval_policy="untrusted"'), false);
    assert.equal(messages.find((message) => message.kind === 'complete')?.exitCode, 0);
    assert.equal((await new CodexProviderAuth().getStatus()).installed, true);
  }
});

test('missing system Codex reports a PATH error without falling back to the SDK binary', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-codex-missing-'));
  const previousPath = process.env.PATH;
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  process.env.PATH = directory;
  t.mock.method(console, 'error', () => {});
  const messages: NormalizedMessage[] = [];
  await codexRuntime.run('must not reach bundled Codex', { cwd: directory }, {
    isWebSocketWriter: true,
    send: (message) => { messages.push(message as NormalizedMessage); },
  }, context);
  assert.match(String(messages.find((message) => message.kind === 'error')?.content), /server PATH/);
  assert.equal(messages.find((message) => message.kind === 'complete')?.exitCode, 1);
  assert.equal((await new CodexProviderAuth().getStatus()).installed, false);
});

test('a failing Codex version check does not report installed', { skip: process.platform === 'win32' }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-codex-broken-'));
  const previousPath = process.env.PATH;
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  const executable = path.join(directory, 'codex');
  await writeFile(executable, `#!${process.execPath}\nprocess.exit(1);\n`);
  await chmod(executable, 0o755);
  process.env.PATH = directory;
  assert.equal((await new CodexProviderAuth().getStatus()).installed, false);
});
for (const resumed of [false, true]) {
  for (const permissionMode of [undefined, 'default', 'unknown', 'acceptEdits', 'bypassPermissions']) {
    test(`Codex ${resumed ? 'resumes' : 'starts'} with supported permissions (${permissionMode ?? 'omitted'})`, async (t) => {
      let capturedOptions: ThreadOptions | undefined;
      let capturedPrompt: unknown;
      const messages: unknown[] = [];
      const thread = {
        id: 'native-thread',
        async runStreamed(prompt: unknown) {
          capturedPrompt = prompt;
          return { events: (async function* () {
            yield { type: 'thread.started', thread_id: 'native-thread' };
          })() };
        },
      } as unknown as Thread;

      const start = t.mock.method(Codex.prototype, 'startThread', (options?: ThreadOptions) => {
        capturedOptions = options;
        return thread;
      });
      const resume = t.mock.method(Codex.prototype, 'resumeThread', (id: string, options?: ThreadOptions) => {
        assert.equal(id, 'native-thread');
        capturedOptions = options;
        return thread;
      });
      const context: ProviderRuntimeContext = {
        resolveProviderSessionId: () => resumed ? 'native-thread' : null,
        resolveResumeModel: async () => 'test-model',
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
        normalizeMessage: () => [],
        isProviderInstalled: async () => true,
      };

      await codexRuntime.run('hey there', {
        sessionId: resumed ? 'app-session' : undefined,
        permissionMode,
        cwd: process.cwd(),
      }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, context);

      assert.equal(start.mock.callCount(), resumed ? 0 : 1);
      assert.equal(resume.mock.callCount(), resumed ? 1 : 0);
      assert.equal(capturedPrompt, 'hey there');
      assert.equal(capturedOptions?.sandboxMode, permissionMode === 'bypassPermissions' ? 'danger-full-access' : 'workspace-write');
      assert.equal(capturedOptions?.approvalPolicy, permissionMode === 'acceptEdits' || permissionMode === 'bypassPermissions' ? 'never' : 'on-request');
      assert.ok(messages.some((message: any) => message.kind === 'complete' && message.exitCode === 0));
      assert.ok(!messages.some((message: any) => message.kind === 'error'));
    });
  }
}

for (const command of ['', '  \n\t']) {
  test(`Codex supplies a prompt for an image-only turn (${JSON.stringify(command)})`, async (t) => {
    let capturedPrompt: unknown;
    const imagePath = path.join(process.cwd(), 'public', 'favicon.png');
    const thread = {
      id: 'native-thread',
      async runStreamed(prompt: unknown) {
        capturedPrompt = prompt;
        return { events: (async function* () {
          yield { type: 'thread.started', thread_id: 'native-thread' };
        })() };
      },
    } as unknown as Thread;

    t.mock.method(Codex.prototype, 'startThread', () => thread);
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => 'test-model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };

    await codexRuntime.run(command, {
      cwd: process.cwd(),
      images: [{ path: imagePath, mimeType: 'image/png' }],
    }, { isWebSocketWriter: true, send: () => {} }, context);

    assert.deepEqual(capturedPrompt, [
      { type: 'text', text: 'Please analyze the attached image(s).' },
      { type: 'local_image', path: imagePath },
    ]);
  });
}
