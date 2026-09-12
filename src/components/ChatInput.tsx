import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, SetStateAction } from 'react';
import type { Attachment, AvailableSkill, AvailableSkillSource } from '../shared/ipc.types';
import { useAppStore } from '../stores/app.store';
import { canClearSubmittedDraft } from '../shared/chat-state';
import { chatTextAttachmentPrompt, shouldAttachChatText } from '../shared/chat-text-attachment';
import {
  filterAvailableSkills,
  getSkillSearchQuery,
  makeSkillCommand,
} from '../shared/skill-command';

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => Promise<boolean>;
  disabled?: boolean;
}

const ATTACHMENT_ICONS: Record<string, string> = {
  srt: '📝',
  txt: '📄',
  md: '📄',
  pdf: '📕',
  mp3: '🎵',
  wav: '🎵',
  m4a: '🎵',
  flac: '🎵',
  ogg: '🎵',
  aac: '🎵',
  mp4: '🎞️',
  webm: '🎞️',
  mov: '🎞️',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  webp: '🖼️',
  gif: '🖼️',
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
  const [content, setContentValue] = useState('');
  const [attachments, setAttachmentsValue] = useState<Attachment[]>([]);
  const draftVersionRef = useRef(0);
  const projectEpochRef = useRef(0);
  const submissionRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const contentRef = useRef('');
  const [isComposing, setIsComposing] = useState(false);
  const [convertingTextCount, setConvertingTextCount] = useState(0);
  const textAttachmentRef = useRef<{ epoch: number; content: string; promise: Promise<Attachment> } | null>(null);
  const setContent = (value: string) => { draftVersionRef.current += 1; contentRef.current = value; setContentValue(value); };
  const setAttachments = (value: SetStateAction<Attachment[]>) => { draftVersionRef.current += 1; setAttachmentsValue(value); };
  const [hint, setHint] = useState('');
  const [skills, setSkills] = useState<AvailableSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [pastedImageCount, setPastedImageCount] = useState(0);
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
    projectEpochRef.current += 1;
    submissionRef.current = false;
    setIsSubmitting(false);
    setContent('');
    setAttachments([]);
    setHint('');
    setSkills([]);
    setSkillMenuDismissed(false);
    setPastedImageCount(0);
    setConvertingTextCount(0);
    setIsComposing(false);
    textAttachmentRef.current = null;
  }, [currentProject?.id]);

  const prepareTextAttachment = useCallback((text: string) => {
    const epoch = projectEpochRef.current;
    const existing = textAttachmentRef.current;
    if (existing?.epoch === epoch && existing.content === text) return existing.promise;
    if (!currentProject) return Promise.reject(new Error('当前项目不可用'));
    const entry = {
      epoch, content: text,
      promise: window.electronAPI.saveChatTextAttachment(currentProject.id, text).then((result) => {
        if (!result.success || !result.attachment) throw new Error(result.error || '文本附件保存失败');
        return result.attachment;
      }),
    };
    textAttachmentRef.current = entry;
    entry.promise = entry.promise.catch((error) => {
      if (textAttachmentRef.current === entry) textAttachmentRef.current = null;
      throw error;
    });
    return entry.promise;
  }, [currentProject]);

  useEffect(() => {
    if (disabled || !currentProject || isComposing || isSubmitting || !shouldAttachChatText(content)) return;
    const epoch = projectEpochRef.current;
    let cancelled = false;
    // Let typing/pasting and Chinese IME composition finish before taking a copy.
    const timer = window.setTimeout(() => {
      if (submissionRef.current) return;
      setConvertingTextCount((count) => count + 1);
      void prepareTextAttachment(content).then((attachment) => {
        if (cancelled || submissionRef.current || epoch !== projectEpochRef.current
          || useAppStore.getState().currentProject !== currentProject || contentRef.current !== content) return;
        setAttachments((previous) => [...previous, attachment]);
        setContent(chatTextAttachmentPrompt(content, attachment.name));
        setSkillMenuDismissed(true);
        setHint('超过 1000 字的文本已转为 TXT 附件，完整原文已保留。');
      }).catch((error) => {
        if (!cancelled && epoch === projectEpochRef.current) setHint(`${error instanceof Error ? error.message : '文本附件保存失败'}，原文已保留，可点击发送重试。`);
      }).finally(() => {
        if (epoch === projectEpochRef.current) setConvertingTextCount((count) => Math.max(0, count - 1));
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [content, currentProject, disabled, isComposing, isSubmitting, prepareTextAttachment]);

  const selectSkill = (skill: AvailableSkill) => {
    setContent(makeSkillCommand(skill.name));
    setSkillMenuDismissed(true);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSkillMenu) {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void handleSend();
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

  const handleSend = async () => {
    if (disabled || !currentProject || isComposing || submissionRef.current || pastedImageCount > 0 || (!content.trim() && attachments.length === 0 && !hasReferences)) return;
    const projectId = currentProject.id;
    const epoch = projectEpochRef.current;
    const version = draftVersionRef.current;
    submissionRef.current = true;
    setIsSubmitting(true);
    let handedToParent = false;
    try {
      let outgoingContent = content.trim();
      let outgoingAttachments = attachments;
      // Sending before the debounce finishes follows the same conversion path.
      if (shouldAttachChatText(content)) {
        const attachment = await prepareTextAttachment(content);
        if (epoch !== projectEpochRef.current || useAppStore.getState().currentProject !== currentProject) return;
        outgoingContent = chatTextAttachmentPrompt(content, attachment.name);
        outgoingAttachments = [...attachments, attachment];
      }
      handedToParent = true;
      const accepted = await onSend(outgoingContent, outgoingAttachments.length > 0 ? outgoingAttachments : undefined);
      if (accepted && useAppStore.getState().currentProject === currentProject && epoch === projectEpochRef.current && canClearSubmittedDraft(version, draftVersionRef.current, projectId, useAppStore.getState().currentProject?.id)) {
        setContent('');
        setAttachments([]);
        setHint('');
        textAttachmentRef.current = null;
      }
    } catch (error) {
      if (!handedToParent && epoch === projectEpochRef.current && useAppStore.getState().currentProject === currentProject) {
        setHint(`${error instanceof Error ? error.message : '文本附件保存失败'}。输入内容与附件已保留，可重试。`);
      }
      // The parent displays the failure. Keeping the live draft also preserves
      // any edits or new attachments added while the request was pending.
    } finally {
      if (epoch === projectEpochRef.current) {
        submissionRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments = Array.from(files).flatMap((file): Attachment[] => {
      const sourcePath = window.electronAPI.getPathForFile(file);
      if (!sourcePath) return [];
      const extension = file.name.includes('.')
        ? file.name.toLowerCase().split('.').pop() || 'file'
        : 'file';
      return [{
        type: extension,
        name: file.name,
        path: sourcePath,
      }];
    });

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || !currentProject) return;
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (imageFiles.length === 0) return;

    event.preventDefault();
    const projectId = currentProject.id;
    const epoch = projectEpochRef.current;
    const isCurrent = () => useAppStore.getState().currentProject === currentProject && projectEpochRef.current === epoch;
    setPastedImageCount((count) => count + imageFiles.length);
    const saved: Attachment[] = [];
    const errors: string[] = [];
    try {
      for (const file of imageFiles) {
        const result = await window.electronAPI.savePastedImage(
          projectId,
          await file.arrayBuffer(),
          file.type,
        );
        if (result.success && result.attachment) saved.push(result.attachment);
        else errors.push(result.error || '图片保存失败');
      }
      if (!isCurrent()) return;
      if (saved.length > 0) setAttachments((prev) => [...prev, ...saved]);
      if (errors.length > 0) {
        setHint(errors[0]);
        window.setTimeout(() => setHint(''), 3000);
      }
    } catch (error) {
      if (isCurrent()) {
        setHint(error instanceof Error ? error.message : '粘贴图片失败');
        window.setTimeout(() => setHint(''), 3000);
      }
    } finally {
      if (isCurrent()) {
        setPastedImageCount((count) => Math.max(0, count - imageFiles.length));
      }
    }
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
        {(attachments.length > 0 || pastedImageCount > 0 || convertingTextCount > 0) && (
          <div className='flex flex-wrap gap-2 px-3 pt-3'>
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className='flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 p-1 pr-2 text-xs text-[#b8b5c2]'
              >
                {['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(attachment.type.toLowerCase()) ? (
                  <img
                    src={`local-file:///${encodeURI(attachment.path.replace(/^\/+/, ''))}`}
                    alt={attachment.name}
                    className='h-9 w-9 rounded-md object-cover'
                  />
                ) : <span>{ATTACHMENT_ICONS[attachment.type] ?? '📎'}</span>}
                <span className='max-w-[120px] truncate'>{attachment.name}</span>
                <button
                  onClick={() => removeAttachment(index)}
                  className='ml-1 text-[#6d6a78] hover:text-[#e8e6df]'
                  title='移除附件'
                >
                  ×
                </button>
              </div>
            ))}
            {pastedImageCount > 0 && (
              <div className='flex items-center gap-2 rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.06] px-2.5 py-1.5 text-xs text-[#e8c766]'>
                <span className='h-3 w-3 animate-spin rounded-full border border-current border-r-transparent' />
                正在添加图片…
              </div>
            )}
            {convertingTextCount > 0 && <span role='status' className='px-2 py-1 text-xs text-[#e8c766]'>正在转换为 TXT 附件…</span>}
          </div>
        )}

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setHint('');
            setSkillMenuDismissed(false);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onBlur={() => window.setTimeout(() => setSkillMenuDismissed(true), 100)}
          disabled={disabled}
          placeholder='描述你的想法，输入 / 使用 Skill，或添加文件…'
          rows={3}
          className='w-full resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed text-[#e8e6df] placeholder:text-[#5a5766] focus:outline-none disabled:opacity-50'
        />

        {/* Bottom toolbar */}
        <div className='flex items-center gap-1 px-2 pb-2'>
          <input
            ref={fileInputRef}
            type='file'
            aria-label='聊天附件'
            multiple
            onChange={handleFileSelect}
            className='hidden'
          />

          {/* File upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className='flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8794] transition hover:bg-white/5 hover:text-[#e8c766] disabled:opacity-50'
            title='上传文件'
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
            onClick={() => void handleSend()}
            disabled={disabled || isSubmitting || pastedImageCount > 0 || (!content.trim() && attachments.length === 0 && !hasReferences)}
            className='ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-[#d4af37]/50 bg-gradient-to-b from-[#e8c766] to-[#b08d2a] text-[#241a05] shadow-[0_2px_12px_rgba(212,175,55,0.25)] transition hover:brightness-110 disabled:border-white/10 disabled:bg-none disabled:bg-white/5 disabled:text-[#6d6a78] disabled:shadow-none'
            title={isSubmitting ? '正在发送…' : '发送'}
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
