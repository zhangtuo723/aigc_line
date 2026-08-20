/**
 * Capability declarations for the built-in canvas node kinds.
 *
 * This is the single place that teaches the agent what each node can do.
 * When a new node kind is added, register it here (or in its own module that
 * is imported for side effects) and it immediately becomes visible to the
 * GetCanvasCapabilities / UpdateCanvasNodes / InvokeNodeAction tools.
 */
import type { ComfyWorkflowInfo } from '../shared/ipc.types'
import type { NodeFieldDescriptor } from '../shared/node-capabilities'
import { listCachedComfyWorkflows } from '../shared/comfy-workflows'
import {
  registerNodeCapabilities,
  registerOptionProvider,
  SHARED_FIELDS_KIND,
} from '../shared/node-capabilities'

const workflowOptions = async (kinds: ComfyWorkflowInfo['kind'][]) => {
  const workflows: ComfyWorkflowInfo[] = await listCachedComfyWorkflows()
  return workflows
    .filter((workflow) => kinds.includes(workflow.kind))
    .map((workflow) => ({ value: workflow.id, label: workflow.name }))
}

registerOptionProvider('comfy-image-workflows', () =>
  workflowOptions(['text-to-image']))
registerOptionProvider('comfy-video-workflows', () =>
  workflowOptions(['image-to-video']))

/** Read-only generation lifecycle fields shared by generative nodes. */
const generationStatusFields: NodeFieldDescriptor[] = [
  {
    key: 'generationStatus',
    type: 'enum',
    values: ['idle', 'generating', 'error'],
    readonly: true,
    description: '生成状态（只读）；异步动作的轮询字段',
  },
  { key: 'generationError', type: 'string', readonly: true, description: '最近一次生成的错误信息（只读）' },
  { key: 'preview', type: 'string', readonly: true, description: '预览地址（只读，由 sourcePath 自动派生）' },
  { key: 'sourceHistory', type: 'string-array', readonly: true, description: '历史生成结果路径（只读）' },
]

registerNodeCapabilities({
  kind: SHARED_FIELDS_KIND,
  label: '通用字段',
  fields: [
    { key: 'title', type: 'string', description: '节点标题' },
  ],
  actions: [],
})

registerNodeCapabilities({
  kind: 'image',
  label: '图片节点',
  fields: [
    { key: 'prompt', type: 'string', description: '图片生成提示词' },
    { key: 'aspectRatio', type: 'enum', values: ['16:9', '9:16', '1:1', '4:3'], description: '画幅比例' },
    {
      key: 'workflowId',
      type: 'enum',
      dynamicOptions: 'comfy-image-workflows',
      description: '图片生成模型或工作流（包含 ComfyUI、Nano Banana、Seedream；可选值见 options）',
    },
    { key: 'sourcePath', type: 'string', description: '生成结果的 workspace 相对路径' },
    { key: 'referenceImageNodeIds', type: 'string-array', description: '云端图片模型的有序参考图片节点 id（Google 最多 14 张，Seedream 最多 10 张；ComfyUI 文生图不使用）' },
    { key: 'readOnly', type: 'boolean', readonly: true, description: '是否为工具输出的只读图片节点（只读）' },
    ...generationStatusFields,
  ],
  actions: [
    {
      id: 'generate',
      label: '生成',
      async: true,
      statusField: 'generationStatus',
      description: '使用所选图片模型或工作流生成图片；Google/Seedream 可按 referenceImageNodeIds 使用多张参考图，ComfyUI 当前仅文生图；完成后结果路径写入 sourcePath',
    },
  ],
})

registerNodeCapabilities({
  kind: 'video',
  label: '视频节点',
  fields: [
    { key: 'prompt', type: 'string', description: '视频生成提示词' },
    { key: 'aspectRatio', type: 'enum', values: ['16:9', '9:16', '1:1', '4:3'], description: '画幅比例' },
    {
      key: 'workflowId',
      type: 'enum',
      dynamicOptions: 'comfy-video-workflows',
      description: '视频生成工作流（可选值见 options）',
    },
    { key: 'sourcePath', type: 'string', description: '生成结果的 workspace 相对路径' },
    { key: 'duration', type: 'number', numberValues: [5, 10, 15], description: '视频时长（秒），仅支持 5/10/15' },
    { key: 'firstFrameNodeId', type: 'string', description: '首帧图片节点 id（首尾帧工作流）' },
    { key: 'lastFrameNodeId', type: 'string', description: '尾帧图片节点 id（首尾帧工作流）' },
    { key: 'referenceImageNodeIds', type: 'string-array', description: '全模态参考图片节点 id（最多 9 个）' },
    { key: 'referenceVideoNodeIds', type: 'string-array', description: '全模态参考视频节点 id（最多 3 个）' },
    { key: 'referenceAudioNodeIds', type: 'string-array', description: '全模态参考音频节点 id（最多 3 个）' },
    ...generationStatusFields,
  ],
  actions: [
    {
      id: 'generate',
      label: '生成',
      async: true,
      statusField: 'generationStatus',
      description: '使用所选工作流生成视频，完成后结果路径写入 sourcePath',
    },
  ],
})

registerNodeCapabilities({
  kind: 'audio',
  label: '音频节点',
  fields: [
    { key: 'sourcePath', type: 'string', description: '音频文件的 workspace 相对路径' },
    { key: 'preview', type: 'string', readonly: true, description: '预览地址（只读，由 sourcePath 自动派生）' },
  ],
  actions: [],
})

registerNodeCapabilities({
  kind: 'upscale',
  label: '视频放大节点',
  fields: [
    { key: 'scale', type: 'number', numberValues: [2, 3, 4], description: '放大倍数，仅支持 2/3/4' },
    {
      key: 'quality',
      type: 'enum',
      values: ['FAST', 'MEDIUM', 'HIGH', 'ULTRA'],
      description: '放大质量（RTX Video Super Resolution）',
    },
    { key: 'sourcePath', type: 'string', description: '放大结果的 workspace 相对路径' },
    { key: 'inputNodeId', type: 'string', description: '输入视频节点 id（连入多个视频时用于指定其中一个）' },
    ...generationStatusFields,
  ],
  actions: [
    {
      id: 'generate',
      label: '放大',
      async: true,
      statusField: 'generationStatus',
      description: '对连入的视频节点执行 RTX 视频放大，完成后结果路径写入 sourcePath',
    },
  ],
})

registerNodeCapabilities({
  kind: 'director',
  label: '3D 导演台',
  fields: [
    { key: 'directorProject', type: 'object', description: '完整的可序列化 3D 预演工程：演员、道具、机位、Shot 与关键帧' },
    { key: 'sourcePath', type: 'string', readonly: true, description: '最近一次机位截图的项目相对路径（只读）' },
    { key: 'preview', type: 'string', readonly: true, description: '最近一次机位截图预览（只读）' },
  ],
  actions: [],
})
