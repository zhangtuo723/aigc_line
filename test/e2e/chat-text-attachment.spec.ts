import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs/promises'

test('long input becomes a lossless TXT attachment and preserves drafts across asynchronous failures', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const folder = path.join(root, 'test-results', `chat-text-${Date.now()}`)
  await fs.mkdir(folder, { recursive: true })
  const extraPath = path.join(folder, 'context.md')
  await fs.writeFile(extraPath, 'Existing attachment')
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async folderPath => {
      const project = await window.electronAPI.createProject('Long text', folderPath, { provider: 'codex', model: '' })
      await window.electronAPI.loadProject(project.id)
    }, folder)
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('chat:sendMessage')
      ipcMain.handle('chat:sendMessage', (_event, _id, message) => {
        ;(globalThis as any).__textMessage = message
        return new Promise<void>((resolve, reject) => {
          ;(globalThis as any).__settleTextSend = (success: boolean) => success ? resolve() : reject(new Error('发送失败回归测试'))
        })
      })
    })
    await page.reload()
    const input = page.getByPlaceholder('描述你的想法，输入 / 使用 Skill，或添加文件…')
    const remove = page.getByTitle('移除附件', { exact: true })
    await input.fill('文'.repeat(1000))
    await page.waitForTimeout(450)
    await expect(input).toHaveValue('文'.repeat(1000))
    await expect(remove).toHaveCount(0)

    await page.getByLabel('聊天附件', { exact: true }).setInputFiles(extraPath)
    const original = '/script-to-drama-video\n  ' + '长文本😀\n'.repeat(300) + '  '
    await input.fill(original)
    await expect(remove).toHaveCount(2)
    await expect(input).toHaveValue(/^\/script-to-drama-video\n请读取附件/)
    const prompt = await input.inputValue()
    await page.getByTitle('发送', { exact: true }).click()
    await expect(page.getByTitle('正在发送…', { exact: true })).toBeDisabled()
    const message = await app.evaluate(() => (globalThis as any).__textMessage)
    expect(message.content).toBe(prompt)
    expect(message.attachments[0].name).toBe('context.md')
    expect(message.attachments[1].type).toBe('txt')
    expect(path.dirname(message.attachments[1].path)).toBe(path.join(folder, 'uploads', 'chat-attachments'))
    expect(await fs.readFile(message.attachments[1].path, 'utf8')).toBe(original)
    await app.evaluate(() => (globalThis as any).__settleTextSend(false))
    await expect(page.getByTitle('发送', { exact: true })).toBeEnabled()
    await expect(input).toHaveValue(prompt)
    await expect(remove).toHaveCount(2)
    await page.getByTitle('发送', { exact: true }).click()
    await expect(page.getByTitle('正在发送…', { exact: true })).toBeDisabled()
    expect(await app.evaluate(() => (globalThis as any).__textMessage.attachments[1].path)).toBe(message.attachments[1].path)
    await app.evaluate(() => (globalThis as any).__settleTextSend(true))
    await expect(input).toHaveValue('')
    await expect(remove).toHaveCount(0)

    // IME composition must not be consumed by the debounce timer.
    await input.dispatchEvent('compositionstart')
    await input.fill('字'.repeat(1001))
    await page.waitForTimeout(450)
    await expect(remove).toHaveCount(0)
    await input.dispatchEvent('compositionend')
    // Send immediately; the send path and timer must share one attachment.
    await input.press('Enter')
    await expect(page.getByTitle('正在发送…', { exact: true })).toBeDisabled()
    const immediate = await app.evaluate(() => (globalThis as any).__textMessage)
    expect(immediate.attachments).toHaveLength(1)
    expect(await fs.readFile(immediate.attachments[0].path, 'utf8')).toBe('字'.repeat(1001))
    await input.fill('发送期间的新草稿')
    await app.evaluate(() => (globalThis as any).__settleTextSend(true))
    await expect(page.getByTitle('发送', { exact: true })).toBeEnabled()
    await expect(input).toHaveValue('发送期间的新草稿')

    // Control the conversion response to reproduce edits made while disk IO is pending.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('chat:saveTextAttachment')
      ipcMain.handle('chat:saveTextAttachment', () => new Promise(resolve => {
        ;(globalThis as any).__settleTextFile = resolve
      }))
    })
    await input.fill('旧'.repeat(1001))
    await expect(page.getByRole('status').filter({ hasText: '正在转换为 TXT 附件' })).toBeVisible()
    await input.fill('转换期间的新草稿')
    await app.evaluate((_electron, attachment) => (globalThis as any).__settleTextFile({ success: true, attachment }), immediate.attachments[0])
    await expect(page.getByRole('status').filter({ hasText: '正在转换为 TXT 附件' })).toHaveCount(0)
    await expect(input).toHaveValue('转换期间的新草稿')
    await expect(remove).toHaveCount(0)
    await input.fill('失败'.repeat(600))
    await expect(page.getByRole('status').filter({ hasText: '正在转换为 TXT 附件' })).toBeVisible()
    await app.evaluate(() => (globalThis as any).__settleTextFile({ success: false, error: '磁盘写入失败' }))
    await expect(page.getByText(/磁盘写入失败，原文已保留/)).toBeVisible()
    await expect(input).toHaveValue('失败'.repeat(600))
    await expect(remove).toHaveCount(0)
  } finally { await app.close() }
})
