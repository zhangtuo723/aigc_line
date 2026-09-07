import type { ProjectAgentConfig } from '../shared/agent-config';
import { create } from 'zustand';
import { mergeChatHistory, mergeChatReferences, upsertChatMessage } from '../shared/chat-state';
import { beginEditBarrier, flushPendingEdits } from '../shared/pending-edits';
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
  createProject: (name: string, folderPath: string, agent?: ProjectAgentConfig) => Promise<Project>;
  selectProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatMessage['attachments']) => Promise<void>;
  sendScopedAgentMessage: (content: string, nodeRefs: CanvasNodeRef[]) => Promise<void>;
  loadChatHistory: () => Promise<void>;
}

const electronAPI = window.electronAPI;
let projectSelectionSequence = 0;
let chatHistorySequence = 0;
const agentRuntimeSequence = new Map<string, number>();

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
  setCurrentProject: (currentProject) => {
    projectSelectionSequence += 1;
    chatHistorySequence += 1;
    set({ currentProject });
  },
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: upsertChatMessage(state.messages, message) })),
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

  createProject: async (name, folderPath, agent) => {
    const project = await electronAPI.createProject(name, folderPath, agent);
    await get().loadProjects();
    await get().selectProject(project.id);
    return project;
  },

  selectProject: async (id) => {
    const release = beginEditBarrier();
    try {
    const selectionSequence = ++projectSelectionSequence;
    chatHistorySequence += 1;
    await flushPendingEdits();
    if (selectionSequence !== projectSelectionSequence) return;
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
      set((state) => ({ artifacts: state.artifacts.reduce(upsertArtifact, restoredArtifacts) }));
    }
    } finally { release(); }
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
    const requestSequence = ++chatHistorySequence;
    const selectionSequence = projectSelectionSequence;
    const beforeLoad = new Map(get().messages.map((message) => [message.id, message]));
    const isCurrent = () => get().currentProject?.id === projectId
      && chatHistorySequence === requestSequence && projectSelectionSequence === selectionSequence;
    try {
      const history = await electronAPI.loadChatHistory(currentProject.folderPath);
      if (!isCurrent()) return;
      set((state) => ({ messages: mergeChatHistory(history, state.messages, beforeLoad), chatHistoryError: null }));
    } catch (err) {
      console.error('Failed to load chat history:', err);
      if (!isCurrent()) return;
      set({
        chatHistoryError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  sendChatMessage: async (content, attachments) => {
    const { currentProject, referencedArtifacts, referencedCanvasNodes } = get();
    if (!currentProject) throw new Error('当前项目不可用');
    const selectionSequence = projectSelectionSequence;
    const wasThinking = !!get().agentThinkingByProject[currentProject.id];
    const runtimeSequence = agentRuntimeSequence.get(currentProject.id);

    const message: ChatMessage = {
      deliveryStatus: currentProject.agent?.provider === 'codex' ? 'queued' : undefined,
      id: `user-${crypto.randomUUID()}`,
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
        ...(agentRuntimeSequence.get(currentProject.id) === runtimeSequence ? { agentThinkingByProject: {
          ...state.agentThinkingByProject,
          [currentProject.id]: wasThinking,
        } } : {}),
        ...(state.currentProject?.id === currentProject.id && projectSelectionSequence === selectionSequence
          ? {
              messages: state.messages.filter((item) => item.id !== message.id),
              referencedArtifacts: mergeChatReferences(state.referencedArtifacts, referencedArtifacts),
              referencedCanvasNodes: mergeChatReferences(state.referencedCanvasNodes, referencedCanvasNodes),
            }
          : {}),
      }));
      throw err;
    }
  },

  sendScopedAgentMessage: async (content, nodeRefs) => {
    const { currentProject, agentThinkingByProject } = get();
    if (!currentProject) throw new Error('当前项目不可用');
    if (agentThinkingByProject[currentProject.id]) throw new Error('Agent 正在处理其他任务，请等待当前回合结束');
    const selectionSequence = projectSelectionSequence;
    const runtimeSequence = agentRuntimeSequence.get(currentProject.id);
    const message: ChatMessage = {
      id: `user-${crypto.randomUUID()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
      nodeRefs,
    };
    set((state) => ({
      messages: [...state.messages, message],
      agentThinkingByProject: { ...state.agentThinkingByProject, [currentProject.id]: true },
    }));
    try {
      await electronAPI.sendChatMessage(currentProject.id, message);
    } catch (error) {
      set((state) => ({
        ...(agentRuntimeSequence.get(currentProject.id) === runtimeSequence
          ? { agentThinkingByProject: { ...state.agentThinkingByProject, [currentProject.id]: false } } : {}),
        ...(state.currentProject?.id === currentProject.id && projectSelectionSequence === selectionSequence
          ? { messages: state.messages.filter((item) => item.id !== message.id) }
          : {}),
      }));
      throw error;
    }
  },
}));

// Subscribe to push events once
electronAPI?.onChatMessage?.(({ projectId, message }: ProjectChatMessagePush) => {
  agentRuntimeSequence.set(projectId, (agentRuntimeSequence.get(projectId) ?? 0) + 1);
  useAppStore.setState((state) => {
    const isCurrentProject = state.currentProject?.id === projectId;
    const thinking = message.role === 'system' && message.event === 'context-cleared' ? false : true;
    const cancelled = message.role === 'user' && message.deliveryStatus === 'cancelled';
    const runtimeUpdate = cancelled || state.agentThinkingByProject[projectId] === thinking ? {} : {
      agentThinkingByProject: {
        ...state.agentThinkingByProject,
        [projectId]: thinking,
      },
    };
    if (!isCurrentProject) return Object.keys(runtimeUpdate).length ? runtimeUpdate : state;
    return {
      messages: upsertChatMessage(state.messages, message),
      ...(message.artifact ? { artifacts: upsertArtifact(state.artifacts, message.artifact) } : {}),
      ...runtimeUpdate,
    };
  });
});

// Turn-end signal from the main process - clears the thinking indicator
electronAPI?.onTurnEnd?.(({ projectId }: ProjectTurnEndPush) => {
  agentRuntimeSequence.set(projectId, (agentRuntimeSequence.get(projectId) ?? 0) + 1);
  useAppStore.setState((state) => state.agentThinkingByProject[projectId] === false ? state : ({
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
