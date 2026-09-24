import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/shared/ipc.types';
import { groupChatSubagents } from '../src/shared/chat-subagents';

const state = vi.hoisted(() => ({ messages: new Map<string, ChatMessage>(), read: vi.fn(), close: vi.fn(), push: vi.fn() }));
vi.mock('../electron/main/services/project.store', () => ({
  appendChatMessage: async (_folder: string, message: ChatMessage) => { state.messages.set(message.id, structuredClone(message)); },
  updateChatMessage: async (_folder: string, id: string, update: (message: ChatMessage) => ChatMessage) => {
    if (!state.messages.has(id)) throw new Error('missing record');
    state.messages.set(id, structuredClone(update(state.messages.get(id)!)));
  },
}));
vi.mock('../electron/main/services/message-hub', () => ({ messageHub: { pushToFrontend: state.push, notifyError: vi.fn() } }));
vi.mock('../electron/main/services/agent/codex-subagent-reader', () => ({ CodexSubagentReader: class { read = state.read; close = state.close; } }));
import { CodexSubagents } from '../electron/main/services/agent/codex-subagents';

const event = (id: string, tool: string, receivers: string[], states: Record<string, unknown> = {}, type = 'item.completed') => ({
  type, item: { id, type: 'collab_tool_call', tool, sender_thread_id: 'root', receiver_thread_ids: receivers,
    prompt: '检查分镜', status: type === 'item.completed' ? 'completed' : 'in_progress', agents_states: states },
});
const snapshot = (id: string, status = 'inProgress', turnId = 'turn-1') => ({ turns: [{
  id: turnId, status, startedAt: 10, items: [
    { id: 'item-1', type: 'agentMessage', text: `${id} 的回复` },
    { id: 'item-2', type: 'commandExecution', command: 'check', status: 'completed', aggregatedOutput: 'ok' },
  ],
}] });
let tracker: CodexSubagents;
const task = (id: string) => [...state.messages.values()].find(message => message.subagentTask?.taskId === id)!;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.messages.clear();
  state.read.mockImplementation(async id => snapshot(id));
  tracker = new CodexSubagents('project', '/workspace'); tracker.begin();
});
afterEach(() => { tracker.close(); vi.useRealTimers(); });

describe('Codex child panels', () => {
  it('shows spawning, then running after spawn returns; interleaved children have separate messages and tool IDs', async () => {
    await tracker.handle(event('spawn-a', 'spawn_agent', [], {}, 'item.started'), 'turn', 'root');
    expect([...state.messages.values()][0].subagentTask?.status).toBe('pending');
    await tracker.handle(event('spawn-a', 'spawn_agent', ['a'], { a: { status: 'running' } }), 'turn', 'root');
    await tracker.handle(event('spawn-b', 'spawn_agent', ['b'], { b: { status: 'running' } }), 'turn', 'root');
    expect(task('a').subagentTask?.status).toBe('running');
    expect(tracker.activeMessageIds()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    const groups = groupChatSubagents([...state.messages.values()]);
    expect(groups).toHaveLength(2);
    expect(groups.every(group => group.kind === 'subagent')).toBe(true);
    expect(groups[0]).toMatchObject({ task: { status: 'running' }, messages: [
      { content: 'a 的回复' }, { toolCall: { toolName: 'command_execution' } },
    ] });
    expect([...state.messages.keys()].filter(id => id.includes('item-2'))).toHaveLength(2);
  });

  it('does not finish a task on wait timeout; uses per-agent result and preserves completion on close', async () => {
    await tracker.handle(event('spawn', 'spawn_agent', ['a'], { a: { status: 'running' } }), 'turn', 'root');
    await tracker.handle(event('wait-1', 'wait', ['a'], {}), 'turn', 'root');
    expect(task('a').subagentTask?.status).toBe('running');
    await tracker.handle(event('wait-2', 'wait', ['a'], { a: { status: 'completed', message: 'a 的回复' } }), 'turn', 'root');
    await tracker.handle(event('spawn', 'spawn_agent', ['a'], { a: { status: 'running' } }), 'turn', 'root');
    expect(task('a').subagentTask?.status).toBe('completed');
    await tracker.handle(event('close', 'close_agent', ['a'], { a: { status: 'shutdown' } }), 'turn', 'root');
    state.read.mockResolvedValue(snapshot('a', 'completed'));
    await tracker.finish();
    expect(task('a').subagentTask).toMatchObject({ status: 'completed', summary: undefined });
    expect(state.close).toHaveBeenCalledTimes(1);
    await tracker.finish();
    expect(state.close).toHaveBeenCalledTimes(1);
  });

  it('uses real failure/stopped states and handles failed spawn without a receiver', async () => {
    const failed = event('failed', 'spawn_agent', []); failed.item.status = 'failed';
    await tracker.handle(failed, 'turn', 'root');
    expect([...state.messages.values()][0].subagentTask?.status).toBe('failed');
    for (const [id, status] of [['a', 'errored'], ['b', 'interrupted'], ['c', 'not_found']]) {
      await tracker.handle(event(`spawn-${id}`, 'spawn_agent', [id], { [id]: { status } }), 'turn', 'root');
    }
    expect(['a', 'b', 'c'].map(id => task(id).subagentTask?.status)).toEqual(['failed', 'stopped', 'unknown']);
  });

  it('cannot let a stale completed snapshot finish a new follow-up', async () => {
    await tracker.handle(event('spawn', 'spawn_agent', ['a'], { a: { status: 'completed' } }), 'turn', 'root');
    state.read.mockResolvedValue(snapshot('a', 'completed'));
    await vi.advanceTimersByTimeAsync(1_000);
    await tracker.handle(event('followup', 'followup_task', ['a'], { a: { status: 'completed' } }, 'item.started'), 'turn', 'root');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task('a').subagentTask?.status).toBe('running');
    state.read.mockResolvedValue(snapshot('a', 'inProgress', 'turn-2'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task('a').subagentTask?.status).toBe('running');
    state.read.mockResolvedValue(snapshot('a', 'completed', 'turn-2'));
    await tracker.finish();
    expect(task('a').subagentTask?.status).toBe('completed');
  });

  it('stops unfinished children on stream exit and keeps reader failures separate from task failure', async () => {
    await tracker.handle(event('spawn', 'spawn_agent', ['a'], { a: { status: 'running' } }), 'turn', 'root');
    state.read.mockRejectedValue(new Error('temporarily unavailable'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task('a').subagentTask).toMatchObject({ status: 'running', detailError: expect.any(String) });
    await tracker.finish();
    expect(task('a').subagentTask?.status).toBe('stopped');
    expect(tracker.activeMessageIds()).toEqual([]);
    expect(state.close).toHaveBeenCalled();
  });

  it('does not treat an unloaded app-server interrupted turn as a live stop event', async () => {
    await tracker.handle(event('spawn', 'spawn_agent', ['a'], { a: { status: 'running' } }), 'turn', 'root');
    state.read.mockResolvedValue(snapshot('a', 'interrupted'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task('a').subagentTask?.status).toBe('running');
    state.read.mockResolvedValue(snapshot('a', 'completed'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task('a').subagentTask?.status).toBe('completed');
  });

  it('does not show a synthetic interrupted tool until the SDK process has exited', async () => {
    await tracker.handle(event('spawn', 'spawn_agent', ['a'], { a: { status: 'running' } }), 'turn', 'root');
    state.read.mockResolvedValue({ turns: [{ id: 'active-turn', status: 'interrupted', items: [
      { id: 'unfinished', type: 'commandExecution', command: 'work', status: 'interrupted' },
    ] }] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect([...state.messages.values()].some(message => message.id.includes('unfinished'))).toBe(false);
    await tracker.finish();
    expect([...state.messages.values()].find(message => message.id.includes('unfinished'))?.toolCall?.status).toBe('interrupted');
  });

  it('leaves unknown future item types to the existing fallback', async () => {
    expect(await tracker.handle(event('unknown', 'future_collab_tool', []), 'turn', 'root')).toBe(false);
  });
});
