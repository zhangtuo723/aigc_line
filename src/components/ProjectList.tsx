import { useAppStore } from '../stores/app.store';

export function ProjectList() {
  const { projects, currentProject, createProject, selectProject, deleteProject, loadProjects } =
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
    <div className='flex h-full flex-col border-r border-slate-200 bg-white'>
      <div className='border-b border-slate-200 p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-wider text-slate-500'>项目列表</h2>
      </div>
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
    </div>
  );
}
