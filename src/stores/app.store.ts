import { create } from 'zustand';
import type {
  Project,
  ProjectIndex,
  ChatMessage,
} from '../shared/ipc.types';

interface AppState {
  projects: ProjectIndex;
  currentProject: Project | null;
  messages: ChatMessage[];
  isAgentThinking: boolean;
  currentPage: 'home' | 'project';

  setProjects: (projects: ProjectIndex) => void;
  setCurrentProject: (project: Project | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setAgentThinking: (isAgentThinking: boolean) => void;
  setCurrentPage: (page: 'home' | 'project') => void;

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

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setAgentThinking: (isAgentThinking) => set({ isAgentThinking }),
  setCurrentPage: (currentPage) => set({ currentPage }),

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
      currentPage: 'project',
    });
    await get().loadChatHistory();
  },

  deleteProject: async (id) => {
    await electronAPI.deleteProject(id);
    const state = get();
    if (state.currentProject?.id === id) {
      set({ currentProject: null, messages: [] });
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
