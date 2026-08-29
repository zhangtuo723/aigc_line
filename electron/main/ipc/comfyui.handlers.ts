import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels'
import type {
  GenerateImageRequest,
  GenerateImageResult,
  GenerateVideoRequest,
  GenerateVideoResult,
  ExtractVideoAudioRequest,
  ExtractVideoAudioResult,
  UpscaleVideoRequest,
  UpscaleVideoResult,
} from '../../../src/shared/ipc.types'
import {
  generateImageWithComfyUI,
  generateVideoWithComfyUI,
  extractVideoAudioWithComfyUI,
  listComfyWorkflows,
  upscaleVideoWithComfyUI,
} from '../services/comfyui.service'
import { generateImageWithGoogle, isGoogleImageWorkflow } from '../services/google-image.service'
import { generateImageWithSeedream, isSeedreamImageWorkflow } from '../services/seedream-image.service'
import { generateVideoWithSeedance, isSeedanceVideoWorkflow } from '../services/seedance-video.service'
import { getRuntimeSettings } from '../services/settings.service'

export function registerComfyUIHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.comfyui.listWorkflows, () => listComfyWorkflows())
  ipcMain.handle(
    IPC_CHANNELS.comfyui.generateImage,
    async (_event, request: GenerateImageRequest): Promise<GenerateImageResult> => {
      try {
        const workflowId = request.workflowId || (await getRuntimeSettings()).defaultImageWorkflowId
        const resolvedRequest = { ...request, workflowId }
        if (isGoogleImageWorkflow(workflowId)) return await generateImageWithGoogle(resolvedRequest)
        if (isSeedreamImageWorkflow(workflowId)) return await generateImageWithSeedream(resolvedRequest)
        return await generateImageWithComfyUI(resolvedRequest)
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
        if (isSeedanceVideoWorkflow(request.workflowId)) return await generateVideoWithSeedance(request)
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
    IPC_CHANNELS.comfyui.extractVideoAudio,
    async (_event, request: ExtractVideoAudioRequest): Promise<ExtractVideoAudioResult> => {
      try {
        return await extractVideoAudioWithComfyUI(request)
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
