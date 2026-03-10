import { Outlet } from 'react-router-dom';
import { ContextRail } from './ContextRail';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-base text-primary">
      <Sidebar />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>

      <aside className="flex-1 min-w-0 flex flex-col overflow-hidden bg-surface border-l border-border-subtle">
        <ContextRail />
      </aside>
    </div>
  );
}
