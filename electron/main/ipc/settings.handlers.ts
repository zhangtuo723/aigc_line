import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels'
import type { SaveAppSettingsRequest } from '../../../src/shared/ipc.types'
import {
  getAppSettingsView,
  saveAppSettings,
  testComfyUIConnection,
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
}
