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
import { analyzeVideoWithQwen } from '../qwen-video-analysis.service';
import { directorProjectSchema } from '../../../../src/shared/director-schema';

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
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3']).optional(),
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
    directorProject: directorProjectSchema.optional(),
    boardState: z.unknown().optional(),
    boardPreviewPath: z.string().optional(),
    boardPreviewUpdatedAt: z.number().optional(),
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
        'GetCanvasOverview',
        'Read a compact overview of the live canvas: node/edge counts, counts by kind and generation status, plus each node id, kind, title, generation status and output availability. It omits revisions, prompts, media paths, positions and full edge data to keep context small.',
        {},
        () => canvasResult('get-overview', {}),
      ),
      tool(
        'GetCanvasNode',
        'Read one live canvas node by exact id with its complete data, position, and compact incoming/outgoing connection summaries. Use this when you need prompts, media paths, generation errors, reference ids or other details. If the user attached a node to the conversation, call this directly with that node id instead of reading the canvas overview first.',
        { nodeId: z.string().min(1) },
        (args) => canvasResult('get-node', args),
      ),
      tool(
        'GetCanvasCapabilities',
        'List every registered canvas node kind with its fields (writable and read-only, including resolved dynamic options such as the available generation workflows/models) and its invokable actions. Call this before updating nodes or invoking actions to learn what each node kind supports; newly added node kinds appear here automatically.',
        {},
        () => canvasResult('get-capabilities', {}),
      ),
      tool(
        'InvokeNodeAction',
        'Trigger an action exposed by canvas nodes, e.g. "generate" on image/video nodes (use GetCanvasCapabilities to discover actions). Pass nodeIds to run the action on many nodes at once (batch generation). Async actions are acknowledged immediately and return a statusField per node; poll each target with GetCanvasNode until that field leaves the busy state (idle or error), then read sourcePath for the result.',
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
        'Create one or more live canvas nodes. Use image nodes for still references or keyframes, image-editor nodes for an Excalidraw board that can start blank or optionally load connected image nodes as editable materials, video nodes for generated clips, audio nodes for imported sound, and upscale nodes for video enlargement. Connect images to an image-editor only when the board should preload those images. Store all generation requirements in the image/video prompt fields. Only fields registered for the node kind are applied; call GetCanvasCapabilities to discover them. Canvas writes use last-write-wins and do not accept a revision precondition.',
        {
          nodes: z.array(z.object({
            id: z.string().optional(),
            kind: z.enum(['image', 'image-editor', 'video', 'audio', 'upscale', 'director']),
            position: positionSchema.optional(),
            ...nodeFields,
          })).min(1),
        },
        (args) => canvasResult('create-nodes', args),
      ),
      tool(
        'UpdateCanvasNodes',
        'Patch existing live canvas nodes by id. Only supplied fields are changed; kind cannot be changed. Writable fields, allowed values and dynamic options (e.g. workflowId choices such as the generation model) are node-kind specific and validated against the canvas capability registry; call GetCanvasCapabilities first to discover them. Canvas writes use last-write-wins and do not accept a revision precondition.',
        {
          updates: z.array(z.object({
            id: z.string(),
            position: positionSchema.optional(),
            ...nodeFields,
          })).min(1),
        },
        (args) => canvasResult('update-nodes', args),
      ),
      tool(
        'DeleteCanvasNodes',
        'Delete canvas nodes by id. All edges attached to deleted nodes are removed automatically.',
        {
          nodeIds: z.array(z.string()).min(1),
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
        },
        (args) => canvasResult('connect-nodes', args),
      ),
      tool(
        'DisconnectCanvasEdges',
        'Remove canvas connections by edge id.',
        {
          edgeIds: z.array(z.string()).min(1),
        },
        (args) => canvasResult('disconnect-edges', args),
      ),
      tool(
        'AnalyzeVideo',
        'Analyze any video with qwen3.5-omni-plus according to a free-form requirement. videoUrl may be a project-relative/absolute file path inside the current project or a public http(s) URL. The tool scans the whole video in chronological order, jointly analyzes visuals, visible text, speech, music, ambience and sound effects, distinguishes observations/transcription/inference, cites timestamped evidence, states uncertainty, and saves a Chinese Markdown report under generated/analyses/. Suitable for summaries, timelines, transcription, content extraction, event counting, comparisons, audiovisual analysis and targeted quality inspection.',
        {
          videoUrl: z.string().min(1).describe('Project-local video path or public http(s) video URL'),
          analysisRequest: z.string().min(1).describe('What to inspect, extract, compare, summarize, transcribe, or evaluate'),
        },
        async (args) => {
          log.info('[AnalyzeVideo] Analyzing:', args.videoUrl);
          try {
            const result = await analyzeVideoWithQwen(folderPath, args.videoUrl, args.analysisRequest);
            return {
              content: [{ type: 'text', text: `${result.analysisText}\n\n---\n分析报告已保存：${result.reportPath}` }],
            } as any;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.error('[AnalyzeVideo] Failed:', message);
            return { content: [{ type: 'text', text: message }], isError: true } as any;
          }
        },
      ),
      tool(
        'PushArtifact',
        'Push a workspace file (markdown, html, or image) to the canvas. For video plans, create image/video nodes with the Canvas tools instead of pushing a storyboard table.',
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
            messageHub.pushToFrontend(projectId, artifactMsg);
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
