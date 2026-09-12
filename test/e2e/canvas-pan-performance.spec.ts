import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '../..')

test('large pans keep a bounded visible graph, world-aligned dots and unchanged saved node geometry', async ({}, testInfo) => {
  const folder = path.join(root, 'test-results', `canvas-pan-${randomUUID()}`)
  await fs.mkdir(folder, { recursive: true })
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false))
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor()
    const nodes = Array.from({ length: 240 }, (_, index) => ({
      id: `pan-${index}`, type: 'storyNode',
      position: { x: (index % 24) * 740, y: Math.floor(index / 24) * 510 },
      data: { kind: index % 2 ? 'video' : 'image', title: `Pan ${index}`, readOnly: true, aspectRatio: '16:9' },
    }))
    await page.evaluate(async ({ folder, nodes }) => {
      const project = await window.electronAPI.createProject('Large pan', folder, { provider: 'codex', model: '' })
      await window.electronAPI.saveCanvasSnapshot(folder, {
        type: 'react-flow', version: 4, nodes,
        edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: nodes[index].id, target: node.id })),
        viewport: { x: 80, y: 60, zoom: 0.3 },
      })
      await window.electronAPI.loadProject(project.id)
    }, { folder, nodes })
    await page.reload()
    await page.getByTitle('添加图片节点').waitFor()
    await page.getByRole('button', { name: '收起聊天', exact: true }).click()
    await page.locator('.react-flow__node').first().waitFor()
    await expect.poll(() => page.locator('.react-flow__node').count()).toBeLessThan(80)
    const pattern = page.getByTestId('rf__background')
    const originalPattern = await pattern.evaluate(element => ({ image: element.style.backgroundImage, size: element.style.backgroundSize, position: element.style.backgroundPosition }))
    for (let pass = 0; pass < 4; pass++) {
      await page.mouse.move(1450, 820)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(160, 200, { steps: 40 })
      await page.mouse.up({ button: 'middle' })
      // Native culling remains active, rather than making hundreds of offscreen
      // cards participate in drawing and pointer hit tests to avoid remounts.
      await expect.poll(() => page.locator('.react-flow__node').count()).toBeLessThan(80)
    }
    expect(await pattern.evaluate(element => ({ image: element.style.backgroundImage, size: element.style.backgroundSize, position: element.style.backgroundPosition }))).toEqual(originalPattern)
    await expect(pattern).not.toHaveCSS('transform', 'none')
    await expect(page.getByRole('button', { name: '撤销画布修改', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const saved = await page.evaluate(folder => window.electronAPI.loadCanvasSnapshot(folder), folder) as { nodes: typeof nodes; edges: unknown[]; viewport: { x: number; y: number; zoom: number } }
    expect(saved.nodes.map(node => ({ id: node.id, position: node.position }))).toEqual(nodes.map(node => ({ id: node.id, position: node.position })))
    expect(saved.edges).toHaveLength(239)
    expect(saved.viewport.x).toBeCloseTo(80 - 4 * 1290, 0)
    expect(saved.viewport.y).toBeCloseTo(60 - 4 * 620, 0)
    expect(saved.viewport.zoom).toBe(0.3)
    await testInfo.attach('large-pan-result', { body: JSON.stringify({ nodes: saved.nodes.length, edges: saved.edges.length, viewport: saved.viewport }), contentType: 'application/json' })
  } finally { await app.close() }
})
