import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Codex, type Thread, type ThreadEvent, type UserInput } from '@openai/codex-sdk';
import type { ChatMessage } from '../../../../src/shared/ipc.types';
import type { AgentModelsResult } from '../../../../src/shared/agent-config';
import type { AgentOptions } from './types';
import { appendChatMessage, readSessionId, writeSessionId, updateChatMessage } from '../project.store';
import { messageHub } from '../message-hub';
import { CodexClient } from './codex-client';
import { getNetworkCodexRuntime } from './codex-runtime';
import { startCanvasMcpBridge, type CanvasMcpBridge } from './canvas-mcp';
import { buildSystemPromptAppend, buildUserPrompt } from './prompts';
import { scanAvailableSkills } from './skills';

/** The TypeScript SDK has no model-list method. Only discovery uses app-server. */
export async function listCodexModels(): Promise<AgentModelsResult> {
  let client: CodexClient | undefined;
  try {
    client = new CodexClient(app.getPath('home'), await getNetworkCodexRuntime());
    await client.initialize();
    const models: AgentModelsResult['models'] = [];
    let cursor: string | null = null;
    do {
      const result = await client.request('model/list', { limit: 100, cursor });
      for (const model of result.data) models.push({ id: model.model, name: model.displayName });
      cursor = result.nextCursor;
    } while (cursor);
    return { models };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  } finally { client?.close(); }
}

class CodexSession {
  private thread?: Thread;
  private bridge?: CanvasMcpBridge;
  private queue: ChatMessage[] = [];
  private running = false;
  private stopping = false;
  private clearing = false;
  private enqueuing = 0;
  private controller?: AbortController;
  private messages = new Map<string, ChatMessage>();
  private persisted = new Set<string>();
  private turnKey = '';
  private lastStreamError = '';
  private priorityMessageId?: string;
  private preparingMessageId?: string;
  hasPendingMessage(folderPath: string, messageId: string): boolean {
    return path.resolve(folderPath) === path.resolve(this.options.folderPath)
      && (this.preparingMessageId === messageId || this.queue.some(message => message.id === messageId));
  }

  private async setDelivery(message: ChatMessage, deliveryStatus: 'sent' | 'cancelled'): Promise<void> {
    const updated = { ...message, deliveryStatus };
    await updateChatMessage(this.options.folderPath, message.id, () => updated);
    messageHub.pushToFrontend(this.options.projectId, updated);
  }

  private async cancelQueue(): Promise<void> {
    const cancelled = this.queue.splice(0);
    for (const message of cancelled) await this.setDelivery(message, 'cancelled');
  }

  queuedMessages(): ChatMessage[] { return [...this.queue]; }

  activeToolIds(folderPath: string): string[] {
    if (!this.running || path.resolve(folderPath) !== path.resolve(this.options.folderPath)) return [];
    return [...this.messages.values()].flatMap((message) => message.toolCall?.status === 'running' ? [message.toolCall.id] : []);
  }

  sendNow(messageId: string): void {
    if (this.stopping) throw new Error('正在中断当前回合，请稍候');
    const index = this.queue.findIndex(message => message.id === messageId);
    if (index < 0) throw new Error('该消息已开始处理或已不在队列中');
    const [message] = this.queue.splice(index, 1);
    this.queue.unshift(message);
    this.priorityMessageId = messageId;
    if (this.running) {
      this.stopping = true;
      this.controller?.abort();
    } else void this.pump();
  }

  constructor(private options: AgentOptions) {}

  private async save(message: ChatMessage, persist = true): Promise<void> {
    this.messages.set(message.id, message);
    messageHub.pushToFrontend(this.options.projectId, message);
    if (!persist) return;
    if (this.persisted.has(message.id)) await updateChatMessage(this.options.folderPath, message.id, () => message);
    else await appendChatMessage(this.options.folderPath, message);
    this.persisted.add(message.id);
  }

  private async handleEvent(event: ThreadEvent): Promise<void> {
    if (event.type === 'thread.started') {
      await writeSessionId(this.options.folderPath, event.thread_id, 'codex');
      return;
    }
    if (event.type === 'turn.failed') throw new Error(event.error.message);
    if (event.type === 'error') {
      // The CLI also emits error events while reconnecting. Let the SDK finish
      // retries; only turn.failed, an ended incomplete stream, or a thrown error
      // ends this turn.
      this.lastStreamError = event.message;
      await this.save({ id: `codex-${this.turnKey}-connection`, role: 'system', content: event.message, timestamp: Date.now() });
      return;
    }
    if (event.type !== 'item.started' && event.type !== 'item.updated' && event.type !== 'item.completed') return;
    const item = event.item;
    // CLI item IDs can restart at item_0 each turn; app history IDs must not collide.
    const id = `codex-${this.turnKey}-${item.id}`;
    const done = event.type === 'item.completed';
    if (item.type === 'agent_message') {
      await this.save({ id, role: 'assistant', content: item.text, timestamp: this.messages.get(id)?.timestamp ?? Date.now() }, done);
      return;
    }
    if (item.type === 'error') {
      await this.save({ id, role: 'system', content: item.message, timestamp: Date.now() });
      return;
    }
    if (item.type === 'reasoning' || item.type === 'todo_list') return;
    const toolName = item.type === 'mcp_tool_call' ? item.tool : item.type;
    const input = item.type === 'mcp_tool_call' ? item.arguments
      : item.type === 'command_execution' ? item.command
      : item.type === 'file_change' ? item.changes
      : item.type === 'web_search' ? item.query : item;
    const failed = 'status' in item && item.status === 'failed';
    await this.save({ id, role: 'system', content: `${done ? '执行结束' : '正在执行'}: ${toolName}`, timestamp: Date.now(), toolCall: {
      // Exec can emit partial payloads and newer item types before SDK typings catch up.
      // Missing display metadata must not abort the running agent turn.
      id, toolName, toolInput: JSON.stringify(input ?? null).slice(0, 2000),
      status: !done ? 'running' : failed ? 'error' : 'completed',
      toolResult: done ? JSON.stringify(item).slice(0, 8000) : undefined,
      error: item.type === 'mcp_tool_call' ? item.error?.message : undefined,
    } }, event.type !== 'item.updated');
  }

  private async connect(): Promise<void> {
    if (this.thread) return;
    this.bridge = await startCanvasMcpBridge(this.options.projectId, this.options.folderPath, () => this.running && !this.stopping);
    const runtime = await getNetworkCodexRuntime();
    const skills = await scanAvailableSkills(this.options.folderPath, 'codex');
    const skillInstructions = skills.map(skill => `- ${skill.name}: ${skill.description}\n  ${skill.path}`).join('\n');
    const codex = new Codex({
      codexPathOverride: runtime.executablePath,
      env: { ...runtime.env, AIGC_CANVAS_MCP_TOKEN: this.bridge.token },
      config: {
        developer_instructions: `${buildSystemPromptAppend(this.options.folderPath)}\n\n你使用 Codex。Read/Bash/Edit 是通用操作描述，请使用实际可用的文件、终端和图片工具。画布工具由 aigc_canvas MCP 提供。需要用户决定时在聊天中提问。以下 Skill 位于应用或用户目录，使用前读取对应 SKILL.md，按需读取相对引用；不要向项目复制 Skill。\n${skillInstructions}`,
        mcp_servers: { aigc_canvas: { url: this.bridge.url, bearer_token_env_var: 'AIGC_CANVAS_MCP_TOKEN', required: true } },
      },
    });
    const threadOptions = {
      workingDirectory: this.options.folderPath,
      model: this.options.agent?.model || undefined,
      skipGitRepoCheck: true,
      approvalPolicy: 'never' as const,
      sandboxMode: 'danger-full-access' as const,
    };
    const previous = await readSessionId(this.options.folderPath, 'codex');
    this.thread = previous ? codex.resumeThread(previous, threadOptions) : codex.startThread(threadOptions);
  }

  private async makeInput(message: ChatMessage): Promise<UserInput[]> {
    const skills = await scanAvailableSkills(this.options.folderPath, 'codex');
    const command = message.content.match(/^\/([^\s]+)/)?.[1];
    const skill = skills.find(item => item.name === command);
    let prompt = buildUserPrompt(message, this.options.folderPath);
    if (skill?.path) prompt = `本轮用户明确选择了 Skill ${JSON.stringify(skill.name)}。首先读取 ${JSON.stringify(skill.path)} 并按其要求完成本轮任务。\n\n${prompt}`;
    const input: UserInput[] = [{ type: 'text', text: prompt }];
    for (const attachment of message.attachments ?? []) {
      if (/^\.(png|jpe?g|webp)$/i.test(path.extname(attachment.path))) input.push({ type: 'local_image', path: attachment.path });
    }
    return input;
  }

  async enqueue(message: ChatMessage): Promise<void> {
    if (this.clearing) throw new Error('正在新建上下文，请稍后发送');
    this.enqueuing++;
    try {
      message = { ...message, deliveryStatus: 'queued' };
      await appendChatMessage(this.options.folderPath, message);
      this.queue.push(message);
      messageHub.pushToFrontend(this.options.projectId, message);
      void this.pump();
    } finally { this.enqueuing--; }
  }

  private async flushMessages(): Promise<void> {
    for (const message of this.messages.values()) {
      if (message.toolCall?.status === 'running') await this.save({ ...message, toolCall: { ...message.toolCall, status: 'interrupted' } });
      else if (!this.persisted.has(message.id)) await this.save(message);
    }
    this.messages.clear(); this.persisted.clear();
  }

  private async disconnect(): Promise<void> {
    this.thread = undefined;
    const bridge = this.bridge;
    this.bridge = undefined;
    await bridge?.close();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.controller = new AbortController();
    try {
      await this.connect();
      while (this.queue.length && !this.stopping) {
        const message = this.queue.shift()!;
        this.preparingMessageId = message.id;
        this.turnKey = randomUUID();
        this.lastStreamError = '';
        const isPriority = message.id === this.priorityMessageId;
        const input = await this.makeInput(isPriority ? { ...message, content: `${message.content}\n\n[继续说明：上一回合已被用户中断。请结合以上新要求继续原任务，先检查已有修改和已提交的生成任务，避免重复操作。]` } : message);
        if (this.stopping) {
          if (this.priorityMessageId) this.queue.splice(1, 0, message);
          break;
        }
        if (isPriority) this.priorityMessageId = undefined;
        await this.setDelivery(message, 'sent');
        this.preparingMessageId = undefined;
        const { events } = await this.thread!.runStreamed(input, { signal: this.controller.signal });
        let completed = false;
        for await (const event of events) {
          await this.handleEvent(event);
          if (event.type === 'turn.completed') completed = true;
        }
        if (!completed && !this.stopping) throw new Error(this.lastStreamError || 'Codex 流已结束，但没有收到回合完成事件');
        await this.flushMessages();
      }
    } catch (error) {
      if (!this.stopping) messageHub.notifyError(this.options.projectId, `Codex：${error instanceof Error ? error.message : String(error)}`);
      if (!(this.stopping && this.priorityMessageId)) {
        this.priorityMessageId = undefined;
        await this.cancelQueue();
      }
    } finally {
      this.preparingMessageId = undefined;
      try { await this.flushMessages(); await this.disconnect(); }
      catch (error) { messageHub.notifyError(this.options.projectId, `Codex 会话保存/关闭失败：${error}`); }
      this.controller = undefined;
      this.running = false;
      if (this.queue.length) void this.pump();
      else messageHub.notifyTurnEnd(this.options.projectId);
    }
  }

  async interrupt(): Promise<void> {
    this.stopping = true;
    this.priorityMessageId = undefined;
    this.controller?.abort();
    await this.cancelQueue();
  }

  async clear(): Promise<void> {
    if (this.running || this.queue.length || this.enqueuing || this.clearing) throw new Error('Agent 正在处理任务，请等待当前回合结束');
    this.clearing = true;
    try {
      await this.disconnect();
      await writeSessionId(this.options.folderPath, '', 'codex');
      const message: ChatMessage = { id: `context-cleared-${randomUUID()}`, role: 'system', content: 'Codex 上下文已清空。聊天历史和画布继续保留。', timestamp: Date.now(), event: 'context-cleared' };
      await appendChatMessage(this.options.folderPath, message);
      messageHub.pushToFrontend(this.options.projectId, message);
    } finally { this.clearing = false; }
  }

  close(): void { void this.interrupt(); void this.disconnect().catch(() => undefined); }
}

const sessions = new Map<string, CodexSession>();
export function codexSession(options: AgentOptions): CodexSession {
  let session = sessions.get(options.projectId);
  if (!session) { session = new CodexSession(options); sessions.set(options.projectId, session); }
  return session;
}
export async function interruptCodex(projectId: string): Promise<void> { await sessions.get(projectId)?.interrupt(); }
export function getCodexQueue(projectId: string): ChatMessage[] { return sessions.get(projectId)?.queuedMessages() ?? []; }
export function isCodexMessagePending(folderPath: string, messageId: string): boolean {
  return [...sessions.values()].some(session => session.hasPendingMessage(folderPath, messageId));
}
export function getActiveCodexToolIds(folderPath: string): string[] {
  return [...sessions.values()].flatMap((session) => session.activeToolIds(folderPath));
}
export function sendCodexQueuedNow(projectId: string, messageId: string): void {
  const session = sessions.get(projectId);
  if (!session) throw new Error('Codex 会话不存在');
  session.sendNow(messageId);
}
app.on('before-quit', () => { for (const session of sessions.values()) session.close(); });
