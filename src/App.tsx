import { useEffect } from 'react';
import { ProjectList } from './components/ProjectList';
import { ChatArea } from './components/ChatArea';
import { useAppStore } from './stores/app.store';

function App() {
  const { loadProjects } = useAppStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className='flex h-screen overflow-hidden bg-slate-50 text-slate-900'>
      {/* Left sidebar - Project list */}
      <aside className='w-64 flex-shrink-0'>
        <ProjectList />
      </aside>

      {/* Right area - Chat */}
      <main className='flex flex-1 flex-col overflow-hidden'>
        <ChatArea />
      </main>
    </div>
  );
}

export default App;
