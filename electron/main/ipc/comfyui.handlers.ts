import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels'
import type {
  GenerateImageRequest,
  GenerateImageResult,
  GenerateVideoRequest,
  GenerateVideoResult,
  UpscaleVideoRequest,
  UpscaleVideoResult,
} from '../../../src/shared/ipc.types'
import {
  generateImageWithComfyUI,
  generateVideoWithComfyUI,
  listComfyWorkflows,
  upscaleVideoWithComfyUI,
} from '../services/comfyui.service'
import { generateImageWithGoogle, isGoogleImageWorkflow } from '../services/google-image.service'
import { getRuntimeSettings } from '../services/settings.service'

export function registerComfyUIHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.comfyui.listWorkflows, () => listComfyWorkflows())
  ipcMain.handle(
    IPC_CHANNELS.comfyui.generateImage,
    async (_event, request: GenerateImageRequest): Promise<GenerateImageResult> => {
      try {
        const workflowId = request.workflowId || (await getRuntimeSettings()).defaultImageWorkflowId
        const resolvedRequest = { ...request, workflowId }
        return isGoogleImageWorkflow(workflowId)
          ? await generateImageWithGoogle(resolvedRequest)
          : await generateImageWithComfyUI(resolvedRequest)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.comfyui.generateVideo,
    async (_event, request: GenerateVideoRequest): Promise<GenerateVideoResult> => {
      try {
        return await generateVideoWithComfyUI(request)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.comfyui.upscaleVideo,
    async (_event, request: UpscaleVideoRequest): Promise<UpscaleVideoResult> => {
      try {
        return await upscaleVideoWithComfyUI(request)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )
}
