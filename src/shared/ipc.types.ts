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

export interface ImportAudioResult {
  success: boolean;
  canceled?: boolean;
  relativePath?: string;
  name?: string;
  error?: string;
}

// Chat / Agent types
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Attachment {
  type: string;
  name: string;
  path: string;
}

// Tool call tracking
export type ToolStatus = 'running' | 'completed' | 'error' | 'interrupted';

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
/** `storyboard` remains only so older chat histories can be imported into shot nodes. */
export type ArtifactType = 'markdown' | 'html' | 'image' | 'storyboard';

/** Legacy storyboard import shape. New projects store this data directly on canvas nodes. */
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
  /** Workspace-relative source file path. */
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
  /** Live canvas nodes the user explicitly attached to this message */
  nodeRefs?: CanvasNodeRef[];
  /** Persistent UI event marking that Claude started with empty context here. */
  event?: 'context-cleared';
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

export interface ClearAgentContextResult {
  success: boolean;
  error?: string;
}

export type AvailableSkillSource = 'builtin' | 'project' | 'user' | 'sdk';

export interface AvailableSkill {
  /** Invocation name without the leading slash. */
  name: string;
  description: string;
  argumentHint?: string;
  source: AvailableSkillSource;
}

/** A stable pointer to a live canvas node. Its current data is read by the Agent. */
export interface CanvasNodeRef {
  id: string;
  title: string;
  kind: CanvasNodeKind;
}

// Live canvas bridge used by the Agent's Canvas MCP tools.
export type CanvasNodeKind = 'shot' | 'text' | 'image' | 'video' | 'audio' | 'upscale';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasNodeData extends Record<string, unknown> {
  kind: CanvasNodeKind;
  title: string;
  prompt?: string;
  shotNumber?: number;
  scene?: string;
  preview?: string;
  artifactId?: string;
  aspectRatio?: ImageAspectRatio;
  sourcePath?: string;
  sourceHistory?: string[];
  workflowId?: string;
  duration?: number;
  firstFrameNodeId?: string;
  lastFrameNodeId?: string;
  referenceImageNodeIds?: string[];
  referenceVideoNodeIds?: string[];
  referenceAudioNodeIds?: string[];
  inputNodeId?: string;
  scale?: number;
  quality?: string;
  generationStatus?: 'idle' | 'generating' | 'error';
  generationError?: string;
}

export interface CanvasNodeSnapshot {
  id: string;
  type: 'storyNode';
  position: CanvasPoint;
  selected?: boolean;
  data: CanvasNodeData;
}

export interface CanvasEdgeSnapshot {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  selected?: boolean;
}

export interface CanvasStateSnapshot {
  revision: number;
  nodeCount: number;
  edgeCount: number;
  nodes: CanvasNodeSnapshot[];
  edges: CanvasEdgeSnapshot[];
  viewport: { x: number; y: number; zoom: number };
}

export type CanvasCommandAction =
  | 'get-state'
  | 'get-capabilities'
  | 'create-nodes'
  | 'update-nodes'
  | 'delete-nodes'
  | 'connect-nodes'
  | 'disconnect-edges'
  | 'invoke-action';

export interface CanvasCommandRequest {
  requestId: string;
  projectId: string;
  action: CanvasCommandAction;
  payload: unknown;
}

export interface CanvasCommandResponse {
  requestId: string;
  success: boolean;
  revision?: number;
  result?: unknown;
  error?: string;
}

// ComfyUI image generation
export type ImageAspectRatio = '16:9' | '1:1' | '4:3';

export interface GenerateImageRequest {
  projectId: string;
  nodeId: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  negativePrompt?: string;
  workflowId?: string;
  referenceImagePath?: string;
}

export type ComfyWorkflowKind = 'text-to-image' | 'image-to-image' | 'image-to-video';

export interface ComfyWorkflowInfo {
  id: string;
  name: string;
  kind: ComfyWorkflowKind;
}

export interface AppSettingsView {
  comfyuiBaseUrl: string;
  agentBaseUrl: string;
  agentTokenConfigured: boolean;
  defaultImageWorkflowId: string;
}

export interface SaveAppSettingsRequest {
  comfyuiBaseUrl: string;
  agentBaseUrl: string;
  defaultImageWorkflowId: string;
  agentToken?: string;
  clearAgentToken?: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface GenerateImageResult {
  success: boolean;
  relativePath?: string;
  promptId?: string;
  error?: string;
}

export interface GenerateVideoRequest {
  projectId: string;
  nodeId: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  duration?: number;
  workflowId?: string;
  referenceImagePath?: string;
  lastFrameImagePath?: string;
  referenceImagePaths?: string[];
  referenceVideoPaths?: string[];
  referenceAudioPaths?: string[];
}

export interface GenerateVideoResult {
  success: boolean;
  relativePath?: string;
  promptId?: string;
  error?: string;
}

// ComfyUI video upscale (RTX Video Super Resolution)
export interface UpscaleVideoRequest {
  projectId: string;
  nodeId: string;
  sourceVideoPath: string;
  scale?: number;
  quality?: string;
}

export interface UpscaleVideoResult {
  success: boolean;
  relativePath?: string;
  promptId?: string;
  error?: string;
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
