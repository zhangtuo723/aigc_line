export const IPC_CHANNELS = {
  project: {
    create: 'project:create',
    list: 'project:list',
    load: 'project:load',
    delete: 'project:delete',
  },
  chat: {
    sendMessage: 'chat:sendMessage',
    receiveMessage: 'chat:receiveMessage',
    loadHistory: 'chat:loadHistory',
  },
  canvas: {
    save: 'canvas:save',
    load: 'canvas:load',
  },
  artifact: {
    push: 'artifact:push',
  },
  push: {
    chatMessage: 'chat:receiveMessage',
    artifact: 'artifact:receive',
    turnEnd: 'chat:turnEnd',
  },
} as const;

export type IpcChannel =
  | (typeof IPC_CHANNELS.project)[keyof typeof IPC_CHANNELS.project]
  | (typeof IPC_CHANNELS.chat)[keyof typeof IPC_CHANNELS.chat]
  | (typeof IPC_CHANNELS.canvas)[keyof typeof IPC_CHANNELS.canvas]
  | (typeof IPC_CHANNELS.artifact)[keyof typeof IPC_CHANNELS.artifact]
  | (typeof IPC_CHANNELS.push)[keyof typeof IPC_CHANNELS.push];
