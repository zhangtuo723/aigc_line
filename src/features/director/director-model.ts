import type {
  DirectorAspectRatio,
  DirectorElement,
  DirectorElementKind,
  DirectorElementState,
  DirectorPoseId,
  DirectorProject,
  DirectorShot,
  DirectorTransform,
  DirectorVec3,
} from '../../shared/director.types'
import { directorProjectSchema } from '../../shared/director-schema'

const clone = <T,>(value: T): T => structuredClone(value)

export const DIRECTOR_ASPECT_RATIOS: DirectorAspectRatio[] = ['16:9', '9:16', '4:3', '1:1']

export interface DirectorCropRect { x: number; y: number; width: number; height: number }

/** Center-crop geometry shared by the on-screen frame and PNG capture. */
export function directorCropRect(width: number, height: number, aspect: DirectorAspectRatio): DirectorCropRect {
  const targetAspect = aspect === '16:9' ? 16 / 9 : aspect === '9:16' ? 9 / 16 : aspect === '4:3' ? 4 / 3 : 1
  const sourceAspect = width / height
  let x = 0
  let y = 0
  let cropWidth = width
  let cropHeight = height
  if (sourceAspect > targetAspect) {
    cropWidth = Math.round(height * targetAspect)
    x = Math.round((width - cropWidth) / 2)
  } else {
    cropHeight = Math.round(width / targetAspect)
    y = Math.round((height - cropHeight) / 2)
  }
  return { x, y, width: cropWidth, height: cropHeight }
}

export const directorId = (prefix: string): string => (
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
)

export const vec3 = (x = 0, y = 0, z = 0): DirectorVec3 => ({ x, y, z })

export const transform = (
  position = vec3(),
  rotation = vec3(),
  scale = vec3(1, 1, 1),
): DirectorTransform => ({ position, rotation, scale })

const elementState = (element: DirectorElement): DirectorElementState => ({
  transform: clone(element.transform),
  visible: element.visible,
  poseId: element.poseId,
})

export function createDirectorElement(kind: DirectorElementKind, index: number): DirectorElement {
  const actorLike = kind === 'actor' || kind === 'crowd'
  const nameByKind: Record<DirectorElementKind, string> = {
    actor: '演员',
    box: '立方体',
    sphere: '球体',
    cylinder: '圆柱体',
    wall: '墙体',
    crowd: '群众阵列',
  }
  const scaleByKind: Partial<Record<DirectorElementKind, DirectorVec3>> = {
    box: vec3(1.5, 0.8, 1.5),
    sphere: vec3(0.8, 0.8, 0.8),
    cylinder: vec3(0.65, 1.2, 0.65),
    wall: vec3(4, 2.4, 0.15),
  }
  const colors = ['#4f8ef7', '#e0524d', '#f2a900', '#12b886', '#9c4dcc', '#00b8d9']
  return {
    id: directorId('element'),
    kind,
    name: `${nameByKind[kind]} ${String(index + 1).padStart(2, '0')}`,
    transform: transform(vec3((index % 4) * 1.4 - 2, 0, Math.floor(index / 4) * 1.6), vec3(), scaleByKind[kind] ?? vec3(1, 1, 1)),
    color: colors[index % colors.length],
    visible: true,
    locked: false,
    poseId: actorLike ? 'stand' : undefined,
    heightM: actorLike ? 1.72 : undefined,
    rows: kind === 'crowd' ? 2 : undefined,
    columns: kind === 'crowd' ? 4 : undefined,
    spacing: kind === 'crowd' ? 1.25 : undefined,
  }
}

export function createDirectorShot(elements: DirectorElement[], index: number): DirectorShot {
  const position = index % 2 === 0 ? vec3(0, 2.3, 7.5) : vec3(4.5, 2, 5.5)
  const target = vec3(0, 1, 0)
  const id = directorId('shot')
  return {
    id,
    name: `镜头 ${String(index + 1).padStart(2, '0')}`,
    durationSec: 5,
    aspectRatio: '16:9',
    position,
    target,
    fov: 45,
    rollDeg: 0,
    cameraMove: 'static',
    cameraKeyframes: [{
      id: directorId('camera-keyframe'),
      frame: 0,
      position: clone(position),
      target: clone(target),
      fov: 45,
      interpolation: 'smooth',
    }],
    elementStates: Object.fromEntries(elements.map((element) => [element.id, elementState(element)])),
    locked: false,
  }
}

export function createDefaultDirectorProject(name = '未命名导演场景'): DirectorProject {
  const elements = [createDirectorElement('actor', 0), createDirectorElement('actor', 1)]
  const shot = createDirectorShot(elements, 0)
  return {
    version: 1,
    fps: 24,
    name,
    backgroundColor: '#10131b',
    groundColor: '#272a31',
    showGround: true,
    showGrid: true,
    elements,
    shots: [shot],
    activeShotId: shot.id,
    updatedAt: Date.now(),
  }
}

export function snapshotElements(elements: DirectorElement[]): Record<string, DirectorElementState> {
  return Object.fromEntries(elements.map((element) => [element.id, elementState(element)]))
}

export function applyShotElementStates(elements: DirectorElement[], shot: DirectorShot): DirectorElement[] {
  return elements.map((element) => {
    const state = shot.elementStates[element.id]
    return state ? {
      ...element,
      transform: clone(state.transform),
      visible: state.visible,
      poseId: state.poseId ?? element.poseId,
    } : element
  })
}

/** Persist the live blocking into the active Shot before any Shot transition or save. */
export function snapshotActiveShot(project: DirectorProject): DirectorProject {
  const active = project.shots.find((shot) => shot.id === project.activeShotId)
  if (!active || active.locked) return project
  return {
    ...project,
    shots: project.shots.map((shot) => shot.id === active.id
      ? { ...shot, elementStates: snapshotElements(project.elements) }
      : shot),
  }
}

export function activateDirectorShot(project: DirectorProject, shotId: string): DirectorProject {
  const committed = snapshotActiveShot(project)
  const target = committed.shots.find((shot) => shot.id === shotId)
  if (!target) return committed
  return {
    ...committed,
    activeShotId: target.id,
    elements: applyShotElementStates(committed.elements, target),
  }
}

export function addDirectorElement(project: DirectorProject, element: DirectorElement): DirectorProject {
  const state = elementState(element)
  return {
    ...project,
    elements: [...project.elements, element],
    shots: project.shots.map((shot) => ({
      ...shot,
      elementStates: { ...shot.elementStates, [element.id]: clone(state) },
    })),
  }
}

export function updateDirectorElement(
  project: DirectorProject,
  next: DirectorElement,
  allowUnlock = false,
): DirectorProject {
  const previous = project.elements.find((element) => element.id === next.id)
  if (!previous || (previous.locked && !(allowUnlock && next.locked === false))) return project
  const elements = project.elements.map((element) => element.id === next.id ? next : element)
  return {
    ...project,
    elements,
    shots: project.shots.map((shot) => shot.id === project.activeShotId && !shot.locked
      ? { ...shot, elementStates: { ...shot.elementStates, [next.id]: elementState(next) } }
      : shot),
  }
}

export function removeDirectorElement(project: DirectorProject, elementId: string): DirectorProject {
  const existing = project.elements.find((element) => element.id === elementId)
  if (!existing || existing.locked) return project
  return {
    ...project,
    elements: project.elements.filter((element) => element.id !== elementId),
    shots: project.shots.map((shot) => {
      const { [elementId]: _removed, ...elementStates } = shot.elementStates
      return { ...shot, elementStates }
    }),
  }
}

export function patchDirectorShot(
  project: DirectorProject,
  shotId: string,
  patch: Partial<DirectorShot>,
): DirectorProject {
  return {
    ...project,
    shots: project.shots.map((shot) => {
      if (shot.id !== shotId || shot.locked) return shot
      const next = { ...shot, ...patch }
      if ('position' in patch || 'target' in patch || 'fov' in patch) {
        const frameZero = next.cameraKeyframes.findIndex((keyframe) => keyframe.frame === 0)
        const synced = {
          id: frameZero >= 0 ? next.cameraKeyframes[frameZero].id : directorId('camera-keyframe'),
          frame: 0,
          position: clone(next.position),
          target: clone(next.target),
          fov: next.fov,
          interpolation: frameZero >= 0 ? next.cameraKeyframes[frameZero].interpolation : 'smooth' as const,
          locked: frameZero >= 0 ? next.cameraKeyframes[frameZero].locked : undefined,
        }
        next.cameraKeyframes = frameZero >= 0
          ? next.cameraKeyframes.map((keyframe, index) => index === frameZero ? synced : keyframe)
          : [synced, ...next.cameraKeyframes]
      }
      return next
    }),
  }
}

/**
 * Convert persisted/agent data to a safe project. Structurally damaged input
 * falls back to a fresh document; valid input is cleaned up semantically.
 */
export function normalizeDirectorProject(value: unknown, fallbackName = '未命名导演场景'): DirectorProject {
  const parsed = directorProjectSchema.safeParse(value)
  if (!parsed.success) return createDefaultDirectorProject(fallbackName)
  const source = parsed.data as DirectorProject
  const elementIds = new Set<string>()
  const elements = source.elements.filter((element) => {
    if (elementIds.has(element.id)) return false
    elementIds.add(element.id)
    return true
  })
  const shotIds = new Set<string>()
  const shots = source.shots.filter((shot) => {
    if (shotIds.has(shot.id)) return false
    shotIds.add(shot.id)
    return true
  }).map((shot) => {
    const maxFrame = Math.max(0, Math.ceil(shot.durationSec * source.fps) - 1)
    const keyframeIds = new Set<string>()
    const cameraKeyframes = shot.cameraKeyframes.filter((keyframe) => {
      if (keyframe.frame > maxFrame || keyframeIds.has(keyframe.id)) return false
      keyframeIds.add(keyframe.id)
      return true
    })
    const frameZeroIndex = cameraKeyframes.findIndex((keyframe) => keyframe.frame === 0)
    const frameZero = {
      id: frameZeroIndex >= 0 ? cameraKeyframes[frameZeroIndex].id : directorId('camera-keyframe'),
      frame: 0,
      position: clone(shot.position),
      target: clone(shot.target),
      fov: shot.fov,
      interpolation: frameZeroIndex >= 0 ? cameraKeyframes[frameZeroIndex].interpolation : 'smooth' as const,
      locked: frameZeroIndex >= 0 ? cameraKeyframes[frameZeroIndex].locked : undefined,
    }
    const normalizedKeyframes = frameZeroIndex >= 0
      ? cameraKeyframes.map((keyframe, index) => index === frameZeroIndex ? frameZero : keyframe)
      : [frameZero, ...cameraKeyframes]
    return {
      ...shot,
      cameraKeyframes: normalizedKeyframes,
      elementStates: Object.fromEntries(elements.map((element) => [
        element.id,
        clone(shot.elementStates[element.id] ?? elementState(element)),
      ])),
    }
  })
  if (shots.length === 0) return createDefaultDirectorProject(source.name || fallbackName)
  return {
    ...source,
    elements,
    shots,
    activeShotId: shots.some((shot) => shot.id === source.activeShotId) ? source.activeShotId : shots[0].id,
  }
}

export const DIRECTOR_POSES: Array<{ id: DirectorPoseId; label: string }> = [
  { id: 'stand', label: '自然站立' },
  { id: 'walk', label: '迈步行走' },
  { id: 'sit', label: '坐姿' },
  { id: 'arms-crossed', label: '抱臂' },
  { id: 'point', label: '指向' },
  { id: 'kneel', label: '单膝跪地' },
]

export function validateDirectorProject(project: DirectorProject): string[] {
  const issues: string[] = []
  const structure = directorProjectSchema.safeParse(project)
  if (!structure.success && (!Array.isArray(project?.elements) || !Array.isArray(project?.shots))) {
    return ['导演工程结构损坏']
  }
  if (project.version !== 1) issues.push('不支持的导演工程版本')
  if (project.fps !== 24) issues.push('导演工程必须使用 24fps')
  if (project.shots.length === 0) issues.push('至少需要一个镜头')
  const ids = new Set<string>()
  for (const element of project.elements) {
    if (ids.has(element.id)) issues.push(`元素 ID 重复：${element.id}`)
    ids.add(element.id)
  }
  const shotIds = new Set<string>()
  for (const shot of project.shots) {
    if (shotIds.has(shot.id)) issues.push(`Shot ID 重复：${shot.id}`)
    shotIds.add(shot.id)
    if (shot.durationSec <= 0) issues.push(`${shot.name} 的时长无效`)
    if (shot.fov < 10 || shot.fov > 120) issues.push(`${shot.name} 的 FOV 应为 10–120`)
    for (const elementId of Object.keys(shot.elementStates)) {
      if (!ids.has(elementId)) issues.push(`${shot.name} 引用了不存在的元素：${elementId}`)
    }
    const maxFrame = Math.max(0, Math.ceil(shot.durationSec * project.fps) - 1)
    if (shot.cameraKeyframes.some((keyframe) => keyframe.frame > maxFrame)) {
      issues.push(`${shot.name} 存在超出时长的相机关键帧`)
    }
  }
  if (!shotIds.has(project.activeShotId)) issues.push('当前 Shot 不存在')
  return issues
}
