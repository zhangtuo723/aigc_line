import { randomUUID } from 'node:crypto';
import type { ChatMessage, SubagentTaskState } from '../../../../src/shared/ipc.types';
import { isSubagentTaskActive } from '../../../../src/shared/chat-subagents';
import { appendChatMessage, updateChatMessage } from '../project.store';
import { messageHub } from '../message-hub';
import type { SubagentTask } from './types';

type TaskContext = {
  projectId: string;
  folderPath: string;
  subagentTasks: Map<string, SubagentTask>;
  subagentInvocations: ReadonlySet<string>;
};

function taskStatus(value: unknown): SubagentTaskState['status'] | undefined {
  if (value === 'killed') return 'stopped';
  if (value === 'pending' || value === 'running' || value === 'paused'
    || value === 'completed' || value === 'failed' || value === 'stopped') return value;
  return undefined;
}

/** Tool return and main-turn completion are not child task completion signals. */
export async function trackSubagentTask(context: TaskContext, event: Record<string, unknown>): Promise<void> {
  if (event.type !== 'system' || typeof event.task_id !== 'string'
    || !['task_started', 'task_progress', 'task_updated', 'task_notification'].includes(String(event.subtype))) return;
  const key = event.task_id.replace(/^agent-/, '');
  const previous = context.subagentTasks.get(key);
  const parentId = typeof event.tool_use_id === 'string' ? event.tool_use_id : previous?.parentToolUseId;
  // Bash/workflow background jobs also emit task events; only register actual agents.
  if (!previous && (!parentId || event.skip_transcript === true || !(typeof event.subagent_type === 'string'
    || event.task_type === 'local_agent' || context.subagentInvocations.has(parentId)))) return;
  if (!parentId) return;
  const patch = event.subtype === 'task_updated' && event.patch && typeof event.patch === 'object'
    ? event.patch as Record<string, unknown> : {};
  const previousState = previous?.message?.subagentTask;
  let status = taskStatus(event.status ?? patch.status)
    ?? previousState?.status ?? 'running';
  // A delayed progress/update must not revive a finished task.
  if (previousState && !isSubagentTaskActive(previousState)) status = previousState.status;
  const description = previous?.description
    ?? (typeof event.description === 'string' ? event.description : undefined);
  const type = previous?.type ?? (typeof event.subagent_type === 'string' ? event.subagent_type : undefined);
  const summary = typeof event.summary === 'string' ? event.summary
    : typeof patch.error === 'string' ? patch.error : previousState?.summary;
  const message: ChatMessage = {
    id: previous?.message?.id ?? `subagent-task-${randomUUID()}`,
    role: 'system', content: '', timestamp: previous?.message?.timestamp ?? Date.now(),
    subagent: { parentToolUseId: parentId, agentId: key, type, description },
    subagentTask: { taskId: event.task_id, status, summary },
  };
  if (previous?.message && JSON.stringify(previous.message) === JSON.stringify(message)) return;
  context.subagentTasks.set(key, { parentToolUseId: parentId, type, description, message });
  if (previous?.message) await updateChatMessage(context.folderPath, message.id, () => message);
  else await appendChatMessage(context.folderPath, message);
  messageHub.pushToFrontend(context.projectId, message);
}

export async function stopActiveSubagentTasks(context: TaskContext): Promise<void> {
  for (const task of context.subagentTasks.values()) {
    const previous = task.message;
    if (!previous?.subagentTask || !isSubagentTaskActive(previous.subagentTask)) continue;
    const message: ChatMessage = { ...previous, subagentTask: {
      ...previous.subagentTask, status: 'stopped', summary: 'Agent 会话已结束，子任务未返回完成事件。',
    } };
    task.message = message;
    await updateChatMessage(context.folderPath, message.id, () => message);
    messageHub.pushToFrontend(context.projectId, message);
  }
}
