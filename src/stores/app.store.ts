import { create } from 'zustand';
import type {
  Project,
  ProjectIndex,
  ChatMessage,
  Artifact,
  ArtifactRef,
  CanvasNodeRef,
  ProjectChatMessagePush,
  ProjectArtifactPush,
  ProjectTurnEndPush,
} from '../shared/ipc.types';

interface AppState {
  projects: ProjectIndex;
  currentProject: Project | null;
  messages: ChatMessage[];
  chatHistoryError: string | null;
  agentThinkingByProject: Record<string, boolean>;
  currentPage: 'home' | 'project' | 'settings';
  artifacts: Artifact[];
  /** Artifacts the user clicked on the canvas - attached to the next message */
  referencedArtifacts: ArtifactRef[];
  /** Canvas nodes attached to the next user message */
  referencedCanvasNodes: CanvasNodeRef[];

  setProjects: (projects: ProjectIndex) => void;
  setCurrentProject: (project: Project | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setCurrentPage: (page: 'home' | 'project' | 'settings') => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  addArtifact: (artifact: Artifact) => void;
  updateArtifactContent: (id: string, content: string) => void;
  addArtifactReference: (ref: ArtifactRef) => void;
  removeArtifactReference: (id: string) => void;
  addCanvasNodeReference: (ref: CanvasNodeRef) => void;
  removeCanvasNodeReference: (id: string) => void;

  loadProjects: (options?: { restoreLastOpened?: boolean }) => Promise<void>;
  createProject: (name: string, folderPath: string) => Promise<Project>;
  selectProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatMessage['attachments']) => Promise<void>;
  loadChatHistory: () => Promise<void>;
}

const electronAPI = window.electronAPI;
let projectSelectionSequence = 0;

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
  chatHistoryError: null,
  agentThinkingByProject: {},
  currentPage: 'home',
  artifacts: [],
  referencedArtifacts: [],
  referencedCanvasNodes: [],

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (currentProject) => set({ currentProject }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
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
  addCanvasNodeReference: (ref) =>
    set((state) =>
      state.referencedCanvasNodes.some((item) => item.id === ref.id)
        ? state
        : { referencedCanvasNodes: [...state.referencedCanvasNodes, ref] },
    ),
  removeCanvasNodeReference: (id) =>
    set((state) => ({
      referencedCanvasNodes: state.referencedCanvasNodes.filter((item) => item.id !== id),
    })),

  loadProjects: async (options) => {
    const projects = await electronAPI.listProjects();
    set({ projects });
    // Only restore navigation during app startup. Refreshing the list after a
    // delete/create must not unexpectedly leave the home page.
    if (options?.restoreLastOpened && projects.lastOpenedId) {
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
    const selectionSequence = ++projectSelectionSequence;
    const project = await electronAPI.loadProject(id);
    if (!project || selectionSequence !== projectSelectionSequence) return;
    set({
      currentProject: project,
      messages: [],
      chatHistoryError: null,
      artifacts: [],
      referencedArtifacts: [],
      referencedCanvasNodes: [],
      currentPage: 'project',
    });
    await get().loadChatHistory();
    if (
      selectionSequence !== projectSelectionSequence
      || get().currentProject?.id !== project.id
    ) return;
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
      projectSelectionSequence += 1;
      set({
        currentProject: null,
        messages: [],
        artifacts: [],
        referencedArtifacts: [],
        referencedCanvasNodes: [],
        agentThinkingByProject: {
          ...state.agentThinkingByProject,
          [id]: false,
        },
      });
    }
    await get().loadProjects();
  },

  loadChatHistory: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    const projectId = currentProject.id;
    try {
      const history = await electronAPI.loadChatHistory(currentProject.folderPath);
      if (get().currentProject?.id !== projectId) return;
      set({ messages: history, chatHistoryError: null });
    } catch (err) {
      console.error('Failed to load chat history:', err);
      if (get().currentProject?.id !== projectId) return;
      set({
        messages: [],
        chatHistoryError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  sendChatMessage: async (content, attachments) => {
    const { currentProject, referencedArtifacts, referencedCanvasNodes } = get();
    if (!currentProject) return;

    const message: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments,
      artifactRefs: referencedArtifacts.length > 0 ? referencedArtifacts : undefined,
      nodeRefs: referencedCanvasNodes.length > 0 ? referencedCanvasNodes : undefined,
    };

    set((state) => ({
      messages: [...state.messages, message],
      agentThinkingByProject: {
        ...state.agentThinkingByProject,
        [currentProject.id]: true,
      },
      referencedArtifacts: [],
      referencedCanvasNodes: [],
    }));

    try {
      await electronAPI.sendChatMessage(currentProject.id, message);
    } catch (err) {
      set((state) => ({
        agentThinkingByProject: {
          ...state.agentThinkingByProject,
          [currentProject.id]: false,
        },
        ...(state.currentProject?.id === currentProject.id
          ? {
              messages: state.messages.filter((item) => item.id !== message.id),
              referencedArtifacts,
              referencedCanvasNodes,
            }
          : {}),
      }));
      throw err;
    }
  },
}));

// Subscribe to push events once
electronAPI?.onChatMessage?.(({ projectId, message }: ProjectChatMessagePush) => {
  useAppStore.setState((state) => {
    const isCurrentProject = state.currentProject?.id === projectId;
    const thinking = message.role === 'system' && message.event === 'context-cleared' ? false : true;
    const runtimeUpdate = {
      agentThinkingByProject: {
        ...state.agentThinkingByProject,
        [projectId]: thinking,
      },
    };
    if (!isCurrentProject) return runtimeUpdate;
    // System messages include: thinking indicators and tool call status
    if (message.role === 'system') {
      if (message.event === 'context-cleared') {
        return {
          messages: [...state.messages, message],
          ...runtimeUpdate,
        };
      }
      if (message.toolCall) {
        // Tool call message - update or add
        const existingIndex = state.messages.findIndex(
          (m) => m.toolCall && m.toolCall.id === message.toolCall!.id
        );
        if (existingIndex >= 0) {
          const updatedMessages = [...state.messages];
          updatedMessages[existingIndex] = message;
          return { messages: updatedMessages, ...runtimeUpdate };
        }
        return { messages: [...state.messages, message], ...runtimeUpdate };
      }
      // Thinking indicator message - add to messages list
      return {
        messages: [...state.messages, message],
        ...runtimeUpdate,
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
          ...runtimeUpdate,
        };
      }
      return { messages: nextMessages, ...runtimeUpdate };
    }
    return state;
  });
});

// Turn-end signal from the main process - clears the thinking indicator
electronAPI?.onTurnEnd?.(({ projectId }: ProjectTurnEndPush) => {
  useAppStore.setState((state) => ({
    agentThinkingByProject: {
      ...state.agentThinkingByProject,
      [projectId]: false,
    },
  }));
});

// Subscribe to artifact push events
electronAPI?.onArtifact?.(({ projectId, artifact }: ProjectArtifactPush) => {
  useAppStore.setState((state) =>
    state.currentProject?.id === projectId
      ? { artifacts: upsertArtifact(state.artifacts, artifact) }
      : state,
  );
});
