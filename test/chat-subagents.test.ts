import { describe, expect, it } from 'vitest';
import { groupChatSubagents } from '../src/shared/chat-subagents';
import type { ChatMessage } from '../src/shared/ipc.types';

const message = (id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: 'assistant', content, timestamp: 1, ...extra,
});

describe('chat subagent grouping', () => {
  it('retains lifecycle status and aliases outside the visible history page', () => {
    const status = message('task', '', { role: 'system', subagent: { agentId: '123', parentToolUseId: 'call' }, subagentTask: { taskId: 'agent-123', status: 'completed' } });
    const child = message('child', '', { subagent: { agentId: 'agent-123' }, toolCall: { id: 'child', toolName: 'Read', toolInput: '{}', status: 'error' } });
    const items = groupChatSubagents([child], [status, child]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'subagent', id: 'call', task: { status: 'completed' }, messages: [child] });
    expect(groupChatSubagents([status, child])).toHaveLength(1);
  });
  it('keeps interleaved child output under its Agent invocation', () => {
    const items = groupChatSubagents([
      message('call-a', '', { role: 'system', toolCall: { id: 'call-a', toolName: 'Agent', toolInput: '{"description":"检查分镜"}', status: 'completed' } }),
      message('child-1', '检查开始', { subagent: { parentToolUseId: 'call-a', type: 'general-purpose' } }),
      message('main', '主 Agent 继续处理'),
      message('child-tool', '', { role: 'system', subagent: { parentToolUseId: 'call-a', agentId: 'agent-1' }, toolCall: { id: 'child-tool', toolName: 'Read', toolInput: '{}', status: 'completed' } }),
      message('child-2', '检查结束', { subagent: { parentToolUseId: 'call-a' } }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'subagent', id: 'call-a', description: '检查分镜' });
    if (items[0].kind !== 'subagent') throw new Error('expected subagent group');
    expect(items[0].messages.map(item => item.id)).toEqual(['child-1', 'child-tool', 'child-2']);
    expect(items[1]).toMatchObject({ kind: 'message', message: { id: 'main' } });
  });

  it('shows orphaned child output as its own group when earlier history is paged out', () => {
    const items = groupChatSubagents([
      message('child', '继续工作', { subagent: { parentToolUseId: 'older-call', description: '资产检查' } }),
      message('main', '总结'),
    ]);
    expect(items[0]).toMatchObject({ kind: 'subagent', id: 'older-call', description: '资产检查' });
    expect(items[1]).toMatchObject({ kind: 'message', message: { id: 'main' } });
  });

  it('joins early child tools to the parent once task metadata arrives', () => {
    const items = groupChatSubagents([
      message('agent-call', '', { role: 'system', toolCall: { id: 'agent-call', toolName: 'Agent', toolInput: '{}', status: 'completed' } }),
      message('early-tool', '', { role: 'system', subagent: { agentId: 'agent-1' }, toolCall: { id: 'early-tool', toolName: 'Read', toolInput: '{}', status: 'completed' } }),
      message('later-tool', '', { role: 'system', subagent: { agentId: 'agent-1', parentToolUseId: 'agent-call' }, toolCall: { id: 'later-tool', toolName: 'Bash', toolInput: '{}', status: 'completed' } }),
    ]);
    expect(items).toHaveLength(1);
    if (items[0].kind !== 'subagent') throw new Error('expected subagent group');
    expect(items[0].messages.map(item => item.id)).toEqual(['early-tool', 'later-tool']);
  });

});
