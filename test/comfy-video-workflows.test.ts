import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type WorkflowNode = {
  class_type: string
  inputs: Record<string, unknown>
}

describe('MiniMax H3 accelerated reference workflow', () => {
  it('routes the scheduler and guider through the 8-step Turbo LoRA', () => {
    const workflowPath = path.join(
      process.cwd(),
      'resources',
      'comfyui-workflows',
      'video_minimax_h3_r2v_turbo.json',
    )
    const workflow = JSON.parse(readFileSync(workflowPath, 'utf8')) as Record<string, WorkflowNode>

    expect(workflow['139']).toMatchObject({
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        lora_name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
        strength_model: 1,
        model: ['127', 0],
      },
    })
    expect(workflow['124'].inputs).toMatchObject({ steps: 8, model: ['139', 0] })
    expect(workflow['126'].inputs.model).toEqual(['139', 0])
    expect(workflow['136'].class_type).toBe('MiniMaxH3ReferenceToVideo')
  })
})
