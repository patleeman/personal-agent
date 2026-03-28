export const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';
export const PROJECT_VIEW_QUERY_PARAM = 'view';
export const PROJECT_NEW_QUERY_PARAM = 'new';

export function readProjectView(search: string): string {
  return new URLSearchParams(search).get(PROJECT_VIEW_QUERY_PARAM)?.trim() || 'document';
}

export function readCreateProjectState(search: string): boolean {
  return new URLSearchParams(search).get(PROJECT_NEW_QUERY_PARAM) === '1';
}

export function buildProjectsHref(
  profile: string | 'all',
  projectId?: string,
  view?: string | null,
  creating?: boolean | null,
): string {
  const params = new URLSearchParams();
  params.set(VIEW_PROFILE_QUERY_PARAM, profile);
  if (view) {
    params.set(PROJECT_VIEW_QUERY_PARAM, view);
  }
  if (creating) {
    params.set(PROJECT_NEW_QUERY_PARAM, '1');
  }
  const search = `?${params.toString()}`;
  return projectId ? `/projects/${projectId}${search}` : `/projects${search}`;
}

