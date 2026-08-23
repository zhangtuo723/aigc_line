import { describe, expect, it } from 'vitest'
import { directorSceneDraftSchema } from '../src/shared/director-schema'
import { getNodeCapabilities } from '../src/shared/node-capabilities'
import { applyDirectorSceneDraft, createDefaultDirectorProject } from '../src/features/director/director-model'
import '../src/components/canvas-capabilities'

const validDraft = {
  summary: '近似为一间带长桌的房间',
  groundColor: '#303030',
  backgroundColor: '#101820',
  elements: [{
    kind: 'box',
    name: '长桌',
    color: '#6A4A32',
    placement: 'ground',
    transform: {
      position: { x: 0, y: 0.4, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2.4, y: 0.8, z: 1 },
    },
  }],
}

describe('director reference image scene draft', () => {
  it('accepts a valid Agent-produced scene draft', () => {
    expect(directorSceneDraftSchema.parse(validDraft)).toEqual(validDraft)
  })

  it('accepts the extended blocking primitives', () => {
    for (const kind of ['floor', 'platform', 'stairs', 'ramp', 'cone', 'capsule'] as const) {
      expect(directorSceneDraftSchema.parse({
        ...validDraft,
        elements: [{ ...validDraft.elements[0], kind, name: kind }],
      }).elements[0].kind).toBe(kind)
    }
  })

  it('forces ground primitives onto y=0 while preserving elevated structures', () => {
    const draft = directorSceneDraftSchema.parse({
      ...validDraft,
      elements: [
        validDraft.elements[0],
        {
          ...validDraft.elements[0],
          name: '屋顶',
          placement: 'elevated',
          transform: {
            ...validDraft.elements[0].transform,
            position: { x: 0, y: 3.2, z: 2 },
          },
        },
      ],
    })
    const project = applyDirectorSceneDraft(createDefaultDirectorProject(), 'image-1', draft)

    expect(project.elements.find((element) => element.name === '长桌')?.transform.position.y).toBe(0)
    expect(project.elements.find((element) => element.name === '屋顶')?.transform.position.y).toBe(3.2)
  })

  it('rejects unsupported actors and malformed colors', () => {
    expect(() => directorSceneDraftSchema.parse({
      ...validDraft,
      elements: [{ ...validDraft.elements[0], kind: 'actor', color: 'brown' }],
    })).toThrow()
    expect(() => directorSceneDraftSchema.parse({
      ...validDraft,
      elements: [{
        ...validDraft.elements[0],
        transform: { ...validDraft.elements[0].transform, scale: { x: -1, y: 1, z: 1 } },
      }],
    })).toThrow()
  })

  it('exposes Agent scene application without a separate vision-model action', () => {
    const actions = getNodeCapabilities('director')?.actions.map((action) => action.id)
    expect(actions).toContain('apply-scene-draft')
    expect(actions).not.toContain('build-scene-from-image')
  })
})
