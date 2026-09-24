import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexSubagentReader } from '../electron/main/services/agent/codex-subagent-reader';

const state = vi.hoisted(() => ({ request: vi.fn(), initialize: vi.fn(), close: vi.fn(), options: [] as unknown[] }));
vi.mock('../electron/main/services/agent/codex-runtime', () => ({ getNetworkCodexRuntime: async () => ({ executablePath: '/codex', env: {} }) }));
vi.mock('../electron/main/services/agent/codex-client', () => ({ CodexClient: class {
  constructor(...options: unknown[]) { state.options.push(options); }
  request = state.request; initialize = state.initialize; close = state.close;
} }));
const turn = (id: string) => ({ id, status: 'completed', items: [{ type: 'agentMessage', id: 'item-1', text: id }] });
beforeEach(() => {
  vi.clearAllMocks(); state.options = [];
  state.request.mockImplementation(async (method: string, params: { threadId: string }) => {
    if (method === 'thread/read') return { thread: { id: 'child', cwd: '/workspace', parentThreadId: null,
      source: { subAgent: { thread_spawn: { parent_thread_id: 'root' } } }, agentRole: 'explorer' } };
    return params.threadId === 'root' ? { data: [turn('inherited')], nextCursor: null }
      : { data: [turn('own-new'), turn('own-old'), turn('inherited')], nextCursor: null };
  });
});

describe('read-only Codex child history', () => {
  it('reads actual protocol shapes, removes inherited turns, and returns child output in order', async () => {
    const reader = new CodexSubagentReader('/workspace');
    const first = await reader.read('child', 'root', new Set());
    expect(first.turns.map(turn => turn.id)).toEqual(['own-old', 'own-new']);
    expect(first.role).toBe('explorer');
    await reader.read('child', 'root', new Set(['own-new']));
    expect(state.request.mock.calls.filter(([method, params]) => method === 'thread/turns/list' && params.threadId === 'root')).toHaveLength(1);
    expect(state.request.mock.calls.every(([method]) => ['thread/read', 'thread/turns/list'].includes(method))).toBe(true);
    reader.close(); expect(state.close).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched parent/project before reading message content', async () => {
    state.request.mockResolvedValue({ thread: { id: 'child', cwd: '/another-project', parentThreadId: 'root' } });
    const reader = new CodexSubagentReader('/workspace');
    await expect(reader.read('child', 'root', new Set())).rejects.toThrow('不属于');
    expect(state.request).toHaveBeenCalledTimes(1);
    reader.close();
  });

  it('continues metadata and child pages until a known turn is reached', async () => {
    state.request.mockImplementation(async (method, params) => {
      if (method === 'thread/read') return { thread: { id: 'child', cwd: '/workspace', parentThreadId: 'root' } };
      if (params.threadId === 'root') return params.cursor ? { data: [turn('parent-old')], nextCursor: null } : { data: [], nextCursor: 'parent-next' };
      return params.cursor ? { data: [turn('known'), turn('parent-old')], nextCursor: 'unused' } : { data: [turn('new')], nextCursor: 'child-next' };
    });
    const reader = new CodexSubagentReader('/workspace');
    const result = await reader.read('child', 'root', new Set(['known']));
    expect(result.turns.map(turn => turn.id)).toEqual(['known', 'new']);
    expect(state.request.mock.calls.some(([, params]) => params.cursor === 'unused')).toBe(false);
    reader.close();
  });
});
