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

const poseSchema = z.enum(['stand', 'walk', 'sit', 'arms-crossed', 'point', 'kneel'])

export const directorElementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['actor', 'box', 'sphere', 'cylinder', 'wall', 'crowd']),
  name: z.string(),
  transform: transformSchema,
  color: z.string().min(1),
  visible: z.boolean(),
  locked: z.boolean(),
  poseId: poseSchema.optional(),
  heightM: finiteNumber.positive().optional(),
  rows: z.number().int().positive().optional(),
  columns: z.number().int().positive().optional(),
  spacing: finiteNumber.positive().optional(),
  referenceNodeId: z.string().optional(),
}).strict()

const elementStateSchema = z.object({
  transform: transformSchema,
  visible: z.boolean(),
  poseId: poseSchema.optional(),
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
  elementStates: z.record(z.string(), elementStateSchema),
  locked: z.boolean(),
  notes: z.string().optional(),
  lastCapturePath: z.string().optional(),
}).strict()

/** Strict wire/storage schema. Semantic cross-reference checks live in director-model. */
export const directorProjectSchema = z.object({
  version: z.literal(1),
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

