import { Tldraw, useEditor, getSnapshot, loadSnapshot, type TLEditorSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { useRef, useEffect } from 'react'
import { useAppStore } from '../stores/app.store'

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

export function CanvasArea() {
  const { currentProject } = useAppStore()

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Tldraw
        hideUi={false}
        className="tldraw-canvas"
      >
        {currentProject && (
          <CanvasPersistence folderPath={currentProject.folderPath} />
        )}
      </Tldraw>
    </div>
  )
}
