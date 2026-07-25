import { query } from '@anthropic-ai/claude-agent-sdk';
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
import { buildUserPrompt, buildSystemPromptAppend } from './prompts';
import { createPushArtifactServer } from './tools';
import { createToolTrackingHooks } from './hooks';
import { extractMessageText } from './stream';

export type { AgentOptions } from './types';
export { pushArtifact } from './artifact';

export async function runAgent(
  userMessage: ChatMessage,
  options: AgentOptions,
): Promise<void> {
  const { projectId, folderPath, allowedTools = ['Read', 'Bash', 'Glob', 'Grep'] } = options;

  try {
    // 1. Read chat history
    const history = await readChatHistory(folderPath);

    // 2. Save user message to history
    await writeChatHistory(folderPath, [...history, userMessage]);

    // 3. Read session ID from project config (disk only, no memory cache)
    const sessionId = await readSessionId(folderPath);
    log.info('[Agent] Session ID from disk:', sessionId || 'none');

    // 4. Build the prompt - only current user message, system instructions go in systemPrompt
    const prompt = buildUserPrompt(userMessage, folderPath);

    // 5. Track active tool calls
    const activeToolCalls = new Map<string, ToolCallInfo>();

    // 6. Run the agent query with session support
    log.info('[Agent] Calling query with resume:', sessionId || 'none');
    const stream = query({
      prompt,
      options: {
        allowedTools: [...allowedTools, 'PushArtifact'],
        cwd: folderPath,
        // Resume existing session if available, otherwise start fresh
        ...(sessionId ? { resume: sessionId } : {}),
        // Register the MCP server
        mcpServers: {
          'push-artifact': createPushArtifactServer(projectId, folderPath),
        },
        // Auto-allow all tool executions without permission prompts
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // System prompt: append workspace info and PushArtifact instructions
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: buildSystemPromptAppend(folderPath),
        },
        // Use hooks to track tool execution
        hooks: createToolTrackingHooks(folderPath, activeToolCalls),
      },
    });

    for await (const message of stream) {
      // Capture session ID from init message
      if (message && typeof message === 'object') {
        const msg = message as Record<string, unknown>;
        if (msg.type === 'system' && msg.subtype === 'init') {
          const sessionIdFromMsg = msg.session_id ?? (msg.data as Record<string, unknown> | undefined)?.session_id;
          if (sessionIdFromMsg) {
            const newSessionId = String(sessionIdFromMsg);
            await writeSessionId(folderPath, newSessionId);
            log.info('[Agent] Session saved to disk:', newSessionId);
          }
        }
      }

      // Extract text content
      const text = extractMessageText(message);
      if (text) {
        // Push each text chunk to frontend in real-time and persist
        const textMsg: ChatMessage = {
          id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: text,
          timestamp: Date.now(),
        };
        messageHub.pushToFrontend(textMsg);
        await appendChatMessage(folderPath, textMsg);
      }
    }
  } catch (err) {
    log.error('[Agent] query failed:', err);
    throw err;
  } finally {
    // Signal the frontend that the whole turn is over (success or failure)
    messageHub.notifyTurnEnd();
  }
}
