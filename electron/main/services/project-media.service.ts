import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProjectMediaAsset, ProjectMediaKind } from '../../../src/shared/ipc.types'
import { loadProject } from './project.store'

const MEDIA_KIND_BY_EXTENSION: Record<string, ProjectMediaKind> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.avif': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  '.aac': 'audio',
}

const uploadDirectoryFor = (kind: ProjectMediaKind): string => (
  kind === 'image' ? 'images' : kind === 'video' ? 'videos' : 'audio'
)

const toRelativePath = (projectRoot: string, filePath: string): string => (
  path.relative(projectRoot, filePath).split(path.sep).join('/')
)

const mediaKindFor = (filePath: string): ProjectMediaKind | undefined => (
  MEDIA_KIND_BY_EXTENSION[path.extname(filePath).toLowerCase()]
)

const safeFileBase = (filePath: string): string => {
  const extension = path.extname(filePath)
  return path.basename(filePath, extension)
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .slice(0, 80) || 'media'
}

const safeGeneratedName = (value: string): string => (
  value.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'shot'
)

const validatePng = (pngData: ArrayBuffer, label: string): { data: Buffer; width: number; height: number } => {
  const data = Buffer.from(pngData)
  if (data.byteLength < 8 || data.byteLength > 50 * 1024 * 1024) throw new Error(`${label}大小无效`)
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!data.subarray(0, 8).equals(pngSignature)) throw new Error(`${label}不是有效的 PNG 文件`)
  if (data.byteLength < 33 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${label}缺少有效的 PNG 头`)
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error(`${label}尺寸无效`)
  if (data.lastIndexOf(Buffer.from('IEND')) < 0) throw new Error(`${label}数据不完整`)
  return { data, width, height }
}

export async function saveDirectorStill(
  projectId: string,
  nodeId: string,
  shotId: string,
  shotName: string,
  pngData: ArrayBuffer,
): Promise<string> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const { data } = validatePng(pngData, '导演台截图')

  const destinationDir = path.join(project.folderPath, 'generated', 'director-stills')
  await fs.mkdir(destinationDir, { recursive: true })
  const destinationPath = path.join(
    destinationDir,
    `${Date.now()}-${randomUUID().slice(0, 8)}-${safeGeneratedName(nodeId)}-${safeGeneratedName(shotId)}-${safeGeneratedName(shotName)}.png`,
  )
  await fs.writeFile(destinationPath, data, { flag: 'wx' })
  return toRelativePath(project.folderPath, destinationPath)
}

export async function saveImageEdit(
  projectId: string,
  nodeId: string,
  inputNodeId: string | undefined,
  pngData: ArrayBuffer,
  expectedWidth: number,
  expectedHeight: number,
): Promise<string> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const { data, width, height } = validatePng(pngData, '图片编辑结果')
  if (width !== Math.floor(expectedWidth) || height !== Math.floor(expectedHeight)) {
    throw new Error('图片编辑结果尺寸与编辑画布不一致')
  }
  const destinationDir = path.join(project.folderPath, 'generated', 'image-edits')
  await fs.mkdir(destinationDir, { recursive: true })
  const destinationPath = path.join(
    destinationDir,
    `${Date.now()}-${randomUUID().slice(0, 8)}-${safeGeneratedName(nodeId)}-${safeGeneratedName(inputNodeId ?? 'blank-board')}.png`,
  )
  await fs.writeFile(destinationPath, data, { flag: 'wx' })
  return toRelativePath(project.folderPath, destinationPath)
}

export async function saveBoardPreview(
  projectId: string,
  nodeId: string,
  pngData: ArrayBuffer,
  expectedWidth: number,
  expectedHeight: number,
): Promise<string> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const { data, width, height } = validatePng(pngData, '画板预览')
  if (width !== Math.floor(expectedWidth) || height !== Math.floor(expectedHeight)) {
    throw new Error('画板预览尺寸与截图画布不一致')
  }
  const destinationDir = path.join(project.folderPath, '.aigc-line', 'board-previews')
  await fs.mkdir(destinationDir, { recursive: true })
  const destinationPath = path.join(destinationDir, `${safeGeneratedName(nodeId)}.png`)
  await fs.writeFile(destinationPath, data)
  return toRelativePath(project.folderPath, destinationPath)
}

export async function saveDirectorVideo(
  projectId: string,
  nodeId: string,
  shotId: string,
  shotName: string,
  webmData: ArrayBuffer,
): Promise<string> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  const data = Buffer.from(webmData)
  if (data.byteLength < 16 || data.byteLength > 500 * 1024 * 1024) {
    throw new Error('导演台预演视频大小无效')
  }
  const webmSignature = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
  if (!data.subarray(0, 4).equals(webmSignature)) {
    throw new Error('导演台预演视频不是有效的 WebM 文件')
  }
  if (!data.subarray(0, Math.min(data.length, 4096)).includes(Buffer.from('webm'))) {
    throw new Error('导演台预演视频缺少 WebM 文档头')
  }

  const destinationDir = path.join(project.folderPath, 'generated', 'director-videos')
  await fs.mkdir(destinationDir, { recursive: true })
  const destinationPath = path.join(
    destinationDir,
    `${Date.now()}-${randomUUID().slice(0, 8)}-${safeGeneratedName(nodeId)}-${safeGeneratedName(shotId)}-${safeGeneratedName(shotName)}.webm`,
  )
  await fs.writeFile(destinationPath, data, { flag: 'wx' })
  return toRelativePath(project.folderPath, destinationPath)
}

export async function importProjectMediaFiles(
  projectId: string,
  sourcePaths: readonly string[],
): Promise<ProjectMediaAsset[]> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')

  const imported: ProjectMediaAsset[] = []
  for (const [index, sourceValue] of sourcePaths.entries()) {
    const sourcePath = path.resolve(sourceValue)
    const kind = mediaKindFor(sourcePath)
    if (!kind) throw new Error(`不支持的媒体格式：${path.basename(sourcePath)}`)
    const extension = path.extname(sourcePath).toLowerCase()
    const destinationDir = path.join(project.folderPath, 'uploads', uploadDirectoryFor(kind))
    await fs.mkdir(destinationDir, { recursive: true })
    const destinationPath = path.join(
      destinationDir,
      `${Date.now()}-${index}-${safeFileBase(sourcePath)}${extension}`,
    )
    await fs.copyFile(sourcePath, destinationPath)
    const stat = await fs.stat(destinationPath)
    imported.push({
      kind,
      name: path.basename(sourcePath),
      relativePath: toRelativePath(project.folderPath, destinationPath),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
    })
  }
  return imported
}

async function collectMediaFiles(
  projectRoot: string,
  directory: string,
  assets: ProjectMediaAsset[],
): Promise<void> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(directory, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectMediaFiles(projectRoot, filePath, assets)
      continue
    }
    if (!entry.isFile()) continue
    const kind = mediaKindFor(filePath)
    if (!kind) continue
    const stat = await fs.stat(filePath)
    assets.push({
      kind,
      name: entry.name,
      relativePath: toRelativePath(projectRoot, filePath),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
    })
  }
}

export async function listProjectMediaAssets(projectId: string): Promise<ProjectMediaAsset[]> {
  const project = await loadProject(projectId)
  if (!project) throw new Error('项目不存在或已被删除')
  return listProjectMediaAssetsAtRoot(project.folderPath)
}

export async function listProjectMediaAssetsAtRoot(projectFolderPath: string): Promise<ProjectMediaAsset[]> {
  const root = path.resolve(projectFolderPath)
  const assets: ProjectMediaAsset[] = []
  await collectMediaFiles(root, path.join(root, 'generated'), assets)
  await collectMediaFiles(root, path.join(root, 'uploads'), assets)
  return assets.sort((a, b) => b.modifiedAt - a.modifiedAt || a.relativePath.localeCompare(b.relativePath))
}
