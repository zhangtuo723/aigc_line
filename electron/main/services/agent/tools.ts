import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import log from 'electron-log/main';
import type { Artifact, ChatMessage } from '../../../../src/shared/ipc.types';
import { messageHub } from '../message-hub';
import { appendChatMessage } from '../project.store';
import { pushArtifact } from './artifact';
import { sendCanvasCommand } from './canvas-bridge';

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
  const positionSchema = z.object({ x: z.number(), y: z.number() });
  const nodeFields = {
    title: z.string().optional(),
    prompt: z.string().optional(),
    shotNumber: z.number().int().positive().optional(),
    scene: z.string().optional(),
    aspectRatio: z.enum(['16:9', '1:1', '4:3']).optional(),
    sourcePath: z.string().optional(),
    workflowId: z.string().optional(),
    duration: z.number().positive().optional(),
    firstFrameNodeId: z.string().optional(),
    lastFrameNodeId: z.string().optional(),
    referenceImageNodeIds: z.array(z.string()).optional(),
    referenceVideoNodeIds: z.array(z.string()).optional(),
    referenceAudioNodeIds: z.array(z.string()).optional(),
    inputNodeId: z.string().optional(),
    scale: z.number().optional(),
    quality: z.string().optional(),
  };
  const canvasResult = async (action: Parameters<typeof sendCanvasCommand>[1], payload: unknown) => {
    try {
      const response = await sendCanvasCommand(projectId, action, payload);
      return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] } as any;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: message }], isError: true } as any;
    }
  };

  return createSdkMcpServer({
    name: 'push-artifact-server',
    version: '1.0.0',
    instructions: 'Tools for reading and editing the live canvas and pushing file artifacts',
    tools: [
      tool(
        'GetCanvasState',
        'Read the live canvas state, including node/edge counts and data. Use selectionOnly to inspect only nodes selected by the user.',
        { selectionOnly: z.boolean().optional() },
        (args) => canvasResult('get-state', args),
      ),
      tool(
        'GetCanvasCapabilities',
        'List every registered canvas node kind with its fields (writable and read-only, including resolved dynamic options such as the available generation workflows/models) and its invokable actions. Call this before updating nodes or invoking actions to learn what each node kind supports; newly added node kinds appear here automatically.',
        {},
        () => canvasResult('get-capabilities', {}),
      ),
      tool(
        'InvokeNodeAction',
        'Trigger an action exposed by canvas nodes, e.g. "generate" on image/video nodes (use GetCanvasCapabilities to discover actions). Pass nodeIds to run the action on many nodes at once (batch generation). Async actions are acknowledged immediately and return a statusField per node; poll GetCanvasState until that field leaves the busy state (idle or error), then read sourcePath for the result.',
        {
          nodeId: z.string().optional(),
          nodeIds: z.array(z.string()).min(1).optional(),
          action: z.string(),
          params: z.record(z.string(), z.unknown()).optional(),
        },
        (args) => canvasResult('invoke-action', args),
      ),
      tool(
        'CreateCanvasNodes',
        'Create one or more live canvas nodes. A shot node only stores its number and concise scene/content; generation prompts and timing belong to image/video nodes. Normally connect a shot to an image node, then connect the image node to a video node. Only fields registered for the node kind are applied; call GetCanvasCapabilities to discover them.',
        {
          nodes: z.array(z.object({
            id: z.string().optional(),
            kind: z.enum(['shot', 'text', 'image', 'video', 'audio', 'upscale']),
            position: positionSchema.optional(),
            ...nodeFields,
          })).min(1),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
        (args) => canvasResult('create-nodes', args),
      ),
      tool(
        'UpdateCanvasNodes',
        'Patch existing live canvas nodes by id. Only supplied fields are changed; kind cannot be changed. Writable fields, allowed values and dynamic options (e.g. workflowId choices such as the generation model) are node-kind specific and validated against the canvas capability registry; call GetCanvasCapabilities first to discover them.',
        {
          updates: z.array(z.object({
            id: z.string(),
            position: positionSchema.optional(),
            ...nodeFields,
          })).min(1),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
        (args) => canvasResult('update-nodes', args),
      ),
      tool(
        'DeleteCanvasNodes',
        'Delete canvas nodes by id. All edges attached to deleted nodes are removed automatically.',
        {
          nodeIds: z.array(z.string()).min(1),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
        (args) => canvasResult('delete-nodes', args),
      ),
      tool(
        'ConnectCanvasNodes',
        'Connect existing canvas nodes. Duplicate source-target connections are ignored.',
        {
          connections: z.array(z.object({
            source: z.string(),
            target: z.string(),
          })).min(1),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
        (args) => canvasResult('connect-nodes', args),
      ),
      tool(
        'DisconnectCanvasEdges',
        'Remove canvas connections by edge id.',
        {
          edgeIds: z.array(z.string()).min(1),
          expectedRevision: z.number().int().nonnegative().optional(),
        },
        (args) => canvasResult('disconnect-edges', args),
      ),
      tool(
        'PushArtifact',
        'Push a workspace file (markdown, html, or image) to the canvas. For storyboards, create shot/image/video nodes with the Canvas tools instead of pushing a storyboard table.',
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
            const artifact = pushArtifact(
              projectId,
              type,
              args.title,
              content,
              args.width,
              args.height,
              // Store the workspace-relative path so edits can be saved back to the file
              path.relative(folderPath, filePath),
            );
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
