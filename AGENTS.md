# AGENTS.md

> 给 AI 协作者和开发者的项目导览。**重要：任何功能改动（新增节点、新增工作流、改 IPC、改目录结构）都必须同步更新本文档，保持它与代码一致。**

## 项目简介

AIGC CANVAS：Electron 桌面应用，把 Claude Agent（对话）、React Flow 无限画布、ComfyUI 生成管线整合在一个项目工作区里，用于 AI 分镜视频创作。用户在聊天里让 Agent 创建"镜头 → 图片 → 视频"节点链，在画布上连边、调参、触发生成；生成结果落盘到项目目录并回显到节点。

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
| `electron/main/services/project.store.ts` | 项目持久化：清单、聊天记录、会话 id、画布快照（存项目目录下） |
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
- **Agent 对话**：Claude Agent SDK，流式输出，可中断；输入框键入 `/` 可搜索当前可用 Skill，SDK 的 `/clear` 等控制命令不会混入 Skill 菜单；标题栏“新建上下文”会确认后清空 Claude 记忆但保留历史/画布，并持久化上下文分界线；选中任意画布节点可通过“添加到对话”作为节点引用附件，Agent 会按节点 id 读取并精确修改；通过 MCP 工具读写画布（GetCanvasState / GetCanvasCapabilities / CreateCanvasNodes / UpdateCanvasNodes / ConnectCanvasNodes / InvokeNodeAction / PushArtifact 等）。工具状态监听 `PreToolUse` / `PostToolUse` / `PostToolUseFailure`；回合、流或应用结束后遗留的 `running` 调用会显示为“已中断”，不会永久 loading。
- **内置 Skill**：`aigc-canvas` 本地 Plugin 随应用打包并由 Agent SDK 加载；项目级 `.claude/skills` 仍可自动发现，应用不会向项目复制或覆盖 Skill。
  - `storyboard-production`：直接在画布创建和修改短剧分镜链。
  - `voiceover-to-video`：按旁白音频与 SRT 时间轴生成画面；图片提示词统一使用中文，图片与视频生成前分别取得用户明确确认，所有审核验证由新启动的独立子 Agent 执行；逐段变速对齐后交给 `jianying-draft` 创建剪映草稿。
  - `jianying-draft`：使用 pyJianYingDraft 生成剪映专业版草稿。
- **画布**：React Flow，缩放/框选/连线/删除；快照防抖自动保存；旧版分镜表节点自动迁移为独立镜头节点。
- **节点类型**（`CanvasNodeKind`）：
  - `shot` 镜头：精简的剧情定位节点，仅保存镜头号和镜头内容；提示词与时长归图片/视频节点
  - `text` 文本：剧情/旁白，可作提示词参考
  - `image` 图片：文生图 / 图生图（Flux2 Klein 9B、Z-Image Turbo），16:9 / 1:1 / 4:3
  - `video` 视频：MiniMax H3 文生视频 / 首尾帧 / 全模态参考（图片 9 + 视频 3 + 音频 3，提示词用 `<Picture n>` 等引用）
  - `audio` 音频：导入本地音频并预览
  - `upscale` 视频放大：RTX Video Super Resolution，连入视频节点作为输入（多输入可点选，`inputNodeId`），倍数 2x/3x/4x，质量 FAST/MEDIUM/HIGH/ULTRA，帧率经 VHS_VideoInfo 自动跟随源视频
- **ComfyUI 集成**：工作流模板在 `resources/comfyui-workflows/`，`comfyui.service.ts` 注入参数 → 排队 → 轮询 history → 下载到 `generated/images` 或 `generated/videos`。
- **设置页**：ComfyUI 地址、Agent API URL/token（safeStorage 加密）、默认文生图工作流。
- **自动更新**：electron-updater。

## 核心代码在哪里

| 要改什么 | 去哪里 |
|---|---|
| 画布交互/节点 UI/生成按钮 | `src/components/CanvasArea.tsx`（单文件，约 1800 行，含 PromptPanel / UpscalePanel / StoryNodeCard / CanvasFlow） |
| 新增节点类型 | 见下方"新增节点 checklist" |
| ComfyUI 生成逻辑、工作流参数注入 | `electron/main/services/comfyui.service.ts` |
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
9. **样式约定**：深色画布（`#0a0a0f` 底 + `#d4af37` 金强调色），Tailwind 原子类，跟随 CanvasArea 现有面板风格。
10. **内置 Skill 隔离**：内置 Skill 只能放在 `resources/claude-plugin/` 并通过 SDK `plugins` 加载；不要复制到项目 `.claude/skills`。新增 Skill 使用 kebab-case 目录名和包含 `name`、`description` 的 `SKILL.md`，并提升 `.claude-plugin/plugin.json` 版本。
11. **Skill 斜杠菜单**：`chat:listSkills` 扫描内置、项目和用户 Skill；活动 Query 的 `supportedCommands()` 只补充已发现 Skill 的元数据，不得把 `/clear`、`/batch` 等控制命令加入菜单。显式 `/<skill>` 必须保持在 Agent prompt 第一行；节点引用和附件上下文追加在命令之后。
12. **新建上下文**：通过 `chat:clearContext` 向 SDK 发送隐藏的 `/clear`，仅在 Agent 空闲时允许执行；吞掉该命令的 `(no content)`，完成后追加并持久化 `event: 'context-cleared'` 分界消息。不要自动删除聊天历史、画布或项目文件。
13. **旁白视频生成门与审核隔离**：`voiceover-to-video` 必须在实际生成图片、视频前分别询问并等待用户明确同意，重做也要重新确认；所有分镜、媒体和成片审核必须由每轮新启动的独立子 Agent 完成，主 Agent 不得自行验收；系统实际提交的图片提示词必须使用中文。

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
