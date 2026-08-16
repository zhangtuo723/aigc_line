import { ipcRenderer, contextBridge, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc.channels';
import type {
  Project,
  ProjectIndex,
  ChatMessage,
  Artifact,
  GenerateImageRequest,
  GenerateImageResult,
  GenerateVideoRequest,
  GenerateVideoResult,
  UpscaleVideoRequest,
  UpscaleVideoResult,
  ComfyWorkflowInfo,
  AppSettingsView,
  SaveAppSettingsRequest,
  TestQwenConnectionRequest,
  TestGoogleAiConnectionRequest,
  TestSeedreamConnectionRequest,
  ConnectionTestResult,
  ImportAudioResult,
  ImportProjectMediaResult,
  ListProjectMediaResult,
  CanvasCommandRequest,
  CanvasCommandResponse,
  AvailableSkill,
  ClearAgentContextResult,
  ProjectChatMessagePush,
  ProjectArtifactPush,
  ProjectTurnEndPush,
} from '../../src/shared/ipc.types';

export interface ElectronAPI {
  platform: NodeJS.Platform;
  createProject: (name: string, folderPath: string) => Promise<Project>;
  listProjects: () => Promise<ProjectIndex>;
  loadProject: (id: string) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  importAudio: (projectId: string) => Promise<ImportAudioResult>;
  importProjectMedia: (projectId: string) => Promise<ImportProjectMediaResult>;
  listProjectMedia: (projectId: string) => Promise<ListProjectMediaResult>;
  sendChatMessage: (projectId: string, message: ChatMessage) => Promise<void>;
  interruptAgent: (projectId: string) => Promise<void>;
  loadChatHistory: (folderPath: string) => Promise<ChatMessage[]>;
  listAgentSkills: (projectId: string) => Promise<AvailableSkill[]>;
  clearAgentContext: (projectId: string) => Promise<ClearAgentContextResult>;
  saveCanvasSnapshot: (folderPath: string, snapshot: unknown) => Promise<{ success: boolean }>;
  loadCanvasSnapshot: (folderPath: string) => Promise<unknown | null>;
  saveArtifactContent: (
    projectId: string,
    relPath: string,
    content: string,
  ) => Promise<{ success: boolean; error?: string }>;
  generateImage: (request: GenerateImageRequest) => Promise<GenerateImageResult>;
  generateVideo: (request: GenerateVideoRequest) => Promise<GenerateVideoResult>;
  upscaleVideo: (request: UpscaleVideoRequest) => Promise<UpscaleVideoResult>;
  listComfyWorkflows: () => Promise<ComfyWorkflowInfo[]>;
  getAppSettings: () => Promise<AppSettingsView>;
  saveAppSettings: (request: SaveAppSettingsRequest) => Promise<AppSettingsView>;
  testComfyUIConnection: (baseUrl: string) => Promise<ConnectionTestResult>;
  testQwenConnection: (request: TestQwenConnectionRequest) => Promise<ConnectionTestResult>;
  testGoogleAiConnection: (request: TestGoogleAiConnectionRequest) => Promise<ConnectionTestResult>;
  testSeedreamConnection: (request: TestSeedreamConnectionRequest) => Promise<ConnectionTestResult>;
  onChatMessage: (callback: (event: ProjectChatMessagePush) => void) => () => void;
  onArtifact: (callback: (event: ProjectArtifactPush) => void) => () => void;
  onTurnEnd: (callback: (event: ProjectTurnEndPush) => void) => () => void;
  onCanvasCommand: (callback: (command: CanvasCommandRequest) => void) => () => void;
  sendCanvasCommandResult: (response: CanvasCommandResponse) => void;
  showOpenDialog: (options?: Electron.OpenDialogOptions) => Promise<string[]>;
  showItemInFolder: (path: string) => void;
  getPathForFile: (file: File) => string;
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args);

const onPush = <T>(channel: string, callback: (payload: T) => void) => {
  const handler = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

const api: ElectronAPI = {
  platform: process.platform,
  createProject: (name, folderPath) =>
    invoke(IPC_CHANNELS.project.create, name, folderPath),
  listProjects: () => invoke(IPC_CHANNELS.project.list),
  loadProject: (id) => invoke(IPC_CHANNELS.project.load, id),
  deleteProject: (id) => invoke(IPC_CHANNELS.project.delete, id),
  importAudio: (projectId) => invoke(IPC_CHANNELS.project.importAudio, projectId),
  importProjectMedia: (projectId) => invoke(IPC_CHANNELS.project.importMedia, projectId),
  listProjectMedia: (projectId) => invoke(IPC_CHANNELS.project.listMedia, projectId),
  sendChatMessage: (projectId, message) =>
    invoke(IPC_CHANNELS.chat.sendMessage, projectId, message),
  interruptAgent: (projectId) =>
    invoke(IPC_CHANNELS.chat.interrupt, projectId),
  loadChatHistory: (folderPath) => invoke(IPC_CHANNELS.chat.loadHistory, folderPath),
  listAgentSkills: (projectId) => invoke(IPC_CHANNELS.chat.listSkills, projectId),
  clearAgentContext: (projectId) => invoke(IPC_CHANNELS.chat.clearContext, projectId),
  saveCanvasSnapshot: (folderPath, snapshot) => invoke(IPC_CHANNELS.canvas.save, folderPath, snapshot),
  loadCanvasSnapshot: (folderPath) => invoke(IPC_CHANNELS.canvas.load, folderPath),
  saveArtifactContent: (projectId, relPath, content) =>
    invoke(IPC_CHANNELS.artifact.save, projectId, relPath, content),
  generateImage: (request) => invoke(IPC_CHANNELS.comfyui.generateImage, request),
  generateVideo: (request) => invoke(IPC_CHANNELS.comfyui.generateVideo, request),
  upscaleVideo: (request) => invoke(IPC_CHANNELS.comfyui.upscaleVideo, request),
  listComfyWorkflows: () => invoke(IPC_CHANNELS.comfyui.listWorkflows),
  getAppSettings: () => invoke(IPC_CHANNELS.settings.get),
  saveAppSettings: (request) => invoke(IPC_CHANNELS.settings.save, request),
  testComfyUIConnection: (baseUrl) => invoke(IPC_CHANNELS.settings.testComfyUI, baseUrl),
  testQwenConnection: (request) => invoke(IPC_CHANNELS.settings.testQwen, request),
  testGoogleAiConnection: (request) => invoke(IPC_CHANNELS.settings.testGoogleAi, request),
  testSeedreamConnection: (request) => invoke(IPC_CHANNELS.settings.testSeedream, request),
  onChatMessage: (callback) => onPush(IPC_CHANNELS.push.chatMessage, callback),
  onArtifact: (callback) => onPush(IPC_CHANNELS.push.artifact, callback),
  onTurnEnd: (callback) => onPush(IPC_CHANNELS.push.turnEnd, callback),
  onCanvasCommand: (callback) => onPush(IPC_CHANNELS.push.canvasCommand, callback),
  sendCanvasCommandResult: (response) => ipcRenderer.send(IPC_CHANNELS.canvas.commandResult, response),
  showOpenDialog: (options) => invoke('dialog:showOpenDialog', options),
  showItemInFolder: (path) => ipcRenderer.send('shell:showItemInFolder', path),
  // File.path was removed in Electron 32 - this is the supported way
  getPathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true);
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true);
        }
      });
    }
  });
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find((e) => e === child)) {
      return parent.appendChild(child);
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find((e) => e === child)) {
      return parent.removeChild(child);
    }
  },
};

function useLoading() {
  const className = `loaders-css__square-spin`;
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `;
  const oStyle = document.createElement('style');
  const oDiv = document.createElement('div');

  oStyle.id = 'app-loading-style';
  oStyle.innerHTML = styleContent;
  oDiv.className = 'app-loading-wrap';
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`;

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle);
      safeDOM.append(document.body, oDiv);
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle);
      safeDOM.remove(document.body, oDiv);
    },
  };
}

const { appendLoading, removeLoading } = useLoading();
domReady().then(appendLoading);

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading();
};

setTimeout(removeLoading, 4999);
