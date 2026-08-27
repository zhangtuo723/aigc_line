import { z } from 'zod'

const finiteNumber = z.number().finite()
const vec3Schema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  z: finiteNumber,
}).strict()

const transformSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
}).strict()

const poseSchema = z.enum([
  'stand', 'walk', 'sit', 'arms-crossed', 'point', 'kneel',
  'hands-on-hips', 'wave', 'hands-up', 'crouch', 'lean', 'look-back',
])

export const directorElementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['actor', 'crowd', 'box', 'sphere', 'cylinder', 'wall', 'floor', 'platform', 'stairs', 'ramp', 'cone', 'capsule']),
  name: z.string(),
  transform: transformSchema,
  color: z.string().min(1),
  visible: z.boolean(),
  locked: z.boolean(),
  poseId: poseSchema.optional(),
  actorModelId: z.enum(['director-rig-v1', 'lightweight-v1']).optional(),
  bodyType: z.enum(['standard', 'heavy', 'slim', 'short', 'tall']).optional(),
  heightM: finiteNumber.positive().optional(),
  rows: z.number().int().positive().optional(),
  columns: z.number().int().positive().optional(),
  spacing: finiteNumber.positive().optional(),
  referenceNodeId: z.string().optional(),
}).strict()

const cameraKeyframeSchema = z.object({
  id: z.string().min(1),
  frame: z.number().int().nonnegative(),
  position: vec3Schema,
  target: vec3Schema,
  fov: finiteNumber.min(10).max(120),
  interpolation: z.enum(['hold', 'linear', 'smooth', 'ease-in', 'ease-out']),
  locked: z.boolean().optional(),
}).strict()

const actorTrackSchema = z.object({
  id: z.string().min(1),
  elementId: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().nonnegative(),
  points: z.array(vec3Schema).min(2),
  interpolation: z.enum(['linear', 'smooth']),
  orientToPath: z.boolean(),
  motion: z.enum(['walk', 'run']),
}).strict()

const cameraConstraintSchema = z.object({
  mode: z.enum(['free', 'look-at', 'follow']),
  targetElementId: z.string().min(1).optional(),
  targetOffset: vec3Schema,
  followOffset: vec3Schema,
}).strict()

export const directorShotSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  durationSec: finiteNumber.positive(),
  aspectRatio: z.enum(['16:9', '9:16', '4:3', '1:1']),
  position: vec3Schema,
  target: vec3Schema,
  fov: finiteNumber.min(10).max(120),
  rollDeg: finiteNumber,
  cameraMove: z.enum([
    'static', 'push', 'pull', 'truck-left', 'truck-right',
    'pan-left', 'pan-right', 'orbit', 'follow', 'handheld',
  ]),
  cameraKeyframes: z.array(cameraKeyframeSchema),
  actorTracks: z.array(actorTrackSchema),
  cameraConstraint: cameraConstraintSchema,
  locked: z.boolean(),
  notes: z.string().optional(),
  lastCapturePath: z.string().optional(),
}).strict()

/** Strict wire/storage schema. Semantic cross-reference checks live in director-model. */
export const directorProjectSchema = z.object({
  version: z.literal(2),
  fps: z.literal(24),
  name: z.string(),
  backgroundColor: z.string().min(1),
  groundColor: z.string().min(1),
  showGround: z.boolean(),
  showGrid: z.boolean(),
  elements: z.array(directorElementSchema),
  shots: z.array(directorShotSchema).min(1),
  activeShotId: z.string().min(1),
  updatedAt: finiteNumber.nonnegative(),
}).strict()

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const scenePositionSchema = z.object({
  x: finiteNumber.min(-50).max(50),
  y: finiteNumber.min(-10).max(50),
  z: finiteNumber.min(-50).max(50),
}).strict()
const sceneRotationSchema = z.object({
  x: finiteNumber.min(-360).max(360),
  y: finiteNumber.min(-360).max(360),
  z: finiteNumber.min(-360).max(360),
}).strict()
const sceneScaleSchema = z.object({
  x: finiteNumber.min(0.02).max(50),
  y: finiteNumber.min(0.02).max(50),
  z: finiteNumber.min(0.02).max(50),
}).strict()
const sceneTransformSchema = z.object({
  position: scenePositionSchema,
  rotation: sceneRotationSchema,
  scale: sceneScaleSchema,
}).strict()

export const directorSceneDraftSchema = z.object({
  summary: z.string().min(1).max(1_000),
  groundColor: hexColorSchema.optional(),
  backgroundColor: hexColorSchema.optional(),
  elements: z.array(z.object({
    kind: z.enum(['box', 'sphere', 'cylinder', 'wall', 'floor', 'platform', 'stairs', 'ramp', 'cone', 'capsule']),
    name: z.string().min(1).max(80),
    color: hexColorSchema,
    placement: z.enum(['ground', 'elevated']),
    transform: sceneTransformSchema,
  }).strict()).min(1).max(40),
}).strict()
