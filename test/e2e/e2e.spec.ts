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

    const input = page.getByPlaceholder('描述你的想法，输入 / 使用 Skill，或粘贴图片…')
    await expect(input).toBeVisible()
    await input.fill('/')

    await expect(page.getByText('选择 Skill')).toBeVisible()
    await expect(page.getByRole('option', { name: '/clear' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /aigc-canvas:storyboard-production/ })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /aigc-canvas:voiceover-to-video/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /aigc-canvas:environment-reference-generation/ })).toBeVisible()
    const skill = page.getByRole('option', { name: /aigc-canvas:script-to-drama-video/ })
    await expect(skill).toBeVisible()
    await page.screenshot({ path: 'test/screenshots/skill-menu.png' })
    await skill.click()
    await expect(input).toHaveValue('/aigc-canvas:script-to-drama-video ')

    await input.fill('')
    await input.evaluate((element) => {
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const clipboard = new DataTransfer()
      clipboard.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }))
    })
    await expect(page.getByAltText(/pasted-image-.*\.png/)).toBeVisible()
    await page.getByTitle('移除附件').click()
  })

  test('new context requires confirmation and explains what is preserved', async () => {
    await page.getByRole('button', { name: '新建上下文' }).click()
    const dialog = page.getByRole('dialog', { name: '新建 Claude 上下文？' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('聊天历史和画布内容会继续保留')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
  })

  test('project asset panel lists media and supports dragging it onto the canvas', async () => {
    const assetName = `asset-${runId}.png`
    const assetDirectory = path.join(testWorkspaceDir, 'generated', 'images')
    await fs.mkdir(assetDirectory, { recursive: true })
    await fs.writeFile(
      path.join(assetDirectory, assetName),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    )

    await page.getByRole('button', { name: '资产' }).click()
    await expect(page.getByRole('heading', { name: '项目资产' })).toBeVisible()
    const assetCard = page.locator('[draggable="true"]').filter({ hasText: assetName })
    await expect(assetCard).toBeVisible()

    await assetCard.dragTo(page.locator('.react-flow__pane'), {
      targetPosition: { x: 500, y: 300 },
    })
    await expect(page.getByText(assetName, { exact: true })).toHaveCount(2)
  })

  test('3D director stage creates a persisted composition reference node', async () => {
    await page.getByTitle('添加3D 导演台节点').click()
    await page.getByRole('button', { name: '打开导演台' }).click()

    await expect(page.getByText('白模调度 · 多机位 · Shot 快照 · 24fps 工程')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()
    const cameraViewButton = page.getByRole('button', { name: '机位视角', exact: true })
    const directorViewButton = page.getByRole('button', { name: '导演视角', exact: true })
    const cancelDirectorButton = page.getByRole('button', { name: '取消', exact: true })
    expect((await cameraViewButton.boundingBox())?.y).toBeGreaterThanOrEqual(40)
    expect((await cancelDirectorButton.boundingBox())?.y).toBeGreaterThanOrEqual(40)
    await cameraViewButton.click()
    await expect(cameraViewButton).toHaveClass(/bg-\[#e8e6df\]/)
    await directorViewButton.click()
    await expect(directorViewButton).toHaveClass(/bg-\[#e8e6df\]/)
    await cancelDirectorButton.click()
    await expect(page.getByText('白模调度 · 多机位 · Shot 快照 · 24fps 工程')).toHaveCount(0)
    await page.getByRole('button', { name: '打开导演台' }).click()
    await expect(page.getByText('白模调度 · 多机位 · Shot 快照 · 24fps 工程')).toBeVisible()
    await page.getByRole('button', { name: '演员', exact: true }).click()
    await expect(page.getByText('演员 03', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '从导演视角新增机位' }).click()
    await expect(page.getByText('SHOT 02', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '拍摄构图并发送到画布' }).click()
    await expect(page.getByRole('button', { name: '拍摄构图并发送到画布' })).toBeEnabled({ timeout: 15000 })
    await page.screenshot({ path: 'test/screenshots/director-stage.png' })
    await page.getByRole('button', { name: '保存并返回画布' }).click()

    await expect(page.getByText('镜头 02 · 构图参考', { exact: true })).toBeVisible()
    await expect(page.getByText('只读构图参考', { exact: true })).toBeVisible()
    await page.getByText('镜头 02 · 构图参考', { exact: true }).click()
    await expect(page.getByRole('button', { name: '生成', exact: true })).toHaveCount(0)
    const directorFiles = await fs.readdir(path.join(testWorkspaceDir, 'generated', 'director-stills'))
    expect(directorFiles.some((file) => file.endsWith('.png'))).toBe(true)
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
    await expect(page.getByPlaceholder('描述你的想法，输入 / 使用 Skill，或粘贴图片…')).toHaveCount(0)
  })

  test('settings use a grouped wide layout and configure Ark media models', async () => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.getByTitle('系统配置').click()
    await expect(page.getByRole('heading', { name: '系统配置' })).toBeVisible()
    await expect(page.getByText('Doubao-Seedream-5.0-pro · 文生图 / 图生图 · 2K')).toBeVisible()
    await expect(page.getByText('Doubao-Seedream-5.0-lite · 文生图 / 图生图 · 2K')).toBeVisible()

    const comfyBox = await page.getByRole('heading', { name: 'ComfyUI 服务' }).boundingBox()
    const agentBox = await page.getByRole('heading', { name: 'Agent 环境' }).boundingBox()
    const qwenBox = await page.getByRole('heading', { name: 'Qwen 音视频审查' }).boundingBox()
    const googleBox = await page.getByRole('heading', { name: 'Google AI 图片生成' }).boundingBox()
    const seedreamBox = await page.getByRole('heading', { name: '方舟图片 / 视频生成' }).boundingBox()
    expect(comfyBox).not.toBeNull()
    expect(agentBox).not.toBeNull()
    expect(qwenBox).not.toBeNull()
    expect(googleBox).not.toBeNull()
    expect(seedreamBox).not.toBeNull()
    expect(agentBox!.x).toBeGreaterThan(comfyBox!.x + 300)
    expect(googleBox!.x).toBeGreaterThan(qwenBox!.x + 250)
    expect(seedreamBox!.x).toBeGreaterThan(googleBox!.x + 250)

    const seedreamKey = page.getByPlaceholder('输入火山方舟 API Key')
    await seedreamKey.fill('ark-e2e-persistence-check')
    await page.getByRole('button', { name: '保存配置' }).click()
    await expect(page.getByText('配置已保存，API Key 持久化校验通过')).toBeVisible()
    await expect(page.getByText('已保存', { exact: true })).toHaveCount(1)
    await expect(page.getByText('清除已保存的 API Key')).toHaveCount(1)
    await page.getByTitle('返回首页').click()
    await page.getByTitle('系统配置').click()
    await expect(page.getByPlaceholder('输入火山方舟 API Key')).toHaveValue('ark-e2e-persistence-check')
    await expect(page.getByText('已保存', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '测试方舟连接' })).toBeVisible()
    await page.screenshot({ path: 'test/screenshots/settings-wide.png', fullPage: true })
  })
})
