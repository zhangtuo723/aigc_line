import type { DirectorActorModelId, DirectorBodyType } from '../../shared/director.types'

export interface DirectorBodyProfile {
  id: DirectorBodyType
  label: string
  defaultHeightM: number
  head: number
  shoulder: number
  torsoWidth: number
  torsoDepth: number
  torsoLength: number
  armLength: number
  armThickness: number
  legLength: number
  legThickness: number
  hipWidth: number
  belly: number
}

export const DIRECTOR_ACTOR_MODELS: Array<{ id: DirectorActorModelId; label: string; description: string }> = [
  { id: 'director-rig-v1', label: 'UE 骨骼白模', description: 'SkinnedMesh 骨架角色，适合主演和姿势预演' },
  { id: 'lightweight-v1', label: '轻量白模', description: '低细节版本，适合远景和大量角色' },
]

export const DIRECTOR_BODY_PROFILES: DirectorBodyProfile[] = [
  { id: 'standard', label: '标准', defaultHeightM: 1.72, head: 1, shoulder: 1, torsoWidth: 1, torsoDepth: 1, torsoLength: 1, armLength: 1, armThickness: 1, legLength: 1, legThickness: 1, hipWidth: 1, belly: 0 },
  { id: 'heavy', label: '壮硕 / 胖', defaultHeightM: 1.72, head: 1.08, shoulder: 1.22, torsoWidth: 1.34, torsoDepth: 1.38, torsoLength: 0.98, armLength: 0.96, armThickness: 1.45, legLength: 0.94, legThickness: 1.38, hipWidth: 1.28, belly: 1 },
  { id: 'slim', label: '纤瘦', defaultHeightM: 1.76, head: 0.96, shoulder: 0.9, torsoWidth: 0.72, torsoDepth: 0.74, torsoLength: 1.04, armLength: 1.06, armThickness: 0.68, legLength: 1.08, legThickness: 0.68, hipWidth: 0.82, belly: 0 },
  { id: 'short', label: '矮小', defaultHeightM: 1.46, head: 1.14, shoulder: 0.94, torsoWidth: 0.98, torsoDepth: 0.98, torsoLength: 0.92, armLength: 0.86, armThickness: 0.96, legLength: 0.72, legThickness: 0.98, hipWidth: 1, belly: 0 },
  { id: 'tall', label: '高大', defaultHeightM: 1.94, head: 0.92, shoulder: 1.08, torsoWidth: 1.02, torsoDepth: 1, torsoLength: 1.08, armLength: 1.12, armThickness: 1.02, legLength: 1.2, legThickness: 1.02, hipWidth: 1, belly: 0 },
]

export function directorBodyProfile(bodyType?: DirectorBodyType): DirectorBodyProfile {
  return DIRECTOR_BODY_PROFILES.find((profile) => profile.id === bodyType) ?? DIRECTOR_BODY_PROFILES[0]
}
