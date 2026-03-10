import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TasksPage } from './pages/TasksPage';
import { Layout } from './components/Layout';
import { ConversationPage } from './pages/ConversationPage';
import { InboxDetailPage } from './pages/InboxDetailPage';
import { InboxPage } from './pages/InboxPage';
import { WorkstreamDetailPage } from './pages/WorkstreamDetailPage';
import { WorkstreamsPage } from './pages/WorkstreamsPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/inbox" replace />} />
          <Route path="conversations/:id" element={<ConversationPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="inbox/:id" element={<InboxDetailPage />} />
          <Route path="workstreams" element={<WorkstreamsPage />} />
          <Route path="workstreams/:id" element={<WorkstreamDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TasksPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
