import type { AppEvent, DesktopAppEvent } from '../shared/types';

export function normalizeAppEvent(event: AppEvent): DesktopAppEvent | null {
  switch (event.type) {
    case 'connected':
      return null;
    case 'sessions_snapshot':
      return {
        type: 'sessions',
        sessions: event.sessions,
      };
    case 'tasks_snapshot':
      return {
        type: 'tasks',
        tasks: event.tasks,
      };
    case 'runs_snapshot':
      return {
        type: 'runs',
        result: event.result,
      };
    case 'daemon_snapshot':
      return {
        type: 'daemon',
        state: event.state,
      };
    default:
      return event;
  }
}
