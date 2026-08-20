import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  AppSettingsView,
  ConnectionTestResult,
  SaveAppSettingsRequest,
  TestGoogleAiConnectionRequest,
  TestQwenConnectionRequest,
  TestSeedreamConnectionRequest,
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
  seedreamBaseUrl?: string
  seedreamApiKey?: string
  /** Legacy field retained only for migration from earlier development builds. */
  encryptedSeedreamApiKey?: string
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
  seedreamBaseUrl: string
  seedreamApiKey: string
  defaultImageWorkflowId: string
}

const SETTINGS_FILE = 'settings.json'
const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'
const DEFAULT_WORKFLOW = 'krea2-turbo-t2i'
const REMOVED_IMAGE_WORKFLOWS = new Set(['flux2-klein-9b-t2i', 'flux2-klein-9b-edit'])
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const DEFAULT_SEEDREAM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const QWEN_OMNI_MODEL = 'qwen3.5-omni-plus'

const settingsPath = (): string => path.join(getAppDataDir(), SETTINGS_FILE)

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '')

export const normalizeSeedreamBaseUrl = (value: string): string => (
  normalizeUrl(value).replace(/(?:\/images\/generations)+$/i, '')
)

const normalizeDefaultWorkflow = (value?: string): string => (
  !value || REMOVED_IMAGE_WORKFLOWS.has(value) ? DEFAULT_WORKFLOW : value
)

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

function encryptToken(value: string, label: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(`当前系统无法使用安全存储，${label} 未保存`)
  }
  return safeStorage.encryptString(value).toString('base64')
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
    seedreamBaseUrl: normalizeSeedreamBaseUrl(stored.seedreamBaseUrl || DEFAULT_SEEDREAM_BASE_URL),
    seedreamApiKey: stored.seedreamApiKey?.trim()
      || decryptToken(stored.encryptedSeedreamApiKey)
      || process.env.ARK_API_KEY
      || '',
    defaultImageWorkflowId: normalizeDefaultWorkflow(stored.defaultImageWorkflowId),
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
    seedreamBaseUrl: runtime.seedreamBaseUrl,
    seedreamApiKey: runtime.seedreamApiKey,
    seedreamApiKeyConfigured: !!runtime.seedreamApiKey,
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
    seedreamBaseUrl: normalizeSeedreamBaseUrl(request.seedreamBaseUrl || DEFAULT_SEEDREAM_BASE_URL),
    defaultImageWorkflowId: normalizeDefaultWorkflow(request.defaultImageWorkflowId),
  }
  delete (next as StoredSettings & { qwenModel?: string }).qwenModel
  if (request.clearAgentToken) {
    delete next.encryptedAgentToken
  } else if (request.agentToken?.trim()) {
    next.encryptedAgentToken = encryptToken(request.agentToken.trim(), 'Token')
  }
  if (request.clearQwenApiKey) {
    delete next.encryptedQwenApiKey
  } else if (request.qwenApiKey?.trim()) {
    next.encryptedQwenApiKey = encryptToken(request.qwenApiKey.trim(), 'Qwen API Key')
  }
  if (request.clearGoogleAiApiKey) {
    delete next.encryptedGoogleAiApiKey
  } else if (request.googleAiApiKey?.trim()) {
    next.encryptedGoogleAiApiKey = encryptToken(request.googleAiApiKey.trim(), 'Google AI Studio API Key')
  }
  if (request.clearSeedreamApiKey) {
    delete next.seedreamApiKey
    delete next.encryptedSeedreamApiKey
  } else if (request.seedreamApiKey?.trim()) {
    next.seedreamApiKey = request.seedreamApiKey.trim()
    delete next.encryptedSeedreamApiKey
  }
  await writeStoredSettings(next)
  const persisted = await readStoredSettings()
  if (persisted.qwenBaseUrl !== next.qwenBaseUrl) {
    throw new Error('Qwen API 地址写入后校验失败，请重试')
  }
  if ((persisted.googleAiProxyUrl || '') !== (next.googleAiProxyUrl || '')) {
    throw new Error('Google API 代理地址写入后校验失败，请重试')
  }
  if (persisted.seedreamBaseUrl !== next.seedreamBaseUrl) {
    throw new Error('Seedream API 地址写入后校验失败，请重试')
  }
  if (request.qwenApiKey?.trim() && !persisted.encryptedQwenApiKey) {
    throw new Error('Qwen API Key 写入后校验失败，请重试')
  }
  if (request.googleAiApiKey?.trim() && !persisted.encryptedGoogleAiApiKey) {
    throw new Error('Google AI Studio API Key 写入后校验失败，请重试')
  }
  if (request.seedreamApiKey?.trim() && persisted.seedreamApiKey !== request.seedreamApiKey.trim()) {
    throw new Error('Seedream API Key 写入后校验失败，请重试')
  }
  const view = await getAppSettingsView()
  if (request.qwenApiKey?.trim() && !view.qwenApiKeyConfigured) {
    throw new Error('Qwen API Key 已写入但无法从系统安全存储解密，请检查系统凭据服务')
  }
  if (request.googleAiApiKey?.trim() && !view.googleAiApiKeyConfigured) {
    throw new Error('Google AI Studio API Key 已写入但无法从系统安全存储解密，请检查系统凭据服务')
  }
  if (request.seedreamApiKey?.trim() && !view.seedreamApiKeyConfigured) {
    throw new Error('Seedream API Key 已写入但无法从系统安全存储解密，请检查系统凭据服务')
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

export async function testSeedreamConnection(
  request: TestSeedreamConnectionRequest,
): Promise<ConnectionTestResult> {
  const runtime = await getRuntimeSettings()
  const baseUrl = normalizeSeedreamBaseUrl(request.baseUrl || runtime.seedreamBaseUrl || DEFAULT_SEEDREAM_BASE_URL)
  const isAgentPlan = /\/api\/plan\/v3$/i.test(baseUrl)
  const apiKey = request.apiKey?.trim() || runtime.seedreamApiKey
  if (!apiKey) return { success: false, message: '请先输入火山方舟 API Key' }

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  try {
    const modelsResponse = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    })
    if (modelsResponse.ok) {
      return { success: true, message: isAgentPlan ? '连接成功 · Agent Plan Seedream API 可用' : '连接成功 · Seedream 5.0 Pro / Lite 共用此 Key' }
    }
    if (modelsResponse.status === 401 || modelsResponse.status === 403) {
      const detail = (await modelsResponse.text()).slice(0, 500)
      return { success: false, message: `鉴权失败：HTTP ${modelsResponse.status}${detail ? ` · ${detail}` : ''}` }
    }
    if (![400, 404, 405, 422].includes(modelsResponse.status)) {
      const detail = (await modelsResponse.text()).slice(0, 500)
      return { success: false, message: `连接失败：HTTP ${modelsResponse.status}${detail ? ` · ${detail}` : ''}` }
    }

    // Some Ark deployments do not expose GET /models. A deliberately incomplete
    // generation request validates authentication without producing a billable image.
    const probeResponse = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'doubao-seedream-5-0-lite-260128' }),
      signal: AbortSignal.timeout(20_000),
    })
    const detail = (await probeResponse.text()).slice(0, 500)
    if (probeResponse.status === 401 || probeResponse.status === 403) {
      return { success: false, message: `鉴权失败：HTTP ${probeResponse.status}${detail ? ` · ${detail}` : ''}` }
    }
    if (probeResponse.status === 400 || probeResponse.status === 422) {
      return { success: true, message: isAgentPlan ? '连接成功 · Agent Plan API Key 已通过鉴权（未生成图片）' : '连接成功 · API Key 已通过鉴权（未生成图片）' }
    }
    return { success: false, message: `连接测试返回异常：HTTP ${probeResponse.status}${detail ? ` · ${detail}` : ''}` }
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
