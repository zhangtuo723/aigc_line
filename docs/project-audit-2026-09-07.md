# AIGC CANVAS 全项目优化检查

初检日期：2026-09-07；修复状态更新：2026-09-08。初检基于已包含 8 种室内/建筑模块的工作区，随后按本报告实施可靠性、性能与编辑体验修复。本文保留初检证据，并逐项标注当前进展。

## 本轮修复状态

下文各项中的“复现”“代码确认”、旧行号与测量值均为 **初检记录**，不能再作为当前版本仍存在同一缺陷的结论；每项开头的修复状态对应 2026-09-08 工作区。“已实现”表示代码及对应回归已落地，不等于所有设备、真实云服务和大规模性能验收完成。完整类型检查及 35 个单测文件 / 177 项已通过；Electron E2E 全量运行 18/19 通过，剩余原生关闭用例修正测试清理后单独通过，详见文末验证说明。

| 范围 | 当前状态 | 仍需注意 |
|---|---|---|
| 01–07 保存、聊天与生成可靠性 | 已实现核心修复 | 未知提交必须人工核实；同步生图中断没有可查询的远端 ID |
| 08–10 画板容错、锁定与逐帧导出 | 已实现 | 不同设备的 WebCodecs 兼容性和慢渲染性能仍需量测 |
| 11–16 大项目性能与资源、窄窗口 | 已完成针对性优化，部分目标保留 | 全量性能基线、后端聊天分页、检查点与更多面板隔离尚未完成 |
| 17–21 新增节点、配置保护、资源、可读性与撤销 | 功能已落地；全应用可访问性仍需专项检查 | 会话内历史不替代备份，也不撤销远端生成 |
| 22 整套场景组合 | 未实现 | 保留现有 20 种素材、分类搜索与复制；房间预设另行设计 |
| 23–24 类型与测试维护 | 双进程类型检查和故障回归已落地 | 大型组件只抽取相关模块，未全面重构；跨设备性能基线待补 |

关键实现入口：[快照与编辑刷新](../src/shared/snapshot-persistence.ts)、[原子文件队列](../electron/main/services/atomic-file.ts)、[生成任务服务](../electron/main/services/generation-task.service.ts)、[媒体读写预算](../electron/main/services/media-io.ts)、[WebCodecs 导出](../src/features/director/director-video-export.ts)、[WebM 末帧时长修正](../src/features/director/director-webm-duration.ts)。原子替换与关闭握手覆盖并发写和正常关闭，不承诺强制结束进程或断电后所有未保存编辑都能恢复。

## 结论与范围

优先解决保存、聊天状态和生成任务恢复，再优化大项目性能与编辑布局。现有框架可以继续使用，不需要为优化而重写 Electron、React Flow 或 Three.js。

覆盖项目与画布持久化、聊天流式事件、Agent 状态、生成服务、媒体读写、资产库、3D 导演台、Excalidraw、首页和设置页、构建与测试入口。采用源码审查、真实 Electron 隔离项目操作、真实存储函数故障复现、模拟远端服务以及合成数据测量。没有调用计费生成接口，也没有更改用户创作项目。

- **P1**：可能丢失工作、产生错误素材或重复生成成本，应优先修复。
- **P2**：影响状态可信度、常用操作或随项目增长而恶化，应进入近期迭代。
- **P3**：需要进一步设计或测量的增强项。
- **证据级别**：界面复现、隔离复现、代码确认、待压测分别标注；合成测量不代表所有设备上的实际帧率。

## 一、保存、状态与任务可靠性

### 01 · P1：最后一次编辑可能未保存，保存提示也早于落盘

**2026-09-08 修复状态：已实现。按项目保留最新待写快照，编辑器先提交、画布后保存；返回/关闭握手等待磁盘确认，等待期间阻止新编辑。失败保留草稿并可重试，超时不直接关窗。**

**界面复现 + 代码确认。** 在空项目添加图片节点，约 76ms 后返回首页，等待后重新打开，节点数仍为 0。画布保存有 700ms 防抖，组件卸载只取消计时器，没有刷新最后草稿。导演台自己的“已保存”只表示回写了 React 节点状态，后面还有同一层画布防抖；实际 IPC 失败也只有控制台日志。

- 位置：[CanvasArea.tsx:2391](E:/mycode/aigc_line/src/components/CanvasArea.tsx:2391)、[DirectorStageDialog.tsx:801](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:801)、[ProjectPage.tsx:46](E:/mycode/aigc_line/src/pages/ProjectPage.tsx:46)。
- 优化：建立按项目维护的待保存快照；离开项目、关闭编辑器及退出应用时刷新；保存状态等待磁盘确认，失败保留草稿并提供重试。
- 验收：连续编辑后立即返回、切项目或退出重开，内容不丢；模拟磁盘失败时不能显示“已保存”。

### 02 · P1：并发写快照与异常读取可能损坏或覆盖项目

**2026-09-08 修复状态：已实现。索引完整读改写通过同一事务队列；快照、清单和会话串行写入唯一临时文件后原子替换。只有 ENOENT 可视作新画布；读取/格式错误显示保护状态并停止自动覆盖。未新增断电级 fsync 保证。**

**隔离复现。** 同一快照共用 `.tmp` 文件且没有写队列。20 次并发保存，本次 16 次报 ENOENT，最终文件不是有效 JSON。项目索引只有创建串行，打开与删除的读改写可互相覆盖，复现了删除的项目重新出现。另一方面，快照读取把损坏 JSON、权限错误等统统转为 null，界面随后按空项目处理并允许保存。

- 位置：[project.store.ts:50](E:/mycode/aigc_line/electron/main/services/project.store.ts:50)、[project.store.ts:117](E:/mycode/aigc_line/electron/main/services/project.store.ts:117)、[project.store.ts:302](E:/mycode/aigc_line/electron/main/services/project.store.ts:302)、[canvas.handlers.ts:30](E:/mycode/aigc_line/electron/main/ipc/canvas.handlers.ts:30)。
- 优化：按文件串行完整事务，合并最新待写快照，使用唯一临时文件原子替换；索引必须串行整个读改写过程。只有文件不存在可当作空项目，其余失败应保留原件、暂停覆盖并提供恢复。
- 验收：并发/慢盘情况下最终 JSON 有效且为最新版本；坏文件不能被空画布静默覆盖。并发失败数量受调度影响，不能把本次比例当作日常发生率。

### 03 · P1：Codex 流式回复重复追加聊天气泡

**2026-09-08 修复状态：已实现。完整正文推送按消息 ID 更新，工具消息按工具 ID 合并，重复气泡回归已覆盖。**

**界面及隔离复现。** 对同一个 assistant 消息 ID 连续推送三个正文版本，界面出现三个气泡。Codex 适配层沿用同一 ID 推送完整正文，store 却对 assistant 事件始终 append。

- 位置：[app.store.ts:319](E:/mycode/aigc_line/src/stores/app.store.ts:319)、[codex-session.ts:106](E:/mycode/aigc_line/electron/main/services/agent/codex-session.ts:106)。
- 优化：按 projectId/messageId 更新或插入；明确全量正文与增量片段的事件约定，并防止迟到事件覆盖已完成状态。
- 验收：多次更新只保留一个气泡与唯一 React key，最终正文完整。本项确认的是当前界面/内存重复，不表示所有中间版本都重复持久化。

### 04 · P1：生成任务缺少独立于页面的持久化与恢复

**2026-09-08 修复状态：已实现核心恢复。任务在 .aigc-line/generation-tasks 按节点持久化；ComfyUI/Seedance 保存远端 ID，进入项目时用当前配置恢复原任务查询/下载，不重提。完成产物回填并保存快照后才 ack；音频提取核对源视频路径并使用稳定输出 ID。Google/Seedream 保存本地完成记录，但同步请求中断不能恢复远端结果。提交状态 unknown 时禁止自动重提，任务面板要求用户核实后确认解除限制，并保留归档；此操作不取消远端任务。ComfyUI 使用 queue/history 连续核对处理已消失任务。**

**隔离复现 + 代码确认。** Seedance 提交返回任务 ID 后，只要一次轮询断网就终止，错误结果不保留 ID。用户重试可能重新提交已在运行的计费任务。画布生成回写依赖已挂载的组件；返回首页后任务即使完成，节点产物关联也可能丢失，文件本身仍可能在 generated 目录。重新加载又会把 generating 直接重置为 idle。

- 位置：[seedance-video.service.ts:151](E:/mycode/aigc_line/electron/main/services/seedance-video.service.ts:151)、[seedance-video.service.ts:178](E:/mycode/aigc_line/electron/main/services/seedance-video.service.ts:178)、[comfyui.handlers.ts:50](E:/mycode/aigc_line/electron/main/ipc/comfyui.handlers.ts:50)、[CanvasArea.tsx:1998](E:/mycode/aigc_line/src/components/CanvasArea.tsx:1998)、[CanvasArea.tsx:2367](E:/mycode/aigc_line/src/components/CanvasArea.tsx:2367)。
- 优化：提交成功立即按项目/节点持久化 provider、taskId、状态和参数摘要；后台服务负责继续查询与产物关联，界面订阅状态。提供重试查询、重试下载与恢复入口，避免“重试”总是重新生成。
- ComfyUI 的 history 空结果轮询也没有结束分支，任务被清队列后可能永久等待：[comfyui.service.ts:452](E:/mycode/aigc_line/electron/main/services/comfyui.service.ts:452)。需要结合 queue/history 判定连续失踪并支持取消，保留合理的长队列等待能力。
- 验收：提交后断网、返回首页、切项目、重启，均能识别同一任务；只重试下载不产生第二次生成请求。

### 05 · P1：ComfyUI 同名参考文件会互相覆盖

**2026-09-08 修复状态：已实现。上传名称带 UUID，overwrite=false，工作流继续使用实际返回名称。未实现内容哈希去重或上传缓存。**

**隔离复现。** 上传只使用 basename，并设置 overwrite=true。`hero/reference.png` 和 `scene/reference.png` 都返回 `reference.png`，后上传的内容覆盖前者，工作流两个引用可能实际读到同一张图。跨项目共用 ComfyUI 也存在同样问题。

- 位置：[comfyui.service.ts:502](E:/mycode/aigc_line/electron/main/services/comfyui.service.ts:502)、[comfyui.service.ts:708](E:/mycode/aigc_line/electron/main/services/comfyui.service.ts:708)。
- 优化：按项目和内容哈希生成唯一名称或子目录，工作流使用实际返回路径；内容哈希还可复用已上传素材。
- 验收：同名不同内容、跨项目并行、图片/视频多参考都保持正确对应。复现使用模拟上传服务，没有执行真实生成。

### 06 · P2：历史加载与实时消息、活跃工具状态没有正确合并

**2026-09-08 修复状态：已实现。历史加载具有请求代次和项目选择代次，并合并期间的新消息；主进程只把没有活跃执行者的遗留工具标为中断。**

**隔离复现。** 历史请求发出后收到实时回复，随后历史返回，store 整体替换 messages，使刚收到的回复消失。只核对当前项目 ID 也不能区分 A→B→A 的两次加载。同一入口在主进程无条件把 running 工具标为 interrupted，切回仍运行的项目可能显示“已中断”。

- 位置：[app.store.ts:180](E:/mycode/aigc_line/src/stores/app.store.ts:180)、[chat.handlers.ts:109](E:/mycode/aigc_line/electron/main/ipc/chat.handlers.ts:109)。
- 优化：加载代次 + 消息 ID 合并，已收到的更新优先于旧历史；只有无实际执行者的遗留工具才归为中断。
- 验收：加载中推送回复、快速切换项目、后台工具继续运行时，消息和状态都正确。

### 07 · P2：发送失败无法恢复输入正文和文件附件

**2026-09-08 修复状态：已实现。输入等待异步提交结果，失败保留正文、文件及引用；成功确认也只清除同项目、同版本的已发送草稿，保留等待期间的新输入。**

**代码确认。** 输入组件不等待异步发送，立即清空正文和附件；后续失败只恢复节点/Artifact 引用，文本和本地文件选择没有恢复。

- 位置：[ChatInput.tsx:145](E:/mycode/aigc_line/src/components/ChatInput.tsx:145)、[ChatPanel.tsx:79](E:/mycode/aigc_line/src/components/ChatPanel.tsx:79)、[app.store.ts:233](E:/mycode/aigc_line/src/stores/app.store.ts:233)。
- 优化：为每次发送保留完整草稿和明确结果；失败消息提供重试/恢复编辑，不覆盖用户在等待期间新输入的内容。提示应准确说明实际恢复了哪些内容。

### 08 · P2：单张坏素材阻断整个画板恢复，打开期间的素材更新也不同步

**2026-09-08 修复状态：已实现。素材最多两路分项加载，坏图保留占位、名称和重试；恢复的矢量内容及其余图片可继续编辑。稳定 ID 合并同步连线、断开和素材更新并保留变换；所选素材不可读或导出期间变化时明确拒绝导出。**

**界面复现 + 代码确认。** 已保存一个矩形，再连入不存在的图片，打开画板显示空白与 Failed to fetch，标题却显示“已载入 1 张连接素材”。本次等 3 秒及按 Esc 后，磁盘原矩形仍保留；错误弹层拦截编辑，**没有复现打开就删除原绘图**。

- 位置：[ImageEditorDialog.tsx:87](E:/mycode/aigc_line/src/features/image-editor/ImageEditorDialog.tsx:87)、[ImageEditorDialog.tsx:182](E:/mycode/aigc_line/src/features/image-editor/ImageEditorDialog.tsx:182)、[ImageEditorDialog.tsx:316](E:/mycode/aigc_line/src/features/image-editor/ImageEditorDialog.tsx:316)。
- 原因：全部素材共用 Promise.all，任一失败则未恢复原矢量内容；sources 变化也只改变 initialData，没有用 Excalidraw API 增量更新已打开场景。
- 优化：先恢复已保存内容，素材逐项加载，坏图显示带名称的占位和重试；加载失败禁止意外保存空场景；按稳定 ID 同步连接、断开和重新生成，保留变换。
- 验收：坏图不阻断其他内容；真实加载数与提示一致；打开期间 Agent 改连线后，显示、保存、导出一致。

### 09 · P2：锁定人物仍可被清除路径

**2026-09-08 修复状态：已实现。清除路径与更新路径统一检查 Shot 和演员锁定，界面按钮同步禁用，并补 mutation 回归。**

**隔离复现。** 同一个锁定演员，更新路径会被拒绝，清除路径却能把轨道数从 1 变成 0。按钮和删除 mutation 只检查 Shot 锁定。

- 位置：[director-model.ts:409](E:/mycode/aigc_line/src/features/director/director-model.ts:409)、[director-model.ts:429](E:/mycode/aigc_line/src/features/director/director-model.ts:429)、[DirectorStageDialog.tsx:1719](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:1719)。
- 优化：在 mutation 层统一人物锁定规则，界面同步禁用，避免绕过数据保护。

### 10 · P2：预演导出受实时速度影响，不能保证逐帧输出

**2026-09-08 修复状态：已实现逐帧编码。使用 WebCodecs + webm-muxer，逐个整数帧等待渲染并赋予微秒时间戳，VP9/VP8 能力检测、取消、进度、超时和队列背压均已加入；核对输出帧数后才保存。限制 60 秒、128MiB 编码数据，不支持编码器时明确报错。另以结构化 EBML 读取修正 webm-muxer 5.1 的 Duration，包含最后一帧显示时长；真实导出经 ffprobe 确认 24fps / 48 帧 / 2.000000 秒。不同设备/负载下的耗时与兼容性仍待量测。**

**代码确认，真实丢帧率待测。** 当前用 performance.now 推进帧数、requestAnimationFrame 取画面，配合 captureStream(24)/MediaRecorder 实时采集。某帧超过约 41.7ms，就可能跨过应输出的帧；后台节流也会影响导出。采样函数确定性不等于编码结果逐帧确定性。

- 位置：[DirectorStageDialog.tsx:1312](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:1312)。
- 优化：按整数帧序列渲染、确认画面完成，并按明确时间戳编码；提供取消、进度与后台/超时处理。
- 验收：同一 Shot 在不同负载下保持目标帧数和时长，慢渲染延长导出时间而不跳帧。

## 二、性能与资源使用

### 11 · P2：每个可见节点都订阅并扫描整张图

**2026-09-08 修复状态：针对性优化已实现。StoryNodeCard 改为按节点订阅图片入边索引，仅导演台/画板读取对应参考，并缩小 Agent 状态订阅；保留 onlyRenderVisibleElements。Prompt/Upscale 表单仍有全图订阅，100/300/1000 节点完整压测与更深编辑态隔离尚未完成。**

**代码确认，卡顿阈值待压测。** StoryNodeCard 使用全量 nodes/edges，并分别寻找导演台、画板参考素材，普通节点也执行相关扫描；同时订阅整个 Agent 运行状态映射。全图或聊天状态变化会扩大重渲染范围。总开销随可见节点数 × 图规模增长，概览全图时尤其明显。

- 位置：[CanvasArea.tsx:1120](E:/mycode/aigc_line/src/components/CanvasArea.tsx:1120)、[CanvasArea.tsx:1148](E:/mycode/aigc_line/src/components/CanvasArea.tsx:1148)。
- 优化：节点选择器、入边/出边索引、按 kind 计算引用；只订阅本项目需要的状态。进一步按编辑态与预览态隔离表单更新。
- 保留已有 `onlyRenderVisibleElements`；不把项目误判为完全没有离屏优化。用 100/300/1000 节点测拖动、输入和 Agent 流式更新。

### 12 · P2：长聊天同时放大主进程日志读取和界面更新成本

**2026-09-08 修复状态：部分完成。主进程缓存消息 ID/序号索引并检测外部日志变化，普通更新不再每次重放；界面初始显示最近 100 条，逐批加载并保持阅读位置；队列内容不变不更新 state。历史 IPC 仍返回完整记录，尚未实现后端分页、日志检查点或空闲轮询降频，500ms 查询仍保留。**

**隔离测量 + 代码确认。** 更新单条历史消息仍完整读取并重放 JSONL。合成 10,000 条、每条正文 500 字节，连续更新 100 条，触发 100 次全日志读取，累计约 598.4MiB，本机约 2.28 秒。聊天列表没有窗口化，Codex 队列每 500ms 刷新，即使结果未变也更新 state。

- 位置：[project.store.ts:254](E:/mycode/aigc_line/electron/main/services/project.store.ts:254)、[ChatPanel.tsx:35](E:/mycode/aigc_line/src/components/ChatPanel.tsx:35)、[ChatPanel.tsx:159](E:/mycode/aigc_line/src/components/ChatPanel.tsx:159)。
- 优化：首次重放后维护消息索引，追加事件同步更新内存；适时生成检查点。列表窗口化或分段加载；队列响应不变不 setState，空闲降低轮询频率或改事件推送。
- ChatMessageItem 已有 memo，不应泛称每次都重解析全部 Markdown。测量是日志操作，不是 UI FPS。

### 13 · P2：媒体处理缺少统一的内存、像素和并发预算

**2026-09-08 修复状态：部分完成。主进程先 stat/文件类型检查、使用有界读取，下载流式写 part 后原子替换，媒体准备/同步云请求限制两路并发。资产仅在视区附近解码成 320px 缩略图/封面，缓存 80 项/约 8MiB 并释放原始解码器；资产条目仍整体列出。画板两路解码、降采样预览，导出前按 8192px 边长及 16×1024×1024 总像素预算缩小选区。JSON/base64 接口与首次大图解码仍有内存开销，峰值内存未完成压测。**

**代码确认，峰值待压测。** 部分服务先 readFile 再检查大小，大文件在报超限前已尝试读入；base64/JSON 会再产生副本。资产库同时挂载所有视频 metadata 和原始图片预览。画板所有图片并行完整解码，720px 仅是元素显示尺寸；导出先分配大 canvas，之后才经过后端 8192px/50MB 限制。

- 位置：[seedance-video.service.ts:98](E:/mycode/aigc_line/electron/main/services/seedance-video.service.ts:98)、[google-image.service.ts:133](E:/mycode/aigc_line/electron/main/services/google-image.service.ts:133)、[seedream-image.service.ts:86](E:/mycode/aigc_line/electron/main/services/seedream-image.service.ts:86)、[comfyui.service.ts:402](E:/mycode/aigc_line/electron/main/services/comfyui.service.ts:402)、[CanvasArea.tsx:2745](E:/mycode/aigc_line/src/components/CanvasArea.tsx:2745)、[ImageEditorDialog.tsx:260](E:/mycode/aigc_line/src/features/image-editor/ImageEditorDialog.tsx:260)。
- 优化：先 stat 和文件类型校验；受限流式上传/下载、原子落盘；任务并发队列；缓存缩略图和视频封面、视口内挂载；画板限制解码并发，导出前计算选区像素预算。
- 保留现有图片 lazy loading、路径边界和后端限额。没有实测 OOM，不断言用户设备已经发生内存泄漏或耗尽。

### 14 · P2：3D 每帧重复校验不变工程，并带动静态编辑界面更新

**2026-09-08 修复状态：部分完成。完整校验按不可变 draft 缓存，不再因播放帧单独更新而重复执行；mutation/保存边界继续验证。播放时钟与所有静态表单尚未全面拆分，不能据此宣称复杂场景已达到特定 FPS。**

**代码确认 + 合成测量。** 播放和自由机位每 RAF 更新状态，组件每次 render 都运行完整 Zod/语义校验，draft 没变也执行。250 元素、10 Shot、每 Shot 40 人路径且每路径 40 点的约 512KB 工程，60 次采样中位 1.40ms，p95 2.19ms；仅校验约占 60fps 帧预算的 8.4%，还没算 React 与 WebGL。

- 位置：[DirectorStageDialog.tsx:768](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:768)、[DirectorStageDialog.tsx:1207](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:1207)、[director-model.ts:653](E:/mycode/aigc_line/src/features/director/director-model.ts:653)。
- 优化：按不可变 draft 缓存校验结果；隔离播放时钟、静态表单和静态几何，mutation/保存边界继续严格校验。
- 小场景中位仅约 0.095ms，因此这是规模相关优化，不据此宣称所有场景都卡顿。

### 15 · P2：骨骼人物独占资源缺少释放

**2026-09-08 修复状态：已实现资源清理。卸载时释放克隆实例的独占材质和 Skeleton 资源，保留共享 GLTF geometry/texture。反复添加删除的 GPU 稳态仍需实机监测。**

**代码与本地依赖确认，GPU 增量待测。** 每实例 SkeletonUtils.clone，并 clone 材质；用 primitive 挂载，R3F 不自动释放 primitive 对象，组件没有清理独占材质与骨骼纹理。

- 位置：[RiggedActorModel.tsx:176](E:/mycode/aigc_line/src/features/director/RiggedActorModel.tsx:176)、[RiggedActorModel.tsx:200](E:/mycode/aigc_line/src/features/director/RiggedActorModel.tsx:200)。
- 优化：卸载时仅释放实例独占 material、Skeleton/boneTexture，保留 GLTF 共用 geometry/texture；骨骼引用可预先缓存。
- 验收：同一导演台反复添加删除人物，资源数量趋于稳定；不能误 dispose 仍被其他人物使用的共享资源。

## 三、用户体验与 UI

### 16 · P2：窄窗口缺少画布空间保护和编辑侧栏折叠

**2026-09-08 修复状态：部分完成。聊天宽度受容器约束、可收起并记忆宽度；导演台参考栏/属性栏/时间线可分别收起，窄窗口默认收起参考栏。保留 620px 媒体卡。时间线拖动调高、导演台完整布局记忆和全尺寸矩阵验收未完成。**

**界面复现。** 1024×768 下把聊天面板调到 800px，画布仅剩约 220px，底部工具栏被截断。导演台两侧栏固定占位，3D 视口只有 480×416px，虽新增素材库弹窗没有横向越界，实际观察场景空间仍偏小。

- 位置：[ProjectPage.tsx:6](E:/mycode/aigc_line/src/pages/ProjectPage.tsx:6)、[ProjectPage.tsx:23](E:/mycode/aigc_line/src/pages/ProjectPage.tsx:23)、[DirectorStageDialog.tsx:1355](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:1355)。
- 优化：聊天上限随容器宽度变化，保留画布最小空间；聊天、场景清单和属性面板支持收起；时间线可折叠/调高；工具栏在窄宽度折叠次要项。记住用户布局。
- 保留现有 620px 媒体编辑卡设计；增加紧凑概览/折叠 prompt，避免为了适配而把所有编辑卡缩小。

### 17 · P2：连续添加节点落在同一位置，新节点可能被旧选择遮挡

**2026-09-08 修复状态：已实现。工具栏按实际画布容器中心找空位，避让现有卡片并选中新节点；连续添加不再固定重叠。**

**代码确认，既有端到端操作也遇到遮挡。** 工具栏每次按同一 window 坐标创建节点，不避让、不选中新节点、不定位镜头。视口不变时新节点左上角完全重叠；React Flow 会提升旧选中节点，造成“点了添加但看不见”的体验。聊天拉宽后以 window 计算的落点也可能不在实际画布视区。

- 位置：[CanvasArea.tsx:2558](E:/mycode/aigc_line/src/components/CanvasArea.tsx:2558)、[CanvasArea.tsx:1681](E:/mycode/aigc_line/src/components/CanvasArea.tsx:1681)。
- 优化：按画布容器中心寻找空位，考虑实际卡片宽高；添加后单选并必要时平移到可见区。MiniMap 和工具栏可自动收起，减少覆盖节点操作。

### 18 · P2：设置离开时静默丢失未保存内容

**2026-09-08 修复状态：已实现。dirty 状态及保存/放弃/继续编辑弹窗已加入；未保存配置也阻止直接退出。保留顶部统一保存入口和方舟 Key 明文这一既定要求。**

**界面复现。** ComfyUI URL 从 8188 改成 9999，直接返回再进入，恢复 8188，没有未保存提示。

- 位置：[SettingsPage.tsx:206](E:/mycode/aigc_line/src/pages/SettingsPage.tsx:206)。
- 优化：跟踪 dirty；显示“有未保存修改”，返回时保存/放弃/继续编辑，或保留设置草稿。API Key 测试成功与配置已保存也应明确区分。
- 保持用户既定的顶部统一“保存配置”入口，不擅自改变为输入即保存凭据。

### 19 · P2：打包后 logo 路径错误，品牌字体依赖外网

**2026-09-08 修复状态：已实现。logo 改相对静态地址，移除外网字体导入并采用本机字体栈。未额外打包商业字体；跨平台离线资源仍需随分发验收。**

**界面复现 + 代码确认。** 构建后的 Electron 用 loadFile 打开，`/logo.svg` 解析为 `file:///E:/logo.svg`，3 个图像实例 naturalWidth 为 0，首页/聊天显示缺图。全局 CSS 还从 Google Fonts 引入字体；本次资源记录约 1.90 秒且无解码内容，不据此直接推断整体首屏延迟。

- 位置：[TitleBar.tsx:10](E:/mycode/aigc_line/src/components/TitleBar.tsx:10)、[HomePage.tsx:39](E:/mycode/aigc_line/src/pages/HomePage.tsx:39)、[ChatPanel.tsx:150](E:/mycode/aigc_line/src/components/ChatPanel.tsx:150)、[index.css:1](E:/mycode/aigc_line/src/index.css:1)。
- 优化：使用构建可解析的静态导入或一致的 base 相对地址；随应用提供有相应许可的字体与回退字体；增加 loadFile/离线资源 smoke test。开发服务器下正常不代表打包后正常。

### 20 · P2：文字偏小、状态层级不清，部分表单缺少可访问名称

**2026-09-08 修复状态：部分完成。导演台常用小字与按钮尺寸已调整，设置输入补可访问名称，折叠面板减少拥挤。尚未完成全应用对比度、键盘导航与屏幕阅读器专项验收，不宣称无障碍达标。**

**界面检查 + DOM 确认。** 导演台采样到大量 8–11px 标签，个别 7px 辅助文字；低透明度说明在暗色背景上难读。设置页 7 个输入没有关联 label 或 aria-label。部分按钮换行后接近竖排，信息密度挤压了操作辨识。

- 优化：保留黑金视觉，但统一正文/标签/注释层级，常用字段建议 12–14px；减少低透明度长说明，次要信息转为可展开帮助。统一主操作、普通操作、危险操作与保存/任务状态样式。
- 表单补 `htmlFor/id` 或可访问名称，明确单位、无效值与提交失败；图标按钮统一 tooltip 和键盘焦点。字号建议是本项目设计建议，不冒充未经测量的无障碍达标结论。

### 21 · P2 产品增强：补齐画布与导演台撤销/重做

**2026-09-08 修复状态：已实现基础历史。画布最多 40 步、导演台最多 60 步，会话内支持按钮及 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z；拖拽合并提交，画布同一输入焦点内的编辑合并。画布保留现有节点最新生成路径/状态，导演台保留截图元数据；撤销不会调用、取消或重新提交远端生成。历史不跨重启保存。**

**代码确认的能力缺口。** 画布与导演台没有完整历史栈。导演台“撤销末点”只删除路径最后一个点；Excalidraw 自带会话内撤销，不能恢复外部节点或导演台元素删除。

- 位置：[CanvasArea.tsx:1745](E:/mycode/aigc_line/src/components/CanvasArea.tsx:1745)、[DirectorStageDialog.tsx:834](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:834)、[DirectorStageDialog.tsx:904](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx:904)。
- 优化：先支持删除、添加、变换、连线、机位与 prompt 修改撤销，拖拽合并为一步，限定内存上限。明确 UI 编辑与 Agent 修改的历史边界，外部生成不能因撤销而重复提交。

### 22 · P3 产品增强：让新增基础模块更容易组合成完整场景

**2026-09-08 修复状态：未实现后续组合能力。本轮保留 20 种素材（含新增 8 种建筑/家具）、分类搜索、米制尺寸与独立复制；整套房间预设、吸附/对齐/贴地、多选成组和材质预设仍是 P3 规划。**

这次 20 种素材、分类搜索、家具复制已经可用。下一步的收益更多来自搭建效率：网格吸附、对齐/贴地、多选成组、组合预设、材质预设与最近使用。

建议先做“选中后快速搭建”：尺寸编辑 → 贴地/对齐 → 复制与批量排列；再提供可编辑的客厅、卧室、走廊组合。预设应继续生成现有标准元素，复用持久化与 Agent schema，不另建一套不可编辑场景格式。这些是产品建议，没有在本轮实现。

## 四、工程维护与测试

### 23 · P2：常规类型检查漏掉主进程，实际还有 7 个错误

**2026-09-08 修复状态：已实现。pnpm typecheck 同时检查 tsconfig.json 和 tsconfig.node.json；删除未注册的旧 workspace handler 并修正 project-media 的 Dirent 类型，完整检查已通过。下列 7 个错误是初检结果。**

**实际命令验证。** `pnpm typecheck` 只检查 tsconfig.json 的 src。执行 `pnpm exec tsc -p tsconfig.node.json --noEmit` 报 7 个错误：旧 workspace handler 引用已删除服务/通道 4 处，project-media 的 Dirent 泛型与字符串类型 3 处。

- 位置：[package.json:15](E:/mycode/aigc_line/package.json:15)、[tsconfig.json:29](E:/mycode/aigc_line/tsconfig.json:29)、[workspace.handlers.ts:3](E:/mycode/aigc_line/electron/main/ipc/workspace.handlers.ts:3)、[project-media.service.ts:197](E:/mycode/aigc_line/electron/main/services/project-media.service.ts:197)。
- 优化：类型检查命令覆盖渲染进程、主进程和 preload；清理无引用的旧 handler 与被排除的遗留组件，修正真正使用的类型。
- 旧 workspace handler 当前未被主入口注册，这些错误不等于应用启动必然失败；Vite 构建通过也不代表主进程类型检查通过。

### 24 · P2/P3：补故障路径测试，按职责拆分重组件

**2026-09-08 修复状态：部分完成。新增快照失败/并发、历史竞态、生成恢复与未知提交、媒体上限、画板合并/预算、编辑历史、逐帧编码及 WebM 时长、资产缓存等故障回归；抽取了持久化、引用索引、历史、预览、导出等职责。完整类型检查和单测通过，E2E 全量与修正后定向结果见文末；跨设备性能基线及大型组件全面拆分尚未完成。**

现有成功路径测试有价值，但没有覆盖快速离开、并发写盘、坏文件、同 ID 推送、提交后断网等本次故障。部分 E2E 共用一个项目并依赖前序选择状态，单个用例失败会影响后续结果。

- 优化测试：优先加入前述可靠性回归，E2E 使用独立或明确重置的 fixture；增加打包资源、窄窗口和大项目性能基线。无需为每个小样式写实现镜像测试。
- 优化结构：[CanvasArea.tsx](E:/mycode/aigc_line/src/components/CanvasArea.tsx) 约 2811 行，[DirectorStageDialog.tsx](E:/mycode/aigc_line/src/features/director/DirectorStageDialog.tsx) 约 1914 行。按快照/任务状态/引用索引、播放/导出/属性面板拆职责，以减少跨功能副作用；行数本身不是缺陷，不建议先做大规模重构再处理丢数据问题。

## 初检建议落地顺序（保留）

| 批次 | 范围 | 完成标准 |
|---|---|---|
| 1：可靠性 | 01–07，优先保存与任务恢复 | 快速离开不丢修改；同 ID 不重复；并发写盘安全；生成可恢复且不重复提交 |
| 2：编辑基本体验 | 08–09、16–21；可并行修复 logo | 坏素材可恢复；锁定一致；窄窗口可编辑；新增可见；设置草稿和撤销行为明确 |
| 3：大项目性能 | 10–15 | 建立节点/聊天/3D/媒体基线后逐项优化，报告输入响应、帧耗时、内存与输出帧数 |
| 持续维护 | 23–24 | 双进程类型检查、故障回归、独立 E2E；随相关功能拆模块 |
| 后续增强 | 22 | 组合搭景显著减少操作步骤，并保持工程可编辑、Agent 可操作 |

不估算未经评估的“几天完成”，也不建议把所有问题一次性混进一个大改动。

## 验证与证据

- 修复阶段：覆盖渲染进程、主进程与 preload 的完整 `pnpm typecheck` 通过；35 个 Vitest 文件 / 177 项通过。
- Electron E2E 共 19 项：全量运行 18 项通过，剩余原生关闭用例的功能断言已通过，但清理阶段再次访问已关闭应用导致失败；修正测试清理后，该项单独运行通过。这里记录“全量 + 定向复跑”的结果，不表述为再次完整运行 19/19。画板用例的旧提示定位也已修正。
- 真实 WebCodecs 导出经 ffprobe 确认 24fps、48 帧、2.000000 秒；WebM 结构化时长修正有 2 项定向单测通过。未做跨设备编码性能或真实云服务验收。
- 初检基线（历史）：当时 `pnpm typecheck` 只检查渲染进程，21 个单测文件 / 122 项及 Playwright 13 项通过；额外主进程检查发现 7 个错误，见 [初检日志](E:/mycode/aigc_line/test-results/audit-node-typecheck.log)，现已修正。以下复现链接保留初检数据，不代表修复后再次失败。
- 存储、生成故障与日志测量：[复现脚本](E:/mycode/aigc_line/test-results/main-process-audit.cjs)、[结果](E:/mycode/aigc_line/test-results/main-process-audit-results.log)。远端接口均为替身；临时存储位于 test-results。
- 同 ID 和历史竞态：[store 复现脚本](E:/mycode/aigc_line/test-results/frontend-store-audit.mjs)。
- 3D 合成测量与锁定路径：[结果](E:/mycode/aigc_line/test-results/director-audit-results.json)。
- 窄工作区、快速离开与重复气泡：[界面结果](E:/mycode/aigc_line/test-results/audit-1788795531729/results.json)、[聊天占宽截图](E:/mycode/aigc_line/test-results/audit-1788795531729/workspace-chat-800.png)。
- 导演台/坏图片/打包 logo：[界面结果](E:/mycode/aigc_line/test-results/editor-audit-1788795826611/results.json)、[导演台截图](E:/mycode/aigc_line/test-results/editor-audit-1788795826611/director-1024.png)、[坏图弹层截图](E:/mycode/aigc_line/test-results/editor-audit-1788795826611/board-load-failure.png)。

UI 复现使用隔离用户目录与构建后的 Electron 应用。部分扩展探查因已有控件遮挡或错误弹层停止，不能把脚本超时当作新的生产崩溃。未做真实云服务可用性、全量安全审计、安装包分发/自动更新验证或跨设备性能测试。test-results 为本机临时证据，清理后链接会失效，关键结果已记录在本文。
