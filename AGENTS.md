# AGENTS.md

> 给 AI 协作者和开发者的项目导览。**重要：任何功能改动（新增节点、新增工作流、改 IPC、改目录结构）都必须同步更新本文档，保持它与代码一致。**

## 项目简介

AIGC CANVAS：Electron 桌面应用，把 Claude Agent（对话）、React Flow 无限画布、ComfyUI 生成管线整合在一个项目工作区里，用于 AI 分镜视频创作。用户在聊天里让 Agent 创建“参考图片 → 视频”节点链，在画布上连边、调参、触发生成；生成结果落盘到项目目录并回显到节点。生成片段直接由 video 节点承载，片段内 Shot 只存在于提示词时间线中。

技术栈：Electron + Vite + React 19 + TypeScript + Tailwind CSS 4 + @xyflow/react（画布）+ zustand（状态）+ @anthropic-ai/claude-agent-sdk（Agent）+ zod（工具入参校验）。包管理用 pnpm。

## 目录结构

| 路径 | 作用 |
|---|---|
| `electron/main/` | Electron 主进程入口与服务 |
| `electron/main/index.ts` | 主进程入口：窗口、`local-file://` / `workspace://` 自定义协议（本地媒体预览、Range 视频流）、注册全部 IPC handler |
| `electron/main/ipc/` | IPC handler 层，只做参数转发 + 错误包装，业务逻辑在 services |
| `electron/main/services/` | 主进程业务服务 |
| `electron/main/services/agent/` | Agent 子系统：会话、流式输出、MCP 工具、系统提示词、画布桥接 |
| `electron/main/services/agent/tools.ts` | Agent 的 MCP 工具定义（zod schema 在这里） |
| `electron/main/services/agent/prompts.ts` | Agent 系统提示词（分镜创作规范） |
| `electron/main/services/agent/builtin-plugin.ts` | 解析开发/打包环境中的内置 Claude Plugin 路径并生成 SDK 配置 |
| `electron/main/services/agent/skills.ts` | 枚举当前可用 Skill：活动 SDK 会话 + 应用内置、项目级、用户级目录兜底 |
| `electron/main/services/comfyui.service.ts` | ComfyUI 全部交互：工作流模板注册、参数注入、上传媒体、排队、轮询、下载结果 |
| `electron/main/services/google-image.service.ts` | Google Gemini 图片生成：Nano Banana 2 / Pro 的 2K 文生图与单参考图图生图，产物写入项目目录 |
| `electron/main/services/seedream-image.service.ts` | 火山方舟 Seedream 图片生成：Doubao-Seedream-5.0-pro / lite 的 2K 文生图与单参考图图生图，产物写入项目目录 |
| `electron/main/services/google-network.service.ts` | Google API 网络层：使用 Electron 网络栈、可选独立 HTTP/HTTPS/SOCKS 代理及可读网络错误 |
| `electron/main/services/qwen-video-review.service.ts` | Qwen 音视频审查：安全读取项目媒体、Base64/临时 OSS 上传、流式检查穿帮、画面/声音崩坏与音画同步，只返回审核文本 |
| `electron/main/services/qwen-video-analysis.service.ts` | 通用 Qwen 视频分析：接受项目内视频路径或公开 HTTP(S) URL，按自由分析要求读取完整画面与音轨并保存报告 |
| `electron/main/services/project.store.ts` | 项目持久化：清单、追加式 JSONL 聊天事件日志、会话 id、画布快照（存项目目录下） |
| `electron/main/services/project-media.service.ts` | 项目媒体资产：把本地图片/视频/音频复制到 `uploads/`，扫描 `generated/` 与 `uploads/` 供资产面板使用 |
| `electron/main/services/settings.service.ts` | 应用设置：ComfyUI 地址、Agent API、token（safeStorage 加密） |
| `electron/main/services/message-hub.ts` | 主进程内部事件总线（Agent 事件 → 渲染进程推送） |
| `electron/preload/index.ts` | preload：`window.electronAPI` 的唯一出处，渲染进程只能用它访问主进程 |
| `src/shared/` | 主进程与渲染进程共享的代码 |
| `src/shared/ipc.types.ts` | 全部 IPC 请求/响应类型 + `CanvasNodeKind` + 节点 data 结构 |
| `src/shared/ipc.channels.ts` | IPC 通道名常量（唯一定义处） |
| `src/shared/node-capabilities.ts` | 节点能力注册表：每种节点可读写哪些字段、可调用哪些动作（Agent 通过它发现能力） |
| `src/components/CanvasArea.tsx` | 画布核心：节点渲染、连线、工具栏、生成动作、canvas command 处理（agent 操作画布的入口） |
| `src/components/canvas-capabilities.ts` | 内置节点 kind 的能力声明（在这里注册新节点类型） |
| `src/components/` | 其他 UI：聊天面板、artifact 渲染、更新弹窗等 |
| `src/pages/` | 三个页面：HomePage（项目列表）、ProjectPage（工作区）、SettingsPage |
| `src/stores/app.store.ts` | zustand 全局状态（当前项目、artifacts 等） |
| `resources/comfyui-workflows/` | ComfyUI API 格式工作流 JSON 模板，打包时复制到 resourcesPath |
| `resources/claude-plugin/` | 应用内置 Claude Plugin；Skill 放在其 `skills/<name>/SKILL.md`，打包后从 resourcesPath 直接加载 |
| `docs/` | 文档截图（README 配图） |
| `test/` | vitest 单元测试 + `test/e2e/` Playwright 端到端测试 |
| `dist/` `dist-electron/` `build/` | 构建产物，勿手改 |
| `public/` | 静态资源（logo 等） |

## 现有功能

- **项目管理**：创建/打开/删除项目，每项目一个本地目录，聊天历史、画布快照、生成产物都持久化在项目内。应用启动时可恢复上次打开的项目；普通列表刷新或删除项目时保持当前页面，不触发自动导航。
- **聊天持久化**：每个项目使用 `.aigc-line/chat-events.jsonl` 追加保存 `message.created` / `message.replaced` 事件，并按项目串行写入；加载时重放为消息列表。崩溃造成的末行不完整可忽略并在下次写入前备份、修复；中间行损坏必须明确报错，不得静默显示为空。旧 `chat-history.json` 不再读取或迁移。
- **Agent 对话**：Claude Agent SDK，流式输出，可中断；输入框键入 `/` 可搜索当前可用 Skill，SDK 的 `/clear` 等控制命令不会混入 Skill 菜单；标题栏“新建上下文”会确认后清空 Claude 记忆但保留历史/画布，并持久化上下文分界线；选中任意画布节点可通过“添加到对话”作为节点引用附件，Agent 会按节点 id 读取并精确修改；通过 MCP 工具读写画布（GetCanvasOverview / GetCanvasNode / GetCanvasCapabilities / CreateCanvasNodes / UpdateCanvasNodes / ConnectCanvasNodes / InvokeNodeAction / AnalyzeVideo / ReviewStoryboardVideo / PushArtifact 等）。`GetCanvasOverview` 只返回无版本号的节点计数与轻量摘要，`GetCanvasNode` 按单个 ID 返回完整节点数据及其连接摘要；整图 `get-state` 仅供主进程内部服务使用。`AnalyzeVideo` 是与画布无关的通用工具，接受项目内视频路径或公开 HTTP(S) URL 和自由分析要求，固定调用 Qwen3.5-Omni Plus 分析完整画面与音轨，并把 Markdown 报告保存到 `generated/analyses/`；`ReviewStoryboardVideo` 则专用于画布分镜审核，重点排查穿帮、画面与声音崩坏、连续性及音画同步，只返回审核文本，不生成报告文件或 Artifact。聊天、工具状态、Artifact 和回合结束的实时 IPC 推送均携带 `projectId`，渲染进程只接收当前项目事件；项目历史异步加载也必须在写入状态前复核当前项目，避免切换竞态串线。工具状态监听 `PreToolUse` / `PostToolUse` / `PostToolUseFailure`；回合、流或应用结束后遗留的 `running` 调用会显示为“已中断”，不会永久 loading。
- **内置 Skill**：`aigc-canvas` 本地 Plugin 随应用打包并由 Agent SDK 加载；项目级 `.claude/skills` 仍可自动发现，应用不会向项目复制或覆盖 Skill。
  - `storyboard-production`：直接在画布创建和修改 image → video 短剧生产链，不创建独立 shot 节点。
  - `voiceover-to-video`：按旁白音频与 SRT 时间轴生成画面；图片提示词统一使用中文，视频提示词按一个节点内多个带时间段的子分镜描述统一风格、运镜、转场与音效；禁止生成 BGM，但允许不遮盖旁白的环境音和拟音。图片与视频生成前分别取得用户明确确认，所有审核验证由新启动的独立子 Agent 执行；逐段变速对齐后交给 `jianying-draft` 创建剪映草稿。
  - `script-to-drama-video`：把剧本、梗概或对白文案深化成 AI 短剧生产画布；严格区分 5/10/15 秒生成片段与片段内 Shot，每个片段直接对应一个 video 节点。人物参考、场景参考和 H3 prompt 分别强制委派给下面三个独立 Skill。
  - `character-reference-generation`：每个角色先生成唯一身份底图，再以底图为单一参考通过图生图派生不同场景/服装/妆造/状态版本；所有图片均为从左到右“头部近景、自然站立全身正面、侧面、背面”的横向四联图，三个全身角度禁止 A-pose/T-pose。3D、半写实、国漫/游戏/影视 CG 人物必须读取 `references/3d-character-prompt-template.md`，按角色档案替换模板中的年龄、性别、身高、体型、骨相和服装示例。
  - `environment-reference-generation`：为每个场景版本生成无人高机位俯视全景图，保留真实透视、立面、材质和纵深，不生成普通平视图或二维户型图。
  - `h3-prompt-writing`：MiniMax H3 官方提示词写作 Skill，负责 T2VA / I2VA / FL2VA / L2VA / Ref2VA 的最终提示词格式、引用标签、时间戳、对白和声音字段；`script-to-drama-video` 提供完整逐片段导演包、片段内 Shot 时间线及真实引用数组顺序，并在 Ref2VA 视频生成或重做时调用它，不自行复制或猜测官方格式。
  - `jianying-draft`：使用 pyJianYingDraft 生成剪映专业版草稿。
- **画布**：React Flow，缩放/框选/连线/删除；快照防抖自动保存；旧版分镜表以及已废弃的 shot/text 节点自动迁移/清理为 image → video 链，旧文本内容会在目标 prompt 为空时转入直接相连的图片或视频。
- **节点显示尺寸**：`image` / `video` 节点使用 620px 宽媒体卡，预览区按所选画幅自动计算高度，prompt 输入框最小高度为 140px；全模态参考轨保留图片/视频/音频数量显示和上限校验，但不再额外显示引用标签说明框。
- **媒体上传与资产库**：画布左侧独立工具栏提供“上传”和“资产”按钮。上传可多选本地图片、视频、音频，文件复制到当前项目 `uploads/<类型>/` 后自动创建对应节点；资产面板扫描当前项目 `generated/` 与 `uploads/` 下的可预览媒体，支持按类型筛选、刷新，并可拖到画布落点创建节点。媒体文件始终通过 `workspace://<projectId>/...` 预览。
- **前端隔离与异步状态**：HTML Artifact iframe 不得同时启用脚本与同源权限，当前使用无同源权限的 sandbox；画布快照加载和图片/视频/放大结果回写必须复核发起时的项目，防止切换项目后串写。Agent 运行状态按 `projectId` 保存，切回后台运行项目时仍能显示状态和停止按钮。ComfyUI 工作流列表在渲染进程共享缓存，避免每个节点重复 IPC 查询。
- **画布写入语义**：Canvas MCP 写工具按节点 ID/字段直接应用，采用最后写入者生效（Last Write Wins），不接收或校验全局画布版本号；仍校验节点存在性、ID 唯一性、字段能力和连线合法性。
- **节点类型**（`CanvasNodeKind`）：
  - `image` 图片：文生图 / 图生图（Krea 2 Turbo、Z-Image Turbo、Nano Banana 2、Nano Banana Pro、Doubao-Seedream-5.0-pro、Doubao-Seedream-5.0-lite），16:9 / 1:1 / 4:3；全部模型使用标准 2K 输出，ComfyUI 图片工作流直接保存 VAE 解码结果，不经过 RTX 放大；Nano Banana 与 Seedream 在连入已有图片时自动使用图生图
  - `video` 视频：MiniMax H3 文生视频 / 首尾帧 / 全模态参考（图片 9 + 视频 3 + 音频 3，提示词用 `<Picture n>` 等引用）；全模态参考可选择标准 20 步或带 Turbo 8 步 LoRA 的加速工作流
  - `audio` 音频：导入本地音频并预览
  - `upscale` 视频放大：RTX Video Super Resolution，连入视频节点作为输入（多输入可点选，`inputNodeId`），倍数 2x/3x/4x，质量 FAST/MEDIUM/HIGH/ULTRA，帧率经 VHS_VideoInfo 自动跟随源视频
- **图片/视频生成集成**：ComfyUI 工作流模板在 `resources/comfyui-workflows/`，`comfyui.service.ts` 注入参数 → 排队 → 轮询 history → 下载结果；默认 ComfyUI 文生图为 `krea2-turbo-t2i`，使用 `krea2_turbo_fp8_scaled.safetensors` 和 8 步 Euler/simple 采样，Krea 2 Turbo 与 Z-Image Turbo 均直接以标准 2K 尺寸生成并保存，图片工作流不包含 RTX 放大节点；旧 Flux2 Klein 文生图/图生图工作流已移除且旧默认设置自动迁移到 Krea 2 Turbo。`minimax-h3-r2v` 是标准全模态参考，`minimax-h3-r2v-turbo` 是加载 `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` 的 8 步加速版本，两者共用相同参考轨语义；MiniMax H3 视频使用 1024 档，16:9 / 4:3 / 1:1 分别为 1024×576 / 1024×768 / 1024×1024。ComfyUI/Google 图片使用标准 2K 映射：16:9 为 2048×1152、4:3 为 2048×1536、1:1 为 2048×2048；Seedream 使用官方 2K 参考尺寸 2816×1584、2368×1776、2048×2048。Google Gemini 图片 API 由 `google-image.service.ts` 调用 Nano Banana 2 / Pro；火山方舟图片 API 由 `seedream-image.service.ts` 调用 Doubao-Seedream-5.0-pro / lite；两者固定生成 2K 图片并支持项目内参考图。
- **设置页**：宽屏使用基础服务双栏、AI 云服务三栏布局；可配置 ComfyUI 地址、Agent API URL/token、Google AI Studio API key 与可选代理、火山方舟 Seedream API URL/key、Qwen3.5-Omni Plus API URL/key 和默认生图模型，并提供 ComfyUI/Google AI/Qwen/Seedream 连接测试。Qwen/Google Key 使用 safeStorage；Seedream Key 按用户要求明文保存在本机 `settings.json`。所有配置统一使用页面顶部“保存配置”，Seedream 保存后再次读取主进程设置确认落盘，并在卡片内显示“已保存”与清除选项。
- **自动更新**：electron-updater。

## 核心代码在哪里

| 要改什么 | 去哪里 |
|---|---|
| 画布交互/节点 UI/生成按钮 | `src/components/CanvasArea.tsx`（单文件，约 1800 行，含 PromptPanel / UpscalePanel / StoryNodeCard / CanvasFlow） |
| 新增节点类型 | 见下方"新增节点 checklist" |
| ComfyUI 生成逻辑、工作流参数注入 | `electron/main/services/comfyui.service.ts` |
| 本地媒体上传、项目资产扫描 | `electron/main/services/project-media.service.ts` + `electron/main/ipc/project.handlers.ts` |
| Agent 能用哪些工具、工具入参 schema | `electron/main/services/agent/tools.ts` |
| Agent 行为约束/分镜规范 | `electron/main/services/agent/prompts.ts` |
| 新增或修改应用内置 Skill | `resources/claude-plugin/skills/<name>/SKILL.md`；同时更新 Plugin 版本与本文档 |
| 新增 IPC 接口 | `src/shared/ipc.types.ts` + `src/shared/ipc.channels.ts` + `electron/main/ipc/*.handlers.ts` + `electron/preload/index.ts` 四处一起改 |
| 本地媒体预览协议 | `electron/main/index.ts` 的 `protocol.handle('workspace' | 'local-file')` |

## 开发注意事项

1. **新增节点类型 checklist**（漏一处就会出现"Agent 说改了但界面没变"之类的问题）：
   - `src/shared/ipc.types.ts`：`CanvasNodeKind` 加 kind，`CanvasNodeData` 加字段
   - `electron/main/services/agent/tools.ts`：`nodeFields` zod schema 加同样字段 —— **zod 默认静默丢弃未声明字段**，这是已踩过的坑
   - `src/components/canvas-capabilities.ts`：`registerNodeCapabilities` 注册字段和动作
   - `src/components/CanvasArea.tsx`：`nodeIcon`、`makeNode`、`KIND_LABELS`、工具栏列表、MiniMap 颜色、create-nodes 白名单、sourcePath→preview 派生条件、kind 动作注册（`registerNodeKindAction`）
   - 如需后端生成：`ipc.channels.ts` + `ipc.types.ts` + handler + preload + `comfyui.service.ts`
   - 如需新工作流：JSON 放 `resources/comfyui-workflows/`
   - 最后更新本文档和 `README.md` / `README.zh-CN.md`
2. **画布 command 容错设计**：`pickMutableNodeData` 对未注册字段静默忽略（有意为之）。字段必须先注册进能力表才写得到节点上。
3. **kind 级动作**：生成类动作用 `registerNodeKindAction`（注册一次，离屏节点也能触发），不要用 per-node 注册。
4. **ComfyUI 工作流**：VHS_VideoCombine 的 `frame_rate` 最小为 1，不能填 0；要跟随源视频帧率就接 VHS_VideoInfo。节点参数注入用 `setInput(nodeId, field, value)`，节点 id 以 workflow JSON 为准。
5. **预览地址**：节点 `preview` 一律由 `sourcePath` 派生为 `workspace://<projectId>/<rel-path>`（每段 encodeURIComponent），不要手写 file://。
6. **生成状态**：`generationStatus`（idle/generating/error）是只读轮询字段；异步动作完成后必须复位，加载快照时会把残留的 generating 重置为 idle。
7. **路径安全**：上传媒体前校验路径必须位于项目目录内（`uploadReferenceMedia` 已有检查，新代码沿用）。
8. **提交前验证**：`pnpm typecheck` 必须通过；`pnpm test`（vitest）不要跑挂；UI 改动大的话跑 `pnpm test:e2e`（Playwright）。
9. **样式约定**：深色画布（`#0a0a0f` 底 + `#d4af37` 金强调色），Tailwind 原子类，跟随 CanvasArea 现有面板风格。聊天区按信息层级展示：用户/AI 正文和 Artifact 使用消息卡片，连续工具调用使用无头像的紧凑执行时间线，工具入参与结果默认折叠，避免长回合被低价值过程信息撑高。
10. **内置 Skill 隔离**：内置 Skill 只能放在 `resources/claude-plugin/` 并通过 SDK `plugins` 加载；不要复制到项目 `.claude/skills`。新增 Skill 使用 kebab-case 目录名和包含 `name`、`description` 的 `SKILL.md`，并提升 `.claude-plugin/plugin.json` 版本。
11. **Skill 斜杠菜单**：`chat:listSkills` 扫描内置、项目和用户 Skill；活动 Query 的 `supportedCommands()` 只补充已发现 Skill 的元数据，不得把 `/clear`、`/batch` 等控制命令加入菜单。显式 `/<skill>` 必须保持在 Agent prompt 第一行；节点引用和附件上下文追加在命令之后。
12. **新建上下文**：通过 `chat:clearContext` 向 SDK 发送隐藏的 `/clear`，仅在 Agent 空闲时允许执行；吞掉该命令的 `(no content)`，完成后追加并持久化 `event: 'context-cleared'` 分界消息。不要自动删除聊天历史、画布或项目文件。
13. **旁白视频生成门与审核隔离**：`voiceover-to-video` 必须在实际生成图片、视频前分别询问并等待用户明确同意，重做也要重新确认；所有分镜、媒体和成片审核必须由每轮新启动的独立子 Agent 完成，主 Agent 不得自行验收；系统实际提交的图片提示词必须使用中文；每个视频提示词必须包含覆盖完整时长的多个连续子分镜及明确转场，禁止 BGM，但可生成不遮盖原旁白的同步环境音和拟音。
14. **剧本深化、资产委派与片段层级**：`script-to-drama-video` 默认保留核心人物关系、事实、冲突、因果和结局方向，允许为视听表达补足动作、反应、潜台词、必要对白/旁白和声画衔接；改变核心动机、关键事件或结局必须先确认。先拆成可独立生成/审核的 5/10/15 秒片段，每个片段直接创建一个 video 节点；片段内 Shot 使用连续时间范围写入导演包和 prompt，不创建 Canvas 节点。人物图必须调用 `character-reference-generation`：每个 `characterId` 先生成唯一身份底图，审核合格并取得 `sourcePath` 后，再由该底图直接连接所有场景/服装变体并通过单参考图图生图生成；禁止变体链式派生和不同场景独立文生图，底图重做后全部变体都要重做。场景图必须调用 `environment-reference-generation` 生成无人俯视全景，禁止在生产 Skill 内维护 prompt template。视频固定使用 `minimax-h3-r2v`，最终 Ref2VA prompt 及审核后的修订必须调用 `h3-prompt-writing`。
15. **分镜视频审核**：`ReviewStoryboardVideo` 公开入参只有 `nodeId`，通常传 video ID，也接受只关联一个下游 video 的 image ID；优先读取实时画布，当前项目未打开时回退读取持久化快照，并解析视频 prompt 及按原始编号排列的图片/视频/音频参考素材。审核粒度是完整生成片段，必须逐段检查内部 Shot、静止画面、快速运动、遮挡交互、运镜、转场和切点，重点排查身份/服装/场景/道具穿帮、画面与声音崩坏和音画同步。缺失或类型错误的显式参考必须报错，禁止过滤后重新编号。内部固定使用 `qwen3.5-omni-plus`；工具只返回审核文本，不计算总分或 pass/fail，不写入报告文件或 Artifact。
16. **设置版本与持久化校验**：Vite 可能只热更新渲染进程而 Electron 主进程仍为旧版本。设置页必须验证 `get/saveAppSettings` 返回值包含 Qwen、Google AI 与 Seedream 字段；缺失时提示完全重启，不能误报保存成功。主进程写入设置后必须重新读取并验证 URL 与 Key。Qwen / Google AI API Key 使用 safeStorage 加密并回填；Seedream API Key 按用户要求使用 `seedreamApiKey` 字段明文保存、回填和清除，保存新值时删除旧 `encryptedSeedreamApiKey`。Agent Token 仍不回显。
17. **Google 图片生成**：Nano Banana 2 固定使用 `gemini-3.1-flash-image`，Nano Banana Pro 固定使用 `gemini-3-pro-image`，两者共用 Google AI Studio API Key。REST 请求必须使用 `generationConfig.imageConfig` 发送画幅简写与 `imageSize: "2K"`；不要使用 `responseFormat.image`，该 v1 端点会把画幅和尺寸按 `ImageResponseFormat` 枚举解析并对简写、符号枚举均返回 HTTP 400。参考图只允许读取当前项目目录内的相对路径。Google Key 按 Qwen Key 的持久化方式保存、回填与校验。请求必须经 `google-network.service.ts` 使用 Electron 网络栈；无法直连时可配置独立的 HTTP/HTTPS/SOCKS 代理，网络错误需保留底层原因而不是只显示 `fetch failed`。
   - **Seedream 图片生成**：只注册 Doubao-Seedream-5.0-pro（API 模型 ID `doubao-seedream-5-0-260128`）与 Doubao-Seedream-5.0-lite（`doubao-seedream-5-0-lite-260128`），通过火山方舟 `/images/generations` 调用。API Base URL 与 Key 可配置，Key 明文保存在本机设置并支持 `ARK_API_KEY` 环境变量兜底；参考图只能是当前项目内不超过 10 MB 的 PNG/JPEG。单节点固定关闭组图；2K 尺寸使用官方参考值：16:9 `2816×1584`、4:3 `2368×1776`、1:1 `2048×2048`。Seedream 5.0 Pro 自定义宽高的官方总像素范围从 `1280×720`（921600）起，不得再将运行时某次报错误写为模型通用最低 3686400 像素。连接测试优先读取 `/models`，不支持时使用缺失 prompt 的鉴权探测，禁止为测试生成计费图片。
18. **Canvas 写入冲突策略**：`CreateCanvasNodes`、`UpdateCanvasNodes`、`DeleteCanvasNodes`、`ConnectCanvasNodes`、`DisconnectCanvasEdges` 不使用 `expectedRevision`。写入采用 Last Write Wins；不要重新引入基于整个 `nodes` / `edges` 数组变化的全局版本拒绝，否则选择、拖动、输入或生成状态变化会误伤无关写操作。
19. **Canvas 分层读取**：Agent 不暴露整图 `GetCanvasState`。用 `GetCanvasOverview` 获取 `nodeCount`、`edgeCount`、类型/生成状态计数和节点的 `id/kind/title/generationStatus/hasOutput`；用 `GetCanvasNode` 获取单节点完整 `data`、位置及入边/出边摘要。用户已引用精确节点时直接调用 `GetCanvasNode`；异步生成也按节点轮询，禁止为单节点任务把整张画布塞入模型上下文。内部 `get-state` 保留给 `ReviewStoryboardVideo` 等不向模型回传整图的服务。
20. **媒体生成分辨率**：图片与视频尺寸统一定义在 `src/shared/media-dimensions.ts`，但必须分开映射。ComfyUI/Google 图片使用标准 2K：16:9 为 `2048×1152`、4:3 为 `2048×1536`、1:1 为 `2048×2048`；Seedream 5.0 使用官方 2K 参考尺寸 `2816×1584`、`2368×1776`、`2048×2048`。ComfyUI 图片工作流直接以其对应尺寸生成，禁止重新加入 RTX 放大。MiniMax H3 使用 1024 档：16:9 为 `1024×576`、4:3 为 `1024×768`、1:1 为 `1024×1024`。新增画幅或清晰度档时同时更新共享映射、工作流模板默认值、测试和 README。
21. **通用视频分析**：`AnalyzeVideo` 只接收 `videoUrl` 与 `analysisRequest`，不依赖画布和分镜审核结构。本地路径必须安全解析在当前项目目录内；远程地址只允许公开 HTTP(S)，拒绝显式 localhost、回环和私有 IP。结果按用户要求输出带时间戳证据的中文 Markdown 并保存至 `generated/analyses/`。通用分析不要复用 `ReviewStoryboardVideo` 的分镜审核关注点。
22. **项目媒体资产**：上传支持图片 `png/jpg/jpeg/webp/gif/bmp/avif`、视频 `mp4/webm/mov`、音频 `mp3/wav/m4a/flac/ogg/aac`。导入文件必须复制到当前项目 `uploads/` 后再写入节点，不能让 `sourcePath` 指向项目外绝对路径；资产列表只递归扫描 `generated/` 与 `uploads/`，不扫描 `.aigc-line` 或整个项目树。

## 常用命令

```bash
pnpm dev          # 开发（vite + electron 热重载）
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest 单元测试
pnpm test:e2e     # Playwright 端到端
pnpm build        # vite build + electron-builder 打包
```

## 维护本文档

- 新增/删除目录、节点类型、工作流、IPC 接口、Agent 工具时，更新对应小节。
- 踩到新的坑（像 zod 剥字段、VHS frame_rate 校验这类），追加到"开发注意事项"。
- 本文档过时的危害大于没有文档：改代码时顺手改它。
