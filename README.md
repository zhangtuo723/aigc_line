# AIGC CANVAS

English | [简体中文](README.zh-CN.md)

![AIGC CANVAS cover](docs/screenshots/aigc-canvas-cover.png)

AIGC CANVAS is an Electron desktop workbench for AI storyboarding and video creation. It brings a Claude Agent, a React Flow infinite canvas, and ComfyUI generation pipelines into one project workspace: create storyboards through chat, connect text, image, video, and audio nodes, and run image or video generation directly on the canvas.

## Features

- **Project Agent** powered by @anthropic-ai/claude-agent-sdk, scoped to the selected workspace and equipped with a custom PushArtifact tool.
- **React Flow infinite canvas** with zoom, pan, marquee/multi-selection, drag, delete, Bézier connections, and per-project snapshots.
- **Text, image, video, audio, and storyboard nodes**. Audio nodes can import and preview local audio files.
- **Storyboard pipeline**: every row in a .storyboard.json artifact expands into shot → image → video, with prompts and generated paths written back to the source file.
- **ComfyUI image generation** with text-to-image, image-to-image, 16:9 / 1:1 / 4:3 ratios, and RTX 2× ULTRA upscaling.
- **MiniMax H3 text / first-last-frame video**. Connected images become candidates and can be dragged into explicit first-frame and last-frame slots; either slot is optional.
- **MiniMax H3 multimodal reference video**. Drag connected media into ordered image, video, and audio tracks. Track order maps directly to `<Picture n>`, `<Video n>`, and `<Audio n>` references, with limits of 9 images, 3 videos, and 3 standalone audio clips.
- **In-canvas media preview**, including Range-based streaming for generated videos.
- **Application settings** for the ComfyUI endpoint, Agent API URL/token, and default image workflow. Tokens are encrypted with Electron safe storage.
- **Project persistence** for chat history, canvas layout, node parameters, and generated assets.

## Creation Flow

1. Create a project and select a local workspace.
2. Ask the Agent to create a .storyboard.json artifact.
3. Each storyboard shot is connected to an image node and a video node.
4. Edit the image prompt, workflow, and aspect ratio, then click **Generate**.
5. Enter motion/camera instructions in the video node. For first/last-frame mode, drag connected images into the frame slots. For multimodal mode, arrange connected media on the three reference tracks.
6. Outputs are stored under generated/images and generated/videos.

## Bundled ComfyUI Workflows

| Workflow | Type | RTX upscale |
|---|---|---|
| Flux2 Klein 9B | Text to image | 2× ULTRA |
| Flux2 Klein 9B Edit | Image to image | 2× ULTRA |
| Z-Image Turbo | Text to image | 2× ULTRA |
| MiniMax H3 | Text / first-last-frame to video | — |
| MiniMax H3 Reference | Images / videos / audio to video | — |

Templates live in resources/comfyui-workflows/. The corresponding models and custom nodes must already be installed on the ComfyUI server.

MiniMax H3 output sizes:

| Aspect ratio | Resolution |
|---|---:|
| 16:9 | 1024 × 576 |
| 4:3 | 1024 × 768 |
| 1:1 | 1024 × 1024 |

## Settings

Open Settings from the home page to configure:

- ComfyUI HTTP endpoint, for example http://127.0.0.1:8188
- ANTHROPIC_BASE_URL
- ANTHROPIC_AUTH_TOKEN
- Default text-to-image workflow

## Quick Start

Requirements: Node.js, npm, a reachable ComfyUI server, and Claude Agent credentials or a compatible Anthropic API URL and token.

~~~powershell
npm install
npm run dev
~~~

Production build:

~~~powershell
npm run build
~~~

## Scripts

- npm run dev: start Vite and Electron in development mode
- npm run build: build and package with electron-builder
- npm run typecheck: run TypeScript checks
- npm test: run Vitest tests
- npm run test:e2e: run Playwright Electron tests

## Project Structure

~~~text
├── electron/
│   ├── main/
│   │   ├── ipc/                    # Project, chat, canvas, artifact, ComfyUI, settings IPC
│   │   └── services/
│   │       ├── agent/              # Claude Agent SDK and PushArtifact
│   │       ├── comfyui.service.ts  # Image/video workflows and output downloads
│   │       ├── settings.service.ts # Global settings and secure token storage
│   │       └── project.store.ts    # Project, chat, and canvas persistence
│   └── preload/                    # Secure electronAPI bridge
├── resources/comfyui-workflows/    # ComfyUI API workflow templates
├── src/
│   ├── components/CanvasArea.tsx   # React Flow canvas and generation nodes
│   ├── pages/                      # Home, project, and settings pages
│   ├── shared/                     # IPC channels and types
│   └── stores/                     # Zustand state
└── test/
~~~

## Storyboard Data

A storyboard file contains an array of StoryboardShot objects with shot number, duration, scene, dialogue, camera direction, image/video prompts, current asset paths, and version history. Successful generations automatically write output paths back to the storyboard file.

## Roadmap

- Additional ComfyUI video workflows
- Batch generation and queue management
- Shot concatenation, voice-over, and timeline export
- Visual workflow importing and field mapping
