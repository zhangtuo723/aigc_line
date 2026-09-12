import { useMemo, useState } from 'react';
import { CreateProjectDialog } from '../components/CreateProjectDialog';
import { agentLabel } from '../shared/agent-config';
import { useAppStore } from '../stores/app.store';

function FolderIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

export function HomePage() {
  const projects = useAppStore((state) => state.projects.projects);
  const selectProject = useAppStore((state) => state.selectProject);
  const deleteProject = useAppStore((state) => state.deleteProject);
  const setCurrentPage = useAppStore((state) => state.setCurrentPage);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return projects.filter((project) =>
      [project.name, project.folderPath, agentLabel(project.agent), project.agent?.model ?? '默认模型']
        .some((value) => value.toLocaleLowerCase().includes(query)),
    ).sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      : b.createdAt - a.createdAt || a.name.localeCompare(b.name, 'zh-CN'));
  }, [projects, search, sort]);

  const runProjectAction = async (id: string, action: (id: string) => Promise<void>) => {
    setBusyId(id);
    setError('');
    try { await action(id); }
    catch (error) { setError(error instanceof Error ? error.message : '项目操作失败，请重试'); }
    finally { setBusyId(null); }
  };

  const createButton = (className = '') => (
    <button
      onClick={() => setCreating(true)}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-semibold text-[#201b0e] transition hover:bg-[#e8c766] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e8c766] ${className}`}
    >
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      新建项目
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} />}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-[#0d0d14] px-6 py-4 lg:px-12">
        <div className="flex min-w-0 items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-9 w-9 rounded-lg" />
          <div>
            <h1 className="font-display text-base font-semibold tracking-[0.18em] text-[#e8c766]">AIGC CANVAS</h1>
            <p className="mt-0.5 text-[11px] tracking-widest text-[#8a8794]">AI 分镜视频创作画布</p>
          </div>
        </div>
        <button
          onClick={() => setCurrentPage('settings')}
          className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#a5a2af] transition hover:bg-white/5 hover:text-[#e8e6df] focus-visible:outline-2 focus-visible:outline-[#d4af37]"
          title="系统配置"
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.3 3.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 002.5 1c1.5-.9 3.2.9 2.3 2.4a1.7 1.7 0 001 2.5c1.7.5 1.7 3 0 3.5a1.7 1.7 0 00-1 2.5c.9 1.5-.8 3.2-2.3 2.3a1.7 1.7 0 00-2.5 1c-.5 1.7-3 1.7-3.4 0a1.7 1.7 0 00-2.5-1c-1.5.9-3.2-.8-2.3-2.3a1.7 1.7 0 00-1-2.5c-1.7-.5-1.7-3 0-3.5a1.7 1.7 0 001-2.5C4.6 5.2 6.3 3.4 7.8 4.3a1.7 1.7 0 002.5-1z" />
            <circle cx="12" cy="11" r="3" strokeWidth={1.5} />
          </svg>
          系统配置
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1920px] px-6 py-8 lg:px-12 lg:py-10">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="mb-2 text-[11px] font-medium tracking-[0.22em] text-[#d4af37]">WORKSPACE</p>
              <h2 className="text-3xl font-semibold tracking-tight text-[#f1efe9]">我的项目</h2>
              <p className="mt-2 text-sm text-[#8a8794]">从一个想法，到下一段故事。</p>
            </div>
            {createButton()}
          </div>

          {error && <p role="alert" className="mb-5 rounded-lg border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-300">{error}</p>}

          {projects.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#d4af37]/[0.08] text-[#d4af37]">
                <FolderIcon className="h-8 w-8" />
              </div>
              <h3 className="mt-6 text-xl font-medium text-[#e8e6df]">尚未开启创作之旅</h3>
              <p className="mt-3 max-w-md text-sm leading-6 text-[#8a8794]">选择一个文件夹作为工作区，开启你的第一个分镜创作项目。</p>
              {createButton('mt-7')}
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-5">
                <p aria-live="polite" className="text-sm text-[#a5a2af]">
                  全部项目 <span className="ml-2 rounded-md bg-white/5 px-2 py-1 text-xs tabular-nums text-[#e8e6df]">{projects.length}</span>
                  {search.trim() && <span className="ml-3 text-xs text-[#8a8794]">找到 {visibleProjects.length} 个</span>}
                </p>
                <div className="flex w-full flex-wrap gap-3 sm:w-auto">
                  <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                    <svg aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-[#8a8794]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="10.5" cy="10.5" r="6.5" strokeWidth={1.6} />
                      <path d="m16 16 4.5 4.5" strokeWidth={1.6} strokeLinecap="round" />
                    </svg>
                    <input
                      type="search"
                      aria-label="搜索项目"
                      placeholder="搜索项目、目录或模型…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.025] pl-10 pr-3 text-sm text-[#e8e6df] outline-none placeholder:text-[#777482] focus:border-[#d4af37]/60"
                    />
                  </div>
                  <select
                    aria-label="项目排序"
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                    className="h-10 rounded-lg border border-white/10 bg-[#121219] px-3 text-sm text-[#b9b6c2] outline-none focus:border-[#d4af37]/60"
                  >
                    <option value="newest">最新创建</option>
                    <option value="name">名称排序</option>
                  </select>
                </div>
              </div>

              {visibleProjects.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-base text-[#e8e6df]">没有找到匹配的项目</p>
                  <p className="mt-2 text-sm text-[#8a8794]">试试其他名称、目录或模型关键词。</p>
                  <button onClick={() => setSearch('')} className="mt-5 rounded-lg px-4 py-2 text-sm text-[#e8c766] hover:bg-[#d4af37]/10">清除搜索</button>
                </div>
              ) : (
                <div aria-label="项目列表" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
                  {visibleProjects.map((project) => (
                    <article key={project.id} className="group relative min-w-0 rounded-xl border border-white/[0.08] bg-[#121219] transition-colors hover:border-[#d4af37]/35 hover:bg-[#17171f] focus-within:border-[#d4af37]/60">
                      <button
                        aria-label={`打开项目 ${project.name}`}
                        disabled={busyId !== null}
                        onClick={() => void runProjectAction(project.id, selectProject)}
                        className="block w-full rounded-xl p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] disabled:cursor-wait"
                      >
                        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-[#d4af37]/10 bg-[#d4af37]/[0.06] text-[#cdb064]">
                          <FolderIcon />
                        </div>
                        <h3 title={project.name} className="truncate text-[17px] font-semibold leading-6 text-[#eeece6]">{project.name}</h3>
                        <p title={project.folderPath} className="mt-1.5 truncate text-xs leading-5 text-[#8a8794]">{project.folderPath}</p>
                        <div className="mt-5 flex min-w-0 items-center gap-2 border-t border-white/[0.06] pt-4 text-xs">
                          <span className={`shrink-0 rounded-md px-2 py-1 ${project.agent?.provider === 'codex' ? 'bg-emerald-400/[0.07] text-emerald-200/80' : 'bg-[#d4af37]/[0.07] text-[#cdb064]'}`}>{agentLabel(project.agent)}</span>
                          <span title={project.agent?.model || '默认模型'} className="min-w-0 flex-1 truncate text-[#9693a1]">{project.agent?.model || '默认模型'}</span>
                          <time dateTime={new Date(project.createdAt).toISOString()} title="创建日期" className="shrink-0 tabular-nums text-[#8a8794]">{new Date(project.createdAt).toLocaleDateString('zh-CN')}</time>
                        </div>
                      </button>
                      <button
                        onClick={() => void runProjectAction(project.id, deleteProject)}
                        disabled={busyId !== null}
                        className="absolute right-4 top-4 rounded-md p-2 text-[#777482] transition hover:bg-rose-500/10 hover:text-rose-300 focus-visible:outline-2 focus-visible:outline-[#d4af37] disabled:cursor-wait"
                        title="删除项目"
                        aria-label={`删除项目 ${project.name}`}
                      >
                        <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
                        </svg>
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
