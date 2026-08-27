import { describe, expect, it } from 'vitest'
import {
  activateDirectorShot,
  addDirectorElement,
  applyDirectorSceneDraft,
  createDefaultDirectorProject,
  createDirectorElement,
  createDirectorShot,
  directorCropRect,
  directorActorPathPoints,
  directorMaxFrame,
  normalizeDirectorProject,
  patchDirectorShot,
  removeDirectorElement,
  removeDirectorCameraKeyframe,
  sampleDirectorActorPosition,
  sampleDirectorActorTransform,
  sampleDirectorConstrainedCamera,
  sampleDirectorCamera,
  upsertDirectorActorTrack,
  updateDirectorElement,
  upsertDirectorCameraKeyframe,
  validateDirectorProject,
} from '../src/features/director/director-model'
import { directorProjectSchema } from '../src/shared/director-schema'
import { directorBodyProfile } from '../src/features/director/actor-model'
import { directorLightweightFootOffset } from '../src/features/director/actor-foot-anchor'

const createProjectWithActor = () => addDirectorElement(
  createDefaultDirectorProject(),
  createDirectorElement('actor', 0),
)

describe('director project model', () => {
  it('creates a serializable 24fps project with stable element and shot ids', () => {
    const project = createDefaultDirectorProject('测试导演台')

    expect(project.version).toBe(2)
    expect(project.fps).toBe(24)
    expect(project.elements).toHaveLength(0)
    expect(project.shots).toHaveLength(1)
    expect(project.activeShotId).toBe(project.shots[0].id)
    expect('elementStates' in project.shots[0]).toBe(false)
    expect(() => JSON.stringify(project)).not.toThrow()
    expect(validateDirectorProject(project)).toEqual([])
  })

  it('migrates legacy per-shot blocking away without discarding the scene', () => {
    const project = createProjectWithActor()
    const legacy = structuredClone(project) as typeof project & { shots: Array<(typeof project.shots)[number] & { elementStates: Record<string, unknown> }> }
    legacy.shots[0].elementStates = { legacy: { transform: project.elements[0].transform, visible: true } }

    expect(directorProjectSchema.safeParse(legacy).success).toBe(false)
    const normalized = normalizeDirectorProject(legacy)
    expect(normalized.elements).toHaveLength(1)
    expect('elementStates' in normalized.shots[0]).toBe(false)
    expect(validateDirectorProject(normalized)).toEqual([])
  })

  it('reports invalid shot timing and camera ranges', () => {
    const project = createDefaultDirectorProject()
    project.shots[0].durationSec = 0
    project.shots[0].fov = 160

    expect(validateDirectorProject(project)).toHaveLength(2)
  })

  it('rejects malformed or legacy documents and starts a fresh v2 scene', () => {
    expect(directorProjectSchema.safeParse({}).success).toBe(false)
    const current = createDefaultDirectorProject()
    expect(directorProjectSchema.safeParse({ ...current, version: 1 }).success).toBe(false)
    const normalized = normalizeDirectorProject({ ...current, version: 1 }, '新的导演台')
    expect(normalized.version).toBe(2)
    expect(normalized.name).toBe('新的导演台')
    expect(validateDirectorProject(normalized)).toEqual([])
  })

  it('keeps one global element layout when switching shots', () => {
    let project = createProjectWithActor()
    const secondShot = createDirectorShot(1)
    project = { ...project, shots: [...project.shots, secondShot] }
    const firstActor = project.elements[0]
    project = updateDirectorElement(project, {
      ...firstActor,
      transform: { ...firstActor.transform, position: { x: 7, y: 0, z: 1 } },
    })
    project = activateDirectorShot(project, secondShot.id)
    project = activateDirectorShot(project, project.shots[0].id)
    expect(project.elements[0].transform.position.x).toBe(7)

    const prop = createDirectorElement('box', project.elements.length)
    project = addDirectorElement(project, prop)
    project = updateDirectorElement(project, {
      ...prop,
      transform: { ...prop.transform, position: { x: 12, y: 0, z: 0 } },
    })
    project = activateDirectorShot(project, secondShot.id)
    expect(project.elements.find((element) => element.id === prop.id)?.transform.position.x).toBe(12)
  })

  it('enforces locks, cascades deletion, and synchronizes camera frame zero', () => {
    let project = createProjectWithActor()
    const actor = project.elements[0]
    project = updateDirectorElement(project, { ...actor, locked: true })
    const locked = project.elements[0]
    project = updateDirectorElement(project, { ...locked, name: '不应生效' })
    expect(project.elements[0].name).not.toBe('不应生效')
    project = updateDirectorElement(project, { ...locked, locked: false }, true)
    expect(project.elements[0].locked).toBe(false)

    const shotId = project.activeShotId
    project = patchDirectorShot(project, shotId, { position: { x: 3, y: 4, z: 5 }, fov: 66 })
    const shot = project.shots[0]
    expect(shot.cameraKeyframes.find((keyframe) => keyframe.frame === 0)).toMatchObject({
      position: { x: 3, y: 4, z: 5 },
      fov: 66,
    })

    project = removeDirectorElement(project, actor.id)
    expect(project.elements.some((item) => item.id === actor.id)).toBe(false)
  })

  it('reports semantic dangling references and invalid active shots', () => {
    const project = createProjectWithActor()
    project.shots[0].cameraConstraint = { ...project.shots[0].cameraConstraint, mode: 'look-at', targetElementId: 'ghost' }
    project.activeShotId = 'missing-shot'
    expect(validateDirectorProject(project)).toEqual(expect.arrayContaining([
      expect.stringContaining('相机跟随目标无效'),
      '当前 Shot 不存在',
    ]))
  })

  it('uses one centered crop rectangle for landscape and portrait frames', () => {
    expect(directorCropRect(1600, 900, '16:9')).toEqual({ x: 0, y: 0, width: 1600, height: 900 })
    expect(directorCropRect(1600, 900, '9:16')).toEqual({ x: 547, y: 0, width: 506, height: 900 })
    expect(directorCropRect(1000, 1000, '4:3')).toEqual({ x: 0, y: 125, width: 1000, height: 750 })
  })

  it('uses shot duration as a 24fps timeline and interpolates camera keyframes', () => {
    let project = createDefaultDirectorProject()
    const shotId = project.activeShotId
    const start = project.shots[0].position
    project = upsertDirectorCameraKeyframe(project, shotId, 24, {
      position: { x: start.x + 10, y: start.y, z: start.z },
      target: project.shots[0].target,
      fov: 65,
    }, 'linear')
    const shot = project.shots[0]
    expect(directorMaxFrame(shot, project.fps)).toBe(119)
    expect(sampleDirectorCamera(shot, 12)).toMatchObject({
      position: { x: start.x + 5, y: start.y, z: start.z },
      fov: 55,
    })
    const fractionalAmount = 12.5 / 24
    const smoothAmount = fractionalAmount * fractionalAmount * (3 - 2 * fractionalAmount)
    expect(sampleDirectorCamera(shot, 12.5)).toMatchObject({
      position: { x: start.x + 10 * smoothAmount, y: start.y, z: start.z },
      fov: 45 + 20 * smoothAmount,
    })

    project = removeDirectorCameraKeyframe(project, shotId, 24)
    expect(project.shots[0].cameraKeyframes.some((keyframe) => keyframe.frame === 24)).toBe(false)
    project = removeDirectorCameraKeyframe(project, shotId, 0)
    expect(project.shots[0].cameraKeyframes.some((keyframe) => keyframe.frame === 0)).toBe(true)
  })

  it('trims camera keyframes when shot duration becomes shorter', () => {
    let project = createDefaultDirectorProject()
    const shotId = project.activeShotId
    project = upsertDirectorCameraKeyframe(project, shotId, 48, {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 1, z: 0 },
      fov: 50,
    })
    project = patchDirectorShot(project, shotId, { durationSec: 1 })
    expect(directorMaxFrame(project.shots[0], project.fps)).toBe(23)
    expect(project.shots[0].cameraKeyframes.every((keyframe) => keyframe.frame <= 23)).toBe(true)
    expect(validateDirectorProject(project)).toEqual([])
  })

  it('samples actor paths at constant speed and constrains the camera to the moving actor', () => {
    let project = createProjectWithActor()
    const actor = project.elements[0]
    const shotId = project.activeShotId
    const start = actor.transform.position
    project = upsertDirectorActorTrack(project, shotId, {
      id: 'track-actor-1',
      elementId: actor.id,
      startFrame: 0,
      endFrame: 24,
      points: [start, { x: start.x + 10, y: start.y, z: start.z }],
      interpolation: 'linear',
      orientToPath: true,
      motion: 'walk',
    })
    let shot = project.shots[0]
    const track = shot.actorTracks[0]
    expect(sampleDirectorActorPosition(track, 12).x).toBeCloseTo(start.x + 5)
    expect(sampleDirectorActorPosition(track, 12.5).x).toBeCloseTo(start.x + (10 * 12.5) / 24)
    expect(sampleDirectorActorTransform(shot, actor, 12).rotation.y).toBeCloseTo(90)

    shot = {
      ...shot,
      cameraConstraint: {
        ...shot.cameraConstraint,
        mode: 'look-at',
        targetElementId: actor.id,
      },
    }
    const freeView = sampleDirectorCamera(shot, 12)
    const constrained = sampleDirectorConstrainedCamera(shot, project.elements, 12)
    expect(constrained.position).toEqual(freeView.position)
    expect(constrained.target).toMatchObject({
      x: start.x + 5,
      y: start.y + 1.45,
      z: start.z,
    })
  })

  it('creates replaceable actors with persistent body presets and expanded actions', () => {
    const actor = createDirectorElement('actor', 0)
    const crowd = createDirectorElement('crowd', 1)
    expect(actor).toMatchObject({ actorModelId: 'director-rig-v1', bodyType: 'standard', poseId: 'stand', heightM: 1.72 })
    expect(crowd.actorModelId).toBe('lightweight-v1')

    const heavy = directorBodyProfile('heavy')
    const slim = directorBodyProfile('slim')
    const short = directorBodyProfile('short')
    expect(heavy.torsoWidth).toBeGreaterThan(slim.torsoWidth)
    expect(heavy.armThickness).toBeGreaterThan(slim.armThickness)
    expect(short.defaultHeightM).toBeLessThan(directorBodyProfile('standard').defaultHeightM)

    const project = addDirectorElement(createDefaultDirectorProject(), { ...actor, bodyType: 'heavy', poseId: 'wave' })
    const saved = JSON.parse(JSON.stringify(project))
    expect(normalizeDirectorProject(saved).elements[0]).toMatchObject({ bodyType: 'heavy', poseId: 'wave' })
    expect(directorProjectSchema.safeParse(saved).success).toBe(true)
  })

  it('keeps the lightweight mannequin shoe sole on the actor root across body types and poses', () => {
    const standard = directorLightweightFootOffset({}, directorBodyProfile('standard').legLength)
    const short = directorLightweightFootOffset({}, directorBodyProfile('short').legLength)
    const walking = directorLightweightFootOffset({
      leftLeg: [0.45, 0, 0],
      rightLeg: [-0.45, 0, 0],
      leftKnee: [0.2, 0, 0],
      rightKnee: [0.05, 0, 0],
    }, directorBodyProfile('standard').legLength)

    expect(standard).toBeCloseTo(0.104, 3)
    expect(short).toBeCloseTo(-0.1508, 3)
    expect(Number.isFinite(walking)).toBe(true)
    expect(walking).not.toBe(standard)
  })

  it('samples actor paths through XYZ space for stairs and raised platforms', () => {
    const project = createProjectWithActor()
    const actor = project.elements[0]
    const track = {
      id: 'spatial-track',
      elementId: actor.id,
      startFrame: 0,
      endFrame: 24,
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2, z: 1.5 },
        { x: 0, y: 4, z: 3 },
      ],
      interpolation: 'linear' as const,
      orientToPath: true,
      motion: 'walk' as const,
    }
    const shot = { ...project.shots[0], actorTracks: [track] }

    expect(sampleDirectorActorPosition(track, 12)).toEqual({ x: 0, y: 2, z: 1.5 })
    expect(sampleDirectorActorTransform(shot, actor, 18).position).toEqual({ x: 0, y: 3, z: 2.25 })
  })

  it('expands smooth actor paths deterministically while preserving endpoints', () => {
    const project = createProjectWithActor()
    const actor = project.elements[0]
    const points = [
      actor.transform.position,
      { x: actor.transform.position.x + 2, y: actor.transform.position.y, z: actor.transform.position.z + 3 },
      { x: actor.transform.position.x + 5, y: actor.transform.position.y, z: actor.transform.position.z },
    ]
    const track = {
      id: 'smooth-track',
      elementId: actor.id,
      startFrame: 0,
      endFrame: 48,
      points,
      interpolation: 'smooth' as const,
      orientToPath: true,
      motion: 'walk' as const,
    }
    const expanded = directorActorPathPoints(track, 8)
    expect(expanded).toHaveLength(17)
    expect(expanded[0]).toEqual(points[0])
    expect(expanded.at(-1)).toEqual(points.at(-1))
    expect(directorActorPathPoints(track, 8)).toEqual(expanded)
  })

  it('replaces only geometry generated from the same scene reference', () => {
    let project = createDefaultDirectorProject()
    const manual = createDirectorElement('box', project.elements.length)
    project = addDirectorElement(project, manual)
    const makeDraft = (name: string, x: number) => ({
      summary: '测试草案',
      groundColor: '#202020',
      elements: [{
        kind: 'wall' as const,
        name,
        color: '#808080',
        placement: 'ground' as const,
        transform: {
          position: { x, y: 1.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 3, z: 0.2 },
        },
      }],
    })
    project = applyDirectorSceneDraft(project, 'image-a', makeDraft('旧墙', 0))
    project = applyDirectorSceneDraft(project, 'image-b', makeDraft('另一参考墙', 6))
    project = applyDirectorSceneDraft(project, 'image-a', makeDraft('新墙', 2))
    expect(project.elements.some((element) => element.id === manual.id)).toBe(true)
    expect(project.elements.filter((element) => element.referenceNodeId === 'image-a').map((element) => element.name)).toEqual(['新墙'])
    expect(project.elements.filter((element) => element.referenceNodeId === 'image-b')).toHaveLength(1)
    expect(validateDirectorProject(project)).toEqual([])
  })

  it('creates the extended blocking primitive library with useful defaults', () => {
    const kinds = ['floor', 'platform', 'stairs', 'ramp', 'cone', 'capsule'] as const
    let project = createDefaultDirectorProject()
    for (const [index, kind] of kinds.entries()) {
      project = addDirectorElement(project, createDirectorElement(kind, index))
    }

    expect(project.elements.map((element) => element.kind)).toEqual(kinds)
    expect(project.elements.find((element) => element.kind === 'floor')?.transform.scale).toEqual({ x: 8, y: 0.08, z: 8 })
    expect(project.elements.find((element) => element.kind === 'stairs')?.transform.scale.y).toBe(1.5)
    expect(validateDirectorProject(project)).toEqual([])
  })

  it('does not overwrite locked geometry generated from a scene reference', () => {
    let project = createDefaultDirectorProject()
    project = applyDirectorSceneDraft(project, 'locked-image', {
      summary: '测试',
      elements: [{
        kind: 'box',
        name: '锁定方块',
        color: '#808080',
        placement: 'ground',
        transform: {
          position: { x: 0, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      }],
    })
    const generated = project.elements.find((element) => element.referenceNodeId === 'locked-image')!
    project = updateDirectorElement(project, { ...generated, locked: true })
    expect(() => applyDirectorSceneDraft(project, 'locked-image', {
      summary: '重做',
      elements: [{
        kind: 'box',
        name: '新方块',
        color: generated.color,
        placement: 'ground',
        transform: generated.transform,
      }],
    })).toThrow(/已锁定/)
  })

  it('trims actor tracks with shot duration and cascades actor deletion into camera constraints', () => {
    let project = createProjectWithActor()
    const actor = project.elements[0]
    const shotId = project.activeShotId
    project = upsertDirectorActorTrack(project, shotId, {
      id: 'track-delete',
      elementId: actor.id,
      startFrame: 12,
      endFrame: 96,
      points: [actor.transform.position, { ...actor.transform.position, z: actor.transform.position.z + 4 }],
      interpolation: 'smooth',
      orientToPath: true,
      motion: 'run',
    })
    project = patchDirectorShot(project, shotId, {
      durationSec: 1,
      cameraConstraint: {
        ...project.shots[0].cameraConstraint,
        mode: 'follow',
        targetElementId: actor.id,
      },
    })
    expect(project.shots[0].actorTracks[0].endFrame).toBe(23)
    project = removeDirectorElement(project, actor.id)
    expect(project.shots[0].actorTracks).toEqual([])
    expect(project.shots[0].cameraConstraint.mode).toBe('free')
    expect(validateDirectorProject(project)).toEqual([])
  })
})
