# AIGC CANVAS

简体中文 | [English](README.en.md)

![AIGC CANVAS AI 短剧创作 Harness](docs/screenshots/ai-drama-harness-workspace.png)

AIGC CANVAS 是一个面向完整 AI 短剧生产闭环的 Harness Engineering 桌面工作台。用户输入剧本后，Agent 会分析角色外貌与逐场服装，生成角色 A-pose 三视图和场景环境图，自动制作分镜并组织多模态参考，调用 ComfyUI 生成视频，再读取实际视频逐镜分析、验证和推动修正。Claude Agent、React Flow 无限画布、ComfyUI 管线与项目资产统一运行在同一个可追踪、可干预的创作工作区中。

## 创作工作区

![AIGC CANVAS 分镜生产工作区](docs/screenshots/storyboard-production-workspace.png)

在同一张无限画布上组织镜头、参考图片、生成视频与放大结果；右侧 Agent 对话会显示 Skill 和工具执行过程，并可直接读取、创建和修改画布节点。

## 核心能力

- **剧本到 AI 短剧闭环**：从剧本解析、角色/服装资产、场景图、分镜、多模态视频生成到成片审核，Agent 按生产阶段持续操作同一张画布。
- **角色与场景一致性资产**：按“角色 × 服装版本”生成单张 A-pose 正面/侧面/背面三视图，并为不同地点、昼夜、天气和灯光状态生成环境参考图。
- **Qwen 音视频验证**：只需提交 shot 节点 ID，系统自动解析视频、提示词和参考素材，并由 Qwen3.5-Omni Plus 联合读取画面与音轨，以 Markdown 纯文本返回九维评分、时间戳证据、问题和建议；Agent 自行决定接受、修复或重做。
- **Agent 项目助手**：基于 @anthropic-ai/claude-agent-sdk，通过轻量画布概览与按 ID 单节点详情工具精确读取上下文，并可创建、修改、删除和连接节点；写入按节点字段直接应用并采用最后写入者生效，不会因无关画布变化而失败。
- **内置 Agent Skill**：以内置本地 Claude Plugin 随应用发布；仍支持项目自己的 `.claude/skills`，应用不会创建或覆盖其中的文件。
- **旁白配视频工作流**：根据旁白音频和 SRT 时间轴创建“镜头 → 图片 → 视频”节点，并逐段对齐后生成剪映草稿。
- **Skill 斜杠菜单**：在对话输入框开头输入 `/` 即可搜索 Skill，支持鼠标或方向键选择，选中后继续补充任务说明。
- **明确的上下文边界**：可从对话标题栏新建 Claude 上下文，旧聊天、画布状态和项目文件继续保留，并以分界线标识。
- **节点引用对话**：选中画布节点后点击“添加到对话”，即可把节点作为附件发送给 Agent，并按节点 ID 精确修改其内容和参数。
- **React Flow 无限画布**：支持缩放、平移、框选、多选、拖拽、删除和贝塞尔连接线，画布快照按项目持久化。
- **多种节点**：支持镜头、文本、图片、视频、音频和视频放大节点；镜头节点只记录镜头号和内容，生成提示词与时长由图片/视频节点负责；音频节点可上传并预览本地音频。
- **节点化分镜流水线**：Agent 直接创建“镜头 → 图片 → 视频”节点链，画布节点是分镜数据的唯一来源。
- **多模型图片生成**：除 ComfyUI 文生图/图生图外，支持 Google Nano Banana 2 与 Nano Banana Pro；两个模型共用 Google AI Studio API Key，支持 16:9 / 1:1 / 4:3、原生 2K 文生图和图生图。
- **MiniMax H3 文生视频 / 首尾帧视频**：连接的图片会进入候选集，可拖入明确的首帧和尾帧槽位；两个槽位均可选，也支持只设置其中一个。
- **MiniMax H3 全模态参考视频**：可将连接的素材拖入有序的图片轨、视频轨和音频轨。轨道顺序直接对应提示词中的 `<Picture n>`、`<Video n>`、`<Audio n>`，上限分别为 9 张图片、3 个视频和 3 段独立音频。
- **RTX 视频放大**：视频放大节点支持 2× / 3× / 4× 和 FAST / MEDIUM / HIGH / ULTRA 质量档位，输出帧率自动跟随源视频。
- **媒体预览**：图片直接展示，生成的视频可以在画布节点内播放；工作区协议支持视频 Range 流式读取。
- **系统配置**：可配置 ComfyUI 地址、Agent API 地址与 Token、Google AI Studio API Key、Qwen3.5-Omni Plus API 地址/API Key，以及默认生图模型。密钥使用 Electron 系统安全存储加密，并支持连接测试。
- **项目持久化**：聊天记录、画布布局、节点参数和生成产物均按项目保存。

## 创作流程

1. 新建项目并选择本地工作目录。
2. 输入剧本并调用内置短剧 Skill；Agent 分析人物固定外貌、逐场服装、场景版本、关键道具、台词与旁白。
3. Agent 创建并生成角色 A-pose 三视图和无人场景环境图，检查身份、服装与空间设定的一致性。
4. Agent 将剧本拆为镜头，在画布上创建分镜和视频节点，并连接每镜所需的角色图、场景图和其他参考素材。
5. 使用 MiniMax H3 全模态参考模式，将 `<Picture n>` 等有序素材抽象为 `<Subject n>`，按官方 Ref2VA 六段式组织镜头切点、台词、环境音与保留关系后生成视频。
6. Agent 调用 Qwen3.5-Omni 联合读取实际视频和音轨，依据带时间戳的审查报告逐镜验证角色、服装、环境、动作、运镜、转场、台词/旁白、口型和音效；不合格节点按审核结果修正并重做。
7. 图片与视频保存在项目的 `generated/images` 和 `generated/videos` 目录；需要成片时可继续生成剪映草稿。

## 内置 ComfyUI 工作流

| 工作流 | 类型 | RTX 放大 |
|---|---|---|
| Flux2 Klein 9B | 文生图 | 2× ULTRA |
| Flux2 Klein 9B Edit | 图生图 | 2× ULTRA |
| Z-Image Turbo | 文生图 | 2× ULTRA |
| Nano Banana 2（Google API） | 文生图 / 图生图，2K | — |
| Nano Banana Pro（Google API） | 文生图 / 图生图，2K | — |
| MiniMax H3 | 文本 / 首尾帧生视频 | — |
| MiniMax H3 全模态参考 | 图片 / 视频 / 音频生视频 | — |
| RTX Video Super Resolution | 视频放大 | 2× / 3× / 4× |

工作流模板位于 resources/comfyui-workflows/。ComfyUI 服务端需要提前安装模板所使用的模型和自定义节点。

MiniMax H3 输出分辨率：

| 画幅 | 分辨率 |
|---|---:|
| 16:9 | 1024 × 576 |
| 4:3 | 1024 × 768 |
| 1:1 | 1024 × 1024 |

## 系统配置

首页右上角进入系统配置，可设置：

- ComfyUI HTTP 地址，例如 http://127.0.0.1:8188
- ANTHROPIC_BASE_URL
- ANTHROPIC_AUTH_TOKEN
- Qwen3.5-Omni Plus OpenAI 兼容 API 地址和 DASHSCOPE_API_KEY
- Google AI Studio 的 GEMINI_API_KEY（Nano Banana 2 / Pro 共用），以及无法直连 Google 时使用的可选 HTTP/HTTPS/SOCKS 代理
- 默认生图模型或工作流

## 快速开始

环境要求：Node.js、pnpm、可访问的 ComfyUI 服务，以及 Claude Agent 凭证或兼容 Anthropic API 的 URL 与 Token。

~~~powershell
pnpm install
pnpm dev
~~~

生产构建：

~~~powershell
pnpm build
~~~

## 可用脚本

- pnpm dev：启动 Vite 与 Electron 开发环境
- pnpm build：构建并通过 electron-builder 打包
- pnpm typecheck：执行 TypeScript 类型检查
- pnpm test：执行 Vitest 测试
- pnpm test:e2e：执行 Playwright Electron 端到端测试

## 项目结构

~~~text
├── electron/
│   ├── main/
│   │   ├── ipc/                    # 项目、聊天、画布、产物、ComfyUI、配置 IPC
│   │   └── services/
│   │       ├── agent/              # Claude Agent SDK、Canvas MCP 与 PushArtifact
│   │       ├── comfyui.service.ts  # 图片/视频工作流与产物下载
│   │       ├── settings.service.ts # 全局配置与 Token 安全存储
│   │       └── project.store.ts    # 项目、聊天和画布持久化
│   └── preload/                    # electronAPI 安全桥接
├── resources/comfyui-workflows/    # ComfyUI API 工作流模板
├── resources/claude-plugin/        # 应用内置 Claude Plugin 与 Skill
├── src/
│   ├── components/CanvasArea.tsx   # React Flow 画布与生成节点
│   ├── pages/                      # 首页、项目页、设置页
│   ├── shared/                     # IPC 通道与类型
│   └── stores/                     # Zustand 状态
└── test/
~~~

## 分镜数据

镜头信息、提示词、生成产物路径和历史版本都直接保存在画布节点上。遇到旧版 `.storyboard.json` 产物时，应用会将其一次性迁移为“镜头 → 图片 → 视频”节点链。

## 后续规划

- **国产大语言模型**：接入 DeepSeek、Kimi、GLM 等模型，让用户可按任务选择不同的 Agent 推理服务。
- **AI 音乐创作**：增加配乐、歌曲与场景音乐生成能力，并与分镜、视频和时间线联动。
- **更多图片模型**：继续接入 GPT Image 2、Seedream 等图片生成与编辑模型。
- **更多视频 API 模型**：接入 Seedance、可灵（Kling）、万相（Wan）等视频生成服务。
