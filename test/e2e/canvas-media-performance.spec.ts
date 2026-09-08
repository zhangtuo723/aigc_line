import { test, expect, _electron as electron, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CanvasEdgeSnapshot, CanvasNodeSnapshot } from '../../src/shared/ipc.types'

const root = path.resolve(import.meta.dirname, '../..')

async function createMediaFixture(page: Page, folder: string) {
  // Exercise the real workspace protocol and Chromium decoders with local media.
  // No external media, remote services, ffmpeg installation, or user files are needed.
  const media = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 2560
    canvas.height = 1440
    const context = canvas.getContext('2d')!
    context.fillStyle = '#d4af37'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#15304b'
    context.fillRect(100, 100, 1000, 1000)
    const image = canvas.toDataURL('image/png').split(',')[1]

    canvas.width = 320
    canvas.height = 180
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    const chunks: BlobPart[] = []
    recorder.addEventListener('dataavailable', (event) => chunks.push(event.data))
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: 'video/webm' })), { once: true })
      recorder.addEventListener('error', () => reject(new Error('Unable to record the video fixture')), { once: true })
    })
    let frame = 0
    const draw = () => {
      context.fillStyle = '#15304b'
      context.fillRect(0, 0, 320, 180)
      context.fillStyle = '#d4af37'
      context.fillRect((frame++ * 8) % 240, 30, 80, 120)
    }
    draw()
    recorder.start()
    const interval = setInterval(draw, 100)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    clearInterval(interval)
    recorder.stop()
    const blob = await finished
    stream.getTracks().forEach((track) => track.stop())
    return { image, video: Array.from(new Uint8Array(await blob.arrayBuffer())) }
  })
  const uploads = path.join(folder, 'uploads')
  await fs.mkdir(uploads, { recursive: true })
  await fs.writeFile(path.join(uploads, 'large-image.png'), Buffer.from(media.image, 'base64'))
  await fs.writeFile(path.join(uploads, 'clip.webm'), Buffer.from(media.video))
  await fs.writeFile(path.join(uploads, 'broken.webm'), 'This is intentionally not a video.')
}

function mediaNodes(): CanvasNodeSnapshot[] {
  const items = [
    { id: 'large-image', kind: 'image' as const, title: 'Large image', sourcePath: 'uploads/large-image.png' },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `video-${index}`, kind: 'video' as const, title: `Video ${index}`, sourcePath: 'uploads/clip.webm',
    })),
    { id: 'upscale', kind: 'upscale' as const, title: 'Upscaled video', sourcePath: 'uploads/clip.webm' },
    { id: 'broken-video', kind: 'video' as const, title: 'Broken video', sourcePath: 'uploads/broken.webm' },
  ]
  return items.map(({ id, ...data }, index) => ({
    id,
    type: 'storyNode',
    position: { x: (index % 4) * 700, y: Math.floor(index / 4) * 430 },
    data: {
      ...data, aspectRatio: '16:9', generationStatus: 'idle', generationError: '',
      readOnly: id !== 'video-0', prompt: id === 'video-0' ? 'Original camera movement' : '',
    },
  }))
}

async function savedCanvas(page: Page, folder: string) {
  return page.evaluate((folder) => window.electronAPI.loadCanvasSnapshot(folder), folder) as Promise<{
    nodes: CanvasNodeSnapshot[]; edges: CanvasEdgeSnapshot[]
  }>
}

async function expectPreviewWhilePointerHeld(node: Locator, width: number) {
  // Observe actual painted DOM for longer than the idle debounce while the real
  // mouse button remains down. This catches an upgrade triggered merely by
  // pausing movement, as well as a blank image during the quality handoff.
  const observations = await node.evaluate(async (element) => {
    const widths = new Set<number>()
    let missingFrames = 0
    const start = performance.now()
    do {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const images = Array.from(element.querySelectorAll('img'))
        .filter((image) => !image.closest('[aria-hidden="true"]'))
      if (images.length !== 1) missingFrames++
      for (const image of images) widths.add(image.naturalWidth)
    } while (performance.now() - start < 400)
    return { widths: [...widths], missingFrames }
  })
  expect(observations).toEqual({ widths: [width], missingFrames: 0 })
}

async function expectBackgroundTracksViewport(page: Page) {
  const background = page.getByTestId('rf__background')
  await expect(background).toHaveCSS('background-image', /radial-gradient/)
  await expect.poll(() => background.evaluate((element) => {
    const viewport = element.closest('.react-flow')!.querySelector('.react-flow__viewport')!
    const transform = new DOMMatrixReadOnly(getComputedStyle(viewport).transform)
    const style = getComputedStyle(element)
    const [width, height] = style.backgroundSize.split(' ').map(Number.parseFloat)
    const [x, y] = style.backgroundPosition.split(' ').map(Number.parseFloat)
    const gap = 18 * transform.a
    return Math.max(Math.abs(width - gap), Math.abs(height - gap),
      Math.abs(x - (transform.e % gap - gap / 2)), Math.abs(y - (transform.f % gap - gap / 2)))
  })).toBeLessThan(0.02)
}

async function openPlayer(node: Locator) {
  await node.getByRole('button', { name: /^播放视频：/ }).click()
  const video = node.locator('video')
  await expect(video).toHaveCount(1)
  // Keep a short fixture from naturally ending while checking player switches.
  await video.evaluate((element: HTMLVideoElement) => { element.loop = true })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await video.evaluate((element: HTMLVideoElement) => element.pause())
  return (await video.elementHandle())!
}

test('many media cards use posters and one disposable player while editing remains persistent', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const runFolder = path.join(root, 'test-results', `canvas-media-${randomUUID()}`)
  const folder = path.join(runFolder, 'workspace')
  const otherFolder = path.join(runFolder, 'other-workspace')
  await fs.mkdir(folder, { recursive: true })
  await fs.mkdir(otherFolder, { recursive: true })
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${path.join(runFolder, 'profile')}`], cwd: root,
  })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.getByRole('heading', { name: 'AIGC CANVAS', exact: true }).waitFor()
    await createMediaFixture(page, folder)
    const nodes = mediaNodes()
    await page.evaluate(async ({ folder, otherFolder, nodes }) => {
      const project = await window.electronAPI.createProject('Many media', folder, { provider: 'codex', model: '' })
      await window.electronAPI.createProject('Other media workspace', otherFolder, { provider: 'codex', model: '' })
      await window.electronAPI.saveCanvasSnapshot(folder, {
        type: 'react-flow', version: 4,
        nodes: nodes.map((node) => ({ ...node, data: { ...node.data, preview: `workspace://${project.id}/${node.data.sourcePath}` } })),
        edges: nodes.filter((node) => node.data.kind === 'video').map((node) => ({ id: `ref-${node.id}`, source: 'large-image', target: node.id })),
        viewport: { x: 80, y: 40, zoom: 0.3 },
      })
      await window.electronAPI.loadProject(project.id)
    }, { folder, otherFolder, nodes })
    await page.reload()
    await page.getByTitle('添加图片节点').waitFor()
    await page.getByRole('button', { name: '收起聊天', exact: true }).click()
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
    const first = node('video-0')
    const second = node('video-1')
    const image = node('large-image').getByRole('img', { name: 'Large image', exact: true })
    await expect(page.locator('.react-flow__node')).toHaveCount(nodes.length)
    await expect(page.locator('video')).toHaveCount(0)
    await expect.poll(() => first.locator('img').evaluateAll((images: HTMLImageElement[]) => images.map((image) => image.naturalWidth)), { timeout: 20_000 }).toEqual([320])
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(640)
    await expectBackgroundTracksViewport(page)
    await page.screenshot({ path: testInfo.outputPath('many-media-posters.png') })

    // Clipping the painted curve must preserve its ordinary hit area, selection,
    // deletion, and undo behavior. Click a real point on the rendered SVG path.
    const edgePoint = await page.locator('.react-flow__edge-path').evaluateAll((elements: SVGPathElement[]) => {
      for (const element of elements) {
        const id = element.closest('.react-flow__edge')!.getAttribute('data-id')!
        for (const fraction of [0.5, 0.25, 0.75, 0.1, 0.9]) {
          const point = element.getPointAtLength(element.getTotalLength() * fraction).matrixTransform(element.getScreenCTM()!)
          // Multiple reference curves can overlap. Use a real unobstructed hit
          // point rather than force-clicking through another curve or a card.
          const hit = document.elementFromPoint(point.x, point.y)?.closest('.react-flow__edge')
          if (hit?.getAttribute('data-id') === id) return { id, x: point.x, y: point.y }
        }
      }
      throw new Error('No visible reference curve has an unobstructed hit area')
    })
    const referenceEdge = page.locator(`.react-flow__edge[data-id="${edgePoint.id}"]`)
    await page.mouse.click(edgePoint.x, edgePoint.y)
    await expect(referenceEdge).toHaveClass(/selected/)
    await page.keyboard.press('Delete')
    await expect(referenceEdge).toHaveCount(0)
    await expect.poll(async () => (await savedCanvas(page, folder)).edges.some((edge) => edge.id === edgePoint.id)).toBe(false)
    await page.getByRole('button', { name: '撤销画布修改', exact: true }).click()
    await expect(referenceEdge).toHaveCount(1)
    await expect.poll(async () => (await savedCanvas(page, folder)).edges.filter((edge) => edge.id === edgePoint.id)).toHaveLength(1)
    expect((await savedCanvas(page, folder)).nodes).toHaveLength(nodes.length)

    const oldPlayer = await openPlayer(first)
    await expect(page.locator('video')).toHaveCount(1)
    const nextPlayer = await openPlayer(second)
    await expect(page.locator('video')).toHaveCount(1)
    await expect.poll(() => oldPlayer.evaluate((element: HTMLVideoElement) => ({
      attached: element.isConnected, src: element.getAttribute('src'), paused: element.paused,
    }))).toEqual({ attached: false, src: null, paused: true })
    await second.getByRole('button', { name: '收起视频', exact: true }).click()
    await expect(page.locator('video')).toHaveCount(0)
    expect(await nextPlayer.evaluate((element: HTMLVideoElement) => element.getAttribute('src'))).toBeNull()
    await openPlayer(node('upscale'))
    await expect(page.locator('video')).toHaveCount(1)
    await node('upscale').getByRole('button', { name: '收起视频', exact: true }).click()

    // Playback errors must not overwrite a successful generation or its output path.
    await node('broken-video').getByRole('button', { name: '播放视频：Broken video', exact: true }).click()
    await expect(node('broken-video').getByRole('alert')).toContainText('视频加载失败')
    await expect(page.locator('video')).toHaveCount(0)

    // Selecting as part of a real node drag must keep the decoded thumbnail
    // throughout the gesture, including a pause with the button still held.
    const imageTitle = (await node('large-image').getByText('Large image', { exact: true }).boundingBox())!
    await page.mouse.move(imageTitle.x + imageTitle.width / 2, imageTitle.y + imageTitle.height / 2)
    await page.mouse.down()
    await page.mouse.move(imageTitle.x + imageTitle.width / 2 + 25, imageTitle.y + imageTitle.height / 2 + 15, { steps: 8 })
    await expect(node('large-image')).toHaveClass(/dragging/)
    await expectPreviewWhilePointerHeld(node('large-image'), 640)
    await page.mouse.up()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(2560)
    await page.getByRole('button', { name: '撤销画布修改', exact: true }).click()
    await expect.poll(async () => (await savedCanvas(page, folder)).nodes.find((item) => item.id === 'large-image')!.position)
      .toEqual(nodes.find((item) => item.id === 'large-image')!.position)
    await first.getByText('Video 0', { exact: true }).click()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(640)
    await expect(node('large-image')).not.toHaveClass(/selected/)

    // Cross the image quality threshold during a held pan. Wheel completion
    // alone must not schedule expensive pixels before the pan is released.
    const imageBounds = (await image.boundingBox())!
    await page.mouse.move(imageBounds.x + imageBounds.width / 2, imageBounds.y + imageBounds.height / 2)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(imageBounds.x + imageBounds.width / 2 + 10, imageBounds.y + imageBounds.height / 2 + 10, { steps: 4 })
    const imageScreenWidth = () => page.locator('.react-flow__viewport').evaluate((element) => {
      const zoom = new DOMMatrixReadOnly(getComputedStyle(element).transform).a
      return 620 * zoom * window.devicePixelRatio
    })
    for (let step = 0; step < 6 && await imageScreenWidth() <= 640; step++) {
      const before = await imageScreenWidth()
      await page.mouse.wheel(0, -350)
      await expect.poll(imageScreenWidth).toBeGreaterThan(before)
    }
    expect(await imageScreenWidth()).toBeGreaterThan(640)
    await expectPreviewWhilePointerHeld(node('large-image'), 640)
    await expectBackgroundTracksViewport(page)
    await page.mouse.up({ button: 'middle' })
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1280)
    await page.screenshot({ path: testInfo.outputPath('zoomed-media-detail.png') })
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(640)
    await expectBackgroundTracksViewport(page)

    // The selected editable node must retain prompt content across node position
    // updates, save the drag, and undo the position without undoing the prompt.
    await first.getByText('Video 0', { exact: true }).click()
    const prompt = first.locator('textarea')
    await expect(prompt).toHaveValue('Original camera movement')
    const editedPrompt = 'A slow dolly toward the character, preserving the reference image.'
    await prompt.fill(editedPrompt)
    await expect.poll(async () => (await savedCanvas(page, folder)).nodes.find((item) => item.id === 'video-0')!.data.prompt)
      .toBe(editedPrompt)
    const originalPosition = nodes.find((item) => item.id === 'video-0')!.position
    const titleBox = (await first.getByText('Video 0', { exact: true }).boundingBox())!
    await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(titleBox.x + titleBox.width / 2 + 50, titleBox.y + titleBox.height / 2 + 35, { steps: 12 })
    await expect(first).toHaveClass(/dragging/)
    await expect(prompt).toHaveValue(editedPrompt)
    await page.mouse.up()
    await expect.poll(async () => (await savedCanvas(page, folder)).nodes.find((item) => item.id === 'video-0')!.position)
      .not.toEqual(originalPosition)
    await page.getByRole('button', { name: '撤销画布修改', exact: true }).click()
    await expect.poll(async () => (await savedCanvas(page, folder)).nodes.find((item) => item.id === 'video-0')!.position)
      .toEqual(originalPosition)
    await expect(prompt).toHaveValue(editedPrompt)
    expect((await savedCanvas(page, folder)).nodes.find((item) => item.id === 'video-0')!.data.prompt).toBe(editedPrompt)
    expect((await savedCanvas(page, folder)).nodes.find((item) => item.id === 'broken-video')!.data)
      .toMatchObject({ generationStatus: 'idle', generationError: '', sourcePath: 'uploads/broken.webm' })

    const removedPlayer = await openPlayer(first)
    await first.getByTitle('从画布删除', { exact: true }).click()
    await expect(first).toHaveCount(0)
    await expect(page.locator('video')).toHaveCount(0)
    expect(await removedPlayer.evaluate((element: HTMLVideoElement) => element.getAttribute('src'))).toBeNull()
    await page.getByRole('button', { name: '撤销画布修改', exact: true }).click()
    await expect(first).toHaveCount(1)
    await expect(first.locator('video')).toHaveCount(0)

    const hiddenPlayer = await openPlayer(first)
    const bounds = (await page.locator('.react-flow').boundingBox())!
    await page.mouse.move(bounds.x + bounds.width - 40, bounds.y + bounds.height / 2)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(bounds.x + 40, bounds.y + bounds.height / 2, { steps: 20 })
    await page.mouse.up({ button: 'middle' })
    await expectBackgroundTracksViewport(page)
    await expect(page.locator('video')).toHaveCount(0)
    expect(await hiddenPlayer.evaluate((element: HTMLVideoElement) => element.getAttribute('src'))).toBeNull()
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await expect(first.getByRole('button', { name: '播放视频：Video 0', exact: true })).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)

    const projectPlayer = await openPlayer(first)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('heading', { name: 'Other media workspace', exact: true }).click()
    await page.getByTitle('添加图片节点').waitFor()
    await expect(page.locator('video')).toHaveCount(0)
    expect(await projectPlayer.evaluate((element: HTMLVideoElement) => element.getAttribute('src'))).toBeNull()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('heading', { name: 'Many media', exact: true }).click()
    await expect(first.getByRole('button', { name: '播放视频：Video 0', exact: true })).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)
    expect((await savedCanvas(page, folder)).nodes.find((item) => item.id === 'broken-video')!.data.generationStatus).toBe('idle')
  } finally {
    await app.close()
  }
})
