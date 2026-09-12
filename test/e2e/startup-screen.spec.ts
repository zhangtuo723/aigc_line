import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '../..')

test('startup screen paints, handles slow startup, and leaves after the real UI is ready', async () => {
  test.setTimeout(60000)
  const folder = path.join(root, 'test-results', `startup-${randomUUID()}`)
  await fs.mkdir(folder, { recursive: true })
  await fs.mkdir(path.join(root, 'test/screenshots'), { recursive: true })
  // A renderer with no ready signal exercises the actual bundled preload in isolation.
  await fs.writeFile(path.join(folder, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><title>Startup fixture</title></head><body style="margin:0;background:#0a0a0f"><main>Renderer fixture</main></body></html>')
  await fs.copyFile(path.join(root, 'dist/app-icon.png'), path.join(folder, 'app-icon.png'))
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root })
  try {
    const home = await app.firstWindow()
    await expect(home.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible()
    await expect(home.locator('.aigc-startup')).toHaveCount(0)
    const nextWindow = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, { root, folder }) => {
      const win = new BrowserWindow({
        width: 1440, height: 900, show: false,
        webPreferences: { preload: `${root}/dist-electron/preload/index.mjs` },
      })
      await win.loadFile(`${folder}/index.html`)
    }, { root, folder })
    const page = await nextWindow
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole('status')).toHaveText('正在启动创作空间')
    await expect.poll(() => page.locator('.aigc-startup__icon').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await page.screenshot({ path: 'test/screenshots/startup-wide.png' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 360, height: 640 })
    expect(await page.locator('.aigc-startup__track').evaluate(el => getComputedStyle(el, '::after').animationName)).toBe('none')
    const content = await page.locator('.aigc-startup__content').boundingBox()
    expect(content!.x).toBeGreaterThanOrEqual(0)
    expect(content!.x + content!.width).toBeLessThanOrEqual(360)
    await page.screenshot({ path: 'test/screenshots/startup-narrow.png' })
    await page.evaluate(() => { window.postMessage(null, '*'); window.postMessage({ other: true }, '*') })
    // It must not disappear after the old arbitrary five-second timeout.
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('status')).toContainText('启动时间较长')
    await page.getByRole('button', { name: '重新加载' }).click()
    await expect(page.getByRole('status')).toHaveText('正在启动创作空间')
    await expect(page.getByRole('button', { name: '重新加载' })).toBeHidden()
    await page.evaluate(() => window.postMessage({ payload: 'removeLoading' }, '*'))
    await expect(page.locator('.aigc-startup')).toHaveCount(0)
    await expect(page.locator('#app-loading-style')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
