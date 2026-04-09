/**
 * Core personal agent library
 * 
 * Provides profile management, validation, and merge engine
 * for layered configuration (shared < datadog < local).
 * 
 * Runtime state management for auth, sessions, and cache
 * ensures mutable data stays outside managed repository files.
 */

// Profile module exports
export * from './profile/index.js';

// Runtime state exports
export * from './runtime/index.js';

// SQLite helpers
export * from './sqlite.js';

// Machine-local config exports
export * from './machine-config.js';

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

// Project artifact exports
export * from './project-artifacts.js';

// Session metadata exports
export * from './session-meta.js';

// Project exports
export * from './projects.js';

// CLI binary inspection exports
export * from './cli-binary.js';

// Native MCP integration exports
export * from './mcp.js';

// Memory package path + migration exports
export * from './memory-docs.js';

// Memory package parsing + CRUD exports
export * from './memory-store.js';

// Unified durable nodes
export * from './nodes.js';

