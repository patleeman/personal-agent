import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TasksPage } from './pages/TasksPage';
import { Layout } from './components/Layout';
import { ConversationPage } from './pages/ConversationPage';
import { InboxPage } from './pages/InboxPage';
import { MemoryPage } from './pages/MemoryPage';
import { WorkstreamsPage } from './pages/WorkstreamsPage';
import { LiveTitlesContext } from './contexts';

export function App() {
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const setTitle = (id: string, title: string) =>
    setTitleMap(prev => {
      if (prev.get(id) === title) return prev;
      const next = new Map(prev);
      next.set(id, title);
      return next;
    });

  return (
    <LiveTitlesContext.Provider value={{ titles: titleMap, setTitle }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/inbox" replace />} />
            <Route path="conversations/:id" element={<ConversationPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="inbox/:id" element={<InboxPage />} />
            <Route path="workstreams" element={<WorkstreamsPage />} />
            <Route path="workstreams/:id" element={<WorkstreamsPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="tasks/:id" element={<TasksPage />} />
            <Route path="memory" element={<MemoryPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LiveTitlesContext.Provider>
  );
}
