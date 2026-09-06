import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { getCodexRuntime } from './codex-runtime';

type RpcMessage = { id?: number | string; method?: string; params?: any; result?: any; error?: { message: string } };

/** Read-only model discovery connection; agent turns use @openai/codex-sdk. */
export class CodexClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  onNotification: (method: string, params: any) => void = () => {};
  onRequest: (method: string, params: any) => Promise<unknown> = async (method) => { throw new Error(`不支持的 Codex 请求：${method}`); };
  onClose: (error: Error) => void = () => {};

  constructor(cwd: string, runtime = getCodexRuntime()) {
    this.child = spawn(runtime.executablePath, ['app-server'], {
      env: runtime.env, cwd, windowsHide: true, shell: false, stdio: 'pipe', detached: process.platform !== 'win32',
    });
    this.child.stderr.resume();
    this.child.on('error', (error) => this.fail(new Error(`无法启动 Codex，请安装并登录 Codex CLI，确保 codex 在 PATH 中（或设置 CODEX_EXECUTABLE）：${error.message}`)));
    this.child.on('exit', (code) => this.fail(new Error(`Codex 进程已退出（${code}）`)));
    this.child.stdin.on('error', (error) => this.fail(error));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try { this.receive(JSON.parse(line)); }
      catch { this.fail(new Error('Codex 返回了无效的 JSON 协议数据')); }
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'aigc_canvas', title: 'AIGC CANVAS', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
  }

  request(method: string, params: unknown): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Codex 连接已关闭'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex 请求超时：${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  private send(message: unknown): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(message: RpcMessage): void {
    if (message.method) {
      if (message.id !== undefined) {
        void this.onRequest(message.method, message.params).then(
          result => this.send({ id: message.id, result }),
          error => this.send({ id: message.id, error: { code: -32603, message: String(error) } }),
        );
      } else this.onNotification(message.method, message.params);
      return;
    }
    const pending = this.pending.get(Number(message.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(Number(message.id));
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    // Close streams as well: an MCP subprocess can inherit handles and otherwise
    // keep Electron alive even after the app-server itself exits.
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.child.stderr.destroy();
    if (this.child.pid && this.child.exitCode === null) {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true }, () => { this.child.kill(); });
      } else {
        try { process.kill(-this.child.pid, 'SIGTERM'); } catch { this.child.kill(); }
      }
    }
    this.onClose(error);
  }

  close(): void { this.fail(new Error('Codex 连接已关闭')); }
}
