import { useLocation } from 'react-router-dom';

import { ErrorState } from '../components/ui';
import { TasksPage } from '../pages/TasksPage';
import { findSystemExtensionPage } from './systemExtensions';

export function ExtensionPage() {
  const location = useLocation();
  const surface = findSystemExtensionPage(location.pathname);

  if (surface?.component === 'automations') {
    return <TasksPage />;
  }

  return <ErrorState title="Extension surface unavailable" message="No extension page is registered for this route." />;
}
