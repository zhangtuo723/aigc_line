import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ChatMessage, ToolCall, Artifact } from '../../../src/shared/ipc.types';
import { readChatHistory, writeChatHistory, readSessionId, writeSessionId, appendChatMessage, updateChatMessage } from './project.store';
import { messageHub } from './message-hub';
import log from 'electron-log/main';
import { z } from 'zod';

export interface AgentOptions {
  projectId: string;
  folderPath: string;
  allowedTools?: string[];
}

// Tool call tracking
interface ToolCallInfo {
  id: string;
  toolName: string;
  toolInput: unknown;
  status: 'running' | 'completed' | 'error';
  duration?: number;
  error?: string;
}

/** Image extensions -> MIME types supported as image artifacts */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

/** Push an artifact to the frontend */
export function pushArtifact(
  projectId: string,
  type: Artifact['type'],
  title: string,
  content: string,
  width = 400,
  height = 300,
): Artifact {
  const artifact: Artifact = {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    content,
    width,
    height,
    timestamp: Date.now(),
  };
  log.info('[Agent] Pushing artifact:', artifact.id, type, title);
  messageHub.pushArtifact(artifact);
  return artifact;
}

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
    let prompt = userMessage.content;
    if (userMessage.attachments && userMessage.attachments.length > 0) {
      const attachmentLines = userMessage.attachments
        .map((a) => {
          // Prefer workspace-relative paths (staged under uploads/)
          const rel = a.path ? path.relative(folderPath, a.path) : '';
          const location =
            rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : a.path;
          return `- ${a.name} (${a.type})${location ? ` at ${location}` : ''}`;
        })
        .join('\n');
      prompt = `User uploaded files (already inside the workspace, use Read/Bash to inspect them):\n${attachmentLines}\n\n${prompt}`;
    }

    // 5. Track active tool calls
    const activeToolCalls = new Map<string, ToolCallInfo>();

    // Create PushArtifact MCP server
    const pushArtifactServer = createSdkMcpServer({
      name: 'push-artifact-server',
      version: '1.0.0',
      instructions: 'Server for pushing artifacts to the frontend canvas',
      tools: [
        tool(
          'PushArtifact',
          'Push a file from the workspace (markdown, html, or image) to the user\'s canvas. Pass the file path - the file content is read from disk, so you do NOT need to repeat the content. Images (png/jpg/jpeg/gif/webp/svg/bmp/avif) are displayed as picture cards.',
          {
            path: z.string().describe('Path to the file, relative to the workspace or absolute'),
            title: z.string().describe('A short title for the artifact'),
            width: z.number().optional().describe('Width of the artifact on canvas in pixels, default 400'),
            height: z.number().optional().describe('Height of the artifact on canvas in pixels, default 300'),
          },
          async (args) => {
            log.info('[PushArtifact] Tool called:', args.path, args.title);
            try {
              // Resolve within the workspace - reject paths that escape it
              const filePath = path.resolve(folderPath, args.path);
              if (!filePath.startsWith(path.resolve(folderPath) + path.sep)) {
                throw new Error(`Path is outside the workspace: ${args.path}`);
              }
              const ext = path.extname(filePath).toLowerCase();
              const imageMime = IMAGE_MIME[ext];
              let type: Artifact['type'];
              let content: string;
              if (imageMime) {
                // Images travel as self-contained data URLs so canvas snapshots stay portable
                type = 'image';
                const buf = await fs.readFile(filePath);
                content = `data:${imageMime};base64,${buf.toString('base64')}`;
              } else {
                content = await fs.readFile(filePath, 'utf-8');
                type = ext === '.html' || ext === '.htm' ? 'html' : 'markdown';
              }
              const artifact = pushArtifact(projectId, type, args.title, content, args.width, args.height);
              // Also persist as a chat message so it survives reloads
              const artifactMsg: ChatMessage = {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                role: 'assistant',
                content: `Artifact: ${args.title}`,
                timestamp: Date.now(),
                artifact,
              };
              messageHub.pushToFrontend(artifactMsg);
              await appendChatMessage(folderPath, artifactMsg);
              return {
                content: [{ type: 'text', text: `Artifact pushed successfully: ${args.title} (${args.path})` }],
              } as any;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log.error('[PushArtifact] Failed:', message);
              return {
                content: [{ type: 'text', text: `Failed to push artifact: ${message}` }],
                isError: true,
              } as any;
            }
          },
        ),
      ],
    });

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
          'push-artifact': pushArtifactServer,
        },
        // Auto-allow all tool executions without permission prompts
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // System prompt: append workspace info and PushArtifact instructions
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `Your workspace is: ${folderPath}\n\nWhen you complete a task that produces a meaningful result (like writing code, generating a report, creating a visualization, etc.), you should use the PushArtifact tool to display it on the user's canvas. First write the result to a file in the workspace, then call PushArtifact with the file path - the content is read from disk, so do NOT paste the content into the tool call. The PushArtifact tool takes these parameters:\n- path: path to the file (relative to the workspace or absolute). The artifact type is inferred from the extension: .html/.htm renders as html, everything else renders as markdown\n- title: a short title for the artifact\n\nFor example, after writing a report to report.md, call PushArtifact with path="report.md" and title="Report".`,
        },
        // Use hooks to track tool execution
        hooks: {
          PreToolUse: [{
            hooks: [async (input) => {
              const toolInput = input as { tool_name: string; tool_input: unknown; tool_use_id: string };
              const toolId = toolInput.tool_use_id;
              const toolCall: ToolCallInfo = {
                id: toolId,
                toolName: toolInput.tool_name,
                toolInput: toolInput.tool_input,
                status: 'running',
              };
              activeToolCalls.set(toolId, toolCall);
              log.info('[Agent] Tool started:', toolInput.tool_name, 'id:', toolId, JSON.stringify(toolInput.tool_input).slice(0, 200));
              // Push tool-start event directly to frontend and persist
              const toolCallMsg: ChatMessage = {
                id: toolId,
                role: 'system',
                content: `正在执行: ${toolInput.tool_name}`,
                timestamp: Date.now(),
                toolCall: {
                  id: toolId,
                  toolName: toolInput.tool_name,
                  toolInput: JSON.stringify(toolInput.tool_input).slice(0, 500),
                  status: 'running',
                },
              };
              messageHub.pushToFrontend(toolCallMsg);
              await appendChatMessage(folderPath, toolCallMsg);
              return { continue: true };
            }],
          }],
          PostToolUse: [{
            hooks: [async (input) => {
              const postInput = input as { tool_name: string; duration_ms?: number; tool_response: unknown; tool_use_id: string };
              const toolId = postInput.tool_use_id;
              // Find the tool call in our tracking map
              const tool = activeToolCalls.get(toolId);
              if (tool) {
                tool.status = 'completed';
                tool.duration = postInput.duration_ms;
              }
              log.info('[Agent] Tool completed:', postInput.tool_name, 'id:', toolId, 'duration:', postInput.duration_ms + 'ms');
              // Update the existing tool-start message in history with completed status
              const toolResult = postInput.tool_response ? JSON.stringify(postInput.tool_response).slice(0, 1000) : undefined;
              const updatedMsg: ChatMessage = {
                id: toolId,
                role: 'system',
                content: `已完成: ${postInput.tool_name} (${postInput.duration_ms}ms)`,
                timestamp: Date.now(),
                toolCall: {
                  id: toolId,
                  toolName: postInput.tool_name,
                  toolInput: tool?.toolInput ? JSON.stringify(tool.toolInput).slice(0, 500) : JSON.stringify(postInput).slice(0, 500),
                  status: 'completed',
                  duration: postInput.duration_ms,
                  toolResult,
                },
              };
              messageHub.pushToFrontend(updatedMsg);
              await updateChatMessage(folderPath, toolId, () => updatedMsg);

              return { continue: true };
            }],
          }],
        },
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

function extractMessageText(message: unknown): string | null {
  if (!message) return null;

  // Handle string message directly
  if (typeof message === 'string') {
    return message;
  }

  if (typeof message !== 'object') {
    return null;
  }

  const msg = message as Record<string, unknown>;

  // Log the message type for debugging
  log.info('[Agent] message type:', msg.type, 'subtype:', msg.subtype);

  // Handle assistant messages with text content
  if (msg.type === 'assistant') {
    // Try to extract text from msg.message.content (SDK assistant message format)
    if (msg.message && typeof msg.message === 'object') {
      const messageData = msg.message as Record<string, unknown>;

      // Handle content array
      if (messageData.content && Array.isArray(messageData.content)) {
        const texts = messageData.content
          .filter((block: unknown) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text')
          .map((block: unknown) => (block as Record<string, unknown>).text as string);
        return texts.join('');
      }

      // Handle direct content string
      if (typeof messageData.content === 'string') {
        return messageData.content;
      }
    }

    // Fallback: try direct text field
    if (msg.text && typeof msg.text === 'string') {
      return msg.text;
    }
  }

  return null;
}
