import { Tldraw, useEditor, getSnapshot, loadSnapshot, createShapeId, type TLEditorSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { useEffect, useRef } from 'react'
import { useAppStore } from '../stores/app.store'
import { ArtifactShapeUtil } from './shapes/ArtifactShapeUtil'

// Force tldraw into dark mode to match the gothic app theme
function DarkModeEnforcer() {
  const editor = useEditor()

  useEffect(() => {
    editor.user.updateUserPreferences({ colorScheme: 'dark' })
  }, [editor])

  return null
}

// Canvas persistence component - handles save/load
function CanvasPersistence({ folderPath }: { folderPath: string }) {
  const editor = useEditor()
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Load snapshot when component mounts
  useEffect(() => {
    const load = async () => {
      try {
        const snapshot = await window.electronAPI.loadCanvasSnapshot(folderPath)
        if (snapshot && editor && editor.store) {
          loadSnapshot(editor.store, snapshot as TLEditorSnapshot)
        }
      } catch (err) {
        console.error('Failed to load canvas snapshot:', err)
      }
    }
    load()
  }, [editor, folderPath])

  // Auto-save on change with debounce
  useEffect(() => {
    const handleChange = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      saveTimeoutRef.current = setTimeout(() => {
        try {
          const snapshot = getSnapshot(editor.store)
          window.electronAPI.saveCanvasSnapshot(folderPath, snapshot).catch((err) => {
            console.error('Failed to save canvas snapshot:', err)
          })
        } catch (err) {
          console.error('Failed to get canvas snapshot:', err)
        }
      }, 1000)
    }

    editor.on('change', handleChange)
    return () => {
      editor.off('change', handleChange)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [editor, folderPath])

  return null
}

// Artifact shape manager - creates tldraw shapes for new artifacts
function ArtifactShapeManager() {
  const editor = useEditor()
  const { artifacts } = useAppStore()

  useEffect(() => {
    if (!editor || artifacts.length === 0) return

    const lastArtifact = artifacts[artifacts.length - 1]
    const shapeId = createShapeId(`artifact-${lastArtifact.id}`)

    // Skip if shape already exists
    if (editor.getShape(shapeId)) return

    // Place near viewport center with slight random offset
    const w = lastArtifact.width || 400
    const h = lastArtifact.height || 300
    const center = editor.getViewportScreenCenter()
    const x = center.x - w / 2 + Math.random() * 40 - 20
    const y = center.y - h / 2 + Math.random() * 40 - 20

    editor.createShapes([
      {
        id: shapeId,
        type: 'artifact',
        x,
        y,
        props: {
          w,
          h,
          artifactId: lastArtifact.id,
          title: lastArtifact.title,
          contentType: lastArtifact.type,
          content: lastArtifact.content,
        },
      },
    ])
  }, [artifacts, editor])

  return null
}

export function CanvasArea() {
  const { currentProject } = useAppStore()

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Tldraw
        hideUi={false}
        className="tldraw-canvas"
        shapeUtils={[ArtifactShapeUtil]}
      >
        <DarkModeEnforcer />
        {currentProject && (
          <>
            <CanvasPersistence folderPath={currentProject.folderPath} />
            <ArtifactShapeManager />
          </>
        )}
      </Tldraw>
    </div>
  )
}