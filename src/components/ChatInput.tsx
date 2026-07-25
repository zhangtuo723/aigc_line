import { useState, useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment } from '../shared/ipc.types';

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTS = ['srt', 'mp3', 'wav', 'm4a', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'];
const ACCEPT_STRING = ACCEPTED_EXTS.map((ext) => `.${ext}`).join(',');

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

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [hint, setHint] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (!content.trim() && attachments.length === 0) return;
    onSend(content.trim(), attachments.length > 0 ? attachments : undefined);
    setContent('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    let rejected = 0;
    for (const file of Array.from(files)) {
      const ext = file.name.toLowerCase().split('.').pop() || '';
      if (!ACCEPTED_EXTS.includes(ext)) {
        rejected += 1;
        continue;
      }
      newAttachments.push({
        type: ext,
        name: file.name,
        path: window.electronAPI.getPathForFile(file),
      });
    }

    if (rejected > 0) {
      setHint(`${rejected} 个文件格式不支持，已跳过`);
      window.setTimeout(() => setHint(''), 3000);
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className='p-3'>
      {/* Rejected-file hint */}
      {hint && <div className='mb-2 text-xs text-[#e8c766]'>{hint}</div>}

      {/* Selected attachments preview */}
      {attachments.length > 0 && (
        <div className='mb-2 flex flex-wrap gap-2'>
          {attachments.map((attachment, index) => (
            <div
              key={index}
              className='flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-[#b8b5c2]'
            >
              <span>{ATTACHMENT_ICONS[attachment.type] ?? '📎'}</span>
              <span className='max-w-[120px] truncate'>{attachment.name}</span>
              <button
                onClick={() => removeAttachment(index)}
                className='ml-1 text-[#6d6a78] hover:text-[#e8e6df]'
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className='flex items-end gap-2'>
        {/* File upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-[#8a8794] transition hover:bg-white/5 hover:text-[#e8c766] disabled:opacity-50'
          title='上传文件'
        >
          <svg className='h-5 w-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13'
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type='file'
          accept={ACCEPT_STRING}
          multiple
          onChange={handleFileSelect}
          className='hidden'
        />

        {/* Text input */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder='输入消息...'
          rows={1}
          className='min-h-[40px] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-[#e8e6df] placeholder:text-[#5a5766] focus:border-[#d4af37]/50 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/20 disabled:opacity-50'
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={disabled || (!content.trim() && attachments.length === 0)}
          className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#d4af37]/50 bg-gradient-to-b from-[#e8c766] to-[#b08d2a] text-[#241a05] shadow-[0_2px_12px_rgba(212,175,55,0.25)] transition hover:brightness-110 disabled:opacity-40'
        >
          <svg className='h-5 w-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M12 19l9 2-9-18-9 18 9-2zm0 0v-8'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
