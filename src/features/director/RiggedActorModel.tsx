import { useLoader } from '@react-three/fiber'
import { useLayoutEffect, useMemo } from 'react'
import {
  Box3,
  Color,
  Euler,
  Group,
  MeshStandardMaterial,
  Quaternion,
  type Material,
  type Object3D,
  type SkinnedMesh,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { DirectorBodyType, DirectorPoseId } from '../../shared/director.types'

const MODEL_URL = `${import.meta.env.BASE_URL}models/ue-mannequin-retopology.glb`

type BoneTransform = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

type RestPose = Record<string, BoneTransform>
type Controls = Record<string, number>
type BoneScaleMap = Record<string, [number, number, number]>

const BONES = {
  pelvis: 'Bip001_Pelvis_03',
  spine: 'Bip001_Spine_04',
  torso: 'Bip001_Spine1_05',
  head: 'Bip001_Head_055',
  neck: 'Bip001_Neck_06',
  leftClavicle: 'Bip001_L_Clavicle_07',
  rightClavicle: 'Bip001_R_Clavicle_031',
  leftArm: 'Bip001_L_UpperArm_08',
  rightArm: 'Bip001_R_UpperArm_032',
  leftForearm: 'Bip001_L_Forearm_09',
  rightForearm: 'Bip001_R_Forearm_033',
  leftHand: 'Bip001_L_Hand_010',
  rightHand: 'Bip001_R_Hand_034',
  leftThigh: 'Bip001_L_Thigh_057',
  rightThigh: 'Bip001_R_Thigh_061',
  leftCalf: 'Bip001_L_Calf_058',
  rightCalf: 'Bip001_R_Calf_062',
  leftFoot: 'Bip001_L_Foot_059',
  rightFoot: 'Bip001_R_Foot_063',
} as const

const POSE_CONTROLS: Record<DirectorPoseId, Controls> = {
  stand: {},
  walk: { 'leftShoulder.pitch': 20, 'rightShoulder.pitch': -20, 'leftHip.pitch': -20, 'rightHip.pitch': 20, 'leftKnee.bend': 12, 'rightKnee.bend': 4 },
  sit: { 'torso.pitch': -10, 'leftHip.pitch': 80, 'rightHip.pitch': 80, 'leftKnee.bend': 90, 'rightKnee.bend': 90 },
  crouch: { 'body.offsetY': -0.43, 'body.pitch': -26, 'torso.pitch': -24, 'head.pitch': 22, 'leftHip.pitch': 92, 'rightHip.pitch': 92, 'leftKnee.bend': 112, 'rightKnee.bend': 112, 'leftShoulder.pitch': 52, 'rightShoulder.pitch': 50, 'leftElbow.bend': 80, 'rightElbow.bend': 76 },
  kneel: { 'body.offsetY': -0.42, 'body.pitch': -16, 'torso.pitch': -10, 'head.pitch': 12, 'leftHip.pitch': 68, 'leftKnee.bend': 86, 'leftFoot.pitch': 20, 'rightHip.pitch': -15, 'rightKnee.bend': 80, 'rightFoot.pitch': 60, 'leftElbow.bend': 30, 'rightShoulder.pitch': -18, 'rightElbow.bend': 18 },
  'hands-on-hips': { 'leftShoulder.pitch': -36, 'rightShoulder.pitch': -36, 'leftShoulder.twist': 80, 'rightShoulder.twist': -80, 'leftElbow.bend': 86, 'rightElbow.bend': 86, 'leftHand.roll': -35, 'rightHand.roll': 35 },
  lean: { 'body.roll': -10, 'leftHip.spread': -8, 'rightHip.spread': 8, 'head.roll': 6 },
  wave: { 'rightShoulder.pitch': 60, 'rightShoulder.twist': 30, 'rightElbow.bend': 90, 'rightHand.roll': -20, 'rightHand.pitch': 12, 'leftShoulder.pitch': -10, 'leftShoulder.spread': 8, 'leftElbow.bend': 18 },
  'arms-crossed': { 'leftShoulder.pitch': 50, 'leftShoulder.spread': -55, 'leftShoulder.twist': 75, 'leftElbow.bend': 50, 'leftHand.pitch': -10, 'rightShoulder.pitch': 90, 'rightShoulder.spread': 55, 'rightShoulder.twist': -45, 'rightElbow.bend': 50, 'rightHand.roll': 18, 'rightHand.pitch': -10 },
  point: { 'rightShoulder.pitch': 82, 'rightElbow.bend': 8, 'leftShoulder.pitch': -8 },
  'hands-up': { 'leftShoulder.pitch': 105, 'rightShoulder.pitch': 105, 'leftShoulder.spread': -10, 'rightShoulder.spread': 10, 'leftElbow.bend': 8, 'rightElbow.bend': 8 },
  'look-back': { 'body.yaw': 12, 'torso.yaw': 28, 'head.yaw': 48, 'leftHip.pitch': -8, 'rightHip.pitch': 8 },
}

const rad = (value = 0) => value * Math.PI / 180
const spineRotation = (controls: Controls, prefix: string): [number, number, number] => [rad(controls[`${prefix}.yaw`]), rad(controls[`${prefix}.roll`]), -rad(controls[`${prefix}.pitch`])]
const shoulderRotation = (controls: Controls, prefix: string): [number, number, number] => [rad(controls[`${prefix}.twist`]), rad(controls[`${prefix}.spread`]), -rad(controls[`${prefix}.pitch`])]
const hipRotation = (controls: Controls, prefix: string): [number, number, number] => [rad(controls[`${prefix}.twist`]), -rad(controls[`${prefix}.spread`]), rad(controls[`${prefix}.pitch`])]
const handRotation = (controls: Controls, prefix: string): [number, number, number] => [rad(controls[`${prefix}.twist`]), rad(controls[`${prefix}.roll`]), rad(controls[`${prefix}.pitch`])]

function captureRestPose(scene: Object3D): RestPose {
  const pose: RestPose = {}
  scene.traverse((object) => {
    if (!('isBone' in object) || object.isBone !== true) return
    pose[object.name] = {
      position: [object.position.x, object.position.y, object.position.z],
      quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    }
  })
  return pose
}

function bodyBoneScales(bodyType: DirectorBodyType): BoneScaleMap {
  const scales: BoneScaleMap = {}
  if (bodyType === 'heavy') {
    scales[BONES.pelvis] = [1.02, 1.18, 1.14]
    scales[BONES.torso] = [1.02, 1.3, 1.16]
    scales[BONES.leftClavicle] = scales[BONES.rightClavicle] = [1.14, 1, 1]
    scales[BONES.leftArm] = scales[BONES.rightArm] = [1, 1.18, 1.18]
    scales[BONES.leftForearm] = scales[BONES.rightForearm] = [1, 1.12, 1.12]
    scales[BONES.leftThigh] = scales[BONES.rightThigh] = [1, 1.14, 1.12]
  } else if (bodyType === 'slim') {
    scales[BONES.pelvis] = [0.98, 0.78, 0.9]
    scales[BONES.torso] = [0.98, 0.86, 0.9]
    scales[BONES.leftClavicle] = scales[BONES.rightClavicle] = [0.9, 1, 0.9]
    scales[BONES.leftArm] = scales[BONES.rightArm] = [1, 0.82, 0.82]
    scales[BONES.leftForearm] = scales[BONES.rightForearm] = [1, 0.78, 0.78]
    scales[BONES.leftThigh] = scales[BONES.rightThigh] = [1, 0.84, 0.84]
  } else if (bodyType === 'short') {
    scales[BONES.head] = [1.3, 1.3, 1.3]
    scales[BONES.pelvis] = [0.9, 0.94, 0.94]
    scales[BONES.torso] = [0.88, 0.9, 0.9]
    scales[BONES.leftArm] = scales[BONES.rightArm] = [0.86, 0.94, 0.94]
    scales[BONES.leftThigh] = scales[BONES.rightThigh] = [0.78, 0.92, 0.92]
    scales[BONES.leftCalf] = scales[BONES.rightCalf] = [0.84, 0.92, 0.92]
  } else if (bodyType === 'tall') {
    scales[BONES.head] = [0.92, 0.92, 0.92]
    scales[BONES.torso] = [1.08, 1.02, 1.02]
    scales[BONES.leftArm] = scales[BONES.rightArm] = [1.1, 1, 1]
    scales[BONES.leftThigh] = scales[BONES.rightThigh] = [1.12, 1, 1]
    scales[BONES.leftCalf] = scales[BONES.rightCalf] = [1.08, 1, 1]
  }
  return scales
}

function dynamicControls(poseId: DirectorPoseId, motionPhase?: number): Controls {
  const controls = { ...POSE_CONTROLS[poseId] }
  if (poseId !== 'walk' || motionPhase === undefined) return controls
  const swing = Math.sin(motionPhase * Math.PI * 2)
  controls['leftShoulder.pitch'] = swing * 36
  controls['rightShoulder.pitch'] = -swing * 36
  controls['leftHip.pitch'] = -swing * 30
  controls['rightHip.pitch'] = swing * 30
  controls['leftKnee.bend'] = Math.max(2, swing * 28)
  controls['rightKnee.bend'] = Math.max(2, -swing * 28)
  return controls
}

function applyRig(scene: Object3D, restPose: RestPose, bodyType: DirectorBodyType, controls: Controls) {
  const scales = bodyBoneScales(bodyType)
  const rotations: Record<string, [number, number, number]> = {
    [BONES.pelvis]: spineRotation(controls, 'body'),
    [BONES.torso]: spineRotation(controls, 'torso'),
    [BONES.head]: [rad(controls['head.yaw']), rad(controls['head.roll']), rad(controls['head.pitch'])],
    [BONES.leftArm]: shoulderRotation(controls, 'leftShoulder'),
    [BONES.rightArm]: shoulderRotation(controls, 'rightShoulder'),
    [BONES.leftForearm]: [0, 0, -rad(controls['leftElbow.bend'])],
    [BONES.rightForearm]: [0, 0, -rad(controls['rightElbow.bend'])],
    [BONES.leftHand]: handRotation(controls, 'leftHand'),
    [BONES.rightHand]: handRotation(controls, 'rightHand'),
    [BONES.leftThigh]: hipRotation(controls, 'leftHip'),
    [BONES.rightThigh]: hipRotation(controls, 'rightHip'),
    [BONES.leftCalf]: [0, 0, -rad(controls['leftKnee.bend'])],
    [BONES.rightCalf]: [0, 0, -rad(controls['rightKnee.bend'])],
    [BONES.leftFoot]: handRotation(controls, 'leftFoot'),
    [BONES.rightFoot]: handRotation(controls, 'rightFoot'),
  }
  scene.traverse((object) => {
    const rest = restPose[object.name]
    if (!rest) return
    object.position.set(...rest.position)
    object.quaternion.set(...rest.quaternion)
    object.scale.set(...rest.scale)
    const scale = scales[object.name]
    if (scale) object.scale.set(rest.scale[0] * scale[0], rest.scale[1] * scale[1], rest.scale[2] * scale[2])
    if (object.name === BONES.pelvis && controls['body.offsetY']) object.position.z += controls['body.offsetY'] / 0.0254
    const rotation = rotations[object.name]
    if (rotation) object.quaternion.multiply(new Quaternion().setFromEuler(new Euler(...rotation)))
  })
}

function isSkinnedMesh(object: Object3D): object is SkinnedMesh {
  return 'isSkinnedMesh' in object && object.isSkinnedMesh === true
}

function tint(scene: Object3D, color: string) {
  scene.traverse((object) => {
    object.frustumCulled = false
    if (!isSkinnedMesh(object)) return
    object.castShadow = true
    object.receiveShadow = true
    if (!object.userData.directorMaterialIsolated) {
      const material = object.material as Material | Material[]
      object.material = Array.isArray(material) ? material.map((item) => item.clone()) : material.clone()
      object.userData.directorMaterialIsolated = true
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => {
      if (!(material instanceof MeshStandardMaterial) || material.name === 'SK_Mannequin_M_UE4Man_ChestLogo') return
      material.color.copy(new Color(color))
      material.roughness = 0.68
      material.metalness = 0.04
      material.needsUpdate = true
    })
  })
}

export function RiggedActorModel({ color, bodyType = 'standard', poseId = 'stand', height = 1.72, motionPhase }: {
  color: string
  bodyType?: DirectorBodyType
  poseId?: DirectorPoseId
  height?: number
  motionPhase?: number
}) {
  const gltf = useLoader(GLTFLoader, MODEL_URL)
  const scene = useMemo(() => cloneSkeleton(gltf.scene) as Group, [gltf.scene])
  const restPose = useMemo(() => captureRestPose(scene), [scene])

  useLayoutEffect(() => {
    tint(scene, color)
    applyRig(scene, restPose, bodyType, dynamicControls(poseId, motionPhase))
    scene.position.y = 0
    scene.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(scene, true)
    if (!bounds.isEmpty() && Number.isFinite(bounds.min.y)) scene.position.y -= bounds.min.y
  }, [bodyType, color, motionPhase, poseId, restPose, scene])

  return <group scale={height / 2.04}><primitive object={scene} /></group>
}
