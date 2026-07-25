import { useAppStore } from '../stores/app.store';

export function ProjectList() {
  const { projects, currentProject, createProject, selectProject, deleteProject, loadProjects, sidebarCollapsed, setSidebarCollapsed } =
    useAppStore();

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
    await loadProjects();
  };

  return (
    <div className={`flex h-full flex-col border-r border-white/[0.08] bg-[#0d0d14] transition-all duration-300 ${sidebarCollapsed ? 'w-14' : 'w-64'}`}>
      {/* Header with collapse button */}
      <div className={`flex items-center border-b border-white/[0.08] p-4 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!sidebarCollapsed && (
          <h2 className='flex items-center gap-2 text-xs font-semibold tracking-[0.3em] text-[#8a8794]'>
            <span className="text-[9px] text-[#d4af37]">✦</span>项目列表
          </h2>
        )}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#6d6a78] transition hover:bg-white/5 hover:text-[#e8c766]"
          title={sidebarCollapsed ? '展开' : '收起'}
        >
          <svg
            className={`h-4 w-4 transition-transform duration-300 ${sidebarCollapsed ? '' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 0v14" />
          </svg>
        </button>
      </div>
      {/* Project list content */}
      {!sidebarCollapsed && (
        <>
          <div className='flex-1 overflow-auto p-2'>
            {projects.projects.length === 0 ? (
              <p className='p-2 text-sm text-[#6d6a78]'>暂无项目</p>
            ) : (
              <ul className='space-y-1'>
                {projects.projects.map((project) => (
                  <li
                    key={project.id}
                    onClick={() => selectProject(project.id)}
                    className={[
                      'group flex cursor-pointer items-center justify-between rounded-lg border border-transparent px-3 py-2 text-sm transition',
                      currentProject?.id === project.id
                        ? 'border-[#d4af37]/30 bg-[#d4af37]/10 text-[#e8c766]'
                        : 'text-[#b8b5c2] hover:bg-white/5 hover:text-[#e8e6df]',
                    ].join(' ')}
                  >
                    <span className='truncate tracking-wider'>{project.name}</span>
                    <button
                      onClick={(e) => handleDelete(e, project.id)}
                      className='opacity-0 transition hover:text-rose-400 group-hover:opacity-100'
                      title='删除项目'
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className='border-t border-white/[0.08] p-3'>
            <button
              onClick={handleCreate}
              className='w-full rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 py-2 text-sm font-medium tracking-widest text-[#e8c766] transition hover:bg-[#d4af37]/20'
            >
              新建项目
            </button>
          </div>
        </>
      )}
      {/* Collapsed state - show icons */}
      {sidebarCollapsed && (
        <div className="flex flex-1 flex-col items-center gap-2 py-4">
          {projects.projects.map((project) => (
            <button
              key={project.id}
              onClick={() => selectProject(project.id)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border text-xs font-medium transition ${
                currentProject?.id === project.id
                  ? 'border-[#d4af37]/30 bg-[#d4af37]/10 text-[#e8c766]'
                  : 'border-transparent text-[#8a8794] hover:bg-white/5 hover:text-[#e8e6df]'
              }`}
              title={project.name}
            >
              {project.name.charAt(0).toUpperCase()}
            </button>
          ))}
          <button
            onClick={handleCreate}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#6d6a78] transition hover:bg-white/5 hover:text-[#e8c766]"
            title="新建项目"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}