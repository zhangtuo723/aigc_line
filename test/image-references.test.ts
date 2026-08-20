import { describe, expect, it } from 'vitest'
import { orderImageReferences } from '../src/shared/image-references'

describe('ordered image references', () => {
  const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('keeps configured order and appends newly connected images', () => {
    expect(orderImageReferences(candidates, ['c', 'a'], 10).map(({ id }) => id)).toEqual(['c', 'a', 'b'])
  })

  it('drops stale and duplicate ids and applies the model limit', () => {
    expect(orderImageReferences(candidates, ['missing', 'b', 'b'], 2).map(({ id }) => id)).toEqual(['b', 'a'])
    expect(orderImageReferences(candidates, ['a'], 0)).toEqual([])
  })
})
