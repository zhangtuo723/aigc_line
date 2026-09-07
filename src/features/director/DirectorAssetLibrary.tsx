import { useEffect, useId, useRef, useState } from 'react'
import { DIRECTOR_ELEMENT_CATALOG, DIRECTOR_ELEMENT_CATEGORIES } from '../../shared/director-element-catalog'
import type { DirectorElementKind } from '../../shared/director.types'

function AssetIcon({ kind }: { kind: DirectorElementKind }) {
  const paths: Partial<Record<DirectorElementKind, string>> = {
    actor: 'M24 15a5 5 0 1 0 0-10a5 5 0 1 0 0 10 M16 28l3-10h10l3 10 M24 19v12m0 0l-7 12m7-12l7 12',
    crowd: 'M16 17a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M10 30l2-10h8l2 10 M16 21v13l-4 8m4-8l4 8 M33 17a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M27 30l2-10h8l2 10 M33 21v13l-4 8m4-8l4 8',
    doorframe: 'M10 42V6h28v36h-5V11H15v31z',
    windowframe: 'M6 8h36v32H6z M10 12h28v24H10z M24 12v24M10 24h28',
    table: 'M5 19l25-8 14 7-26 9z M8 21v18m10-12v16m23-23v17M30 12v12',
    chair: 'M13 26V6h22v20 M13 20h22 M10 26h28v5H10z M13 31v12m22-12v12',
    sofa: 'M10 24V12h28v12 M5 24h7v12h24V24h7v15H5z M12 29h24 M9 39v4m30-4v4',
    bed: 'M7 40V9h34v31 M7 22h34M7 35h34 M11 15h10v6H11z M27 15h10v6H27z',
    cabinet: 'M9 5h30v36H9z M24 5v36 M20 21v5m8-5v5 M12 41v3m24-3v3',
    railing: 'M5 12h38v5H5z M8 17v25m8-25v25m8-25v25m8-25v25m8-25v25 M8 35h32',
    stairs: 'M5 41V30h12V19h12V8h14v33z',
    ramp: 'M5 39L39 9v30z M5 39h38',
    wall: 'M8 13l29-7v30L8 43z M8 23l29-7M8 33l29-7M22 10v10m0 10v10',
    floor: 'M4 28l25-15 15 8-25 15z M4 28v4l15 8 25-15v-4',
    platform: 'M4 21l25-12 15 8-25 12z M4 21v12l15 9 25-13V17 M19 29v13',
    sphere: 'M24 6a18 18 0 1 0 0 36a18 18 0 1 0 0-36 M7 24h34 M24 6c-12 10-12 26 0 36m0-36c12 10 12 26 0 36',
    cylinder: 'M9 13c0-9 30-9 30 0s-30 9-30 0v22c0 9 30 9 30 0V13',
    cone: 'M7 36L24 6l17 30c0 9-34 9-34 0z M7 36c4-6 30-6 34 0',
    capsule: 'M14 16a10 10 0 0 1 20 0v16a10 10 0 0 1-20 0z',
    box: 'M6 14L24 5l18 9v22l-18 9-18-9z M6 14l18 10 18-10M24 24v21',
  }
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="h-9 w-9 flex-none text-[#d4af37]/70" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>
}

export function DirectorAssetLibrary({ disabled, onAdd }: { disabled: boolean; onAdd: (kind: DirectorElementKind) => void }) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const search = query.trim().toLocaleLowerCase()
  const assets = DIRECTOR_ELEMENT_CATALOG.filter((asset) => (
    (category === 'all' || asset.category === category)
    && (!search || `${asset.label} ${asset.kind} ${asset.description}`.toLocaleLowerCase().includes(search))
  ))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      rootRef.current?.querySelector<HTMLButtonElement>('[aria-controls]')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  const showCategory = (id: string) => {
    setCategory(id)
    setQuery('')
    setOpen(true)
  }

  return (
    <div ref={rootRef} className="pointer-events-none absolute bottom-3 left-1/2 top-3 z-20 flex w-[520px] max-w-[calc(100%_-_1.5rem)] -translate-x-1/2 flex-col justify-end gap-2">
      {open && !disabled && (
        <section id={panelId} aria-label="片场素材库" className="pointer-events-auto flex max-h-[420px] min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/15 bg-[#15161d]/98 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-none items-center justify-between px-4 pb-2 pt-3">
            <div className="text-xs font-medium text-white/80">片场素材 <span className="ml-1.5 text-[12px] font-normal text-white/55">{assets.length} 个</span></div>
            <button type="button" aria-label="收起素材库" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-white/45 hover:bg-white/10 hover:text-white">×</button>
          </div>
          <div className="flex-none px-3 pb-2">
            <input autoFocus aria-label="搜索片场素材" placeholder="搜索名称或用途，例如：桌子、门框…" value={query} onChange={(event) => { setQuery(event.target.value); setCategory('all') }} className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-white/80 outline-none placeholder:text-white/30 focus:border-[#d4af37]/50" />
          </div>
          <div aria-label="素材分类" className="flex flex-none gap-1 overflow-x-auto px-3 pb-2">
            {[{ id: 'all', label: '全部' }, ...DIRECTOR_ELEMENT_CATEGORIES].map((item) => (
              <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setQuery('') }} className={`flex-none rounded-md px-2.5 py-1.5 text-[12px] ${category === item.id ? 'bg-[#d4af37]/15 text-[#f0d98c]' : 'text-white/45 hover:bg-white/5'}`}>{item.label}</button>
            ))}
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-1.5 overflow-y-auto px-3 pb-3">
            {assets.map((asset) => (
              <button key={asset.kind} type="button" aria-label={asset.label} title={`${asset.description} · 点击添加`} onClick={() => { onAdd(asset.kind); setOpen(false) }} className="group flex min-w-0 items-center gap-2.5 rounded-lg border border-white/8 bg-white/[0.025] p-2.5 text-left transition hover:border-[#d4af37]/40 hover:bg-[#d4af37]/[0.07] focus-visible:outline focus-visible:outline-[#d4af37]">
                <AssetIcon kind={asset.kind} />
                <span className="min-w-0">
                  <span className="block text-[11px] text-white/75 group-hover:text-[#f0d98c]">{asset.label}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-white/55">{asset.description}</span>
                  <span className="mt-1 block text-[12px] tabular-nums text-white/45">{asset.category === 'people' ? '可调整体型与姿势' : `${asset.kind === 'capsule' ? asset.size.x / 2 : asset.size.x} × ${asset.size.y} × ${asset.kind === 'capsule' ? asset.size.z / 2 : asset.size.z} m`}</span>
                </span>
              </button>
            ))}
            {assets.length === 0 && <p className="col-span-2 py-7 text-center text-[11px] text-white/40">没有匹配的素材，试试其他名称或用途。</p>}
          </div>
        </section>
      )}
      <div role="toolbar" aria-label="添加到片场工具栏" className="pointer-events-auto mx-auto flex w-fit max-w-full flex-none items-center gap-1 overflow-x-auto rounded-xl border border-white/12 bg-[#121318]/95 p-1.5 shadow-2xl backdrop-blur-md">
        <button type="button" aria-label="素材库" aria-controls={panelId} aria-expanded={open} disabled={disabled} onClick={() => { if (open) setOpen(false); else showCategory('all') }} className="flex flex-none items-center gap-2 rounded-lg bg-[#d4af37]/10 px-3 py-2 text-[12px] text-[#f0d98c] hover:bg-[#d4af37]/20 disabled:opacity-35"><span aria-hidden="true">＋</span>素材库<span className="text-[12px] text-[#d4af37]/60">{DIRECTOR_ELEMENT_CATALOG.length}</span></button>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px flex-none bg-white/10" />
        {DIRECTOR_ELEMENT_CATEGORIES.map((item) => (
          <button key={item.id} type="button" disabled={disabled} onClick={() => showCategory(item.id)} className={`flex-none rounded-lg px-2.5 py-2 text-[12px] transition disabled:opacity-35 ${open && category === item.id ? 'bg-white/10 text-white/80' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}>{item.label}</button>
        ))}
      </div>
    </div>
  )
}
