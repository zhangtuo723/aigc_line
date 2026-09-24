import type { ChatMessage, SubagentTaskState, ToolCall } from '../../../../src/shared/ipc.types';
import { isSubagentTaskActive } from '../../../../src/shared/chat-subagents';
import { appendChatMessage, updateChatMessage } from '../project.store';
import { messageHub } from '../message-hub';
import { CodexSubagentReader, type CodexChildTurn } from './codex-subagent-reader';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
const json = (value: unknown, limit = 2_000) => JSON.stringify(value ?? null).slice(0, limit);
const TOOL_NAMES: Record<string, string> = {
  spawn_agent: 'Agent', send_input: 'send_input', resume_agent: 'resume_agent', wait: 'wait_agent',
  close_agent: 'close_agent', send_message: 'send_message', followup_task: 'followup_task',
  interrupt_agent: 'interrupt_agent', list_agents: 'list_agents',
};

function agentStatus(value: unknown): SubagentTaskState['status'] | undefined {
  const statuses: Record<string, SubagentTaskState['status']> = { pending_init: 'pending', running: 'running', completed: 'completed', errored: 'failed',
    interrupted: 'stopped', shutdown: 'stopped', not_found: 'unknown' };
  return statuses[String(value)];
}

interface ChildTask {
  threadId: string;
  parentThreadId: string;
  header: ChatMessage;
  knownTurns: Set<string>;
  latestTurn?: string;
  awaitingNewTurn: boolean;
  readComplete: boolean;
  nextReadAt: number;
  failures: number;
}

/** Adapter for exec JSONL collab_tool_call (not yet declared by the TS SDK).
 * Per-agent states, never the dispatch/wait tool's status, drive the panel badge.
 */
export class CodexSubagents {
  private tasks = new Map<string, ChildTask>();
  private saved = new Map<string, ChatMessage>();
  private reader?: CodexSubagentReader;
  private timer?: ReturnType<typeof setTimeout>;
  private operations: Promise<unknown> = Promise.resolve();
  private monitoring = false;
  private finishing?: Promise<void>;

  constructor(private projectId: string, private folderPath: string) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operations.then(work);
    this.operations = next.catch(() => undefined);
    return next;
  }

  begin(): void { this.finishing = undefined; this.monitoring = true; }

  activeMessageIds(): string[] {
    return this.monitoring ? [...this.saved.values()].filter(message => message.subagentTask && isSubagentTaskActive(message.subagentTask)).map(message => message.id) : [];
  }

  activeToolIds(): string[] {
    return this.monitoring ? [...this.saved.values()].flatMap(message => message.toolCall?.status === 'running' ? [message.id] : []) : [];
  }

  private async save(message: ChatMessage): Promise<void> {
    const previous = this.saved.get(message.id);
    message = { ...message, timestamp: previous?.timestamp ?? message.timestamp };
    if (previous && JSON.stringify(previous) === JSON.stringify(message)) return;
    if (previous) await updateChatMessage(this.folderPath, message.id, () => message);
    else await appendChatMessage(this.folderPath, message);
    this.saved.set(message.id, message);
    messageHub.pushToFrontend(this.projectId, message);
  }

  private schedule(): void {
    if (!this.monitoring || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.serial(() => this.refresh()).catch(error => {
        messageHub.notifyError(this.projectId, `Codex 子任务记录保存失败：${String(error)}`);
      }).finally(() => {
        if ([...this.tasks.values()].some(task => !task.readComplete)) this.schedule();
      });
    }, 1_000);
    this.timer.unref?.();
  }

  async handle(event: unknown, turnKey: string, rootThreadId?: string): Promise<boolean> {
    const wire = record(event);
    const item = record(wire.item);
    if (!['item.started', 'item.updated', 'item.completed'].includes(String(wire.type)) || item.type !== 'collab_tool_call') return false;
    if (typeof item.tool !== 'string' || !TOOL_NAMES[item.tool] || typeof item.id !== 'string') return false;
    await this.serial(async () => {
      const nativeId = text(item.id);
      const tool = text(item.tool);
      if (!nativeId || !tool || !TOOL_NAMES[tool]) return;
      const callId = `codex-${turnKey}-${nativeId}`;
      const states = record(item.agents_states);
      const ids = [...new Set([...strings(item.receiver_thread_ids), ...Object.keys(states)])];
      const done = wire.type === 'item.completed';
      const toolStatus: ToolCall['status'] = item.status === 'failed' ? 'error' : item.status === 'interrupted' ? 'interrupted' : done ? 'completed' : 'running';
      const prompt = text(item.prompt);
      const senderId = text(item.sender_thread_id) ?? rootThreadId;
      if (rootThreadId && senderId !== rootThreadId && !this.tasks.has(senderId!)) return;
      const dispatch: ChatMessage = {
        id: callId, role: 'system', content: '', timestamp: Date.now(),
        toolCall: { id: callId, toolName: TOOL_NAMES[tool], toolInput: json({ description: prompt, prompt, receiverThreadIds: ids }), status: toolStatus,
          toolResult: done ? json(item, 8_000) : undefined },
      };
      if (tool === 'spawn_agent' && ids.length === 0) {
        await this.save({ ...dispatch, subagent: { parentToolUseId: callId, description: prompt?.slice(0, 80) },
          subagentTask: { taskId: callId, status: toolStatus === 'error' ? 'failed' : toolStatus === 'interrupted' ? 'stopped' : 'pending' } });
      }
      for (const id of ids) {
        if (!senderId || id === rootThreadId) continue;
        let task = this.tasks.get(id);
        if (!task) {
          const headerId = tool === 'spawn_agent' ? callId : `codex-child-${id}`;
          task = {
            threadId: id, parentThreadId: senderId, knownTurns: new Set(), awaitingNewTurn: false,
            readComplete: false, nextReadAt: 0, failures: 0,
            header: { ...(tool === 'spawn_agent' ? dispatch : { id: headerId, role: 'system' as const, content: '', timestamp: Date.now() }),
              subagent: { parentToolUseId: headerId, agentId: id, description: prompt?.slice(0, 80) },
              subagentTask: { taskId: id, status: 'pending' } },
          };
          this.tasks.set(id, task);
        }
        if (tool === 'spawn_agent') task.header = { ...task.header, toolCall: dispatch.toolCall };
        // Sending ordinary mail or waiting does not start a new task. Follow-up
        // and send_input do; keep an older completed snapshot from winning that race.
        if (wire.type === 'item.started' && (tool === 'followup_task' || tool === 'send_input')) {
          task.awaitingNewTurn = true;
          task.header.subagentTask = { taskId: id, status: 'running' };
        }
        const state = record(states[id]);
        const next = agentStatus(state.status);
        const current = task.header.subagentTask!;
        const closedAfterCompletion = tool === 'close_agent' && current.status === 'completed' && next === 'stopped';
        const staleDispatchState = task.awaitingNewTurn && (tool === 'followup_task' || tool === 'send_input') && next !== 'running' && next !== 'pending';
        const staleActiveState = (next === 'running' || next === 'pending') && !isSubagentTaskActive(current)
          && current.status !== 'unknown' && !['send_input', 'followup_task', 'resume_agent'].includes(tool);
        if (next && !closedAfterCompletion && !staleDispatchState && !staleActiveState) {
          task.header.subagentTask = { ...current, status: next, summary: text(state.message) ?? current.summary };
          if (tool === 'wait' || tool === 'interrupt_agent' || tool === 'close_agent') task.awaitingNewTurn = false;
        }
        task.readComplete = false;
        task.nextReadAt = 0;
        await this.save(task.header);
        if (tool !== 'spawn_agent') await this.save({ ...dispatch, id: `${callId}:${id}`, toolCall: { ...dispatch.toolCall!, id: `${callId}:${id}` }, subagent: task.header.subagent });
      }
      // Discovery without targets still has useful status, but is not a child.
      if (tool !== 'spawn_agent' && !ids.length) await this.save(dispatch);
      this.schedule();
    });
    return true;
  }

  private async importTurn(task: ChildTask, turn: CodexChildTurn, final: boolean): Promise<void> {
    for (const item of turn.items) {
      if (typeof item.id !== 'string' || typeof item.type !== 'string') continue;
      if (['reasoning', 'plan', 'userMessage', 'subAgentActivity'].includes(item.type)) continue;
      // An observer process synthesizes interruption for unfinished tool calls.
      // Show those rows once a result arrives or the owning SDK process exits.
      if (!final && item.status === 'interrupted' && turn.status === 'interrupted'
        && isSubagentTaskActive(task.header.subagentTask!)) continue;
      const id = `codex-child-${task.threadId}-${turn.id}-${item.id}`;
      const base: ChatMessage = { id, role: 'system', content: '', timestamp: (turn.startedAt ?? Date.now() / 1_000) * 1_000, subagent: task.header.subagent };
      if (item.type === 'agentMessage') {
        if (typeof item.text === 'string' && item.text) await this.save({ ...base, role: 'assistant', content: item.text });
        continue;
      }
      const status: ToolCall['status'] = item.status === 'inProgress' ? (turn.status === 'inProgress' ? 'running' : 'interrupted')
        : item.status === 'failed' || item.status === 'declined' ? 'error'
          : item.status === 'interrupted' ? 'interrupted' : 'completed';
      const toolName = ({ commandExecution: 'command_execution', fileChange: 'file_change', webSearch: 'web_search', collabAgentToolCall: '子 Agent 调度' } as Record<string, string>)[item.type]
        ?? text(item.tool) ?? item.type;
      const input = item.arguments ?? item.command ?? item.changes ?? item.query ?? item;
      await this.save({ ...base, toolCall: { id, toolName, toolInput: json(input), status,
        toolResult: json(item.result ?? item.aggregatedOutput ?? item, 8_000),
        duration: typeof item.durationMs === 'number' ? item.durationMs : undefined,
        error: text(record(item.error).message),
      } });
    }
    task.knownTurns.add(turn.id);
  }

  private async refresh(final = false): Promise<void> {
    if (!this.monitoring && !final) return;
    for (const task of this.tasks.values()) {
      if (task.readComplete || (!final && Date.now() < task.nextReadAt)) continue;
      let snapshot;
      try {
        this.reader ??= new CodexSubagentReader(this.folderPath);
        snapshot = await this.reader.read(task.threadId, task.parentThreadId, task.knownTurns);
      } catch {
        task.failures++;
        task.nextReadAt = Date.now() + Math.min(10_000, 1_000 * 2 ** task.failures);
        task.header.subagentTask = { ...task.header.subagentTask!, detailError: '子任务详情暂时无法读取；任务状态和结果摘要仍会更新。' };
        await this.save(task.header);
        continue;
      }
      task.failures = 0;
      task.header.subagent = { ...task.header.subagent, type: snapshot.role ?? task.header.subagent?.type };
      for (const turn of snapshot.turns) await this.importTurn(task, turn, final);
      const latest = snapshot.turns.at(-1);
      if (latest && (!task.awaitingNewTurn || (task.latestTurn && latest.id !== task.latestTurn) || latest.status === 'inProgress')) {
        task.awaitingNewTurn = false;
        task.latestTurn = latest.id;
        const current = task.header.subagentTask!;
        // A read-only app-server has not loaded the SDK's running threads and
        // reports unfinished persisted turns as "interrupted". That is not a
        // live stop event; only exec or actual process exit may stop the badge.
        const status = latest.status === 'completed' ? 'completed' : latest.status === 'failed' ? 'failed'
          : current.status;
        // Persisted rollout can lag the live exec terminal event. It cannot revive it.
        const resolved = isSubagentTaskActive(current) || current.status === 'unknown' ? status : current.status;
        const hasReply = latest.items.some(item => item.type === 'agentMessage' && item.text === current.summary);
        task.header.subagentTask = { ...current, status: resolved, summary: hasReply ? undefined : text(latest.error?.message) ?? current.summary, detailError: undefined };
        task.readComplete = latest.status !== 'inProgress' && !isSubagentTaskActive(task.header.subagentTask) && task.header.subagentTask.status !== 'unknown';
      } else task.header.subagentTask = { ...task.header.subagentTask!, detailError: undefined };
      await this.save(task.header);
    }
  }

  async finish(): Promise<void> {
    if (this.finishing) return this.finishing;
    if (!this.monitoring) return;
    this.monitoring = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.finishing = this.serial(async () => {
      try {
        await this.refresh(true);
        for (const message of [...this.saved.values()]) {
          const active = message.subagentTask && isSubagentTaskActive(message.subagentTask);
          if (!active && message.toolCall?.status !== 'running') continue;
          const updated: ChatMessage = { ...message,
            subagentTask: active ? { ...message.subagentTask!, status: 'stopped', summary: 'Codex 会话已结束，子任务未返回完成事件。' } : message.subagentTask,
            toolCall: message.toolCall?.status === 'running' ? { ...message.toolCall, status: 'interrupted' } : message.toolCall,
          };
          await this.save(updated);
          const task = updated.subagent?.agentId && this.tasks.get(updated.subagent.agentId);
          if (task && task.header.id === updated.id) task.header = updated;
        }
        for (const task of this.tasks.values()) task.readComplete = true;
      } finally { this.reader?.close(); this.reader = undefined; }
    });
    return this.finishing;
  }

  close(): void {
    this.monitoring = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.reader?.close();
  }
}
