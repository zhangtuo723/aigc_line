export type SnapshotSaveState = 'saved' | 'pending' | 'saving' | 'error'

/** Keeps the latest unsaved draft alive even after its React view unmounts. */
export class SnapshotPersistence<T> {
  private pending: { value: T; revision: number } | undefined
  private revision = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private listeners = new Set<() => void>()
  private state: SnapshotSaveState = 'saved'
  error = ''

  constructor(private write: (value: T) => Promise<void>, private delay = 700) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getState = () => this.state
  getPending = () => this.pending?.value
  private update(state: SnapshotSaveState, error = '') {
    this.state = state
    this.error = error
    this.listeners.forEach((listener) => listener())
  }

  schedule(value: T): void {
    this.pending = { value, revision: ++this.revision }
    this.update(this.running ? 'saving' : 'pending')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch(() => {}) }, this.delay)
  }

  flush = (): Promise<void> => {
    clearTimeout(this.timer)
    if (this.running) return this.running
    if (!this.pending) return Promise.resolve()
    this.running = this.drain().finally(() => { this.running = undefined })
    return this.running
  }

  private async drain() {
    try {
      while (this.pending) {
        const entry = this.pending
        this.update('saving')
        await this.write(entry.value)
        if (this.pending.revision === entry.revision) this.pending = undefined
      }
      this.update('saved')
    } catch (error) {
      this.update('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }
}

const writers = new Map<string, SnapshotPersistence<unknown>>()
export function projectSnapshotWriter<T>(folderPath: string): SnapshotPersistence<T> {
  let writer = writers.get(folderPath)
  if (!writer) {
    writer = new SnapshotPersistence(async (snapshot) => {
      const result = await window.electronAPI.saveCanvasSnapshot(folderPath, snapshot)
      if (!result.success) throw new Error('画布保存失败，请重试')
    })
    writers.set(folderPath, writer)
  }
  return writer as SnapshotPersistence<T>
}
