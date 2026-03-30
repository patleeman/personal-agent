import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { buildCompanionConversationPath } from './routes';

export function CompanionNewConversationPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api.createLiveSession().then(({ id }) => {
      if (!cancelled) {
        navigate(buildCompanionConversationPath(id), { replace: true });
      }
    }).catch(() => {
      if (!cancelled) {
        navigate(buildCompanionConversationPath(''), { replace: true });
      }
    });
    return () => { cancelled = true; };
  }, [navigate]);

  return null;
}
