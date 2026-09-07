import { describe, expect, it, vi } from 'vitest'
import { Bone, BoxGeometry, MeshStandardMaterial, Skeleton, SkinnedMesh, Texture } from 'three'
import { createDirectorHistory, moveDirectorHistory, recordDirectorEdit } from '../src/features/director/director-history'
import { createDefaultDirectorProject, createDirectorElement, createDirectorShot, removeDirectorActorTrack, validateDirectorProject } from '../src/features/director/director-model'
import { disposeDirectorRig } from '../src/features/director/director-rig-resources'

describe('director editing reliability', () => {
  it('protects a locked actor path from deletion at the mutation boundary', () => {
    const project = createDefaultDirectorProject()
    const actor = createDirectorElement('actor', 0)
    actor.locked = true
    project.elements = [actor]
    project.shots[0].actorTracks = [{ id: 'path', elementId: actor.id, points: [{x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 0}], startFrame: 0, endFrame: 24, interpolation: 'linear', motion: 'walk', orientToPath: true }]
    expect(removeDirectorActorTrack(project, project.activeShotId, actor.id)).toBe(project)
    expect(project.shots[0].actorTracks).toHaveLength(1)
  })

  it('restores a full edit in one undo and redo while preserving navigation and capture metadata', () => {
    const before = createDefaultDirectorProject()
    const actor = createDirectorElement('actor', 0)
    before.elements = [actor]
    const other = createDirectorShot(1)
    before.shots.push(other)
    const after = { ...before, elements: [{ ...actor, transform: { ...actor.transform, position: { x: 10, y: 2, z: 3 } } }] }
    const history = recordDirectorEdit(createDirectorHistory(), before, after)
    const current = { ...after, activeShotId: other.id, shots: after.shots.map((shot) => ({ ...shot, lastCapturePath: 'generated/still.png' })) }
    const undone = moveDirectorHistory(history, current, 'undo')
    expect(undone.project.elements[0].transform.position).toEqual(actor.transform.position)
    expect(undone.project.activeShotId).toBe(other.id)
    expect(undone.project.shots[0].lastCapturePath).toBe('generated/still.png')
    const redone = moveDirectorHistory(undone.history, undone.project, 'redo')
    expect(redone.project.elements[0].transform.position).toEqual({ x: 10, y: 2, z: 3 })
    expect(recordDirectorEdit(undone.history, undone.project, { ...undone.project, name: 'branch' }).future).toEqual([])
  })

  it('reports invalid numeric fields instead of silently accepting a non-serializable project', () => {
    const project = createDefaultDirectorProject()
    project.elements = [createDirectorElement('table', 0)]
    project.elements[0].transform.position.x = Infinity
    expect(validateDirectorProject(project).length).toBeGreaterThan(0)
  })

  it('disposes isolated material and skeleton allocations without destroying shared GLTF assets', () => {
    const geometry = new BoxGeometry()
    const texture = new Texture()
    const material = new MeshStandardMaterial({ map: texture })
    const actor = new SkinnedMesh(geometry, material)
    actor.skeleton = new Skeleton([new Bone()])
    actor.skeleton.computeBoneTexture()
    actor.userData.directorMaterialIsolated = true
    const materialDispose = vi.spyOn(material, 'dispose')
    const skeletonDispose = vi.spyOn(actor.skeleton, 'dispose')
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const textureDispose = vi.spyOn(texture, 'dispose')
    disposeDirectorRig(actor)
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(skeletonDispose).toHaveBeenCalledOnce()
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(textureDispose).not.toHaveBeenCalled()
    geometry.dispose()
    texture.dispose()
  })
})
