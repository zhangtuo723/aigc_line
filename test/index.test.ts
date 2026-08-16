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
import { parseChatEventLog, replayChatEvents } from '../src/shared/chat-event-log'
import {
  resolveVideoReviewRequest,
} from '../electron/main/services/qwen-video-review.service'
import {
  resolveAnalysisVideoInput,
  validatePublicVideoUrl,
} from '../electron/main/services/qwen-video-analysis.service'
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
      id: 'image-1',
      type: 'storyNode',
      position: { x: 10, y: 20 },
      data: {
        kind: 'image',
        title: '镜头 1 · 图片',
        prompt: '完整图片提示词',
        sourcePath: 'generated/images/image-1.png',
        preview: 'data:image/png;base64,very-large-payload',
        generationStatus: 'idle',
      },
    },
    {
      id: 'video-1',
      type: 'storyNode',
      position: { x: 30, y: 40 },
      data: { kind: 'video', title: '镜头 1 · 视频', prompt: '完整视频提示词' },
    },
  ]
  const edges: CanvasEdgeSnapshot[] = [
    { id: 'edge-1', source: 'image-1', target: 'video-1' },
  ]

  it('returns a compact canvas overview without revisions or long node fields', () => {
    const overview = buildCanvasOverview(nodes, edges)

    expect(overview).toMatchObject({
      nodeCount: 2,
      edgeCount: 1,
      countsByKind: { image: 1, video: 1 },
      nodes: [
        { id: 'image-1', kind: 'image', title: '镜头 1 · 图片', generationStatus: 'idle', hasOutput: true },
        { id: 'video-1', kind: 'video', title: '镜头 1 · 视频', hasOutput: false },
      ],
    })
    expect(overview).not.toHaveProperty('revision')
    expect(JSON.stringify(overview)).not.toContain('完整图片提示词')
    expect(JSON.stringify(overview)).not.toContain('generated/images/image-1.png')
    expect(JSON.stringify(overview)).not.toContain('position')
  })

  it('returns one full node with compact incoming and outgoing connections', () => {
    const detail = buildCanvasNodeDetail(nodes, edges, 'video-1')

    expect(detail).toMatchObject({
      id: 'video-1',
      position: { x: 30, y: 40 },
      data: {
        prompt: '完整视频提示词',
      },
      incomingConnections: [{
        edgeId: 'edge-1',
        nodeId: 'image-1',
        kind: 'image',
        title: '镜头 1 · 图片',
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
      nodeRefs: [{ id: 'image-1', title: '镜头 1 · 图片', kind: 'image' }],
    }, 'E:\\workspace')

    expect(prompt.startsWith('/aigc-canvas:storyboard-production ')).toBe(true)
    expect(prompt).toContain('nodeId="image-1"')
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

describe('append-only chat event log', () => {
  const created = {
    version: 1 as const,
    seq: 1,
    type: 'message.created' as const,
    message: { id: 'tool-1', role: 'system' as const, content: '运行中', timestamp: 1 },
  }
  const replaced = {
    version: 1 as const,
    seq: 2,
    type: 'message.replaced' as const,
    messageId: 'tool-1',
    message: { id: 'tool-1', role: 'system' as const, content: '已完成', timestamp: 2 },
  }

  it('replays create and replace events', () => {
    const parsed = parseChatEventLog(`${JSON.stringify(created)}\n${JSON.stringify(replaced)}\n`)
    expect(replayChatEvents(parsed.events)).toEqual([replaced.message])
    expect(parsed.ignoredIncompleteTail).toBe(false)
  })

  it('ignores only a malformed final line', () => {
    const parsed = parseChatEventLog(`${JSON.stringify(created)}\n{"version":1`)
    expect(replayChatEvents(parsed.events)).toEqual([created.message])
    expect(parsed.ignoredIncompleteTail).toBe(true)
  })

  it('rejects corruption in the middle of the log', () => {
    expect(() => parseChatEventLog(`${JSON.stringify(created)}\nnot-json\n${JSON.stringify(replaced)}\n`))
      .toThrow('第 2 行损坏')
  })
})

describe('storyboard video review', () => {
  it('resolves an image id to its generated video and reference image', () => {
    const state: CanvasStateSnapshot = {
      revision: 1,
      nodeCount: 2,
      edgeCount: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'image-1', type: 'storyNode', position: { x: 100, y: 0 }, data: { kind: 'image', title: '角色参考', sourcePath: 'generated/images/shot-1.png' } },
        { id: 'video-1', type: 'storyNode', position: { x: 200, y: 0 }, data: { kind: 'video', title: '镜头 1 视频', prompt: '主角进入房间并说你好', sourcePath: 'generated/videos/shot-1.mp4', referenceImageNodeIds: ['image-1'] } },
      ],
      edges: [
        { id: 'edge-1', source: 'image-1', target: 'video-1' },
      ],
    }

    const request = resolveVideoReviewRequest(state, 'image-1')
    expect(request.videoNodeId).toBe('video-1')
    expect(request.sourcePath).toBe('generated/videos/shot-1.mp4')
    expect(request.referenceMedia).toEqual([expect.objectContaining({
      kind: 'image',
      label: '<Picture 1>',
      nodeId: 'image-1',
      sourcePath: 'generated/images/shot-1.png',
    })])
    expect(request.expectedContent).toContain('主角进入房间并说你好')
  })

  it('preserves multimodal reference numbering and fails on missing generated media', () => {
    const state: CanvasStateSnapshot = {
      revision: 1,
      nodeCount: 3,
      edgeCount: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'image-1', type: 'storyNode', position: { x: 1, y: 0 }, data: { kind: 'image', title: '人物', sourcePath: 'images/person.png' } },
        { id: 'audio-1', type: 'storyNode', position: { x: 2, y: 0 }, data: { kind: 'audio', title: '对白', sourcePath: 'audio/dialogue.wav' } },
        { id: 'video-1', type: 'storyNode', position: { x: 3, y: 0 }, data: { kind: 'video', title: '成片', sourcePath: 'videos/result.mp4', referenceImageNodeIds: ['image-1'], referenceAudioNodeIds: ['audio-1'] } },
      ],
      edges: [
        { id: 'e1', source: 'image-1', target: 'video-1' },
        { id: 'e2', source: 'audio-1', target: 'video-1' },
      ],
    }

    const request = resolveVideoReviewRequest(state, 'video-1')
    expect(request.referenceMedia?.map((item) => item.label)).toEqual(['<Picture 1>', '<Audio 1>'])
    state.nodes[0].data.sourcePath = undefined
    expect(() => resolveVideoReviewRequest(state, 'video-1')).toThrow('Picture 1')
  })

})

describe('general video analysis input', () => {
  it('accepts project-local video paths and public URLs', () => {
    expect(resolveAnalysisVideoInput('C:/projects/demo', 'generated/videos/a.mp4')).toEqual({
      kind: 'local',
      filePath: expect.stringMatching(/[\\/]projects[\\/]demo[\\/]generated[\\/]videos[\\/]a\.mp4$/),
    })
    expect(validatePublicVideoUrl('https://cdn.example.com/video.mp4')).toBe('https://cdn.example.com/video.mp4')
  })

  it('rejects project escapes and explicit private network URLs', () => {
    expect(() => resolveAnalysisVideoInput('C:/projects/demo', '../secret.mp4')).toThrow('项目目录内')
    expect(() => validatePublicVideoUrl('http://127.0.0.1/video.mp4')).toThrow('私有网络')
    expect(() => validatePublicVideoUrl('http://192.168.1.2/video.mp4')).toThrow('私有网络')
    expect(() => resolveAnalysisVideoInput('C:/projects/demo', 'file:///C:/video.mp4')).toThrow('只支持')
  })
})
