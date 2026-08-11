import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  AppSettingsView,
  ConnectionTestResult,
  SaveAppSettingsRequest,
  TestGoogleAiConnectionRequest,
  TestQwenConnectionRequest,
} from '../../../src/shared/ipc.types'
import { getAppDataDir } from './project.store'
import { fetchGoogleApi, normalizeGoogleProxyUrl } from './google-network.service'

interface StoredSettings {
  comfyuiBaseUrl?: string
  agentBaseUrl?: string
  encryptedAgentToken?: string
  qwenBaseUrl?: string
  encryptedQwenApiKey?: string
  encryptedGoogleAiApiKey?: string
  googleAiProxyUrl?: string
  defaultImageWorkflowId?: string
}

export interface RuntimeSettings {
  comfyuiBaseUrl: string
  agentBaseUrl: string
  agentToken: string
  qwenBaseUrl: string
  qwenApiKey: string
  googleAiApiKey: string
  googleAiProxyUrl: string
  defaultImageWorkflowId: string
}

const SETTINGS_FILE = 'settings.json'
const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'
const DEFAULT_WORKFLOW = 'flux2-klein-9b-t2i'
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const QWEN_OMNI_MODEL = 'qwen3.5-omni-plus'

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
    qwenBaseUrl: normalizeUrl(stored.qwenBaseUrl || DEFAULT_QWEN_BASE_URL),
    qwenApiKey: decryptToken(stored.encryptedQwenApiKey)
      || process.env.DASHSCOPE_API_KEY
      || '',
    googleAiApiKey: decryptToken(stored.encryptedGoogleAiApiKey)
      || process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || '',
    googleAiProxyUrl: normalizeGoogleProxyUrl(stored.googleAiProxyUrl || ''),
    defaultImageWorkflowId: stored.defaultImageWorkflowId || DEFAULT_WORKFLOW,
  }
}

export async function getAppSettingsView(): Promise<AppSettingsView> {
  const runtime = await getRuntimeSettings()
  return {
    comfyuiBaseUrl: runtime.comfyuiBaseUrl,
    agentBaseUrl: runtime.agentBaseUrl,
    agentTokenConfigured: !!runtime.agentToken,
    qwenBaseUrl: runtime.qwenBaseUrl,
    qwenApiKey: runtime.qwenApiKey,
    qwenApiKeyConfigured: !!runtime.qwenApiKey,
    googleAiApiKey: runtime.googleAiApiKey,
    googleAiApiKeyConfigured: !!runtime.googleAiApiKey,
    googleAiProxyUrl: runtime.googleAiProxyUrl,
    defaultImageWorkflowId: runtime.defaultImageWorkflowId,
  }
}

export async function saveAppSettings(request: SaveAppSettingsRequest): Promise<AppSettingsView> {
  const current = await readStoredSettings()
  const next: StoredSettings = {
    ...current,
    comfyuiBaseUrl: normalizeUrl(request.comfyuiBaseUrl || DEFAULT_COMFY_URL),
    agentBaseUrl: normalizeUrl(request.agentBaseUrl),
    qwenBaseUrl: normalizeUrl(request.qwenBaseUrl || DEFAULT_QWEN_BASE_URL),
    googleAiProxyUrl: normalizeGoogleProxyUrl(request.googleAiProxyUrl || ''),
    defaultImageWorkflowId: request.defaultImageWorkflowId || DEFAULT_WORKFLOW,
  }
  delete (next as StoredSettings & { qwenModel?: string }).qwenModel
  if (request.clearAgentToken) {
    delete next.encryptedAgentToken
  } else if (request.agentToken?.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法使用安全存储，Token 未保存')
    }
    next.encryptedAgentToken = safeStorage.encryptString(request.agentToken.trim()).toString('base64')
  }
  if (request.clearQwenApiKey) {
    delete next.encryptedQwenApiKey
  } else if (request.qwenApiKey?.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法使用安全存储，Qwen API Key 未保存')
    }
    next.encryptedQwenApiKey = safeStorage.encryptString(request.qwenApiKey.trim()).toString('base64')
  }
  if (request.clearGoogleAiApiKey) {
    delete next.encryptedGoogleAiApiKey
  } else if (request.googleAiApiKey?.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法使用安全存储，Google AI Studio API Key 未保存')
    }
    next.encryptedGoogleAiApiKey = safeStorage.encryptString(request.googleAiApiKey.trim()).toString('base64')
  }
  await writeStoredSettings(next)
  const persisted = await readStoredSettings()
  if (persisted.qwenBaseUrl !== next.qwenBaseUrl) {
    throw new Error('Qwen API 地址写入后校验失败，请重试')
  }
  if ((persisted.googleAiProxyUrl || '') !== (next.googleAiProxyUrl || '')) {
    throw new Error('Google API 代理地址写入后校验失败，请重试')
  }
  if (request.qwenApiKey?.trim() && !persisted.encryptedQwenApiKey) {
    throw new Error('Qwen API Key 写入后校验失败，请重试')
  }
  if (request.googleAiApiKey?.trim() && !persisted.encryptedGoogleAiApiKey) {
    throw new Error('Google AI Studio API Key 写入后校验失败，请重试')
  }
  const view = await getAppSettingsView()
  if (request.qwenApiKey?.trim() && !view.qwenApiKeyConfigured) {
    throw new Error('Qwen API Key 已写入但无法从系统安全存储解密，请检查系统凭据服务')
  }
  if (request.googleAiApiKey?.trim() && !view.googleAiApiKeyConfigured) {
    throw new Error('Google AI Studio API Key 已写入但无法从系统安全存储解密，请检查系统凭据服务')
  }
  return view
}

export async function testGoogleAiConnection(
  request: TestGoogleAiConnectionRequest,
): Promise<ConnectionTestResult> {
  const runtime = await getRuntimeSettings()
  const apiKey = request.apiKey?.trim() || runtime.googleAiApiKey
  if (!apiKey) return { success: false, message: '请先输入 Google AI Studio API Key' }
  try {
    const response = await fetchGoogleApi(
      'https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image',
      {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(20_000),
      },
      request.proxyUrl === undefined
        ? runtime.googleAiProxyUrl
        : normalizeGoogleProxyUrl(request.proxyUrl),
    )
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      return { success: false, message: `连接失败：HTTP ${response.status}${detail ? ` · ${detail}` : ''}` }
    }
    return { success: true, message: '连接成功 · Nano Banana 2 / Pro 共用此 Key' }
  } catch (error) {
    return {
      success: false,
      message: `连接失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function testQwenConnection(
  request: TestQwenConnectionRequest,
): Promise<ConnectionTestResult> {
  const runtime = await getRuntimeSettings()
  const baseUrl = normalizeUrl(request.baseUrl || runtime.qwenBaseUrl || DEFAULT_QWEN_BASE_URL)
  const apiKey = request.apiKey?.trim() || runtime.qwenApiKey
  if (!apiKey) return { success: false, message: '请先输入 Qwen API Key' }
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: QWEN_OMNI_MODEL,
        messages: [{ role: 'user', content: '只回复 OK' }],
        stream: true,
        stream_options: { include_usage: true },
        modalities: ['text'],
        max_tokens: 8,
        temperature: 0,
        enable_thinking: false,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      return { success: false, message: `连接失败：HTTP ${response.status}${detail ? ` · ${detail}` : ''}` }
    }
    await response.text()
    return { success: true, message: `连接成功 · ${QWEN_OMNI_MODEL}` }
  } catch (error) {
    return {
      success: false,
      message: `连接失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
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
