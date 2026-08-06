import { app, BrowserWindow, shell, ipcMain, nativeTheme, protocol, net } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { update } from './update'
import { registerProjectHandlers } from './ipc/project.handlers'
import { registerChatHandlers } from './ipc/chat.handlers'
import { registerCanvasHandlers } from './ipc/canvas.handlers'
import { registerArtifactHandlers } from './ipc/artifact.handlers'
import { registerComfyUIHandlers } from './ipc/comfyui.handlers'
import { registerSettingsHandlers } from './ipc/settings.handlers'
import { loadProject } from './services/project.store'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (process.platform === 'win32' && os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

// Dark native window chrome (title bar, borders, dialogs)
nativeTheme.themeSource = 'dark'

// Custom scheme so the renderer can display local images (thumbnails, previews).
// file:// is blocked when the page is served from the Vite dev server.
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, supportFetchAPI: true, stream: true } },
  // Per-project static file access for HTML artifacts: workspace://<projectId>/<rel-path>
  {
    scheme: 'workspace',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

const LOCAL_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif',
])

// Extensions servable from a project workspace (HTML artifact subresources)
const WORKSPACE_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif', '.ico',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac',
  '.woff', '.woff2', '.ttf', '.otf',
  '.css', '.js', '.mjs', '.json', '.txt', '.md', '.csv', '.srt', '.vtt', '.xml',
  '.html', '.htm', '.pdf',
])

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
}

async function serveWorkspaceVideo(request: Request, filePath: string): Promise<Response> {
  const stat = await fs.stat(filePath)
  const contentType = VIDEO_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const range = request.headers.get('range')
  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  }
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...commonHeaders, 'Content-Length': String(stat.size) },
    })
  }
  if (!range) {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
    return new Response(stream, {
      status: 200,
      headers: { ...commonHeaders, 'Content-Length': String(stat.size) },
    })
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` },
    })
  }
  const requestedStart = match[1] ? Number(match[1]) : undefined
  const requestedEnd = match[2] ? Number(match[2]) : undefined
  let start = requestedStart ?? Math.max(0, stat.size - (requestedEnd ?? 0))
  let end = requestedStart === undefined
    ? stat.size - 1
    : Math.min(requestedEnd ?? stat.size - 1, stat.size - 1)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= stat.size || end < start) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` },
    })
  }
  const length = end - start + 1
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>
  return new Response(stream, {
    status: 206,
    headers: {
      ...commonHeaders,
      'Content-Length': String(length),
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    },
  })
}

function registerLocalFileProtocol() {
  protocol.handle('local-file', (request) => {
    let filePath = decodeURIComponent(new URL(request.url).pathname)
    if (process.platform === 'win32') filePath = filePath.replace(/^\/+/, '')
    // Only serve common image formats to avoid exposing arbitrary file reads
    if (!LOCAL_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

/**
 * Read-only static access scoped to a project workspace. Relative URLs inside
 * HTML artifacts resolve against workspace://<projectId>/ via an injected
 * <base> tag, so agents can reference files with plain relative paths.
 */
function registerWorkspaceProtocol() {
  protocol.handle('workspace', async (request) => {
    try {
      const url = new URL(request.url)
      const project = await loadProject(url.host)
      if (!project) {
        return new Response('Unknown project', { status: 404 })
      }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      // Never expose app-internal state (chat history, sessions, ...)
      if (rel === '.aigc-line' || rel.startsWith('.aigc-line/')) {
        return new Response('Forbidden', { status: 403 })
      }
      const root = path.resolve(project.folderPath)
      const filePath = path.resolve(root, rel)
      // Reject paths that escape the workspace
      if (!filePath.startsWith(root + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      if (!WORKSPACE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return new Response('Forbidden', { status: 403 })
      }
      if (path.extname(filePath).toLowerCase() in VIDEO_CONTENT_TYPES) {
        return serveWorkspaceVideo(request, filePath)
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (err) {
      return new Response('Not found', { status: 404 })
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

registerProjectHandlers()
registerChatHandlers()
registerCanvasHandlers()
registerArtifactHandlers()
registerComfyUIHandlers()
registerSettingsHandlers()

async function createWindow() {
  win = new BrowserWindow({
    title: 'AIGC CANVAS',
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    // Vertically center the macOS traffic lights in the 40px custom title bar
    trafficLightPosition: { x: 12, y: 13 },
    titleBarOverlay: {
      color: '#0a0a0f',
      symbolColor: '#e8c766',
      height: 40,
    },
    width: 1400,
    height: 900,
    icon: path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  win.maximize()

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
    // Forward renderer console messages to the main process log (dev only)
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const tag = ['verbose', 'info', 'warning', 'error'][level] ?? String(level)
      console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`)
    })
  } else {
    win.loadFile(indexHtml)
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Auto update
  update(win)
}

app.whenReady().then(() => {
  registerLocalFileProtocol()
  registerWorkspaceProtocol()
  createWindow()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})
