import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '../..')
async function workspace(name: string, nodes: unknown[] = [], edges: unknown[] = []) {
  const folder = path.join(root, 'test-results', `workspace-reliability-${randomUUID()}`)
  await fs.mkdir(folder, { recursive: true })
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root })
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'AIGC CANVAS', exact: true }).waitFor()
  const project = await page.evaluate(async ({ folder, name, nodes, edges }) => {
    const project = await window.electronAPI.createProject(name, folder, { provider: 'codex', model: '' })
    await window.electronAPI.saveCanvasSnapshot(folder, { type: 'react-flow', version: 4, nodes, edges })
    await window.electronAPI.loadProject(project.id)
    return project
  }, { folder, name, nodes, edges })
  await page.reload()
  await expect(page.getByText('正在读取画布…', { exact: true })).toHaveCount(0)
  await page.getByTitle('添加图片节点').waitFor()
  return { app, page, folder, project }
}
async function snapshot(page: Page, folder: string) {
  return page.evaluate(folder => window.electronAPI.loadCanvasSnapshot(folder), folder) as Promise<{ nodes: any[]; edges: any[] }>
}
async function close(app: ElectronApplication) { await app.close() }

test('quick navigation saves edits; node placement, undo and narrow layout stay usable', async () => {
  const { app, page, folder } = await workspace('Save reliability')
  try {
    await page.setViewportSize({ width: 1024, height: 768 })
    expect(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    await page.getByTitle('添加图片节点').click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    expect((await snapshot(page, folder)).nodes).toHaveLength(1)
    await page.getByRole('heading', { name: 'Save reliability', exact: true }).click()
    await page.getByTitle('添加图片节点').click()
    await page.getByRole('button', { name: '撤销画布修改', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    expect((await snapshot(page, folder)).nodes).toHaveLength(1)
    await page.getByRole('heading', { name: 'Save reliability', exact: true }).click()
    await page.getByTitle('添加图片节点').click()
    await page.getByRole('button', { name: '撤销画布修改', exact: true }).click()
    await page.getByRole('button', { name: '重做画布修改', exact: true }).click()
    const divider = page.getByRole('separator', { name: '调整画布与聊天区域宽度' })
    await divider.focus()
    for (let i = 0; i < 30; i++) await divider.press('ArrowLeft')
    expect(await page.locator('.react-flow').evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(360)
    await page.getByRole('button', { name: '收起聊天', exact: true }).click()
    expect(await page.locator('.react-flow').evaluate(element => element.clientWidth)).toBe(1024)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const saved = await snapshot(page, folder)
    expect(saved.nodes).toHaveLength(2)
    expect(saved.nodes[0].position).not.toEqual(saved.nodes[1].position)
    await page.getByTitle('系统配置').click()
    await page.getByLabel('ComfyUI HTTP 地址', { exact: true }).fill('http://127.0.0.1:9999')
    await page.getByTitle('返回首页').click()
    await expect(page.getByRole('dialog', { name: '未保存的配置' })).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(page.getByLabel('ComfyUI HTTP 地址', { exact: true })).toHaveValue('http://127.0.0.1:9999')
    await page.getByTitle('返回首页').click()
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  } finally { await close(app) }
})

test('a corrupt canvas remains intact and cannot be overwritten by an empty editor', async () => {
  const { app, page, folder } = await workspace('Corrupt snapshot')
  try {
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const file = path.join(folder, '.aigc-line', 'canvas-snapshot.json')
    await fs.writeFile(file, '{broken-original')
    await page.getByRole('heading', { name: 'Corrupt snapshot', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '画布加载失败' })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    expect(await fs.readFile(file, 'utf8')).toBe('{broken-original')
  } finally { await close(app) }
})

test('native window close flushes the open director draft before saving the canvas', async () => {
  const { app, page, folder } = await workspace('Native close', [
    { id: 'director-close', type: 'storyNode', position: { x: 0, y: 0 }, data: { kind: 'director', title: 'Close test' } },
  ])
  let hasClosed = false
  app.once('close', () => { hasClosed = true })
  try {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await page.getByRole('button', { name: '打开导演台', exact: true }).click()
    await page.getByRole('toolbar', { name: '添加到片场工具栏' }).getByRole('button', { name: '家具', exact: true }).click()
    const library = page.getByRole('region', { name: '片场素材库' })
    const box = (await library.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(1024)
    await page.screenshot({ path: 'test/screenshots/director-narrow.png' })
    await library.getByRole('button', { name: '沙发', exact: true }).click()
    const closed = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0) })
    await closed
    const saved = JSON.parse(await fs.readFile(path.join(folder, '.aigc-line', 'canvas-snapshot.json'), 'utf8'))
    expect(saved.nodes[0].data.directorProject.elements).toHaveLength(1)
    expect(saved.nodes[0].data.directorProject.elements[0].kind).toBe('sofa')
  } finally { if (!hasClosed) await close(app) }
})

test('a missing image preserves board drawing and supports continued editing and saving', async () => {
  const rectangle = { id: 'retained-drawing', type: 'rectangle', x: 30, y: 30, width: 140, height: 90, angle: 0,
    strokeColor: '#ff3b30', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 1,
    opacity: 100, groupIds: [], frameId: null, index: 'a0', roundness: null, seed: 123, version: 1, versionNonce: 123,
    isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false }
  const { app, page, folder } = await workspace('Missing image', [
    { id: 'board', type: 'storyNode', position: { x: 0, y: 0 }, data: { kind: 'image-editor', title: 'Recovery board', boardState: { version: 1, elements: [rectangle], appState: {} } } },
    { id: 'missing', type: 'storyNode', position: { x: 700, y: 0 }, data: { kind: 'image', title: 'Missing image', sourcePath: 'uploads/missing.png' } },
  ], [{ id: 'input', source: 'missing', target: 'board' }])
  try {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await page.getByRole('button', { name: '打开画板', exact: true }).click()
    await expect(page.getByText(/Missing image：未载入/)).toBeVisible()
    const canvas = page.locator('canvas.excalidraw__canvas.interactive')
    await canvas.click({ position: { x: 150, y: 220 } })
    await page.keyboard.press('r')
    const bounds = (await canvas.boundingBox())!
    await page.mouse.move(bounds.x + 300, bounds.y + 300)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 450, bounds.y + 400, { steps: 5 })
    await page.mouse.up()
    await page.getByRole('button', { name: '关闭并返回画布', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const state = (await snapshot(page, folder)).nodes.find(node => node.id === 'board').data.boardState
    expect(state.elements.some((element: any) => element.id === 'retained-drawing' && !element.isDeleted)).toBe(true)
    expect(state.elements.filter((element: any) => element.type === 'rectangle' && !element.isDeleted).length).toBeGreaterThanOrEqual(2)
  } finally { await close(app) }
})

test('completed tasks restore output after reopening and acknowledge only persisted results', async () => {
  const { app, page, folder, project } = await workspace('Task recovery', [
    { id: 'result-image', type: 'storyNode', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Recovered image' } },
  ])
  try {
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await fs.mkdir(path.join(folder, 'generated'), { recursive: true })
    await fs.writeFile(path.join(folder, 'generated', 'recovered.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1kAAAAASUVORK5CYII=', 'base64'))
    const taskDir = path.join(folder, '.aigc-line', 'generation-tasks')
    await fs.mkdir(taskDir, { recursive: true })
    const file = path.join(taskDir, createHash('sha256').update('result-image').digest('hex') + '.json')
    await fs.writeFile(file, JSON.stringify({ version: 1, id: 'recovery-fixture', projectId: project.id, nodeId: 'result-image', provider: 'google', operation: 'image',
      status: 'succeeded', taskId: 'local-fixture', relativePath: 'generated/recovered.png', updatedAt: Date.now(), fingerprint: 'fixture',
      request: { projectId: project.id, nodeId: 'result-image', prompt: 'fixture', aspectRatio: '1:1' } }))
    await page.getByRole('heading', { name: 'Task recovery', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, folder)).nodes[0].data.sourcePath).toBe('generated/recovered.png')
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).acknowledged).toBe(true)
    await page.reload()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const saved = await snapshot(page, folder)
    expect(saved.nodes).toHaveLength(1)
    expect(saved.nodes[0].data.sourceHistory ?? []).toEqual([])
  } finally { await close(app) }
})
