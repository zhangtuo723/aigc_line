import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels'
import type { SaveAppSettingsRequest, TestGoogleAiConnectionRequest, TestQwenConnectionRequest } from '../../../src/shared/ipc.types'
import {
  getAppSettingsView,
  saveAppSettings,
  testComfyUIConnection,
  testGoogleAiConnection,
  testQwenConnection,
} from '../services/settings.service'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.settings.get, () => getAppSettingsView())
  ipcMain.handle(
    IPC_CHANNELS.settings.save,
    (_event, request: SaveAppSettingsRequest) => saveAppSettings(request),
  )
  ipcMain.handle(
    IPC_CHANNELS.settings.testComfyUI,
    (_event, baseUrl: string) => testComfyUIConnection(baseUrl),
  )
  ipcMain.handle(
    IPC_CHANNELS.settings.testQwen,
    (_event, request: TestQwenConnectionRequest) => testQwenConnection(request),
  )
  ipcMain.handle(
    IPC_CHANNELS.settings.testGoogleAi,
    (_event, request: TestGoogleAiConnectionRequest) => testGoogleAiConnection(request),
  )
}
