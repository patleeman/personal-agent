/**
 * Core personal agent library.
 *
 * Runtime state management for auth, sessions, knowledge, and desktop resources.
 * Mutable data stays outside managed repository files.
 */
export * from './runtime/index.js';
export * from './sqlite.js';
export * from './sqlite-migrations.js';
export * from './machine-config.js';
export * from './knowledge-base.js';
export * from './activity.js';
export * from './activity-conversation-links.js';
export * from './conversation-attention.js';
export * from './durable-run-attention.js';
export * from './deferred-resume.js';
export * from './alerts.js';
export * from './app-telemetry-db.js';
export * from './trace-db.js';
export * from './task-callback-bindings.js';
export * from './conversation-project-links.js';
export * from './conversation-artifacts.js';
export * from './conversation-attachments.js';
export * from './conversation-checkpoints.js';
export * from './conversation-commit-checkpoints.js';
export * from './project-artifacts.js';
export * from './session-meta.js';
export * from './projects.js';
export * from './cli-binary.js';
export * from './shell-env.js';
export * from './mcp.js';
export * from './mcp-bundled-config.js';
export * from './memory-docs.js';
export * from './memory-store.js';
export * from './nodes.js';
export * from './prompt-catalog.js';
export * from './resources.js';
export * from './system-prompt-template.js';
export * from './codex-compat.js';
