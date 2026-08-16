import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Attachment, AvailableSkill, AvailableSkillSource } from '../shared/ipc.types';
import { useAppStore } from '../stores/app.store';
import {
  filterAvailableSkills,
  getSkillSearchQuery,
  makeSkillCommand,
} from '../shared/skill-command';

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

const NODE_REF_ICONS: Record<string, string> = {
  text: '📄',
  image: '🖼️',
  video: '🎞️',
  audio: '🎵',
  upscale: '✨',
};

const SKILL_SOURCE_LABELS: Record<AvailableSkillSource, string> = {
  builtin: '内置',
  project: '项目',
  user: '用户',
  sdk: '会话',
};

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [hint, setHint] = useState('');
  const [skills, setSkills] = useState<AvailableSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentProject = useAppStore((s) => s.currentProject);
  const referencedArtifacts = useAppStore((s) => s.referencedArtifacts);
  const removeArtifactReference = useAppStore((s) => s.removeArtifactReference);
  const referencedCanvasNodes = useAppStore((s) => s.referencedCanvasNodes);
  const removeCanvasNodeReference = useAppStore((s) => s.removeCanvasNodeReference);
  const hasReferences = referencedArtifacts.length > 0 || referencedCanvasNodes.length > 0;
  const skillQuery = getSkillSearchQuery(content);
  const isEditingSkillCommand = skillQuery !== null;
  const filteredSkills = useMemo(
    () => filterAvailableSkills(skills, skillQuery ?? ''),
    [skills, skillQuery],
  );
  const showSkillMenu = isEditingSkillCommand && !skillMenuDismissed;

  useEffect(() => {
    if (!isEditingSkillCommand || !currentProject) return;
    let cancelled = false;
    setSkillsLoading(true);
    void window.electronAPI.listAgentSkills(currentProject.id)
      .then((available) => {
        if (!cancelled) setSkills(available);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEditingSkillCommand, currentProject]);

  useEffect(() => {
    setActiveSkillIndex(0);
  }, [skillQuery]);

  useEffect(() => {
    setContent('');
    setAttachments([]);
    setHint('');
    setSkills([]);
    setSkillMenuDismissed(false);
  }, [currentProject?.id]);

  const selectSkill = (skill: AvailableSkill) => {
    setContent(makeSkillCommand(skill.name));
    setSkillMenuDismissed(true);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSkillMenu) {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        handleSend();
      }
      return;
    }
    if (event.key === 'ArrowDown' && filteredSkills.length > 0) {
      event.preventDefault();
      setActiveSkillIndex((index) => (index + 1) % filteredSkills.length);
    } else if (event.key === 'ArrowUp' && filteredSkills.length > 0) {
      event.preventDefault();
      setActiveSkillIndex((index) => (index - 1 + filteredSkills.length) % filteredSkills.length);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && filteredSkills[activeSkillIndex]) {
      event.preventDefault();
      selectSkill(filteredSkills[activeSkillIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSkillMenuDismissed(true);
    }
  };

  const handleSend = () => {
    if (!content.trim() && attachments.length === 0 && !hasReferences) return;
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
    <div className='relative p-3'>
      {/* Rejected-file hint */}
      {hint && <div className='mb-2 text-xs text-[#e8c766]'>{hint}</div>}

      {showSkillMenu && (
        <div
          className='absolute bottom-full left-3 right-3 z-30 mb-1 overflow-hidden rounded-xl border border-[#d4af37]/30 bg-[#15141d]/98 shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl'
          role='listbox'
          aria-label='可用 Skill'
        >
          <div className='flex items-center border-b border-white/[0.08] px-3 py-2'>
            <span className='text-[10px] text-[#d4af37]'>✦</span>
            <span className='ml-2 text-xs font-medium text-[#e8e6df]'>选择 Skill</span>
            <span className='ml-auto text-[10px] text-[#6d6a78]'>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
          </div>
          <div className='max-h-64 overflow-y-auto p-1.5'>
            {skillsLoading && skills.length === 0 ? (
              <div className='px-3 py-4 text-center text-xs text-[#6d6a78]'>正在读取可用 Skill…</div>
            ) : filteredSkills.length === 0 ? (
              <div className='px-3 py-4 text-center text-xs text-[#6d6a78]'>没有匹配的 Skill</div>
            ) : filteredSkills.map((skill, index) => (
              <button
                key={`${skill.source}:${skill.name}`}
                type='button'
                role='option'
                aria-selected={index === activeSkillIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSkill(skill)}
                onMouseEnter={() => setActiveSkillIndex(index)}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition ${
                  index === activeSkillIndex
                    ? 'bg-[#d4af37]/12 text-[#f2d879]'
                    : 'text-[#d0cdd7] hover:bg-white/[0.05]'
                }`}
              >
                <span className='mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md border border-[#d4af37]/25 bg-[#d4af37]/[0.08] text-[11px] text-[#e8c766]'>/</span>
                <span className='min-w-0 flex-1'>
                  <span className='flex items-center gap-2'>
                    <span className='truncate font-mono text-xs'>/{skill.name}</span>
                    <span className='flex-none rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-[#777482]'>
                      {SKILL_SOURCE_LABELS[skill.source]}
                    </span>
                  </span>
                  <span className='mt-1 block truncate text-[11px] text-[#777482]'>
                    {skill.description}{skill.argumentHint ? ` · ${skill.argumentHint}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

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

        {/* Referenced live canvas nodes */}
        {referencedCanvasNodes.length > 0 && (
          <div className='flex flex-wrap gap-2 px-3 pt-3'>
            {referencedCanvasNodes.map((ref) => (
              <div
                key={ref.id}
                className='flex items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-400/[0.08] px-2 py-1 text-xs text-sky-200'
                title={`节点 ID：${ref.id}`}
              >
                <span>{NODE_REF_ICONS[ref.kind] ?? '◆'}</span>
                <span className='max-w-[140px] truncate'>{ref.title}</span>
                <button
                  onClick={() => removeCanvasNodeReference(ref.id)}
                  className='ml-1 text-[#8a8794] hover:text-[#e8e6df]'
                  title='移除节点引用'
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
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setSkillMenuDismissed(false);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setSkillMenuDismissed(true), 100)}
          disabled={disabled}
          placeholder='描述你的想法，输入 / 使用 Skill，或拖入附件…'
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
            disabled={disabled || (!content.trim() && attachments.length === 0 && !hasReferences)}
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
