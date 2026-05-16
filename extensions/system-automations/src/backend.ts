export { queueFollowup as deferredResume, queueFollowup } from './conversationQueueBackend.js';

export async function scheduledTask(input: unknown, ctx: unknown) {
  const module = await import('./scheduledTaskBackend.js');
  return module.scheduledTask(input, ctx as never);
}
