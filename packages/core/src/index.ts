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

// Deferred resume state exports
export * from './deferred-resume.js';

// Conversation ↔ workstream link exports
export * from './conversation-links.js';

// Workstream artifact exports
export * from './workstream-artifacts.js';

// Workstream exports
export * from './workstreams.js';
