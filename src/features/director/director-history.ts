import type { DirectorProject } from '../../shared/director.types'

export type DirectorHistory = { past: DirectorProject[]; future: DirectorProject[] }
export const createDirectorHistory = (): DirectorHistory => ({ past: [], future: [] })

/** Immutable snapshots are shared; timestamps and active-shot navigation are not edits. */
export function recordDirectorEdit(history: DirectorHistory, before: DirectorProject, after: DirectorProject, limit = 60): DirectorHistory {
  if (before === after) return history
  return { past: [...history.past, before].slice(-limit), future: [] }
}

export function moveDirectorHistory(history: DirectorHistory, current: DirectorProject, direction: 'undo' | 'redo') {
  const source = direction === 'undo' ? history.past : history.future
  const target = source.at(-1)
  if (!target) return { history, project: current }
  // Media export metadata is not an edit and must survive undo/redo.
  const shots = target.shots.map((shot) => {
    const live = current.shots.find((item) => item.id === shot.id)
    return live?.lastCapturePath ? { ...shot, lastCapturePath: live.lastCapturePath } : shot
  })
  return {
    history: direction === 'undo'
      ? { past: history.past.slice(0, -1), future: [...history.future, current] }
      : { past: [...history.past, current], future: history.future.slice(0, -1) },
    project: {
      ...target,
      shots,
      activeShotId: shots.some((shot) => shot.id === current.activeShotId) ? current.activeShotId : target.activeShotId,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    },
  }
}
