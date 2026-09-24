import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubagentTask } from '../electron/main/services/agent/types';
import type { ChatMessage } from '../src/shared/ipc.types';

const state = vi.hoisted(() => ({ persisted: new Map<string, ChatMessage>(), push: vi.fn() }));
vi.mock('../electron/main/services/message-hub', () => ({ messageHub: { pushToFrontend: state.push } }));
vi.mock('../electron/main/services/project.store', () => ({
  appendChatMessage: async (_folder: string, message: ChatMessage) => { state.persisted.set(message.id, message); },
  updateChatMessage: async (_folder: string, id: string, update: (message: ChatMessage) => ChatMessage) => {
    const previous = state.persisted.get(id);
    if (!previous) throw new Error('missing lifecycle record');
    state.persisted.set(id, update(previous));
  },
}));
import { trackSubagentTask, stopActiveSubagentTasks } from '../electron/main/services/agent/subagent-tasks';

const context = () => ({ projectId: 'project', folderPath: 'folder', subagentTasks: new Map<string, SubagentTask>(), subagentInvocations: new Set(['call']) });
const start = { type: 'system', subtype: 'task_started', task_id: 'agent-child', tool_use_id: 'call', description: '检查分镜' };
beforeEach(() => { state.persisted.clear(); state.push.mockClear(); });

describe('authoritative subagent lifecycle', () => {
  it('keeps a background task running after main turn completion, then persists its completion', async () => {
    const session = context();
    await trackSubagentTask(session, start);
    await trackSubagentTask(session, { type: 'result', subtype: 'success' });
    expect([...state.persisted.values()][0].subagentTask?.status).toBe('running');
    await trackSubagentTask(session, { type: 'system', subtype: 'task_notification', task_id: 'agent-child', status: 'completed', summary: '检查通过' });
    expect(state.persisted.size).toBe(1);
    expect([...state.persisted.values()][0].subagentTask).toEqual({ taskId: 'agent-child', status: 'completed', summary: '检查通过' });
    await trackSubagentTask(session, { ...start, subtype: 'task_progress' });
    await stopActiveSubagentTasks(session);
    expect([...state.persisted.values()][0].subagentTask?.status).toBe('completed');
    expect(state.push.mock.calls.at(-1)?.[0]).toBe('project');
  });

  it.each(['failed', 'stopped'] as const)('records %s notifications without a repeated parent ID', async status => {
    const session = context();
    await trackSubagentTask(session, start);
    await trackSubagentTask(session, { type: 'system', subtype: 'task_notification', task_id: 'agent-child', status });
    expect([...state.persisted.values()][0].subagentTask?.status).toBe(status);
  });

  it('merges paused/running/killed task updates and stops unfinished tasks when the stream ends', async () => {
    const session = context();
    await trackSubagentTask(session, start);
    for (const status of ['paused', 'running', 'killed']) {
      await trackSubagentTask(session, { type: 'system', subtype: 'task_updated', task_id: 'agent-child', patch: { status } });
      expect([...state.persisted.values()][0].subagentTask?.status).toBe(status === 'killed' ? 'stopped' : status);
    }
    await trackSubagentTask(session, { ...start, task_id: 'agent-second' });
    await stopActiveSubagentTasks(session);
    expect([...state.persisted.values()].every(message => message.subagentTask?.status === 'stopped')).toBe(true);
  });

  it('does not create subagent panels for shell or workflow background tasks', async () => {
    const session = context();
    await trackSubagentTask(session, { ...start, tool_use_id: 'shell-call', task_type: 'local_bash' });
    await trackSubagentTask(session, { ...start, tool_use_id: 'workflow-call', task_type: 'local_workflow' });
    expect(state.persisted.size).toBe(0);
  });
});
