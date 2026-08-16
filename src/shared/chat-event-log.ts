import type { ChatMessage } from './ipc.types';

export type ChatHistoryEvent =
  | { version: 1; seq: number; type: 'message.created'; message: ChatMessage }
  | { version: 1; seq: number; type: 'message.replaced'; messageId: string; message: ChatMessage };

export interface ParsedChatEventLog {
  events: ChatHistoryEvent[];
  ignoredIncompleteTail: boolean;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  return typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant' || message.role === 'system')
    && typeof message.content === 'string'
    && typeof message.timestamp === 'number';
}

function isChatHistoryEvent(value: unknown): value is ChatHistoryEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ChatHistoryEvent>;
  if (event.version !== 1 || !Number.isSafeInteger(event.seq) || event.seq! < 1) return false;
  if (event.type === 'message.created') return isChatMessage(event.message);
  return event.type === 'message.replaced'
    && typeof event.messageId === 'string'
    && isChatMessage(event.message);
}

/** Parse a JSONL event log. Only a malformed final non-empty line is recoverable. */
export function parseChatEventLog(content: string): ParsedChatEventLog {
  const lines = content.split('\n');
  const lastNonEmptyIndex = lines.findLastIndex((line) => line.trim().length > 0);
  const events: ChatHistoryEvent[] = [];
  let ignoredIncompleteTail = false;
  let previousSeq = 0;

  for (let index = 0; index <= lastNonEmptyIndex; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (!isChatHistoryEvent(event)) throw new Error('事件结构无效');
      if (event.seq <= previousSeq) throw new Error('事件序号未严格递增');
      previousSeq = event.seq;
      events.push(event);
    } catch (error) {
      if (index === lastNonEmptyIndex) {
        ignoredIncompleteTail = true;
        break;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`聊天事件日志第 ${index + 1} 行损坏：${reason}`);
    }
  }

  return { events, ignoredIncompleteTail };
}

export function replayChatEvents(events: ChatHistoryEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const indexes = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'message.created') {
      indexes.set(event.message.id, messages.length);
      messages.push(event.message);
      continue;
    }
    const index = indexes.get(event.messageId);
    if (index !== undefined) {
      messages[index] = event.message;
      if (event.message.id !== event.messageId) {
        indexes.delete(event.messageId);
        indexes.set(event.message.id, index);
      }
    }
  }
  return messages;
}
