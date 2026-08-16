import type { ComfyWorkflowInfo } from './ipc.types'

let cachedWorkflows: ComfyWorkflowInfo[] | null = null
let pendingWorkflows: Promise<ComfyWorkflowInfo[]> | null = null

export function listCachedComfyWorkflows(forceRefresh = false): Promise<ComfyWorkflowInfo[]> {
  if (!forceRefresh && cachedWorkflows) return Promise.resolve(cachedWorkflows)
  if (!forceRefresh && pendingWorkflows) return pendingWorkflows
  pendingWorkflows = window.electronAPI.listComfyWorkflows()
    .then((workflows) => {
      cachedWorkflows = workflows
      return workflows
    })
    .finally(() => {
      pendingWorkflows = null
    })
  return pendingWorkflows
}

