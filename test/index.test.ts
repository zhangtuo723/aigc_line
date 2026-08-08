import { describe, it, expect } from 'vitest'
import { buildUserPrompt } from '../electron/main/services/agent/prompts'
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
    expect(prompt).toContain('GetCanvasState')
    expect(prompt).toContain('UpdateCanvasNodes')
    expect(prompt).toContain('把提示词改成夜景')
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
