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

// Activity exports
export * from './activity.js';

// Activity ↔ conversation link exports
export * from './activity-conversation-links.js';

// Conversation attention exports
export * from './conversation-attention.js';

// Deferred resume state exports
export * from './deferred-resume.js';

// Conversation ↔ project link exports
export * from './conversation-project-links.js';

// Project artifact exports
export * from './project-artifacts.js';

// Session metadata exports
export * from './session-meta.js';

// Project exports
export * from './projects.js';

// MCP CLI integration exports
export * from './mcp-cli.js';
