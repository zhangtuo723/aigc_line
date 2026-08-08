import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  type ElectronApplication,
  type Page,
  type JSHandle,
  expect,
  test,
  _electron as electron,
} from '@playwright/test'
import type { BrowserWindow } from 'electron'

const root = path.resolve(import.meta.dirname, '..', '..')
const runId = `${process.pid}-${Date.now()}`
const testUserDataDir = path.join(root, 'test-results', `electron-user-data-${runId}`)
const testWorkspaceDir = path.join(root, 'test-results', `skill-workspace-${runId}`)
let electronApp: ElectronApplication
let page: Page
let xvfbProcess: ChildProcess | undefined

function startXvfbOnLinux(): Promise<void> {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '1280x720x24', '-ac'], {
      stdio: 'ignore',
      detached: true,
    })

    xvfbProcess.once('error', reject)

    setTimeout(() => {
      process.env.DISPLAY = ':99'
      resolve()
    }, 500)
  })
}

test.beforeAll(async () => {
  test.setTimeout(30000)
  await startXvfbOnLinux()
  await fs.mkdir(testUserDataDir, { recursive: true })
  await fs.mkdir(testWorkspaceDir, { recursive: true })

  electronApp = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${testUserDataDir}`],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
  })
  page = await electronApp.firstWindow()

  const mainWin: JSHandle<BrowserWindow> = await electronApp.browserWindow(page)
  await mainWin.evaluate(async (win) => {
    win.webContents.executeJavaScript('console.log("Execute JavaScript with e2e testing.")')
  })
})

test.afterAll(async () => {
  if (page) {
    await page.screenshot({ path: 'test/screenshots/e2e.png' })
    await page.close()
  }

  if (electronApp) {
    await electronApp.close()
  }

  if (xvfbProcess?.pid) {
    process.kill(-xvfbProcess.pid)
    xvfbProcess = undefined
  }
})

test.describe('AIGC CANVAS Electron UI', () => {
  test('startup', async () => {
    const title = await page.title()
    expect(title).toBe('AIGC CANVAS')
  })

  test('home page loads correctly', async () => {
    await expect(page.getByRole('heading', { name: 'AIGC CANVAS' })).toBeVisible()
    await expect(page.getByText('尚未开启创作之旅')).toBeVisible()
  })

  test('slash opens the available skill menu and inserts a selection', async () => {
    await page.evaluate(async (folderPath) => {
      const project = await window.electronAPI.createProject('Skill E2E', folderPath)
      await window.electronAPI.loadProject(project.id)
    }, testWorkspaceDir)
    await page.reload()

    const input = page.getByPlaceholder('描述你的想法，输入 / 使用 Skill，或拖入附件…')
    await expect(input).toBeVisible()
    await input.fill('/')

    await expect(page.getByText('选择 Skill')).toBeVisible()
    await expect(page.getByRole('option', { name: '/clear' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /aigc-canvas:voiceover-to-video/ })).toBeVisible()
    const skill = page.getByRole('option', { name: /aigc-canvas:storyboard-production/ })
    await expect(skill).toBeVisible()
    await page.screenshot({ path: 'test/screenshots/skill-menu.png' })
    await skill.click()
    await expect(input).toHaveValue('/aigc-canvas:storyboard-production ')
  })

  test('new context requires confirmation and explains what is preserved', async () => {
    await page.getByRole('button', { name: '新建上下文' }).click()
    const dialog = page.getByRole('dialog', { name: '新建 Claude 上下文？' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('聊天历史和画布内容会继续保留')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })

  test('deleting a project card stays on the home page', async () => {
    const projectName = `Delete E2E ${runId}`
    const deleteWorkspace = path.join(root, 'test-results', `delete-workspace-${runId}`)
    await fs.mkdir(deleteWorkspace, { recursive: true })
    await page.evaluate(async ({ name, folderPath }) => {
      await window.electronAPI.createProject(name, folderPath)
    }, { name: projectName, folderPath: deleteWorkspace })

    // Reload the project index, then explicitly return to the home page.
    await page.reload()
    await page.getByRole('button', { name: '返回' }).click()
    const card = page.getByText(projectName, { exact: true }).locator('..')
    await card.hover()
    await card.getByRole('button', { name: '删除项目' }).click()

    await expect(page.getByText(projectName, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible()
    await expect(page.getByPlaceholder('描述你的想法，输入 / 使用 Skill，或拖入附件…')).toHaveCount(0)
  })
})
