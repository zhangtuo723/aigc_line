import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chatTextAttachmentPrompt, shouldAttachChatText } from '../src/shared/chat-text-attachment'
import { saveChatTextAttachment, stageChatAttachments } from '../electron/main/services/chat-attachment.service'

describe('long chat text attachments', () => {
  it('converts only nonblank input beyond 1000 Unicode characters', () => {
    expect(shouldAttachChatText('文'.repeat(1000))).toBe(false)
    expect(shouldAttachChatText('文'.repeat(1001))).toBe(true)
    expect(shouldAttachChatText('😀'.repeat(1000))).toBe(false)
    expect(shouldAttachChatText('😀'.repeat(1001))).toBe(true)
    expect(shouldAttachChatText(' \n'.repeat(1001))).toBe(false)
  })

  it('keeps an explicit skill command in the short message', () => {
    const original = '/script-to-drama-video\n' + '剧本'.repeat(600)
    expect(chatTextAttachmentPrompt(original, '输入文本.txt')).toBe('/script-to-drama-video\n请读取附件“输入文本.txt”中的完整输入文本，并按其中的要求处理。')
    expect(chatTextAttachmentPrompt('普通文字', '输入文本.txt')).toBe('请读取附件“输入文本.txt”中的完整输入文本，并按其中的要求处理。')
  })

  it('writes exact UTF-8 text inside the project and reuses it during staging', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-long-text-'))
    try {
      const original = '  /script-to-drama-video\r\n' + '原文😀\n'.repeat(600) + '\n  '
      const attachment = await saveChatTextAttachment(folder, original)
      expect(attachment.type).toBe('txt')
      expect(path.dirname(attachment.path)).toBe(path.join(folder, 'uploads', 'chat-attachments'))
      expect(await fs.readFile(attachment.path, 'utf8')).toBe(original)
      expect(await stageChatAttachments(folder, [attachment])).toEqual([attachment])
      const second = await saveChatTextAttachment(folder, original)
      expect(second.path).not.toBe(attachment.path)
      await expect(saveChatTextAttachment(folder, '   ')).rejects.toThrow('文本附件内容为空')
    } finally { await fs.rm(folder, { recursive: true, force: true }) }
  })
})
