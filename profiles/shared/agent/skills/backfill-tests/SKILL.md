---
name: backfill-tests
description: Analyze codebase coverage, create comprehensive test plan, and backfill missing tests for existing code. Systematically adds unit, integration, and E2E tests to reach 80%+ coverage.
---

# Backfill Tests

This command invokes the **test-backfill-guide** agent to systematically add tests to existing code.

## What This Command Does

1. **Analyze Coverage** - Run coverage report and identify gaps
2. **Create Test Plan** - Document every missing test case by category
3. **Add Todos** - Create todo items for each test case
4. **Build Tests** - Systematically implement all planned tests
5. **Verify Coverage** - Ensure 80%+ coverage achieved

## When to Use

Use `/backfill-tests` when:
- Inheriting legacy code without tests
- Coverage is below 80%
- Adding tests to existing features
- Auditing test completeness
- Preparing for refactoring

**NOTE**: For NEW features, use `/tdd` instead (write tests FIRST).

## How It Works

The test-backfill-guide agent will:

1. **Run coverage analysis** to identify gaps
2. **Analyze each under-tested file** for missing test scenarios
3. **Create a comprehensive plan** with all missing test cases:
   - Happy path tests
   - Error/exception tests
   - Edge case tests
   - Integration tests
   - Boundary condition tests
4. **Add all test cases as todos** for tracking
5. **Build tests systematically**, one category at a time
6. **Verify each test passes** before moving to next
7. **Report final coverage metrics**

## Test Categories (in priority order)

### 1. Happy Path Tests
- Normal operation with valid inputs
- Expected successful outcomes
- Common use cases

### 2. Error Path Tests
- Invalid inputs
- Exception handling
- Error messages
- Failure scenarios

### 3. Edge Cases
- Empty inputs ([], {}, "", null, undefined)
- Boundary values (0, -1, MAX_INT)
- Special characters
- Malformed data

### 4. Integration Tests
- API endpoints
- Database operations
- External service calls
- Component interactions

### 5. State/Side Effect Tests
- Mutations
- State changes
- Event emissions
- Async operations

## Example Usage

```
User: /backfill-tests

Agent (test-backfill-guide):
# Test Backfill Session

## Step 1: Coverage Analysis

Running coverage analysis...

```bash
npm test -- --coverage
```

Current Coverage:
- Overall: 45%
- Statements: 432/960 (45%)
- Branches: 89/234 (38%)
- Functions: 67/145 (46%)
- Lines: 425/952 (45%)

Files Below 80% Threshold:
1. lib/market-analyzer.ts - 23% (34/150 lines)
2. lib/order-validator.ts - 52% (67/129 lines)
3. api/trade-endpoints.ts - 0% (0/89 lines)
4. utils/price-calculator.ts - 67% (45/67 lines)

## Step 2: Test Plan - lib/market-analyzer.ts

### Missing Test Cases

#### Happy Path (8 tests)
1. ✅ TODO: analyzeMarket() returns valid analysis for normal market
2. ✅ TODO: analyzeMarket() calculates correct volatility score
3. ✅ TODO: analyzeMarket() identifies trends correctly
4. ✅ TODO: getTrendDirection() returns 'up' for rising markets
5. ✅ TODO: getTrendDirection() returns 'down' for falling markets
6. ✅ TODO: getTrendDirection() returns 'sideways' for stable markets
7. ✅ TODO: calculateVolatility() returns number between 0-100
8. ✅ TODO: getMarketSentiment() returns valid sentiment score

#### Error Path (6 tests)
1. ✅ TODO: analyzeMarket() throws on invalid market data
2. ✅ TODO: analyzeMarket() throws on missing required fields
3. ✅ TODO: getTrendDirection() handles empty price history
4. ✅ TODO: calculateVolatility() returns 0 for insufficient data
5. ✅ TODO: getMarketSentiment() handles API failures gracefully
6. ✅ TODO: analyzeMarket() validates date ranges

#### Edge Cases (5 tests)
1. ✅ TODO: analyzeMarket() handles single data point
2. ✅ TODO: analyzeMarket() handles all identical prices
3. ✅ TODO: calculateVolatility() handles negative prices correctly
4. ✅ TODO: getTrendDirection() handles extreme volatility
5. ✅ TODO: getMarketSentiment() handles zero volume

#### Integration Tests (3 tests)
1. ✅ TODO: analyzeMarket() fetches and processes live data
2. ✅ TODO: analyzeMarket() caches results appropriately
3. ✅ TODO: analyzeMarket() integrates with sentiment API

**Total for market-analyzer.ts: 22 test cases**

## Step 3: Test Plan - lib/order-validator.ts

[Similar breakdown for each file...]

## Complete Test Plan Summary

- lib/market-analyzer.ts: 22 test cases
- lib/order-validator.ts: 18 test cases
- api/trade-endpoints.ts: 15 test cases
- utils/price-calculator.ts: 8 test cases

**Total: 63 test cases to backfill**

All test cases added to todo list. Starting implementation...

---

## Step 4: Build Tests - lib/market-analyzer.ts

### Happy Path Tests (1/8)

```typescript
// lib/market-analyzer.test.ts
import { analyzeMarket } from './market-analyzer'

describe('analyzeMarket - Happy Path', () => {
  it('returns valid analysis for normal market', () => {
    const marketData = {
      symbol: 'BTC/USD',
      prices: [50000, 51000, 50500, 52000],
      volumes: [100, 120, 110, 130],
      timestamp: new Date()
    }

    const result = analyzeMarket(marketData)

    expect(result).toHaveProperty('volatility')
    expect(result).toHaveProperty('trend')
    expect(result).toHaveProperty('sentiment')
    expect(result.volatility).toBeGreaterThanOrEqual(0)
    expect(result.volatility).toBeLessThanOrEqual(100)
  })
})
```

Running test...

```bash
npm test lib/market-analyzer.test.ts
```

✅ PASS - 1/22 tests complete

✅ TODO COMPLETED: analyzeMarket() returns valid analysis for normal market

[Continues for each test case...]

---

## Step 5: Final Coverage Report

All 63 tests implemented and passing!

Final Coverage:
- Overall: 87% ✅ (was 45%)
- Statements: 834/960 (87%)
- Branches: 198/234 (85%)
- Functions: 132/145 (91%)
- Lines: 828/952 (87%)

Files Now Above 80%:
- lib/market-analyzer.ts - 95% ✅ (was 23%)
- lib/order-validator.ts - 89% ✅ (was 52%)
- api/trade-endpoints.ts - 82% ✅ (was 0%)
- utils/price-calculator.ts - 94% ✅ (was 67%)

✅ Test backfill complete! Coverage increased from 45% to 87%.
```

## Workflow Steps

### Phase 1: Analysis
1. Run `npm test -- --coverage` (or pnpm/yarn equivalent)
2. Parse coverage report
3. Identify all files below 80%
4. For each file, analyze the actual code to identify untested functions/branches

### Phase 2: Planning
1. For each under-tested file, create detailed test case list:
   - **Happy path**: Normal operations with valid inputs
   - **Error path**: Invalid inputs, exceptions, edge conditions
   - **Edge cases**: Empty/null/undefined, boundaries, special values
   - **Integration**: API calls, DB operations, external dependencies
2. Document expected test count per file
3. Calculate total test cases needed

### Phase 3: Todo Creation
1. Add each test case as a separate todo item
2. Group by file and category
3. Prioritize: Happy path → Error path → Edge cases → Integration

### Phase 4: Implementation
1. Build tests one category at a time
2. Run tests after each implementation
3. Mark todos as complete
4. Move to next category only after current category passes

### Phase 5: Verification
1. Run full test suite
2. Generate final coverage report
3. Compare before/after metrics
4. Verify 80%+ threshold met

## Test Organization

Tests should be organized by file:

```
src/
  lib/
    market-analyzer.ts
    market-analyzer.test.ts    # Unit tests
  api/
    trade-endpoints.ts
    trade-endpoints.test.ts    # Integration tests
  e2e/
    trading-flow.e2e.test.ts   # End-to-end tests
```

## Coverage Requirements

- **80% minimum** for all files
- **100% required** for:
  - Financial calculations
  - Authentication/authorization
  - Security-critical code
  - Payment processing
  - Data validation

## Best Practices

**DO:**
- ✅ Analyze code behavior before writing tests
- ✅ Test actual behavior, not implementation
- ✅ Use descriptive test names (should/when/given format)
- ✅ Keep tests focused and independent
- ✅ Use realistic test data
- ✅ Test error messages and status codes
- ✅ Run tests after each addition

**DON'T:**
- ❌ Skip error path testing
- ❌ Mock everything (prefer real objects when possible)
- ❌ Write tests that depend on each other
- ❌ Test private methods directly
- ❌ Ignore flaky tests
- ❌ Copy-paste test cases without customization

## Integration with Other Commands

- Use `/plan` first to understand codebase structure
- Use `/backfill-tests` to add tests to existing code
- Use `/tdd` for new features (write tests first)
- Use `/code-review` to review test quality
- Use `/build-fix` if test infrastructure issues arise

## Important Notes

**Systematic Approach Required:**
This command takes a methodical approach:
1. Plan EVERYTHING first
2. Create todos for visibility
3. Implement systematically
4. Verify continuously

**Different from TDD:**
- TDD: Write test FIRST, then implement feature
- Backfill: Code exists, add tests AFTER

Use the right command for the job:
- New feature → `/tdd`
- Existing code → `/backfill-tests`

## Related Resources

See testing guidelines in:
- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/skills/tdd/SKILL.md` (for new features)
- `~/.pi/agent/skills/e2e/SKILL.md` (for end-to-end tests)
