/**
 * Hook to fetch skill apps from the API.
 */

import { useCallback, useEffect, useState } from 'react';

import type { SkillApp } from './types';

export function useAppList(): {
  apps: SkillApp[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [apps, setApps] = useState<SkillApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApps = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch('/api/apps')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to list apps: ${res.statusText}`);
        return res.json() as Promise<SkillApp[]>;
      })
      .then((data) => {
        setApps(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  return { apps, loading, error, refetch: fetchApps };
}
