export type DirectorAspectRatio = '16:9' | '9:16' | '4:3' | '1:1'
export type DirectorElementKind =
  | 'actor'
  | 'crowd'
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'wall'
  | 'floor'
  | 'platform'
  | 'stairs'
  | 'ramp'
  | 'cone'
  | 'capsule'
export type DirectorPoseId =
  | 'stand'
  | 'walk'
  | 'sit'
  | 'arms-crossed'
  | 'point'
  | 'kneel'
  | 'hands-on-hips'
  | 'wave'
  | 'hands-up'
  | 'crouch'
  | 'lean'
  | 'look-back'
export type DirectorActorModelId = 'director-rig-v1' | 'lightweight-v1'
export type DirectorBodyType = 'standard' | 'heavy' | 'slim' | 'short' | 'tall'
export type DirectorTransformMode = 'translate' | 'rotate' | 'scale'
export type DirectorActorMotion = 'walk' | 'run'
export type DirectorCameraConstraintMode = 'free' | 'look-at' | 'follow'
export type DirectorCameraMove =
  | 'static'
  | 'push'
  | 'pull'
  | 'truck-left'
  | 'truck-right'
  | 'pan-left'
  | 'pan-right'
  | 'orbit'
  | 'follow'
  | 'handheld'

export interface DirectorVec3 {
  x: number
  y: number
  z: number
}

export interface DirectorTransform {
  position: DirectorVec3
  rotation: DirectorVec3
  scale: DirectorVec3
}

export interface DirectorElement {
  id: string
  kind: DirectorElementKind
  name: string
  transform: DirectorTransform
  color: string
  visible: boolean
  locked: boolean
  poseId?: DirectorPoseId
  actorModelId?: DirectorActorModelId
  bodyType?: DirectorBodyType
  heightM?: number
  rows?: number
  columns?: number
  spacing?: number
  referenceNodeId?: string
}

export interface DirectorCameraKeyframe {
  id: string
  frame: number
  position: DirectorVec3
  target: DirectorVec3
  fov: number
  interpolation: 'hold' | 'linear' | 'smooth' | 'ease-in' | 'ease-out'
  locked?: boolean
}

export interface DirectorActorTrack {
  id: string
  elementId: string
  startFrame: number
  endFrame: number
  points: DirectorVec3[]
  interpolation: 'linear' | 'smooth'
  orientToPath: boolean
  motion: DirectorActorMotion
}

export interface DirectorCameraConstraint {
  mode: DirectorCameraConstraintMode
  targetElementId?: string
  /** World-space offset added to the actor root when aiming the camera. */
  targetOffset: DirectorVec3
  /** Actor-local offset used by follow mode. Positive Z is the actor's front. */
  followOffset: DirectorVec3
}

export interface DirectorShot {
  id: string
  name: string
  durationSec: number
  aspectRatio: DirectorAspectRatio
  position: DirectorVec3
  target: DirectorVec3
  fov: number
  rollDeg: number
  cameraMove: DirectorCameraMove
  cameraKeyframes: DirectorCameraKeyframe[]
  actorTracks: DirectorActorTrack[]
  cameraConstraint: DirectorCameraConstraint
  locked: boolean
  notes?: string
  lastCapturePath?: string
}

/** Serializable 3D previs document persisted inside a canvas node snapshot. */
export interface DirectorProject {
  version: 2
  fps: 24
  name: string
  backgroundColor: string
  groundColor: string
  showGround: boolean
  showGrid: boolean
  elements: DirectorElement[]
  shots: DirectorShot[]
  activeShotId: string
  updatedAt: number
}

export type DirectorSceneDraftPrimitiveKind = Exclude<DirectorElementKind, 'actor' | 'crowd'>
export type DirectorSceneDraftPlacement = 'ground' | 'elevated'

export interface DirectorSceneDraftPrimitive {
  kind: DirectorSceneDraftPrimitiveKind
  name: string
  color: string
  placement: DirectorSceneDraftPlacement
  transform: DirectorTransform
}

export interface DirectorSceneDraft {
  summary: string
  groundColor?: string
  backgroundColor?: string
  elements: DirectorSceneDraftPrimitive[]
}

export interface SaveDirectorStillRequest {
  projectId: string
  nodeId: string
  shotId: string
  shotName: string
  pngData: ArrayBuffer
}

export interface SaveDirectorStillResult {
  success: boolean
  relativePath?: string
  error?: string
}

export interface SaveDirectorVideoRequest {
  projectId: string
  nodeId: string
  shotId: string
  shotName: string
  webmData: ArrayBuffer
}

export interface SaveDirectorVideoResult {
  success: boolean
  relativePath?: string
  error?: string
}
