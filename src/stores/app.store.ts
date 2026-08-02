import { create } from 'zustand';
import type {
  Project,
  ProjectIndex,
  ChatMessage,
  Artifact,
  ArtifactRef,
} from '../shared/ipc.types';

interface AppState {
  projects: ProjectIndex;
  currentProject: Project | null;
  messages: ChatMessage[];
  isAgentThinking: boolean;
  currentPage: 'home' | 'project' | 'settings';
  artifacts: Artifact[];
  /** Artifacts the user clicked on the canvas - attached to the next message */
  referencedArtifacts: ArtifactRef[];

  setProjects: (projects: ProjectIndex) => void;
  setCurrentProject: (project: Project | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setAgentThinking: (isAgentThinking: boolean) => void;
  setCurrentPage: (page: 'home' | 'project' | 'settings') => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  addArtifact: (artifact: Artifact) => void;
  updateArtifactContent: (id: string, content: string) => void;
  addArtifactReference: (ref: ArtifactRef) => void;
  removeArtifactReference: (id: string) => void;

  loadProjects: () => Promise<void>;
  createProject: (name: string, folderPath: string) => Promise<Project>;
  selectProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatMessage['attachments']) => Promise<void>;
  loadChatHistory: () => Promise<void>;
}

const electronAPI = window.electronAPI;

// Artifacts are keyed by their source file: re-pushing the same path updates
// the existing entry in place (keeping its id, so canvas elements stay linked
// and simply re-render) instead of stacking duplicate cards.
function upsertArtifact(list: Artifact[], artifact: Artifact): Artifact[] {
  if (!artifact.path) return [...list, artifact];
  const index = list.findIndex((a) => a.path === artifact.path);
  if (index === -1) return [...list, artifact];
  const next = [...list];
  next[index] = { ...artifact, id: list[index].id };
  return next;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: { projects: [] },
  currentProject: null,
  messages: [],
  isAgentThinking: false,
  currentPage: 'home',
  artifacts: [],
  referencedArtifacts: [],

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setAgentThinking: (isAgentThinking) => set({ isAgentThinking }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  setArtifacts: (artifacts) => set({ artifacts }),
  addArtifact: (artifact) => set((state) => ({ artifacts: upsertArtifact(state.artifacts, artifact) })),
  // Keep the copy inside chat messages in sync so reload-independent views agree
  updateArtifactContent: (id, content) =>
    set((state) => ({
      artifacts: state.artifacts.map((a) => (a.id === id ? { ...a, content } : a)),
      messages: state.messages.map((m) =>
        m.artifact?.id === id ? { ...m, artifact: { ...m.artifact, content } } : m,
      ),
    })),

  // Dedup by id - re-clicking the same canvas card must not stack chips
  addArtifactReference: (ref) =>
    set((state) =>
      state.referencedArtifacts.some((r) => r.id === ref.id)
        ? state
        : { referencedArtifacts: [...state.referencedArtifacts, ref] },
    ),
  removeArtifactReference: (id) =>
    set((state) => ({
      referencedArtifacts: state.referencedArtifacts.filter((r) => r.id !== id),
    })),

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
      referencedArtifacts: [],
      currentPage: 'project',
    });
    await get().loadChatHistory();
    // Restore artifacts from artifact-type messages in chat history
    // (same file may have been pushed multiple times - keep one card per path)
    const { messages } = get();
    const restoredArtifacts = messages
      .filter((m) => m.artifact)
      .reduce<Artifact[]>((list, m) => upsertArtifact(list, m.artifact!), []);
    if (restoredArtifacts.length > 0) {
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
    const { currentProject, referencedArtifacts } = get();
    if (!currentProject) return;

    const message: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments,
      artifactRefs: referencedArtifacts.length > 0 ? referencedArtifacts : undefined,
    };

    set((state) => ({
      messages: [...state.messages, message],
      isAgentThinking: true,
      referencedArtifacts: [],
    }));

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
          artifacts: upsertArtifact(state.artifacts, message.artifact),
        };
      }
      return { messages: nextMessages };
    }
    return state;
  });
});

// Turn-end signal from the main process - clears the thinking indicator
electronAPI?.onTurnEnd?.(() => {
  useAppStore.setState({ isAgentThinking: false });
});

// Subscribe to artifact push events
electronAPI?.onArtifact?.((artifact: Artifact) => {
  useAppStore.setState((state) => ({
    artifacts: upsertArtifact(state.artifacts, artifact),
  }));
});
