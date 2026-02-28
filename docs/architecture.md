# Personal Agent Architecture

## Overview

This document defines the system architecture for a personal AI agent. The architecture separates concerns into distinct modules with clear boundaries and contracts to ensure maintainability, testability, and safe evolution.

## Core Modules

### 1. Profile Model (`/profile`)

**Responsibility:** Define and validate user profile data structures.

**In-boundaries:**
- Profile schema definitions
- Field validation logic
- Default value computation
- Schema versioning metadata

**Out-boundaries:**
- Does NOT handle persistence
- Does NOT handle runtime state
- Does NOT execute migrations

**Data ownership:** Owns the shape and validation rules of profile data, but not the stored instances.

### 2. Runtime State (`/runtime`)

**Responsibility:** Manage ephemeral execution state during agent operations.

**In-boundaries:**
- Session context
- Active tool invocations
- Conversation history (in-memory)
- Temporary computation results

**Out-boundaries:**
- Does NOT persist data directly
- Does NOT define profile schemas
- Does NOT handle long-term storage

**Data ownership:** Owns transient operational state only. Delegates persistence to the Persistence module.

### 3. Persistence (`/persistence`)

**Responsibility:** Handle all data storage and retrieval operations.

**In-boundaries:**
- Profile storage/retrieval
- Migration state tracking
- Configuration persistence
- Audit logging

**Out-boundaries:**
- Does NOT define profile schemas (uses Profile Model)
- Does NOT manage runtime session state
- Does NOT execute business logic

**Data ownership:** Owns storage mechanisms and migration state, but delegates schema validation to Profile Model.

### 4. Migration Engine (`/migrations`)

**Responsibility:** Execute schema and data transformations safely.

**In-boundaries:**
- Forward migration execution
- Rollback capability
- Migration state validation
- Compatibility checking

**Out-boundaries:**
- Does NOT define target schemas (uses Profile Model)
- Does NOT manage runtime state
- Does NOT handle general persistence

**Data ownership:** Owns migration scripts and execution state, delegates data access to Persistence module.

## Module Interaction Contract

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Profile Model │────▶│   Persistence   │◀────│ Migration Engine│
│   (schema)      │     │   (storage)     │     │   (transforms)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         └─────────────▶│ Runtime State   │◀─────────────┘
                        │ (operations)    │
                        └─────────────────┘
```

### Allowed Data Flows

1. **Profile Model → Persistence:** Schema definitions for storage validation
2. **Profile Model → Migration Engine:** Target schema for migrations
3. **Profile Model → Runtime State:** Schema for runtime validation of loaded profiles
4. **Persistence → Runtime State:** Hydrated data for operations
5. **Migration Engine → Persistence:** Read existing data, write transformed data
6. **Runtime State → Persistence:** Request persistence of operational results

### Forbidden Couplings

- Runtime State cannot import Migration Engine directly
- Persistence cannot define its own schema validation (must use Profile Model)
- Migration Engine cannot access Runtime State
- Profile Model cannot depend on Persistence or Runtime State

## Data Ownership Summary

| Module | Owns | Delegates |
|--------|------|-----------|
| Profile Model | Schema, validation, defaults | Storage, runtime, migrations |
| Runtime State | Session context, temporary data | Persistence, schema validation |
| Persistence | Storage mechanisms, migration state | Schema validation, business logic |
| Migration Engine | Migration scripts, execution state | Data access, schema definitions |

## Version Compatibility

- **Schema version:** Defined in Profile Model, format `major.minor.patch`
- **Migration version:** Matches target schema version
- **Runtime compatibility:** Runtime State must support current and previous schema version
- **Persistence compatibility:** Storage layer must support all schema versions with migrations
