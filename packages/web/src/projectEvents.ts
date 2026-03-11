export const PROJECTS_CHANGED_EVENT = 'pa:projects-changed';

export function emitProjectsChanged() {
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}
