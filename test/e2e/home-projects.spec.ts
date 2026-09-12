import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '../..')
const launch = (folder: string) => electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root })

test('startup restores an open project, but respects an explicit close across app restarts', async () => {
  const folder = path.join(root, 'test-results', `home-restore-${randomUUID()}`)
  await fs.mkdir(folder, { recursive: true })
  let app: ElectronApplication = await launch(folder)
  try {
    let page = await app.firstWindow()
    await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor()
    const project = await page.evaluate(async (folder) => {
      const project = await window.electronAPI.createProject('恢复行为测试', folder, { provider: 'codex', model: '' })
      await window.electronAPI.loadProject(project.id)
      return project
    }, folder)
    await page.reload()
    await page.getByTitle('添加图片节点').waitFor()
    await app.close()

    app = await launch(folder)
    page = await app.firstWindow()
    await page.getByTitle('添加图片节点').click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor()
    expect((await page.evaluate(() => window.electronAPI.listProjects())).lastOpenedId).toBeUndefined()
    await app.close()

    app = await launch(folder)
    page = await app.firstWindow()
    await page.getByRole('button', { name: '打开项目 恢复行为测试', exact: true }).waitFor()
    await expect(page.getByTitle('添加图片节点')).toHaveCount(0)
    await page.getByRole('button', { name: '打开项目 恢复行为测试', exact: true }).press('Enter')
    await page.getByTitle('添加图片节点').waitFor()
    expect((await page.evaluate(() => window.electronAPI.listProjects())).lastOpenedId).toBe(project.id)
    const saved = await page.evaluate(folder => window.electronAPI.loadCanvasSnapshot(folder), folder) as { nodes: unknown[] }
    expect(saved.nodes).toHaveLength(1)
  } finally { await app.close() }
})

test('project library uses wide and narrow space, supports search, sort and keyboard deletion', async () => {
  const folder = path.join(root, 'test-results', `home-layout-${randomUUID()}`)
  await fs.mkdir(folder, { recursive: true })
  const app = await launch(folder)
  try {
    const page = await app.firstWindow()
    await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor()
    const names = ['扎心小故事', '上岸第一剑', '房本写名', '情侣剧本', '白狗血', '15年', '错位的心', '吵架版本', '百万撤离', '大起大落', '都市剧本', '对白戏', '爱恨和面包']
    for (let index = 0; index < 26; index++) {
      const projectFolder = path.join(folder, `project-${index}`)
      await fs.mkdir(projectFolder)
      await page.evaluate(async ({ name, projectFolder, index }) => {
        await window.electronAPI.createProject(name, projectFolder, { provider: index % 3 ? 'claude-code' : 'codex', model: index % 3 ? '' : 'custom-model-with-a-long-name' })
      }, { name: `${names[index % names.length]} ${String(index + 1).padStart(2, '0')}`, projectFolder, index })
    }
    await page.reload()
    await expect(page.getByRole('article')).toHaveCount(26)
    await page.setViewportSize({ width: 2560, height: 1392 })
    const grid = page.getByLabel('项目列表', { exact: true })
    expect((await grid.boundingBox())!.width).toBeGreaterThan(1700)
    await expect(page.getByRole('article').first()).toContainText('爱恨和面包 26')
    await page.screenshot({ path: 'test/screenshots/home-redesign-wide.png' })
    await page.getByLabel('搜索项目', { exact: true }).fill('CODEx')
    await expect(page.getByRole('article')).toHaveCount(9)
    await page.getByLabel('搜索项目', { exact: true }).fill('不存在的项目')
    await expect(page.getByText('没有找到匹配的项目')).toBeVisible()
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await page.getByLabel('项目排序', { exact: true }).selectOption('name')
    const displayed = await page.getByRole('article').getByRole('heading').allTextContents()
    expect(displayed).toEqual([...displayed].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })))
    await page.setViewportSize({ width: 1024, height: 768 })
    expect(await page.locator('main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: 'test/screenshots/home-redesign-narrow.png' })
    await page.getByLabel('搜索项目', { exact: true }).fill('爱恨和面包 26')
    await page.getByRole('button', { name: '删除项目 爱恨和面包 26', exact: true }).press('Enter')
    await expect(page.getByRole('article')).toHaveCount(0)
    expect((await page.evaluate(() => window.electronAPI.listProjects())).lastOpenedId).toBeUndefined()
    await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible()
  } finally { await app.close() }
})
