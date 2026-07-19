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
    <div className={`flex h-full flex-col border-r border-slate-200 bg-white transition-all duration-300 ${sidebarCollapsed ? 'w-14' : 'w-64'}`}>
      {/* Header with collapse button */}
      <div className={`flex items-center border-b border-slate-200 p-4 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!sidebarCollapsed && <h2 className='text-sm font-semibold uppercase tracking-wider text-slate-500'>项目列表</h2>}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
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
              <p className='p-2 text-sm text-slate-400'>暂无项目</p>
            ) : (
              <ul className='space-y-1'>
                {projects.projects.map((project) => (
                  <li
                    key={project.id}
                    onClick={() => selectProject(project.id)}
                    className={[
                      'group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition',
                      currentProject?.id === project.id
                        ? 'bg-cyan-50 text-cyan-800'
                        : 'text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <span className='truncate'>{project.name}</span>
                    <button
                      onClick={(e) => handleDelete(e, project.id)}
                      className='opacity-0 transition hover:text-red-600 group-hover:opacity-100'
                      title='删除项目'
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className='border-t border-slate-200 p-3'>
            <button
              onClick={handleCreate}
              className='w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700'
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
              className={`flex h-10 w-10 items-center justify-center rounded-lg text-xs font-medium transition ${
                currentProject?.id === project.id
                  ? 'bg-cyan-50 text-cyan-800'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
              title={project.name}
            >
              {project.name.charAt(0).toUpperCase()}
            </button>
          ))}
          <button
            onClick={handleCreate}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-cyan-600"
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
