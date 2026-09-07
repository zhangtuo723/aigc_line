import { describe, expect, it } from 'vitest'
import { EditHistory } from '../src/shared/edit-history'
import { vacantNodePosition } from '../src/shared/canvas-placement'
import { CanvasReferenceIndex } from '../src/shared/canvas-reference-index'

describe('canvas edit helpers', () => {
  it('coalesces one input edit and preserves runtime changes without an undo step', () => {
    const history = new EditHistory<{ prompt: string; output: string }>()
    history.reset({ prompt: '', output: '' }, '')
    history.observe({ prompt: 'a', output: '' }, 'a', 'prompt')
    history.observe({ prompt: 'ab', output: '' }, 'ab', 'prompt')
    history.observe({ prompt: 'ab', output: 'generated.png' }, 'ab')
    expect(history.undo()?.prompt).toBe('')
    expect(history.canUndo).toBe(false)
    expect(history.redo()?.output).toBe('generated.png')
  })
  it('limits retained history and drops redo after a fresh edit', () => {
    const history = new EditHistory<number>(2)
    history.reset(0, '0')
    for (let i = 1; i <= 4; i++) history.observe(i, String(i))
    expect(history.undo()).toBe(3)
    expect(history.undo()).toBe(2)
    expect(history.undo()).toBeUndefined()
    history.observe(5, '5')
    expect(history.canRedo).toBe(false)
  })
  it('places consecutive wide nodes without covering the previous node', () => {
    const first = vacantNodePosition([], { x: 400, y: 400 }, 620)
    const second = vacantNodePosition([{ position: first, data: { kind: 'image' } }], { x: 400, y: 400 }, 620)
    expect(second.x - first.x).toBeGreaterThanOrEqual(668)
  })
  it('updates only affected references and ignores unrelated prompt/selection changes', () => {
    const a = { id: 'image', data: { kind: 'image', title: 'Source', sourcePath: 'a.png' } }
    const board = { id: 'board', data: { kind: 'image-editor', title: 'Board' } }
    const index = new CanvasReferenceIndex<typeof a | typeof board>()
    let updates = 0
    index.subscribe('board', () => updates++)
    index.update([a, board], [{ source: 'image', target: 'board' }])
    const previous = index.get('board')
    index.update([{ ...a, data: { ...a.data } }, board], [{ source: 'image', target: 'board' }])
    expect(index.get('board')).toBe(previous)
    expect(updates).toBe(1)
    index.update([a, board], [])
    expect(index.get('board')).toEqual([])
    expect(updates).toBe(2)
  })
})
