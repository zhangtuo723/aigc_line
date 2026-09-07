import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs/promises'

test('chat paginates history, upserts streamed messages and retains failed drafts with attachments', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const folder = path.join(root, 'test-results', `chat-reliability-${Date.now()}`)
  await fs.mkdir(folder, { recursive: true })
  const attachmentPath = path.join(folder, 'draft-context.txt')
  await fs.writeFile(attachmentPath, 'attachment used by the chat reliability regression')
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root })
  try {
    const page = await app.firstWindow()
    const project = await page.evaluate(async folderPath => {
      const created = await window.electronAPI.createProject('Chat reliability', folderPath, { provider: 'codex', model: '' })
      await window.electronAPI.loadProject(created.id)
      return created
    }, folder)
    await app.evaluate(({ ipcMain }, projectId) => {
      ipcMain.removeHandler('chat:loadHistory')
      ipcMain.removeHandler('chat:codexQueue')
      ipcMain.removeHandler('chat:sendMessage')
      ipcMain.handle('chat:loadHistory', () => Array.from({ length: 250 }, (_, index) => ({
        id: `history-${index + 1}`, role: 'assistant', content: `历史回归消息 ${index + 1}`, timestamp: index + 1,
      })))
      ipcMain.handle('chat:codexQueue', () => ({ messages: [] }))
      ipcMain.handle('chat:sendMessage', (_event, id, message) => {
        if (id !== projectId) throw new Error('wrong project')
        ;(globalThis as any).__chatRegressionLastMessage = message
        return new Promise<void>((resolve, reject) => {
          ;(globalThis as any).__chatRegressionSettle = (success: boolean) => success ? resolve() : reject(new Error('附件暂时无法复制'))
        })
      })
    }, project.id)
    await page.reload()
    await expect(page.getByText('历史回归消息 250', { exact: true })).toBeVisible()
    await expect(page.getByText('历史回归消息 1', { exact: true })).toHaveCount(0)
    await expect(page.getByText('历史回归消息 150', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: /加载更早的 100 条消息/ }).click()
    await expect(page.getByText('历史回归消息 51', { exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: /加载更早的 50 条消息/ }).click()
    await expect(page.getByText('历史回归消息 1', { exact: true })).toHaveCount(1)

    await app.evaluate(({ BrowserWindow }, projectId) => {
      for (const content of ['流式消息第一段', '流式消息完整正文']) {
        BrowserWindow.getAllWindows()[0].webContents.send('chat:receiveMessage', {
          projectId, message: { id: 'same-stream-id', role: 'assistant', content, timestamp: 300 },
        })
      }
    }, project.id)
    await expect(page.getByText('流式消息完整正文', { exact: true })).toHaveCount(1)
    await expect(page.getByText('流式消息第一段', { exact: true })).toHaveCount(0)
    const input = page.getByPlaceholder('描述你的想法，输入 / 使用 Skill，或添加文件…')
    await input.fill('待发送草稿')
    await page.getByLabel('聊天附件', { exact: true }).setInputFiles(attachmentPath)
    await page.getByTitle('发送', { exact: true }).click()
    await expect(page.getByTitle('正在发送…', { exact: true })).toBeDisabled()
    await input.fill('等待期间修改过的草稿')
    await app.evaluate(() => (globalThis as any).__chatRegressionSettle(false))
    await expect(page.getByText(/输入内容与附件已保留/)).toBeVisible()
    await expect(input).toHaveValue('等待期间修改过的草稿')
    await expect(page.getByTitle('移除附件', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('region', { name: '待发送消息' })).toHaveCount(0)
    await page.screenshot({ path: 'test/screenshots/chat-failed-draft-retained.png' })

    await page.getByTitle('发送', { exact: true }).click()
    await expect(page.getByTitle('正在发送…', { exact: true })).toBeDisabled()
    expect(await app.evaluate(() => (globalThis as any).__chatRegressionLastMessage.content)).toBe('等待期间修改过的草稿')
    expect(await app.evaluate(() => (globalThis as any).__chatRegressionLastMessage.attachments[0].name)).toBe('draft-context.txt')
    await app.evaluate(() => (globalThis as any).__chatRegressionSettle(true))
    await expect(input).toHaveValue('')
    await expect(page.getByTitle('移除附件', { exact: true })).toHaveCount(0)
  } finally { await app.close() }
})
