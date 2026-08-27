import { Euler, Matrix4, Vector3 } from 'three'

export interface DirectorMannequinPose {
  leftArm?: [number, number, number]
  rightArm?: [number, number, number]
  leftForearm?: [number, number, number]
  rightForearm?: [number, number, number]
  leftLeg?: [number, number, number]
  rightLeg?: [number, number, number]
  leftKnee?: [number, number, number]
  rightKnee?: [number, number, number]
  leftFoot?: [number, number, number]
  rightFoot?: [number, number, number]
}

const ZERO_ROTATION: [number, number, number] = [0, 0, 0]
const FOOT_BOX_MIN = new Vector3(-0.07, 0, -0.06)
const FOOT_BOX_MAX = new Vector3(0.07, 0.07, 0.23)
const FOOT_TOE_CENTER = new Vector3(0, 0.036, 0.235)
const FOOT_TOE_RADIUS = 0.07
const footOffsetCache = new WeakMap<DirectorMannequinPose, Map<number, number>>()

function rotationMatrix(rotation = ZERO_ROTATION): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(...rotation))
}

function lightweightFootSoleY(
  hipX: number,
  legLength: number,
  legRotation?: [number, number, number],
  kneeRotation?: [number, number, number],
  footRotation?: [number, number, number],
): number {
  const upperRotation = rotationMatrix(legRotation)
  const lowerRotation = upperRotation.clone().multiply(rotationMatrix(kneeRotation))
  const finalFootRotation = lowerRotation.clone().multiply(rotationMatrix(footRotation))
  const ankle = new Vector3(hipX, 0.84, 0)
    .add(new Vector3(0, -0.46 * legLength, 0).applyMatrix4(upperRotation))
    .add(new Vector3(0, -0.45 * legLength, 0).applyMatrix4(lowerRotation))
  let minY = Number.POSITIVE_INFINITY
  for (const x of [FOOT_BOX_MIN.x, FOOT_BOX_MAX.x]) {
    for (const y of [FOOT_BOX_MIN.y, FOOT_BOX_MAX.y]) {
      for (const z of [FOOT_BOX_MIN.z, FOOT_BOX_MAX.z]) {
        minY = Math.min(minY, new Vector3(x, y, z).applyMatrix4(finalFootRotation).add(ankle).y)
      }
    }
  }
  const toeCenterY = FOOT_TOE_CENTER.clone().applyMatrix4(finalFootRotation).add(ankle).y
  return Math.min(minY, toeCenterY - FOOT_TOE_RADIUS)
}

/** Places the lowest shoe sole exactly on the actor root for every body and pose. */
export function directorLightweightFootOffset(pose: DirectorMannequinPose, legLength: number): number {
  const cachedByLength = footOffsetCache.get(pose)
  const cached = cachedByLength?.get(legLength)
  if (cached !== undefined) return cached
  const left = lightweightFootSoleY(-0.11, legLength, pose.leftLeg, pose.leftKnee, pose.leftFoot)
  const right = lightweightFootSoleY(0.11, legLength, pose.rightLeg, pose.rightKnee, pose.rightFoot)
  const offset = -Math.min(left, right)
  const nextByLength = cachedByLength ?? new Map<number, number>()
  nextByLength.set(legLength, offset)
  if (!cachedByLength) footOffsetCache.set(pose, nextByLength)
  return offset
}
