export interface Project {
  id: string;
  name: string;
  folderPath: string;
  comfyuiBaseUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectIndex {
  projects: Project[];
  lastOpenedId?: string;
}

// Chat / Agent types
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Attachment {
  type: string;
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

// Artifact types
export type ArtifactType = 'markdown' | 'html' | 'image' | 'storyboard';

/** One shot in a short-drama storyboard (stored as a `.storyboard.json` array) */
export interface StoryboardShot {
  index: number; // 镜号
  duration: number; // 时长（秒）
  scene: string; // 画面描述/场景
  dialogue?: string; // 台词/旁白
  camera?: string; // 运镜/景别（如 推镜/特写）
  textToImagePrompt: string; // 文生图提示词
  imageToVideoPrompt: string; // 图生视频提示词
  imageSource?: string; // 当前选定的图片（工作区相对路径）
  imageSourceHistory?: string[]; // 历史抽卡记录（旧版本图片路径）
  videoSource?: string; // 当前选定的视频（工作区相对路径）
  videoSourceHistory?: string[]; // 历史抽卡记录（旧版本视频路径）
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  /** Workspace-relative source file path (for storyboard artifacts, edits are saved back to it) */
  path?: string;
  width: number;
  height: number;
  timestamp: number;
}

// Unified chat message type
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
  /** Canvas artifacts the user referenced (clicked) for this message */
  artifactRefs?: ArtifactRef[];
  // For tool call messages
  toolCall?: ToolCall;
  // For artifact messages
  artifact?: Artifact;
}

/** A lightweight pointer to a canvas artifact, attached to a chat message */
export interface ArtifactRef {
  id: string;
  title: string;
  type: ArtifactType;
  /** Workspace-relative source file path, if the artifact has one */
  path?: string;
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
