import { useEffect, useRef } from 'react';
import { useAppStore } from './stores/app.store';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { SettingsPage } from './pages/SettingsPage';
import { TitleBar } from './components/TitleBar';
import { beginEditBarrier, flushPendingEdits } from './shared/pending-edits';

function App() {
  const releaseCloseRef = useRef<(() => void) | undefined>(undefined);
  const currentPage = useAppStore((state) => state.currentPage);
  const loadProjects = useAppStore((state) => state.loadProjects);

  useEffect(() => {
    void loadProjects({ restoreLastOpened: true });
  }, [loadProjects]);

  useEffect(() => window.electronAPI.onBeforeClose(async (requestId) => {
    releaseCloseRef.current?.();
    releaseCloseRef.current = beginEditBarrier();
    try {
      await flushPendingEdits();
      window.electronAPI.confirmClose({ requestId, success: true });
    } catch (error) {
      releaseCloseRef.current?.();
      releaseCloseRef.current = undefined;
      window.electronAPI.confirmClose({ requestId, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }), []);
  useEffect(() => window.electronAPI.onCloseCancelled(() => {
    releaseCloseRef.current?.(); releaseCloseRef.current = undefined;
  }), []);

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
