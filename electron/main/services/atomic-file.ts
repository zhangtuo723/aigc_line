import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const operations = new Map<string, Promise<unknown>>()
export function serializeFileOperation<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(filePath)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const current = (operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation)
  operations.set(key, current)
  void current.finally(() => { if (operations.get(key) === current) operations.delete(key) }).catch(() => undefined)
  return current
}

/** Caller owns transaction serialization when replacing shared state. */
export async function atomicWriteFile(filePath: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' })
    await fs.rename(temporary, filePath)
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  }
}

export async function flushFileOperations(): Promise<void> {
  while (operations.size) await Promise.allSettled([...operations.values()])
}
