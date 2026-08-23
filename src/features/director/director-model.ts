import type {
  DirectorAspectRatio,
  DirectorActorTrack,
  DirectorActorModelId,
  DirectorBodyType,
  DirectorCameraKeyframe,
  DirectorElement,
  DirectorElementKind,
  DirectorElementState,
  DirectorPoseId,
  DirectorProject,
  DirectorSceneDraft,
  DirectorShot,
  DirectorTransform,
  DirectorVec3,
} from '../../shared/director.types'
import { directorProjectSchema } from '../../shared/director-schema'
import { DIRECTOR_ACTOR_MODELS, DIRECTOR_BODY_PROFILES } from './actor-model'

const clone = <T,>(value: T): T => structuredClone(value)

export const DIRECTOR_ASPECT_RATIOS: DirectorAspectRatio[] = ['16:9', '9:16', '4:3', '1:1']

export interface DirectorCropRect { x: number; y: number; width: number; height: number }
export type DirectorCameraView = Pick<DirectorCameraKeyframe, 'position' | 'target' | 'fov'>

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
    crowd: '群众阵列',
    box: '立方体',
    sphere: '球体',
    cylinder: '圆柱体',
    wall: '墙体',
    floor: '地面',
    platform: '平台',
    stairs: '楼梯',
    ramp: '斜坡',
    cone: '圆锥体',
    capsule: '胶囊体',
  }
  const scaleByKind: Partial<Record<DirectorElementKind, DirectorVec3>> = {
    box: vec3(1.5, 0.8, 1.5),
    sphere: vec3(0.8, 0.8, 0.8),
    cylinder: vec3(0.65, 1.2, 0.65),
    wall: vec3(4, 2.4, 0.15),
    floor: vec3(8, 0.08, 8),
    platform: vec3(3, 0.45, 3),
    stairs: vec3(2.4, 1.5, 3.2),
    ramp: vec3(2.4, 1.2, 3.2),
    cone: vec3(1.2, 1.8, 1.2),
    capsule: vec3(0.9, 1.8, 0.9),
  }
  const colors = ['#4f8ef7', '#e0524d', '#f2a900', '#12b886', '#9c4dcc', '#00b8d9']
  return {
    id: directorId('element'),
    kind,
    name: `${nameByKind[kind]} ${String(index + 1).padStart(2, '0')}`,
    transform: transform(vec3((index % 4) * 1.4 - 2, 0, Math.floor(index / 4) * 1.6), vec3(), scaleByKind[kind] ?? vec3(1, 1, 1)),
    color: kind === 'floor' ? '#596170' : kind === 'platform' || kind === 'stairs' || kind === 'ramp' ? '#8a8178' : colors[index % colors.length],
    visible: true,
    locked: false,
    poseId: actorLike ? 'stand' : undefined,
    actorModelId: actorLike ? (kind === 'crowd' ? 'lightweight-v1' : 'director-rig-v1') : undefined,
    bodyType: actorLike ? 'standard' : undefined,
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
    actorTracks: [],
    cameraConstraint: {
      mode: 'free',
      targetOffset: vec3(0, 1.45, 0),
      followOffset: vec3(0, 1.8, -4),
    },
    elementStates: Object.fromEntries(elements.map((element) => [element.id, elementState(element)])),
    locked: false,
  }
}

export function createDefaultDirectorProject(name = '未命名导演场景'): DirectorProject {
  const elements: DirectorElement[] = []
  const shot = createDirectorShot(elements, 0)
  return {
    version: 2,
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
      const cameraConstraint = shot.cameraConstraint.targetElementId === elementId
        ? { ...shot.cameraConstraint, mode: 'free' as const, targetElementId: undefined }
        : shot.cameraConstraint
      return {
        ...shot,
        elementStates,
        actorTracks: shot.actorTracks.filter((track) => track.elementId !== elementId),
        cameraConstraint,
      }
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
      if ('durationSec' in patch) {
        const maxFrame = Math.max(0, Math.ceil(next.durationSec * project.fps) - 1)
        next.cameraKeyframes = next.cameraKeyframes.filter((keyframe) => keyframe.frame <= maxFrame)
        next.actorTracks = next.actorTracks.map((track) => ({
          ...track,
          startFrame: Math.min(track.startFrame, maxFrame),
          endFrame: Math.min(Math.max(track.startFrame, track.endFrame), maxFrame),
        }))
      }
      return next
    }),
  }
}

export function directorMaxFrame(shot: DirectorShot, fps = 24): number {
  return Math.max(0, Math.ceil(shot.durationSec * fps) - 1)
}

const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount
const lerpVec3 = (from: DirectorVec3, to: DirectorVec3, amount: number): DirectorVec3 => ({
  x: lerp(from.x, to.x, amount),
  y: lerp(from.y, to.y, amount),
  z: lerp(from.z, to.z, amount),
})

function interpolationAmount(kind: DirectorCameraKeyframe['interpolation'], amount: number): number {
  const t = Math.min(1, Math.max(0, amount))
  if (kind === 'hold') return 0
  if (kind === 'smooth') return t * t * (3 - 2 * t)
  if (kind === 'ease-in') return t * t
  if (kind === 'ease-out') return 1 - (1 - t) * (1 - t)
  return t
}

const distance3 = (from: DirectorVec3, to: DirectorVec3): number => Math.hypot(
  to.x - from.x,
  to.y - from.y,
  to.z - from.z,
)

const catmullRomPoint = (
  p0: DirectorVec3,
  p1: DirectorVec3,
  p2: DirectorVec3,
  p3: DirectorVec3,
  amount: number,
): DirectorVec3 => {
  const t2 = amount * amount
  const t3 = t2 * amount
  const coordinate = (a: number, b: number, c: number, d: number) => 0.5 * (
    (2 * b)
    + (-a + c) * amount
    + (2 * a - 5 * b + 4 * c - d) * t2
    + (-a + 3 * b - 3 * c + d) * t3
  )
  return {
    x: coordinate(p0.x, p1.x, p2.x, p3.x),
    y: coordinate(p0.y, p1.y, p2.y, p3.y),
    z: coordinate(p0.z, p1.z, p2.z, p3.z),
  }
}

/** Replaces only geometry previously generated from the same reference image. */
export function applyDirectorSceneDraft(
  project: DirectorProject,
  referenceNodeId: string,
  sceneDraft: DirectorSceneDraft,
): DirectorProject {
  const lockedGenerated = project.elements.filter((item) => item.referenceNodeId === referenceNodeId && item.locked)
  if (lockedGenerated.length > 0) throw new Error(`参考图生成的 ${lockedGenerated.length} 个元素已锁定，请先解锁后再重新搭景`)
  let next = project
  for (const element of project.elements.filter((item) => item.referenceNodeId === referenceNodeId)) {
    next = removeDirectorElement(next, element.id)
  }
  for (const [index, primitive] of sceneDraft.elements.entries()) {
    const base = createDirectorElement(primitive.kind, next.elements.length + index)
    const transform = clone(primitive.transform)
    // Director primitives use a bottom anchor: position.y is the bottom elevation,
    // not the geometry centre. Ground placement is therefore deterministic and
    // must not depend on how the multimodal model interpreted object height.
    if (primitive.placement === 'ground') transform.position.y = 0
    next = addDirectorElement(next, {
      ...base,
      name: primitive.name,
      color: primitive.color,
      transform,
      referenceNodeId,
    })
  }
  return {
    ...next,
    groundColor: sceneDraft.groundColor ?? next.groundColor,
    backgroundColor: sceneDraft.backgroundColor ?? next.backgroundColor,
    updatedAt: Date.now(),
  }
}

/** Expands a smooth actor path into deterministic samples before arc-length sampling. */
export function directorActorPathPoints(track: DirectorActorTrack, samplesPerSegment = 12): DirectorVec3[] {
  if (track.interpolation !== 'smooth' || track.points.length < 3) return track.points.map(clone)
  const result: DirectorVec3[] = []
  const steps = Math.max(2, Math.floor(samplesPerSegment))
  for (let index = 0; index < track.points.length - 1; index += 1) {
    const p0 = track.points[Math.max(0, index - 1)]
    const p1 = track.points[index]
    const p2 = track.points[index + 1]
    const p3 = track.points[Math.min(track.points.length - 1, index + 2)]
    for (let step = 0; step < steps; step += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / steps))
    }
  }
  result.push(clone(track.points[track.points.length - 1]))
  return result
}

/** Samples a deterministic, constant-speed position along a persisted actor polyline. */
export function sampleDirectorActorPosition(track: DirectorActorTrack, frame: number): DirectorVec3 {
  const points = directorActorPathPoints(track)
  if (points.length === 0) return vec3()
  if (points.length === 1) return clone(points[0])
  const duration = Math.max(1, track.endFrame - track.startFrame)
  const amount = Math.min(1, Math.max(0, (Math.floor(frame) - track.startFrame) / duration))
  const lengths = points.slice(1).map((point, index) => distance3(points[index], point))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total <= 1e-6) return clone(points[0])
  let remaining = amount * total
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (remaining <= length || index === lengths.length - 1) {
      const localAmount = length <= 1e-6 ? 0 : remaining / length
      return lerpVec3(points[index], points[index + 1], Math.min(1, localAmount))
    }
    remaining -= length
  }
  return clone(points[points.length - 1])
}

export function sampleDirectorActorTransform(
  shot: DirectorShot,
  element: DirectorElement,
  frame: number,
): DirectorTransform {
  const track = shot.actorTracks.find((item) => item.elementId === element.id)
  if (!track || track.points.length === 0) return clone(element.transform)
  const position = sampleDirectorActorPosition(track, frame)
  if (!track.orientToPath || track.points.length < 2) {
    return { ...clone(element.transform), position }
  }
  const nearbyFrame = frame >= track.endFrame ? frame - 1 : frame + 1
  const nearby = sampleDirectorActorPosition(track, nearbyFrame)
  const direction = frame >= track.endFrame
    ? { x: position.x - nearby.x, z: position.z - nearby.z }
    : { x: nearby.x - position.x, z: nearby.z - position.z }
  const rotation = clone(element.transform.rotation)
  if (Math.hypot(direction.x, direction.z) > 1e-6) {
    rotation.y = Math.atan2(direction.x, direction.z) * 180 / Math.PI
  }
  return { ...clone(element.transform), position, rotation }
}

export function upsertDirectorActorTrack(
  project: DirectorProject,
  shotId: string,
  track: DirectorActorTrack,
): DirectorProject {
  return {
    ...project,
    shots: project.shots.map((shot) => {
      if (shot.id !== shotId || shot.locked) return shot
      const element = project.elements.find((item) => item.id === track.elementId)
      if (!element || element.kind !== 'actor' || element.locked) return shot
      const maxFrame = directorMaxFrame(shot, project.fps)
      const safeTrack = {
        ...clone(track),
        startFrame: Math.min(maxFrame, Math.max(0, Math.floor(track.startFrame))),
        endFrame: Math.min(maxFrame, Math.max(0, Math.floor(track.endFrame))),
      }
      safeTrack.endFrame = Math.max(safeTrack.startFrame, safeTrack.endFrame)
      const exists = shot.actorTracks.some((item) => item.elementId === track.elementId)
      return {
        ...shot,
        actorTracks: exists
          ? shot.actorTracks.map((item) => item.elementId === track.elementId ? safeTrack : item)
          : [...shot.actorTracks, safeTrack],
      }
    }),
  }
}

export function removeDirectorActorTrack(project: DirectorProject, shotId: string, elementId: string): DirectorProject {
  return {
    ...project,
    shots: project.shots.map((shot) => shot.id === shotId && !shot.locked
      ? { ...shot, actorTracks: shot.actorTracks.filter((track) => track.elementId !== elementId) }
      : shot),
  }
}

/** Applies the shot's actor target constraint after sampling the free camera curve. */
export function sampleDirectorConstrainedCamera(
  shot: DirectorShot,
  elements: DirectorElement[],
  frame: number,
): DirectorCameraView {
  const base = sampleDirectorCamera(shot, frame)
  const constraint = shot.cameraConstraint
  if (constraint.mode === 'free' || !constraint.targetElementId) return base
  const actor = elements.find((element) => element.id === constraint.targetElementId && element.kind === 'actor')
  if (!actor) return base
  const actorTransform = sampleDirectorActorTransform(shot, actor, frame)
  const target = {
    x: actorTransform.position.x + constraint.targetOffset.x,
    y: actorTransform.position.y + constraint.targetOffset.y,
    z: actorTransform.position.z + constraint.targetOffset.z,
  }
  if (constraint.mode === 'look-at') return { ...base, target }
  const yaw = actorTransform.rotation.y * Math.PI / 180
  const offset = constraint.followOffset
  const rotatedOffset = {
    x: offset.x * Math.cos(yaw) + offset.z * Math.sin(yaw),
    y: offset.y,
    z: -offset.x * Math.sin(yaw) + offset.z * Math.cos(yaw),
  }
  return {
    ...base,
    position: {
      x: actorTransform.position.x + rotatedOffset.x,
      y: actorTransform.position.y + rotatedOffset.y,
      z: actorTransform.position.z + rotatedOffset.z,
    },
    target,
  }
}

/** Samples the persisted camera curve at an exact 24fps playhead frame. */
export function sampleDirectorCamera(shot: DirectorShot, frame: number): DirectorCameraView {
  const keyframes = [...shot.cameraKeyframes].sort((a, b) => a.frame - b.frame)
  const fallback = { position: clone(shot.position), target: clone(shot.target), fov: shot.fov }
  if (keyframes.length === 0) return fallback
  const clampedFrame = Math.max(0, Math.floor(frame))
  const rightIndex = keyframes.findIndex((keyframe) => keyframe.frame >= clampedFrame)
  if (rightIndex === 0) return clone(keyframes[0])
  if (rightIndex < 0) return clone(keyframes[keyframes.length - 1])
  const left = keyframes[rightIndex - 1]
  const right = keyframes[rightIndex]
  if (right.frame === clampedFrame || right.frame === left.frame) return clone(right)
  const amount = interpolationAmount(left.interpolation, (clampedFrame - left.frame) / (right.frame - left.frame))
  return {
    position: lerpVec3(left.position, right.position, amount),
    target: lerpVec3(left.target, right.target, amount),
    fov: lerp(left.fov, right.fov, amount),
  }
}

export function upsertDirectorCameraKeyframe(
  project: DirectorProject,
  shotId: string,
  frame: number,
  view: DirectorCameraView,
  interpolation: DirectorCameraKeyframe['interpolation'] = 'smooth',
): DirectorProject {
  return {
    ...project,
    shots: project.shots.map((shot) => {
      if (shot.id !== shotId || shot.locked) return shot
      const safeFrame = Math.min(directorMaxFrame(shot, project.fps), Math.max(0, Math.floor(frame)))
      const existing = shot.cameraKeyframes.find((keyframe) => keyframe.frame === safeFrame)
      if (existing?.locked) return shot
      const keyframe: DirectorCameraKeyframe = {
        id: existing?.id ?? directorId('camera-keyframe'),
        frame: safeFrame,
        position: clone(view.position),
        target: clone(view.target),
        fov: Math.min(120, Math.max(10, view.fov)),
        interpolation: existing?.interpolation ?? interpolation,
        locked: existing?.locked,
      }
      const cameraKeyframes = existing
        ? shot.cameraKeyframes.map((item) => item.id === existing.id ? keyframe : item)
        : [...shot.cameraKeyframes, keyframe]
      cameraKeyframes.sort((a, b) => a.frame - b.frame)
      return safeFrame === 0
        ? { ...shot, position: clone(keyframe.position), target: clone(keyframe.target), fov: keyframe.fov, cameraKeyframes }
        : { ...shot, cameraKeyframes }
    }),
  }
}

export function removeDirectorCameraKeyframe(
  project: DirectorProject,
  shotId: string,
  frame: number,
): DirectorProject {
  if (frame === 0) return project
  return {
    ...project,
    shots: project.shots.map((shot) => {
      if (shot.id !== shotId || shot.locked) return shot
      const target = shot.cameraKeyframes.find((keyframe) => keyframe.frame === frame)
      if (!target || target.locked) return shot
      return { ...shot, cameraKeyframes: shot.cameraKeyframes.filter((keyframe) => keyframe.id !== target.id) }
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
  }).map((element) => {
    if (element.kind !== 'actor' && element.kind !== 'crowd') return element
    return {
      ...element,
      actorModelId: element.actorModelId ?? (element.kind === 'crowd' ? 'lightweight-v1' as const : 'director-rig-v1' as const),
      bodyType: element.bodyType ?? 'standard' as const,
      heightM: element.heightM ?? 1.72,
      poseId: element.poseId ?? 'stand' as const,
    }
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
    const actorTracks = shot.actorTracks.filter((track) => (
      elementIds.has(track.elementId)
      && elements.some((element) => element.id === track.elementId && element.kind === 'actor')
    )).map((track) => ({
      ...track,
      startFrame: Math.min(maxFrame, track.startFrame),
      endFrame: Math.min(maxFrame, Math.max(track.startFrame, track.endFrame)),
    }))
    const cameraConstraint = shot.cameraConstraint.targetElementId
      && !elementIds.has(shot.cameraConstraint.targetElementId)
      ? { ...shot.cameraConstraint, mode: 'free' as const, targetElementId: undefined }
      : shot.cameraConstraint
    return {
      ...shot,
      cameraKeyframes: normalizedKeyframes,
      actorTracks,
      cameraConstraint,
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
  { id: 'hands-on-hips', label: '双手叉腰' },
  { id: 'wave', label: '挥手' },
  { id: 'hands-up', label: '双手举起' },
  { id: 'crouch', label: '蹲下' },
  { id: 'lean', label: '前倾观察' },
  { id: 'look-back', label: '回头' },
]

export const DIRECTOR_ACTOR_MODEL_OPTIONS = DIRECTOR_ACTOR_MODELS
export const DIRECTOR_BODY_TYPE_OPTIONS = DIRECTOR_BODY_PROFILES.map(({ id, label, defaultHeightM }) => ({ id, label, defaultHeightM }))
export type { DirectorActorModelId, DirectorBodyType }

export function validateDirectorProject(project: DirectorProject): string[] {
  const issues: string[] = []
  const structure = directorProjectSchema.safeParse(project)
  if (!structure.success && (!Array.isArray(project?.elements) || !Array.isArray(project?.shots))) {
    return ['导演工程结构损坏']
  }
  if (project.version !== 2) issues.push('不支持的导演工程版本')
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
    const trackedActors = new Set<string>()
    for (const track of shot.actorTracks) {
      const actor = project.elements.find((element) => element.id === track.elementId)
      if (!actor || actor.kind !== 'actor') issues.push(`${shot.name} 的人物路径引用无效：${track.elementId}`)
      if (trackedActors.has(track.elementId)) issues.push(`${shot.name} 的人物路径重复：${track.elementId}`)
      trackedActors.add(track.elementId)
      if (track.startFrame > track.endFrame || track.endFrame > maxFrame) issues.push(`${shot.name} 的人物路径时间范围无效`)
      if (track.points.length < 2 || distance3(track.points[0], track.points[track.points.length - 1]) <= 1e-6) {
        issues.push(`${shot.name} 的人物路径至少需要两个不同位置`)
      }
    }
    if (shot.cameraConstraint.mode !== 'free') {
      const target = project.elements.find((element) => element.id === shot.cameraConstraint.targetElementId)
      if (!target || target.kind !== 'actor') issues.push(`${shot.name} 的相机跟随目标无效`)
    }
  }
  if (!shotIds.has(project.activeShotId)) issues.push('当前 Shot 不存在')
  return issues
}
