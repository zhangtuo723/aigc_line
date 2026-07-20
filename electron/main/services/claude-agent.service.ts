import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ChatMessage, ToolCall } from '../../../src/shared/ipc.types';
import { readChatHistory, writeChatHistory, readSessionId, writeSessionId, appendChatMessage, updateChatMessage } from './project.store';
import { messageHub } from './message-hub';
import log from 'electron-log/main';

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

    // 4. Build the prompt
    const prompt = buildAgentPrompt(userMessage, folderPath);

    // 5. Track active tool calls
    const activeToolCalls = new Map<string, ToolCallInfo>();

    // 6. Run the agent query with session support
    log.info('[Agent] Calling query with resume:', sessionId || 'none');
    const stream = query({
      prompt,
      options: {
        allowedTools,
        cwd: folderPath,
        // Resume existing session if available, otherwise start fresh
        ...(sessionId ? { resume: sessionId } : {}),
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

function buildAgentPrompt(userMessage: ChatMessage, folderPath: string): string {
  const basePrompt = `You are a helpful AI assistant. You can help users with a wide range of tasks including coding, writing, analysis, and general questions.

Your workspace is: ${folderPath}

You have access to the following tools:
1. Read files in the workspace
2. Run shell commands
3. Search for files
4. Edit and write files

When the user asks you to do something, use the available tools as needed to help them. Be concise and helpful in your responses.`;

  let prompt = basePrompt;

  // Add current user message
  if (userMessage.attachments && userMessage.attachments.length > 0) {
    prompt += `\nUser uploaded files:\n`;
    for (const attachment of userMessage.attachments) {
      prompt += `- ${attachment.name} (${attachment.type})\n`;
    }
  }

  prompt += `\nUser: ${userMessage.content}\n`;
  prompt += `\nAssistant: `;

  return prompt;
}
