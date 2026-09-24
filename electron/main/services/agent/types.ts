import type { ProjectAgentConfig } from '../../../../src/shared/agent-config';
import type { ChatMessage } from '../../../../src/shared/ipc.types';
export interface AgentOptions {
  agent?: ProjectAgentConfig;
  projectId: string;
  folderPath: string;
  allowedTools?: string[];
}

// Tool call tracking
export interface ToolCallInfo {
  id: string;
  toolName: string;
  toolInput: unknown;
  status: 'running' | 'completed' | 'error' | 'interrupted';
  duration?: number;
  error?: string;
  subagent?: ChatMessage['subagent'];
}

export interface SubagentTask {
  parentToolUseId: string;
  type?: string;
  description?: string;
  message?: ChatMessage;
}
