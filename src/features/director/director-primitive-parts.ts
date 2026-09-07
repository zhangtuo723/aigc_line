export type DirectorFixtureKind = 'doorframe' | 'windowframe' | 'table' | 'chair' | 'sofa' | 'bed' | 'cabinet' | 'railing'

export type DirectorPrimitivePart = {
  id: string
  position: [number, number, number]
  size: [number, number, number]
  tone?: 'trim' | 'cushion' | 'accent'
}

const part = (
  id: string,
  size: DirectorPrimitivePart['size'],
  position: DirectorPrimitivePart['position'],
  tone?: DirectorPrimitivePart['tone'],
): DirectorPrimitivePart => ({ id, size, position, ...(tone ? { tone } : {}) })

const feet = (width: number, height: number, depth: number, x: number, z: number) => (
  [-1, 1].flatMap((side) => [-1, 1].map((end) => (
    part(`foot-${side}-${end}`, [width, height, depth], [side * x, height / 2, end * z], 'trim')
  )))
)

/**
 * Each fixture occupies x/z [-0.5, 0.5] and y [0, 1]. Its element transform
 * therefore supplies the complete outer dimensions and the bottom anchor.
 * +Z is the front. These are real surfaces, with no box covering the openings.
 */
export const DIRECTOR_FIXTURE_PARTS: Record<DirectorFixtureKind, readonly DirectorPrimitivePart[]> = {
  doorframe: [
    part('left-jamb', [0.1, 0.94, 1], [-0.45, 0.47, 0]),
    part('right-jamb', [0.1, 0.94, 1], [0.45, 0.47, 0]),
    part('lintel', [1, 0.06, 1], [0, 0.97, 0]),
  ],
  windowframe: [
    part('left-jamb', [0.07, 0.86, 1], [-0.465, 0.5, 0]),
    part('right-jamb', [0.07, 0.86, 1], [0.465, 0.5, 0]),
    part('lintel', [1, 0.07, 1], [0, 0.965, 0]),
    part('sill', [1, 0.07, 1], [0, 0.035, 0]),
  ],
  table: [
    ...feet(0.08, 0.9, 0.13, 0.42, 0.37),
    part('front-apron', [0.86, 0.09, 0.08], [0, 0.845, 0.39], 'trim'),
    part('back-apron', [0.86, 0.09, 0.08], [0, 0.845, -0.39], 'trim'),
    part('left-apron', [0.06, 0.09, 0.78], [-0.4, 0.845, 0], 'trim'),
    part('right-apron', [0.06, 0.09, 0.78], [0.4, 0.845, 0], 'trim'),
    part('top', [1, 0.1, 1], [0, 0.95, 0]),
  ],
  chair: [
    part('front-left-leg', [0.12, 0.44, 0.12], [-0.39, 0.22, 0.39], 'trim'),
    part('front-right-leg', [0.12, 0.44, 0.12], [0.39, 0.22, 0.39], 'trim'),
    part('back-left-leg', [0.12, 0.94, 0.12], [-0.39, 0.47, -0.44], 'trim'),
    part('back-right-leg', [0.12, 0.94, 0.12], [0.39, 0.47, -0.44], 'trim'),
    part('seat', [1, 0.09, 1], [0, 0.485, 0], 'cushion'),
    part('backrest', [1, 0.39, 0.13], [0, 0.805, -0.435]),
  ],
  sofa: [
    ...feet(0.09, 0.12, 0.13, 0.4, 0.35),
    part('base', [1, 0.3, 1], [0, 0.27, 0], 'trim'),
    part('back', [1, 0.58, 0.16], [0, 0.71, -0.42]),
    part('left-arm', [0.1, 0.31, 0.84], [-0.45, 0.575, 0.08]),
    part('right-arm', [0.1, 0.31, 0.84], [0.45, 0.575, 0.08]),
    part('left-seat', [0.395, 0.12, 0.78], [-0.2025, 0.48, 0.07], 'cushion'),
    part('right-seat', [0.395, 0.12, 0.78], [0.2025, 0.48, 0.07], 'cushion'),
    part('left-back-cushion', [0.395, 0.3, 0.09], [-0.2025, 0.75, -0.295], 'cushion'),
    part('right-back-cushion', [0.395, 0.3, 0.09], [0.2025, 0.75, -0.295], 'cushion'),
  ],
  bed: [
    ...feet(0.08, 0.16, 0.08, 0.42, 0.39),
    part('base', [1, 0.27, 0.94], [0, 0.295, 0.03], 'trim'),
    part('mattress', [0.96, 0.2, 0.87], [0, 0.53, 0.045], 'cushion'),
    part('headboard', [1, 1, 0.08], [0, 0.5, -0.46]),
    part('footboard', [1, 0.32, 0.05], [0, 0.32, 0.475]),
    part('left-pillow', [0.39, 0.1, 0.16], [-0.23, 0.68, -0.275], 'cushion'),
    part('right-pillow', [0.39, 0.1, 0.16], [0.23, 0.68, -0.275], 'cushion'),
  ],
  cabinet: [
    part('back', [1, 1, 0.08], [0, 0.5, -0.46], 'trim'),
    part('left-side', [0.055, 1, 0.92], [-0.4725, 0.5, 0.04], 'trim'),
    part('right-side', [0.055, 1, 0.92], [0.4725, 0.5, 0.04], 'trim'),
    part('base', [1, 0.05, 0.92], [0, 0.025, 0.04], 'trim'),
    part('top', [1, 0.05, 0.92], [0, 0.975, 0.04], 'trim'),
    part('left-door', [0.44, 0.9, 0.045], [-0.235, 0.5, 0.4075]),
    part('right-door', [0.44, 0.9, 0.045], [0.235, 0.5, 0.4075]),
    part('left-handle', [0.018, 0.13, 0.07], [-0.045, 0.56, 0.465], 'accent'),
    part('right-handle', [0.018, 0.13, 0.07], [0.045, 0.56, 0.465], 'accent'),
  ],
  railing: [
    part('top-rail', [1, 0.09, 1], [0, 0.955, 0]),
    part('bottom-rail', [0.94, 0.07, 0.66], [0, 0.105, 0], 'trim'),
    part('left-post', [0.045, 0.91, 0.83], [-0.4775, 0.455, 0]),
    part('right-post', [0.045, 0.91, 0.83], [0.4775, 0.455, 0]),
    ...[-0.3, -0.15, 0, 0.15, 0.3].map((x, index) => (
      part(`baluster-${index}`, [0.022, 0.77, 0.5], [x, 0.525, 0], 'trim')
    )),
  ],
}

export function getDirectorFixtureParts(kind: string): readonly DirectorPrimitivePart[] | undefined {
  return Object.prototype.hasOwnProperty.call(DIRECTOR_FIXTURE_PARTS, kind)
    ? DIRECTOR_FIXTURE_PARTS[kind as DirectorFixtureKind]
    : undefined
}
