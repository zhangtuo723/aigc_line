import type { Material, Object3D, Skeleton, SkinnedMesh } from 'three'

/** Only release per-instance allocations. GLTF geometry/textures remain cached. */
export function disposeDirectorRig(scene: Object3D) {
  const materials = new Set<Material>()
  const skeletons = new Set<Skeleton>()
  scene.traverse((object) => {
    if (!('isSkinnedMesh' in object) || !object.isSkinnedMesh) return
    const mesh = object as SkinnedMesh
    skeletons.add(mesh.skeleton)
    if (!mesh.userData.directorMaterialIsolated) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
    delete mesh.userData.directorMaterialIsolated
  })
  materials.forEach((material) => material.dispose())
  skeletons.forEach((skeleton) => skeleton.dispose())
}
