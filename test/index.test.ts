import { describe, it, expect } from 'vitest'
import { buildSystemPromptAppend, buildUserPrompt } from '../electron/main/services/agent/prompts'
import {
  createBuiltinPluginConfig,
  resolveBuiltinPluginPath,
} from '../electron/main/services/agent/builtin-plugin'
import {
  mergeDiscoveredSkills,
  parseSkillFrontmatter,
} from '../electron/main/services/agent/skill-metadata'
import {
  filterAvailableSkills,
  getSkillSearchQuery,
  makeSkillCommand,
} from '../src/shared/skill-command'
import { normalizeInterruptedToolCalls } from '../src/shared/tool-call-status'
import {
  resolveVideoReviewRequest,
} from '../electron/main/services/qwen-video-review.service'
import {
  buildCanvasNodeDetail,
  buildCanvasOverview,
} from '../src/shared/canvas-read-model'
import type {
  CanvasEdgeSnapshot,
  CanvasNodeSnapshot,
  CanvasStateSnapshot,
} from '../src/shared/ipc.types'

describe('vitest smoke', () => {
  it('runs a normal unit test', () => {
    expect(1 + 1).toBe(2)
  })

  it('has test mode enabled while running tests', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })
})

describe('canvas node references', () => {
  it('tells the agent to target the referenced live node by id', () => {
    const prompt = buildUserPrompt({
      id: 'message-1',
      role: 'user',
      content: '把提示词改成夜景',
      timestamp: 1,
      nodeRefs: [{ id: 'image-node-7', title: '镜头 7 · 图片', kind: 'image' }],
    }, 'E:\\workspace')

    expect(prompt).toContain('nodeId="image-node-7"')
    expect(prompt).toContain('GetCanvasNode')
    expect(prompt).not.toContain('GetCanvasOverview')
    expect(prompt).toContain('UpdateCanvasNodes')
    expect(prompt).toContain('最后写入者生效')
    expect(prompt).not.toContain('expectedRevision')
    expect(prompt).toContain('把提示词改成夜景')
  })

  it('describes canvas writes without global revision preconditions', () => {
    const prompt = buildSystemPromptAppend('E:\\workspace')

    expect(prompt).toContain('GetCanvasOverview')
    expect(prompt).toContain('GetCanvasNode')
    expect(prompt).toContain('最后写入者生效')
    expect(prompt).not.toContain('expectedRevision')
    expect(prompt).not.toContain('版本冲突')
  })
})

describe('canvas read models', () => {
  const nodes: CanvasNodeSnapshot[] = [
    {
      id: 'shot-1',
      type: 'storyNode',
      position: { x: 10, y: 20 },
      data: { kind: 'shot', title: '镜头 1', shotNumber: 1, scene: '很长的剧情详情' },
    },
    {
      id: 'image-1',
      type: 'storyNode',
      position: { x: 30, y: 40 },
      data: {
        kind: 'image',
        title: '镜头 1 · 图片',
        prompt: '完整图片提示词',
        sourcePath: 'generated/images/image-1.png',
        preview: 'data:image/png;base64,very-large-payload',
        generationStatus: 'idle',
      },
    },
  ]
  const edges: CanvasEdgeSnapshot[] = [
    { id: 'edge-1', source: 'shot-1', target: 'image-1' },
  ]

  it('returns a compact canvas overview without revisions or long node fields', () => {
    const overview = buildCanvasOverview(nodes, edges)

    expect(overview).toMatchObject({
      nodeCount: 2,
      edgeCount: 1,
      countsByKind: { shot: 1, image: 1 },
      nodes: [
        { id: 'shot-1', kind: 'shot', title: '镜头 1', shotNumber: 1, hasOutput: false },
        { id: 'image-1', kind: 'image', title: '镜头 1 · 图片', generationStatus: 'idle', hasOutput: true },
      ],
    })
    expect(overview).not.toHaveProperty('revision')
    expect(JSON.stringify(overview)).not.toContain('完整图片提示词')
    expect(JSON.stringify(overview)).not.toContain('generated/images/image-1.png')
    expect(JSON.stringify(overview)).not.toContain('position')
  })

  it('returns one full node with compact incoming and outgoing connections', () => {
    const detail = buildCanvasNodeDetail(nodes, edges, 'image-1')

    expect(detail).toMatchObject({
      id: 'image-1',
      position: { x: 30, y: 40 },
      data: {
        prompt: '完整图片提示词',
        sourcePath: 'generated/images/image-1.png',
        preview: '[inline preview omitted]',
      },
      incomingConnections: [{
        edgeId: 'edge-1',
        nodeId: 'shot-1',
        kind: 'shot',
        title: '镜头 1',
      }],
      outgoingConnections: [],
    })
  })
})

describe('built-in Claude plugin', () => {
  it('loads from repository resources during development', () => {
    expect(resolveBuiltinPluginPath({
      isPackaged: false,
      appPath: 'E:\\app',
      resourcesPath: 'E:\\release\\resources',
    })).toBe('E:\\app\\resources\\claude-plugin')
  })

  it('loads from Electron resources in packaged builds', () => {
    const pluginPath = resolveBuiltinPluginPath({
      isPackaged: true,
      appPath: 'E:\\app',
      resourcesPath: 'E:\\release\\resources',
    })

    expect(pluginPath).toBe('E:\\release\\resources\\claude-plugin')
    expect(createBuiltinPluginConfig(pluginPath)).toEqual({
      type: 'local',
      path: pluginPath,
      skipMcpDiscovery: true,
    })
  })
})

describe('skill slash commands', () => {
  it('recognizes only a leading slash token as a skill search', () => {
    expect(getSkillSearchQuery('/')).toBe('')
    expect(getSkillSearchQuery('/story')).toBe('story')
    expect(getSkillSearchQuery('/story more')).toBeNull()
    expect(getSkillSearchQuery('use /story')).toBeNull()
  })

  it('filters skills and creates the selected command', () => {
    const skills = [{
      name: 'aigc-canvas:storyboard-production',
      description: 'Create short-drama shots',
      source: 'builtin' as const,
    }]
    expect(filterAvailableSkills(skills, 'story')).toEqual(skills)
    expect(makeSkillCommand(skills[0].name)).toBe('/aigc-canvas:storyboard-production ')
  })

  it('parses skill metadata used by the menu', () => {
    expect(parseSkillFrontmatter(
      '---\nname: test-skill\ndescription: "测试技能"\nargument-hint: <topic>\n---\n',
      'fallback',
    )).toEqual({
      name: 'test-skill',
      description: '测试技能',
      argumentHint: '<topic>',
    })
  })

  it('does not expose SDK control commands as skills', () => {
    const discovered = [{
      name: 'aigc-canvas:storyboard-production',
      description: '本地描述',
      source: 'builtin' as const,
    }]
    const merged = mergeDiscoveredSkills(discovered, [
      { name: 'clear', description: 'Clear context', argumentHint: '' },
      {
        name: 'aigc-canvas:storyboard-production',
        description: 'SDK 描述',
        argumentHint: '<topic>',
      },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      name: 'aigc-canvas:storyboard-production',
      description: 'SDK 描述',
      argumentHint: '<topic>',
    })
  })

  it('keeps a selected skill command before node-reference context', () => {
    const prompt = buildUserPrompt({
      id: 'message-skill',
      role: 'user',
      content: '/aigc-canvas:storyboard-production 创建三个夜景镜头',
      timestamp: 1,
      nodeRefs: [{ id: 'shot-1', title: '镜头 1', kind: 'shot' }],
    }, 'E:\\workspace')

    expect(prompt.startsWith('/aigc-canvas:storyboard-production ')).toBe(true)
    expect(prompt).toContain('nodeId="shot-1"')
  })
})

describe('tool call status recovery', () => {
  it('marks stale persisted running calls as interrupted', () => {
    const result = normalizeInterruptedToolCalls([{
      id: 'tool-1',
      role: 'system',
      content: '正在执行: ConnectCanvasNodes',
      timestamp: 1,
      toolCall: {
        id: 'tool-1',
        toolName: 'ConnectCanvasNodes',
        toolInput: '{}',
        status: 'running',
      },
    }])

    expect(result.changed).toBe(true)
    expect(result.messages[0].toolCall).toMatchObject({
      status: 'interrupted',
      error: expect.stringContaining('上次工具调用未完成'),
    })
  })

  it('leaves terminal tool calls unchanged', () => {
    const messages = [{
      id: 'tool-2',
      role: 'system' as const,
      content: '已完成: Read',
      timestamp: 1,
      toolCall: {
        id: 'tool-2',
        toolName: 'Read',
        toolInput: '{}',
        status: 'completed' as const,
      },
    }]

    const result = normalizeInterruptedToolCalls(messages)
    expect(result.changed).toBe(false)
    expect(result.messages[0]).toBe(messages[0])
  })
})

describe('storyboard video review', () => {
  it('resolves a shot id to its generated video and reference image', () => {
    const state: CanvasStateSnapshot = {
      revision: 1,
      nodeCount: 3,
      edgeCount: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'shot-1', type: 'storyNode', position: { x: 0, y: 0 }, data: { kind: 'shot', title: '镜头 1', shotNumber: 1, scene: '主角进入房间' } },
        { id: 'image-1', type: 'storyNode', position: { x: 100, y: 0 }, data: { kind: 'image', title: '角色参考', sourcePath: 'generated/images/shot-1.png' } },
        { id: 'video-1', type: 'storyNode', position: { x: 200, y: 0 }, data: { kind: 'video', title: '镜头 1 视频', prompt: '主角进入房间并说你好', sourcePath: 'generated/videos/shot-1.mp4', referenceImageNodeIds: ['image-1'] } },
      ],
      edges: [
        { id: 'edge-1', source: 'shot-1', target: 'image-1' },
        { id: 'edge-2', source: 'image-1', target: 'video-1' },
      ],
    }

    const request = resolveVideoReviewRequest(state, 'shot-1')
    expect(request.videoNodeId).toBe('video-1')
    expect(request.sourcePath).toBe('generated/videos/shot-1.mp4')
    expect(request.referenceImagePaths).toEqual(['generated/images/shot-1.png'])
    expect(request.relatedShotNodeIds).toEqual(['shot-1'])
    expect(request.expectedContent).toContain('主角进入房间并说你好')
  })

})
