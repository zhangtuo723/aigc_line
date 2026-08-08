import { useAppStore } from '../stores/app.store';

export function HomePage() {
  const { projects, createProject, selectProject, deleteProject, setCurrentPage } = useAppStore();

  const handleCreate = async () => {
    const folders = await window.electronAPI.showOpenDialog({ title: '选择项目文件夹' });
    if (folders.length === 0) return;
    const folderPath = folders[0];
    const name = folderPath.split(/[/\\]/).pop() ?? '新项目';
    await createProject(name, folderPath);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteProject(id);
  };

  const createButton = (className: string) => (
    <button
      onClick={handleCreate}
      className={`flex items-center gap-2 rounded-lg border border-[#d4af37]/50 bg-gradient-to-b from-[#e8c766] to-[#b08d2a] font-semibold tracking-widest text-[#241a05] shadow-[0_2px_20px_rgba(212,175,55,0.25)] transition hover:brightness-110 active:brightness-95 ${className}`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v16m8-8H4" />
      </svg>
      新建项目
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="relative flex items-center justify-between border-b border-white/[0.08] bg-[#0d0d14] px-8 py-4">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent" />
        <div className="flex items-center gap-3.5">
          <img src="/logo.svg" alt="AIGC CANVAS" className="h-10 w-10 rounded-xl shadow-[0_0_24px_rgba(212,175,55,0.25)]" />
          <div className="leading-tight">
            <h1 className="font-display text-lg font-semibold tracking-[0.24em] text-[#e8c766]">AIGC CANVAS</h1>
            <p className="mt-1 text-[11px] tracking-[0.35em] text-[#8a8794]">AI 分镜视频创作画布</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentPage('settings')}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-[#8a8794] transition hover:border-[#d4af37]/40 hover:bg-[#d4af37]/[0.08] hover:text-[#e8c766]"
            title="系统配置"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10.3 3.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 002.5 1c1.5-.9 3.2.9 2.3 2.4a1.7 1.7 0 001 2.5c1.7.5 1.7 3 0 3.5a1.7 1.7 0 00-1 2.5c.9 1.5-.8 3.2-2.3 2.3a1.7 1.7 0 00-2.5 1c-.5 1.7-3 1.7-3.4 0a1.7 1.7 0 00-2.5-1c-1.5.9-3.2-.8-2.3-2.3a1.7 1.7 0 00-1-2.5c-1.7-.5-1.7-3 0-3.5a1.7 1.7 0 001-2.5C4.6 5.2 6.3 3.4 7.8 4.3a1.7 1.7 0 002.5-1z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          {createButton('px-5 py-2.5 text-[13px]')}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-8 py-10">
          {projects.projects.length === 0 ? (
            <div className="flex h-[calc(100vh-260px)] flex-col items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 -m-8 rounded-full bg-[#d4af37]/10 blur-3xl" />
                <img src="/logo.svg" alt="" className="relative h-24 w-24 rounded-3xl shadow-[0_0_40px_rgba(212,175,55,0.2)]" />
              </div>
              <p className="mt-8 font-display text-xl tracking-[0.3em] text-[#e8e6df]">尚未开启创作之旅</p>
              <div className="mt-5 flex items-center gap-3">
                <span className="h-px w-14 bg-gradient-to-r from-transparent to-[#d4af37]/50" />
                <span className="text-[10px] text-[#d4af37]">✦</span>
                <span className="h-px w-14 bg-gradient-to-l from-transparent to-[#d4af37]/50" />
              </div>
              <p className="mt-5 text-[13px] tracking-wider text-[#8a8794]">选择一个文件夹作为工作区，开启你的第一个分镜创作项目</p>
              {createButton('mt-9 px-6 py-3 text-sm')}
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center gap-4">
                <span className="text-[10px] text-[#d4af37]">✦</span>
                <h2 className="font-display text-sm font-medium tracking-[0.3em] text-[#e8e6df]">我的项目</h2>
                <div className="h-px flex-1 bg-gradient-to-r from-[#d4af37]/30 to-transparent" />
                <span className="text-xs tracking-wider text-[#6d6a78]">共 {projects.projects.length} 个</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {projects.projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => selectProject(project.id)}
                    className="group cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-[#d4af37]/40 hover:bg-white/[0.05] hover:shadow-[0_12px_40px_rgba(212,175,55,0.12)]"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/[0.08]">
                        <svg className="h-5 w-5 text-[#e8c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, project.id)}
                        className="rounded-md p-1.5 text-[#4a4757] opacity-0 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                        title="删除项目"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <h3 className="mt-3 truncate text-[13px] font-medium tracking-wider text-[#e8e6df]">{project.name}</h3>
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#6d6a78]">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
