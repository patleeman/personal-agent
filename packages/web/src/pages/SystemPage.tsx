import { Navigate, useLocation } from 'react-router-dom';
import { buildSettingsHref } from '../components/SettingsLayout';
import { readSystemComponentFromSearch } from '../systemSelection';

function resolveLegacySystemHref(search: string): string {
  switch (readSystemComponentFromSearch(search)) {
    case 'web-ui':
      return buildSettingsHref('system-web-ui');
    case 'daemon':
      return buildSettingsHref('system-daemon');
    case 'sync':
      return buildSettingsHref('system-sync');
    default:
      return buildSettingsHref('system');
  }
}

export function SystemPage() {
  const location = useLocation();
  return <Navigate to={resolveLegacySystemHref(location.search)} replace />;
}
