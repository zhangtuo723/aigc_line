# AIGC CANVAS

[English](README.md) | 简体中文

Electron 桌面端 AIGC 创作工作台：左侧是无限画布（Excalidraw），右侧是与 Claude Agent 的对话面板。Agent 在工作目录里读写文件，并把产物（Markdown / HTML / 图片 / 分镜表）推送到画布上展示。核心能力是 **AIGC 短剧分镜创作**：Agent 生成分镜 JSON，画布渲染成可视化的分镜流水线卡片。

![AIGC CANVAS 截图](docs/screenshot.png)

## 功能特性

- **Agent 对话**：基于 `@anthropic-ai/claude-agent-sdk`（claude_code preset），具备 Read/Bash/Glob/Grep/Edit/Write 工具，作用域限定在项目工作目录
- **产物画布**：Agent 通过自定义 `PushArtifact` 工具把文件推送到画布，同一文件重复推送时原地更新卡片而不是新增
- **分镜表产物**：`.storyboard.json` 渲染为流水线卡片（画面描述 → 图片节点 → 视频节点），支持：
  - 文生图 / 图生视频提示词**可编辑**，失焦自动写回 JSON 源文件
  - `imageSource` / `videoSource` 展示当前选定的生成结果，`imageSourceHistory` / `videoSourceHistory` 记录抽卡历史，可翻页浏览、一键设为当前版本
  - 生成按钮、导出剪辑（接口待定，已留占位）
- **画布引用**：点击画布上的产物卡片，聊天输入框出现引用 chip，发送后 Agent 知道本轮消息是针对/参考哪个产物（可直接定位文件修改）
- **工作区协议**：`workspace://<projectId>/<path>` 让 HTML 产物用相对路径引用工作区内的图片、视频等资源
- **持久化**：聊天历史、画布快照按项目存盘，重开项目自动恢复；带源文件的产物恢复时从磁盘重读最新内容

## 技术栈

Electron + React 19 + Vite + TailwindCSS v4 + Zustand + Excalidraw + claude-agent-sdk（进程内 MCP server 注册自定义工具）

## 快速开始

```sh
pnpm install
pnpm dev
```

需要本机可用的 Claude 凭证（Claude Code 登录态或 `ANTHROPIC_API_KEY`），Agent SDK 会自动使用。

## 可用脚本

- `pnpm dev`：启动开发环境（Vite + Electron）
- `pnpm build`：构建渲染进程并用 electron-builder 打包
- `pnpm test` / `pnpm test:e2e`：Vitest 单元测试 / Playwright 端到端测试
- `pnpm typecheck`：TypeScript 类型检查

## 项目结构

```tree
├── electron/
│   ├── main/
│   │   ├── ipc/                 # IPC handlers（project/chat/canvas/artifact）
│   │   └── services/
│   │       ├── agent/           # Agent SDK 封装
│   │       │   ├── index.ts     #   runAgent：query 循环、工具注册
│   │       │   ├── tools.ts     #   PushArtifact 自定义 MCP 工具
│   │       │   ├── prompts.ts   #   系统/用户提示词组装（中文）
│   │       │   └── artifact.ts  #   产物对象构造与推送
│   │       ├── message-hub.ts   #   主进程 → 渲染进程事件推送
│   │       └── project.store.ts #   项目索引与聊天历史持久化
│   └── preload/                 # contextBridge 暴露 electronAPI
├── src/
│   ├── components/
│   │   ├── CanvasArea.tsx       # Excalidraw 画布：产物元素注入、快照存取、引用选中
│   │   ├── ArtifactRenderer.tsx # 按产物类型分发渲染
│   │   ├── StoryboardCard.tsx   # 分镜表卡片（流水线布局、版本浏览、提示词编辑）
│   │   ├── ChatPanel.tsx        # 对话面板
│   │   ├── ChatInput.tsx        # 输入框（附件、产物引用 chip）
│   │   └── ChatMessage.tsx      # 消息气泡（附件、引用、产物、工具调用）
│   ├── stores/app.store.ts      # Zustand 全局状态（消息、产物、引用）
│   └── shared/                  # 主/渲染进程共享的 IPC 通道与类型定义
└── test/
```

## 核心链路

**产物推送**：Agent `Write` 文件 → 调 `PushArtifact{path,title}` → 主进程按扩展名推断类型（图片转 data URL；`.storyboard.json` → storyboard；`.html` → html；其余 markdown）→ IPC 推送到渲染进程 → store 按源文件路径去重 upsert → 画布插入/原地更新 embeddable 卡片 → 同时写入聊天历史以便恢复。

**分镜 Schema**（`StoryboardShot`，见 `src/shared/ipc.types.ts`）：`index` 镜号、`duration` 时长（秒）、`scene` 画面描述、`dialogue` 台词、`camera` 运镜、`textToImagePrompt` / `imageToVideoPrompt`（英文提示词，前端可编辑）、`imageSource` / `videoSource`（当前选定结果路径）、`*History`（抽卡历史）。

**产物引用**：画布选中产物卡片 → store 记录引用 → 发送时拼入用户提示词（标题 + 工作区相对路径）→ Agent 用 Read/Edit 修改文件后重新 `PushArtifact`，卡片原地刷新。

**编辑回写**：分镜卡片上编辑提示词/切换版本 → `artifact:save` IPC 写回工作区 `.storyboard.json`（带路径逃逸校验）。

## 后续规划

- 接入文生图 / 图生视频 API（按钮与数据字段已预留：生成 → 下载到工作区 → 旧 source 入 history → 新路径写 source）
- 导出剪辑（拼接各镜头视频）
