import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DIRECTOR_FIXTURE_PARTS, getDirectorFixtureParts, type DirectorFixtureKind } from '../src/features/director/director-primitive-parts'

const fixtures: THREE.Group[] = []

function fixture(kind: DirectorFixtureKind) {
  const group = new THREE.Group()
  for (const part of DIRECTOR_FIXTURE_PARTS[kind]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...part.size), new THREE.MeshBasicMaterial())
    mesh.name = part.id
    mesh.position.set(...part.position)
    group.add(mesh)
  }
  group.updateMatrixWorld(true)
  fixtures.push(group)
  return group
}

function raycast(group: THREE.Group, origin: [number, number, number], direction: [number, number, number]) {
  return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(group, true)
}

afterEach(() => {
  for (const group of fixtures.splice(0)) {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      object.material.dispose()
    })
  }
})

describe('director room and architecture primitives', () => {
  it.each(Object.keys(DIRECTOR_FIXTURE_PARTS) as DirectorFixtureKind[])('%s uses complete outer dimensions and a bottom anchor after scaling', (kind) => {
    const group = fixture(kind)
    const localBounds = new THREE.Box3().setFromObject(group, true)
    for (const axis of ['x', 'z'] as const) {
      expect(localBounds.min[axis]).toBeCloseTo(-0.5, 6)
      expect(localBounds.max[axis]).toBeCloseTo(0.5, 6)
    }
    expect(localBounds.min.y).toBeCloseTo(0, 6)
    expect(localBounds.max.y).toBeCloseTo(1, 6)

    group.position.set(2, 0.4, -3)
    group.scale.set(1.2, 2.2, 0.2)
    group.updateMatrixWorld(true)
    const worldBounds = new THREE.Box3().setFromObject(group, true)
    expect(worldBounds.min.y).toBeCloseTo(0.4, 6)
    const size = worldBounds.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(1.2, 6)
    expect(size.y).toBeCloseTo(2.2, 6)
    expect(size.z).toBeCloseTo(0.2, 6)
  })

  it.each(['doorframe', 'windowframe'] as const)('%s has a real opening and hittable frame surfaces', (kind) => {
    const group = fixture(kind)
    expect(raycast(group, [0, 0.5, 2], [0, 0, -1])).toHaveLength(0)
    expect(raycast(group, [0, 0.5, -2], [0, 0, 1])).toHaveLength(0)
    expect(raycast(group, [-0.47, 0.5, 2], [0, 0, -1])[0]?.object.name).toBe('left-jamb')
    expect(raycast(group, [0, 0.98, 2], [0, 0, -1])[0]?.object.name).toBe('lintel')
  })

  it('leaves the doorway open down to the ground', () => {
    expect(raycast(fixture('doorframe'), [0, 0.01, 2], [0, 0, -1])).toHaveLength(0)
    expect(raycast(fixture('windowframe'), [0, 0.01, 2], [0, 0, -1])[0]?.object.name).toBe('sill')
  })

  it('keeps railing gaps open while its balusters and handrail receive ray hits', () => {
    const group = fixture('railing')
    expect(raycast(group, [0.075, 0.5, 2], [0, 0, -1])).toHaveLength(0)
    expect(raycast(group, [0, 0.5, 2], [0, 0, -1])[0]?.object.name).toBe('baluster-2')
    expect(raycast(group, [0.075, 0.95, 2], [0, 0, -1])[0]?.object.name).toBe('top-rail')
  })

  it.each([
    ['table', 0, 1, 'top'],
    ['chair', 0, 0.53, 'seat'],
    ['sofa', 0.2, 0.54, 'right-seat'],
    ['bed', 0, 0.63, 'mattress'],
  ] as const)('%s exposes its usable top surface for path drawing', (kind, x, y, name) => {
    const first = raycast(fixture(kind), [x, 2, 0], [0, -1, 0])[0]
    expect(first.object.name).toBe(name)
    expect(first.point.y).toBeCloseTo(y, 6)
  })

  it('puts seat backs and the headboard on -Z, and cabinet doors on +Z', () => {
    for (const kind of ['chair', 'sofa', 'bed'] as const) {
      const hit = raycast(fixture(kind), [0, 0.85, 2], [0, 0, -1])[0]
      expect(hit.point.z).toBeLessThan(0)
    }
    const cabinet = raycast(fixture('cabinet'), [0.235, 0.5, 2], [0, 0, -1])[0]
    expect(cabinet.object.name).toBe('right-door')
    expect(cabinet.point.z).toBeGreaterThan(0)
  })

  it('only resolves explicitly registered fixtures', () => {
    expect(getDirectorFixtureParts('table')).toBe(DIRECTOR_FIXTURE_PARTS.table)
    expect(getDirectorFixtureParts('box')).toBeUndefined()
    expect(getDirectorFixtureParts('constructor')).toBeUndefined()
  })
})
