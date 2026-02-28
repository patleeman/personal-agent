# Profile Schema

## Schema Version

**Current version:** `1.0.0`

Version follows semantic versioning:
- **Major:** Breaking schema changes requiring migration
- **Minor:** Additive changes (new optional fields)
- **Patch:** Documentation fixes, no structural changes

## Core Profile Fields

### Required Fields

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `id` | `string` | Unique profile identifier | UUID v4 format, immutable |
| `version` | `string` | Schema version | Must match semver, auto-set on create |
| `createdAt` | `ISO8601` | Creation timestamp | Auto-set, immutable |
| `updatedAt` | `ISO8601` | Last modification timestamp | Auto-updated on change |

### Identity Fields

| Field | Type | Required | Default | Validation |
|-------|------|----------|---------|------------|
| `name` | `string` | Yes | — | 1-100 characters, trimmed |
| `email` | `string` | No | `null` | Valid email format if present |
| `timezone` | `string` | No | `"UTC"` | IANA timezone identifier |
| `locale` | `string` | No | `"en-US"` | BCP 47 language tag |

### Preference Fields

| Field | Type | Required | Default | Validation |
|-------|------|----------|---------|------------|
| `theme` | `enum` | No | `"system"` | `"light"`, `"dark"`, `"system"` |
| `notifications` | `object` | No | See below | Nested notification preferences |
| `privacy` | `object` | No | See below | Nested privacy settings |

#### Notification Preferences (nested)

```typescript
{
  email: boolean,      // default: true
  push: boolean,       // default: true
  digest: "daily" | "weekly" | "never"  // default: "daily"
}
```

#### Privacy Settings (nested)

```typescript
{
  analytics: boolean,  // default: true
  shareUsage: boolean  // default: false
}
```

### Agent Configuration Fields

| Field | Type | Required | Default | Validation |
|-------|------|----------|---------|------------|
| `modelPreferences` | `object` | No | See below | Preferred AI models per task type |
| `toolPermissions` | `object` | No | See below | Allowed tool categories |
| `customInstructions` | `string` | No | `""` | Max 4000 characters |

#### Model Preferences (nested)

```typescript
{
  default: string,           // default: "claude-sonnet-4-20250514"
  coding: string | null,     // default: null (uses default)
  analysis: string | null,   // default: null (uses default)
  creative: string | null    // default: null (uses default)
}
```

#### Tool Permissions (nested)

```typescript
{
  webSearch: boolean,        // default: true
  codeExecution: boolean,    // default: false
  fileSystem: boolean,       // default: true
  externalApis: boolean      // default: false
}
```

## Validation Rules

### Field-Level Validation

1. **String fields:** Trim whitespace before validation
2. **Enum fields:** Must match exactly one allowed value
3. **Nested objects:** Validate recursively, reject unknown keys
4. **Timestamps:** Must be valid ISO8601 with timezone

### Profile-Level Validation

1. **Immutable fields:** `id`, `createdAt` cannot change after creation
2. **Version updates:** `updatedAt` must advance on every modification, must be >= `createdAt`
3. **Schema compatibility:** `version` must be compatible with current runtime

### Default Behavior

- Missing optional fields inherit defaults at runtime
- Explicit `null` overrides defaults (field remains unset)
- Empty strings are valid unless minimum length specified
- Nested objects merge with defaults (shallow merge)

## Schema Evolution

### Backward Compatibility

- **Minor versions:** Additive only, old profiles valid under new schema
- **Major versions:** Breaking changes, migration required
- **Default strategy:** New optional fields with sensible defaults

### Deprecation

- Deprecated fields remain in schema for 2 major versions
- Access to deprecated fields logs warning
- Migration path documented in migration strategy

## Example Profile

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "version": "1.0.0",
  "createdAt": "2024-01-15T09:30:00Z",
  "updatedAt": "2024-06-20T14:22:00Z",
  "name": "Jane Developer",
  "email": "jane@example.com",
  "timezone": "America/New_York",
  "locale": "en-US",
  "theme": "dark",
  "notifications": {
    "email": true,
    "push": false,
    "digest": "weekly"
  },
  "privacy": {
    "analytics": true,
    "shareUsage": false
  },
  "modelPreferences": {
    "default": "claude-sonnet-4-20250514",
    "coding": "claude-opus-4-20250514"
  },
  "toolPermissions": {
    "webSearch": true,
    "codeExecution": true,
    "fileSystem": true,
    "externalApis": false
  },
  "customInstructions": "Prefer concise responses. Use TypeScript for code examples."
}
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-06-01 | Initial schema definition |
