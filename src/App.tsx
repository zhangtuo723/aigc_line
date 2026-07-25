import { useEffect } from 'react';
import { useAppStore } from './stores/app.store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { TitleBar } from './components/TitleBar';

function App() {
  const { currentPage, loadProjects } = useAppStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className='flex h-screen flex-col overflow-hidden bg-[#0a0a0f] text-[#e8e6df]'>
      <TitleBar />
      <div className='min-h-0 flex-1'>
        {currentPage === 'home' ? <HomePage /> : <ProjectPage />}
      </div>
    </div>
  );
}

export default App;
