import type { ChatMessage } from './ipc.types'

/** Preserve chronological position while replacing the latest version of a message. */
export function upsertChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const matches = (item: ChatMessage) => item.id === message.id
    || (!!message.toolCall && item.toolCall?.id === message.toolCall.id)
  const index = messages.findIndex(matches)
  if (index < 0) return [...messages, message]
  if (messages[index] === message) return messages
  return messages.flatMap((item, offset) => offset === index ? [message] : matches(item) ? [] : [item])
}

/** A history response is a baseline; events arriving during its load take precedence. */
export function mergeChatHistory(history: ChatMessage[], current: ChatMessage[], beforeLoad: ReadonlyMap<string, ChatMessage>): ChatMessage[] {
  const result = new Map(history.map((message) => [message.id, message]))
  for (const message of current) {
    if (!result.has(message.id) || beforeLoad.get(message.id) !== message) result.set(message.id, message)
  }
  return [...result.values()]
}

export function sameChatQueue(left: ChatMessage[], right: ChatMessage[]): boolean {
  return left === right || (left.length === right.length && left.every((message, index) => (
    message === right[index] || JSON.stringify(message) === JSON.stringify(right[index])
  )))
}

export function chatDisplayMessages(messages: ChatMessage[], serverQueue: ChatMessage[], codex: boolean) {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const serverIds = new Set(serverQueue.map((message) => message.id))
  const queued = codex ? [
    ...serverQueue.filter((message) => {
      const status = byId.get(message.id)?.deliveryStatus
      return !status || status === 'queued'
    }),
    ...messages.filter((message) => message.deliveryStatus === 'queued' && !serverIds.has(message.id)),
  ] : []
  const queuedIds = new Set(queued.map((message) => message.id))
  return { queued, visible: messages.filter((message) => !queuedIds.has(message.id)) }
}

export function mergeChatReferences<T extends { id: string }>(current: T[], restored: T[]): T[] {
  const seen = new Set(current.map((reference) => reference.id))
  return [...current, ...restored.filter((reference) => !seen.has(reference.id))]
}

/** Never clear a newer draft, even if a previous submit finishes successfully. */
export function canClearSubmittedDraft(submittedVersion: number, currentVersion: number, submittedProject: string, currentProject?: string): boolean {
  return submittedProject === currentProject && submittedVersion === currentVersion
}
