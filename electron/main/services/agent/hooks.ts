import log from 'electron-log/main';
import type { ChatMessage } from '../../../../src/shared/ipc.types';
import { messageHub } from '../message-hub';
import { appendChatMessage, updateChatMessage } from '../project.store';
import type { ToolCallInfo } from './types';

/**
 * Tool-use hooks that mirror execution into the chat: a running indicator is
 * pushed on start and updated with duration/result or error on finish.
 * Active calls are tracked in the provided map (keyed by tool_use_id).
 */
export function createToolTrackingHooks(
  projectId: string,
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
        messageHub.pushToFrontend(projectId, toolCallMsg);
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
        activeToolCalls.delete(toolId);
        messageHub.pushToFrontend(projectId, updatedMsg);
        await updateChatMessage(folderPath, toolId, () => updatedMsg);

        return { continue: true };
      }],
    }],
    PostToolUseFailure: [{
      hooks: [async (input: unknown) => {
        const failureInput = input as {
          tool_name: string;
          tool_input: unknown;
          tool_use_id: string;
          error: string;
          is_interrupt?: boolean;
          duration_ms?: number;
        };
        const toolId = failureInput.tool_use_id;
        const tool = activeToolCalls.get(toolId);
        const error = failureInput.is_interrupt
          ? `工具调用已被中断：${failureInput.error}`
          : failureInput.error;
        const updatedMsg: ChatMessage = {
          id: toolId,
          role: 'system',
          content: failureInput.is_interrupt
            ? `已中断: ${failureInput.tool_name}`
            : `执行失败: ${failureInput.tool_name}`,
          timestamp: Date.now(),
          toolCall: {
            id: toolId,
            toolName: failureInput.tool_name,
            toolInput: tool?.toolInput
              ? JSON.stringify(tool.toolInput).slice(0, 500)
              : JSON.stringify(failureInput.tool_input).slice(0, 500),
            status: failureInput.is_interrupt ? 'interrupted' : 'error',
            duration: failureInput.duration_ms,
            error,
          },
        };
        activeToolCalls.delete(toolId);
        log.warn(
          '[Agent] Tool failed:',
          failureInput.tool_name,
          'id:',
          toolId,
          'interrupt:',
          !!failureInput.is_interrupt,
          error,
        );
        messageHub.pushToFrontend(projectId, updatedMsg);
        await updateChatMessage(folderPath, toolId, () => updatedMsg);
        return { continue: true };
      }],
    }],
  };
}

/** Close orphaned running cards when a turn or stream ends without a post hook. */
export async function interruptActiveToolCalls(
  projectId: string,
  folderPath: string,
  activeToolCalls: Map<string, ToolCallInfo>,
  reason = '工具调用未返回完成事件，当前回合已结束；该操作可能已被自动重试。',
): Promise<void> {
  const running = [...activeToolCalls.values()].filter((tool) => tool.status === 'running');
  activeToolCalls.clear();
  for (const tool of running) {
    const updatedMsg: ChatMessage = {
      id: tool.id,
      role: 'system',
      content: `已中断: ${tool.toolName}`,
      timestamp: Date.now(),
      toolCall: {
        id: tool.id,
        toolName: tool.toolName,
        toolInput: JSON.stringify(tool.toolInput).slice(0, 500),
        status: 'interrupted',
        duration: tool.duration,
        error: reason,
      },
    };
    log.warn('[Agent] Closing orphaned tool call:', tool.toolName, 'id:', tool.id);
    messageHub.pushToFrontend(projectId, updatedMsg);
    await updateChatMessage(folderPath, tool.id, () => updatedMsg);
  }
}
