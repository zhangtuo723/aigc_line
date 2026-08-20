import { describe, expect, it } from 'vitest'
import {
  activateDirectorShot,
  addDirectorElement,
  applyShotElementStates,
  createDefaultDirectorProject,
  createDirectorElement,
  createDirectorShot,
  directorCropRect,
  normalizeDirectorProject,
  patchDirectorShot,
  removeDirectorElement,
  snapshotElements,
  updateDirectorElement,
  validateDirectorProject,
} from '../src/features/director/director-model'
import { directorProjectSchema } from '../src/shared/director-schema'

describe('director project model', () => {
  it('creates a serializable 24fps project with stable element and shot ids', () => {
    const project = createDefaultDirectorProject('测试导演台')

    expect(project.fps).toBe(24)
    expect(project.elements).toHaveLength(2)
    expect(project.shots).toHaveLength(1)
    expect(project.activeShotId).toBe(project.shots[0].id)
    expect(new Set(project.elements.map((element) => element.id)).size).toBe(2)
    expect(() => JSON.stringify(project)).not.toThrow()
    expect(validateDirectorProject(project)).toEqual([])
  })

  it('records and restores per-shot blocking without sharing transform references', () => {
    const project = createDefaultDirectorProject()
    const thirdActor = createDirectorElement('actor', 2)
    const elements = [...project.elements, thirdActor]
    const shot = createDirectorShot(elements, 1)
    shot.elementStates = snapshotElements(elements)

    const moved = elements.map((element, index) => index === 0
      ? { ...element, transform: { ...element.transform, position: { x: 99, y: 0, z: 0 } } }
      : element)
    const restored = applyShotElementStates(moved, shot)

    expect(restored[0].transform.position.x).not.toBe(99)
    restored[0].transform.position.x = 42
    expect(shot.elementStates[restored[0].id].transform.position.x).not.toBe(42)
  })

  it('reports invalid shot timing and camera ranges', () => {
    const project = createDefaultDirectorProject()
    project.shots[0].durationSec = 0
    project.shots[0].fov = 160

    expect(validateDirectorProject(project)).toHaveLength(2)
  })

  it('rejects malformed agent documents and safely normalizes damaged snapshots', () => {
    expect(directorProjectSchema.safeParse({}).success).toBe(false)
    const normalized = normalizeDirectorProject({}, '修复后的导演台')
    expect(normalized.name).toBe('修复后的导演台')
    expect(validateDirectorProject(normalized)).toEqual([])
  })

  it('commits blocking when switching shots and keeps added elements independent', () => {
    let project = createDefaultDirectorProject()
    const secondShot = createDirectorShot(project.elements, 1)
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
    expect(project.shots.every((shot) => shot.elementStates[prop.id])).toBe(true)
    const firstShotId = project.activeShotId
    project = updateDirectorElement(project, {
      ...prop,
      transform: { ...prop.transform, position: { x: 12, y: 0, z: 0 } },
    })
    project = activateDirectorShot(project, secondShot.id)
    expect(project.elements.find((element) => element.id === prop.id)?.transform.position.x).not.toBe(12)
    project = activateDirectorShot(project, firstShotId)
    expect(project.elements.find((element) => element.id === prop.id)?.transform.position.x).toBe(12)
  })

  it('enforces locks, cascades deletion, and synchronizes camera frame zero', () => {
    let project = createDefaultDirectorProject()
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
    expect(project.shots.every((item) => !(actor.id in item.elementStates))).toBe(true)
  })

  it('reports semantic dangling references and invalid active shots', () => {
    const project = createDefaultDirectorProject()
    project.shots[0].elementStates.ghost = structuredClone(project.shots[0].elementStates[project.elements[0].id])
    project.activeShotId = 'missing-shot'
    expect(validateDirectorProject(project)).toEqual(expect.arrayContaining([
      expect.stringContaining('不存在的元素'),
      '当前 Shot 不存在',
    ]))
  })

  it('uses one centered crop rectangle for landscape and portrait frames', () => {
    expect(directorCropRect(1600, 900, '16:9')).toEqual({ x: 0, y: 0, width: 1600, height: 900 })
    expect(directorCropRect(1600, 900, '9:16')).toEqual({ x: 547, y: 0, width: 506, height: 900 })
    expect(directorCropRect(1000, 1000, '4:3')).toEqual({ x: 0, y: 125, width: 1000, height: 750 })
  })
})
