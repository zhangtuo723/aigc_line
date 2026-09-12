export const CHAT_TEXT_ATTACHMENT_THRESHOLD = 1000;

/** Count Unicode code points without allocating a second copy of a large paste. */
export function shouldAttachChatText(content: string): boolean {
  let length = 0;
  for (const _character of content) {
    if (++length > CHAT_TEXT_ATTACHMENT_THRESHOLD) return content.trim().length > 0;
  }
  return false;
}

export function chatTextAttachmentPrompt(content: string, name: string): string {
  // Both agent runtimes discover explicit skills from the first prompt token.
  const command = content.trimStart().match(/^\/[^\s]+/)?.[0];
  const prefix = command && !shouldAttachChatText(command) ? `${command}\n` : '';
  return `${prefix}请读取附件“${name}”中的完整输入文本，并按其中的要求处理。`;
}
