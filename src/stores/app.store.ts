import { create } from 'zustand';
import type {
  Project,
  ProjectIndex,
  ChatMessage,
  Artifact,
} from '../shared/ipc.types';

interface AppState {
  projects: ProjectIndex;
  currentProject: Project | null;
  messages: ChatMessage[];
  isAgentThinking: boolean;
  currentPage: 'home' | 'project';
  artifacts: Artifact[];

  setProjects: (projects: ProjectIndex) => void;
  setCurrentProject: (project: Project | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setAgentThinking: (isAgentThinking: boolean) => void;
  setCurrentPage: (page: 'home' | 'project') => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  addArtifact: (artifact: Artifact) => void;

  loadProjects: () => Promise<void>;
  createProject: (name: string, folderPath: string) => Promise<Project>;
  selectProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatMessage['attachments']) => Promise<void>;
  loadChatHistory: () => Promise<void>;
}

const electronAPI = window.electronAPI;

export const useAppStore = create<AppState>((set, get) => ({
  projects: { projects: [] },
  currentProject: null,
  messages: [],
  isAgentThinking: false,
  currentPage: 'home',
  artifacts: [],

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setAgentThinking: (isAgentThinking) => set({ isAgentThinking }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  setArtifacts: (artifacts) => set({ artifacts }),
  addArtifact: (artifact) => set((state) => ({ artifacts: [...state.artifacts, artifact] })),

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
      messages: [],
      artifacts: [],
      currentPage: 'project',
    });
    await get().loadChatHistory();
    // Restore artifacts from artifact-type messages in chat history
    const { messages } = get();
    const artifactMsgs = messages.filter((m) => m.artifact);
    if (artifactMsgs.length > 0) {
      const restoredArtifacts = artifactMsgs.map((m) => m.artifact!);
      set({ artifacts: restoredArtifacts });
    }
  },

  deleteProject: async (id) => {
    await electronAPI.deleteProject(id);
    const state = get();
    if (state.currentProject?.id === id) {
      set({ currentProject: null, messages: [], artifacts: [] });
    }
    await get().loadProjects();
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
electronAPI?.onChatMessage?.((message: ChatMessage) => {
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
    // For assistant messages, append them; thinking state is cleared only by the
    // turn-end signal from the main process, since a turn may continue with tool calls
    if (message.role === 'assistant') {
      const nextMessages = [...state.messages, message];
      // If this assistant message contains an artifact, also add to artifacts
      if (message.artifact) {
        return {
          messages: nextMessages,
          artifacts: [...state.artifacts, message.artifact],
        };
      }
      return { messages: nextMessages };
    }
    return state;
  });
});

// Turn-end signal from the main process - clears the thinking indicator
electronAPI.onTurnEnd(() => {
  useAppStore.setState({ isAgentThinking: false });
});

// Subscribe to artifact push events
electronAPI.onArtifact((artifact: Artifact) => {
  useAppStore.setState((state) => ({
    artifacts: [...state.artifacts, artifact],
  }));
});
