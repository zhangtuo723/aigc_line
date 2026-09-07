import { useMemo } from 'react'
import * as THREE from 'three'
import type { DirectorElement } from '../../shared/director.types'
import { getDirectorFixtureParts, type DirectorPrimitivePart } from './director-primitive-parts'

const rampGeometry = new THREE.BufferGeometry()
rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  -0.5, 0, -0.5,
  0.5, 0, -0.5,
  -0.5, 0, 0.5,
  0.5, 0, 0.5,
  -0.5, 1, 0.5,
  0.5, 1, 0.5,
], 3))
rampGeometry.setIndex([
  0, 2, 3, 0, 3, 1,
  0, 1, 5, 0, 5, 4,
  2, 4, 5, 2, 5, 3,
  0, 4, 2,
  1, 3, 5,
])
rampGeometry.computeVertexNormals()

function Fixture({ element, parts }: { element: DirectorElement; parts: readonly DirectorPrimitivePart[] }) {
  const colors = useMemo(() => ({
    body: new THREE.Color(element.color),
    trim: new THREE.Color(element.color).multiplyScalar(0.78),
    cushion: new THREE.Color(element.color).lerp(new THREE.Color('#ffffff'), 0.14),
    accent: new THREE.Color(element.color).multiplyScalar(0.38),
  }), [element.color])
  return (
    <group>
      {parts.map((part) => (
        <mesh key={part.id} name={part.id} castShadow receiveShadow position={part.position}>
          <boxGeometry args={part.size} />
          <meshStandardMaterial color={colors[part.tone ?? 'body']} roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

/** Geometry is local to the single transform/selection root owned by Element. */
export function DirectorPrimitive({ element }: { element: DirectorElement }) {
  const parts = getDirectorFixtureParts(element.kind)
  if (parts) return <Fixture element={element} parts={parts} />
  if (element.kind === 'box' || element.kind === 'wall' || element.kind === 'floor' || element.kind === 'platform') {
    return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
  }
  if (element.kind === 'sphere') {
    return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><sphereGeometry args={[0.5, 24, 16]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
  }
  if (element.kind === 'cylinder') {
    return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><cylinderGeometry args={[0.5, 0.5, 1, 24]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
  }
  if (element.kind === 'cone') {
    return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><coneGeometry args={[0.5, 1, 24]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
  }
  if (element.kind === 'capsule') {
    return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><capsuleGeometry args={[0.25, 0.5, 8, 16]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
  }
  if (element.kind === 'ramp') {
    return <mesh castShadow receiveShadow geometry={rampGeometry}><meshStandardMaterial color={element.color} roughness={0.78} /></mesh>
  }
  if (element.kind === 'stairs') {
    const count = 6
    return (
      <group>
        {Array.from({ length: count }, (_, index) => {
          const depth = 1 / count
          const height = (index + 1) / count
          return (
            <mesh key={index} castShadow receiveShadow position={[0, height / 2, -0.5 + depth * (index + 0.5)]}>
              <boxGeometry args={[1, height, depth]} />
              <meshStandardMaterial color={element.color} roughness={0.82} />
            </mesh>
          )
        })}
      </group>
    )
  }
  return null
}
