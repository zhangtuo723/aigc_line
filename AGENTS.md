# AGENTS.md

> 给 AI 协作者和开发者的项目导览。**重要：任何功能改动（新增节点、新增工作流、改 IPC、改目录结构）都必须同步更新本文档，保持它与代码一致。**

## 项目简介

AIGC CANVAS：Electron 桌面应用，把 Claude Agent（对话）、React Flow 无限画布、Three.js 3D 导演台和 ComfyUI 生成管线整合在一个项目工作区里，用于 AI 分镜视频创作。用户在聊天里让 Agent 创建“参考图片 → 视频”节点链，在画布上连边、调参、触发生成；生成结果落盘到项目目录并回显到节点。生成片段直接由 video 节点承载，片段内生成 Shot 仍只存在于提示词时间线中；`director` 节点另有用于白模预演的可编辑 Shot/机位工程。

技术栈：Electron + Vite + React 19 + TypeScript + Tailwind CSS 4 + @xyflow/react（画布）+ Excalidraw（图片编辑台）+ Three.js / React Three Fiber（3D 导演台）+ zustand（状态）+ @anthropic-ai/claude-agent-sdk（Agent）+ zod（工具入参校验）。包管理用 pnpm。

## 目录结构

| 路径 | 作用 |
|---|---|
| `electron/main/` | Electron 主进程入口与服务 |
| `electron/main/index.ts` | 主进程入口：窗口、`local-file://` / `workspace://` 自定义协议（本地媒体预览、Range 视频流；`.aigc-line` 默认拒绝，仅白名单只读画板预览 PNG）、注册全部 IPC handler |
| `electron/main/ipc/` | IPC handler 层，只做参数转发 + 错误包装，业务逻辑在 services |
| `electron/main/services/` | 主进程业务服务 |
| `electron/main/services/agent/` | Agent 子系统：会话、流式输出、MCP 工具、系统提示词、画布桥接 |
| `electron/main/services/agent/tools.ts` | Agent 的 MCP 工具定义（zod schema 在这里） |
| `electron/main/services/agent/prompts.ts` | Agent 系统提示词（分镜创作规范） |
| `electron/main/services/agent/builtin-plugin.ts` | 解析开发/打包环境中的内置 Claude Plugin 路径并生成 SDK 配置 |
| `electron/main/services/agent/skills.ts` | 枚举当前可用 Skill：活动 SDK 会话 + 应用内置、项目级、用户级目录兜底 |
| `electron/main/services/comfyui.service.ts` | ComfyUI 全部交互：工作流模板注册、参数注入、上传媒体、排队、轮询、下载结果 |
| `electron/main/services/google-image.service.ts` | Google Gemini 图片生成：Nano Banana 2 / Pro 的 2K 文生图与最多 14 张有序参考图生成，产物写入项目目录 |
| `electron/main/services/seedream-image.service.ts` | 火山方舟 Seedream 图片生成：Doubao-Seedream-5.0-pro / lite 的 2K 文生图与最多 10 张有序参考图生成，产物写入项目目录 |
| `electron/main/services/seedance-video.service.ts` | 火山方舟 Seedance 2.0 视频生成：Agent Plan 异步任务提交/轮询、项目内全模态参考素材编码、结果下载与落盘 |
| `electron/main/services/google-network.service.ts` | Google API 网络层：使用 Electron 网络栈、可选独立 HTTP/HTTPS/SOCKS 代理及可读网络错误 |
| `electron/main/services/qwen-video-analysis.service.ts` | 通用 Qwen 视频分析：接受项目内视频路径或公开 HTTP(S) URL，顺序扫描完整画面与音轨，按自由要求给出带时间证据、事实/转写/推断边界和不确定性的报告 |
| `electron/main/services/project.store.ts` | 项目持久化：清单、追加式 JSONL 聊天事件日志、会话 id、画布快照（存项目目录下） |
| `electron/main/services/project-media.service.ts` | 项目媒体资产：把本地图片/视频/音频复制到 `uploads/`，保存导演台构图、预演视频与画板导出到 `generated/director-stills/`、`generated/director-videos/`、`generated/image-edits/`，保存画板节点缩略图到 `.aigc-line/board-previews/`，扫描 `generated/` 与 `uploads/` 供资产面板使用 |
| `electron/main/services/settings.service.ts` | 应用设置：ComfyUI 地址、Agent API、token（safeStorage 加密） |
| `electron/main/services/message-hub.ts` | 主进程内部事件总线（Agent 事件 → 渲染进程推送） |
| `electron/preload/index.ts` | preload：`window.electronAPI` 的唯一出处，渲染进程只能用它访问主进程 |
| `src/shared/` | 主进程与渲染进程共享的代码 |
| `src/shared/ipc.types.ts` | 全部 IPC 请求/响应类型 + `CanvasNodeKind` + 节点 data 结构 |
| `src/shared/ipc.channels.ts` | IPC 通道名常量（唯一定义处） |
| `src/shared/node-capabilities.ts` | 节点能力注册表：每种节点可读写哪些字段、可调用哪些动作（Agent 通过它发现能力） |
| `src/shared/director.types.ts` / `director-schema.ts` | 3D 导演台 v2 可序列化工程类型及共享严格 Zod schema：元素、Transform、Shot、人物路径、相机关键帧/跟随约束与 IPC 结果 |
| `src/components/CanvasArea.tsx` | 画布核心：节点渲染、连线、工具栏、生成动作、canvas command 处理（agent 操作画布的入口） |
| `src/components/canvas-capabilities.ts` | 内置节点 kind 的能力声明（在这里注册新节点类型） |
| `src/features/director/` | 3D 导演台：白模/道具编辑、人物路径、多机位与跟拍约束、构图截图与工程校验 |
| `src/features/image-editor/` | 自由画板：无需输入即可打开全屏 Excalidraw，也可按连线载入图片；自动保存可序列化场景，多选内容右键导出 PNG 并回写画布输出节点 |
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
- **Agent 对话**：Claude Agent SDK，流式输出，可中断；输入框键入 `/` 可搜索当前可用 Skill，并支持直接粘贴 PNG/JPEG/WebP/GIF 图片作为附件（写入项目 `uploads/images/` 后预览、发送与持久化），SDK 的 `/clear` 等控制命令不会混入 Skill 菜单；标题栏“新建上下文”会确认后清空 Claude 记忆但保留历史/画布，并持久化上下文分界线；选中任意画布节点可通过“添加到对话”作为节点引用附件，Agent 会按节点 id 读取并精确修改；通过 MCP 工具读写画布（GetCanvasOverview / GetCanvasNode / GetCanvasCapabilities / CreateCanvasNodes / UpdateCanvasNodes / ConnectCanvasNodes / InvokeNodeAction / AnalyzeVideo / PushArtifact 等）。`GetCanvasOverview` 只返回无版本号的节点计数与轻量摘要，`GetCanvasNode` 按单个 ID 返回完整节点数据及其连接摘要；整图 `get-state` 仅供主进程内部服务使用。`AnalyzeVideo` 是与画布无关的通用工具，接受项目内视频路径或公开 HTTP(S) URL 和自由分析要求，固定调用 Qwen3.5-Omni Plus 顺序扫描完整画面与音轨，区分观察、转写与推断，以时间戳和不确定性说明支撑关键结论，并把 Markdown 报告保存到 `generated/analyses/`。聊天、工具状态、Artifact 和回合结束的实时 IPC 推送均携带 `projectId`，渲染进程只接收当前项目事件；项目历史异步加载也必须在写入状态前复核当前项目，避免切换竞态串线。工具状态监听 `PreToolUse` / `PostToolUse` / `PostToolUseFailure`；回合、流或应用结束后遗留的 `running` 调用会显示为“已中断”，不会永久 loading。
- **内置 Skill**：`aigc-canvas` 本地 Plugin 随应用打包并由 Agent SDK 加载；项目级 `.claude/skills` 仍可自动发现，应用不会向项目复制或覆盖 Skill。
  - `voiceover-to-video`：按旁白音频与 SRT 时间轴生成画面；图片提示词统一使用中文，视频提示词按一个节点内多个带时间段的子分镜描述统一风格、运镜、转场与音效；禁止生成 BGM，但允许不遮盖旁白的环境音和拟音。图片与视频生成前分别取得用户明确确认；生成视频后只核对节点状态和产物路径，逐段变速对齐后交给 `jianying-draft` 创建剪映草稿。
  - `script-to-drama-video`：统一承接短剧创作、分镜规划、导演包编写、现有 image → video 链修改和连续性修复；先做戏剧节拍与人物调度，再按切镜理由拆成 5/10/15 秒生成片段与片段内 Shot，每个片段直接对应一个 video 节点。生成后核对节点状态和产物路径，不自动执行视频审核。详细导演方法放在 `references/directing-and-continuity.md`，人物参考、场景参考和 H3 prompt 分别强制委派给下面三个独立 Skill。
  - `character-reference-generation`：每个角色先生成唯一身份底图，再以底图为单一参考通过图生图派生不同场景/服装/妆造/状态版本；所有图片均为从左到右“头部近景、自然站立全身正面、侧面、背面”的横向四联图，三个全身角度禁止 A-pose/T-pose。3D、半写实、国漫/游戏/影视 CG 人物必须读取 `references/3d-character-prompt-template.md`，按角色档案替换模板中的年龄、性别、身高、体型、骨相和服装示例。
  - `environment-reference-generation`：为每个去重后的 `sceneId` 生成无人高机位斜俯视空间全景图，固定布局、出入口、行动路线、材质和主光方向；不生成普通平视图、垂直鸟瞰平面图、二维户型图或多视图拼贴，生成前必须取得用户明确确认。
  - `h3-prompt-writing`：MiniMax H3 官方提示词写作 Skill，负责 T2VA / I2VA / FL2VA / L2VA / Ref2VA 的最终提示词格式、引用标签、时间戳、对白和声音字段；`script-to-drama-video` 提供完整逐片段导演包、片段内 Shot 时间线及真实引用数组顺序，并在 Ref2VA 视频生成或重做时调用它，不自行复制或猜测官方格式。
  - `jianying-draft`：使用 pyJianYingDraft 生成剪映专业版草稿。
- **画布**：React Flow，缩放/框选/连线/删除；快照防抖自动保存；支持 `image-editor` 自由画板节点。旧版分镜表以及已废弃的 shot/text 节点自动迁移/清理为 image → video 链，旧文本内容会在目标 prompt 为空时转入直接相连的图片或视频。
- **Excalidraw 自由画板**：`image-editor` 无需任何输入即可打开全屏空白工作区并使用画笔、图形、箭头和文字。连入其 target 的、已有 `sourcePath` 的 image 节点会作为可选择、移动、缩放和旋转的普通图片元素载入。绘制元素、当前连接图片的变换和安全的 appState 子集保存在节点只读字段 `boardState`，编辑时 600ms 防抖写回，关闭时同步刷新；重开时按稳定元素 ID 合并当前连接素材，断开的输入会移除。关闭画板时必须截取当前可视区域中心的 16:9 PNG 到 `.aigc-line/board-previews/<nodeId>.png`，写入 `boardPreviewPath/boardPreviewUpdatedAt`，节点卡片优先显示该截图；尚无截图时才以最多九格网格显示输入素材，超出部分显示剩余数量。图片必须通过画布连线进入，Excalidraw 自带的本地图片插入工具禁用，画布快照严禁写入图片 data URL。画板 portal 必须带 `data-canvas-node-editor-dialog` 与 `data-image-editor-dialog`；通用编辑器标记存在期间 `handleNodesChange` 必须过滤 React Flow 的 remove change，使 Delete/Backspace 只删除 Excalidraw 选中元素，不能删除底层画布节点。画板不提供右上角整图保存；用户框选或 Shift 多选元素后右键“导出所选素材”，将所选内容合成为 PNG 并安全保存到 `generated/image-edits/`，随后在外部画布创建只读 image 节点和 `image-editor → image` 输出连线。同一会话允许重复导出多个结果；PNG 写回前必须复核项目和画板节点，若导出基于连接图片还须复核该输入节点，并校验 PNG 头、IEND、真实尺寸、50MB 大小上限与 8192px 边长上限。
- **3D 导演台**：`director` 节点按需懒加载 Three.js 全屏编辑器；v2 工程支持演员白模、群众阵列，以及立方体、球体、圆柱、墙体、地面、平台、六级楼梯、楔形斜坡、圆锥和胶囊体基础搭景素材，全部可移动/旋转/缩放、显隐和锁定。人物支持姿势、多机位、导演/机位视角、FOV/Roll、16:9 / 9:16 / 4:3 / 1:1 画幅和 24fps Shot 工程。场景元素的 Transform、姿势和显隐是工程级全局数据，切换 Shot 不得保存或恢复独立布局；每个 Shot 只保存机位、关键帧、相机约束、人物路径、时长和画幅。演员可在地面或基础几何模型表面点击绘制 Shot 内 XYZ 空间路径，沿三轴拖拽控制点、切换折线/平滑插值，并设置起止帧、行走/奔跑及自动朝向；底部人物轨道、播放、时间线拖动和 WebM 导出均按帧确定性采样三维人物位置与白模步态。导演视角显示当前 Shot 的最终相机运动轨迹；相机除自由关键帧外支持锁定注视演员和按演员朝向保持局部偏移的跟随模式，人物先采样、相机约束后求值。Agent 除更新完整 `directorProject` 外，可通过 `InvokeNodeAction` 的 `add-element`、`add-shot`、`set-actor-path`、`set-camera-constraint`、`set-camera-keyframe` 原子修改导演台。导演视角选中自由机位后复用 TransformControls：移动修改当前帧摄影机位置，旋转修改 target 并保留 Roll，拖动结束时一次性写入关键帧。镜头时长决定时间线终点；缩短时长会同时裁剪相机关键帧与人物路径范围。工程随画布节点持久化并通过共享严格 schema 和语义校验；旧 v1 工程不迁移，带旧 `elementStates` 的 v2 工程加载时移除该字段并保留全局元素布局。导演台 portal 必须带 `data-canvas-node-editor-dialog` 与 `data-director-stage-dialog`，打开期间 Delete/Backspace 不得删除底层导演台节点。拍摄或导出期间冻结编辑、强制保留地面网格并复用同一画幅裁切矩形；PNG 构图与 24fps WebM 预演分别安全保存并创建相连的只读图片/视频节点，每个异步阶段都要拒绝项目切换或源节点消失后的写回。
- **节点显示尺寸**：`image` / `video` 节点使用 620px 宽媒体卡，预览区按所选画幅自动计算高度，prompt 输入框最小高度为 140px；图片/视频工作流选择器使用加宽触发框和下拉菜单以完整展示模型名称与类型标签；全模态参考轨保留图片/视频/音频数量显示和上限校验，但不再额外显示引用标签说明框。
- **3D 导演台默认工程**：新建 director 工程的元素清单为空，不预置演员、群众或几何道具；仍保留一个默认 Shot/机位，供时间线、机位视角、截图和导出使用。损坏或不支持版本回退时也生成同样的空元素工程。
- **3D 导演台素材工具栏**：演员、群众和全部基础几何的添加入口不占用左侧栏；导演视角下统一放在视口底部、时间线上方的横向悬浮工具栏，按“人物 / 常用几何 / 建筑与路径表面”分隔。工具栏允许横向滚动以适配窄视口，拍摄/导出冻结期间禁用；机位视角隐藏，避免与机位移动提示重叠。左侧栏只保留连线参考图、Agent 搭景要求和场景清单。
- **3D 导演台自动保存**：编辑器内元素、Shot、人物路径、相机与场景设置变更后 600ms 防抖写回 director 节点，再由画布快照机制落盘；Header 显示等待/保存中/已自动保存/错误状态。工程语义校验失败时禁止自动保存。原“取消”按钮改为“关闭”；关闭、显式“保存并返回画布”或提交参考图 Agent 搭景前必须同步刷新最后一次草稿，避免防抖窗口内丢失修改。
- **3D 导演台物体激活与变换隔离**：导演视角中的场景元素只允许双击模型激活，单击只拦截当前射线且不得改变选中；只有已激活元素才显示 TransformControls 并可移动、旋转或缩放，顶部工具条显示“双击场景物体激活”或当前激活名称。元素列表中的明确点击仍可直接激活，人物路径绘制和路径点选择仍使用单击。TransformControls 开始拖动时锁定当前元素 ID并重新确认其选中状态，拖动结束才解除；锁定期间，相邻或后方模型的重叠射线命中以及 Canvas `onPointerMissed` 均不得切换或清空选中。
- **3D 导演台人物白模**：主演员通过 `actorModelId` 走可替换模型注册层，当前 `director-rig-v1` 使用 `public/models/ue-mannequin-retopology.glb` 的真实 SkinnedMesh/骨骼与 `SkeletonUtils.clone` 实例隔离，`lightweight-v1` 是适合远景、群众和加载失败兜底的程序化白模；群众创建时固定优先轻量模型。GLB 原作者和 Sketchfab Standard 资产许可必须随 `public/models/ue-mannequin-retopology.license.txt` 与同目录 README 保留，不能把项目源码的 MIT 许可误用于模型。人物支持 `standard/heavy/slim/short/tall` 五种非等比体型，骨骼模型通过骨盆、脊柱、锁骨、四肢和头骨缩放实现，轻量模型通过独立身体比例实现，不能用统一缩放冒充体型。动作支持自然站立、行走、坐姿、抱臂、指向、单膝跪地、叉腰、挥手、举手、蹲下、前倾和回头；两种模型共用动作语义，路径播放仍以行走/奔跑步态覆盖静态动作。轻量白模双脚鞋头固定指向模型正面，脸部正面带眼镜和嘴巴标识；“单膝跪地”必须降低骨盆并表现一条承重腿和一条落地膝。模型注册与体型参数集中在 `src/features/director/actor-model.ts`，GLB 骨骼应用在 `RiggedActorModel.tsx`，不得改变持久化 `actorModelId/bodyType` 语义。

- **导演台人物脚底锚点**：`DirectorElement.transform.position` 和人物路径点统一表示人物鞋底的世界坐标，TransformControls 必须绑定同一个根节点。轻量白模用 `actor-foot-anchor.ts` 的 `directorLightweightFootOffset` 按双腿、膝盖、鞋体几何和当前步态计算最低鞋底偏移，禁止使用固定经验高度；该 Three.js 几何计算必须保持在导演台懒加载边界内，不能放进会被首屏引用的 `actor-model.ts`。骨骼白模应用姿势后按精确包围盒归零，并把世界高度差除以父级世界缩放后再写入本地偏移。体型、身高、姿势或步态变化不得改变根节点与路径点的坐标语义。
- **3D 导演台参考图搭景**：参考图来源严格等于连入导演台 target 的、有 `sourcePath` 输出的 image 节点，不扫描全画布，也不接受导演台指向图片的反向出边；编辑器直接显示连接图片的预览与名称，多图时点击缩略图选择，断开连接后立即移除。提交时保存当前工程，再向当前项目 Agent 会话发送带导演台/图片精确节点引用的可见消息；若 Agent 正忙则拒绝提交。Agent 用 GetCanvasNode 取得项目内 `sourcePath`，再用 Read 和当前多模态模型理解图片，不调用独立视觉模型；结果通过 `apply-scene-draft` 原子动作写入。共享 schema 只接受最多 40 个 `box/wall/cylinder/sphere/floor/platform/stairs/ramp/cone/capsule`、严格 Transform、十六进制颜色以及必填的 `ground/elevated` placement。基础几何使用底面锚点：`scale.y` 是完整高度，`position.y` 是底面离地高度；ground 元素在 mutation 层强制归零，避免模型按中心坐标理解导致悬浮，只有屋顶、横梁、招牌等真实离地结构使用 elevated 并保留高度。相同 `referenceNodeId` 重做时只替换其未锁定几何；存在锁定几何时明确报错，保留演员、其他参考图几何、手工道具和机位。
- **媒体上传与资产库**：画布左侧独立工具栏提供“上传”和“资产”按钮。上传可多选本地图片、视频、音频，文件复制到当前项目 `uploads/<类型>/` 后自动创建对应节点；资产面板扫描当前项目 `generated/` 与 `uploads/` 下的可预览媒体，支持按类型筛选、刷新，并可拖到画布落点创建节点。媒体文件始终通过 `workspace://<projectId>/...` 预览。
- **前端隔离与异步状态**：HTML Artifact iframe 不得同时启用脚本与同源权限，当前使用无同源权限的 sandbox；画布快照加载和图片/视频/放大结果回写必须复核发起时的项目，防止切换项目后串写。Agent 运行状态按 `projectId` 保存，切回后台运行项目时仍能显示状态和停止按钮。ComfyUI 工作流列表在渲染进程共享缓存，避免每个节点重复 IPC 查询。
- **画布写入语义**：Canvas MCP 写工具按节点 ID/字段直接应用，采用最后写入者生效（Last Write Wins），不接收或校验全局画布版本号；仍校验节点存在性、ID 唯一性、字段能力和连线合法性。
- **节点类型**（`CanvasNodeKind`）：
  - `image` 图片：ComfyUI 的 Krea 2 Turbo、Z-Image Turbo 当前仅文生图；Nano Banana 2 / Pro 支持最多 14 张有序参考图，Doubao-Seedream-5.0-pro / lite 支持最多 10 张有序参考图；画幅支持 16:9 / 9:16 / 1:1 / 4:3，全部模型使用 2K 输出，ComfyUI 图片工作流直接保存 VAE 解码结果且不经过 RTX 放大
  - `image-editor` 画板：可直接打开空白 Excalidraw，也可把所有连入的有效图片作为普通元素载入；`boardState` 自动保存矢量场景和连接图片变换但不保存图片 data URL；多选右键导出后创建相连的只读 image 输出节点
  - `video` 视频：MiniMax H3 文生视频 / 首尾帧 / 全模态参考（图片 9 + 视频 3 + 音频 3，提示词用 `<Picture n>` 等引用），全模态参考可选择标准 20 步或带 Turbo 8 步 LoRA 的加速工作流；也支持火山方舟 Agent Plan Doubao Seedance 2.0 文生视频与全模态参考，提示词用“图片 n / 视频 n / 音频 n”引用素材，默认 720p 并生成同步音频
  - `audio` 音频：导入本地音频并预览
  - `upscale` 视频放大：RTX Video Super Resolution，连入视频节点作为输入（多输入可点选，`inputNodeId`），倍数 2x/3x/4x，质量 FAST/MEDIUM/HIGH/ULTRA，帧率经 VHS_VideoInfo 自动跟随源视频
  - `director` 3D 导演台：保存严格 v2 的可序列化 `directorProject`，包含全局稳定元素 ID/Transform/姿势、可锁定 Shot、人物路径、相机位置/目标/FOV/Roll、24fps 关键帧和注视/跟随人物约束；最近构图路径写入 `sourcePath`
- **图片/视频生成集成**：ComfyUI 工作流模板在 `resources/comfyui-workflows/`，`comfyui.service.ts` 注入参数 → 排队 → 轮询 history → 下载结果；默认 ComfyUI 文生图为 `krea2-turbo-t2i`，使用 `krea2_turbo_fp8_scaled.safetensors` 和 8 步 Euler/simple 采样，Krea 2 Turbo 与 Z-Image Turbo 均直接以标准 2K 尺寸生成并保存，图片工作流不包含 RTX 放大节点；旧 Flux2 Klein 文生图/图生图工作流已移除且旧默认设置自动迁移到 Krea 2 Turbo。`minimax-h3-r2v` 是标准全模态参考，`minimax-h3-r2v-turbo` 是加载 `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` 的 8 步加速版本，两者共用相同参考轨语义；MiniMax H3 视频使用 1024 档，16:9 / 9:16 / 4:3 / 1:1 分别为 1024×576 / 576×1024 / 1024×768 / 1024×1024。火山方舟 `seedance-2.0` 工作流使用模型 `doubao-seedance-2-0-260128`，通过 `/contents/generations/tasks` 异步提交与轮询，支持 5/10/15 秒文生视频和最多 9 图 + 3 视频 + 3 音频的项目内参考素材，默认 720p、同步音频、无水印，完成后下载到 `generated/videos/`。ComfyUI/Google 图片使用标准 2K 映射：16:9 为 2048×1152、9:16 为 1152×2048、4:3 为 2048×1536、1:1 为 2048×2048；Seedream 使用官方 2K 参考尺寸 2816×1584、1584×2816、2368×1776、2048×2048。Google Gemini 图片 API 由 `google-image.service.ts` 调用 Nano Banana 2 / Pro；火山方舟图片 API 由 `seedream-image.service.ts` 调用 Doubao-Seedream-5.0-pro / lite；两者固定生成 2K 图片并支持项目内参考图。
- **设置页**：宽屏使用基础服务双栏、AI 云服务三栏布局，同一排的配置卡片等宽等高；可配置 ComfyUI 地址、Agent API URL/token、Google AI Studio API key 与可选代理、火山方舟 Seedream/Seedance 普通 API 或 Agent Plan Base URL/key、Qwen3.5-Omni Plus API URL/key 和默认生图模型，并提供 ComfyUI/Google AI/Qwen/方舟连接测试。方舟 Base URL 会自动移除用户误粘贴的一个或多个 `/images/generations` 后缀。Qwen/Google Key 使用 safeStorage；方舟 Key 按用户要求明文保存在本机 `settings.json`。所有配置统一使用页面顶部“保存配置”，方舟配置保存后再次读取主进程设置确认落盘，并在卡片内显示“已保存”与清除选项。
- **自动更新**：electron-updater。

## 核心代码在哪里

| 要改什么 | 去哪里 |
|---|---|
| 画布交互/节点 UI/生成按钮 | `src/components/CanvasArea.tsx`（单文件，约 1800 行，含 PromptPanel / UpscalePanel / StoryNodeCard / CanvasFlow） |
| 3D 导演台/白模/机位/Shot | `src/features/director/DirectorStageDialog.tsx` + `director-model.ts` + `src/shared/director.types.ts` |
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
13. **旁白视频生成门**：`voiceover-to-video` 必须在实际生成图片、视频前分别询问并等待用户明确同意，重做也要重新确认；系统实际提交的图片提示词必须使用中文；每个视频提示词必须包含覆盖完整时长的一个或多个连续子分镜，默认优先可执行的单一连续 Shot，只有新增信息、关键反应或空间关系变化时才切镜；禁止 BGM，但可生成不遮盖原旁白的同步环境音和拟音。视频生成后只核对节点状态和 `sourcePath`，不自动执行质量审核。
14. **剧本深化、导演方法、资产委派与片段层级**：`script-to-drama-video` 是唯一通用短剧分镜 Skill；`storyboard-production` 已删除。默认保留核心人物关系、事实、冲突、因果和结局方向，允许为视听表达补足动作、反应、潜台词、必要对白/旁白和声画衔接；改变核心动机、关键事件或结局必须先确认。先按 `references/directing-and-continuity.md` 建立节拍、blocking、切镜理由和连续性账本，再拆成可独立生成的 5/10/15 秒片段；每个片段直接创建一个 video 节点，片段内 Shot 使用连续时间范围写入导演包和 prompt，不创建 Canvas 节点。人物图必须调用 `character-reference-generation`：每个 `characterId` 先生成唯一身份底图，审核合格并取得 `sourcePath` 后，再由该底图直接连接所有场景/服装变体并通过单参考图图生图生成；禁止变体链式派生和不同场景独立文生图，底图重做后全部变体都要重做。场景图必须调用 `environment-reference-generation` 生成无人斜俯视空间全景，禁止在生产 Skill 内维护 prompt template。视频固定使用 `minimax-h3-r2v`，最终 Ref2VA prompt 必须调用 `h3-prompt-writing`。
16. **设置版本与持久化校验**：Vite 可能只热更新渲染进程而 Electron 主进程仍为旧版本。设置页必须验证 `get/saveAppSettings` 返回值包含 Qwen、Google AI 与 Seedream 字段；缺失时提示完全重启，不能误报保存成功。主进程写入设置后必须重新读取并验证 URL 与 Key。Seedream 普通 API Base URL 为 `https://ark.cn-beijing.volces.com/api/v3`，Agent Plan Base URL 为 `https://ark.cn-beijing.volces.com/api/plan/v3`；设置、测试和运行时均须规范化完整生图地址，避免重复追加 `/images/generations`。Qwen / Google AI API Key 使用 safeStorage 加密并回填；Seedream API Key 按用户要求使用 `seedreamApiKey` 字段明文保存、回填和清除，保存新值时删除旧 `encryptedSeedreamApiKey`。Agent Token 仍不回显。
17. **Google 图片生成**：Nano Banana 2 固定使用 `gemini-3.1-flash-image`，Nano Banana Pro 固定使用 `gemini-3-pro-image`，两者共用 Google AI Studio API Key。REST 请求必须使用 `generationConfig.imageConfig` 发送画幅简写与 `imageSize: "2K"`；不要使用 `responseFormat.image`，该 v1 端点会把画幅和尺寸按 `ImageResponseFormat` 枚举解析并对简写、符号枚举均返回 HTTP 400。最多 14 张参考图按 `referenceImageNodeIds` 顺序发送，只允许读取当前项目目录内的相对路径，单张不超过 20 MB。Google Key 按 Qwen Key 的持久化方式保存、回填与校验。请求必须经 `google-network.service.ts` 使用 Electron 网络栈；无法直连时可配置独立的 HTTP/HTTPS/SOCKS 代理，网络错误需保留底层原因而不是只显示 `fetch failed`。
   - **Seedream 图片生成**：只注册 Doubao-Seedream-5.0-pro（API 模型 ID `doubao-seedream-5-0-260128`）与 Doubao-Seedream-5.0-lite（`doubao-seedream-5-0-lite-260128`），通过火山方舟 `/images/generations` 调用。API Base URL 与 Key 可配置，Key 明文保存在本机设置并支持 `ARK_API_KEY` 环境变量兜底；最多 10 张参考图按 `referenceImageNodeIds` 顺序以 `image` 数组发送，只能是当前项目内单张不超过 10 MB 的 PNG/JPEG。单节点固定关闭组图；2K 尺寸使用官方参考值：16:9 `2816×1584`、9:16 `1584×2816`、4:3 `2368×1776`、1:1 `2048×2048`。Seedream 5.0 Pro 自定义宽高的官方总像素范围从 `1280×720`（921600）起，不得再将运行时某次报错误写为模型通用最低 3686400 像素。连接测试优先读取 `/models`，不支持时使用缺失 prompt 的鉴权探测，禁止为测试生成计费图片。
   - **Seedance 视频生成**：注册 Doubao-Seedance-2.0（API 模型 ID `doubao-seedance-2-0-260128`），复用方舟 Base URL 与 Key。创建任务后按任务 ID 轮询 `queued/running/succeeded/failed/cancelled/expired`，成功后立即下载临时 `video_url`。项目内参考素材必须经过 realpath 边界检查并按 data URI 发送；上限为图片 9 张（单张 30 MB）、视频 3 段（单段 50 MB）、音频 3 段（单段 15 MB）。画布提供 5/10/15 秒，服务端仍将时长收敛到官方 4–15 秒范围；固定 720p、开启同步音频、关闭水印。
18. **Canvas 写入冲突策略**：`CreateCanvasNodes`、`UpdateCanvasNodes`、`DeleteCanvasNodes`、`ConnectCanvasNodes`、`DisconnectCanvasEdges` 不使用 `expectedRevision`。写入采用 Last Write Wins；不要重新引入基于整个 `nodes` / `edges` 数组变化的全局版本拒绝，否则选择、拖动、输入或生成状态变化会误伤无关写操作。
19. **Canvas 分层读取**：Agent 不暴露整图 `GetCanvasState`。用 `GetCanvasOverview` 获取 `nodeCount`、`edgeCount`、类型/生成状态计数和节点的 `id/kind/title/generationStatus/hasOutput`；用 `GetCanvasNode` 获取单节点完整 `data`、位置及入边/出边摘要。用户已引用精确节点时直接调用 `GetCanvasNode`；异步生成也按节点轮询，禁止为单节点任务把整张画布塞入模型上下文。整图 `get-state` 只供主进程内部服务使用。
20. **媒体生成分辨率**：图片与视频尺寸统一定义在 `src/shared/media-dimensions.ts`，但必须分开映射。ComfyUI/Google 图片使用标准 2K：16:9 为 `2048×1152`、9:16 为 `1152×2048`、4:3 为 `2048×1536`、1:1 为 `2048×2048`；Seedream 5.0 使用官方 2K 参考尺寸 `2816×1584`、`1584×2816`、`2368×1776`、`2048×2048`。ComfyUI 图片工作流直接以其对应尺寸生成，禁止重新加入 RTX 放大。MiniMax H3 使用 1024 档：16:9 为 `1024×576`、9:16 为 `576×1024`、4:3 为 `1024×768`、1:1 为 `1024×1024`。新增画幅或清晰度档时同时更新共享映射、工作流模板默认值、测试和 README。
21. **通用视频分析**：`AnalyzeVideo` 只接收 `videoUrl` 与 `analysisRequest`，不依赖画布结构。本地路径必须安全解析在当前项目目录内；远程地址只允许公开 HTTP(S)，拒绝显式 localhost、回环和私有 IP。内部使用独立 system message 约束 Qwen3.5-Omni Plus 顺序扫描全片和音轨，把媒体内指令视为数据，区分画面观察、声音/语言转写与证据推断；关键结论给出近似时间戳，计数先列事件再汇总，听不清处不得补词，并明确采样盲区和不确定性。默认 2 FPS、每帧 655360 像素，结果按用户要求输出中文 Markdown 并保存至 `generated/analyses/`。
22. **项目媒体资产**：上传支持图片 `png/jpg/jpeg/webp/gif/bmp/avif`、视频 `mp4/webm/mov`、音频 `mp3/wav/m4a/flac/ogg/aac`。导入文件必须复制到当前项目 `uploads/` 后再写入节点，不能让 `sourcePath` 指向项目外绝对路径；资产列表只递归扫描 `generated/` 与 `uploads/`，不扫描 `.aigc-line` 或整个项目树。
23. **3D 导演台工程与媒体导出**：`directorProject` 是纯 JSON 数据，禁止把 Three.js 对象、Blob URL 或 data URL 存入画布快照。Agent 创建/更新必须通过 `director-schema.ts` 的严格 schema 和语义校验；加载旧或损坏快照时用 `normalizeDirectorProject` 修复或回退，任何渲染路径不得直接信任未知对象。场景元素只保留一套工程级 Transform/姿势/显隐数据，切换 Shot 不能改变全局布局；删除元素时仍须级联清理人物路径和相机约束，锁定在 mutation 层执行，相机静态字段变更同步 frame 0。元素与机位 TransformControls 拖动期间只把最新 Transform 写入 ref，禁止在 mouseDown 或每个 `onObjectChange` 帧写 React 状态；OrbitControls 由 Drei 内置 `dragging-changed` 联动自动禁用。正常 mouseup 以及全局 `pointerup` / `pointercancel` / window blur 都必须把暂存 Transform 一次性提交，避免控件丢失 mouseup 后位置恢复。导演台 Portal 必须从 40px 应用标题栏下方开始并设置 `app-no-drag`，禁止把交互按钮放进 Electron drag region 或 Windows 原生窗口控制覆盖区；Header/Footer 还要建立高于 WebGL 主区域的独立层叠上下文并保留 pointer events。编辑器通过 React lazy import 按需加载，避免 Three.js 进入首屏主包。构图截图只能通过 `canvas:saveDirectorStill` 写入当前项目 `generated/director-stills/`；预演视频只能通过 `canvas:saveDirectorVideo` 写入 `generated/director-videos/`。两者共用画幅裁切矩形，拍摄/录制期间冻结编辑，每个 await 后复核项目和导演节点；主进程分别验证 PNG 与 WebM 头、完整性、大小并使用唯一文件名。导演台导出的只读 video 是预演素材，不替代 ComfyUI/云模型生成的正式片段。

- **导演台时间线视角语义**：拖动时间滑块、点击关键帧菱形或播放预演都会进入机位视角，以便立即检查当前帧的最终构图；编辑机位时再手动切回导演视角。

- **导演台剪辑式轨道**：底部时间线使用统一时间标尺、贯穿所有轨道的播放头和 `分:秒:帧` 时间码；机位关键帧与各人物动作片段在独立轨道中对齐显示，人物轨道过多时轨道头与片段区必须同步滚动。传输控制支持回到开头、逐帧前进/后退和播放/暂停；底部紧凑 Shot 条负责切换镜头，不能移除原有时间滑块的可访问语义与逐帧拖动能力。实时播放按 RAF 的小数帧采样人物和相机，避免 24fps 整帧状态更新造成跳动；小数帧只用于内部求值，界面帧号必须显示为固定宽度整帧，禁止长浮点字符串引发布局重排。每次播放必须用运行令牌拒绝旧 RAF 回写，并在开始时退出临时机位控制。机位位置、look-at、Roll、FOV 与投影矩阵必须在绘制前的同一个 layout effect 中原子同步，禁止先渲染新位置再用 passive effect 补旧朝向。拖动、逐帧按钮和 WebM 导出仍使用确定性的整帧语义。人物路径展开结果与弧长必须按不可变轨道对象缓存，骨骼白模不得随每个步态相位重复执行精确包围盒落地计算。

- **导演台全局场景布局**：人物与道具的 Transform、姿势和显隐只存放在 `project.elements`，所有 Shot 共享同一套场景布局。`DirectorShot` 不包含 `elementStates`；`normalizeDirectorProject` 只为兼容已有 v2 项目而剥离旧字段，保存后不得再次写回。

- **导演台机位视角自由控制**：机位视角下 `W/S` 沿镜头朝向前后移动，`A/D` 沿镜头右向量左右移动，`Space/Ctrl` 按世界 Y 轴升降；按住鼠标左键拖动修改 yaw/pitch。连续控制期间只更新临时机位，松开全部移动键或鼠标时才一次性写入当前帧关键帧。

- **导演台变换快捷键**：场景元素的移动/旋转/缩放工具分别使用 `V` / `R` / `Z`；缩放禁止再使用 `S`，因为机位视角将 `S` 固定用于后退。

- **导演台人物路径与相机约束**：人物路径属于具体 Shot，每个演员最多一条，使用绝对 XYZ 世界坐标路径点、起止帧、linear/smooth、walk/run 与 `orientToPath`。路径绘制只响应 `Ctrl + 鼠标左键`，普通点击不得添加路径点；透明地面提供 `Y=0` 落点，全部非人物基础搭景素材的可见表面直接使用 R3F 世界交点，从而可沿楼梯、斜坡和高台取点。路径控制点 TransformControls 开放 X/Y/Z 三轴，并在拖动结束时扣除可视标记偏移后提交真实坐标，右侧同时提供精确 XYZ 数值编辑。刚开始绘制但未添加有效第二点就点击完成时，必须删除重复占位点轨道，不能留下阻止工程保存的无效路径。平滑路径先确定性展开为三维 Catmull-Rom 采样折线，再按三维弧长恒速采样，禁止累计上一帧位移。相机求值顺序固定为人物 Transform → 自由相机曲线 → look-at/follow 约束；follow 偏移位于人物局部坐标，轨迹辅助线显示约束后的最终机位。删除演员时必须级联删除其路径，并把引用该演员的相机约束重置为 free；缩短 Shot 时裁剪人物路径结束帧。

- **导演工程版本**：当前严格 schema 为 `version: 2`，不兼容也不迁移 v1；旧版本或结构损坏输入统一由 `normalizeDirectorProject` 回退为新的 v2 默认场景。

- **TransformControls 绑定对象**：必须用 `object={objectRef}` 直接绑定带 Transform 的场景元素；不要把已定位元素作为 children 包进 TransformControls 的内部 wrapper，否则实际拖动的是外层、持久化读取的是内层，重新选择元素时会恢复旧位置。

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
