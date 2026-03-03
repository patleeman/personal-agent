---
name: software-development-principals 
description: Guide for writing software. Read this before writing a single line of code. 
---

# Grug Brained Dev Software Development Philosophy

## Prime Directive: Complexity Is The Enemy

**Complexity is the worst enemy of software development.** Every line of code is a liability. Every abstraction is a potential complexity demon. Simple always beats clever.

### Core Principles

#### 1. Push Back on New Features

- Question every feature request: is this needed or just nice to have?
- Ask the user if they truly need this feature
- Features not built have no bugs, no maintenance, no complexity
- Less code is better—fight scope creep actively
- Require strong justification before adding complexity

#### 2. No Premature Abstraction

- Let code repeat initially to discover natural patterns
- Only abstract when you see clear "cut points" with narrow interfaces
- Wrong abstraction is worse than duplication
- Three similar instances is the minimum for abstraction consideration
- Write targeted code that is simple and does what it says on the box

#### 3. Respect Existing Code (Chesterton's Fence)

- Understand why code exists before removing it
- Working systems deserve respect even if ugly
- Previous developers may have knowledge you lack
- Document decisions when removing legacy code

### Writing Code

#### Keep Expressions Simple

**Bad - Nested complexity:**
```python
result = transform(filter(map(data, fn1), fn2), fn3)
```

**Good - Step by step:**
```python
mapped = map(data, fn1)
filtered = filter(mapped, fn2)
result = transform(filtered, fn3)
```

Break complex expressions into named intermediate steps. Debuggers and humans thank you.

#### Prefer Locality Over Separation

- Keep related code together in the same area
- Organize by feature/domain, not by file type
- Avoid forcing readers to jump between many files
- Files should be focused—split when they exceed ~800 lines
- Functions should be small—usually under 50 lines
- Put code near what it relates to to minimize context switching

#### Duplication > Wrong Abstraction

- Copy-paste is sometimes the right choice
- Three lines of similar code beats one clever abstraction
- DRY is a guideline, not a law
- Simple duplication beats complex indirection

#### Error Handling

Always handle errors comprehensively. Silent failures are complexity demons.

```typescript
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  console.error("Operation failed:", error);
  throw new Error("Detailed user-friendly message");
}
```

- Catch and handle errors at appropriate boundaries
- Provide useful error messages for debugging
- Don't swallow errors silently
- Test error paths to ensure they work

#### Input Validation

Always validate user input at system boundaries. Trust nothing from outside.

```typescript
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
});

const validated = schema.parse(input);
```

- Validate at the edges (API endpoints, form handlers, external data)
- Use validation libraries to avoid writing validation logic
- Fail fast with clear validation errors
- Trust internal code—don't validate between your own functions

### Documentation

**Documentation rot is real. Only write what won't go stale.**

- **No file trees** - they're outdated the moment you write them
- **No verbose READMEs** - link to code, don't duplicate it
- **No architecture diagrams in markdown** - use actual tools or don't bother
- **Code should be self-documenting** - good names > comments
- **Comments explain "why", code shows "how"** - if you need to explain what code does, rewrite it
- **Keep docs near the code** - separate doc files are orphaned doc files

### Code Quality Basics

Before shipping code:

- **Readable names** - variables and functions should explain themselves
- **Small functions** - usually under 50 lines
- **Focused files** - split files over 800 lines
- **No deep nesting** - more than 4 levels means extract functions
- **Handle all errors** - no silent failures
- **Remove debug code** - no console.log statements in production
- **No magic values** - extract constants for important numbers/strings

These aren't dogma—they're guidelines that usually lead to simpler code.

### Testing Strategy

Writing tests is cheap insurance. Cover all cases with 90%+ coverage.

#### Three test types, all required:

1. **Unit Tests** - Small, fast tests for functions and components. Mock external dependencies. Cover all edge cases and errors.

2. **Integration Tests** - Test how pieces work together. API endpoints, database operations, service interactions.

3. **E2E Tests** - Critical user flows only (Playwright). Test complete journeys. Keep these few and focused.

#### Test-Driven Development (TDD):

1. **RED** - Write test first, watch it fail
2. **GREEN** - Write minimal code to pass
3. **REFACTOR** - Improve while keeping tests green

Write tests first. Catches bugs early. Makes you think about interface.

**When tests fail:** Fix implementation, not test (unless test is actually wrong). Check test isolation. No flaky tests.

#### Spec-Based Testing

Tests are specifications—they describe **how software should behave**, not how it's implemented internally.

- Test observable outputs and side effects, not internal method calls
- Tests should survive refactoring (if behavior unchanged, tests stay green)
- Write tests that read like requirements: "it returns X when given Y"
- Avoid over-mocking—test real behavior where practical

```typescript
// ✅ Good: Tests behavior
it('returns user profile when given valid ID', async () => {
  const profile = await getProfile('user-123')
  expect(profile.name).toBe('Alice')
})

// ❌ Bad: Tests implementation
it('calls database with correct query', async () => {
  await getProfile('user-123')
  expect(db.query).toHaveBeenCalledWith('SELECT * FROM users...')
})
```

For building complete features with TDD, use `/skill:tdd-feature`.

### Refactoring Rules

1. **Must have full test coverage before refactoring** - tests are your safety net
2. **Keep refactorings small** - commit often in small chunks
3. **Large refactors usually fail** - break them down into manageable pieces
4. **Always shippable** - maintain working state between changes

### Concurrency: Approach With Fear

Fear concurrency. This fear is rational and keeps you safe.

**Safe patterns:**
- Stateless request handlers
- Job queues with single consumers
- Optimistic locking
- Let the database handle coordination

**Avoid:**
- Shared mutable state
- Complex lock hierarchies
- Fine-grained locking
- "Works on my machine" concurrency

### Optimization Guidelines

1. **First make it work** - correctness before performance
2. **Then measure** - profile before optimizing
3. **Optimize what's slow** - not what you think is slow
4. **Network is slower than you think** - reduce round trips
5. **CPU is faster than you think** - don't micro-optimize

### API Design Principles

**Stress simplicity—APIs should be obvious to use and do what they say on the box.**

- Make simple cases simple to use
- Put methods on the objects they operate on
- Hide complexity until callers need it
- Good APIs are hard to use incorrectly
- APIs should be self-explanatory with clear naming
- Require explicit opt-in for dangerous operations

### Front-End Considerations

- Front-end ecosystem has many complexity demons
- SPAs introduce significant problems (state, routing, hydration)
- Consider server-side HTML rendering first
- Progressive enhancement over JavaScript-required
- Avoid framework churn—boring technology is good

### Working with the User

#### Disambiguate Before Implementation

- Say "I don't understand" when confused
- Ask clarifying questions before any implementation work
- Understanding requirements beats making assumptions
- Forcing complexity into the light weakens it

#### Ask Before Destructive Changes

- Always ask before making potentially destructive changes
- Always ask before changes to infrastructure
- Better to ask than to do something you cannot revert
- Confirm before deletions, force pushes, or major refactors

### Summary

When writing code, always ask: "Is this the simplest thing that could work?" Fight every urge to be clever. Resist every abstraction that isn't obviously needed. Say no to features. Keep it boring.

Simple beats clever every single time.
