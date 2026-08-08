import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../../../../src/shared/ipc.channels';
import type {
  CanvasCommandAction,
  CanvasCommandRequest,
  CanvasCommandResponse,
} from '../../../../src/shared/ipc.types';

const COMMAND_TIMEOUT_MS = 10_000;

interface PendingCommand {
  resolve: (response: CanvasCommandResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingCommands = new Map<string, PendingCommand>();

export function resolveCanvasCommand(response: CanvasCommandResponse): void {
  const pending = pendingCommands.get(response.requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingCommands.delete(response.requestId);
  pending.resolve(response);
}

export async function sendCanvasCommand(
  projectId: string,
  action: CanvasCommandAction,
  payload: unknown = {},
): Promise<CanvasCommandResponse> {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.length === 0) throw new Error('画布窗口尚未打开');

  const request: CanvasCommandRequest = {
    requestId: randomUUID(),
    projectId,
    action,
    payload,
  };

  const response = await new Promise<CanvasCommandResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(request.requestId);
      reject(new Error('等待画布响应超时，请确认项目画布处于打开状态'));
    }, COMMAND_TIMEOUT_MS);
    pendingCommands.set(request.requestId, { resolve, reject, timer });
    for (const window of windows) {
      window.webContents.send(IPC_CHANNELS.push.canvasCommand, request);
    }
  });

  if (!response.success) throw new Error(response.error || '画布命令执行失败');
  return response;
}
