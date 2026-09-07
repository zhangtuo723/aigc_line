/** Bounded immutable edit history. Runtime-only updates can refresh the baseline without creating a step. */
export class EditHistory<T> {
  private past: { value: T; key: string }[] = []
  private future: { value: T; key: string }[] = []
  private current: { value: T; key: string } | undefined
  private group: unknown
  constructor(private limit = 40) {}
  reset(value: T, key: string) { this.past = []; this.future = []; this.current = { value, key }; this.group = undefined }
  observe(value: T, key: string, group?: unknown) {
    if (!this.current) { this.reset(value, key); return }
    if (this.current.key === key) { this.current = { value, key }; return }
    if (group === undefined || group !== this.group) {
      this.past.push(this.current)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.future = []
    this.current = { value, key }; this.group = group
  }
  endGroup() { this.group = undefined }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  undo() {
    const previous = this.past.pop()
    if (!previous || !this.current) return undefined
    this.future.push(this.current); this.current = previous; this.group = undefined
    return previous.value
  }
  redo() {
    const next = this.future.pop()
    if (!next || !this.current) return undefined
    this.past.push(this.current); this.current = next; this.group = undefined
    return next.value
  }
}
