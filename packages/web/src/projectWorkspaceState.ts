export const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';
export const PROJECT_VIEW_QUERY_PARAM = 'view';

export function readProjectView(search: string): string {
  return new URLSearchParams(search).get(PROJECT_VIEW_QUERY_PARAM)?.trim() || 'document';
}

export function buildProjectsHref(profile: string | 'all', projectId?: string, view?: string | null): string {
  const params = new URLSearchParams();
  params.set(VIEW_PROFILE_QUERY_PARAM, profile);
  if (view) {
    params.set(PROJECT_VIEW_QUERY_PARAM, view);
  }
  const search = `?${params.toString()}`;
  return projectId ? `/projects/${projectId}${search}` : `/projects${search}`;
}

export function projectViewToSectionId(view: string): string | null {
  switch (view) {
    case 'document': return 'project-document';
    case 'tasks': return 'project-tasks';
    case 'activity': return 'project-activity';
    case 'notes': return 'project-notes';
    case 'files': return 'project-files';
    case 'links': return 'project-links';
    default: return null;
  }
}
