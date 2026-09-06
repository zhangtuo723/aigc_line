import type { ProjectAgentConfig } from '../../../../src/shared/agent-config';
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
}
