import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import type {
  ChatMessage,
  MessageHubEvent,
  MessageHubHandler,
  ToolCall,
  Artifact,
} from '../../../src/shared/ipc.types';
import log from 'electron-log/main';

/**
 * MessageHub - Central message broker for frontend <-> Agent communication
 *
 * Features:
 * - Unified event types (user-message, agent-text, tool-start, tool-complete, agent-thinking, agent-error)
 * - Bidirectional communication between frontend and Agent service
 * - Message deduplication and state tracking
 * - Tool call lifecycle management
 */
class MessageHub {
  private handlers: Set<MessageHubHandler> = new Set();
  private activeToolCalls: Map<string, ToolCall> = new Map();

  /** Subscribe to MessageHub events */
  on(handler: MessageHubHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Emit event to all subscribers */
  emit(event: MessageHubEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        log.error('[MessageHub] Handler error:', err);
      }
    }
  }

  /** Push a chat message to all renderer windows */
  pushToFrontend(projectId: string, message: ChatMessage): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.push.chatMessage, { projectId, message });
    });
  }

  // ===== Convenience methods for common events =====

  /** Notify that agent is thinking */
  notifyThinking(projectId: string, message: string = 'Agent 正在思考...'): void {
    const event: MessageHubEvent = {
      type: 'agent-thinking',
      message,
    } as MessageHubEvent;

    this.emit(event);

    // Also push to frontend as system message
    this.pushToFrontend(projectId, {
      id: `thinking-${Date.now()}`,
      role: 'system',
      content: message,
      timestamp: Date.now(),
    });
  }

  /** Notify that a tool has started */
  notifyToolStart(projectId: string, toolCall: ToolCall): void {
    this.activeToolCalls.set(toolCall.id, toolCall);

    const event: MessageHubEvent = {
      type: 'tool-start',
      toolCall,
    } as MessageHubEvent;

    this.emit(event);

    // Push to frontend
    this.pushToFrontend(projectId, {
      id: `tool-${toolCall.id}`,
      role: 'system',
      content: `正在执行: ${toolCall.toolName}`,
      timestamp: Date.now(),
      toolCall,
    });
  }

  /** Notify that a tool has completed */
  notifyToolComplete(projectId: string, toolCall: ToolCall): void {
    this.activeToolCalls.set(toolCall.id, toolCall);

    const event: MessageHubEvent = {
      type: 'tool-complete',
      toolCall,
    } as MessageHubEvent;

    this.emit(event);

    // Push to frontend with updated status
    this.pushToFrontend(projectId, {
      id: `tool-${toolCall.id}`,
      role: 'system',
      content: `已完成: ${toolCall.toolName} (${toolCall.duration}ms)`,
      timestamp: Date.now(),
      toolCall,
    });
  }

  /** Push agent text response (not streaming, just a single message) */
  pushAgentText(projectId: string, text: string): void {
    const event: MessageHubEvent = {
      type: 'agent-text',
      text,
      fullResponse: text,
      done: true,
    } as MessageHubEvent;

    this.emit(event);

    // Push final message to frontend
    this.pushToFrontend(projectId, {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: text || 'Agent 执行完成。',
      timestamp: Date.now(),
    });
  }

  /** Notify about an error */
  notifyError(projectId: string, error: string): void {
    const event: MessageHubEvent = {
      type: 'agent-error',
      error,
    } as MessageHubEvent;

    this.emit(event);

    this.pushToFrontend(projectId, {
      id: `error-${Date.now()}`,
      role: 'assistant',
      content: `处理消息时出错: ${error}`,
      timestamp: Date.now(),
    });
  }

  /** Push an artifact to all renderer windows */
  pushArtifact(projectId: string, artifact: Artifact): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.push.artifact, { projectId, artifact });
    });
  }

  /** Notify that the agent turn has finished (successfully or not) */
  notifyTurnEnd(projectId: string): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.push.turnEnd, { projectId });
    });
  }
  getActiveToolCalls(): ToolCall[] {
    return Array.from(this.activeToolCalls.values()).filter(
      (t) => t.status === 'running',
    );
  }

  /** Reset state for a new conversation */
  reset(): void {
    this.activeToolCalls.clear();
  }
}

// Singleton instance
export const messageHub = new MessageHub();
