import type { ChatMessage } from '../shared/ipc.types';
import { useState } from 'react';
import { Markdown } from './Markdown';

interface ChatMessageProps {
  message: ChatMessage;
}

type ToolCall = NonNullable<ChatMessage['toolCall']>;

const ATTACHMENT_ICONS: Record<string, string> = {
  srt: '📝',
  txt: '📄',
  md: '📄',
  mp3: '🎵',
  wav: '🎵',
  m4a: '🎵',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  webp: '🖼️',
};

// Tool call block - collapsed by default, click header to expand input/result
function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const hasDetails = !!(toolCall.toolInput || toolCall.toolResult || toolCall.error);
  const [expanded, setExpanded] = useState(!!toolCall.error);

  return (
    <div className='mb-2 text-xs'>
      <button
        type='button'
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className={[
          'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left',
          hasDetails ? 'cursor-pointer hover:bg-white/5' : 'cursor-default',
        ].join(' ')}
      >
        {toolCall.status === 'running' ? (
          <>
            <div className='h-3 w-3 animate-spin rounded-full border-2 border-[#e8c766] border-t-transparent' />
            <span className='text-[#e8c766]'>正在执行: {toolCall.toolName}</span>
          </>
        ) : (
          <>
            <svg className='h-3 w-3 text-emerald-400' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
            </svg>
            <span className='text-emerald-400'>
              {toolCall.toolName}
              {toolCall.duration && ` (${toolCall.duration}ms)`}
            </span>
          </>
        )}
        {hasDetails && (
          <svg
            className={[
              'ml-auto h-3 w-3 flex-shrink-0 text-[#6d6a78] transition-transform',
              expanded ? 'rotate-90' : '',
            ].join(' ')}
            fill='none'
            viewBox='0 0 24 24'
            stroke='currentColor'
          >
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
          </svg>
        )}
      </button>

      {expanded && (
        <div className='mt-1.5 max-h-56 space-y-1.5 overflow-y-auto pr-0.5'>
          {toolCall.toolInput && (
            <div className='break-all rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-[#8a8794]'>
              <span className='text-[#6d6a78]'>输入:</span> {toolCall.toolInput}
            </div>
          )}
          {toolCall.toolResult && (
            <div className='break-all rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-[#8a8794]'>
              <span className='text-[#6d6a78]'>结果:</span> {toolCall.toolResult}
            </div>
          )}
          {toolCall.error && (
            <div className='break-all rounded bg-rose-500/10 px-2 py-1 font-mono text-[10px] text-rose-400'>
              <span className='text-rose-300'>错误:</span> {toolCall.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatMessageItem({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isToolCall = !!message.toolCall;
  const isArtifact = !!message.artifact;

  // System messages (thinking indicators, etc.)
  if (isSystem && !isToolCall) {
    return (
      <div className='flex justify-center py-2'>
        <span className='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#8a8794]'>
          {message.content}
        </span>
      </div>
    );
  }

  // Artifact messages - rendered as a compact card in chat
  if (isArtifact && message.artifact) {
    const art = message.artifact;
    return (
      <div className='flex gap-3 py-3'>
        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 text-xs font-medium text-[#e8c766]'>
          AI
        </div>
        <div className='max-w-[70%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm leading-relaxed text-[#e8e6df]'>
          <div className='mb-1 text-xs text-[#8a8794]'>生成了产物:</div>
          <div className='flex items-center gap-2 rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-3 py-2'>
            <svg className='h-4 w-4 text-[#e8c766]' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' />
            </svg>
            <span className='text-xs font-medium text-[#e8e6df]'>{art.title}</span>
            <span className='ml-auto rounded bg-[#d4af37]/15 px-1.5 py-0.5 text-[10px] text-[#e8c766]'>
              {art.type === 'image' ? '图片' : art.type}
            </span>
          </div>
          <div className='mt-1 text-xs text-[#6d6a78]'>
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={['flex gap-3 py-3', isUser ? 'flex-row-reverse' : 'flex-row'].join(' ')}>
      {/* Avatar */}
      <div
        className={[
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-xs font-medium',
          isUser
            ? 'border-white/15 bg-white/10 text-[#e8e6df]'
            : 'border-[#d4af37]/30 bg-[#d4af37]/10 text-[#e8c766]',
        ].join(' ')}
      >
        {isUser ? '我' : isToolCall ? '🔧' : 'AI'}
      </div>

      {/* Message content */}
      <div
        className={[
          'max-w-[70%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-sm border-[#d4af37]/30 bg-[#d4af37]/[0.12] text-[#f5f3ea]'
            : 'rounded-tl-sm border-white/10 bg-white/[0.04] text-[#e8e6df]',
        ].join(' ')}
      >
        {/* Tool call indicator */}
        {isToolCall && message.toolCall && (
          <ToolCallBlock toolCall={message.toolCall} />
        )}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className='mb-2 space-y-1'>
            {message.attachments.map((attachment, index) => (
              <div
                key={index}
                className='flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs'
              >
                <span className='font-medium'>
                  {ATTACHMENT_ICONS[attachment.type] ?? '📎'}
                </span>
                <span className='truncate'>{attachment.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Text content - hide for tool messages, content is shown in toolCall block */}
        {(!isToolCall || !message.toolCall) && (
          isUser ? (
            <div className='whitespace-pre-wrap'>{message.content}</div>
          ) : (
            <Markdown>{message.content}</Markdown>
          )
        )}

        {/* Timestamp */}
        <div
          className={[
            'mt-1 text-xs',
            isUser ? 'text-[#a09258]' : 'text-[#6d6a78]',
          ].join(' ')}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
