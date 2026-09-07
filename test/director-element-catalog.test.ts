import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_ELEMENT_CATALOG,
  DIRECTOR_ELEMENT_KINDS,
  DIRECTOR_PRIMITIVE_KINDS,
} from '../src/shared/director-element-catalog'
import { directorElementKindSchema, directorProjectSchema, directorSceneDraftSchema } from '../src/shared/director-schema'
import {
  addDirectorElement,
  applyDirectorSceneDraft,
  createDefaultDirectorProject,
  createDirectorElement,
  duplicateDirectorElement,
  normalizeDirectorProject,
  patchDirectorShot,
  upsertDirectorActorTrack,
  validateDirectorProject,
} from '../src/features/director/director-model'
import { getNodeCapabilities } from '../src/shared/node-capabilities'
import { buildSystemPromptAppend } from '../electron/main/services/agent/prompts'
import '../src/components/canvas-capabilities'

const interiorKinds = ['doorframe', 'windowframe', 'table', 'chair', 'sofa', 'bed', 'cabinet', 'railing'] as const

describe('director indoor and architectural elements', () => {
  it('preserves every catalog element through strict storage parsing and project reopening', () => {
    const project = {
      ...createDefaultDirectorProject('室内预演'),
      elements: DIRECTOR_ELEMENT_KINDS.map((kind, index) => createDirectorElement(kind, index)),
    }
    const serialized = JSON.parse(JSON.stringify(project))
    expect(directorProjectSchema.parse(serialized)).toEqual(serialized)
    const reopened = normalizeDirectorProject(serialized)
    expect(reopened.elements).toEqual(serialized.elements)
    expect(validateDirectorProject(reopened)).toEqual([])
    expect(DIRECTOR_ELEMENT_CATALOG.map((entry) => entry.kind)).toEqual(DIRECTOR_ELEMENT_KINDS)
  })

  it('accepts the new elements through Agent kind validation, capabilities and scene drafts', () => {
    const actions = getNodeCapabilities('director')!.actions
    const addDescription = actions.find((action) => action.id === 'add-element')!.description!
    const draftDescription = actions.find((action) => action.id === 'apply-scene-draft')!.description!
    const systemPrompt = buildSystemPromptAppend('project')
    const draft = directorSceneDraftSchema.parse({
      summary: '带门窗、客厅、卧室和护栏的室内场景',
      elements: interiorKinds.map((kind, index) => {
        expect(directorElementKindSchema.parse(kind)).toBe(kind)
        expect(addDescription).toContain(kind)
        expect(draftDescription).toContain(kind)
        expect(systemPrompt).toContain(kind)
        const element = createDirectorElement(kind, index)
        return {
          kind,
          name: element.name,
          color: element.color,
          placement: kind === 'windowframe' ? 'elevated' : 'ground',
          transform: { ...element.transform, position: { x: index * 2, y: 1.1, z: 0 } },
        }
      }),
    })
    const applied = applyDirectorSceneDraft(createDefaultDirectorProject(), 'room-reference', draft)
    expect(applied.elements.map((element) => element.kind)).toEqual(interiorKinds)
    for (const element of applied.elements) {
      expect(element.referenceNodeId).toBe('room-reference')
      expect(element.transform.position.y).toBe(element.kind === 'windowframe' ? 1.1 : 0)
    }
    expect(validateDirectorProject(applied)).toEqual([])
    expect(DIRECTOR_PRIMITIVE_KINDS).not.toContain('actor')
    expect(() => directorElementKindSchema.parse('unsupported-furniture')).toThrow()
  })

  it('copies an actor without changing the original or duplicating Shot paths and camera targets', () => {
    const actor = { ...createDirectorElement('actor', 0), bodyType: 'heavy' as const, poseId: 'wave' as const }
    let project = addDirectorElement(createDefaultDirectorProject(), actor)
    project = upsertDirectorActorTrack(project, project.activeShotId, {
      id: 'actor-path', elementId: actor.id, startFrame: 0, endFrame: 24,
      points: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
      interpolation: 'linear', orientToPath: true, motion: 'walk',
    })
    project = patchDirectorShot(project, project.activeShotId, {
      cameraConstraint: { ...project.shots[0].cameraConstraint, mode: 'follow', targetElementId: actor.id },
    })
    const original = structuredClone(project)
    const result = duplicateDirectorElement(project, actor.id)
    const duplicate = result.elements[1]
    expect(project).toEqual(original)
    expect(result.shots).toBe(project.shots)
    expect(result.elements[0]).toBe(actor)
    expect(duplicate).toMatchObject({ bodyType: 'heavy', poseId: 'wave', name: `${actor.name} 副本` })
    expect(duplicate.id).not.toBe(actor.id)
    expect(duplicate.transform.position.x).toBe(actor.transform.position.x + 1)
    expect(result.shots[0].actorTracks).toHaveLength(1)
    expect(result.shots[0].cameraConstraint.targetElementId).toBe(actor.id)
    duplicate.transform.rotation.y = 90
    duplicate.transform.scale.x = 2
    expect(project).toEqual(original)
    expect(validateDirectorProject(result)).toEqual([])
  })

  it('keeps copied reference furniture when rebuilding the original reference scene', () => {
    const table = createDirectorElement('table', 0)
    const draft = directorSceneDraftSchema.parse({
      summary: '桌子',
      elements: [{ kind: table.kind, name: table.name, color: table.color, placement: 'ground', transform: table.transform }],
    })
    const generated = applyDirectorSceneDraft(createDefaultDirectorProject(), 'image-1', draft)
    const copied = duplicateDirectorElement(generated, generated.elements[0].id)
    const duplicate = copied.elements[1]
    expect('referenceNodeId' in duplicate).toBe(false)
    const rebuilt = applyDirectorSceneDraft(copied, 'image-1', draft)
    expect(rebuilt.elements).toHaveLength(2)
    expect(rebuilt.elements.find((element) => element.id === duplicate.id)).toEqual(duplicate)
    expect(rebuilt.elements.some((element) => element.id === generated.elements[0].id)).toBe(false)
  })

  it('refuses to copy locked or missing elements and isolates default dimensions between additions', () => {
    const chair = { ...createDirectorElement('chair', 0), locked: true }
    const project = addDirectorElement(createDefaultDirectorProject(), chair)
    expect(duplicateDirectorElement(project, chair.id)).toBe(project)
    expect(duplicateDirectorElement(project, 'missing')).toBe(project)
    chair.transform.scale.x = 8
    expect(createDirectorElement('chair', 1).transform.scale.x).toBe(0.5)
  })
})
