import path from 'node:path';
import fs from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import log from 'electron-log/main';
import type { ChatMessage } from '../../../src/shared/ipc.types';
import { scanWorkspace } from './workspace.watcher';
import { loadProject } from './project.store';
import { runWorkflow } from '../ipc/workflow.handlers';

const AGENT_SYSTEM_PROMPT = `You are AIGC Line Agent, a helpful assistant that helps users create storyboard videos from audio and subtitle files.

Your capabilities:
1. Parse SRT subtitle files and MP3 audio files from the workspace
2. Generate scene prompts for each subtitle cue using AI
3. Generate storyboard images using ComfyUI
4. Assemble the final video using Hyperframes

When the user uploads files or asks to generate a video, you should:
1. Confirm what files were detected
2. Explain the workflow steps
3. Start the generation process automatically

When the user asks questions, answer in Chinese.
`;

export async function handleUserMessage(
  projectId: string,
  message: ChatMessage,
): Promise<ChatMessage> {
  const project = await loadProject(projectId);
  if (!project) {
    return createAgentMessage('项目不存在，请先创建或选择一个项目。');;
  }

  // Check if message has attachments (uploaded files)
  if (message.attachments && message.attachments.length > 0) {
    const srtFiles = message.attachments.filter((a) => a.type === 'srt');
    const mp3Files = message.attachments.filter((a) => a.type === 'mp3');

    if (srtFiles.length > 0 || mp3Files.length > 0) {
      // Copy uploaded files to project folder
      for (const attachment of message.attachments) {
        const destPath = path.join(project.folderPath, attachment.name);
        await fs.copyFile(attachment.path, destPath);
        log.info(`[Agent] copied ${attachment.name} to project folder`);
      }

      // Scan workspace to update manifest
      const workspace = await scanWorkspace(project.folderPath);

      if (workspace.valid) {
        // Auto-start workflow
        return createAgentMessage(
          `检测到文件：\n` +
          `- 字幕文件：${workspace.srtPath?.split(/[/\\]/).pop()}\n` +
          `- 音频文件：${workspace.audioPath?.split(/[/\\]/).pop()}\n` +
          `- 字幕 cue 数：${workspace.cueCount}\n\n` +
          `正在自动开始生成视频...`,
        );
      } else {
        return createAgentMessage(
          `已上传文件，但工作区尚未完整。请确保同时上传 SRT 字幕文件和 MP3 音频文件。`,
        );
      }
    }
  }

  // Handle text commands
  const content = message.content.toLowerCase().trim();

  if (content.includes('开始') || content.includes('生成') || content.includes('run')) {
    const workspace = await scanWorkspace(project.folderPath);
    if (!workspace.valid) {
      return createAgentMessage(
        '工作区缺少必要的文件。请先上传 SRT 字幕文件和 MP3 音频文件。',
      );
    }

    // Start workflow
    return createAgentMessage('正在开始生成视频，请稍候...');
  }

  if (content.includes('状态') || content.includes('进度') || content.includes('status')) {
    return createAgentMessage('当前没有正在运行的工作流。');
  }

  if (content.includes('帮助') || content.includes('help')) {
    return createAgentMessage(
      '我是 AIGC Line Agent，可以帮助你：\n' +
      '1. 上传 SRT 字幕文件和 MP3 音频文件\n' +
      '2. 自动生成手绘分镜图\n' +
      '3. 合成最终视频\n\n' +
      '直接上传文件或发送"开始生成"即可。',
    );
  }

  // Default: use Claude to generate a response
  return generateAgentResponse(message.content);
}

async function generateAgentResponse(userContent: string): Promise<ChatMessage> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return createAgentMessage('未设置 ANTHROPIC_API_KEY 环境变量，无法使用 AI 功能。');
    }

    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: AGENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return createAgentMessage(text || '抱歉，我没有理解您的问题。');
  } catch (err) {
    log.error('[Agent] generate response failed:', err);
    return createAgentMessage(`抱歉，处理您的消息时出错: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function createAgentMessage(content: string): ChatMessage {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content,
    timestamp: Date.now(),
  };
}
