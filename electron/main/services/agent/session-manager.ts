/**
 * Per-project long-lived agent sessions (streaming input mode).
 *
 * Instead of spawning one query() per user message, each project keeps a
 * single running query whose prompt is an async iterable. New user messages
 * are pushed into the iterable while the agent is still working; the CLI
 * queues them and starts a new turn when the current one finishes. This is
 * the same mechanism Claude Code uses for "type while the agent is running".
 */
import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { app } from 'electron';
import log from 'electron-log/main';
import type { ChatMessage } from '../../../../src/shared/ipc.types';
import {
  readChatHistory,
  writeChatHistory,
  readSessionId,
  writeSessionId,
  appendChatMessage,
} from '../project.store';
import { messageHub } from '../message-hub';
import type { AgentOptions, ToolCallInfo } from './types';
import type { AvailableSkill } from '../../../../src/shared/ipc.types';
import { buildUserPrompt, buildSystemPromptAppend } from './prompts';
import { createPushArtifactServer } from './tools';
import { createToolTrackingHooks, interruptActiveToolCalls } from './hooks';
import { extractMessageText } from './stream';
import { getRuntimeSettings } from '../settings.service';
import { createBuiltinPluginConfig, resolveBuiltinPluginPath } from './builtin-plugin';
import { scanAvailableSkills } from './skills';
import { mergeDiscoveredSkills } from './skill-metadata';

/** MCP tools exposed to every session (bare names match mcp__push-artifact__*). */
const CANVAS_MCP_TOOLS = [
  'PushArtifact',
  'GetCanvasState',
  'GetCanvasCapabilities',
  'CreateCanvasNodes',
  'UpdateCanvasNodes',
  'DeleteCanvasNodes',
  'ConnectCanvasNodes',
  'DisconnectCanvasEdges',
  'InvokeNodeAction',
];

/** Delay before restarting a dead stream that still has pending work. */
const RESTART_DELAY_MS = 3_000;
/** Give up restarting after this many consecutive dead streams. */
const MAX_CONSECUTIVE_RESTARTS = 3;
const CONTEXT_CLEAR_TIMEOUT_MS = 30_000;

interface PendingContextClear {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ProjectAgentSession {
  projectId: string;
  folderPath: string;
  allowedTools: string[];
  /** Messages waiting to be fed into the streaming input generator */
  queue: SDKUserMessage[];
  /** Wakes the generator when it is idle-waiting for input */
  wakeInput: (() => void) | null;
  activeQuery: Query | null;
  pumping: boolean;
  /** Turns the user has requested but the agent has not finished yet */
  pendingTurns: number;
  pendingContextClear: PendingContextClear | null;
}

const sessions = new Map<string, ProjectAgentSession>();

function getOrCreateSession(
  projectId: string,
  folderPath: string,
  allowedTools: string[],
): ProjectAgentSession {
  let session = sessions.get(projectId);
  if (!session) {
    session = {
      projectId,
      folderPath,
      allowedTools,
      queue: [],
      wakeInput: null,
      activeQuery: null,
      pumping: false,
      pendingTurns: 0,
      pendingContextClear: null,
    };
    sessions.set(projectId, session);
  }
  // Refresh in case the project moved or tool config changed
  session.folderPath = folderPath;
  session.allowedTools = allowedTools;
  return session;
}

/**
 * Streaming prompt: yields queued user messages as they arrive. Never
 * returns on its own, so the CLI process stays alive waiting for input.
 */
async function* inputStream(session: ProjectAgentSession): AsyncIterable<SDKUserMessage> {
  for (;;) {
    const next = session.queue.shift();
    if (next) {
      yield next;
      continue;
    }
    await new Promise<void>((resolve) => {
      session.wakeInput = resolve;
    });
    session.wakeInput = null;
  }
}

async function handleStreamMessage(
  session: ProjectAgentSession,
  message: unknown,
  activeToolCalls: Map<string, ToolCallInfo>,
): Promise<void> {
  if (message && typeof message === 'object') {
    const msg = message as Record<string, unknown>;
    // Capture session ID from init message
    if (msg.type === 'system' && msg.subtype === 'init') {
      const sessionIdFromMsg =
        msg.session_id ?? (msg.data as Record<string, unknown> | undefined)?.session_id;
      if (sessionIdFromMsg) {
        await writeSessionId(session.folderPath, String(sessionIdFromMsg));
        log.info('[Agent] Session saved to disk:', String(sessionIdFromMsg));
      }
    }
    // A turn finished (success, error, or interrupt). When no turns remain,
    // tell the frontend to clear the thinking indicator.
    if (msg.type === 'result') {
      await interruptActiveToolCalls(session.folderPath, activeToolCalls);
      if (session.pendingContextClear) {
        const pending = session.pendingContextClear;
        session.pendingContextClear = null;
        clearTimeout(pending.timer);
        const boundary: ChatMessage = {
          id: `context-cleared-${Date.now()}`,
          role: 'system',
          content: 'Claude 上下文已清空。之前的消息仅供查看，画布和历史记录未删除。',
          timestamp: Date.now(),
          event: 'context-cleared',
        };
        messageHub.pushToFrontend(boundary);
        await appendChatMessage(session.folderPath, boundary);
        pending.resolve();
      }
      session.pendingTurns = Math.max(0, session.pendingTurns - 1);
      // The CLI may coalesce several queued user messages into ONE turn, so a
      // single result can cover more than one pending message. Once our input
      // queue is drained, the session is idle regardless of the raw count.
      if (session.queue.length === 0) {
        session.pendingTurns = 0;
        messageHub.notifyTurnEnd();
      }
      return;
    }
  }

  const text = extractMessageText(message);
  if (session.pendingContextClear && text?.trim() === '(no content)') return;
  if (text) {
    const textMsg: ChatMessage = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
    };
    messageHub.pushToFrontend(textMsg);
    await appendChatMessage(session.folderPath, textMsg);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listAvailableSkills(
  projectId: string,
  folderPath: string,
): Promise<AvailableSkill[]> {
  const discovered = await scanAvailableSkills(folderPath);
  const activeQuery = sessions.get(projectId)?.activeQuery;
  if (!activeQuery) return discovered;

  try {
    return mergeDiscoveredSkills(discovered, await activeQuery.supportedCommands());
  } catch (error) {
    log.warn('[Agent] Failed to read SDK skills, using filesystem discovery:', error);
    return discovered;
  }
}

/**
 * Consume loop for one project session. Keeps a streaming query alive and
 * restarts it (with session resume) if the underlying CLI process dies while
 * there is still pending work.
 */
async function pump(session: ProjectAgentSession): Promise<void> {
  if (session.pumping) return;
  session.pumping = true;
  let consecutiveRestarts = 0;
  try {
    for (;;) {
      const { projectId, folderPath, allowedTools } = session;
      const sessionId = await readSessionId(folderPath);
      log.info('[Agent] Starting streaming query, resume:', sessionId || 'none');

      const runtimeSettings = await getRuntimeSettings();
      const agentEnv: Record<string, string | undefined> = { ...process.env };
      if (runtimeSettings.agentBaseUrl) {
        agentEnv.ANTHROPIC_BASE_URL = runtimeSettings.agentBaseUrl;
      }
      if (runtimeSettings.agentToken) {
        agentEnv.ANTHROPIC_AUTH_TOKEN = runtimeSettings.agentToken;
      }

      const activeToolCalls = new Map<string, ToolCallInfo>();
      const builtinPluginPath = resolveBuiltinPluginPath({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      });
      const stream = query({
        prompt: inputStream(session),
        options: {
          allowedTools: [...allowedTools, ...CANVAS_MCP_TOOLS],
          cwd: folderPath,
          env: agentEnv,
          // App-owned skills live outside the workspace. Project-level
          // .claude/skills remain discoverable and are never modified.
          plugins: [createBuiltinPluginConfig(builtinPluginPath)],
          skills: 'all',
          // Resume existing session if available, otherwise start fresh
          ...(sessionId ? { resume: sessionId } : {}),
          mcpServers: {
            'push-artifact': createPushArtifactServer(projectId, folderPath),
          },
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: buildSystemPromptAppend(folderPath),
          },
          hooks: createToolTrackingHooks(folderPath, activeToolCalls),
        },
      });
      session.activeQuery = stream;

      let streamError: unknown = null;
      try {
        for await (const message of stream) {
          await handleStreamMessage(session, message, activeToolCalls);
        }
      } catch (err) {
        streamError = err;
        log.error('[Agent] Stream error:', err);
      }
      session.activeQuery = null;
      await interruptActiveToolCalls(
        folderPath,
        activeToolCalls,
        'Agent 会话已结束，但工具没有返回完成事件。',
      );

      // The stream only ends when the CLI process exits. If nothing is
      // pending, leave the pump; the next user message restarts it.
      if (session.pendingTurns === 0 && session.queue.length === 0) break;

      consecutiveRestarts += 1;
      log.warn(`[Agent] Stream ended with pending work (restart #${consecutiveRestarts})`);
      if (consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
        const detail = streamError instanceof Error ? streamError.message : String(streamError ?? '未知错误');
        messageHub.notifyError(projectId, `Agent 会话多次重启失败：${detail}`);
        break;
      }
      await sleep(RESTART_DELAY_MS);
    }
  } finally {
    session.pumping = false;
    session.activeQuery = null;
    if (session.pendingContextClear) {
      const pending = session.pendingContextClear;
      session.pendingContextClear = null;
      clearTimeout(pending.timer);
      pending.reject(new Error('Agent 会话在清空上下文完成前结束'));
    }
    if (session.pendingTurns > 0) {
      session.pendingTurns = 0;
      messageHub.notifyTurnEnd();
    }
  }
}

/** Clear Claude's context while preserving the app's visible chat history and canvas. */
export async function clearAgentContext(options: AgentOptions): Promise<void> {
  const { projectId, folderPath, allowedTools = ['Read', 'Bash', 'Glob', 'Grep'] } = options;
  const session = getOrCreateSession(projectId, folderPath, allowedTools);
  if (session.pendingTurns > 0 || session.queue.length > 0 || session.pendingContextClear) {
    throw new Error('Agent 正在处理任务，请等待当前回合结束后再新建上下文');
  }

  const completion = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!session.pendingContextClear) return;
      session.pendingContextClear = null;
      reject(new Error('清空上下文超时，请稍后重试'));
    }, CONTEXT_CLEAR_TIMEOUT_MS);
    session.pendingContextClear = { resolve, reject, timer };
  });

  session.queue.push({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: '/clear' },
  });
  session.pendingTurns += 1;
  session.wakeInput?.();
  void pump(session);
  return completion;
}

/**
 * Queue a user message for the project's long-lived agent session. Returns
 * as soon as the message is persisted and queued - the turn runs in the
 * background and its output streams to the frontend via MessageHub.
 */
export async function enqueueAgentMessage(
  userMessage: ChatMessage,
  options: AgentOptions,
): Promise<void> {
  const { projectId, folderPath, allowedTools = ['Read', 'Bash', 'Glob', 'Grep'] } = options;

  // Persist the user message before queueing so history survives restarts
  const history = await readChatHistory(folderPath);
  await writeChatHistory(folderPath, [...history, userMessage]);

  const session = getOrCreateSession(projectId, folderPath, allowedTools);
  session.queue.push({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: buildUserPrompt(userMessage, folderPath) },
  });
  session.pendingTurns += 1;
  session.wakeInput?.();
  void pump(session);
}

/** Interrupt the currently running turn of a project's session, if any. */
export async function interruptAgentTurn(projectId: string): Promise<void> {
  const session = sessions.get(projectId);
  if (!session?.activeQuery) return;
  try {
    await session.activeQuery.interrupt();
  } catch (err) {
    log.warn('[Agent] Interrupt failed:', err);
  }
}
