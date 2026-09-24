import type { ChatMessage, SubagentTaskState } from './ipc.types';

export function isSubagentTaskActive(task: SubagentTaskState): boolean {
  return task.status === 'running' || task.status === 'pending' || task.status === 'paused';
}

export interface SubagentMessageGroup {
  kind: 'subagent';
  id: string;
  trigger?: ChatMessage;
  messages: ChatMessage[];
  type?: string;
  description?: string;
  task?: SubagentTaskState;
}

export type ChatDisplayItem =
  | { kind: 'message'; message: ChatMessage }
  | SubagentMessageGroup;

function isAgentTool(message: ChatMessage): boolean {
  return message.toolCall?.toolName === 'Agent' || message.toolCall?.toolName === 'Task';
}

function toolDescription(message: ChatMessage): string | undefined {
  const input = message.toolCall?.toolInput;
  if (!input) return undefined;
  try {
    const parsed: unknown = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const description = (parsed as { description?: unknown }).description;
    return typeof description === 'string' && description.trim() ? description.trim() : undefined;
  } catch { return undefined; }
}

/** Keep child output at its Agent invocation even when background tasks interleave. */
export function groupChatSubagents(messages: ChatMessage[], context: ChatMessage[] = messages): ChatDisplayItem[] {
  const groups = new Map<string, SubagentMessageGroup>();
  const parentByAgentId = new Map<string, string>();
  for (const message of context) {
    if (message.subagent?.agentId && message.subagent.parentToolUseId) {
      parentByAgentId.set(message.subagent.agentId, message.subagent.parentToolUseId);
      parentByAgentId.set(message.subagent.agentId.replace(/^agent-/, ''), message.subagent.parentToolUseId);
    }
  }
  const ownerId = (message: ChatMessage): string | undefined => {
    const owner = message.subagent;
    return owner?.parentToolUseId ?? (owner?.agentId
      ? parentByAgentId.get(owner.agentId) ?? parentByAgentId.get(owner.agentId.replace(/^agent-/, '')) ?? `agent:${owner.agentId}`
      : undefined);
  };
  const group = (id: string): SubagentMessageGroup => {
    let existing = groups.get(id);
    if (!existing) {
      existing = { kind: 'subagent', id, messages: [] };
      groups.set(id, existing);
    }
    return existing;
  };

  for (const message of context) {
    if (isAgentTool(message)) {
      const item = group(message.id);
      item.trigger = message;
      item.description ??= toolDescription(message);
    }
    const parentId = ownerId(message);
    if (parentId) {
      const item = group(parentId);
      item.type ??= message.subagent?.type;
      item.description ??= message.subagent?.description;
      if (message.subagentTask) item.task = message.subagentTask;
    }
  }

  for (const message of messages) {
    const parentId = ownerId(message);
    if (parentId && !message.subagentTask) group(parentId).messages.push(message);
  }

  const result: ChatDisplayItem[] = [];
  const emitted = new Set<string>();
  for (const message of messages) {
    const groupId = ownerId(message) ?? (isAgentTool(message) ? message.id : undefined);
    if (groupId) {
      if (!emitted.has(groupId)) {
        result.push(group(groupId));
        emitted.add(groupId);
      }
    } else {
      result.push({ kind: 'message', message });
    }
  }
  return result;
}
