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
