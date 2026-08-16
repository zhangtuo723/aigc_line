import fs from 'node:fs/promises'
import path from 'node:path'
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
