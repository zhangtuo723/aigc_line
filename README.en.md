# AIGC CANVAS

[简体中文](README.md) | English

![AIGC CANVAS cover](docs/screenshots/aigc-canvas-cover.png)

AIGC CANVAS is an Electron desktop workbench for AI storyboarding and video creation. It brings a Claude Agent, a React Flow infinite canvas, and ComfyUI generation pipelines into one project workspace: create storyboards through chat, connect text, image, video, and audio nodes, and run image or video generation directly on the canvas.

## Creative Workspace

![AIGC CANVAS storyboard production workspace](docs/screenshots/storyboard-production-workspace.png)

Organize shots, reference images, generated videos, and upscaled outputs on one infinite canvas. The Agent panel shows Skill and tool execution in real time and can directly read, create, and update canvas nodes.

## Features

- **Project Agent** powered by @anthropic-ai/claude-agent-sdk, with live Canvas MCP tools for reading, creating, updating, deleting, and connecting nodes.
- **Built-in Agent skills** ship as an app-owned local Claude Plugin. Project `.claude/skills` customizations remain supported and are never created or overwritten by the app.
- **Voiceover-to-video workflow** turns narration audio plus SRT subtitles into timed shot → image → video chains and a Jianying draft.
- **Skill command palette**: type `/` at the start of the chat input, search with text, choose with the mouse or arrow keys, then add task details.
- **Explicit context boundaries**: start a fresh Claude context from the chat header while keeping visible history, canvas state, and project files.
- **Node-referenced chat**: select a canvas node and click **Add to chat** to attach it to the next message, letting the Agent update that exact node by ID.
- **React Flow infinite canvas** with zoom, pan, marquee/multi-selection, drag, delete, Bézier connections, and per-project snapshots.
- **Shot, text, image, video, audio, and video-upscale nodes**. Shot nodes only identify the shot number and content; prompts and timing live on image/video nodes. Audio nodes can import and preview local audio files.
- **Node-native storyboard pipeline**: the Agent directly creates shot → image → video chains, with canvas nodes as the single source of truth.
- **ComfyUI image generation** with text-to-image, image-to-image, 16:9 / 1:1 / 4:3 ratios, and RTX 2× ULTRA upscaling.
- **MiniMax H3 text / first-last-frame video**. Connected images become candidates and can be dragged into explicit first-frame and last-frame slots; either slot is optional.
- **MiniMax H3 multimodal reference video**. Drag connected media into ordered image, video, and audio tracks. Track order maps directly to `<Picture n>`, `<Video n>`, and `<Audio n>` references, with limits of 9 images, 3 videos, and 3 standalone audio clips.
- **RTX video upscaling** with 2× / 3× / 4× scaling, FAST / MEDIUM / HIGH / ULTRA quality presets, and automatic source-frame-rate matching.
- **In-canvas media preview**, including Range-based streaming for generated videos.
- **Application settings** for the ComfyUI endpoint, Agent API URL/token, and default image workflow. Tokens are encrypted with Electron safe storage.
- **Project persistence** for chat history, canvas layout, node parameters, and generated assets.

## Creation Flow

1. Create a project and select a local workspace.
2. Ask the Agent to create a storyboard; it will create shot, image, and video nodes directly.
3. The Agent connects each shot → image → video chain and can update or rearrange it through chat.
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
| RTX Video Super Resolution | Video upscale | 2× / 3× / 4× |

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

Requirements: Node.js, pnpm, a reachable ComfyUI server, and Claude Agent credentials or a compatible Anthropic API URL and token.

~~~powershell
pnpm install
pnpm dev
~~~

Production build:

~~~powershell
pnpm build
~~~

## Scripts

- pnpm dev: start Vite and Electron in development mode
- pnpm build: build and package with electron-builder
- pnpm typecheck: run TypeScript checks
- pnpm test: run Vitest tests
- pnpm test:e2e: run Playwright Electron tests

## Project Structure

~~~text
├── electron/
│   ├── main/
│   │   ├── ipc/                    # Project, chat, canvas, artifact, ComfyUI, settings IPC
│   │   └── services/
│   │       ├── agent/              # Claude Agent SDK, Canvas MCP, and PushArtifact
│   │       ├── comfyui.service.ts  # Image/video workflows and output downloads
│   │       ├── settings.service.ts # Global settings and secure token storage
│   │       └── project.store.ts    # Project, chat, and canvas persistence
│   └── preload/                    # Secure electronAPI bridge
├── resources/comfyui-workflows/    # ComfyUI API workflow templates
├── resources/claude-plugin/        # App-owned Claude Plugin and built-in skills
├── src/
│   ├── components/CanvasArea.tsx   # React Flow canvas and generation nodes
│   ├── pages/                      # Home, project, and settings pages
│   ├── shared/                     # IPC channels and types
│   └── stores/                     # Zustand state
└── test/
~~~

## Storyboard Data

Shot metadata, prompts, generated asset paths, and version history are stored directly on canvas nodes. Legacy `.storyboard.json` artifacts are imported once into shot → image → video chains when encountered.

## Roadmap

- **Chinese LLM providers**: integrate DeepSeek, Kimi, GLM, and other models so users can select the right Agent inference service for each task.
- **AI music creation**: add soundtrack, song, and scene-music generation connected to storyboards, videos, and timelines.
- **More image models**: integrate Nano Banana, GPT Image 2, Seedream, and other image generation and editing models.
- **More video API models**: integrate Seedance, Kling, Wan, and other video generation services.
