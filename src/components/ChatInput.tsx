import { useState, useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment } from '../shared/ipc.types';
import { useAppStore } from '../stores/app.store';

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

const REF_ICONS: Record<string, string> = {
  storyboard: '🎬',
  markdown: '📄',
  html: '🌐',
  image: '🖼️',
};

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [hint, setHint] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referencedArtifacts = useAppStore((s) => s.referencedArtifacts);
  const removeArtifactReference = useAppStore((s) => s.removeArtifactReference);

  const handleSend = () => {
    if (!content.trim() && attachments.length === 0) return;
    onSend(content.trim(), attachments.length > 0 ? attachments : undefined);
    setContent('');
    setAttachments([]);
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

      <div className='rounded-2xl border border-white/10 bg-white/[0.04] transition focus-within:border-[#d4af37]/40 focus-within:ring-1 focus-within:ring-[#d4af37]/20'>
        {/* Referenced canvas artifacts */}
        {referencedArtifacts.length > 0 && (
          <div className='flex flex-wrap gap-2 px-3 pt-3'>
            {referencedArtifacts.map((ref) => (
              <div
                key={ref.id}
                className='flex items-center gap-1 rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/[0.08] px-2 py-1 text-xs text-[#e8c766]'
              >
                <span>{REF_ICONS[ref.type] ?? '📦'}</span>
                <span className='max-w-[140px] truncate'>{ref.title}</span>
                <button
                  onClick={() => removeArtifactReference(ref.id)}
                  className='ml-1 text-[#8a8794] hover:text-[#e8e6df]'
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Selected attachments preview */}
        {attachments.length > 0 && (
          <div className='flex flex-wrap gap-2 px-3 pt-3'>
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

        {/* Text input */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={disabled}
          placeholder='描述你的想法，或拖入附件…'
          rows={3}
          className='w-full resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed text-[#e8e6df] placeholder:text-[#5a5766] focus:outline-none disabled:opacity-50'
        />

        {/* Bottom toolbar */}
        <div className='flex items-center gap-1 px-2 pb-2'>
          <input
            ref={fileInputRef}
            type='file'
            accept={ACCEPT_STRING}
            multiple
            onChange={handleFileSelect}
            className='hidden'
          />

          {/* File upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className='flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8794] transition hover:bg-white/5 hover:text-[#e8c766] disabled:opacity-50'
            title='上传附件'
          >
            <svg className='h-4.5 w-4.5' fill='none' stroke='currentColor' strokeWidth={1.8} viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                d='M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13'
              />
            </svg>
          </button>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={disabled || (!content.trim() && attachments.length === 0)}
            className='ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-[#d4af37]/50 bg-gradient-to-b from-[#e8c766] to-[#b08d2a] text-[#241a05] shadow-[0_2px_12px_rgba(212,175,55,0.25)] transition hover:brightness-110 disabled:border-white/10 disabled:bg-none disabled:bg-white/5 disabled:text-[#6d6a78] disabled:shadow-none'
            title='发送'
          >
            <svg className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth={2} viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' d='M5 12h14M13 6l6 6-6 6' />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
