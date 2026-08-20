export type DirectorAspectRatio = '16:9' | '9:16' | '4:3' | '1:1'
export type DirectorElementKind = 'actor' | 'box' | 'sphere' | 'cylinder' | 'wall' | 'crowd'
export type DirectorPoseId = 'stand' | 'walk' | 'sit' | 'arms-crossed' | 'point' | 'kneel'
export type DirectorTransformMode = 'translate' | 'rotate' | 'scale'
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
  heightM?: number
  rows?: number
  columns?: number
  spacing?: number
  referenceNodeId?: string
}

export interface DirectorElementState {
  transform: DirectorTransform
  visible: boolean
  poseId?: DirectorPoseId
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
  elementStates: Record<string, DirectorElementState>
  locked: boolean
  notes?: string
  lastCapturePath?: string
}

/** Serializable 3D previs document persisted inside a canvas node snapshot. */
export interface DirectorProject {
  version: 1
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
