import { useEffect } from 'react';
import { ProjectList } from './components/ProjectList';
import { CanvasWorkspace } from './components/CanvasWorkspace';
import { useAppStore } from './stores/app.store';

function App() {
  const { loadProjects } = useAppStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className='flex h-screen overflow-hidden bg-slate-50 text-slate-900'>
      {/* Left sidebar - Project list */}
      <ProjectList />

      {/* Right area - Canvas Workspace */}
      <CanvasWorkspace />
    </div>
  );
}

export default App;
