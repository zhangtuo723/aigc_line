import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Excalidraw,
  restore,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import type {
  ExcalidrawEmbeddableElement,
  NonDeleted,
  OrderedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { useAppStore } from '../stores/app.store'
import { ArtifactRenderer } from './ArtifactRenderer'

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

// Serve fonts locally instead of from the CDN so packaged builds work offline.
// dev: vite serves files under the project root (node_modules included)
// prod: vite-plugin-static-copy bundles the fonts next to index.html
if (typeof window !== 'undefined' && !window.EXCALIDRAW_ASSET_PATH) {
  window.EXCALIDRAW_ASSET_PATH = import.meta.env.DEV
    ? '/node_modules/@excalidraw/excalidraw/dist/prod/'
    : './'
}

/** Embeddable elements carry the artifact id in their link: artifact://<id> */
const ARTIFACT_LINK_PREFIX = 'artifact://'
const CANVAS_BACKGROUND = '#0a0a0f'
const SAVE_DEBOUNCE_MS = 1000

/**
 * Only accept snapshots written by serializeAsJSON ({type:'excalidraw', ...}).
 * Anything else (e.g. legacy tldraw snapshots) is treated as an empty canvas -
 * feeding foreign shapes into restore() corrupts the scene and crashes rendering.
 */
const isExcalidrawSnapshot = (snapshot: unknown): snapshot is Parameters<typeof restore>[0] =>
  !!snapshot &&
  typeof snapshot === 'object' &&
  (snapshot as { type?: unknown }).type === 'excalidraw' &&
  Array.isArray((snapshot as { elements?: unknown }).elements)

const randomInt = () => Math.floor(Math.random() * 2 ** 31)

/**
 * Build a complete embeddable element. convertToExcalidrawElements() does NOT
 * fill any defaults for embeddables (it returns the skeleton verbatim), and
 * newEmbeddableElement() is not exported publicly - so we mirror the defaults
 * here. Missing fields (backgroundColor etc.) crash excalidraw's hit-testing.
 */
const newArtifactElement = (
  x: number,
  y: number,
  width: number,
  height: number,
  link: string,
): ExcalidrawEmbeddableElement =>
  ({
    id: `artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'embeddable',
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    index: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link,
    locked: false,
    validated: null, // validated lazily via the validateEmbeddable prop
  }) as unknown as ExcalidrawEmbeddableElement

export function CanvasArea() {
  const { currentProject, artifacts } = useAppStore()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  // True when the selection consists solely of artifact cards - used to hide
  // Excalidraw's property panel, which is meaningless for embeddables
  const [onlyArtifactsSelected, setOnlyArtifactsSelected] = useState(false)
  const folderPath = currentProject?.folderPath

  const folderPathRef = useRef(folderPath)
  const loadedFolderRef = useRef<string | null>(null)
  const readyToSaveRef = useRef(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const prevSelectedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    folderPathRef.current = folderPath
  }, [folderPath])

  // Load the saved snapshot once per project
  useEffect(() => {
    if (!api || !folderPath || loadedFolderRef.current === folderPath) return
    loadedFolderRef.current = folderPath
    readyToSaveRef.current = false

    const load = async () => {
      try {
        const snapshot = await window.electronAPI.loadCanvasSnapshot(folderPath)
        if (!isExcalidrawSnapshot(snapshot)) {
          if (snapshot) {
            console.warn('Ignoring unrecognized canvas snapshot (legacy format?)')
          }
          api.updateScene({ appState: { viewBackgroundColor: CANVAS_BACKGROUND } })
          return
        }
        const restored = restore(snapshot, null, null)
        api.updateScene({
          elements: restored.elements,
          appState: { ...restored.appState, viewBackgroundColor: CANVAS_BACKGROUND },
        })
        const files = Object.values(restored.files ?? {})
        if (files.length > 0) api.addFiles(files)
      } catch (err) {
        console.error('Failed to load canvas snapshot:', err)
      } finally {
        readyToSaveRef.current = true
      }
    }
    load()
  }, [api, folderPath])

  // Auto-save on change with debounce (skipped until the snapshot is loaded)
  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      // Clicking an artifact card references it in the chat input, so the
      // next message tells the agent which artifact to modify/reference.
      // Only NEWLY selected elements are added - otherwise the chip would
      // reappear right after the user removes it while the card stays selected.
      const selectedIds = appState.selectedElementIds ?? {}
      const prevSelected = prevSelectedIdsRef.current
      let artifactSelected = 0
      let otherSelected = 0
      for (const el of elements) {
        if (!selectedIds[el.id]) continue
        const link =
          el.type === 'embeddable' ? (el as ExcalidrawEmbeddableElement).link : null
        if (link?.startsWith(ARTIFACT_LINK_PREFIX)) {
          artifactSelected++
          if (prevSelected.has(el.id)) continue
          const artifactId = link.slice(ARTIFACT_LINK_PREFIX.length)
          const artifact = useAppStore
            .getState()
            .artifacts.find((a) => a.id === artifactId)
          if (artifact) {
            useAppStore.getState().addArtifactReference({
              id: artifact.id,
              title: artifact.title,
              type: artifact.type,
              path: artifact.path,
            })
          }
        } else {
          otherSelected++
        }
      }
      setOnlyArtifactsSelected(artifactSelected > 0 && otherSelected === 0)
      prevSelectedIdsRef.current = new Set(
        Object.keys(selectedIds).filter((id) => selectedIds[id]),
      )

      const currentFolder = folderPathRef.current
      if (!currentFolder || !readyToSaveRef.current) return
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        try {
          // Defensive: a corrupted scene can emit non-array elements
          const list = Array.isArray(elements) ? elements : []
          // NOTE: serializeAsJSON takes positional args, NOT an options object
          const json = serializeAsJSON(
            list.filter((el) => !el.isDeleted),
            appState,
            files,
            'local',
          )
          window.electronAPI
            .saveCanvasSnapshot(currentFolder, JSON.parse(json))
            .catch((err) => console.error('Failed to save canvas snapshot:', err))
        } catch (err) {
          console.error('Failed to serialize canvas:', err)
        }
      }, SAVE_DEBOUNCE_MS)
    },
    [],
  )

  // Create embeddable elements for newly pushed artifacts
  useEffect(() => {
    if (!api || artifacts.length === 0) return

    const lastArtifact = artifacts[artifacts.length - 1]
    const link = ARTIFACT_LINK_PREFIX + lastArtifact.id

    const sceneElements = api.getSceneElements()
    const exists = sceneElements.some(
      (el) =>
        el.type === 'embeddable' &&
        (el as ExcalidrawEmbeddableElement).link === link,
    )
    if (exists) return

    // Place near viewport center with slight random offset
    const appState = api.getAppState()
    const zoom = appState.zoom.value || 1
    const w = lastArtifact.width || 400
    const h = lastArtifact.height || 300
    const centerX = -appState.scrollX + appState.width / 2 / zoom
    const centerY = -appState.scrollY + appState.height / 2 / zoom

    const element = newArtifactElement(
      centerX - w / 2 + Math.random() * 40 - 20,
      centerY - h / 2 + Math.random() * 40 - 20,
      w,
      h,
      link,
    )
    api.updateScene({ elements: [...sceneElements, element] })
  }, [api, artifacts])

  // Render artifact cards instead of iframes for artifact:// embeddables
  const renderEmbeddable = useCallback(
    (element: NonDeleted<ExcalidrawEmbeddableElement>) => {
      const link = element.link
      if (!link?.startsWith(ARTIFACT_LINK_PREFIX)) {
        return null // fall back to the default iframe rendering
      }
      const artifactId = link.slice(ARTIFACT_LINK_PREFIX.length)
      const artifact = useAppStore
        .getState()
        .artifacts.find((a) => a.id === artifactId)
      if (!artifact) {
        return (
          <div className="flex h-full w-full items-center justify-center rounded-lg border border-white/10 bg-[#0f0f16] text-xs text-[#8a8794]">
            产物不存在或已被删除
          </div>
        )
      }
      return (
        <ArtifactRenderer
          artifact={{ ...artifact, width: element.width, height: element.height }}
        />
      )
    },
    [],
  )

  return (
    <div
      className={`relative h-full w-full overflow-hidden${onlyArtifactsSelected ? ' artifact-selected' : ''}`}
    >
      <Excalidraw
        excalidrawAPI={setApi}
        theme="dark"
        langCode="zh-CN"
        onChange={handleChange}
        renderEmbeddable={renderEmbeddable}
        validateEmbeddable={(link: string) =>
          link.startsWith(ARTIFACT_LINK_PREFIX) ? true : undefined
        }
      />
    </div>
  )
}
