export const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';
export const PROJECT_VIEW_QUERY_PARAM = 'view';

export function readProjectView(search: string): string {
  return new URLSearchParams(search).get(PROJECT_VIEW_QUERY_PARAM)?.trim() || 'overview';
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
    case 'requirements': return 'project-requirements';
    case 'plan': return 'project-plan';
    case 'completion': return 'project-completion';
    case 'timeline': return 'project-timeline';
    case 'handoff': return 'project-handoff';
    case 'record': return 'project-record';
    case 'links': return 'project-links';
    case 'notes': return 'project-notes';
    case 'files': return 'project-files';
    default: return null;
  }
}
