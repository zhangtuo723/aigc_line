import { useEffect, useState } from 'react'
import type { Artifact, StoryboardShot } from '../shared/ipc.types'
import { useAppStore } from '../stores/app.store'

interface StoryboardCardProps {
  artifact: Artifact
}

function parseShots(content: string): StoryboardShot[] | null {
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function Arrow() {
  return (
    <svg className="h-5 w-8 flex-shrink-0 text-[#d4af37]/60" fill="none" stroke="currentColor" viewBox="0 0 32 20">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2 10h26m-6-6l6 6-6 6" />
    </svg>
  )
}

function EditablePrompt({
  value,
  placeholder,
  onSave,
}: {
  value: string
  placeholder: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)

  // Sync when the underlying shot data changes (e.g. re-parsed content)
  useEffect(() => setDraft(value), [value])

  return (
    <textarea
      value={draft}
      placeholder={placeholder}
      rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft)
      }}
      className="mt-2 w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[10px] leading-relaxed text-[#8a8794] transition placeholder:text-[#5a5766] hover:border-white/10 focus:border-[#d4af37]/40 focus:bg-white/[0.03] focus:text-[#d6d3c8] focus:outline-none"
    />
  )
}

/** One media node (image or video) with version browsing and a generate button */
function MediaNode({
  kind,
  source,
  history,
  prompt,
  promptPlaceholder,
  generateLabel,
  workspaceUrl,
  onSavePrompt,
  onSetCurrent,
  onGenerate,
}: {
  kind: 'image' | 'video'
  source?: string
  history?: string[]
  prompt: string
  promptPlaceholder: string
  generateLabel: string
  workspaceUrl: (rel: string) => string
  onSavePrompt: (value: string) => void
  onSetCurrent: (path: string, remainingHistory: string[]) => void
  onGenerate: () => void
}) {
  // Current source is the last version; everything before it is history
  const versions = [...(history ?? []), ...(source ? [source] : [])]
  const [viewIdx, setViewIdx] = useState(versions.length - 1)

  // Reset browsing position when the version list changes
  useEffect(() => setViewIdx(versions.length - 1), [source, history?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const viewing = versions[viewIdx]
  const isCurrent = viewIdx === versions.length - 1

  return (
    <div className="w-[200px] flex-shrink-0 rounded-xl border border-[#d4af37]/20 bg-white/[0.03] p-2.5">
      {viewing ? (
        kind === 'image' ? (
          <img
            src={workspaceUrl(viewing)}
            alt=""
            className="h-24 w-full rounded-lg border border-white/10 object-cover"
          />
        ) : (
          <video
            src={workspaceUrl(viewing)}
            className="h-24 w-full rounded-lg border border-white/10 object-cover"
            muted
            controls
          />
        )
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-white/15 text-[11px] text-[#5a5766]">
          {kind === 'image' ? '图片' : '视频'}
        </div>
      )}

      {/* Version navigation (抽卡记录) */}
      {versions.length > 1 && (
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#6d6a78]">
          <button
            onClick={() => setViewIdx((i) => Math.max(0, i - 1))}
            disabled={viewIdx === 0}
            className="rounded px-1 transition hover:bg-white/5 hover:text-[#e8c766] disabled:opacity-30"
          >
            ‹
          </button>
          <span>
            {viewIdx + 1}/{versions.length} 版{isCurrent ? ' · 当前' : ''}
          </span>
          <button
            onClick={() => setViewIdx((i) => Math.min(versions.length - 1, i + 1))}
            disabled={isCurrent}
            className="rounded px-1 transition hover:bg-white/5 hover:text-[#e8c766] disabled:opacity-30"
          >
            ›
          </button>
        </div>
      )}
      {viewing && !isCurrent && (
        <button
          onClick={() =>
            onSetCurrent(
              viewing,
              versions.filter((_, i) => i !== viewIdx),
            )
          }
          className="mt-1 w-full rounded border border-[#d4af37]/30 py-0.5 text-[10px] text-[#e8c766] transition hover:bg-[#d4af37]/10"
        >
          设为当前版本
        </button>
      )}

      <EditablePrompt value={prompt} placeholder={promptPlaceholder} onSave={onSavePrompt} />
      <button
        onClick={onGenerate}
        className={`mt-1.5 w-full rounded-lg border py-1 text-[11px] transition ${
          kind === 'image'
            ? 'border-[#d4af37]/40 text-[#e8c766] hover:bg-[#d4af37]/10'
            : 'border-white/15 text-[#b8b5c2] hover:bg-white/5'
        }`}
      >
        {generateLabel}
      </button>
    </div>
  )
}

export function StoryboardCard({ artifact }: StoryboardCardProps) {
  const projectId = useAppStore((s) => s.currentProject?.id)
  const updateArtifactContent = useAppStore((s) => s.updateArtifactContent)
  const [shots, setShots] = useState<StoryboardShot[] | null>(() => parseShots(artifact.content))
  const [hint, setHint] = useState('')

  // Re-parse if the artifact content is replaced wholesale (e.g. restored from disk)
  useEffect(() => {
    setShots(parseShots(artifact.content))
  }, [artifact.content])

  if (!shots) {
    return (
      <div className="flex h-full flex-col gap-2 overflow-auto p-3">
        <p className="text-xs text-[#e8c766]">分镜数据解析失败，请检查 JSON 格式</p>
        <pre className="whitespace-pre-wrap text-xs text-[#8a8794]">{artifact.content}</pre>
      </div>
    )
  }

  const totalDuration = shots.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)

  const showHint = (text: string) => {
    setHint(text)
    window.setTimeout(() => setHint(''), 2000)
  }

  const workspaceUrl = (rel: string) =>
    projectId ? `workspace://${projectId}/${rel.replace(/^\.\//, '')}` : rel

  /** Persist an updated shot list to the store and back to the source file */
  const persistShots = async (next: StoryboardShot[], hintText: string) => {
    setShots(next)
    const content = JSON.stringify(next, null, 2)
    updateArtifactContent(artifact.id, content)
    if (artifact.path && projectId) {
      const result = await window.electronAPI.saveArtifactContent(projectId, artifact.path, content)
      showHint(result.success ? hintText : `保存失败：${result.error ?? '未知错误'}`)
    } else {
      showHint(hintText)
    }
  }

  const savePrompt = (index: number, field: 'textToImagePrompt' | 'imageToVideoPrompt', value: string) =>
    persistShots(
      shots.map((s) => (s.index === index ? { ...s, [field]: value } : s)),
      '提示词已保存',
    )

  const setCurrentMedia = (
    index: number,
    kind: 'image' | 'video',
    source: string,
    remainingHistory: string[],
  ) =>
    persistShots(
      shots.map((s) =>
        s.index === index
          ? kind === 'image'
            ? { ...s, imageSource: source, imageSourceHistory: remainingHistory }
            : { ...s, videoSource: source, videoSourceHistory: remainingHistory }
          : s,
      ),
      '已切换当前版本',
    )

  return (
    <div className="relative flex h-full flex-col overflow-y-auto p-4">
      {/* Top bar */}
      <div className="mb-4 flex items-center gap-3 text-[11px] text-[#6d6a78]">
        <span>
          共 <span className="text-[#e8c766]">{shots.length}</span> 镜
        </span>
        <span>
          总时长 <span className="text-[#e8c766]">{totalDuration}s</span>
        </span>
        <button
          onClick={() => showHint('导出剪辑功能待定')}
          className="ml-auto rounded-lg border border-[#d4af37]/40 px-2.5 py-1 text-[11px] text-[#e8c766] transition hover:bg-[#d4af37]/10"
        >
          导出剪辑
        </button>
      </div>

      <div className="flex flex-col gap-5">
        {shots.map((shot) => (
          <div key={shot.index}>
            {/* Shot label */}
            <div className="mb-1.5 flex items-center gap-2 text-[11px]">
              <span className="font-medium text-[#e8c766]">镜头 {shot.index}</span>
              <span className="text-[#6d6a78]">{shot.duration}s</span>
              {shot.camera && <span className="text-[#6d6a78]">· {shot.camera}</span>}
            </div>

            <div className="flex items-center gap-1">
              {/* Scene description node */}
              <div className="w-[180px] flex-shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs leading-relaxed text-[#d6d3c8]">{shot.scene}</p>
                {shot.dialogue && (
                  <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] italic leading-relaxed text-[#8a8794]">
                    「{shot.dialogue}」
                  </p>
                )}
              </div>

              <Arrow />

              <MediaNode
                kind="image"
                source={shot.imageSource}
                history={shot.imageSourceHistory}
                prompt={shot.textToImagePrompt}
                promptPlaceholder="文生图提示词"
                generateLabel="生成图片"
                workspaceUrl={workspaceUrl}
                onSavePrompt={(v) => savePrompt(shot.index, 'textToImagePrompt', v)}
                onSetCurrent={(p, h) => setCurrentMedia(shot.index, 'image', p, h)}
                onGenerate={() => showHint('文生图接口待定')}
              />

              <Arrow />

              <MediaNode
                kind="video"
                source={shot.videoSource}
                history={shot.videoSourceHistory}
                prompt={shot.imageToVideoPrompt}
                promptPlaceholder="图生视频提示词"
                generateLabel="生成视频"
                workspaceUrl={workspaceUrl}
                onSavePrompt={(v) => savePrompt(shot.index, 'imageToVideoPrompt', v)}
                onSetCurrent={(p, h) => setCurrentMedia(shot.index, 'video', p, h)}
                onGenerate={() => showHint('图生视频接口待定')}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Transient hint toast */}
      {hint && (
        <div className="pointer-events-none sticky bottom-2 mt-3 self-center rounded-full border border-[#d4af37]/30 bg-[#12121b] px-3 py-1 text-[11px] text-[#e8c766] shadow-lg">
          {hint}
        </div>
      )}
    </div>
  )
}
