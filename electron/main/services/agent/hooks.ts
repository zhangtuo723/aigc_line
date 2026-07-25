import log from 'electron-log/main';
import type { ChatMessage } from '../../../../src/shared/ipc.types';
import { messageHub } from '../message-hub';
import { appendChatMessage, updateChatMessage } from '../project.store';
import type { ToolCallInfo } from './types';

/**
 * Pre/PostToolUse hooks that mirror tool execution into the chat: a running
 * indicator is pushed on start and updated with duration/result on finish.
 * Active calls are tracked in the provided map (keyed by tool_use_id).
 */
export function createToolTrackingHooks(
  folderPath: string,
  activeToolCalls: Map<string, ToolCallInfo>,
) {
  return {
    PreToolUse: [{
      hooks: [async (input: unknown) => {
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
      hooks: [async (input: unknown) => {
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
  };
}
