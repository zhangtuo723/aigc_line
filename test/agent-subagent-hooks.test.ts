import { describe, expect, it, vi } from 'vitest';

const captures = vi.hoisted(() => ({ pushed: vi.fn(), appended: vi.fn(), updated: vi.fn() }));
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../electron/main/services/message-hub', () => ({ messageHub: { pushToFrontend: captures.pushed } }));
vi.mock('../electron/main/services/project.store', () => ({
  appendChatMessage: captures.appended,
  updateChatMessage: captures.updated,
}));

import { createToolTrackingHooks, interruptActiveToolCalls } from '../electron/main/services/agent/hooks';
import type { SubagentTask, ToolCallInfo } from '../electron/main/services/agent/types';

describe('Claude subagent tool ownership', () => {
  it('preserves background child tools when only the main turn ends', async () => {
    captures.pushed.mockClear();
    const active = new Map<string, ToolCallInfo>([
      ['main-tool', { id: 'main-tool', toolName: 'Read', toolInput: {}, status: 'running' }],
      ['child-tool', { id: 'child-tool', toolName: 'Read', toolInput: {}, status: 'running', subagent: { agentId: 'child' } }],
    ]);
    await interruptActiveToolCalls('project', 'folder', active, undefined, tool => !tool.subagent);
    expect([...active.keys()]).toEqual(['child-tool']);
    expect(captures.pushed.mock.calls.map(call => call[1].id)).toEqual(['main-tool']);
    await interruptActiveToolCalls('project', 'folder', active);
    expect(active.size).toBe(0);
  });
  it('keeps child tools out of the main timeline and links late task metadata', async () => {
    captures.pushed.mockClear();
    const active = new Map<string, ToolCallInfo>();
    const tasks = new Map<string, SubagentTask>();
    const hooks = createToolTrackingHooks('project', 'folder', active, tasks);
    await hooks.PreToolUse[0].hooks[0]({ tool_name: 'Read', tool_input: {}, tool_use_id: 'child-tool', agent_id: 'agent-123', agent_type: 'general-purpose' });
    expect(captures.pushed.mock.calls[0][1].subagent).toMatchObject({ agentId: 'agent-123', type: 'general-purpose' });
    tasks.set('123', { parentToolUseId: 'agent-tool', description: '检查分镜' });
    await hooks.PostToolUse[0].hooks[0]({ tool_name: 'Read', tool_use_id: 'child-tool', tool_response: {}, duration_ms: 2 });
    expect(captures.pushed.mock.calls[1][1].subagent).toMatchObject({
      agentId: 'agent-123', parentToolUseId: 'agent-tool', description: '检查分镜',
    });
  });
});
