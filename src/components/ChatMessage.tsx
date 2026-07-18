import type { ChatMessage } from '../shared/ipc.types';

interface ChatMessageProps {
  message: ChatMessage;
}

export function ChatMessageItem({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isToolCall = !!message.toolCall;

  // System messages (thinking indicators, etc.)
  if (isSystem && !isToolCall) {
    return (
      <div className='flex justify-center py-2'>
        <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500'>
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={['flex gap-3 py-3', isUser ? 'flex-row-reverse' : 'flex-row'].join(' ')}>
      {/* Avatar */}
      <div
        className={[
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium',
          isUser ? 'bg-cyan-100 text-cyan-700' : 'bg-violet-100 text-violet-700',
        ].join(' ')}
      >
        {isUser ? '我' : isToolCall ? '🔧' : 'AI'}
      </div>

      {/* Message content */}
      <div
        className={[
          'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-sm bg-cyan-500 text-white'
            : 'rounded-tl-sm bg-white text-slate-800 shadow-sm',
        ].join(' ')}
      >
        {/* Tool call indicator */}
        {isToolCall && message.toolCall && (
          <div className='mb-2 space-y-1.5 text-xs'>
            <div className='flex items-center gap-1.5'>
              {message.toolCall.status === 'running' ? (
                <>
                  <div className='h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent' />
                  <span className='text-amber-600'>正在执行: {message.toolCall.toolName}</span>
                </>
              ) : (
                <>
                  <svg className='h-3 w-3 text-emerald-500' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                  </svg>
                  <span className='text-emerald-600'>
                    {message.toolCall.toolName}
                    {message.toolCall.duration && ` (${message.toolCall.duration}ms)`}
                  </span>
                </>
              )}
            </div>
            {/* Tool input / result */}
            {message.toolCall.toolInput && (
              <div className='rounded bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-500'>
                <span className='text-slate-400'>输入:</span> {message.toolCall.toolInput}
              </div>
            )}
            {message.toolCall.toolResult && (
              <div className='rounded bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-500'>
                <span className='text-slate-400'>结果:</span> {message.toolCall.toolResult}
              </div>
            )}
            {message.toolCall.error && (
              <div className='rounded bg-red-50 px-2 py-1 font-mono text-[10px] text-red-500'>
                <span className='text-red-400'>错误:</span> {message.toolCall.error}
              </div>
            )}
          </div>
        )}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className='mb-2 space-y-1'>
            {message.attachments.map((attachment, index) => (
              <div
                key={index}
                className='flex items-center gap-2 rounded-lg bg-black/5 px-3 py-1.5 text-xs'
              >
                <span className='font-medium'>
                  {attachment.type === 'srt' ? '📝' : '🎵'}
                </span>
                <span className='truncate'>{attachment.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Text content - hide for tool messages, content is shown in toolCall block */}
        {(!isToolCall || !message.toolCall) && (
          <div className='whitespace-pre-wrap'>{message.content}</div>
        )}

        {/* Timestamp */}
        <div
          className={[
            'mt-1 text-xs',
            isUser ? 'text-cyan-100' : 'text-slate-400',
          ].join(' ')}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
