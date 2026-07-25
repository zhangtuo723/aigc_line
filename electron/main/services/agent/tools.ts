import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import log from 'electron-log/main';
import type { Artifact, ChatMessage } from '../../../../src/shared/ipc.types';
import { messageHub } from '../message-hub';
import { appendChatMessage } from '../project.store';
import { pushArtifact } from './artifact';

/** Image extensions -> MIME types supported as image artifacts */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

/**
 * Create the PushArtifact MCP server. The agent calls PushArtifact with a
 * workspace file path; the file is read from disk and pushed to the canvas.
 */
export function createPushArtifactServer(projectId: string, folderPath: string) {
  return createSdkMcpServer({
    name: 'push-artifact-server',
    version: '1.0.0',
    instructions: 'Server for pushing artifacts to the frontend canvas',
    tools: [
      tool(
        'PushArtifact',
        'Push a file from the workspace (markdown, html, or image) to the user\'s canvas. Pass the file path - the file content is read from disk, so you do NOT need to repeat the content. Images (png/jpg/jpeg/gif/webp/svg/bmp/avif) are displayed as picture cards.',
        {
          path: z.string().describe('Path to the file, relative to the workspace or absolute'),
          title: z.string().describe('A short title for the artifact'),
          width: z.number().optional().describe('Width of the artifact on canvas in pixels, default 400'),
          height: z.number().optional().describe('Height of the artifact on canvas in pixels, default 300'),
        },
        async (args) => {
          log.info('[PushArtifact] Tool called:', args.path, args.title);
          try {
            // Resolve within the workspace - reject paths that escape it
            const filePath = path.resolve(folderPath, args.path);
            if (!filePath.startsWith(path.resolve(folderPath) + path.sep)) {
              throw new Error(`Path is outside the workspace: ${args.path}`);
            }
            const ext = path.extname(filePath).toLowerCase();
            const imageMime = IMAGE_MIME[ext];
            let type: Artifact['type'];
            let content: string;
            if (imageMime) {
              // Images travel as self-contained data URLs so canvas snapshots stay portable
              type = 'image';
              const buf = await fs.readFile(filePath);
              content = `data:${imageMime};base64,${buf.toString('base64')}`;
            } else {
              content = await fs.readFile(filePath, 'utf-8');
              type = ext === '.html' || ext === '.htm' ? 'html' : 'markdown';
            }
            const artifact = pushArtifact(projectId, type, args.title, content, args.width, args.height);
            // Also persist as a chat message so it survives reloads
            const artifactMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: `Artifact: ${args.title}`,
              timestamp: Date.now(),
              artifact,
            };
            messageHub.pushToFrontend(artifactMsg);
            await appendChatMessage(folderPath, artifactMsg);
            return {
              content: [{ type: 'text', text: `Artifact pushed successfully: ${args.title} (${args.path})` }],
            } as any;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error('[PushArtifact] Failed:', message);
            return {
              content: [{ type: 'text', text: `Failed to push artifact: ${message}` }],
              isError: true,
            } as any;
          }
        },
      ),
    ],
  });
}
