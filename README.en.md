# AIGC CANVAS

[简体中文](README.md) | English

![AIGC CANVAS AI drama creation harness](docs/screenshots/ai-drama-harness-workspace.png)

AIGC CANVAS is a Harness Engineering desktop workbench for the complete AI drama production loop. For each character, the Agent first generates one canonical four-panel identity sheet, then derives scene, wardrobe, makeup, and state variants from that base through image-to-image. It also creates overhead panoramic environment references, builds the multimodal reference graph, generates videos, and reviews the resulting clips.

## Creative Workspace

![AIGC CANVAS storyboard production workspace](docs/screenshots/storyboard-production-workspace.png)

Organize shots, reference images, generated videos, and upscaled outputs on one infinite canvas. The Agent panel shows Skill and tool execution in real time and can directly read, create, and update canvas nodes.

## Features

- **Script-to-AI-drama loop** covering script analysis, character/wardrobe assets, environment references, storyboarding, multimodal video generation, and final video review on the same live canvas.
- **Character and environment consistency assets** with one canonical left-to-right head/front/side/back identity sheet per character; scene and wardrobe variants are image-to-image branches directly from that base, preventing identity drift. Environment versions use empty high-angle panoramic references.
- **Qwen audiovisual validation** accepts a video node ID (or an image that resolves to one downstream video), automatically resolves its prompt and ordered references, then uses Qwen3.5-Omni Plus to produce an evidence-based review.
- **Project Agent** powered by @anthropic-ai/claude-agent-sdk, with a compact canvas overview and exact-id single-node detail tools plus live node creation, updates, deletion, and connections. Writes apply directly to node fields with last-write-wins semantics, so unrelated canvas changes do not reject them.
- **Built-in Agent skills** ship as an app-owned local Claude Plugin. Project `.claude/skills` customizations remain supported and are never created or overwritten by the app.
- **Voiceover-to-video workflow** turns narration audio plus SRT subtitles into timed image → video chains and a Jianying draft.
- **Skill command palette**: type `/` at the start of the chat input, search with text, choose with the mouse or arrow keys, then add task details.
- **Explicit context boundaries**: start a fresh Claude context from the chat header while keeping visible history, canvas state, and project files.
- **Node-referenced chat**: select a canvas node and click **Add to chat** to attach it to the next message, letting the Agent update that exact node by ID.
- **React Flow infinite canvas** with zoom, pan, marquee/multi-selection, drag, delete, Bézier connections, and per-project snapshots.
- **Text, image, video, audio, and video-upscale nodes**. A generated segment lives directly on its video node, while internal shots and timing live in the video prompt. Audio nodes can import and preview local files.
- **Node-native production pipeline**: the Agent directly creates reference-image → video chains, with canvas nodes as the single source of truth.
- **Multi-model image generation** with ComfyUI, Google Nano Banana 2 / Pro, and Volcengine Ark Doubao-Seedream-5.0-pro / lite. Cloud models support 2K text-to-image and single-reference image-to-image at 16:9 / 1:1 / 4:3.
- **MiniMax H3 text / first-last-frame video**. Connected images become candidates and can be dragged into explicit first-frame and last-frame slots; either slot is optional.
- **MiniMax H3 multimodal reference video**. Drag connected media into ordered image, video, and audio tracks. Track order maps directly to `<Picture n>`, `<Video n>`, and `<Audio n>` references, with limits of 9 images, 3 videos, and 3 standalone audio clips.
- **RTX video upscaling** with 2× / 3× / 4× scaling, FAST / MEDIUM / HIGH / ULTRA quality presets, and automatic source-frame-rate matching.
- **In-canvas media preview**, including Range-based streaming for generated videos.
- **Application settings** for ComfyUI, Agent, Google AI, Volcengine Ark Seedream, Qwen3.5-Omni Plus, and the default image model. Google/Qwen secrets use Electron safe storage; the Seedream key is stored as local plaintext by design.
- **Project persistence** for chat history, canvas layout, node parameters, and generated assets.

## Creation Flow

1. Create a project and select a local workspace.
2. Provide a script and invoke the bundled drama Skill. The Agent identifies stable character traits, scene-specific outfits, environment versions, key props, dialogue, and narration.
3. Dedicated character and environment Skills create one canonical head/front/side/back sheet per character, derive scene/wardrobe variants from it with image-to-image, and create empty overhead panoramic environment references.
4. The Agent breaks the script into independently generated 5/10/15-second segments, designs internal timed shots, creates one video node per segment, and connects its references directly.
5. MiniMax H3 multimodal-reference mode abstracts ordered `<Picture n>` assets into stable `<Subject n>` references and generates each video from the official six-section Ref2VA structure, including shot cut points, dialogue, ambience, and retention rules.
6. The Agent sends each resulting video and its audio track to Qwen3.5-Omni, then validates character, wardrobe, environment, action, camera, transitions, dialogue/narration, lip sync, and sound from timestamped evidence. Failed shots are revised and regenerated from the review findings.
7. Images and videos are stored under `generated/images` and `generated/videos`; a Jianying draft can be produced when a finished timeline is required.

## Bundled ComfyUI Workflows

| Workflow | Type | Output |
|---|---|---|
| Krea 2 Turbo | Text to image | Direct 2K |
| Z-Image Turbo | Text to image | Direct 2K |
| Nano Banana 2 (Google API) | Text/image to image, 2K | — |
| Nano Banana Pro (Google API) | Text/image to image, 2K | — |
| Doubao-Seedream-5.0-pro (Volcengine Ark API) | Text/image to image, 2K | — |
| Doubao-Seedream-5.0-lite (Volcengine Ark API) | Text/image to image, 2K | — |
| MiniMax H3 | Text / first-last-frame to video | — |
| MiniMax H3 Reference | Images / videos / audio to video | — |
| RTX Video Super Resolution | Video upscale | 2× / 3× / 4× |

Templates live in resources/comfyui-workflows/. The corresponding models and custom nodes must already be installed on the ComfyUI server.

Image output sizes:

| Aspect ratio | Resolution |
|---|---:|
| 16:9 | 2048 × 1152 |
| 4:3 | 2048 × 1536 |
| 1:1 | 2048 × 2048 |

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
- Qwen3.5-Omni Plus OpenAI-compatible API endpoint and DASHSCOPE_API_KEY
- Google AI Studio GEMINI_API_KEY (shared by Nano Banana 2 / Pro), plus an optional HTTP/HTTPS/SOCKS proxy when Google cannot be reached directly
- Volcengine Ark ARK_API_KEY (shared by Doubao-Seedream-5.0-pro / lite) and a configurable API base URL
- Default image model or workflow

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

## Production Data

Segment prompts, generated asset paths, and version history are stored directly on image/video nodes. Legacy `.storyboard.json` artifacts and retired shot nodes are migrated into image → video chains.

## Roadmap

- **Chinese LLM providers**: integrate DeepSeek, Kimi, GLM, and other models so users can select the right Agent inference service for each task.
- **AI music creation**: add soundtrack, song, and scene-music generation connected to storyboards, videos, and timelines.
- **More image models**: continue integrating GPT Image 2 and other image generation and editing models.
- **More video API models**: integrate Seedance, Kling, Wan, and other video generation services.
