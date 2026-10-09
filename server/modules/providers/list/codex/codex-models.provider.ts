import { createHash } from 'node:crypto';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/**
 * Emergency Codex fallback consumed by the adapter when native discovery has
 * never succeeded. SYNC explicitly labels this catalog as stale, not live.
 */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-sol',
      label: 'GPT-6 Sol',
      description: 'Workhorse model for coding and everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      description: 'Fast and affordable model for easier tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Strong model for everyday coding.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const CATALOG_TTL_MS = 5 * 60_000;
const RETRY_DELAY_MS = 30_000;

// A private digest invalidates the cache on account/config/install changes.
// Never return this digest or the auth/config contents through the API.
async function catalogEnvironmentKey(): Promise<string> {
  const hash = createHash('sha256').update(codexHome()).update(process.env.PATH || '');
  for (const name of ['auth.json', 'config.toml']) {
    try { hash.update(await readFile(path.join(codexHome(), name))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update(`${name}:missing`);
    }
  }
  for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY']) hash.update(process.env[name] || '');
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    try {
      const executable = path.join(directory, process.platform === 'win32' ? 'codex.cmd' : 'codex');
      await access(executable, constants.X_OK);
      const target = await realpath(executable);
      const info = await stat(target);
      hash.update(`${target}:${info.mtimeMs}:${info.size}:${info.ino}`);
      break;
    } catch { /* Continue PATH lookup just as the runtime does. */ }
  }
  return hash.digest('hex');
}

/** Provider registry adapter: native discovery with bounded caching and explicit fallback health. */
export class CodexProviderModels implements IProviderModels {
  private cached?: { key: string; catalog: ProviderModelsDefinition; expiresAt: number };
  private pending?: { key: string; promise: Promise<ProviderModelsDefinition> };

  constructor(private readonly dependencies: {
    discover?: () => Promise<ProviderModelsDefinition>;
    environmentKey?: () => Promise<string>;
    now?: () => number;
  } = {}) {}

  async getSupportedModels(options: { forceRefresh?: boolean } = {}): Promise<ProviderModelsDefinition> {
    const now = this.dependencies.now ?? Date.now;
    let key: string;
    try { key = await (this.dependencies.environmentKey ?? catalogEnvironmentKey)(); }
    catch {
      // Unknown identity/configuration is not safe grounds for reusing an account's cache.
      return structuredClone({ ...CODEX_PREDEFINED_MODELS, SYNC: { source: 'fallback', stale: true, updatedAt: null } });
    }
    if (this.pending?.key === key) return structuredClone(await this.pending.promise);
    if (!options.forceRefresh && this.cached?.key === key && this.cached.expiresAt > now()) {
      return structuredClone(this.cached.catalog);
    }
    const previous = this.cached?.key === key ? this.cached.catalog : undefined;
    const promise = (async () => {
      let catalog: ProviderModelsDefinition;
      let expiresAt: number;
      try {
        const discovered = await (this.dependencies.discover ?? (() => codexAppServer.listModels()))();
        catalog = { ...discovered, SYNC: { source: 'native', stale: false, updatedAt: new Date(now()).toISOString() } };
        expiresAt = now() + CATALOG_TTL_MS;
      } catch {
        const lastGood = previous?.SYNC?.updatedAt ? previous : undefined;
        catalog = {
          ...(lastGood ?? CODEX_PREDEFINED_MODELS),
          SYNC: { source: lastGood ? 'cache' : 'fallback', stale: true, updatedAt: lastGood?.SYNC?.updatedAt ?? null },
        };
        expiresAt = now() + RETRY_DELAY_MS;
      }
      // An older in-flight identity must never overwrite a newer identity's cache.
      if (this.pending?.key === key) this.cached = { key, catalog, expiresAt };
      return catalog;
    })();
    this.pending = { key, promise };
    try { return structuredClone(await promise); }
    finally { if (this.pending?.promise === promise) this.pending = undefined; }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(path.join(codexHome(), 'config.toml'), 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
}
