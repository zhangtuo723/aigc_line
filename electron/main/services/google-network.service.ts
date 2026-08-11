import { net, session } from 'electron'

let configuredProxy = ''
let proxySession: Electron.Session | undefined

export function normalizeGoogleProxyUrl(value: string): string {
  const proxy = value.trim().replace(/\/+$/, '')
  if (!proxy) return ''
  let parsed: URL
  try {
    parsed = new URL(proxy)
  } catch {
    throw new Error('Google API 代理地址格式无效，请填写例如 http://127.0.0.1:7890')
  }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('Google API 代理仅支持 HTTP、HTTPS、SOCKS4 或 SOCKS5 地址')
  }
  return proxy
}

function networkErrorMessage(error: unknown): string {
  const top = error instanceof Error ? error : new Error(String(error))
  const cause = (top as Error & { cause?: { code?: string; message?: string } }).cause
  const code = cause?.code
  const detail = cause?.message || top.message
  if (top.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return '连接 Google API 超时；请检查网络，或在设置页填写本地 HTTP/SOCKS 代理地址'
  }
  const suffix = [code, detail].filter(Boolean).join(' · ')
  return `无法连接 Google API${suffix ? `：${suffix}` : ''}。请检查网络或设置 Google API 代理`
}

export async function fetchGoogleApi(
  url: string,
  init: RequestInit,
  proxyUrl: string,
): Promise<Response> {
  try {
    const proxy = normalizeGoogleProxyUrl(proxyUrl)
    if (!proxy) return await net.fetch(url, init)
    if (!proxySession) proxySession = session.fromPartition('google-ai-api')
    if (configuredProxy !== proxy) {
      await proxySession.setProxy({ mode: 'fixed_servers', proxyRules: proxy })
      configuredProxy = proxy
    }
    return await proxySession.fetch(url, init)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Google API 代理')) throw error
    throw new Error(networkErrorMessage(error), { cause: error })
  }
}
