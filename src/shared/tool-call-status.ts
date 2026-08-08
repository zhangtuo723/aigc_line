import type { ChatMessage } from './ipc.types';

/** Convert persisted running calls into terminal state after an app restart. */
export function normalizeInterruptedToolCalls(messages: ChatMessage[]): {
  messages: ChatMessage[];
  changed: boolean;
} {
  let changed = false;
  const normalized = messages.map((message) => {
    if (message.toolCall?.status !== 'running') return message;
    changed = true;
    return {
      ...message,
      content: `已中断: ${message.toolCall.toolName}`,
      toolCall: {
        ...message.toolCall,
        status: 'interrupted' as const,
        error: '上次工具调用未完成，Agent 会话或应用已经结束。',
      },
    };
  });
  return { messages: normalized, changed };
}
