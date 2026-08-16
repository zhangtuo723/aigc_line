import path from 'node:path';
import type { ChatMessage } from '../../../../src/shared/ipc.types';

/**
 * Build the user prompt for the current turn.
 * Attachments are listed as workspace-relative paths so the agent can
 * inspect them with Read/Bash; system instructions live in the system prompt.
 */
export function buildUserPrompt(userMessage: ChatMessage, folderPath: string): string {
  const contextBlocks: string[] = [];

  if (userMessage.nodeRefs && userMessage.nodeRefs.length > 0) {
    const refLines = userMessage.nodeRefs
      .map((ref) => `- nodeId=${JSON.stringify(ref.id)} title=${JSON.stringify(ref.title)} kind=${ref.kind}`)
      .join('\n');
    contextBlocks.push(`用户把以下实时画布节点添加到了本轮对话。它们是本轮修改或讨论的明确对象：\n${refLines}\n\n处理规则：直接用上述精确 nodeId 调用 GetCanvasNode 读取节点的完整最新数据，不要先读取全画布概览；修改时使用相同 nodeId 调用 UpdateCanvasNodes。画布写入采用最后写入者生效，不需要传版本号。除非用户明确要求，不要把它们替换成新节点，也不要修改未引用的节点。`);
  }

  if (userMessage.artifactRefs && userMessage.artifactRefs.length > 0) {
    const refLines = userMessage.artifactRefs
      .map((r) => `- 《${r.title}》(${r.type})${r.path ? ` at ${r.path}` : ''}`)
      .join('\n');
    contextBlocks.push(`用户在画布上选中了以下产物作为本轮消息的引用（说明用户想修改它或参考它；如需修改，直接用 Read/Edit 操作对应文件，改完调用 PushArtifact 重新推送即可，前端会原地更新卡片而不是新增）：\n${refLines}`);
  }

  if (userMessage.attachments && userMessage.attachments.length > 0) {
    const attachmentLines = userMessage.attachments
      .map((a) => {
        // Prefer workspace-relative paths (staged under uploads/)
        const rel = a.path ? path.relative(folderPath, a.path) : '';
        const location =
          rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : a.path;
        return `- ${a.name} (${a.type})${location ? ` at ${location}` : ''}`;
      })
      .join('\n');
    contextBlocks.push(`User uploaded files (already inside the workspace, use Read/Bash to inspect them):\n${attachmentLines}`);
  }

  const content = userMessage.content.trim();
  // A slash command must remain the first token so Claude Code invokes the
  // selected skill. Reference and attachment context becomes skill arguments.
  return content.startsWith('/')
    ? [content, ...contextBlocks].filter(Boolean).join('\n\n')
    : [...contextBlocks, content].filter(Boolean).join('\n\n');
}

/**
 * Appended to the claude_code preset system prompt: workspace location and
 * how/when to push artifacts to the canvas.
 */
export function buildSystemPromptAppend(folderPath: string): string {
  return `你的工作目录是：${folderPath}

你运行在 AIGC CANVAS 桌面应用中。不要建议用户运行 claude、claude --resume 或其他 Claude Code 终端命令；会话和上下文操作由应用界面负责。

当你完成的任务产出了有意义的结果时（比如编写代码、生成报告、制作可视化页面等），应该使用 PushArtifact 工具把结果展示到用户的画布上。先把结果写入工作目录中的文件，然后再调用 PushArtifact 并传入文件路径——内容会直接从磁盘读取，所以不要把内容粘贴到工具调用的参数里。PushArtifact 工具的参数如下：
- path：文件路径（相对于工作目录的路径或绝对路径均可）。artifact 类型会根据扩展名自动推断：.html/.htm 渲染为 html，其余一律渲染为 markdown
- title：artifact 的简短标题

例如，把报告写入 report.md 之后，调用 PushArtifact 并传入 path="report.md"、title="报告"。

当 HTML artifact 需要引用工作目录内的文件时（上传的图片、生成的素材、数据文件等），请使用相对于工作目录根目录的相对路径，例如 src="uploads/photo.png" 或 href="./assets/style.css"——渲染时会自动解析。不要把大体积资源以 base64 data URL 的形式内联到代码里。

你具备 AIGC 短剧分镜创作能力，并且可以通过 Canvas 工具直接读取和修改实时画布。需要了解画布规模或查找节点 ID 时调用 GetCanvasOverview，它只返回轻量摘要；需要某个节点的 prompt、媒体路径、生成状态、引用或连接详情时，用精确 nodeId 调用 GetCanvasNode。用户已经引用节点时直接读取该节点，不要先获取全画布概览。画布写入采用最后写入者生效，不要传版本号。

审核生成视频时，用对应 video 节点 ID 调用 ReviewStoryboardVideo；也可传只关联一个下游 video 的 image 节点 ID。工具会读取 video、原始提示词、参考素材和媒体路径，重点检查穿帮、身份/服装/场景/道具连续性、脸手肢体和物体变形、画面错乱闪烁与物理错误、声音爆音失真断裂、台词完整性及音画同步，只返回带时间证据和建议的审核文本，不生成报告文件或 Artifact，不计算总分，也不判定通过或重做。你必须结合剧情重要性、问题可见程度、修改成本和用户要求，自行决定接受、局部修复提示词或重新生成，并说明依据。

当用户要按自定义要求分析任意视频，而不是执行画布分镜成片质量审核时，调用 AnalyzeVideo，传入项目内视频路径或公开 http(s) 视频地址及用户的分析要求。不要为了通用分析创建或查找画布节点，也不要改用 ReviewStoryboardVideo。

当用户要求创作短剧、编写分镜或拆分镜头时，不要创建 .storyboard.json 或分镜表 artifact，也不要创建独立的分镜/shot 节点。直接批量创建以下节点：
1. 为每个需要静帧、首帧或视觉参考的生成片段创建 image 节点，prompt 使用详细图片提示词。
2. 为每个可独立生成和审核的片段创建 video 节点，prompt 承载片段目的、内部 Shot 时间线、动作、运镜、台词和声音，并设置 duration。
3. 使用 ConnectCanvasNodes 建立 image → video 的连接；剧情规划、旁白、时间线和生成要求直接写入对应 image/video 的 prompt，不创建额外文本节点。

优先批量创建和批量连接。不同生成片段纵向排列，同一片段的参考图和视频从左到右排列。画布节点是生产数据的唯一来源。`;
}
