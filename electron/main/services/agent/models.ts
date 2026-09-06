import { query } from '@anthropic-ai/claude-agent-sdk';
import { app } from 'electron';
import type { AgentModelsResult } from '../../../../src/shared/agent-config';
import { listCodexModels } from './codex-session';

export async function listAgentModels(provider: unknown): Promise<AgentModelsResult> {
  if (provider === 'codex') return listCodexModels();
  if (provider !== 'claude-code') return { models: [], error: '不支持的 Agent 类型' };
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const stream = query({
    prompt: (async function* () { await wait; })(),
    options: { cwd: app.getPath('home'), settingSources: ['user'], env: { ...process.env } },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const models = await Promise.race([
      stream.supportedModels(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('读取 Claude 模型列表超时')), 20_000); }),
    ]);
    return { models: models.map(model => ({ id: model.value, name: model.displayName })) };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); release(); stream.close(); }
}
