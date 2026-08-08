import type { Attachment, ChatMessage } from '../shared/ipc.types';
import { useEffect, useState } from 'react';
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

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif']);

const isImageAttachment = (attachment: Attachment) =>
  IMAGE_EXTENSIONS.has(attachment.type.toLowerCase());

// Served by the `local-file` protocol registered in the main process
const localFileUrl = (path: string) =>
  `local-file:///${encodeURI(path.replace(/^\/+/, ''))}`;

// Image attachment: small thumbnail perched above the bubble, click to view full size
function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const url = localFileUrl(attachment.path);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  return (
    <>
      <button
        type='button'
        onClick={() => setLightboxOpen(true)}
        className='app-no-drag block h-12 w-12 overflow-hidden rounded-lg border border-white/15 shadow-sm transition hover:scale-105 hover:border-[#d4af37]/50'
        title={attachment.name}
      >
        <img
          src={url}
          alt={attachment.name}
          className='h-full w-full object-cover'
          loading='lazy'
        />
      </button>

      {lightboxOpen && (
        <div
          className='fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-8'
          onClick={() => setLightboxOpen(false)}
        >
          <img
            src={url}
            alt={attachment.name}
            className='max-h-full max-w-full rounded-lg object-contain shadow-2xl'
          />
          <span className='absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/70'>
            {attachment.name} · 点击任意处或按 Esc 关闭
          </span>
        </div>
      )}
    </>
  );
}

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
        ) : toolCall.status === 'completed' ? (
          <>
            <svg className='h-3 w-3 text-emerald-400' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
            </svg>
            <span className='text-emerald-400'>
              {toolCall.toolName}
              {toolCall.duration && ` (${toolCall.duration}ms)`}
            </span>
          </>
        ) : toolCall.status === 'interrupted' ? (
          <>
            <svg className='h-3 w-3 text-amber-400' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 6l12 12M18 6L6 18' />
            </svg>
            <span className='text-amber-400'>已中断: {toolCall.toolName}</span>
          </>
        ) : (
          <>
            <svg className='h-3 w-3 text-rose-400' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 6l12 12M18 6L6 18' />
            </svg>
            <span className='text-rose-400'>执行失败: {toolCall.toolName}</span>
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

  if (message.event === 'context-cleared') {
    return (
      <div className='flex items-center gap-3 py-4' role='separator' aria-label='Claude 上下文已清空'>
        <div className='h-px flex-1 bg-gradient-to-r from-transparent to-[#d4af37]/30' />
        <div className='max-w-[75%] text-center'>
          <div className='text-[10px] font-medium tracking-wider text-[#e8c766]'>上下文已清空</div>
          <div className='mt-1 text-[10px] leading-4 text-[#6d6a78]'>之前消息仅供查看，画布和历史记录未删除</div>
        </div>
        <div className='h-px flex-1 bg-gradient-to-l from-transparent to-[#d4af37]/30' />
      </div>
    );
  }

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
              {art.type === 'image' ? '图片' : art.type === 'storyboard' ? '分镜表' : art.type}
            </span>
          </div>
          <div className='mt-1 text-xs text-[#6d6a78]'>
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  }

  const imageAttachments = message.attachments?.filter(isImageAttachment) ?? [];
  const fileAttachments = message.attachments?.filter((a) => !isImageAttachment(a)) ?? [];
  const hasBubbleContent =
    isToolCall ||
    fileAttachments.length > 0 ||
    !!message.content ||
    (message.artifactRefs?.length ?? 0) > 0 ||
    (message.nodeRefs?.length ?? 0) > 0;

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

      {/* Image attachments: small thumbnails perched above the bubble, sender-aligned */}
      <div
        className={[
          'flex max-w-[70%] flex-col gap-1',
          isUser ? 'items-end' : 'items-start',
        ].join(' ')}
      >
        {imageAttachments.length > 0 && (
          <div
            className={[
              'flex flex-wrap gap-1.5',
              isUser ? 'justify-end' : 'justify-start',
            ].join(' ')}
          >
            {imageAttachments.map((attachment, index) => (
              <ImageAttachment key={index} attachment={attachment} />
            ))}
          </div>
        )}

        {/* Message bubble (skipped for image-only messages) */}
        {hasBubbleContent ? (
          <div
            className={[
              'rounded-2xl border px-4 py-2.5 text-sm leading-relaxed',
              isUser
                ? 'rounded-tr-sm border-[#d4af37]/30 bg-[#d4af37]/[0.12] text-[#f5f3ea]'
                : 'rounded-tl-sm border-white/10 bg-white/[0.04] text-[#e8e6df]',
            ].join(' ')}
          >
          {/* Tool call indicator */}
          {isToolCall && message.toolCall && (
            <ToolCallBlock toolCall={message.toolCall} />
          )}

          {/* Non-image attachments */}
          {fileAttachments.length > 0 && (
            <div className='mb-2 flex flex-wrap items-start gap-2'>
              {fileAttachments.map((attachment, index) => (
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

          {/* Referenced canvas artifacts */}
          {message.artifactRefs && message.artifactRefs.length > 0 && (
            <div className='mb-2 flex flex-wrap items-start gap-2'>
              {message.artifactRefs.map((ref) => (
                <div
                  key={ref.id}
                  className='flex items-center gap-1.5 rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/[0.08] px-2 py-1 text-xs text-[#e8c766]'
                >
                  <span>
                    {ref.type === 'storyboard' ? '🎬' : ref.type === 'image' ? '🖼️' : ref.type === 'html' ? '🌐' : '📄'}
                  </span>
                  <span className='max-w-[140px] truncate'>{ref.title}</span>
                </div>
              ))}
            </div>
          )}

          {/* Referenced live canvas nodes */}
          {message.nodeRefs && message.nodeRefs.length > 0 && (
            <div className='mb-2 flex flex-wrap items-start gap-2'>
              {message.nodeRefs.map((ref) => (
                <div
                  key={ref.id}
                  className='flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/[0.08] px-2 py-1 text-xs text-sky-200'
                  title={`节点 ID：${ref.id}`}
                >
                  <span>{ref.kind === 'shot' ? '🎬' : ref.kind === 'image' ? '🖼️' : ref.kind === 'video' ? '🎞️' : ref.kind === 'audio' ? '🎵' : ref.kind === 'upscale' ? '✨' : '📄'}</span>
                  <span className='max-w-[140px] truncate'>{ref.title}</span>
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
        ) : (
          /* Image-only message: bare timestamp under the thumbnails */
          <div className='mt-1 text-xs text-[#6d6a78]'>
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
