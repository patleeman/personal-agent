/**
 * Core personal agent library.
 *
 * Runtime state management for auth, sessions, knowledge, and desktop resources.
 * Mutable data stays outside managed repository files.
 */
// Runtime state exports
export * from './runtime/index.js';
// SQLite helpers
export * from './sqlite.js';
// SQLite schema migration framework
export * from './sqlite-migrations.js';
// Machine-local config exports
export * from './machine-config.js';
// Managed knowledge base sync exports
export * from './knowledge-base.js';
// Activity exports
export * from './activity.js';
// Activity ↔ conversation link exports
export * from './activity-conversation-links.js';
// Conversation attention exports
export * from './conversation-attention.js';
// Durable run attention exports
export * from './durable-run-attention.js';
// Deferred resume state exports
export * from './deferred-resume.js';
// Alert exports
export * from './alerts.js';
// Trace database exports
export * from './app-telemetry-db.js';
export * from './observability-db.js';
export * from './trace-db.js';
// Scheduled task callback binding exports
export * from './task-callback-bindings.js';
// Conversation ↔ project link exports
export * from './conversation-project-links.js';
// Conversation artifact exports
export * from './conversation-artifacts.js';
// Conversation attachment exports
export * from './conversation-attachments.js';
// Conversation checkpoint exports
export * from './conversation-checkpoints.js';
// Conversation commit checkpoint exports
export * from './conversation-commit-checkpoints.js';
// Project artifact exports
export * from './project-artifacts.js';
// Session metadata exports
export * from './session-meta.js';
// Project exports
export * from './projects.js';
// CLI binary inspection exports
export * from './cli-binary.js';
// Child-process environment helpers
export * from './shell-env.js';
// Native MCP integration exports
export * from './mcp.js';
export * from './mcp-bundled-config.js';
// Memory package path + migration exports
export * from './memory-docs.js';
// Memory package parsing + CRUD exports
export * from './memory-store.js';
// Unified durable nodes
export * from './nodes.js';
// Runtime resource resolution helpers
export * from './prompt-catalog.js';
export * from './resources.js';
export * from './system-prompt-template.js';
// Codex compatibility transport helpers
export * from './codex-compat.js';
