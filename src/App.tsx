import { useEffect } from 'react';
import { useAppStore } from './stores/app.store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';

function App() {
  const { currentPage, loadProjects } = useAppStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className='h-screen overflow-hidden bg-slate-50 text-slate-900'>
      {currentPage === 'home' ? <HomePage /> : <ProjectPage />}
    </div>
  );
}

export default App;
