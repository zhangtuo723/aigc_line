import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  AppSettingsView,
  ConnectionTestResult,
  SaveAppSettingsRequest,
} from '../../../src/shared/ipc.types'
import { getAppDataDir } from './project.store'

interface StoredSettings {
  comfyuiBaseUrl?: string
  agentBaseUrl?: string
  encryptedAgentToken?: string
  defaultImageWorkflowId?: string
}

export interface RuntimeSettings {
  comfyuiBaseUrl: string
  agentBaseUrl: string
  agentToken: string
  defaultImageWorkflowId: string
}

const SETTINGS_FILE = 'settings.json'
const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'
const DEFAULT_WORKFLOW = 'flux2-klein-9b-t2i'

const settingsPath = (): string => path.join(getAppDataDir(), SETTINGS_FILE)

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '')

async function readStoredSettings(): Promise<StoredSettings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as StoredSettings
  } catch {
    return {}
  }
}

async function writeStoredSettings(settings: StoredSettings): Promise<void> {
  const filePath = settingsPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf8')
  await fs.rename(tmpPath, filePath)
}

function decryptToken(encrypted?: string): string {
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return ''
  }
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const stored = await readStoredSettings()
  return {
    comfyuiBaseUrl: normalizeUrl(stored.comfyuiBaseUrl || DEFAULT_COMFY_URL),
    agentBaseUrl: normalizeUrl(stored.agentBaseUrl || process.env.ANTHROPIC_BASE_URL || ''),
    agentToken: decryptToken(stored.encryptedAgentToken)
      || process.env.ANTHROPIC_AUTH_TOKEN
      || process.env.ANTHROPIC_API_KEY
      || '',
    defaultImageWorkflowId: stored.defaultImageWorkflowId || DEFAULT_WORKFLOW,
  }
}

export async function getAppSettingsView(): Promise<AppSettingsView> {
  const runtime = await getRuntimeSettings()
  return {
    comfyuiBaseUrl: runtime.comfyuiBaseUrl,
    agentBaseUrl: runtime.agentBaseUrl,
    agentTokenConfigured: !!runtime.agentToken,
    defaultImageWorkflowId: runtime.defaultImageWorkflowId,
  }
}

export async function saveAppSettings(request: SaveAppSettingsRequest): Promise<AppSettingsView> {
  const current = await readStoredSettings()
  const next: StoredSettings = {
    ...current,
    comfyuiBaseUrl: normalizeUrl(request.comfyuiBaseUrl || DEFAULT_COMFY_URL),
    agentBaseUrl: normalizeUrl(request.agentBaseUrl),
    defaultImageWorkflowId: request.defaultImageWorkflowId || DEFAULT_WORKFLOW,
  }
  if (request.clearAgentToken) {
    delete next.encryptedAgentToken
  } else if (request.agentToken?.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法使用安全存储，Token 未保存')
    }
    next.encryptedAgentToken = safeStorage.encryptString(request.agentToken.trim()).toString('base64')
  }
  await writeStoredSettings(next)
  return getAppSettingsView()
}

export async function testComfyUIConnection(baseUrl: string): Promise<ConnectionTestResult> {
  const url = normalizeUrl(baseUrl || DEFAULT_COMFY_URL)
  try {
    const response = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return { success: false, message: `连接失败：HTTP ${response.status}` }
    const payload = await response.json() as { devices?: Array<{ name?: string }> }
    const device = payload.devices?.[0]?.name
    return { success: true, message: device ? `连接成功 · ${device}` : '连接成功' }
  } catch (error) {
    return {
      success: false,
      message: `连接失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
