import { useId, useState } from 'react';
import type { SubagentMessageGroup } from '../shared/chat-subagents';
import { ChatMessageItem } from './ChatMessage';

const STATUS = {
  pending: { label: '等待中', color: 'text-amber-300' },
  running: { label: '运行中', color: 'text-sky-300' },
  paused: { label: '已暂停', color: 'text-amber-300' },
  completed: { label: '已完成', color: 'text-emerald-300' },
  failed: { label: '失败', color: 'text-rose-300' },
  stopped: { label: '已停止', color: 'text-[#8a9ba9]' },
  starting: { label: '启动中', color: 'text-sky-300' },
  unknown: { label: '状态未知', color: 'text-[#8a9ba9]' },
};

export function ChatSubagentGroup({ group }: { group: SubagentMessageGroup }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const status = STATUS[group.task?.status ?? (group.trigger?.toolCall?.status === 'running' ? 'starting'
    : group.trigger?.toolCall?.status === 'error' ? 'failed'
      : group.trigger?.toolCall?.status === 'interrupted' ? 'stopped' : 'unknown')];
  const label = group.description || group.type || '子 Agent 任务';
  const count = group.messages.length;

  return (
    <section aria-label={`子 Agent：${label}`} className="my-2 overflow-hidden rounded-xl border border-sky-400/20 bg-[#141822]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.035] focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-400/10 text-xs text-sky-200">◇</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#dce8f1]" title={label}>子 Agent · {label}</span>
        <span role="status" className={`flex shrink-0 items-center gap-1 text-[10px] ${status.color}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full bg-current ${status === STATUS.running || status === STATUS.starting ? 'motion-safe:animate-pulse' : ''}`} />
          {status.label}
        </span>
        <span className="shrink-0 text-[10px] text-[#8a9ba9]">{count} 条</span>
        <span aria-hidden="true" className={`shrink-0 text-xs text-[#8a9ba9] transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
      </button>
      {expanded && (
        <div id={contentId} className="max-h-[440px] overflow-y-auto border-t border-sky-400/10 bg-[#10141d] px-2 py-2">
          {group.trigger && <ChatMessageItem message={group.trigger} />}
          {group.messages.map(message => <ChatMessageItem key={message.id} message={message} />)}
          {group.task?.summary && <p className="whitespace-pre-wrap break-words px-3 py-2 text-xs text-[#8a9ba9]">{group.task.summary}</p>}
          {group.task?.detailError && <p className="px-3 py-2 text-xs text-amber-300">{group.task.detailError}</p>}
          {count === 0 && <p className="px-3 py-3 text-xs text-[#8a9ba9]">暂无可显示的子 Agent 消息。</p>}
        </div>
      )}
    </section>
  );
}
