import { useEffect } from 'react';
import { useAppStore } from './stores/app.store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { SettingsPage } from './pages/SettingsPage';
import { TitleBar } from './components/TitleBar';

function App() {
  const currentPage = useAppStore((state) => state.currentPage);
  const loadProjects = useAppStore((state) => state.loadProjects);

  useEffect(() => {
    void loadProjects({ restoreLastOpened: true });
  }, [loadProjects]);

  return (
    <div className='flex h-screen flex-col overflow-hidden bg-[#0a0a0f] text-[#e8e6df]'>
      <TitleBar />
      <div className='min-h-0 flex-1'>
        {currentPage === 'home' ? (
          <HomePage />
        ) : currentPage === 'settings' ? (
          <SettingsPage />
        ) : (
          <ProjectPage />
        )}
      </div>
    </div>
  );
}

export default App;
