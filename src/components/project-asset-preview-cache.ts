/** Small data URLs avoid keeping video decoders or full-resolution bitmaps alive. */
export class AssetPreviewCache {
  private entries = new Map<string, string>()
  private bytes = 0
  constructor(private limit = 80, private byteLimit = 8 * 1024 * 1024) {}

  /** Read during initial render without changing recency. Effects use get(). */
  peek(key: string): string | undefined {
    return this.entries.get(key)
  }

  get(key: string): string | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value) }
    return value
  }

  set(key: string, value: string): void {
    const previous = this.entries.get(key)
    if (previous !== undefined) { this.bytes -= previous.length * 2; this.entries.delete(key) }
    if (value.length * 2 > this.byteLimit) return
    this.entries.set(key, value)
    this.bytes += value.length * 2
    while (this.entries.size > this.limit || this.bytes > this.byteLimit) {
      const oldest = this.entries.keys().next().value!
      this.bytes -= this.entries.get(oldest)!.length * 2
      this.entries.delete(oldest)
    }
  }
}

type PreviewJob = { start: () => void }
export class AssetPreviewPool {
  private active = 0
  private waiting: PreviewJob[] = []
  constructor(private concurrency = 2) {}

  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiting = this.waiting.filter((entry) => entry !== job)
        reject(new DOMException('Preview cancelled', 'AbortError'))
      }
      const job: PreviewJob = { start: () => {
        signal.removeEventListener('abort', abort)
        this.active += 1
        Promise.resolve().then(task).then(resolve, reject).finally(() => { this.active -= 1; this.pump() })
      } }
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      this.waiting.push(job)
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length) this.waiting.shift()!.start()
  }
}
