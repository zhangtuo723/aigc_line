import { useState, useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment } from '../shared/ipc.types';

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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
    for (const file of Array.from(files)) {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'srt' || ext === 'mp3') {
        newAttachments.push({
          type: ext,
          name: file.name,
          path: (file as unknown as { path: string }).path,
        });
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className='border-t border-slate-200 bg-white p-4'>
      {/* Selected attachments preview */}
      {attachments.length > 0 && (
        <div className='mb-2 flex flex-wrap gap-2'>
          {attachments.map((attachment, index) => (
            <div
              key={index}
              className='flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700'
            >
              <span>{attachment.type === 'srt' ? '📝' : '🎵'}</span>
              <span className='max-w-[120px] truncate'>{attachment.name}</span>
              <button
                onClick={() => removeAttachment(index)}
                className='ml-1 text-slate-400 hover:text-slate-600'
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
          className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50'
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
          accept='.srt,.mp3'
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
          className='min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50'
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={disabled || (!content.trim() && attachments.length === 0)}
          className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-white transition hover:bg-cyan-600 disabled:opacity-50'
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
