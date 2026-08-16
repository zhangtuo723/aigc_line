import type { Artifact } from '../shared/ipc.types'
import type { ReactNode } from 'react'
import { Markdown } from './Markdown'
import { StoryboardCard } from './StoryboardCard'
import { useAppStore } from '../stores/app.store'

interface ArtifactCardProps {
  artifact: Artifact
  onClose?: () => void
}

function CardShell({
  artifact,
  badge,
  icon,
  children,
}: ArtifactCardProps & { badge: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0f0f16] shadow-lg">
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#12121b] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate text-xs font-medium text-[#e8e6df]">{artifact.title}</span>
        </div>
        <span className="ml-2 flex-shrink-0 rounded bg-[#d4af37]/15 px-1.5 py-0.5 text-[10px] text-[#e8c766]">
          {badge}
        </span>
      </div>
      {children}
    </div>
  )
}

function MarkdownCard({ artifact, onClose }: ArtifactCardProps) {
  return (
    <CardShell
      artifact={artifact}
      onClose={onClose}
      badge="Markdown"
      icon={
        <svg className="h-4 w-4 flex-shrink-0 text-[#e8c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      }
    >
      <div className="flex-1 overflow-auto p-3">
        <Markdown className="text-sm text-[#d6d3c8]">{artifact.content}</Markdown>
      </div>
    </CardShell>
  )
}

function ImageCard({ artifact, onClose }: ArtifactCardProps) {
  return (
    <CardShell
      artifact={artifact}
      onClose={onClose}
      badge="图片"
      icon={
        <svg className="h-4 w-4 flex-shrink-0 text-[#e8c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      }
    >
      <div className="flex-1 overflow-hidden bg-[#0a0a0f]">
        <img
          src={artifact.content}
          alt={artifact.title}
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
    </CardShell>
  )
}

function HtmlCard({ artifact, onClose }: ArtifactCardProps) {
  const projectId = useAppStore((s) => s.currentProject?.id)
  // Relative URLs in the artifact resolve against the project workspace
  // (served by the workspace:// protocol registered in the main process)
  const baseTag = projectId ? `<base href="workspace://${projectId}/">` : ''

  // Wrap content in a full HTML document if not already
  const wrappedContent = (() => {
    const content = artifact.content.trim()
    if (content.toLowerCase().startsWith('<!doctype') || content.toLowerCase().startsWith('<html')) {
      // Full document: inject <base> into the existing <head>, or create one
      if (/<head[^>]*>/i.test(content)) {
        return content.replace(/<head[^>]*>/i, (m) => m + baseTag)
      }
      return content.replace(/<html[^>]*>/i, (m) => `${m}<head>${baseTag}</head>`)
    }
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${baseTag}
<style>
  body { margin: 0; padding: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  * { box-sizing: border-box; }
</style>
</head>
<body>
${content}
</body>
</html>`
  })()

  return (
    <CardShell
      artifact={artifact}
      onClose={onClose}
      badge="HTML"
      icon={
        <svg className="h-4 w-4 flex-shrink-0 text-[#e8c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      }
    >
      <div className="flex-1 overflow-hidden bg-white">
        <iframe
          srcDoc={wrappedContent}
          className="h-full w-full border-0"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={artifact.title}
        />
      </div>
    </CardShell>
  )
}

function StoryboardArtifactCard({ artifact, onClose }: ArtifactCardProps) {
  return (
    <CardShell
      artifact={artifact}
      onClose={onClose}
      badge="分镜表"
      icon={
        <svg className="h-4 w-4 flex-shrink-0 text-[#e8c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
      }
    >
      <div className="flex-1 overflow-hidden">
        <StoryboardCard artifact={artifact} />
      </div>
    </CardShell>
  )
}

interface ArtifactRendererProps {
  artifact: Artifact
  onClose?: () => void
}

export function ArtifactRenderer({ artifact, onClose }: ArtifactRendererProps) {
  return (
    <div className="h-full w-full">
      {artifact.type === 'markdown' ? (
        <MarkdownCard artifact={artifact} onClose={onClose} />
      ) : artifact.type === 'image' ? (
        <ImageCard artifact={artifact} onClose={onClose} />
      ) : artifact.type === 'storyboard' ? (
        <StoryboardArtifactCard artifact={artifact} onClose={onClose} />
      ) : (
        <HtmlCard artifact={artifact} onClose={onClose} />
      )}
    </div>
  )
}
