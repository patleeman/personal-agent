---
name: wrapup
description: Verify task completion before finishing. Checks for stubbed code, TODOs, full-stack implementation, test coverage, and commits changes.
---

# Wrapup

Final verification before marking a task complete.

## Purpose

This skill ensures nothing is left incomplete. Use it before finishing any implementation task to verify everything is production-ready.

## Checklist

### 1. Task Completeness

Before finishing, verify:

- [ ] **No stubbed implementations** - All functions do what they claim
- [ ] **No TODO comments** - Search for `TODO`, `FIXME`, `XXX`, `HACK`
- [ ] **No placeholder values** - No "lorem ipsum", fake data, or mock implementations
- [ ] **No commented-out code** - Either delete it or uncomment it
- [ ] **No unfinished error handling** - All error paths are handled properly

```bash
# Search for incomplete markers
rg -i "(TODO|FIXME|XXX|HACK|stub|placeholder|not.?implemented)" --type-add 'code:*.{ts,tsx,js,jsx,go,py,rs}' -t code
```

### 2. Full-Stack Implementation

**Every feature must be accessible end-to-end.** Never leave a feature implemented only in one layer.

Verify the complete chain:
- [ ] **Backend API** - Endpoint or handler exists and works
- [ ] **Type definitions** - Types are defined and shared where needed
- [ ] **Frontend integration** - UI calls the API correctly
- [ ] **User access** - User can actually trigger/use the feature

Ask yourself: "Can a user actually use this feature right now?"

If the answer is no, the task is not complete.

### 3. Test Coverage

All implementations must have complete test coverage:

- [ ] **Unit tests** - Functions and components tested in isolation
- [ ] **Integration tests** - API endpoints and service interactions tested
- [ ] **E2E tests** - Critical user flows tested with Playwright (if applicable)

```bash
# Run all tests
make test

# Check coverage
make test-coverage
```

No test should be:
- Skipped or commented out
- Using `test.skip` or `it.skip`
- Incomplete or asserting nothing

### 4. Commit Changes

Once everything above is verified, commit using the `/checkpoint` skill:

```bash
/checkpoint
```

## Workflow

1. **Audit for incomplete code** - Run the search commands above
2. **Trace the feature** - Follow from UI to backend to verify complete implementation
3. **Run tests** - Ensure all tests pass
4. **Fix any gaps** - Complete anything that's missing
5. **Commit** - Use `/checkpoint` to commit and push

## When to Use

Use `/wrapup` when:
- You're about to tell the user a task is complete
- Finishing a feature implementation
- Before creating a pull request
- At the end of a work session

## Common Issues

### "I only implemented the backend"
The task is not complete. Implement the frontend integration.

### "I only implemented the frontend"
The task is not complete. Implement the backend API.

### "Tests are passing but I didn't write any"
The task is not complete. Write tests for your implementation.

### "I left a TODO for later"
The task is not complete. Finish it now or explicitly ask the user if they want to defer it.
