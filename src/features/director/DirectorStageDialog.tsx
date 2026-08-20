import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls, PerspectiveCamera, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import type {
  DirectorAspectRatio,
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
  DIRECTOR_ASPECT_RATIOS,
  DIRECTOR_POSES,
  directorCropRect,
  type DirectorCropRect,
  normalizeDirectorProject,
  patchDirectorShot,
  removeDirectorElement,
  snapshotActiveShot,
  snapshotElements,
  updateDirectorElement,
  validateDirectorProject,
  vec3,
} from './director-model'

type ViewMode = 'director' | 'camera'

interface DirectorStageDialogProps {
  project: DirectorProject
  onChange: (project: DirectorProject) => void
  onClose: () => void
  onCapture: (pngDataUrl: string, shot: DirectorShot, project: DirectorProject) => Promise<string>
}

const clone = <T,>(value: T): T => structuredClone(value)
const vector = (value: DirectorVec3): [number, number, number] => [value.x, value.y, value.z]
const degrees = (radians: number): number => Math.round(THREE.MathUtils.radToDeg(radians) * 1000) / 1000
const radians = (value: DirectorVec3): [number, number, number] => (
  [THREE.MathUtils.degToRad(value.x), THREE.MathUtils.degToRad(value.y), THREE.MathUtils.degToRad(value.z)]
)

const POSE_ROTATIONS: Record<DirectorPoseId, Record<string, [number, number, number]>> = {
  stand: { leftArm: [0, 0, -0.08], rightArm: [0, 0, 0.08] },
  walk: { leftArm: [0.5, 0, -0.08], rightArm: [-0.5, 0, 0.08], leftLeg: [-0.42, 0, 0], rightLeg: [0.42, 0, 0] },
  sit: { leftLeg: [-1.4, 0, 0], rightLeg: [-1.4, 0, 0], leftKnee: [1.35, 0, 0], rightKnee: [1.35, 0, 0] },
  'arms-crossed': { leftArm: [0.1, -0.35, -1.2], rightArm: [0.1, 0.35, 1.2], leftForearm: [-1.45, 0, 0], rightForearm: [-1.45, 0, 0] },
  point: { leftArm: [0, 0, -1.45], rightArm: [0, 0, 0.12] },
  kneel: { leftLeg: [-0.18, 0, 0], rightLeg: [-1.2, 0, 0], rightKnee: [1.35, 0, 0] },
}

// The two leg segments extend 7cm below the mannequin root. Lift only the
// visual mesh so the element root/TransformControls pivot stays on the floor.
const MANNEQUIN_FOOT_OFFSET = 0.07

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

function Mannequin({ color, poseId = 'stand', height = 1.72 }: { color: string; poseId?: DirectorPoseId; height?: number }) {
  const pose = POSE_ROTATIONS[poseId]
  const unit = height / 1.72
  return (
    <group scale={unit}>
      <mesh position={[0, 1.58, 0]} castShadow>
        <sphereGeometry args={[0.13, 18, 12]} />
        <meshStandardMaterial color="#d8b5a0" roughness={0.82} />
      </mesh>
      <mesh position={[0, 1.12, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.46, 8, 12]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <group position={[-0.23, 1.32, 0]}>
        <Limb length={0.42} radius={0.055} color={color} rotation={pose.leftArm}>
          <Limb length={0.38} radius={0.048} color="#d8b5a0" rotation={pose.leftForearm} />
        </Limb>
      </group>
      <group position={[0.23, 1.32, 0]}>
        <Limb length={0.42} radius={0.055} color={color} rotation={pose.rightArm}>
          <Limb length={0.38} radius={0.048} color="#d8b5a0" rotation={pose.rightForearm} />
        </Limb>
      </group>
      <group position={[-0.11, 0.84, 0]}>
        <Limb length={0.46} radius={0.075} color="#303744" rotation={pose.leftLeg}>
          <Limb length={0.45} radius={0.065} color="#303744" rotation={pose.leftKnee} />
        </Limb>
      </group>
      <group position={[0.11, 0.84, 0]}>
        <Limb length={0.46} radius={0.075} color="#303744" rotation={pose.rightLeg}>
          <Limb length={0.45} radius={0.065} color="#303744" rotation={pose.rightKnee} />
        </Limb>
      </group>
    </group>
  )
}

function Primitive({ element }: { element: DirectorElement }) {
  if (element.kind === 'box' || element.kind === 'wall') {
    return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
  }
  if (element.kind === 'sphere') {
    return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><sphereGeometry args={[0.5, 24, 16]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
  }
  return <mesh castShadow receiveShadow position={[0, 0.5, 0]}><cylinderGeometry args={[0.5, 0.5, 1, 24]} /><meshStandardMaterial color={element.color} roughness={0.75} /></mesh>
}

function ElementVisual({ element }: { element: DirectorElement }) {
  if (element.kind === 'actor') {
    return <group position={[0, MANNEQUIN_FOOT_OFFSET, 0]}><Mannequin color={element.color} height={element.heightM} poseId={element.poseId} /></group>
  }
  if (element.kind === 'crowd') {
    const rows = element.rows ?? 2
    const columns = element.columns ?? 4
    const spacing = element.spacing ?? 1.25
    return (
      <group>
        {Array.from({ length: rows * columns }, (_, index) => (
          <group key={index} position={[(index % columns) * spacing, MANNEQUIN_FOOT_OFFSET, Math.floor(index / columns) * spacing]}>
            <Mannequin color={element.color} height={element.heightM} poseId={element.poseId} />
          </group>
        ))}
      </group>
    )
  }
  return <Primitive element={element} />
}

function SceneElement({
  element,
  selected,
  mode,
  helpersVisible,
  onSelect,
  onTransform,
}: {
  element: DirectorElement
  selected: boolean
  mode: DirectorTransformMode
  helpersVisible: boolean
  onSelect: () => void
  onTransform: (element: DirectorElement) => void
}) {
  const objectRef = useRef<THREE.Group>(null!)
  const draggingRef = useRef(false)
  const pendingTransformRef = useRef<DirectorElement['transform'] | null>(null)
  const elementRef = useRef(element)
  const onTransformRef = useRef(onTransform)
  elementRef.current = element
  onTransformRef.current = onTransform

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
        onSelect()
      }}
    >
      <ElementVisual element={element} />
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
        }}
        onObjectChange={() => { pendingTransformRef.current = readObjectTransform() }}
        onMouseUp={finishTransform}
      />
    </>
  )
}

function CameraRig({ shot }: { shot: DirectorShot }) {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(shot.position.x, shot.position.y, shot.position.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(shot.target.x, shot.target.y, shot.target.z)
    camera.rotateZ(THREE.MathUtils.degToRad(shot.rollDeg))
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = shot.fov
      camera.updateProjectionMatrix()
    }
  }, [camera, shot])
  return null
}

function CameraMarker({ shot, active, onClick }: { shot: DirectorShot; active: boolean; onClick: () => void }) {
  const direction = useMemo(() => new THREE.Vector3(
    shot.target.x - shot.position.x,
    shot.target.y - shot.position.y,
    shot.target.z - shot.position.z,
  ).normalize(), [shot])
  const yaw = Math.atan2(direction.x, direction.z)
  return (
    <group position={vector(shot.position)} rotation={[0, yaw, 0]} onPointerDown={(event) => { event.stopPropagation(); onClick() }}>
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

export function DirectorStageDialog({ project, onChange, onClose, onCapture }: DirectorStageDialogProps) {
  const [draft, setDraft] = useState<DirectorProject>(() => normalizeDirectorProject(clone(project), project?.name))
  const [selectedId, setSelectedId] = useState<string | null>(draft.elements[0]?.id ?? null)
  const [viewMode, setViewMode] = useState<ViewMode>('director')
  const [transformMode, setTransformMode] = useState<DirectorTransformMode>('translate')
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const draftRef = useRef(draft)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null)
  const [frameRect, setFrameRect] = useState<DirectorCropRect | null>(null)
  const directorCameraRef = useRef<{ position: DirectorVec3; target: DirectorVec3; fov: number }>({
    position: vec3(7, 5, 9),
    target: vec3(0, 1, 0),
    fov: 48,
  })

  const activeShot = draft.shots.find((shot) => shot.id === draft.activeShotId) ?? draft.shots[0]
  const selected = draft.elements.find((element) => element.id === selectedId)
  const issues = validateDirectorProject(draft)
  draftRef.current = draft

  const mutate = (recipe: (current: DirectorProject) => DirectorProject) => {
    setDraft((current) => ({ ...recipe(current), updatedAt: Date.now() }))
  }

  const updateElement = (next: DirectorElement) => {
    mutate((current) => updateDirectorElement(current, next))
  }

  const addElement = (kind: DirectorElementKind) => {
    const next = createDirectorElement(kind, draft.elements.length)
    mutate((current) => addDirectorElement(current, next))
    setSelectedId(next.id)
  }

  const activateShot = (shot: DirectorShot) => {
    mutate((current) => activateDirectorShot(current, shot.id))
  }

  const saveActiveShot = () => {
    if (!activeShot || activeShot.locked) return
    mutate((current) => ({
      ...current,
      shots: current.shots.map((shot) => shot.id === activeShot.id
        ? { ...shot, elementStates: snapshotElements(current.elements) }
        : shot),
    }))
  }

  const addShotFromDirectorView = () => {
    const shot = createDirectorShot(draft.elements, draft.shots.length)
    const view = directorCameraRef.current
    shot.position = clone(view.position)
    shot.target = clone(view.target)
    shot.fov = view.fov
    shot.cameraKeyframes[0] = { ...shot.cameraKeyframes[0], position: clone(view.position), target: clone(view.target), fov: view.fov }
    mutate((current) => ({ ...current, shots: [...current.shots, shot], activeShotId: shot.id }))
    setViewMode('camera')
  }

  const updateActiveShot = (patch: Partial<DirectorShot>) => {
    if (!activeShot || activeShot.locked) return
    mutate((current) => patchDirectorShot(current, activeShot.id, patch))
  }

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
      if (capturing || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) return
      const mode = event.key.toLowerCase()
      if (mode === 'v') setTransformMode('translate')
      if (mode === 'r') setTransformMode('rotate')
      if (mode === 's') setTransformMode('scale')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [capturing])

  const capture = async () => {
    if (!activeShot || !glRef.current || capturing) return
    setCaptureError('')
    setViewMode('camera')
    setCapturing(true)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const projectToCapture = snapshotActiveShot(draftRef.current)
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

  const saveAndClose = () => {
    if (issues.length > 0) return
    const next = { ...snapshotActiveShot(draftRef.current), updatedAt: Date.now() }
    onChange(next)
    onClose()
  }

  return createPortal(
    <div className="app-no-drag fixed inset-x-0 bottom-0 top-10 z-[200] flex flex-col bg-[#090a0e] text-white" onPointerDown={(event) => event.stopPropagation()}>
      {capturing && <div className="app-no-drag fixed inset-x-0 bottom-0 top-10 z-[210] cursor-progress" aria-label="正在拍摄，编辑已暂停" />}
      <header className="pointer-events-auto relative z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/10 bg-[#121318] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d4af37]/15 text-[#e8c766]">◫</div>
        <div>
          <p className="text-sm font-semibold tracking-wide">3D 导演台</p>
          <p className="text-[10px] text-white/35">白模调度 · 多机位 · Shot 快照 · 24fps 工程</p>
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
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[11px] text-white/45 hover:bg-white/[0.06] hover:text-white">取消</button>
          <button onClick={saveAndClose} disabled={issues.length > 0} className="rounded-lg bg-[#e8e6df] px-4 py-2 text-[11px] font-semibold text-[#17171b] disabled:opacity-40">保存并返回画布</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 flex-shrink-0 flex-col border-r border-white/10 bg-[#121318]">
          <div className="border-b border-white/10 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/35">添加到片场</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['actor', '演员'], ['crowd', '群众'], ['box', '立方体'],
                ['sphere', '球体'], ['cylinder', '圆柱'], ['wall', '墙体'],
              ] as Array<[DirectorElementKind, string]>).map(([kind, label]) => (
                <button key={kind} onClick={() => addElement(kind)} className="rounded-lg border border-white/8 bg-white/[0.035] px-2 py-2 text-[10px] text-white/55 hover:border-[#d4af37]/35 hover:text-[#e8c766]">{label}</button>
              ))}
            </div>
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
              setCanvasElement(gl.domElement)
              camera.lookAt(0, 1, 0)
            }}
            onPointerMissed={() => setSelectedId(null)}
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
            {(draft.showGrid || capturing) && <Grid infiniteGrid fadeDistance={50} sectionColor="#776731" cellColor="#343947" position={[0, 0.005, 0]} />}
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
            ) : activeShot ? (
              <>
                <PerspectiveCamera makeDefault fov={activeShot.fov} position={vector(activeShot.position)} />
                <CameraRig shot={activeShot} />
              </>
            ) : null}
            <Suspense fallback={null}>
              {draft.elements.filter((element) => element.visible).map((element) => (
                <SceneElement
                  key={element.id}
                  element={element}
                  selected={selectedId === element.id}
                  mode={transformMode}
                  helpersVisible={!capturing && viewMode === 'director'}
                  onSelect={() => setSelectedId(element.id)}
                  onTransform={updateElement}
                />
              ))}
              {viewMode === 'director' && !capturing && draft.shots.map((shot) => (
                <CameraMarker key={shot.id} shot={shot} active={shot.id === activeShot?.id} onClick={() => activateShot(shot)} />
              ))}
            </Suspense>
          </Canvas>

          <div className="pointer-events-none absolute inset-0">
            <div className="absolute border border-white/25" style={frameRect ? { left: frameRect.x, top: frameRect.y, width: frameRect.width, height: frameRect.height } : { inset: 0 }}>
              {!capturing && <><span className="absolute left-1/3 top-0 h-full w-px bg-white/10" /><span className="absolute left-2/3 top-0 h-full w-px bg-white/10" /><span className="absolute left-0 top-1/3 h-px w-full bg-white/10" /><span className="absolute left-0 top-2/3 h-px w-full bg-white/10" /></>}
            </div>
          </div>

          <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1 rounded-xl border border-white/10 bg-[#121318]/90 p-1 shadow-xl backdrop-blur">
            {(['translate', 'rotate', 'scale'] as DirectorTransformMode[]).map((mode) => (
              <button key={mode} onClick={() => setTransformMode(mode)} className={`rounded-lg px-3 py-1.5 text-[10px] ${transformMode === mode ? 'bg-[#e8e6df] text-[#17171b]' : 'text-white/45 hover:text-white'}`}>
                {mode === 'translate' ? '移动 V' : mode === 'rotate' ? '旋转 R' : '缩放 S'}
              </button>
            ))}
          </div>
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
                <label className="block space-y-1.5 text-[10px] text-white/45">人物姿势
                  <select disabled={selected.locked} value={selected.poseId} onChange={(event) => updateElement({ ...selected, poseId: event.target.value as DirectorPoseId })} className="w-full rounded-lg border border-white/10 bg-[#1c1d23] px-3 py-2 text-[11px] text-white/70 outline-none disabled:opacity-40">
                    {DIRECTOR_POSES.map((pose) => <option key={pose.id} value={pose.id}>{pose.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          ) : activeShot ? (
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">当前机位</p>
              <input value={activeShot.name} onChange={(event) => updateActiveShot({ name: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/75 outline-none" />
              <VectorFields label="摄影机位置" value={activeShot.position} onChange={(position) => updateActiveShot({ position })} />
              <VectorFields label="注视目标" value={activeShot.target} onChange={(target) => updateActiveShot({ target })} />
              <div className="flex gap-2"><NumberField label="FOV" value={activeShot.fov} step={1} onChange={(fov) => updateActiveShot({ fov: Math.min(120, Math.max(10, fov)) })} /><NumberField label="ROLL" value={activeShot.rollDeg} step={1} onChange={(rollDeg) => updateActiveShot({ rollDeg })} /></div>
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

      <footer className="pointer-events-auto relative z-20 flex h-32 flex-shrink-0 border-t border-white/10 bg-[#111217]">
        <div className="flex w-64 flex-shrink-0 flex-col justify-center gap-2 border-r border-white/10 p-3">
          <button onClick={addShotFromDirectorView} className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/10 px-3 py-2 text-[10px] text-[#f0d98c]">＋ 从导演视角新增机位</button>
          <button onClick={saveActiveShot} disabled={!activeShot || activeShot.locked} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/55 disabled:opacity-35">更新当前 Shot 站位快照</button>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto p-3">
          <div className="flex min-w-max gap-2">
            {draft.shots.map((shot, index) => (
              <button key={shot.id} onClick={() => activateShot(shot)} className={`w-40 rounded-xl border p-2.5 text-left ${shot.id === activeShot?.id ? 'border-[#d4af37]/45 bg-[#d4af37]/10' : 'border-white/10 bg-white/[0.025]'}`}>
                <div className="flex items-center justify-between"><span className="text-[10px] text-white/35">SHOT {String(index + 1).padStart(2, '0')}</span><span className="text-[9px] text-white/25">{shot.durationSec}s</span></div>
                <p className="mt-1 truncate text-[11px] text-white/70">{shot.name}</p>
                <p className="mt-1 text-[9px] text-white/30">{shot.aspectRatio} · FOV {shot.fov} · {shot.cameraMove}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="flex w-72 flex-shrink-0 flex-col justify-center gap-2 border-l border-white/10 p-3">
          {activeShot && (
            <div className="flex gap-2">
              <select value={activeShot.aspectRatio} onChange={(event) => updateActiveShot({ aspectRatio: event.target.value as DirectorAspectRatio })} className="flex-1 rounded-lg border border-white/10 bg-[#1c1d23] px-2 py-2 text-[10px] text-white/65">
                {DIRECTOR_ASPECT_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}
              </select>
              <NumberField label="时长" value={activeShot.durationSec} step={1} onChange={(durationSec) => updateActiveShot({ durationSec: Math.max(1 / 24, durationSec) })} />
            </div>
          )}
          <button onClick={() => void capture()} disabled={!activeShot || capturing} className="rounded-lg bg-[#e8e6df] px-3 py-2.5 text-[11px] font-semibold text-[#17171b] disabled:opacity-45">{capturing ? '正在拍摄…' : '拍摄构图并发送到画布'}</button>
          {captureError && <p className="truncate text-[9px] text-rose-300" title={captureError}>{captureError}</p>}
        </div>
      </footer>
    </div>,
    document.body,
  )
}
