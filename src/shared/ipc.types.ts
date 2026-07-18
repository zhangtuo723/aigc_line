export interface Project {
  id: string;
  name: string;
  folderPath: string;
  comfyuiBaseUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface Cue {
  id: number;
  start: number;
  end: number;
  text: string;
}

export type ImageStyle = 'pencil' | 'ink' | 'marker';

export interface WorkflowOptions {
  comfyuiBaseUrl?: string;
  imageStyle?: ImageStyle;
}

export type WorkflowStep =
  | 'idle'
  | 'parsing'
  | 'prompting'
  | 'generating'
  | 'assembling'
  | 'done'
  | 'error';

export interface WorkflowProgress {
  runId: string;
  projectId: string;
  step: WorkflowStep;
  percent: number;
  message: string;
  cueId?: number;
}

export interface WorkflowResult {
  runId: string;
  projectId: string;
  status: 'success' | 'cancelled' | 'error';
  outputPath?: string;
  error?: string;
}

export interface WorkspaceState {
  audioFound: boolean;
  srtFound: boolean;
  audioPath?: string;
  srtPath?: string;
  cueCount: number;
  valid: boolean;
}

export interface Scene {
  cueId: number;
  prompt: string;
  imagePath?: string;
}

export interface ProjectRun {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  outputPath?: string;
  status: string;
}

export interface ProjectManifest {
  projectId: string;
  folderPath: string;
  audioPath?: string;
  srtPath?: string;
  cues: Cue[];
  scenes: Scene[];
  runs: ProjectRun[];
}

export interface ProjectIndex {
  projects: Project[];
  lastOpenedId?: string;
}

// Chat / Agent types
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Attachment {
  type: 'srt' | 'mp3';
  name: string;
  path: string;
}

// Tool call tracking
export type ToolStatus = 'running' | 'completed' | 'error';

export interface ToolCall {
  id: string;
  toolName: string;
  toolInput: string;
  status: ToolStatus;
  duration?: number;
  error?: string;
  toolResult?: string;
}

// Unified chat message type
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
  // For tool call messages
  toolCall?: ToolCall;
}

// ===== MessageHub types =====

/** Message types supported by MessageHub */
export type MessageHubType =
  | 'user-message'
  | 'agent-text'
  | 'tool-start'
  | 'tool-complete'
  | 'agent-thinking'
  | 'agent-error';

/** Base message for MessageHub */
export interface MessageHubMessage {
  id: string;
  type: MessageHubType;
  projectId: string;
  timestamp: number;
  payload: unknown;
}

/** User sends a message */
export interface UserMessageEvent {
  type: 'user-message';
  message: ChatMessage;
}

/** Agent text response */
export interface AgentTextEvent {
  type: 'agent-text';
  text: string;
  fullResponse: string;
  done: boolean;
}

/** Tool execution started */
export interface ToolStartEvent {
  type: 'tool-start';
  toolCall: ToolCall;
}

/** Tool execution completed */
export interface ToolCompleteEvent {
  type: 'tool-complete';
  toolCall: ToolCall;
}

/** Agent is thinking/processing */
export interface AgentThinkingEvent {
  type: 'agent-thinking';
  message: string;
}

/** Agent encountered an error */
export interface AgentErrorEvent {
  type: 'agent-error';
  error: string;
}

/** Union type for all MessageHub events */
export type MessageHubEvent =
  | UserMessageEvent
  | AgentTextEvent
  | ToolStartEvent
  | ToolCompleteEvent
  | AgentThinkingEvent
  | AgentErrorEvent;

/** MessageHub event handler */
export type MessageHubHandler = (event: MessageHubEvent) => void | Promise<void>;
