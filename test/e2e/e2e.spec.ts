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
let mainWindow: JSHandle<BrowserWindow>
let currentProjectId = ''
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

  mainWindow = await electronApp.browserWindow(page)
  await mainWindow.evaluate(async (win) => {
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
    currentProjectId = await page.evaluate(async (folderPath) => {
      const project = await window.electronAPI.createProject('Skill E2E', folderPath)
      await window.electronAPI.loadProject(project.id)
      return project.id
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
    const directorNode = page.locator('.react-flow__node').filter({ has: page.getByRole('button', { name: '打开导演台' }) })
    const directorId = await directorNode.getAttribute('data-id')
    expect(directorId).toBeTruthy()
    await directorNode.getByRole('button', { name: '打开导演台' }).click()

    await expect(page.getByText('白模调度 · 多机位 · 人物路径 · 24fps 工程')).toBeVisible()
    await page.keyboard.press('Delete')
    await expect(page.getByText('白模调度 · 多机位 · 人物路径 · 24fps 工程')).toBeVisible()
    await expect(page.locator(`.react-flow__node[data-id="${directorId}"]`)).toHaveCount(1)
    await expect(page.locator('canvas')).toBeVisible()
    await expect(page.getByText('双击场景物体激活', { exact: true })).toBeVisible()
    const stageToolbar = page.getByRole('toolbar', { name: '添加到片场工具栏' })
    await expect(stageToolbar).toBeVisible()
    const stageCanvasBox = await page.locator('canvas').boundingBox()
    const stageToolbarBox = await stageToolbar.boundingBox()
    expect(stageCanvasBox).not.toBeNull()
    expect(stageToolbarBox).not.toBeNull()
    expect(stageToolbarBox!.y).toBeGreaterThan(stageCanvasBox!.y + stageCanvasBox!.height * 0.7)
    await expect(page.getByRole('button', { name: '地面', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '楼梯', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '斜坡', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '胶囊', exact: true })).toBeVisible()
    const cameraViewButton = page.getByRole('button', { name: '机位视角', exact: true })
    const directorViewButton = page.getByRole('button', { name: '导演视角', exact: true })
    const closeDirectorButton = page.getByRole('button', { name: '关闭', exact: true })
    expect((await cameraViewButton.boundingBox())?.y).toBeGreaterThanOrEqual(40)
    expect((await closeDirectorButton.boundingBox())?.y).toBeGreaterThanOrEqual(40)
    await cameraViewButton.click()
    await expect(cameraViewButton).toHaveClass(/bg-\[#e8e6df\]/)
    await directorViewButton.click()
    await expect(directorViewButton).toHaveClass(/bg-\[#e8e6df\]/)
    await closeDirectorButton.click()
    await expect(page.getByText('白模调度 · 多机位 · 人物路径 · 24fps 工程')).toHaveCount(0)
    await page.getByRole('button', { name: '打开导演台' }).click()
    await expect(page.getByText('白模调度 · 多机位 · 人物路径 · 24fps 工程')).toBeVisible()
    await page.getByRole('button', { name: '演员', exact: true }).click()
    await expect(page.getByText('演员 01', { exact: true })).toBeVisible()
    await expect(page.getByText(/^已自动保存 /)).toBeVisible()
    await closeDirectorButton.click()
    await page.getByRole('button', { name: '打开导演台' }).click()
    await expect(page.getByText('演员 01', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '演员 01', exact: true }).click()
    await page.getByLabel('人物体型').selectOption('heavy')
    await expect(page.getByLabel('人物体型')).toHaveValue('heavy')
    await page.getByLabel('人物动作').selectOption('wave')
    await expect(page.getByLabel('人物动作')).toHaveValue('wave')
    await page.getByLabel('角色模型').selectOption('lightweight-v1')
    await expect(page.getByLabel('角色模型')).toHaveValue('lightweight-v1')
    await page.getByLabel('角色模型').selectOption('director-rig-v1')
    await expect(page.getByLabel('角色模型')).toHaveValue('director-rig-v1')
    await page.screenshot({ path: 'test/screenshots/director-stage-rigged-actor.png' })
    await page.getByRole('button', { name: '绘制路径', exact: true }).click()
    await expect(page.getByText('路径点 1 · XYZ 世界坐标', { exact: true })).toBeVisible()
    await expect(page.getByText(/按住 Ctrl 并用鼠标左键点击地面、台阶或平台等模型表面添加 XYZ 路径点/)).toBeVisible()
    const pathCanvas = page.locator('canvas')
    const pathCanvasBox = await pathCanvas.boundingBox()
    expect(pathCanvasBox).not.toBeNull()
    const pathPoint = { x: pathCanvasBox!.width * 0.72, y: pathCanvasBox!.height * 0.72 }
    await pathCanvas.click({ position: pathPoint })
    await expect(page.getByText('路径点 1 · XYZ 世界坐标', { exact: true })).toBeVisible()
    await expect(page.getByText('路径点 2 · XYZ 世界坐标', { exact: true })).toHaveCount(0)
    await pathCanvas.click({ position: pathPoint, modifiers: ['Control'] })
    await expect(page.getByText('路径点 2 · XYZ 世界坐标', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '完成绘制', exact: true }).click()
    await page.getByRole('button', { name: '楼梯', exact: true }).click()
    await expect(page.getByText('楼梯 02', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '斜坡', exact: true }).click()
    await expect(page.getByText('斜坡 03', { exact: true })).toBeVisible()
    await page.keyboard.press('z')
    await expect(page.getByRole('button', { name: '缩放 Z', exact: true })).toHaveClass(/bg-\[#e8e6df\]/)
    await page.getByRole('button', { name: '从导演视角新增机位' }).click()
    await expect(page.getByText('SHOT 02', { exact: true })).toBeVisible()

    const stageCanvas = page.locator('canvas')
    await stageCanvas.click({ position: { x: 80, y: 80 } })
    const cameraPositionInputs = page.getByText('摄影机位置', { exact: true }).locator('..').locator('input')
    const cameraTargetInputs = page.getByText('注视目标', { exact: true }).locator('..').locator('input')
    const initialY = Number(await cameraPositionInputs.nth(1).inputValue())
    const initialX = Number(await cameraPositionInputs.nth(0).inputValue())
    await page.keyboard.down('s')
    await page.waitForTimeout(180)
    await page.keyboard.up('s')
    await expect.poll(async () => Number(await cameraPositionInputs.nth(0).inputValue())).not.toBe(initialX)
    await page.keyboard.down('Space')
    await page.waitForTimeout(180)
    await page.keyboard.up('Space')
    await expect.poll(async () => Number(await cameraPositionInputs.nth(1).inputValue())).toBeGreaterThan(initialY)
    const raisedY = Number(await cameraPositionInputs.nth(1).inputValue())
    await page.keyboard.down('Control')
    await page.waitForTimeout(180)
    await page.keyboard.up('Control')
    await expect.poll(async () => Number(await cameraPositionInputs.nth(1).inputValue())).toBeLessThan(raisedY)
    const initialTargetX = Number(await cameraTargetInputs.nth(0).inputValue())
    const canvasBox = await stageCanvas.boundingBox()
    expect(canvasBox).not.toBeNull()
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2 + 100, canvasBox!.y + canvasBox!.height / 2)
    await page.mouse.up()
    await expect.poll(async () => Number(await cameraTargetInputs.nth(0).inputValue())).not.toBe(initialTargetX)

    const timeline = page.getByRole('slider', { name: '镜头时间线' })
    await expect(timeline).toHaveAttribute('max', '119')
    await timeline.fill('24')
    await page.getByRole('button', { name: '＋关键帧', exact: true }).click()
    await expect(page.locator('[title^="关键帧 24 ·"]')).toBeVisible()
    await directorViewButton.click()
    await page.locator('[title^="关键帧 24 ·"]').click()
    await expect(cameraViewButton).toHaveClass(/bg-\[#e8e6df\]/)
    await page.getByTitle('播放预演').click()
    await expect(page.getByTitle('暂停预演')).toBeVisible()
    await page.getByTitle('暂停预演').click()
    await page.locator('[title^="关键帧 24 ·"]').click()
    await page.getByTitle('删除当前关键帧').click()
    await expect(page.locator('[title^="关键帧 24 ·"]')).toHaveCount(0)
    await timeline.fill('24')
    await page.getByRole('button', { name: '＋关键帧', exact: true }).click()

    await page.getByText('时长', { exact: true }).locator('input').fill('2')
    await page.getByRole('button', { name: '导出预演视频到画布', exact: true }).click()
    await expect(page.getByRole('button', { name: '导出预演视频到画布', exact: true })).toBeEnabled({ timeout: 15000 })

    await page.getByRole('button', { name: '拍摄构图并发送到画布' }).click()
    await expect(page.getByRole('button', { name: '拍摄构图并发送到画布' })).toBeEnabled({ timeout: 15000 })
    await page.screenshot({ path: 'test/screenshots/director-stage.png' })
    await page.getByRole('button', { name: '保存并返回画布' }).click()

    await expect(page.getByText('镜头 02 · 构图参考', { exact: true })).toBeVisible()
    await expect(page.getByText('镜头 02 · 预演视频', { exact: true })).toBeVisible()
    await expect(page.getByText('只读构图参考', { exact: true })).toBeVisible()
    await expect(page.getByText('只读预演视频', { exact: true })).toBeVisible()
    await page.getByText('镜头 02 · 构图参考', { exact: true }).click()
    await expect(page.getByRole('button', { name: '生成', exact: true })).toHaveCount(0)
    await page.getByText('镜头 02 · 预演视频', { exact: true }).dispatchEvent('click')
    await expect(page.getByRole('button', { name: '生成', exact: true })).toHaveCount(0)
    const directorFiles = await fs.readdir(path.join(testWorkspaceDir, 'generated', 'director-stills'))
    expect(directorFiles.some((file) => file.endsWith('.png'))).toBe(true)
    const directorVideos = await fs.readdir(path.join(testWorkspaceDir, 'generated', 'director-videos'))
    expect(directorVideos.some((file) => file.endsWith('.webm'))).toBe(true)
  })

  test('board opens blank, loads connected images, and exports the selection as a linked node', async () => {
    test.setTimeout(60000)
    await page.getByTitle('添加画板节点').click()
    const sourceNode = page.locator('.react-flow__node').filter({ hasText: '镜头 02 · 构图参考' })
    const editorNode = page.locator('.react-flow__node').filter({ has: page.getByRole('button', { name: '打开画板' }) })
    const sourceId = await sourceNode.getAttribute('data-id')
    const editorId = await editorNode.getAttribute('data-id')
    expect(sourceId).toBeTruthy()
    expect(editorId).toBeTruthy()
    const openEditorButton = editorNode.getByRole('button', { name: '打开画板' })
    await expect(openEditorButton).toBeEnabled()
    await openEditorButton.click()
    await expect(page.getByText('Excalidraw 自由画板 · 无连接素材')).toBeVisible()
    await page.keyboard.press('Delete')
    await expect(page.getByText('Excalidraw 自由画板 · 无连接素材')).toBeVisible()
    await expect(page.locator(`.react-flow__node[data-id="${editorId}"]`)).toHaveCount(1)
    let excalidrawCanvas = page.locator('canvas.excalidraw__canvas.interactive')
    await expect(excalidrawCanvas).toBeVisible()
    let canvasBox = await excalidrawCanvas.boundingBox()
    expect(canvasBox).not.toBeNull()
    const drawingStart = { x: canvasBox!.x + canvasBox!.width / 2 - 90, y: canvasBox!.y + 260 }
    const drawingEnd = { x: drawingStart.x + 180, y: drawingStart.y + 110 }
    await excalidrawCanvas.click({ position: { x: 100, y: 220 } })
    await page.keyboard.press('r')
    await expect(page.getByRole('radio', { name: /矩形/ })).toBeChecked()
    await page.mouse.move(drawingStart.x, drawingStart.y)
    await page.mouse.down()
    await page.mouse.move(drawingEnd.x, drawingEnd.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.press('Delete')
    await expect(page.getByText('Excalidraw 自由画板 · 无连接素材')).toBeVisible()
    await page.keyboard.press('r')
    await page.mouse.move(drawingStart.x, drawingStart.y)
    await page.mouse.down()
    await page.mouse.move(drawingEnd.x, drawingEnd.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.press('Control+a')
    await page.mouse.click(drawingStart.x + 20, drawingStart.y + 20, { button: 'right' })
    await expect(page.getByRole('button', { name: /导出所选素材/ })).toBeEnabled()
    await page.getByRole('button', { name: '关闭并返回画布' }).click()
    await page.waitForTimeout(900)
    await page.reload()

    const boardPreviewImage = editorNode.getByRole('img', { name: '画板中心预览' })
    await expect(boardPreviewImage).toBeVisible()
    await expect.poll(() => boardPreviewImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    const persistedBoard = await page.evaluate(async (folderPath) => {
      const snapshot = await window.electronAPI.loadCanvasSnapshot(folderPath) as {
        nodes?: Array<{ data?: { kind?: string; boardState?: { elements?: unknown[] }; boardPreviewPath?: string } }>
      } | null
      const board = snapshot?.nodes?.find((node) => node.data?.kind === 'image-editor')?.data
      return { elementCount: board?.boardState?.elements?.length ?? 0, previewPath: board?.boardPreviewPath }
    }, testWorkspaceDir)
    expect(persistedBoard.elementCount).toBe(1)
    expect(persistedBoard.previewPath).toMatch(/^\.aigc-line\/board-previews\/.+\.png$/)
    await expect(fs.stat(path.join(testWorkspaceDir, persistedBoard.previewPath!))).resolves.toMatchObject({ size: expect.any(Number) })

    await openEditorButton.click()
    await expect(page.getByText('Excalidraw 自由画板 · 无连接素材')).toBeVisible()
    excalidrawCanvas = page.locator('canvas.excalidraw__canvas.interactive')
    await expect(excalidrawCanvas).toBeVisible()
    await page.getByRole('button', { name: '关闭并返回画布' }).click()

    await mainWindow.evaluate((win, request) => {
      win.webContents.send('canvas:command', request)
    }, {
      requestId: `e2e-connect-${Date.now()}`,
      projectId: currentProjectId,
      action: 'connect-nodes',
      payload: { connections: [{ source: sourceId!, target: editorId! }] },
    })

    await expect(openEditorButton).toBeEnabled()
    await openEditorButton.click()
    await expect(page.getByText(/Excalidraw 自由画板 · 已载入 1 张连接素材/)).toBeVisible()
    await expect(page.getByRole('button', { name: '保存编辑结果' })).toHaveCount(0)

    excalidrawCanvas = page.locator('canvas.excalidraw__canvas.interactive')
    await expect(excalidrawCanvas).toBeVisible()
    canvasBox = await excalidrawCanvas.boundingBox()
    expect(canvasBox).not.toBeNull()
    const center = { x: canvasBox!.width / 2, y: canvasBox!.height / 2 }
    await excalidrawCanvas.click({ position: center })
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(100)
    await page.mouse.click(canvasBox!.x + center.x, canvasBox!.y + center.y, { button: 'right' })
    const exportButton = page.getByRole('button', { name: /导出所选素材/ })
    await expect(exportButton).toBeEnabled()
    await exportButton.click()
    await expect(page.getByText(/已导出 \d+ 个素材，并在外部画布创建图片节点/)).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: '关闭并返回画布' }).click()

    await expect(page.getByText(/画板节点 \d+ · 导出 1/)).toBeVisible()
    const exportedFiles = await fs.readdir(path.join(testWorkspaceDir, 'generated', 'image-edits'))
    expect(exportedFiles.some((file) => file.endsWith('.png'))).toBe(true)
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
