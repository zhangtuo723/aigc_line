/** Lightweight catalog shared by the editor, persisted schema, and Agent tools. */
export const DIRECTOR_PRIMITIVE_KINDS = [
  'box', 'sphere', 'cylinder', 'wall', 'floor', 'platform', 'stairs', 'ramp', 'cone', 'capsule',
  'doorframe', 'windowframe', 'table', 'chair', 'sofa', 'bed', 'cabinet', 'railing',
] as const

export const DIRECTOR_ELEMENT_KINDS = ['actor', 'crowd', ...DIRECTOR_PRIMITIVE_KINDS] as const

export const DIRECTOR_ELEMENT_CATEGORIES = [
  { id: 'people', label: '人物' },
  { id: 'primitives', label: '基础几何' },
  { id: 'architecture', label: '建筑' },
  { id: 'furniture', label: '家具' },
] as const

export type DirectorElementCategory = typeof DIRECTOR_ELEMENT_CATEGORIES[number]['id']
export interface DirectorElementCatalogEntry {
  kind: typeof DIRECTOR_ELEMENT_KINDS[number]
  label: string
  name?: string
  category: DirectorElementCategory
  description: string
  /** Default transform scale. Fixtures have unit bounds; the legacy capsule is half-width/depth. */
  size: { x: number; y: number; z: number }
  color?: string
}

const catalog: Record<DirectorElementCatalogEntry['kind'], Omit<DirectorElementCatalogEntry, 'kind'>> = {
  actor: { label: '演员', category: 'people', description: '可摆姿势和沿路径运动的演员白模', size: { x: 1, y: 1, z: 1 } },
  crowd: { label: '群众', name: '群众阵列', category: 'people', description: '可调整行列和间距的轻量群众阵列', size: { x: 1, y: 1, z: 1 } },
  box: { label: '立方体', category: 'primitives', description: '通用体块和道具占位', size: { x: 1.5, y: 0.8, z: 1.5 } },
  sphere: { label: '球体', category: 'primitives', description: '球形道具和曲面占位', size: { x: 0.8, y: 0.8, z: 0.8 } },
  cylinder: { label: '圆柱', name: '圆柱体', category: 'primitives', description: '柱子、圆台和圆形道具', size: { x: 0.65, y: 1.2, z: 0.65 } },
  cone: { label: '圆锥', name: '圆锥体', category: 'primitives', description: '锥形道具和屋顶占位', size: { x: 1.2, y: 1.8, z: 1.2 } },
  capsule: { label: '胶囊', name: '胶囊体', category: 'primitives', description: '圆角长形体块', size: { x: 0.9, y: 1.8, z: 0.9 } },
  wall: { label: '墙体', category: 'architecture', description: '室内隔墙和建筑立面', size: { x: 4, y: 2.4, z: 0.15 } },
  floor: { label: '地面', category: 'architecture', description: '房间、道路和空间底板', size: { x: 8, y: 0.08, z: 8 }, color: '#596170' },
  platform: { label: '平台', category: 'architecture', description: '高台、舞台和抬高地面', size: { x: 3, y: 0.45, z: 3 }, color: '#8a8178' },
  stairs: { label: '楼梯', category: 'architecture', description: '可用于人物路径取点的六级楼梯', size: { x: 2.4, y: 1.5, z: 3.2 }, color: '#8a8178' },
  ramp: { label: '斜坡', category: 'architecture', description: '连接不同高度的楔形坡面', size: { x: 2.4, y: 1.2, z: 3.2 }, color: '#8a8178' },
  doorframe: { label: '门框', category: 'architecture', description: '保留真实开口的门洞框架', size: { x: 1.2, y: 2.2, z: 0.2 }, color: '#a99b88' },
  windowframe: { label: '窗框', category: 'architecture', description: '保留真实开口的窗框，可调整离地高度', size: { x: 1.5, y: 1.2, z: 0.16 }, color: '#aebac2' },
  railing: { label: '栏杆', category: 'architecture', description: '带立柱和扶手的阳台、走廊护栏', size: { x: 2, y: 1, z: 0.12 }, color: '#aebac2' },
  table: { label: '桌子', category: 'furniture', description: '带桌面与四腿的餐桌或工作桌', size: { x: 1.6, y: 0.75, z: 0.8 }, color: '#aa8b68' },
  chair: { label: '椅子', category: 'furniture', description: '带靠背、坐面和椅腿的座椅', size: { x: 0.5, y: 0.9, z: 0.5 }, color: '#aa8b68' },
  sofa: { label: '沙发', category: 'furniture', description: '带靠背、扶手和坐垫的双人沙发', size: { x: 2.2, y: 0.9, z: 0.9 }, color: '#8798a4' },
  bed: { label: '床', category: 'furniture', description: '带床头、床架和床垫的双人床', size: { x: 1.6, y: 0.8, z: 2.1 }, color: '#b4a695' },
  cabinet: { label: '柜子', category: 'furniture', description: '带门板的立式收纳柜', size: { x: 1, y: 1.9, z: 0.5 }, color: '#aa8b68' },
}

export const DIRECTOR_ELEMENT_CATALOG: readonly DirectorElementCatalogEntry[] = DIRECTOR_ELEMENT_KINDS.map(
  (kind) => ({ kind, ...catalog[kind] }),
)

export function directorElementCatalogEntry(kind: DirectorElementCatalogEntry['kind']): DirectorElementCatalogEntry {
  return { kind, ...catalog[kind] }
}
