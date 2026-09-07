import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs/promises'

test('Codex queue displays pending messages and only prioritizes on explicit click', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const folder = path.join(root, 'test-results', `queue-ui-${Date.now()}`)
  await fs.mkdir(folder, { recursive: true })
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root })
  try {
    const page = await app.firstWindow()
    const project = await page.evaluate(async folder => {
      const project = await window.electronAPI.createProject('Queue UI', folder, { provider: 'codex', model: '' })
      await window.electronAPI.loadProject(project.id)
      return project
    }, folder)
    await app.evaluate(({ ipcMain, BrowserWindow }, projectId) => {
      let messages = [
        { id: 'a', role: 'user', content: '改成 16:9 横屏', timestamp: 1 },
        { id: 'b', role: 'user', content: '补充：采用皮克斯 3D 动画风格', timestamp: 2 },
      ]
      ipcMain.removeHandler('chat:codexQueue')
      ipcMain.removeHandler('chat:codexSendNow')
      ipcMain.removeHandler('chat:loadHistory')
      ipcMain.handle('chat:loadHistory', () => messages.map(message => ({ ...message, deliveryStatus: 'queued' })))
      ipcMain.handle('chat:codexQueue', (_event, id) => ({ messages: id === projectId ? messages : [] }))
      ipcMain.handle('chat:codexSendNow', (_event, id, messageId) => {
        if (id !== projectId) throw new Error('wrong project')
        const message = messages.find(message => message.id === messageId)
        messages = messages.filter(message => message.id !== messageId)
        BrowserWindow.getAllWindows()[0].webContents.send('chat:receiveMessage', { projectId, message: { ...message, deliveryStatus: 'sent' } })
      })
    }, project.id)
    await page.reload()
    const queue = page.getByRole('region', { name: '待发送消息' })
    await expect(queue.getByRole('listitem')).toHaveCount(2)
    await expect(queue).toContainText('当前回合结束后按顺序发送')
    await expect(page.getByText('补充：采用皮克斯 3D 动画风格', { exact: true })).toHaveCount(1)
    await page.screenshot({ path: 'test/screenshots/codex-queue.png' })
    await queue.getByRole('listitem').filter({ hasText: '皮克斯' }).getByRole('button', { name: '立即发送' }).click()
    await expect(queue.getByRole('listitem')).toHaveCount(1)
    await expect(queue).toContainText('16:9')
    await expect(page.getByText('补充：采用皮克斯 3D 动画风格', { exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(queue).toHaveCount(0)
  } finally { await app.close() }
})
