import type { ChatMessage } from './ipc.types'
import { normalizeInterruptedToolCalls } from './tool-call-status'
import { isSubagentTaskActive } from './chat-subagents'

export function normalizeInactiveSubagent(message: ChatMessage, activeMessageIds: ReadonlySet<string>): ChatMessage {
  if (!message.subagentTask || !isSubagentTaskActive(message.subagentTask) || activeMessageIds.has(message.id)) return message
  return { ...message, subagentTask: { ...message.subagentTask, status: 'stopped', summary: '会话已断开，子任务未返回完成事件。' } }
}

/** Live calls belong to this process; only orphaned running calls are interrupted. */
export function normalizeInactiveChatTools(messages: ChatMessage[], activeToolIds: ReadonlySet<string>) {
  const inactive = messages.filter((message) => message.toolCall?.status === 'running' && !activeToolIds.has(message.toolCall.id))
  if (!inactive.length) return { messages, changed: false }
  const normalized = new Map(normalizeInterruptedToolCalls(inactive).messages.map((message) => [message.id, message]))
  return { messages: messages.map((message) => normalized.get(message.id) ?? message), changed: true }
}
