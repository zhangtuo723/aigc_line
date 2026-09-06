import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Native Codex does not share Electron's system/PAC proxy resolution. */
export async function getNetworkCodexRuntime() {
  const runtime = getCodexRuntime();
  const { session } = await import('electron');
  runtime.env = await withCodexSystemProxy(runtime.env, url => session.defaultSession.resolveProxy(url));
  return runtime;
}

export async function withCodexSystemProxy(
  env: Record<string, string>, resolveProxy: (url: string) => Promise<string>,
): Promise<Record<string, string>> {
  if (Object.entries(env).some(([key, value]) => /^(https?|all)_proxy$/i.test(key) && value)) return env;
  const route = (await resolveProxy('https://chatgpt.com/backend-api/codex/responses')).split(';')[0].trim();
  if (route === 'DIRECT') return env;
  const match = /^(PROXY|HTTPS|SOCKS5|SOCKS)\s+([^\s]+)$/i.exec(route);
  if (!match) throw new Error('无法将系统代理配置用于 Codex，请检查系统代理设置。');
  const scheme = { PROXY: 'http', HTTPS: 'https', SOCKS5: 'socks5h', SOCKS: 'socks5h' }[match[1].toUpperCase()];
  const proxy = `${scheme}://${match[2]}`;
  return { ...env, HTTP_PROXY: proxy, http_proxy: proxy, HTTPS_PROXY: proxy, https_proxy: proxy };
}

/** Resolve the SDK's pinned native runtime, including Electron's unpacked ASAR. */
export function getCodexRuntime(): { executablePath: string; env: Record<string, string> } {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  // The canvas MCP lives on loopback; never send its authenticated requests to a proxy.
  // Preserve existing exclusions and normalize casing for Windows and Unix clients.
  const bypass = new Set(['127.0.0.1', 'localhost', '::1']);
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() !== 'no_proxy') continue;
    for (const host of env[key].split(',')) {
      if (host.trim()) bypass.add(host.trim());
    }
    delete env[key];
  }
  env.NO_PROXY = env.no_proxy = [...bypass].join(',');
  if (env.CODEX_EXECUTABLE) return { executablePath: env.CODEX_EXECUTABLE, env };
  const targets: Record<string, string> = {
    'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
    'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
  };
  const platform = `${process.platform}-${process.arch}`;
  const target = targets[platform];
  if (!target) throw new Error(`Codex 暂不支持当前平台：${platform}`);
  try {
    const sdkRequire = createRequire(import.meta.resolve('@openai/codex-sdk'));
    const codexRequire = createRequire(sdkRequire.resolve('@openai/codex/package.json'));
    const manifest = codexRequire.resolve(`@openai/codex-${platform}/package.json`);
    const root = path.join(path.dirname(manifest), 'vendor', target).replace(/\.asar([/\\])/, '.asar.unpacked$1');
    const binary = process.platform === 'win32' ? 'codex.exe' : 'codex';
    const executablePath = [path.join(root, 'bin', binary), path.join(root, 'codex', binary)].find(existsSync);
    if (!executablePath) throw new Error('缺少平台二进制文件');
    const paths = [path.join(root, 'codex-path'), path.join(root, 'path')].filter(existsSync);
    const pathKey = process.platform === 'win32' ? Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path' : 'PATH';
    env[pathKey] = [...paths, env[pathKey] ?? ''].join(path.delimiter);
    return { executablePath, env };
  } catch (error) {
    throw new Error(`无法定位 Codex SDK 运行时，请安装包含 optionalDependencies 的依赖，或设置 CODEX_EXECUTABLE：${error}`);
  }
}
