import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Grid, Line, OrbitControls, PerspectiveCamera, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import type {
  DirectorActorTrack,
  DirectorActorModelId,
  DirectorAspectRatio,
  DirectorBodyType,
  DirectorCameraConstraintMode,
  DirectorElement,
  DirectorElementKind,
  DirectorPoseId,
  DirectorProject,
  DirectorShot,
  DirectorTransformMode,
  DirectorVec3,
} from '../../shared/director.types'
import {
  activateDirectorShot,
  addDirectorElement,
  createDirectorElement,
  createDirectorShot,
  directorActorPathPoints,
  DIRECTOR_ASPECT_RATIOS,
  DIRECTOR_ACTOR_MODEL_OPTIONS,
  DIRECTOR_BODY_TYPE_OPTIONS,
  DIRECTOR_POSES,
  directorCropRect,
  directorId,
  type DirectorCameraView,
  directorMaxFrame,
  type DirectorCropRect,
  normalizeDirectorProject,
  patchDirectorShot,
  removeDirectorActorTrack,
  removeDirectorCameraKeyframe,
  sampleDirectorActorTransform,
  sampleDirectorConstrainedCamera,
  removeDirectorElement,
  updateDirectorElement,
  upsertDirectorActorTrack,
  upsertDirectorCameraKeyframe,
  validateDirectorProject,
  vec3,
} from './director-model'
import { directorBodyProfile } from './actor-model'
import { directorLightweightFootOffset, type DirectorMannequinPose } from './actor-foot-anchor'
import { RiggedActorModel } from './RiggedActorModel'

type ViewMode = 'director' | 'camera'

interface DirectorStageDialogProps {
  project: DirectorProject
  onChange: (project: DirectorProject) => void
  onClose: () => void
  onCapture: (pngDataUrl: string, shot: DirectorShot, project: DirectorProject) => Promise<string>
  onExportVideo: (webmData: ArrayBuffer, shot: DirectorShot, project: DirectorProject) => Promise<string>
  referenceImages: Array<{ nodeId: string; title: string; sourcePath: string; preview?: string }>
  agentBusy: boolean
  onRequestAgentScene: (reference: { nodeId: string; title: string; sourcePath: string }, instruction: string) => Promise<void>
}

const clone = <T,>(value: T): T => structuredClone(value)
const vector = (value: DirectorVec3): [number, number, number] => [value.x, value.y, value.z]
const degrees = (radians: number): number => Math.round(THREE.MathUtils.radToDeg(radians) * 1000) / 1000
const radians = (value: DirectorVec3): [number, number, number] => (
  [THREE.MathUtils.degToRad(value.x), THREE.MathUtils.degToRad(value.y), THREE.MathUtils.degToRad(value.z)]
)

const STAGE_ELEMENT_TOOLS: Array<{ kind: DirectorElementKind; label: string; shortLabel: string }> = [
  { kind: 'actor', label: '添加演员', shortLabel: '演员' },
  { kind: 'crowd', label: '添加群众阵列', shortLabel: '群众' },
  { kind: 'box', label: '添加立方体', shortLabel: '立方体' },
  { kind: 'sphere', label: '添加球体', shortLabel: '球体' },
  { kind: 'cylinder', label: '添加圆柱体', shortLabel: '圆柱' },
  { kind: 'wall', label: '添加墙体', shortLabel: '墙体' },
  { kind: 'floor', label: '添加地面', shortLabel: '地面' },
  { kind: 'platform', label: '添加平台', shortLabel: '平台' },
  { kind: 'stairs', label: '添加楼梯', shortLabel: '楼梯' },
  { kind: 'ramp', label: '添加斜坡', shortLabel: '斜坡' },
  { kind: 'cone', label: '添加圆锥体', shortLabel: '圆锥' },
  { kind: 'capsule', label: '添加胶囊体', shortLabel: '胶囊' },
]

const TIMELINE_HEADER_WIDTH = 112

function formatTimelineTimecode(frame: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps))
  const safeFrame = Math.max(0, Math.floor(frame))
  const totalSeconds = Math.floor(safeFrame / safeFps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const frames = safeFrame % safeFps
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

function createTimelineTicks(durationSec: number): Array<{ seconds: number; label: string }> {
  const safeDuration = Math.max(0, durationSec)
  const targetStep = safeDuration / 8
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((candidate) => candidate >= targetStep) ?? 60
  const ticks = Array.from(
    { length: Math.floor(safeDuration / step) + 1 },
    (_, index) => index * step,
  )
  if (ticks[ticks.length - 1] !== safeDuration) ticks.push(safeDuration)
  return ticks.map((seconds) => ({
    seconds,
    label: seconds < 60
      ? `${seconds.toFixed(step < 1 ? 1 : 0)}s`
      : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`,
  }))
}

const POSE_ROTATIONS: Record<DirectorPoseId, DirectorMannequinPose> = {
  stand: { leftArm: [0, 0, -0.08], rightArm: [0, 0, 0.08] },
  walk: { leftArm: [0.5, 0, -0.08], rightArm: [-0.5, 0, 0.08], leftLeg: [-0.42, 0, 0], rightLeg: [0.42, 0, 0] },
  sit: { leftLeg: [-1.4, 0, 0], rightLeg: [-1.4, 0, 0], leftKnee: [1.35, 0, 0], rightKnee: [1.35, 0, 0] },
  'arms-crossed': { leftArm: [0.1, -0.35, -1.2], rightArm: [0.1, 0.35, 1.2], leftForearm: [-1.45, 0, 0], rightForearm: [-1.45, 0, 0] },
  point: { leftArm: [0, 0, -1.45], rightArm: [0, 0, 0.12] },
  // Lower the pelvis, keep the left foot planted in front and place the right
  // knee on the floor with its shin trailing behind. Foot counter-rotations
  // keep both shoes readable instead of inheriting the shin angle.
  kneel: {
    leftLeg: [-1, 0, 0],
    leftKnee: [1.9, 0, 0],
    leftFoot: [-0.9, 0, 0],
    rightLeg: [-0.3, 0, 0],
    rightKnee: [1.75, 0, 0],
    rightFoot: [-1.45, 0, 0],
  },
  'hands-on-hips': {
    leftArm: [0.2, -0.25, -0.95], rightArm: [0.2, 0.25, 0.95],
    leftForearm: [-1.35, 0, -0.2], rightForearm: [-1.35, 0, 0.2],
  },
  wave: { rightArm: [0, 0, 2.5], rightForearm: [-1.25, 0, 0.25], leftArm: [0, 0, -0.08] },
  'hands-up': { leftArm: [0, 0, 2.7], rightArm: [0, 0, -2.7], leftForearm: [0.15, 0, 0], rightForearm: [0.15, 0, 0] },
  crouch: {
    leftLeg: [-0.92, 0, 0.12], rightLeg: [-0.92, 0, -0.12],
    leftKnee: [1.65, 0, 0], rightKnee: [1.65, 0, 0],
  },
  lean: { leftArm: [0.18, 0, -0.18], rightArm: [0.18, 0, 0.18], leftLeg: [0.12, 0, 0], rightLeg: [-0.12, 0, 0] },
  'look-back': { leftArm: [0.1, 0, -0.08], rightArm: [-0.15, 0, 0.08], leftLeg: [-0.1, 0, 0], rightLeg: [0.1, 0, 0] },
}

function Limb({
  length,
  radius,
  color,
  rotation = [0, 0, 0],
  children,
}: {
  length: number
  radius: number
  color: string
  rotation?: [number, number, number]
  children?: React.ReactNode
}) {
  return (
    <group rotation={rotation}>
      <mesh position={[0, -length / 2, 0]} castShadow>
        <capsuleGeometry args={[radius, Math.max(0.01, length - radius * 2), 6, 10]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <group position={[0, -length, 0]}>{children}</group>
    </group>
  )
}

function Foot({ rotation = [0, 0, 0] }: { rotation?: [number, number, number] }) {
  return (
    <group rotation={rotation}>
      <mesh position={[0, 0.035, 0.085]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.07, 0.29]} />
        <meshStandardMaterial color="#171c27" roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.036, 0.235]} castShadow receiveShadow>
        <sphereGeometry args={[0.07, 12, 8]} />
        <meshStandardMaterial color="#242b39" roughness={0.75} />
      </mesh>
    </group>
  )
}

function FaceMarkers() {
  return (
    <group position={[0, 1.58, 0.118]}>
      <mesh position={[-0.058, 0.025, 0]}>
        <torusGeometry args={[0.045, 0.008, 6, 18]} />
        <meshStandardMaterial color="#24242a" roughness={0.55} />
      </mesh>
      <mesh position={[0.058, 0.025, 0]}>
        <torusGeometry args={[0.045, 0.008, 6, 18]} />
        <meshStandardMaterial color="#24242a" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.025, 0]}>
        <boxGeometry args={[0.035, 0.009, 0.012]} />
        <meshStandardMaterial color="#24242a" roughness={0.55} />
      </mesh>
      <mesh position={[0, -0.066, 0.014]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.008, 0.055, 4, 10]} />
        <meshStandardMaterial color="#8e3f43" roughness={0.7} />
      </mesh>
    </group>
  )
}

function Mannequin({
  color,
  poseId = 'stand',
  height = 1.72,
  motionPhase,
  bodyType = 'standard',
  modelId = 'director-rig-v1',
}: {
  color: string
  poseId?: DirectorPoseId
  height?: number
  motionPhase?: number
  bodyType?: DirectorBodyType
  modelId?: DirectorActorModelId
}) {
  const profile = directorBodyProfile(bodyType)
  const lightweight = modelId === 'lightweight-v1'
  const basePose = POSE_ROTATIONS[poseId]
  const swing = motionPhase === undefined ? 0.48 : Math.sin(motionPhase * Math.PI * 2) * 0.58
  const pose: DirectorMannequinPose = poseId === 'walk' ? {
    ...basePose,
    leftArm: [-swing, 0, -0.08],
    rightArm: [swing, 0, 0.08],
    leftLeg: [swing * 0.82, 0, 0],
    rightLeg: [-swing * 0.82, 0, 0],
  } : basePose
  const unit = height / profile.defaultHeightM
  const legLength = profile.legLength
  // Keep the actor root stable while the gait cycles; per-frame grounding
  // would move the whole body up and down and read as path jitter.
  const groundingPose = poseId === 'walk' ? basePose : pose
  const footOffset = directorLightweightFootOffset(groundingPose, legLength)
  return (
    <group scale={unit} position={[0, footOffset, 0]} rotation={poseId === 'lean' ? [-0.22, 0, 0] : poseId === 'look-back' ? [0, 0.42, 0] : [0, 0, 0]}>
      <mesh position={[0, 1.58, 0]} scale={[profile.head, profile.head, profile.head]} castShadow>
        <sphereGeometry args={[0.13, 18, 12]} />
        <meshStandardMaterial color="#d8b5a0" roughness={0.82} />
      </mesh>
      {!lightweight && <group scale={[profile.head, profile.head, profile.head]} position={[0, 1.58 * (1 - profile.head), 0]}><FaceMarkers /></group>}
      <mesh position={[0, 1.12, 0]} scale={[profile.torsoWidth, profile.torsoLength, profile.torsoDepth]} castShadow>
        <capsuleGeometry args={[0.18, 0.46, 8, 12]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {!lightweight && profile.belly > 0 && <mesh position={[0, 1.03, 0.105]} scale={[0.28 * profile.torsoWidth, 0.3, 0.24 * profile.torsoDepth]} castShadow><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color={color} roughness={0.72} /></mesh>}
      <group position={[-0.23 * profile.shoulder, 1.32, 0]}>
        <Limb length={0.42 * profile.armLength} radius={0.055 * profile.armThickness} color={color} rotation={pose.leftArm}>
          <Limb length={0.38 * profile.armLength} radius={0.048 * profile.armThickness} color="#d8b5a0" rotation={pose.leftForearm} />
        </Limb>
      </group>
      <group position={[0.23 * profile.shoulder, 1.32, 0]}>
        <Limb length={0.42 * profile.armLength} radius={0.055 * profile.armThickness} color={color} rotation={pose.rightArm}>
          <Limb length={0.38 * profile.armLength} radius={0.048 * profile.armThickness} color="#d8b5a0" rotation={pose.rightForearm} />
        </Limb>
      </group>
      <group position={[-0.11 * profile.hipWidth, 0.84, 0]}>
        <Limb length={0.46 * legLength} radius={0.075 * profile.legThickness} color="#303744" rotation={pose.leftLeg}>
          <Limb length={0.45 * legLength} radius={0.065 * profile.legThickness} color="#303744" rotation={pose.leftKnee}>
            <Foot rotation={pose.leftFoot} />
          </Limb>
        </Limb>
      </group>
      <group position={[0.11 * profile.hipWidth, 0.84, 0]}>
        <Limb length={0.46 * legLength} radius={0.075 * profile.legThickness} color="#303744" rotation={pose.rightLeg}>
          <Limb length={0.45 * legLength} radius={0.065 * profile.legThickness} color="#303744" rotation={pose.rightKnee}>
            <Foot rotation={pose.rightFoot} />
          </Limb>
        </Limb>
      </group>
    </group>
  )
}

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

function Primitive({ element }: { element: DirectorElement }) {
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

class ActorModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function ElementVisual({ element, motionPhase }: { element: DirectorElement; motionPhase?: number }) {
  if (element.kind === 'actor') {
    const fallback = <Mannequin color={element.color} height={element.heightM} poseId={element.poseId} motionPhase={motionPhase} bodyType={element.bodyType} modelId="lightweight-v1" />
    if (element.actorModelId === 'lightweight-v1') return fallback
    return (
      <ActorModelBoundary fallback={fallback}>
        <RiggedActorModel color={element.color} height={element.heightM} poseId={element.poseId} motionPhase={motionPhase} bodyType={element.bodyType} />
      </ActorModelBoundary>
    )
  }
  if (element.kind === 'crowd') {
    const rows = element.rows ?? 2
    const columns = element.columns ?? 4
    const spacing = element.spacing ?? 1.25
    return (
      <group>
        {Array.from({ length: rows * columns }, (_, index) => (
          <group key={index} position={[(index % columns) * spacing, 0, Math.floor(index / columns) * spacing]}>
            <Mannequin color={element.color} height={element.heightM} poseId={element.poseId} bodyType={element.bodyType} modelId="lightweight-v1" />
          </group>
        ))}
      </group>
    )
  }
  return <Primitive element={element} />
}

function SceneElement({
  element,
  motionPhase,
  selected,
  mode,
  helpersVisible,
  onSelect,
  onPathPoint,
  onTransformStart,
  onTransformEnd,
  onTransform,
}: {
  element: DirectorElement
  motionPhase?: number
  selected: boolean
  mode: DirectorTransformMode
  helpersVisible: boolean
  onSelect: () => void
  onPathPoint?: (point: DirectorVec3) => void
  onTransformStart: () => void
  onTransformEnd: () => void
  onTransform: (element: DirectorElement) => void
}) {
  const objectRef = useRef<THREE.Group>(null!)
  const draggingRef = useRef(false)
  const pendingTransformRef = useRef<DirectorElement['transform'] | null>(null)
  const elementRef = useRef(element)
  const onTransformRef = useRef(onTransform)
  const onTransformEndRef = useRef(onTransformEnd)
  elementRef.current = element
  onTransformRef.current = onTransform
  onTransformEndRef.current = onTransformEnd

  const readObjectTransform = (): DirectorElement['transform'] | null => {
    const object = objectRef.current
    if (!object) return null
    return {
      position: vec3(object.position.x, object.position.y, object.position.z),
      rotation: vec3(degrees(object.rotation.x), degrees(object.rotation.y), degrees(object.rotation.z)),
      scale: vec3(object.scale.x, object.scale.y, object.scale.z),
    }
  }

  const finishTransform = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const nextTransform = pendingTransformRef.current ?? readObjectTransform()
    pendingTransformRef.current = null
    if (nextTransform) {
      onTransformRef.current({ ...elementRef.current, transform: nextTransform })
    }
    onTransformEndRef.current()
  }

  useEffect(() => {
    const finish = () => finishTransform()
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
    }
  }, [])
  const content = (
    <group
      ref={objectRef}
      position={vector(element.transform.position)}
      rotation={radians(element.transform.rotation)}
      scale={vector(element.transform.scale)}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        if (onPathPoint && event.nativeEvent.ctrlKey) {
          onPathPoint(vec3(event.point.x, event.point.y, event.point.z))
        }
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (onPathPoint) return
        onSelect()
      }}
    >
      <ElementVisual element={element} motionPhase={motionPhase} />
    </group>
  )
  if (!selected || element.locked || !helpersVisible) return content
  return (
    <>
      {content}
      <TransformControls
        object={objectRef}
        mode={mode}
        onMouseDown={() => {
          draggingRef.current = true
          pendingTransformRef.current = readObjectTransform()
          onTransformStart()
        }}
        onObjectChange={() => { pendingTransformRef.current = readObjectTransform() }}
        onMouseUp={finishTransform}
      />
    </>

  )
}

function ActorPathPoint({
  point,
  index,
  selected,
  editable,
  onSelect,
  onMove,
}: {
  point: DirectorVec3
  index: number
  selected: boolean
  editable: boolean
  onSelect: () => void
  onMove: (point: DirectorVec3) => void
}) {
  const objectRef = useRef<THREE.Group>(null!)
  const pendingRef = useRef<DirectorVec3 | null>(null)
  const draggingRef = useRef(false)
  useEffect(() => {
    if (!draggingRef.current) objectRef.current?.position.set(point.x, point.y + 0.035, point.z)
  }, [point])
  const finish = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const next = pendingRef.current
    pendingRef.current = null
    if (next) onMove(next)
  }
  const marker = (
    <group
      ref={objectRef}
      position={[point.x, point.y + 0.035, point.z]}
      onPointerDown={(event) => { event.stopPropagation(); onSelect() }}
    >
      <mesh>
        <sphereGeometry args={[index === 0 ? 0.1 : 0.075, 12, 8]} />
        <meshStandardMaterial color={selected ? '#fff7cf' : index === 0 ? '#fff1a8' : '#d4af37'} emissive={selected ? '#9b7914' : '#5f4b09'} />
      </mesh>
    </group>
  )
  if (!editable || !selected) return marker
  return (
    <>
      {marker}
      <TransformControls
        object={objectRef}
        mode="translate"
        onMouseDown={() => { draggingRef.current = true }}
        onObjectChange={() => {
          const position = objectRef.current.position
          pendingRef.current = vec3(position.x, position.y - 0.035, position.z)
        }}
        onMouseUp={finish}
      />
    </>
  )
}

function ActorPathGuide({
  track,
  editable,
  selectedPointIndex,
  onSelectPoint,
  onMovePoint,
}: {
  track: DirectorActorTrack
  editable: boolean
  selectedPointIndex: number | null
  onSelectPoint: (index: number) => void
  onMovePoint: (index: number, point: DirectorVec3) => void
}) {
  const points = directorActorPathPoints(track).map((point) => [point.x, point.y + 0.035, point.z] as [number, number, number])
  if (points.length < 2) return null
  return (
    <group>
      <Line points={points} color="#e8c766" lineWidth={2.5} />
      {track.points.map((point, index) => (
        <ActorPathPoint
          key={index}
          point={point}
          index={index}
          editable={editable}
          selected={selectedPointIndex === index}
          onSelect={() => onSelectPoint(index)}
          onMove={(next) => onMovePoint(index, next)}
        />
      ))}
    </group>
  )
}

function CameraPathGuide({ shot, elements, fps }: { shot: DirectorShot; elements: DirectorElement[]; fps: number }) {
  const maxFrame = directorMaxFrame(shot, fps)
  const step = Math.max(1, Math.floor(maxFrame / 48))
  const frames = Array.from({ length: Math.ceil(maxFrame / step) + 1 }, (_, index) => Math.min(maxFrame, index * step))
  if (frames[frames.length - 1] !== maxFrame) frames.push(maxFrame)
  const points = frames.map((frame) => {
    const position = sampleDirectorConstrainedCamera(shot, elements, frame).position
    return [position.x, position.y, position.z] as [number, number, number]
  })
  if (points.length < 2) return null
  return <Line points={points} color="#78bfff" lineWidth={1.5} dashed dashSize={0.16} gapSize={0.1} />
}

function CameraRig({ view, rollDeg }: { view: { position: DirectorVec3; target: DirectorVec3; fov: number }; rollDeg: number }) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null!)
  // Position, orientation and projection must land in the same commit. A passive
  // effect lets R3F render one frame with the new position and the old look-at,
  // which presents as a forward/backward flash during playback.
  useLayoutEffect(() => {
    const camera = cameraRef.current
    if (!camera) return
    camera.position.set(view.position.x, view.position.y, view.position.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(view.target.x, view.target.y, view.target.z)
    camera.rotateZ(THREE.MathUtils.degToRad(rollDeg))
    camera.fov = view.fov
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
  }, [rollDeg, view])
  return <PerspectiveCamera ref={cameraRef} makeDefault />
}

function CameraMarker({
  shot,
  view,
  active,
  selected,
  mode,
  onSelect,
  onTransform,
}: {
  shot: DirectorShot
  view: { position: DirectorVec3; target: DirectorVec3; fov: number }
  active: boolean
  selected: boolean
  mode: DirectorTransformMode
  onSelect: () => void
  onTransform: (view: { position: DirectorVec3; target: DirectorVec3; fov: number }, rollDeg: number) => void
}) {
  const objectRef = useRef<THREE.Group>(null!)
  const draggingRef = useRef(false)
  const pendingRef = useRef<{ view: { position: DirectorVec3; target: DirectorVec3; fov: number }; rollDeg: number } | null>(null)
  const viewRef = useRef(view)
  const shotRef = useRef(shot)
  const onTransformRef = useRef(onTransform)
  viewRef.current = view
  shotRef.current = shot
  onTransformRef.current = onTransform

  useEffect(() => {
    const object = objectRef.current
    if (!object || draggingRef.current) return
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(view.position.x, view.position.y, view.position.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(view.target.x, view.target.y, view.target.z)
    camera.rotateZ(THREE.MathUtils.degToRad(shot.rollDeg))
    object.position.copy(camera.position)
    object.quaternion.copy(camera.quaternion)
  }, [shot.rollDeg, view])

  const readCamera = () => {
    const object = objectRef.current
    if (!object) return null
    const position = object.position.clone()
    const distance = Math.max(0.25, new THREE.Vector3(
      viewRef.current.target.x - viewRef.current.position.x,
      viewRef.current.target.y - viewRef.current.position.y,
      viewRef.current.target.z - viewRef.current.position.z,
    ).length())
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(object.quaternion).normalize()
    const target = position.clone().add(direction.multiplyScalar(distance))
    const baseCamera = new THREE.PerspectiveCamera()
    baseCamera.position.copy(position)
    baseCamera.up.set(0, 1, 0)
    baseCamera.lookAt(target)
    const localRotation = baseCamera.quaternion.clone().invert().multiply(object.quaternion)
    const rollDeg = degrees(new THREE.Euler().setFromQuaternion(localRotation, 'XYZ').z)
    return {
      view: {
        position: vec3(position.x, position.y, position.z),
        target: vec3(target.x, target.y, target.z),
        fov: viewRef.current.fov,
      },
      rollDeg,
    }
  }

  const finishTransform = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const next = pendingRef.current ?? readCamera()
    pendingRef.current = null
    if (next) onTransformRef.current(next.view, next.rollDeg)
  }

  useEffect(() => {
    const finish = () => finishTransform()
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
    }
  }, [])

  const marker = (
    <group ref={objectRef} onPointerDown={(event) => { event.stopPropagation(); onSelect() }}>
      <mesh>
        <boxGeometry args={[0.32, 0.22, 0.45]} />
        <meshStandardMaterial color={active ? '#e8c766' : '#76839b'} emissive={active ? '#604d0e' : '#000000'} />
      </mesh>
      <mesh position={[0, 0, -0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.16, 0.28, 16]} />
        <meshStandardMaterial color={active ? '#f0d98c' : '#9aa4b6'} />
      </mesh>
    </group>
  )
  if (!selected || mode === 'scale' || shot.locked) return marker
  return (
    <>
      {marker}
      <TransformControls
        object={objectRef}
        mode={mode}
        onMouseDown={() => { draggingRef.current = true; pendingRef.current = readCamera() }}
        onObjectChange={() => { pendingRef.current = readCamera() }}
        onMouseUp={finishTransform}
      />
    </>
  )
}

function cropCanvas(canvas: HTMLCanvasElement, aspect: DirectorAspectRatio): string {
  const rect = directorCropRect(canvas.width, canvas.height, aspect)
  const output = document.createElement('canvas')
  const scale = Math.min(1, 1920 / Math.max(rect.width, rect.height))
  output.width = Math.max(1, Math.round(rect.width * scale))
  output.height = Math.max(1, Math.round(rect.height * scale))
  output.getContext('2d')?.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height)
  return output.toDataURL('image/png')
}

function NumberField({ label, value, step = 0.1, disabled = false, onChange }: { label: string; value: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[9px] uppercase tracking-wider text-white/35">
      {label}
      <input
        type="number"
        value={Number(value.toFixed(3))}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="nodrag min-w-0 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] normal-case text-white/75 outline-none focus:border-[#d4af37]/50"
      />
    </label>
  )
}

function VectorFields({ label, value, disabled = false, onChange }: { label: string; value: DirectorVec3; disabled?: boolean; onChange: (value: DirectorVec3) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-white/45">{label}</p>
      <div className="flex gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <NumberField key={axis} label={axis} value={value[axis]} disabled={disabled} onChange={(next) => onChange({ ...value, [axis]: next })} />
        ))}
      </div>
    </div>
  )
}

export function DirectorStageDialog({ project, onChange, onClose, onCapture, onExportVideo, referenceImages, agentBusy, onRequestAgentScene }: DirectorStageDialogProps) {
  const [draft, setDraft] = useState<DirectorProject>(() => normalizeDirectorProject(clone(project), project?.name))
  const [autoSaveState, setAutoSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(draft.elements[0]?.id ?? null)
  const [selectedCameraShotId, setSelectedCameraShotId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('director')
  const [transformMode, setTransformMode] = useState<DirectorTransformMode>('translate')
  const [capturing, setCapturing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sceneReferenceNodeId, setSceneReferenceNodeId] = useState(referenceImages[0]?.nodeId ?? '')
  const [sceneInstruction, setSceneInstruction] = useState('')
  const [sceneAnalysisError, setSceneAnalysisError] = useState('')
  const [captureError, setCaptureError] = useState('')
  const [currentFrame, setCurrentFrame] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [controlledCamera, setControlledCamera] = useState<DirectorCameraView | null>(null)
  const [cameraMoving, setCameraMoving] = useState(false)
  const [mouseLooking, setMouseLooking] = useState(false)
  const [pathEditingElementId, setPathEditingElementId] = useState<string | null>(null)
  const [selectedPathPointIndex, setSelectedPathPointIndex] = useState<number | null>(null)
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const draftRef = useRef(draft)
  const onChangeRef = useRef(onChange)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedUpdatedAtRef = useRef(draft.updatedAt)
  const transformingElementIdRef = useRef<string | null>(null)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null)
  const [frameRect, setFrameRect] = useState<DirectorCropRect | null>(null)
  const directorCameraRef = useRef<{ position: DirectorVec3; target: DirectorVec3; fov: number }>({
    position: vec3(7, 5, 9),
    target: vec3(0, 1, 0),
    fov: 48,
  })
  const cameraControlViewRef = useRef<DirectorCameraView | null>(null)
  const currentFrameRef = useRef(0)
  const playbackRunRef = useRef(0)
  const pressedMoveKeysRef = useRef(new Set<string>())
  const mouseLookRef = useRef({ dragging: false, x: 0, y: 0 })

  useEffect(() => {
    if (referenceImages.some((image) => image.nodeId === sceneReferenceNodeId)) return
    setSceneReferenceNodeId(referenceImages[0]?.nodeId ?? '')
  }, [referenceImages, sceneReferenceNodeId])

  const activeShot = draft.shots.find((shot) => shot.id === draft.activeShotId) ?? draft.shots[0]
  const maxFrame = activeShot ? directorMaxFrame(activeShot, draft.fps) : 0
  const timelineTicks = useMemo(
    () => createTimelineTicks(activeShot?.durationSec ?? 0),
    [activeShot?.durationSec],
  )
  const actorElements = useMemo(
    () => draft.elements.filter((element) => element.kind === 'actor'),
    [draft.elements],
  )
  const renderedElements = useMemo(() => activeShot
    ? draft.elements.map((element) => {
      if (element.kind !== 'actor') return element
      const track = activeShot.actorTracks.find((item) => item.elementId === element.id)
      if (!track) return element
      const moving = currentFrame >= track.startFrame && currentFrame < track.endFrame
      return {
        ...element,
        transform: sampleDirectorActorTransform(activeShot, element, currentFrame),
        poseId: moving ? 'walk' as const : element.poseId,
      }
    })
    : draft.elements, [activeShot, currentFrame, draft.elements])
  const sampledCamera = useMemo(
    () => activeShot ? sampleDirectorConstrainedCamera(activeShot, draft.elements, currentFrame) : null,
    [activeShot, currentFrame, draft.elements],
  )
  const displayedCamera = controlledCamera ?? sampledCamera
  const displayFrame = Math.min(maxFrame, Math.max(0, Math.floor(currentFrame + 1e-6)))
  const playheadKeyframe = activeShot?.cameraKeyframes.find((keyframe) => keyframe.frame === currentFrame)
  const busy = capturing || exporting
  currentFrameRef.current = currentFrame
  if (displayedCamera) cameraControlViewRef.current = displayedCamera
  const selected = draft.elements.find((element) => element.id === selectedId)
  const selectedActorTrack = selected && activeShot
    ? activeShot.actorTracks.find((track) => track.elementId === selected.id)
    : undefined
  const selectedActorPathPoint = selectedActorTrack && selectedPathPointIndex !== null
    ? selectedActorTrack.points[selectedPathPointIndex]
    : undefined
  const issues = validateDirectorProject(draft)
  draftRef.current = draft
  onChangeRef.current = onChange

  const selectElement = (elementId: string) => {
    const transformingId = transformingElementIdRef.current
    if (transformingId && transformingId !== elementId) return
    setSelectedId(elementId)
    setSelectedCameraShotId(null)
  }

  const beginElementTransform = (elementId: string) => {
    transformingElementIdRef.current = elementId
    // A transform handle can overlap another model in screen space. Reassert
    // the controlled element so that pointer-down cannot select that model.
    setSelectedId(elementId)
    setSelectedCameraShotId(null)
  }

  const endElementTransform = (elementId: string) => {
    if (transformingElementIdRef.current === elementId) transformingElementIdRef.current = null
  }

  const persistDirectorDraft = (source: DirectorProject): boolean => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    const next = source
    if (validateDirectorProject(next).length > 0) {
      setAutoSaveState('error')
      return false
    }
    setAutoSaveState('saving')
    try {
      onChangeRef.current(next)
      lastSavedUpdatedAtRef.current = source.updatedAt
      setLastAutoSavedAt(Date.now())
      setAutoSaveState('saved')
      return true
    } catch {
      setAutoSaveState('error')
      return false
    }
  }

  useEffect(() => {
    if (draft.updatedAt === lastSavedUpdatedAtRef.current) return
    if (validateDirectorProject(draft).length > 0) {
      setAutoSaveState('error')
      return
    }
    setAutoSaveState('pending')
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      persistDirectorDraft(draftRef.current)
    }, 600)
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [draft])

  const mutate = (recipe: (current: DirectorProject) => DirectorProject) => {
    setDraft((current) => ({ ...recipe(current), updatedAt: Date.now() }))
  }

  const updateElement = (next: DirectorElement) => {
    mutate((current) => updateDirectorElement(current, next))
  }
  const beginActorPath = () => {
    if (!activeShot || !selected || selected.kind !== 'actor' || selected.locked || activeShot.locked) return
    setViewMode('director')
    setIsPlaying(false)
    setPathEditingElementId(selected.id)
    if (selectedActorTrack) return
    const start = clone(selected.transform.position)
    mutate((current) => upsertDirectorActorTrack(current, activeShot.id, {
      id: directorId('actor-track'),
      elementId: selected.id,
      startFrame: Math.min(currentFrame, Math.max(0, maxFrame - 1)),
      endFrame: maxFrame,
      points: [start, clone(start)],
      interpolation: 'smooth',
      orientToPath: true,
      motion: 'walk',
    }))
  }

  const finishActorPath = () => {
    if (activeShot && pathEditingElementId) {
      const track = activeShot.actorTracks.find((item) => item.elementId === pathEditingElementId)
      const first = track?.points[0]
      const last = track?.points.at(-1)
      const onlyPlaceholder = track?.points.length === 2 && first && last
        && Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) <= 1e-6
      if (onlyPlaceholder) {
        mutate((current) => removeDirectorActorTrack(current, activeShot.id, pathEditingElementId))
      }
    }
    setPathEditingElementId(null)
    setSelectedPathPointIndex(null)
  }

  const updateSelectedActorTrack = (patch: Partial<DirectorActorTrack>) => {
    if (!activeShot || !selectedActorTrack) return
    mutate((current) => upsertDirectorActorTrack(current, activeShot.id, { ...selectedActorTrack, ...patch }))
  }

  const moveActorPathPoint = (index: number, point: DirectorVec3) => {
    if (!selectedActorTrack || activeShot?.locked || selected?.locked) return
    const points = selectedActorTrack.points.map((item, itemIndex) => itemIndex === index ? point : item)
    updateSelectedActorTrack({ points })
  }

  const appendActorPathPoint = (point: DirectorVec3) => {
    if (!activeShot || !pathEditingElementId) return
    const track = activeShot.actorTracks.find((item) => item.elementId === pathEditingElementId)
    if (!track) return
    const nextPoint = clone(point)
    const last = track.points[track.points.length - 1]
    if (last && Math.hypot(last.x - nextPoint.x, last.y - nextPoint.y, last.z - nextPoint.z) < 0.02) return
    const placeholder = track.points.length === 2
      && Math.hypot(
        track.points[0].x - track.points[1].x,
        track.points[0].y - track.points[1].y,
        track.points[0].z - track.points[1].z,
      ) <= 1e-6
    const points = placeholder ? [track.points[0], nextPoint] : [...track.points, nextPoint]
    mutate((current) => upsertDirectorActorTrack(current, activeShot.id, { ...track, points }))
    setSelectedPathPointIndex(points.length - 1)
  }

  const undoActorPathPoint = () => {
    if (!selectedActorTrack) return
    const points = selectedActorTrack.points.length > 2
      ? selectedActorTrack.points.slice(0, -1)
      : [selectedActorTrack.points[0], clone(selectedActorTrack.points[0])]
    updateSelectedActorTrack({ points })
  }

  const clearActorPath = () => {
    if (!activeShot || !selected) return
    setPathEditingElementId(null)
    setSelectedPathPointIndex(null)
    mutate((current) => removeDirectorActorTrack(current, activeShot.id, selected.id))
  }

  const addElement = (kind: DirectorElementKind) => {
    const next = createDirectorElement(kind, draft.elements.length)
    mutate((current) => addDirectorElement(current, next))
    setSelectedId(next.id)
    setSelectedCameraShotId(null)
  }

  const analyzeScene = async () => {
    if (busy || agentBusy) return
    const reference = referenceImages.find((item) => item.nodeId === sceneReferenceNodeId)
    if (!reference) {
      setSceneAnalysisError('请先在画布准备一张有输出的图片节点')
      return
    }
    setSceneAnalysisError('')
    try {
      const next = { ...draftRef.current, updatedAt: Date.now() }
      if (!persistDirectorDraft(next)) throw new Error('导演台工程存在问题，暂时无法保存并提交给 Agent')
      await onRequestAgentScene(reference, sceneInstruction)
      onClose()
    } catch (error) {
      setSceneAnalysisError(error instanceof Error ? error.message : String(error))
    }
  }

  const activateShot = (shot: DirectorShot) => {
    setSelectedCameraShotId(shot.id)
    setSelectedId(null)
    setPathEditingElementId(null)
    setTransformMode((mode) => mode === 'scale' ? 'translate' : mode)
    if (shot.id === activeShot?.id) return
    setIsPlaying(false)
    setCurrentFrame(0)
    mutate((current) => activateDirectorShot(current, shot.id))
  }

  const addShotFromDirectorView = () => {
    const shot = createDirectorShot(draft.shots.length)
    const view = directorCameraRef.current
    shot.position = clone(view.position)
    shot.target = clone(view.target)
    shot.fov = view.fov
    shot.cameraKeyframes[0] = { ...shot.cameraKeyframes[0], position: clone(view.position), target: clone(view.target), fov: view.fov }
    mutate((current) => ({ ...current, shots: [...current.shots, shot], activeShotId: shot.id }))
    setSelectedCameraShotId(shot.id)
    setSelectedId(null)
    setViewMode('camera')
  }

  const updateActiveShot = (patch: Partial<DirectorShot>) => {
    if (!activeShot || activeShot.locked) return
    mutate((current) => patchDirectorShot(current, activeShot.id, patch))
  }

  const updateCameraAtPlayhead = (patch: Partial<{ position: DirectorVec3; target: DirectorVec3; fov: number }>) => {
    if (!activeShot || !displayedCamera || activeShot.locked) return
    if (activeShot.cameraConstraint.mode === 'follow' && ('position' in patch || 'target' in patch)) return
    const view = { ...displayedCamera, ...patch }
    mutate((current) => upsertDirectorCameraKeyframe(current, activeShot.id, currentFrame, view))
  }

  const transformCameraAtPlayhead = (
    shotId: string,
    view: { position: DirectorVec3; target: DirectorVec3; fov: number },
    rollDeg: number,
  ) => {
    mutate((current) => patchDirectorShot(
      upsertDirectorCameraKeyframe(current, shotId, currentFrame, view),
      shotId,
      { rollDeg },
    ))
  }

  const addCameraKeyframe = () => {
    if (!activeShot || !sampledCamera || activeShot.locked) return
    mutate((current) => upsertDirectorCameraKeyframe(current, activeShot.id, currentFrame, sampledCamera))
  }

  const deleteCameraKeyframe = () => {
    if (!activeShot || currentFrame === 0 || !playheadKeyframe) return
    mutate((current) => removeDirectorCameraKeyframe(current, activeShot.id, currentFrame))
  }

  const togglePlayback = () => {
    if (!activeShot) return
    setViewMode('camera')
    if (!isPlaying) {
      pressedMoveKeysRef.current.clear()
      mouseLookRef.current.dragging = false
      setCameraMoving(false)
      setMouseLooking(false)
      setControlledCamera(null)
      if (currentFrame >= maxFrame) setCurrentFrame(0)
    }
    setIsPlaying((playing) => !playing)
  }

  const commitControlledCamera = () => {
    const view = cameraControlViewRef.current
    const current = draftRef.current
    const shot = current.shots.find((item) => item.id === current.activeShotId)
    if (!view || !shot || shot.locked) {
      setControlledCamera(null)
      return
    }
    const next = {
      ...upsertDirectorCameraKeyframe(current, shot.id, currentFrameRef.current, view),
      updatedAt: Date.now(),
    }
    draftRef.current = next
    setDraft(next)
    setControlledCamera(null)
  }

  useEffect(() => {
    if (controlledCamera || cameraMoving || mouseLooking) return
    cameraControlViewRef.current = sampledCamera
  }, [cameraMoving, controlledCamera, mouseLooking, sampledCamera])

  useEffect(() => {
    if (!canvasElement || viewMode !== 'camera' || busy || !activeShot || activeShot.locked || activeShot.cameraConstraint.mode === 'follow') return
    const editableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return !!element && (element.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(element.tagName))
    }
    const moveCodes = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ControlLeft', 'ControlRight'])
    const onKeyDown = (event: KeyboardEvent) => {
      if (!moveCodes.has(event.code) || editableTarget(event.target)) return
      event.preventDefault()
      pressedMoveKeysRef.current.add(event.code)
      setCameraMoving(true)
    }
    const finishKeyboardMove = () => {
      if (pressedMoveKeysRef.current.size > 0) return
      setCameraMoving(false)
      commitControlledCamera()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!moveCodes.has(event.code)) return
      pressedMoveKeysRef.current.delete(event.code)
      finishKeyboardMove()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.target !== canvasElement) return
      event.preventDefault()
      canvasElement.focus({ preventScroll: true })
      mouseLookRef.current = { dragging: true, x: event.clientX, y: event.clientY }
      setMouseLooking(true)
      canvasElement.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      const mouse = mouseLookRef.current
      const view = cameraControlViewRef.current
      if (!mouse.dragging || !view) return
      const deltaX = event.clientX - mouse.x
      const deltaY = event.clientY - mouse.y
      mouse.x = event.clientX
      mouse.y = event.clientY
      if (deltaX === 0 && deltaY === 0) return
      const position = new THREE.Vector3(view.position.x, view.position.y, view.position.z)
      const direction = new THREE.Vector3(
        view.target.x - view.position.x,
        view.target.y - view.position.y,
        view.target.z - view.position.z,
      )
      const distance = Math.max(0.25, direction.length())
      direction.normalize()
      let yaw = Math.atan2(direction.x, -direction.z) + deltaX * 0.003
      let pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) - deltaY * 0.003
      pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02)
      yaw = THREE.MathUtils.euclideanModulo(yaw + Math.PI, Math.PI * 2) - Math.PI
      const cosPitch = Math.cos(pitch)
      const nextDirection = new THREE.Vector3(
        Math.sin(yaw) * cosPitch,
        Math.sin(pitch),
        -Math.cos(yaw) * cosPitch,
      )
      const target = position.clone().add(nextDirection.multiplyScalar(distance))
      const next = {
        position: clone(view.position),
        target: vec3(target.x, target.y, target.z),
        fov: view.fov,
      }
      cameraControlViewRef.current = next
      setControlledCamera(next)
    }
    const finishMouseLook = (event?: PointerEvent) => {
      if (!mouseLookRef.current.dragging) return
      mouseLookRef.current.dragging = false
      setMouseLooking(false)
      if (event && canvasElement.hasPointerCapture(event.pointerId)) canvasElement.releasePointerCapture(event.pointerId)
      commitControlledCamera()
    }
    const onBlur = () => {
      pressedMoveKeysRef.current.clear()
      setCameraMoving(false)
      finishMouseLook()
      commitControlledCamera()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    canvasElement.addEventListener('pointerdown', onPointerDown)
    canvasElement.addEventListener('pointermove', onPointerMove)
    canvasElement.addEventListener('pointerup', finishMouseLook)
    canvasElement.addEventListener('pointercancel', finishMouseLook)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      canvasElement.removeEventListener('pointerdown', onPointerDown)
      canvasElement.removeEventListener('pointermove', onPointerMove)
      canvasElement.removeEventListener('pointerup', finishMouseLook)
      canvasElement.removeEventListener('pointercancel', finishMouseLook)
      pressedMoveKeysRef.current.clear()
      mouseLookRef.current.dragging = false
    }
  }, [activeShot?.cameraConstraint.mode, activeShot?.id, activeShot?.locked, busy, canvasElement, viewMode])

  useEffect(() => {
    if (!cameraMoving || viewMode !== 'camera' || busy) return
    let animationFrame = 0
    let lastTime = performance.now()
    const tick = (now: number) => {
      const view = cameraControlViewRef.current
      if (!view) return
      const deltaSec = Math.min(0.05, Math.max(0, (now - lastTime) / 1000))
      lastTime = now
      const keys = pressedMoveKeysRef.current
      const forwardAmount = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
      const rightAmount = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
      const verticalAmount = (keys.has('Space') ? 1 : 0)
        - (keys.has('ControlLeft') || keys.has('ControlRight') ? 1 : 0)
      if (forwardAmount !== 0 || rightAmount !== 0 || verticalAmount !== 0) {
        const position = new THREE.Vector3(view.position.x, view.position.y, view.position.z)
        const target = new THREE.Vector3(view.target.x, view.target.y, view.target.z)
        const forward = target.clone().sub(position).normalize()
        const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
        const velocity = forward.multiplyScalar(forwardAmount)
          .add(right.multiplyScalar(rightAmount))
          .add(new THREE.Vector3(0, verticalAmount, 0))
        if (velocity.lengthSq() > 0) {
          velocity.normalize().multiplyScalar(3 * deltaSec)
          position.add(velocity)
          target.add(velocity)
          const next = {
            position: vec3(position.x, position.y, position.z),
            target: vec3(target.x, target.y, target.z),
            fov: view.fov,
          }
          cameraControlViewRef.current = next
          setControlledCamera(next)
        }
      }
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [busy, cameraMoving, viewMode])

  useEffect(() => {
    setIsPlaying(false)
    setCurrentFrame(0)
  }, [activeShot?.id])

  useEffect(() => {
    setCurrentFrame((frame) => Math.min(frame, maxFrame))
  }, [maxFrame])

  useEffect(() => {
    if (!isPlaying || !activeShot) return
    const run = ++playbackRunRef.current
    const startFrame = currentFrameRef.current
    const startedAt = performance.now()
    let animationFrame = 0
    const tick = (now: number) => {
      if (playbackRunRef.current !== run) return
      const elapsedFrames = ((now - startedAt) / 1000) * draft.fps
      const nextFrame = Math.min(maxFrame, startFrame + elapsedFrames)
      setCurrentFrame((previousFrame) => Math.max(previousFrame, nextFrame))
      if (nextFrame >= maxFrame) {
        setIsPlaying(false)
        return
      }
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => {
      playbackRunRef.current += 1
      cancelAnimationFrame(animationFrame)
    }
  }, [isPlaying, activeShot?.id, draft.fps, maxFrame])

  useEffect(() => {
    if (!canvasElement || !activeShot) return
    const updateFrame = () => {
      const bounds = canvasElement.getBoundingClientRect()
      setFrameRect(directorCropRect(bounds.width, bounds.height, activeShot.aspectRatio))
    }
    updateFrame()
    const observer = new ResizeObserver(updateFrame)
    observer.observe(canvasElement)
    return () => observer.disconnect()
  }, [activeShot?.aspectRatio, canvasElement])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) return
      const mode = event.key.toLowerCase()
      if (mode === 'v') setTransformMode('translate')
      if (mode === 'r') setTransformMode('rotate')
      if (mode === 'z') setTransformMode('scale')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy])

  const capture = async () => {
    if (!activeShot || !glRef.current || busy) return
    setCaptureError('')
    setViewMode('camera')
    setCapturing(true)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const projectToCapture = draftRef.current
      const shotToCapture = projectToCapture.shots.find((shot) => shot.id === projectToCapture.activeShotId)
      if (!shotToCapture) throw new Error('当前 Shot 不存在')
      setDraft(projectToCapture)
      const dataUrl = cropCanvas(glRef.current.domElement, shotToCapture.aspectRatio)
      const path = await onCapture(dataUrl, shotToCapture, projectToCapture)
      setDraft((current) => {
        const next = {
          ...current,
          shots: current.shots.map((shot) => shot.id === shotToCapture.id ? { ...shot, lastCapturePath: path } : shot),
          updatedAt: Date.now(),
        }
        draftRef.current = next
        onChange(next)
        return next
      })
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error))
    } finally {
      setCapturing(false)
    }
  }

  const exportVideo = async () => {
    if (!activeShot || !glRef.current || busy) return
    setCaptureError('')
    setIsPlaying(false)
    setSelectedId(null)
    setViewMode('camera')
    setCurrentFrame(0)
    setExporting(true)
    let stream: MediaStream | undefined
    try {
      if (typeof MediaRecorder === 'undefined') throw new Error('当前运行环境不支持 WebM 视频录制')
      if (activeShot.durationSec > 60) throw new Error('单次预演视频最长支持 60 秒')
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const projectToExport = draftRef.current
      const shotToExport = projectToExport.shots.find((shot) => shot.id === projectToExport.activeShotId)
      const sourceCanvas = glRef.current.domElement
      if (!shotToExport) throw new Error('当前 Shot 不存在')
      const crop = directorCropRect(sourceCanvas.width, sourceCanvas.height, shotToExport.aspectRatio)
      const scale = Math.min(1, 1920 / Math.max(crop.width, crop.height))
      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = Math.max(2, Math.round(crop.width * scale))
      outputCanvas.height = Math.max(2, Math.round(crop.height * scale))
      const context = outputCanvas.getContext('2d')
      if (!context) throw new Error('无法创建导演台视频画布')
      stream = outputCanvas.captureStream(projectToExport.fps)
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((candidate) => MediaRecorder.isTypeSupported(candidate))
      if (!mimeType) throw new Error('当前运行环境没有可用的 WebM 编码器')
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
      const chunks: Blob[] = []
      const stopped = new Promise<void>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
        recorder.onerror = () => reject(new Error('导演台视频录制失败'))
        recorder.onstop = () => resolve()
      })
      const startedAt = performance.now()
      const durationMs = shotToExport.durationSec * 1000
      recorder.start(250)
      while (true) {
        const elapsed = Math.min(durationMs, performance.now() - startedAt)
        const frame = Math.min(directorMaxFrame(shotToExport, projectToExport.fps), Math.floor((elapsed / 1000) * projectToExport.fps))
        setCurrentFrame(frame)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        context.drawImage(sourceCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, outputCanvas.width, outputCanvas.height)
        if (elapsed >= durationMs) break
      }
      recorder.stop()
      await stopped
      const webmData = await new Blob(chunks, { type: mimeType }).arrayBuffer()
      if (webmData.byteLength === 0) throw new Error('导演台没有录制到视频数据')
      await onExportVideo(webmData, shotToExport, projectToExport)
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error))
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      setIsPlaying(false)
      setExporting(false)
    }
  }

  const saveAndClose = () => {
    if (issues.length > 0) return
    const next = { ...draftRef.current, updatedAt: Date.now() }
    if (persistDirectorDraft(next)) onClose()
  }

  return createPortal(
    <div data-canvas-node-editor-dialog data-director-stage-dialog className="app-no-drag fixed inset-x-0 bottom-0 top-10 z-[200] flex flex-col bg-[#090a0e] text-white" onPointerDown={(event) => event.stopPropagation()}>
      {busy && <div className="app-no-drag fixed inset-x-0 bottom-0 top-10 z-[210] cursor-progress" aria-label={exporting ? '正在导出预演视频，编辑已暂停' : '正在拍摄，编辑已暂停'} />}
      <header className="pointer-events-auto relative z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/10 bg-[#121318] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d4af37]/15 text-[#e8c766]">◫</div>
        <div>
          <p className="text-sm font-semibold tracking-wide">3D 导演台</p>
          <p className="text-[10px] text-white/35">白模调度 · 多机位 · 人物路径 · 24fps 工程</p>
        </div>
        <div className="pointer-events-auto relative z-40 ml-5 flex rounded-lg border border-white/10 bg-black/20 p-1">
          {(['director', 'camera'] as ViewMode[]).map((mode) => (
            <button key={mode} onClick={() => setViewMode(mode)} className={`rounded-md px-3 py-1.5 text-[11px] ${viewMode === mode ? 'bg-[#e8e6df] text-[#17171b]' : 'text-white/45 hover:text-white'}`}>
              {mode === 'director' ? '导演视角' : '机位视角'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {issues.length > 0 && <span className="text-[10px] text-amber-300" title={issues.join('\n')}>{issues.length} 项工程问题</span>}
          <span className={`text-[9px] ${autoSaveState === 'error' ? 'text-rose-300' : autoSaveState === 'saved' ? 'text-emerald-300/65' : 'text-amber-200/65'}`}>
            {autoSaveState === 'error'
              ? '存在问题，未自动保存'
              : autoSaveState === 'pending'
                ? '等待自动保存…'
                : autoSaveState === 'saving'
                  ? '正在自动保存…'
                  : lastAutoSavedAt
                    ? `已自动保存 ${new Date(lastAutoSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                    : '已保存'}
          </span>
          <button onClick={saveAndClose} disabled={issues.length > 0} className="rounded-lg px-3 py-2 text-[11px] text-white/45 hover:bg-white/[0.06] hover:text-white disabled:opacity-40">关闭</button>
          <button onClick={saveAndClose} disabled={issues.length > 0} className="rounded-lg bg-[#e8e6df] px-4 py-2 text-[11px] font-semibold text-[#17171b] disabled:opacity-40">保存并返回画布</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 flex-shrink-0 flex-col border-r border-white/10 bg-[#121318]">
          <div className="space-y-2 border-b border-white/10 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">连线参考图</p>
              <span className="text-[8px] text-white/25">当前 Agent</span>
            </div>
            {referenceImages.length === 0 ? (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-white/12 bg-black/15 px-3 text-center text-[9px] leading-4 text-white/28">
                请在画布中把有输出的图片节点连接到导演台左侧输入端
              </div>
            ) : (
              <>
                {(() => {
                  const activeReference = referenceImages.find((image) => image.nodeId === sceneReferenceNodeId) ?? referenceImages[0]
                  return (
                    <div className="relative aspect-video overflow-hidden rounded-lg border border-[#d4af37]/25 bg-black/25">
                      {activeReference.preview
                        ? <img src={activeReference.preview} alt={activeReference.title} className="h-full w-full object-contain" draggable={false} />
                        : <div className="flex h-full items-center justify-center text-[9px] text-white/30">图片预览不可用</div>}
                      <div className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-1 text-[8px] text-white/70">{activeReference.title}</div>
                    </div>
                  )
                })()}
                {referenceImages.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {referenceImages.map((image) => (
                      <button
                        key={image.nodeId}
                        onClick={() => setSceneReferenceNodeId(image.nodeId)}
                        className={`relative h-12 w-16 flex-none overflow-hidden rounded-md border ${sceneReferenceNodeId === image.nodeId ? 'border-[#d4af37]/70' : 'border-white/10'}`}
                        title={image.title}
                      >
                        {image.preview ? <img src={image.preview} alt="" className="h-full w-full object-cover" draggable={false} /> : <span className="text-[8px] text-white/25">图片</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="text-[8px] text-white/25">补充要求（可选）</p>
            <textarea
              value={sceneInstruction}
              onChange={(event) => setSceneInstruction(event.target.value)}
              placeholder="可选：保留门窗、忽略小装饰……"
              maxLength={1000}
              className="h-14 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[9px] leading-4 text-white/60 outline-none placeholder:text-white/20"
            />
            <button
              disabled={busy || agentBusy || referenceImages.length === 0 || !sceneReferenceNodeId}
              onClick={() => void analyzeScene()}
              className="w-full rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-2 py-2 text-[9px] text-[#f0d98c] disabled:opacity-35"
            >
              交给 Agent 分析并搭建
            </button>
            {agentBusy && <p className="text-[8px] leading-3.5 text-amber-200/60">Agent 正在处理其他任务，当前回合结束后可提交。</p>}
            <p className="text-[8px] leading-3.5 text-white/25">提交前会保存当前工程并返回画布；Agent 完成后重新打开导演台查看。</p>
            {sceneAnalysisError && <p className="text-[8px] leading-3.5 text-rose-300/75">{sceneAnalysisError}</p>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">场景清单</p>
              <span className="text-[9px] text-white/25">{draft.elements.length}</span>
            </div>
            <div className="space-y-1">
              {draft.elements.map((element) => (
                <button key={element.id} onClick={() => setSelectedId(element.id)} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] ${selectedId === element.id ? 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#f0d98c]' : 'border-transparent text-white/55 hover:bg-white/[0.05]'}`}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: element.color }} />
                  <span className="min-w-0 flex-1 truncate">{element.name}</span>
                  {element.locked && <span className="text-[9px]">锁</span>}
                  {!element.visible && <span className="text-[9px] opacity-50">隐</span>}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="relative z-0 isolate min-w-0 flex-1 bg-[#0b0c10]">
          <Canvas
            shadows
            camera={{ position: [7, 5, 9], fov: 48 }}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            onCreated={({ gl, camera }) => {
              glRef.current = gl
              gl.domElement.tabIndex = 0
              setCanvasElement(gl.domElement)
              camera.lookAt(0, 1, 0)
            }}
            onPointerMissed={() => {
              if (transformingElementIdRef.current) return
              setSelectedId(null)
              setSelectedCameraShotId(null)
            }}
          >
            <color attach="background" args={[draft.backgroundColor]} />
            <ambientLight intensity={1.25} />
            <directionalLight position={[6, 10, 8]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]} />
            <hemisphereLight args={['#9eb8ff', '#33291f', 0.8]} />
            {draft.showGround && (
              <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
                <planeGeometry args={[80, 80]} />
                <meshStandardMaterial color={draft.groundColor} roughness={0.92} />
              </mesh>
            )}
            {pathEditingElementId && viewMode === 'director' && !busy && (
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.012, 0]}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  if (!event.nativeEvent.ctrlKey) return
                  appendActorPathPoint(vec3(event.point.x, 0, event.point.z))
                }}
              >
                <planeGeometry args={[80, 80]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )}
            {(draft.showGrid || busy) && <Grid infiniteGrid fadeDistance={50} sectionColor="#776731" cellColor="#343947" position={[0, 0.005, 0]} />}
            {viewMode === 'director' ? (
              <OrbitControls
                makeDefault
                target={[0, 1, 0]}
                onChange={(event) => {
                  const control = event?.target as unknown as { object?: THREE.Camera; target?: THREE.Vector3 }
                  const camera = control.object
                  const target = control.target
                  if (!camera || !target) return
                  directorCameraRef.current = {
                    position: vec3(camera.position.x, camera.position.y, camera.position.z),
                    target: vec3(target.x, target.y, target.z),
                    fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : 48,
                  }
                }}
              />
            ) : activeShot && displayedCamera ? (
              <CameraRig view={displayedCamera} rollDeg={activeShot.rollDeg} />
            ) : null}
            <Suspense fallback={null}>
              {renderedElements.filter((element) => element.visible).map((element) => {
                const track = activeShot?.actorTracks.find((item) => item.elementId === element.id)
                const motionPhase = track && currentFrame >= track.startFrame && currentFrame < track.endFrame
                  ? ((currentFrame - track.startFrame) / draft.fps) * (track.motion === 'run' ? 2.6 : 1.8)
                  : undefined
                return (
                  <SceneElement
                    key={element.id}
                    element={element}
                    motionPhase={motionPhase}
                    selected={selectedId === element.id}
                    mode={transformMode}
                    helpersVisible={!busy && viewMode === 'director' && !track && !pathEditingElementId}
                    onSelect={() => selectElement(element.id)}
                    onPathPoint={pathEditingElementId && element.kind !== 'actor' && element.kind !== 'crowd'
                      ? appendActorPathPoint
                      : undefined}
                    onTransformStart={() => beginElementTransform(element.id)}
                    onTransformEnd={() => endElementTransform(element.id)}
                    onTransform={updateElement}
                  />
                )
              })}
              {viewMode === 'director' && activeShot && <CameraPathGuide shot={activeShot} elements={draft.elements} fps={draft.fps} />}
              {viewMode === 'director' && selectedActorTrack && (
                <ActorPathGuide
                  track={selectedActorTrack}
                  editable={pathEditingElementId === selectedActorTrack.elementId && !busy}
                  selectedPointIndex={selectedPathPointIndex}
                  onSelectPoint={setSelectedPathPointIndex}
                  onMovePoint={moveActorPathPoint}
                />
              )}
              {viewMode === 'director' && !busy && draft.shots.map((shot) => {
                const isActive = shot.id === activeShot?.id
                const view = isActive && sampledCamera ? sampledCamera : { position: shot.position, target: shot.target, fov: shot.fov }
                return (
                  <CameraMarker
                    key={shot.id}
                    shot={shot}
                    view={view}
                    active={isActive}
                    selected={selectedCameraShotId === shot.id && shot.cameraConstraint.mode !== 'follow'}
                    mode={transformMode}
                    onSelect={() => activateShot(shot)}
                    onTransform={(nextView, rollDeg) => transformCameraAtPlayhead(shot.id, nextView, rollDeg)}
                  />
                )
              })}
            </Suspense>
          </Canvas>

          <div className="pointer-events-none absolute inset-0">
            <div className="absolute border border-white/25" style={frameRect ? { left: frameRect.x, top: frameRect.y, width: frameRect.width, height: frameRect.height } : { inset: 0 }}>
              {!busy && <><span className="absolute left-1/3 top-0 h-full w-px bg-white/10" /><span className="absolute left-2/3 top-0 h-full w-px bg-white/10" /><span className="absolute left-0 top-1/3 h-px w-full bg-white/10" /><span className="absolute left-0 top-2/3 h-px w-full bg-white/10" /></>}
            </div>
          </div>

          <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-[#121318]/90 p-1 shadow-xl backdrop-blur">
            {(['translate', 'rotate', 'scale'] as DirectorTransformMode[]).filter((mode) => !selectedCameraShotId || mode !== 'scale').map((mode) => (
              <button key={mode} onClick={() => setTransformMode(mode)} className={`rounded-lg px-3 py-1.5 text-[10px] ${transformMode === mode ? 'bg-[#e8e6df] text-[#17171b]' : 'text-white/45 hover:text-white'}`}>
                {mode === 'translate' ? '移动 V' : mode === 'rotate' ? '旋转 R' : '缩放 Z'}
              </button>
            ))}
            {viewMode === 'director' && !pathEditingElementId && (
              <span className="pointer-events-none px-2 text-[9px] text-white/35">
                {selected ? `已激活：${selected.name}` : '双击场景物体激活'}
              </span>
            )}
          </div>
          {viewMode === 'director' && (
            <div
              role="toolbar"
              aria-label="添加到片场工具栏"
              className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%_-_2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-white/12 bg-[#121318]/95 p-1.5 shadow-2xl backdrop-blur-md"
            >
              <span className="flex-none px-2 text-[9px] font-medium tracking-[0.14em] text-[#d4af37]/75">添加</span>
              {STAGE_ELEMENT_TOOLS.map(({ kind, label, shortLabel }, index) => (
                <div key={kind} className="contents">
                  {(index === 2 || index === 6) && <span aria-hidden="true" className="mx-0.5 h-5 w-px flex-none bg-white/10" />}
                  <button
                    type="button"
                    title={label}
                    aria-label={shortLabel}
                    disabled={busy}
                    onClick={() => addElement(kind)}
                    className="flex-none rounded-lg border border-transparent px-2.5 py-2 text-[10px] text-white/58 transition hover:border-[#d4af37]/30 hover:bg-[#d4af37]/10 hover:text-[#f0d98c] disabled:opacity-35"
                  >
                    {shortLabel}
                  </button>
                </div>
              ))}
            </div>
          )}
          {viewMode === 'camera' && !busy && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg border border-white/10 bg-[#121318]/85 px-3 py-1.5 text-[9px] text-white/45 backdrop-blur">
              W/S 前进后退 · A/D 左右移动 · Space 上升 · Ctrl 下降 · 按住鼠标左键拖动旋转{cameraMoving || mouseLooking ? ' · 正在控制' : ''}
            </div>
          )}
        </main>

        <aside className="w-72 flex-shrink-0 overflow-y-auto border-l border-white/10 bg-[#121318] p-3">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input disabled={selected.locked} value={selected.name} onChange={(event) => updateElement({ ...selected, name: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/75 outline-none focus:border-[#d4af37]/45 disabled:opacity-40" />
                <input disabled={selected.locked} type="color" value={selected.color} onChange={(event) => updateElement({ ...selected, color: event.target.value })} className="h-8 w-8 rounded border border-white/10 bg-transparent disabled:opacity-40" />
              </div>
              <div className="flex gap-2">
                <button disabled={selected.locked} onClick={() => updateElement({ ...selected, visible: !selected.visible })} className="flex-1 rounded-lg border border-white/10 px-2 py-2 text-[10px] text-white/55 disabled:opacity-35">{selected.visible ? '隐藏' : '显示'}</button>
                <button onClick={() => mutate((current) => updateDirectorElement(current, { ...selected, locked: !selected.locked }, selected.locked))} className="flex-1 rounded-lg border border-white/10 px-2 py-2 text-[10px] text-white/55">{selected.locked ? '解锁' : '锁定'}</button>
                <button disabled={selected.locked} onClick={() => { mutate((current) => removeDirectorElement(current, selected.id)); setSelectedId(null) }} className="rounded-lg border border-rose-400/20 px-3 py-2 text-[10px] text-rose-300 disabled:opacity-35">删除</button>
              </div>
              <VectorFields label="位置 Position" value={selected.transform.position} disabled={selected.locked} onChange={(position) => updateElement({ ...selected, transform: { ...selected.transform, position } })} />
              <VectorFields label="旋转 Rotation °" value={selected.transform.rotation} disabled={selected.locked} onChange={(rotation) => updateElement({ ...selected, transform: { ...selected.transform, rotation } })} />
              <VectorFields label="缩放 Scale" value={selected.transform.scale} disabled={selected.locked} onChange={(scale) => updateElement({ ...selected, transform: { ...selected.transform, scale } })} />
              {(selected.kind === 'actor' || selected.kind === 'crowd') && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-black/10 p-3">
                  <p className="text-[10px] font-medium text-white/55">角色外观与动作</p>
                  {selected.kind === 'actor' && (
                    <label className="block space-y-1.5 text-[10px] text-white/45">角色模型
                      <select disabled={selected.locked} value={selected.actorModelId ?? 'director-rig-v1'} onChange={(event) => updateElement({ ...selected, actorModelId: event.target.value as DirectorActorModelId })} className="w-full rounded-lg border border-white/10 bg-[#1c1d23] px-3 py-2 text-[11px] text-white/70 outline-none disabled:opacity-40">
                        {DIRECTOR_ACTOR_MODEL_OPTIONS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="block space-y-1.5 text-[10px] text-white/45">人物体型
                    <select
                      disabled={selected.locked}
                      value={selected.bodyType ?? 'standard'}
                      onChange={(event) => {
                        const bodyType = event.target.value as DirectorBodyType
                        const option = DIRECTOR_BODY_TYPE_OPTIONS.find((item) => item.id === bodyType)
                        updateElement({ ...selected, bodyType, heightM: option?.defaultHeightM ?? selected.heightM })
                      }}
                      className="w-full rounded-lg border border-white/10 bg-[#1c1d23] px-3 py-2 text-[11px] text-white/70 outline-none disabled:opacity-40"
                    >
                      {DIRECTOR_BODY_TYPE_OPTIONS.map((body) => <option key={body.id} value={body.id}>{body.label}</option>)}
                    </select>
                  </label>
                  <NumberField label="身高（米）" value={selected.heightM ?? 1.72} step={0.01} disabled={selected.locked} onChange={(heightM) => updateElement({ ...selected, heightM: Math.max(0.8, Math.min(2.4, heightM)) })} />
                  <label className="block space-y-1.5 text-[10px] text-white/45">人物动作
                    <select disabled={selected.locked} value={selected.poseId ?? 'stand'} onChange={(event) => updateElement({ ...selected, poseId: event.target.value as DirectorPoseId })} className="w-full rounded-lg border border-white/10 bg-[#1c1d23] px-3 py-2 text-[11px] text-white/70 outline-none disabled:opacity-40">
                      {DIRECTOR_POSES.map((pose) => <option key={pose.id} value={pose.id}>{pose.label}</option>)}
                    </select>
                  </label>
                  {selected.kind === 'actor' && <p className="text-[8px] leading-4 text-white/25">骨骼白模保留完整关节和面向标记；轻量白模适合远景。体型使用独立身体比例，不是整体缩放。</p>}
                </div>
              )}
              {selected.kind === 'actor' && activeShot && (
                <div className="space-y-3 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/[0.045] p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-medium text-[#f0d98c]">人物运动路径</p>
                      <p className="mt-0.5 text-[8px] text-white/30">{selectedActorTrack ? `${selectedActorTrack.points.length} 个路径点` : '尚未设置'}</p>
                    </div>
                    <button
                      disabled={selected.locked || activeShot.locked}
                      onClick={() => {
                        if (pathEditingElementId === selected.id) {
                          finishActorPath()
                        } else {
                          beginActorPath()
                          setSelectedPathPointIndex(0)
                        }
                      }}
                      className="rounded-lg border border-[#d4af37]/30 px-2.5 py-1.5 text-[9px] text-[#f0d98c] disabled:opacity-35"
                    >
                      {pathEditingElementId === selected.id ? '完成绘制' : selectedActorTrack ? '继续绘制' : '绘制路径'}
                    </button>
                  </div>
                  {pathEditingElementId === selected.id && (
                    <p className="rounded-lg bg-black/20 px-2 py-1.5 text-[9px] leading-4 text-amber-200/70">按住 Ctrl 并用鼠标左键点击地面、台阶或平台等模型表面添加 XYZ 路径点；普通点击不会取点。选中控制点后可沿三轴调整高度。</p>
                  )}
                  {selectedActorTrack && (
                    <>
                      <div className="flex gap-2">
                        <NumberField label="开始帧" value={selectedActorTrack.startFrame} step={1} disabled={activeShot.locked} onChange={(startFrame) => updateSelectedActorTrack({ startFrame: Math.max(0, Math.min(Math.floor(startFrame), selectedActorTrack.endFrame)) })} />
                        <NumberField label="结束帧" value={selectedActorTrack.endFrame} step={1} disabled={activeShot.locked} onChange={(endFrame) => updateSelectedActorTrack({ endFrame: Math.max(selectedActorTrack.startFrame, Math.min(Math.floor(endFrame), maxFrame)) })} />
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={selectedActorTrack.motion}
                          disabled={activeShot.locked}
                          onChange={(event) => updateSelectedActorTrack({ motion: event.target.value as DirectorActorTrack['motion'] })}
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#1c1d23] px-2 py-2 text-[10px] text-white/65"
                        >
                          <option value="walk">行走</option>
                          <option value="run">奔跑</option>
                        </select>
                        <select
                          value={selectedActorTrack.interpolation}
                          disabled={activeShot.locked}
                          onChange={(event) => updateSelectedActorTrack({ interpolation: event.target.value as DirectorActorTrack['interpolation'] })}
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#1c1d23] px-2 py-2 text-[10px] text-white/65"
                        >
                          <option value="smooth">平滑路径</option>
                          <option value="linear">折线路径</option>
                        </select>
                        <label className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 text-[9px] text-white/50">
                          <input type="checkbox" checked={selectedActorTrack.orientToPath} disabled={activeShot.locked} onChange={(event) => updateSelectedActorTrack({ orientToPath: event.target.checked })} />
                          朝向路径
                        </label>
                      </div>
                      {selectedActorPathPoint && selectedPathPointIndex !== null && (
                        <VectorFields
                          label={`路径点 ${selectedPathPointIndex + 1} · XYZ 世界坐标`}
                          value={selectedActorPathPoint}
                          disabled={activeShot.locked || selected.locked}
                          onChange={(point) => moveActorPathPoint(selectedPathPointIndex, point)}
                        />
                      )}
                      <div className="flex gap-2">
                        <button onClick={undoActorPathPoint} disabled={activeShot.locked} className="flex-1 rounded-lg border border-white/10 px-2 py-1.5 text-[9px] text-white/50 disabled:opacity-35">撤销末点</button>
                        <button onClick={clearActorPath} disabled={activeShot.locked} className="flex-1 rounded-lg border border-rose-400/20 px-2 py-1.5 text-[9px] text-rose-300 disabled:opacity-35">清除路径</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : activeShot && displayedCamera ? (
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">当前机位</p>
              <input value={activeShot.name} onChange={(event) => updateActiveShot({ name: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/75 outline-none" />
              <div className="rounded-lg border border-white/8 bg-black/15 px-2.5 py-2 text-[9px] text-white/35">正在编辑第 {displayFrame} 帧{playheadKeyframe ? ' · 关键帧' : ' · 插值机位（修改后自动生成关键帧）'}</div>
              <label className="block space-y-1.5 text-[10px] text-white/45">相机约束
                <select
                  value={activeShot.cameraConstraint.mode}
                  disabled={activeShot.locked}
                  onChange={(event) => {
                    const mode = event.target.value as DirectorCameraConstraintMode
                    updateActiveShot({
                      cameraConstraint: {
                        ...activeShot.cameraConstraint,
                        mode,
                        targetElementId: mode === 'free'
                          ? undefined
                          : activeShot.cameraConstraint.targetElementId ?? actorElements[0]?.id,
                      },
                    })
                  }}
                  className="w-full rounded-lg border border-white/10 bg-[#1c1d23] px-3 py-2 text-[11px] text-white/70 outline-none disabled:opacity-40"
                >
                  <option value="free">自由机位</option>
                  <option value="look-at" disabled={actorElements.length === 0}>锁定注视人物</option>
                  <option value="follow" disabled={actorElements.length === 0}>跟随人物移动</option>
                </select>
              </label>
              {activeShot.cameraConstraint.mode !== 'free' && (
                <div className="space-y-3 rounded-xl border border-[#d4af37]/15 bg-[#d4af37]/[0.035] p-2.5">
                  <label className="block space-y-1.5 text-[9px] text-white/40">目标人物
                    <select
                      value={activeShot.cameraConstraint.targetElementId ?? ''}
                      disabled={activeShot.locked}
                      onChange={(event) => updateActiveShot({ cameraConstraint: { ...activeShot.cameraConstraint, targetElementId: event.target.value } })}
                      className="w-full rounded-lg border border-white/10 bg-[#1c1d23] px-2 py-2 text-[10px] text-white/65"
                    >
                      {actorElements.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
                    </select>
                  </label>
                  <VectorFields label="目标偏移（世界坐标）" value={activeShot.cameraConstraint.targetOffset} disabled={activeShot.locked} onChange={(targetOffset) => updateActiveShot({ cameraConstraint: { ...activeShot.cameraConstraint, targetOffset } })} />
                  {activeShot.cameraConstraint.mode === 'follow' && (
                    <VectorFields label="跟随偏移（人物局部坐标）" value={activeShot.cameraConstraint.followOffset} disabled={activeShot.locked} onChange={(followOffset) => updateActiveShot({ cameraConstraint: { ...activeShot.cameraConstraint, followOffset } })} />
                  )}
                </div>
              )}
              <div className="text-[9px] leading-4 text-white/28">
                {activeShot.cameraConstraint.mode === 'follow'
                  ? '跟随模式由人物位置和朝向实时计算机位；切换到自由机位后可继续手动操控。'
                  : '在导演视角点击机位模型后，可用顶部“移动 / 旋转”控制器直接调整当前帧机位。'}
              </div>
              <VectorFields label="摄影机位置" value={displayedCamera.position} disabled={activeShot.locked || activeShot.cameraConstraint.mode === 'follow'} onChange={(position) => updateCameraAtPlayhead({ position })} />
              <VectorFields label="注视目标" value={displayedCamera.target} disabled={activeShot.locked || activeShot.cameraConstraint.mode !== 'free'} onChange={(target) => updateCameraAtPlayhead({ target })} />
              <div className="flex gap-2"><NumberField label="FOV" value={displayedCamera.fov} step={1} disabled={activeShot.locked} onChange={(fov) => updateCameraAtPlayhead({ fov: Math.min(120, Math.max(10, fov)) })} /><NumberField label="ROLL" value={activeShot.rollDeg} step={1} disabled={activeShot.locked} onChange={(rollDeg) => updateActiveShot({ rollDeg })} /></div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">场景设置</p>
              <label className="flex items-center justify-between text-[11px] text-white/55">背景色<input type="color" value={draft.backgroundColor} onChange={(event) => mutate((current) => ({ ...current, backgroundColor: event.target.value }))} /></label>
              <label className="flex items-center justify-between text-[11px] text-white/55">显示地面<input type="checkbox" checked={draft.showGround} onChange={(event) => mutate((current) => ({ ...current, showGround: event.target.checked }))} /></label>
              <label className="flex items-center justify-between text-[11px] text-white/55">显示网格<input type="checkbox" checked={draft.showGrid} onChange={(event) => mutate((current) => ({ ...current, showGrid: event.target.checked }))} /></label>
            </div>
          )}
        </aside>
      </div>

      <footer className="pointer-events-auto relative z-20 flex h-64 flex-shrink-0 border-t border-white/10 bg-[#0d0e12] shadow-[0_-12px_40px_rgba(0,0,0,0.28)]">
        <div className="flex w-56 flex-shrink-0 flex-col justify-center gap-2 border-r border-white/10 p-3">
          <button onClick={addShotFromDirectorView} className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-3 py-2 text-[10px] text-[#f0d98c]">＋ 从导演视角新增机位</button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-2">
          {activeShot && (
            <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-white/8 px-1 pb-2">
              <button onClick={() => { setIsPlaying(false); setCurrentFrame(0); setViewMode('camera') }} className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] text-white/45 hover:bg-white/[0.06] hover:text-white/80" title="回到开头">▏◀</button>
              <button onClick={() => { setIsPlaying(false); setCurrentFrame((frame) => Math.max(0, Math.ceil(frame) - 1)); setViewMode('camera') }} className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] text-white/45 hover:bg-white/[0.06] hover:text-white/80" title="上一帧">◀</button>
              <button onClick={togglePlayback} className="flex h-7 w-9 items-center justify-center rounded-md border border-[#d4af37]/30 bg-[#d4af37]/10 text-[11px] text-[#f0d98c] hover:bg-[#d4af37]/15" title={isPlaying ? '暂停预演' : '播放预演'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
              <button onClick={() => { setIsPlaying(false); setCurrentFrame((frame) => Math.min(maxFrame, Math.floor(frame) + 1)); setViewMode('camera') }} className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] text-white/45 hover:bg-white/[0.06] hover:text-white/80" title="下一帧">▶</button>
              <span className="ml-2 rounded-md border border-white/8 bg-black/25 px-2.5 py-1 font-mono text-[11px] tabular-nums text-white/75">{formatTimelineTimecode(currentFrame, draft.fps)}</span>
              <span className="font-mono text-[9px] tabular-nums text-white/28">/ {formatTimelineTimecode(maxFrame, draft.fps)}</span>
              <span className="ml-1 rounded bg-white/[0.045] px-1.5 py-1 text-[8px] text-white/35">{draft.fps} FPS</span>
              <div className="flex-1" />
              <span className="mr-1 w-[86px] whitespace-nowrap text-right text-[9px] tabular-nums text-white/30">帧 {displayFrame} / {maxFrame}</span>
              <button onClick={addCameraKeyframe} disabled={activeShot.locked} className="rounded-md border border-[#d4af37]/25 px-2.5 py-1.5 text-[9px] text-[#f0d98c] disabled:opacity-35">{playheadKeyframe ? '更新关键帧' : '＋关键帧'}</button>
              <button onClick={deleteCameraKeyframe} disabled={activeShot.locked || currentFrame === 0 || !playheadKeyframe} className="rounded-md border border-rose-400/20 px-2.5 py-1.5 text-[9px] text-rose-300 disabled:opacity-25" title="删除当前关键帧">删除</button>
            </div>
          )}
          {activeShot && (
            <div className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-[#111318]">
              <div className="grid h-full" style={{ gridTemplateColumns: `${TIMELINE_HEADER_WIDTH}px minmax(0, 1fr)` }}>
                <div className="flex h-7 items-center border-b border-r border-white/8 bg-[#16181e] px-2 text-[8px] uppercase tracking-[0.14em] text-white/28">轨道</div>
                <div className="relative h-7 overflow-hidden border-b border-white/8 bg-[#16181e]">
                  {timelineTicks.map((tick, index) => {
                    const left = activeShot.durationSec > 0 ? (tick.seconds / activeShot.durationSec) * 100 : 0
                    return (
                      <span key={`${tick.seconds}-${index}`} className="absolute inset-y-0 border-l border-white/15" style={{ left: `${left}%` }}>
                        <span className={`absolute top-1 whitespace-nowrap font-mono text-[8px] text-white/35 ${index === timelineTicks.length - 1 ? '-translate-x-full pr-1' : 'pl-1'}`}>{tick.label}</span>
                        <span className="absolute bottom-0 left-0 h-1.5 border-l border-white/25" />
                      </span>
                    )
                  })}
                </div>

                <div className="flex h-10 items-center gap-2 border-b border-r border-white/8 bg-[#14161b] px-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-[#d4af37]/10 text-[9px] text-[#d4af37]">◆</span>
                  <span className="min-w-0"><span className="block truncate text-[9px] text-white/60">机位关键帧</span><span className="block text-[7px] text-white/25">{activeShot.cameraKeyframes.length} 个标记</span></span>
                </div>
                <div className="relative h-10 overflow-hidden border-b border-white/8 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:25%_100%]">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-[#d4af37]/35" />
                  <input
                    type="range"
                    min={0}
                    max={maxFrame}
                    step={1}
                    value={currentFrame}
                    onChange={(event) => { setIsPlaying(false); setCurrentFrame(Number(event.target.value)); setViewMode('camera') }}
                    className="absolute inset-0 z-10 h-full w-full cursor-ew-resize opacity-0"
                    aria-label="镜头时间线"
                  />
                  {activeShot.cameraKeyframes.map((keyframe) => (
                    <button
                      key={keyframe.id}
                      onClick={() => { setIsPlaying(false); setCurrentFrame(keyframe.frame); setViewMode('camera') }}
                      className={`absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border shadow-[0_0_0_2px_rgba(12,13,17,0.8)] ${keyframe.frame === currentFrame ? 'border-[#fff1a8] bg-[#d4af37]' : 'border-[#d4af37]/80 bg-[#3a321b] hover:bg-[#8a7326]'}`}
                      style={{ left: `${maxFrame > 0 ? (keyframe.frame / maxFrame) * 100 : 0}%` }}
                      title={`关键帧 ${keyframe.frame} · ${formatTimelineTimecode(keyframe.frame, draft.fps)}`}
                    />
                  ))}
                </div>

                <div className="col-span-2 min-h-0 overflow-y-auto">
                  {activeShot.actorTracks.length === 0 ? (
                    <div className="grid" style={{ gridTemplateColumns: `${TIMELINE_HEADER_WIDTH}px minmax(0, 1fr)` }}>
                      <div className="flex h-10 items-center border-r border-white/8 bg-[#121419] px-2 text-[8px] text-white/22">暂无人物动作轨</div>
                      <div className="h-10 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:25%_100%]" />
                    </div>
                  ) : activeShot.actorTracks.map((track) => {
                      const actor = actorElements.find((item) => item.id === track.elementId)
                      const left = maxFrame > 0 ? (track.startFrame / maxFrame) * 100 : 0
                      const width = maxFrame > 0 ? Math.max(0.8, ((track.endFrame - track.startFrame) / maxFrame) * 100) : 100
                      return (
                        <div key={track.id} className="grid" style={{ gridTemplateColumns: `${TIMELINE_HEADER_WIDTH}px minmax(0, 1fr)` }}>
                          <button onClick={() => { setSelectedId(track.elementId); setSelectedCameraShotId(null) }} className="flex h-10 min-w-0 items-center gap-2 border-b border-r border-white/[0.055] bg-[#121419] px-2 text-left hover:bg-white/[0.025]" title={`${actor?.name ?? track.elementId} · ${track.startFrame}-${track.endFrame} 帧`}>
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-sky-400/10 text-[8px] text-sky-300">人</span>
                            <span className="min-w-0"><span className="block truncate text-[9px] text-white/55">{actor?.name ?? '人物'}</span><span className="block truncate text-[7px] text-white/25">{track.motion === 'run' ? '跑步' : '行走'} · {track.interpolation === 'smooth' ? '平滑' : '折线'}</span></span>
                          </button>
                          <button onClick={() => { setSelectedId(track.elementId); setSelectedCameraShotId(null) }} className="relative block h-10 w-full border-b border-white/[0.055] bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:25%_100%] text-left" title={`${actor?.name ?? track.elementId} · ${formatTimelineTimecode(track.startFrame, draft.fps)} - ${formatTimelineTimecode(track.endFrame, draft.fps)}`}>
                            <span className="absolute top-1.5 flex h-7 min-w-3 items-center overflow-hidden rounded border border-sky-300/25 bg-sky-400/15 px-2 text-[8px] text-sky-100/70 shadow-[inset_3px_0_0_rgba(125,211,252,0.45)]" style={{ left: `${left}%`, width: `${width}%` }}>
                              <span className="truncate">{actor?.name ?? '人物'} · {track.motion === 'run' ? '跑步' : '行走'}</span>
                            </span>
                          </button>
                        </div>
                      )
                    })}
                </div>
              </div>
              <div className="pointer-events-none absolute bottom-0 top-0 z-30" style={{ left: `calc(${TIMELINE_HEADER_WIDTH}px + (100% - ${TIMELINE_HEADER_WIDTH}px) * ${maxFrame > 0 ? currentFrame / maxFrame : 0})` }}>
                <span className="absolute -left-1.5 top-0 h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-[#f6d653]" />
                <span className="absolute bottom-0 top-0 w-px bg-[#f6d653] shadow-[0_0_5px_rgba(246,214,83,0.45)]" />
              </div>
            </div>
          )}
          <div className="mt-2 flex h-10 flex-shrink-0 items-stretch gap-1.5 overflow-x-auto">
            {draft.shots.map((shot, index) => (
              <button key={shot.id} onClick={() => activateShot(shot)} className={`flex w-36 flex-shrink-0 items-center gap-2 rounded-md border px-2 text-left ${shot.id === activeShot?.id ? 'border-[#d4af37]/45 bg-[#d4af37]/10' : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                <span className="sr-only">SHOT {String(index + 1).padStart(2, '0')}</span>
                <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[8px] ${shot.id === activeShot?.id ? 'bg-[#d4af37]/20 text-[#f0d98c]' : 'bg-white/[0.05] text-white/35'}`}>{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0"><span className="block truncate text-[9px] text-white/60">{shot.name}</span><span className="block text-[7px] text-white/25">{shot.durationSec}s · {shot.aspectRatio}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex w-64 flex-shrink-0 flex-col justify-center gap-2 border-l border-white/10 p-3">
          {activeShot && (
            <div className="flex gap-2">
              <select value={activeShot.aspectRatio} onChange={(event) => updateActiveShot({ aspectRatio: event.target.value as DirectorAspectRatio })} className="flex-1 rounded-lg border border-white/10 bg-[#1c1d23] px-2 py-2 text-[10px] text-white/65">
                {DIRECTOR_ASPECT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}
              </select>
              <NumberField label="时长" value={activeShot.durationSec} step={1} onChange={(durationSec) => updateActiveShot({ durationSec: Math.max(1 / 24, durationSec) })} />
            </div>
          )}
          <button onClick={() => void capture()} disabled={!activeShot || busy} className="rounded-lg bg-[#e8e6df] px-3 py-2 text-[10px] font-semibold text-[#17171b] disabled:opacity-45">{capturing ? '正在拍摄…' : '拍摄构图并发送到画布'}</button>
          <button onClick={() => void exportVideo()} disabled={!activeShot || busy} className="rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-2 text-[10px] font-semibold text-[#f0d98c] disabled:opacity-45">{exporting ? `正在导出 ${activeShot ? activeShot.durationSec.toFixed(1) : '0'} 秒…` : '导出预演视频到画布'}</button>
          {captureError && <p className="truncate text-[9px] text-rose-300" title={captureError}>{captureError}</p>}
        </div>
      </footer>
    </div>,
    document.body,
  )
}
