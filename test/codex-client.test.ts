import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: (_file: string, _args: string[], options: object) => actual.spawn(process.execPath, [path.resolve('test/fixtures/codex-app-server.cjs')], options) };
});
vi.mock('../electron/main/services/agent/codex-runtime', () => ({ getCodexRuntime: () => ({ executablePath: 'mock-codex', env: process.env }) }));
import { CodexClient } from '../electron/main/services/agent/codex-client';
const clients: CodexClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
function client() { const instance = new CodexClient(process.cwd()); clients.push(instance); return instance; }
describe('Codex stdio transport', () => {
  it('initializes, handles split JSON lines and replies to server tool calls', async () => {
    const connection = client();
    await connection.initialize();
    expect((await connection.request('model/list', {})).data[0].model).toBe('test-model');
    connection.onRequest = async (method, params) => ({ success: method === 'item/tool/call', nodeId: params.arguments.nodeId });
    expect(await connection.request('test/tool', {})).toEqual({success:true,nodeId:'node-1'});
  });
  it('rejects RPC errors without hanging the connection', async () => {
    const connection = client(); await connection.initialize();
    await expect(connection.request('test/error', {})).rejects.toThrow('model unavailable');
    expect((await connection.request('model/list', {})).data).toHaveLength(1);
  });
  it('rejects all pending requests when the process dies', async () => {
    const connection = client(); await connection.initialize();
    await expect(connection.request('test/exit', {})).rejects.toThrow('已退出');
    await expect(connection.request('model/list', {})).rejects.toThrow('已关闭');
  });
});
