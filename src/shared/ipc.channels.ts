export const IPC_CHANNELS = {
  project: {
    create: 'project:create',
    list: 'project:list',
    load: 'project:load',
    delete: 'project:delete',
  },
  workspace: {
    scan: 'workspace:scan',
    validate: 'workspace:validate',
  },
  workflow: {
    run: 'workflow:run',
    cancel: 'workflow:cancel',
  },
  manifest: {
    read: 'manifest:read',
    updateScene: 'manifest:updateScene',
  },
  chat: {
    sendMessage: 'chat:sendMessage',
    receiveMessage: 'chat:receiveMessage',
    loadHistory: 'chat:loadHistory',
  },
  push: {
    progress: 'workflow:progress',
    complete: 'workflow:complete',
    changed: 'workspace:changed',
    chatMessage: 'chat:receiveMessage',
  },
} as const;

export type IpcChannel =
  | (typeof IPC_CHANNELS.project)[keyof typeof IPC_CHANNELS.project]
  | (typeof IPC_CHANNELS.workspace)[keyof typeof IPC_CHANNELS.workspace]
  | (typeof IPC_CHANNELS.workflow)[keyof typeof IPC_CHANNELS.workflow]
  | (typeof IPC_CHANNELS.manifest)[keyof typeof IPC_CHANNELS.manifest]
  | (typeof IPC_CHANNELS.chat)[keyof typeof IPC_CHANNELS.chat]
  | (typeof IPC_CHANNELS.push)[keyof typeof IPC_CHANNELS.push];
