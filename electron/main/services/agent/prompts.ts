import path from 'node:path';
import type { ChatMessage } from '../../../../src/shared/ipc.types';

/**
 * Build the user prompt for the current turn.
 * Attachments are listed as workspace-relative paths so the agent can
 * inspect them with Read/Bash; system instructions live in the system prompt.
 */
export function buildUserPrompt(userMessage: ChatMessage, folderPath: string): string {
  let prompt = userMessage.content;

  if (userMessage.artifactRefs && userMessage.artifactRefs.length > 0) {
    const refLines = userMessage.artifactRefs
      .map((r) => `- 《${r.title}》(${r.type})${r.path ? ` at ${r.path}` : ''}`)
      .join('\n');
    prompt = `用户在画布上选中了以下产物作为本轮消息的引用（说明用户想修改它或参考它；如需修改，直接用 Read/Edit 操作对应文件，改完调用 PushArtifact 重新推送即可，前端会原地更新卡片而不是新增）：\n${refLines}\n\n${prompt}`;
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
    prompt = `User uploaded files (already inside the workspace, use Read/Bash to inspect them):\n${attachmentLines}\n\n${prompt}`;
  }

  return prompt;
}

/**
 * Appended to the claude_code preset system prompt: workspace location and
 * how/when to push artifacts to the canvas.
 */
export function buildSystemPromptAppend(folderPath: string): string {
  return `你的工作目录是：${folderPath}

当你完成的任务产出了有意义的结果时（比如编写代码、生成报告、制作可视化页面等），应该使用 PushArtifact 工具把结果展示到用户的画布上。先把结果写入工作目录中的文件，然后再调用 PushArtifact 并传入文件路径——内容会直接从磁盘读取，所以不要把内容粘贴到工具调用的参数里。PushArtifact 工具的参数如下：
- path：文件路径（相对于工作目录的路径或绝对路径均可）。artifact 类型会根据扩展名自动推断：.html/.htm 渲染为 html，其余一律渲染为 markdown
- title：artifact 的简短标题

例如，把报告写入 report.md 之后，调用 PushArtifact 并传入 path="report.md"、title="报告"。

当 HTML artifact 需要引用工作目录内的文件时（上传的图片、生成的素材、数据文件等），请使用相对于工作目录根目录的相对路径，例如 src="uploads/photo.png" 或 href="./assets/style.css"——渲染时会自动解析。不要把大体积资源以 base64 data URL 的形式内联到代码里。

你具备 AIGC 短剧分镜创作能力。当用户要求创作短剧、编写分镜、拆分镜头时，按以下流程处理：
1. 根据剧情把内容拆成若干镜头，每个镜头包含这些字段：
   - index：镜号（数字，从 1 开始）
   - duration：镜头时长（秒，数字）
   - scene：画面描述/场景（中文，描述画面中的人物、环境、动作）
   - dialogue：台词/旁白（可选，没有台词时省略）
   - camera：运镜/景别（可选，如 特写、中景、推镜、摇镜）
   - textToImagePrompt：文生图提示词（英文，详细描述画面主体、构图、光线、风格，用于生成该镜头的静态画面）
   - imageToVideoPrompt：图生视频提示词（英文，描述画面中元素如何运动、镜头如何运动，用于把静态画面生成视频）
   每个镜头的文生图和图生视频提示词要与 scene 一致且足够具体。
   另外每个镜头还有 4 个由生成管线维护的字段：imageSource（当前选定的图片路径）、imageSourceHistory（历史抽卡记录）、videoSource（当前选定的视频路径）、videoSourceHistory（历史抽卡记录），值都是相对于工作目录的文件路径。你创建分镜时不用填这些字段；修改已有分镜文件时必须原样保留它们。
2. 把镜头数组写入工作目录中的 <名称>.storyboard.json 文件（必须是以 .storyboard.json 结尾的 JSON 数组文件，例如 episode1.storyboard.json）。
3. 调用 PushArtifact 推送该文件（例如 path="episode1.storyboard.json"，title 用分镜名称），建议传 width=720、height=420。前端会把它渲染成可视化的分镜表卡片，所以你不要再把分镜表格粘贴到 markdown 产物里。`;
}
