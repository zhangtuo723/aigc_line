import { useAppStore } from '../stores/app.store';

export function HomePage() {
  const { projects, createProject, selectProject, deleteProject, loadProjects } = useAppStore();

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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white text-lg">
            🤖
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">AI 助手</h1>
            <p className="text-sm text-slate-500">通用人工智能助手</p>
          </div>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建项目
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-8">
        {projects.projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <div className="mb-4 text-6xl">📁</div>
            <p className="text-lg font-medium text-slate-600">还没有项目</p>
            <p className="mt-2 text-sm text-slate-400">点击上方"新建项目"按钮开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.projects.map((project) => (
              <div
                key={project.id}
                onClick={() => selectProject(project.id)}
                className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-5 transition hover:border-cyan-300 hover:shadow-lg hover:shadow-cyan-50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-50 to-blue-50 text-lg">
                    📁
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, project.id)}
                    className="rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    title="删除项目"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <h3 className="mt-3 truncate text-sm font-semibold text-slate-800">{project.name}</h3>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
