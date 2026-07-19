import { create } from 'zustand';
import type {
  Project,
  ProjectIndex,
  WorkspaceState,
  WorkflowOptions,
  WorkflowProgress,
  WorkflowResult,
  ImageStyle,
  ProjectManifest,
  ChatMessage,
} from '../shared/ipc.types';

interface AppState {
  projects: ProjectIndex;
  currentProject: Project | null;
  workspace: WorkspaceState | null;
  manifest: ProjectManifest | null;
  progress: WorkflowProgress | null;
  result: WorkflowResult | null;
  isRunning: boolean;
  imageStyle: ImageStyle;
  comfyuiBaseUrl: string;
  messages: ChatMessage[];
  isAgentThinking: boolean;
  sidebarCollapsed: boolean;

  setProjects: (projects: ProjectIndex) => void;
  setCurrentProject: (project: Project | null) => void;
  setWorkspace: (workspace: WorkspaceState | null) => void;
  setManifest: (manifest: ProjectManifest | null) => void;
  setProgress: (progress: WorkflowProgress | null) => void;
  setResult: (result: WorkflowResult | null) => void;
  setIsRunning: (isRunning: boolean) => void;
  setImageStyle: (style: ImageStyle) => void;
  setComfyuiBaseUrl: (url: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setAgentThinking: (isAgentThinking: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  loadProjects: () => Promise<void>;
  createProject: (name: string, folderPath: string) => Promise<Project>;
  selectProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  scanWorkspace: () => Promise<void>;
  loadManifest: () => Promise<void>;
  updateScenePrompt: (cueId: number, prompt: string) => Promise<void>;
  runWorkflow: () => Promise<void>;
  cancelWorkflow: () => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatMessage['attachments']) => Promise<void>;
  loadChatHistory: () => Promise<void>;
}

const electronAPI = window.electronAPI;

export const useAppStore = create<AppState>((set, get) => ({
  projects: { projects: [] },
  currentProject: null,
  workspace: null,
  manifest: null,
  progress: null,
  result: null,
  isRunning: false,
  imageStyle: 'pencil',
  comfyuiBaseUrl: 'http://127.0.0.1:8188',
  messages: [],
  isAgentThinking: false,
  sidebarCollapsed: false,

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setWorkspace: (workspace) => set({ workspace }),
  setManifest: (manifest) => set({ manifest }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ result }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setImageStyle: (imageStyle) => set({ imageStyle }),
  setComfyuiBaseUrl: (comfyuiBaseUrl) => set({ comfyuiBaseUrl }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setAgentThinking: (isAgentThinking) => set({ isAgentThinking }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  loadProjects: async () => {
    const projects = await electronAPI.listProjects();
    set({ projects });
    if (projects.lastOpenedId) {
      await get().selectProject(projects.lastOpenedId);
    }
  },

  createProject: async (name, folderPath) => {
    const project = await electronAPI.createProject(name, folderPath);
    await get().loadProjects();
    await get().selectProject(project.id);
    return project;
  },

  selectProject: async (id) => {
    const project = await electronAPI.loadProject(id);
    if (!project) return;
    set({
      currentProject: project,
      comfyuiBaseUrl: project.comfyuiBaseUrl,
      progress: null,
      result: null,
      messages: [],
    });
    await get().scanWorkspace();
    await get().loadManifest();
    await get().loadChatHistory();
  },

  deleteProject: async (id) => {
    await electronAPI.deleteProject(id);
    const state = get();
    if (state.currentProject?.id === id) {
      set({ currentProject: null, workspace: null, manifest: null, progress: null, result: null, messages: [] });
    }
    await get().loadProjects();
  },

  scanWorkspace: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    const workspace = await electronAPI.scanWorkspace(currentProject.folderPath);
    set({ workspace });
  },

  loadManifest: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    const manifest = await electronAPI.readManifest(currentProject.folderPath);
    set({ manifest });
  },

  updateScenePrompt: async (cueId, prompt) => {
    const { currentProject } = get();
    if (!currentProject) return;
    const manifest = await electronAPI.updateScenePrompt(currentProject.folderPath, cueId, prompt);
    set({ manifest });
  },

  runWorkflow: async () => {
    const { currentProject, imageStyle, comfyuiBaseUrl } = get();
    if (!currentProject) return;

    set({ progress: null, result: null, isRunning: true });

    const options: WorkflowOptions = {
      imageStyle,
      comfyuiBaseUrl,
    };

    try {
      await electronAPI.runWorkflow(currentProject.id, options);
    } catch (err) {
      set({ isRunning: false });
      throw err;
    }
  },

  cancelWorkflow: async () => {
    await electronAPI.cancelWorkflow();
    set({ isRunning: false });
  },

  loadChatHistory: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const history = await electronAPI.loadChatHistory(currentProject.folderPath);
      set({ messages: history });
    } catch (err) {
      console.error('Failed to load chat history:', err);
      set({ messages: [] });
    }
  },

  sendChatMessage: async (content, attachments) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const message: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments,
    };

    // Add user message to local state immediately (don't wait for IPC push)
    set((state) => ({ messages: [...state.messages, message], isAgentThinking: true }));

    try {
      await electronAPI.sendChatMessage(currentProject.id, message);
    } catch (err) {
      set({ isAgentThinking: false });
      throw err;
    }
  },
}));

// Subscribe to push events once
electronAPI.onProgress((progress: WorkflowProgress) => {
  useAppStore.setState({ progress });
});

electronAPI.onComplete((result: WorkflowResult) => {
  useAppStore.setState({ result, isRunning: false });
  const state = useAppStore.getState();
  if (state.currentProject) {
    state.scanWorkspace();
    state.loadManifest();
  }
});

electronAPI.onWorkspaceChanged(() => {
  const state = useAppStore.getState();
  if (state.currentProject) {
    state.scanWorkspace();
    state.loadManifest();
  }
});

electronAPI.onChatMessage((message: ChatMessage) => {
  useAppStore.setState((state) => {
    // System messages include: thinking indicators and tool call status
    if (message.role === 'system') {
      if (message.toolCall) {
        // Tool call message - update or add
        const existingIndex = state.messages.findIndex(
          (m) => m.toolCall && m.toolCall.id === message.toolCall!.id
        );
        if (existingIndex >= 0) {
          const updatedMessages = [...state.messages];
          updatedMessages[existingIndex] = message;
          return { messages: updatedMessages, isAgentThinking: true };
        }
        return { messages: [...state.messages, message], isAgentThinking: true };
      }
      // Thinking indicator message - add to messages list
      return {
        messages: [...state.messages, message],
        isAgentThinking: true,
      };
    }
    // For assistant messages, add to messages and clear thinking state
    if (message.role === 'assistant') {
      return {
        messages: [...state.messages, message],
        isAgentThinking: false,
      };
    }
    return state;
  });
});
