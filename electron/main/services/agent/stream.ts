import log from 'electron-log/main';

/** Extract the text payload from a streamed agent message, if any. */
export function extractMessageText(message: unknown): string | null {
  if (!message) return null;

  // Handle string message directly
  if (typeof message === 'string') {
    return message;
  }

  if (typeof message !== 'object') {
    return null;
  }

  const msg = message as Record<string, unknown>;

  // Log the message type for debugging
  log.info('[Agent] message type:', msg.type, 'subtype:', msg.subtype);

  // Handle assistant messages with text content
  if (msg.type === 'assistant') {
    // Try to extract text from msg.message.content (SDK assistant message format)
    if (msg.message && typeof msg.message === 'object') {
      const messageData = msg.message as Record<string, unknown>;

      // Handle content array
      if (messageData.content && Array.isArray(messageData.content)) {
        const texts = messageData.content
          .filter((block: unknown) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text')
          .map((block: unknown) => (block as Record<string, unknown>).text as string);
        return texts.join('');
      }

      // Handle direct content string
      if (typeof messageData.content === 'string') {
        return messageData.content;
      }
    }

    // Fallback: try direct text field
    if (msg.text && typeof msg.text === 'string') {
      return msg.text;
    }
  }

  return null;
}
