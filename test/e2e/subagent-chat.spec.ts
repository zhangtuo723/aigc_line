import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../../src/shared/ipc.channels';

const root = path.resolve(import.meta.dirname, '../..');

for (const provider of ['claude-code', 'codex'] as const) {
test(`${provider} subagent output stays inside a collapsed, scrollable chat panel`, async () => {
  const folder = path.join(root, 'test-results', `subagent-chat-${randomUUID()}`);
  await fs.mkdir(folder, { recursive: true });
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${folder}/profile`], cwd: root });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor();
    const project = await page.evaluate(async ({ projectFolder, provider }) => {
      const created = await window.electronAPI.createProject('子 Agent 展示', projectFolder, { provider, model: '' });
      await window.electronAPI.loadProject(created.id);
      return created;
    }, { projectFolder: folder, provider });
    const events = [
      { id: 'agent-tool', role: 'system', content: '', timestamp: 1, toolCall: { id: 'agent-tool', toolName: 'Agent', toolInput: '{"description":"检查分镜"}', status: 'completed' } },
      { id: 'child-text', role: 'assistant', content: '子 Agent 检查结果', timestamp: 2, subagent: { parentToolUseId: 'agent-tool' } },
      { id: 'main-text', role: 'assistant', content: '主 Agent 的回复', timestamp: 3 },
      { id: 'child-tool', role: 'system', content: '', timestamp: 4, subagent: { parentToolUseId: 'agent-tool' }, toolCall: { id: 'child-tool', toolName: 'Read', toolInput: '{}', status: 'completed' } },
    ].map((message, index) => JSON.stringify({ version: 1, seq: index + 1, type: 'message.created', message })).join('\n') + '\n';
    await fs.writeFile(path.join(project.folderPath, '.aigc-line', 'chat-events.jsonl'), events);
    await page.reload();
    const group = page.getByRole('region', { name: '子 Agent：检查分镜' });
    await expect(group).toBeVisible();
    const taskMessage = {
      id: provider === 'codex' ? 'agent-tool' : 'task-lifecycle', role: 'system', content: '', timestamp: 5,
      ...(provider === 'codex' ? { toolCall: { id: 'agent-tool', toolName: 'Agent', toolInput: '{"description":"检查分镜"}', status: 'completed' } } : {}),
      subagent: { parentToolUseId: 'agent-tool', agentId: 'child' },
      subagentTask: { taskId: 'agent-child', status: 'running' },
    };
    // Agent tool has already returned, but the background task remains active.
    await app.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows().forEach(window => window.webContents.send(payload.channel, { projectId: payload.projectId, message: payload.message }));
    }, { channel: IPC_CHANNELS.push.chatMessage, projectId: project.id, message: taskMessage });
    await expect(group.getByRole('status')).toHaveText('运行中');
    for (const status of ['completed', 'failed', 'stopped']) {
      await app.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows().forEach(window => window.webContents.send(payload.channel, { projectId: payload.projectId, message: payload.message }));
      }, { channel: IPC_CHANNELS.push.chatMessage, projectId: project.id, message: { ...taskMessage, subagentTask: { ...taskMessage.subagentTask, status } } });
      await expect(group.getByRole('status')).toHaveText({ completed: '已完成', failed: '失败', stopped: '已停止' }[status]!);
    }
    await expect(group.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('主 Agent 的回复')).toBeVisible();
    await expect(page.getByText('子 Agent 检查结果')).toHaveCount(0);
    await group.getByRole('button').click();
    await expect(group.getByText('子 Agent 检查结果')).toBeVisible();
    await expect(group.getByText('读取文件')).toBeVisible();
    expect(await group.locator('.overflow-y-auto').evaluate(element => getComputedStyle(element).maxHeight)).toBe('440px');
  } finally { await app.close(); }
});
}
