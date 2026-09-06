import { afterEach, expect, it, vi } from 'vitest';
import { getCodexRuntime, withCodexSystemProxy } from '../electron/main/services/agent/codex-runtime';

it('passes the system proxy to native Codex without losing loopback exclusions', async () => {
  const env = { NO_PROXY: '127.0.0.1,localhost,::1' };
  const resolve = vi.fn().mockResolvedValue('PROXY 127.0.0.1:33210; DIRECT');
  expect(await withCodexSystemProxy(env, resolve)).toMatchObject({ ...env, HTTPS_PROXY: 'http://127.0.0.1:33210', https_proxy: 'http://127.0.0.1:33210' });
  expect(env).not.toHaveProperty('HTTPS_PROXY');
});

it('respects explicit proxies and DIRECT system routing', async () => {
  const resolve = vi.fn().mockResolvedValue('DIRECT');
  const env = { all_proxy: 'socks5h://localhost:1080' };
  expect(await withCodexSystemProxy(env, resolve)).toBe(env);
  expect(resolve).not.toHaveBeenCalled();
  expect(await withCodexSystemProxy({}, resolve)).toEqual({});
});

afterEach(() => vi.unstubAllEnvs());

it('bypasses the local canvas MCP while preserving remote proxy settings and exclusions', () => {
  vi.stubEnv('CODEX_EXECUTABLE', 'test-codex');
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:33210');
  vi.stubEnv('NO_PROXY', 'internal.example, localhost');
  const { env, executablePath } = getCodexRuntime();
  expect(executablePath).toBe('test-codex');
  expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:33210');
  expect(env.NO_PROXY).toBe(env.no_proxy);
  expect(env.NO_PROXY.split(',')).toEqual(expect.arrayContaining(['127.0.0.1', 'localhost', '::1', 'internal.example']));
  expect(process.env.NO_PROXY).toBe('internal.example, localhost');
});

it('adds loopback exclusions when none were configured', () => {
  vi.stubEnv('CODEX_EXECUTABLE', 'test-codex');
  vi.stubEnv('NO_PROXY', undefined);
  vi.stubEnv('no_proxy', undefined);
  expect(getCodexRuntime().env.NO_PROXY.split(',')).toEqual(expect.arrayContaining(['127.0.0.1', 'localhost', '::1']));
});
