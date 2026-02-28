---
name: tdd-feature
description: Build a complete feature using test-driven development with spec-based testing. Tests describe how software should behave, not implementation details. Plans architecture, writes behavior specifications as tests, implements minimal code, and ensures 90%+ coverage.
---

# TDD Feature

This command invokes the **tdd-feature-guide** agent to build complete features using test-driven development methodology.

## What This Command Does

1. **Understand Requirements** - Clarify feature scope and acceptance criteria
2. **Plan Architecture** - Design components, data flow, and interfaces
3. **Create Test Plan** - Define all test cases before any implementation
4. **Build with TDD** - For each component: tests first, then minimal implementation
5. **Integration Testing** - Test components working together
6. **Verify & Refactor** - Ensure 90%+ coverage and clean code

## When to Use

Use `/tdd-feature` when:
- Building a new feature from scratch
- Adding significant functionality (multiple files/components)
- Feature requires multiple interconnected components
- You want full test coverage from the start
- Building critical business logic

**NOTE**:
- For single functions/components, use `/tdd` instead
- For adding tests to existing code, use `/backfill-tests`

## How It Works

The tdd-feature-guide agent will:

1. **Gather requirements** - Ask clarifying questions about the feature
2. **Design architecture** - Plan components, interfaces, and data flow
3. **Create comprehensive test plan** - Document all test cases up front
4. **Add todos** - Create task list for tracking progress
5. **Build each component with TDD**:
   - Write tests first (RED)
   - Implement minimal code (GREEN)
   - Refactor while keeping tests green (REFACTOR)
6. **Build integration tests** - Test components working together
7. **Verify coverage** - Ensure 90%+ coverage achieved (including unit happy path, unit error states, and integration tests)
8. **Final refactor** - Clean up, remove duplication, improve code quality

## TDD Feature Workflow

```
1. PLAN → Design feature architecture
2. TEST PLAN → Document all test cases
3. For each component:
   ├─ RED → Write failing tests
   ├─ GREEN → Implement minimal code
   ├─ REFACTOR → Improve code
   └─ VERIFY → Run all tests
4. INTEGRATE → Build integration tests
5. VERIFY → Final coverage check
```

## Example Usage

```
User: /tdd-feature Build a user authentication system with email/password login

Agent (tdd-feature-guide):
# TDD Feature: User Authentication System

## Step 1: Requirements Analysis

Clarifying questions:
1. Should we include password reset functionality?
2. Do you need JWT tokens or session-based auth?
3. Should passwords be hashed with bcrypt or argon2?
4. Do you need email verification on signup?

[User answers...]

Requirements confirmed:
- Email/password registration and login
- JWT token-based authentication
- bcrypt password hashing
- Email verification required
- Password reset via email
- Rate limiting on login attempts

## Step 2: Architecture Design

### Components to Build
1. **auth.service.ts** - Core authentication logic
2. **auth.controller.ts** - API endpoints
3. **user.model.ts** - User data model
4. **token.service.ts** - JWT token generation/validation
5. **email.service.ts** - Email sending for verification/reset
6. **validation.ts** - Input validation middleware

### Data Flow
```
User Request → Controller → Validation → Service → Database
                              ↓
                           Email Service (async)
```

### Interfaces
```typescript
interface User {
  id: string
  email: string
  passwordHash: string
  isVerified: boolean
  verificationToken?: string
  resetToken?: string
  resetTokenExpiry?: Date
  createdAt: Date
}

interface AuthTokens {
  accessToken: string
  refreshToken: string
}

interface RegisterInput {
  email: string
  password: string
}

interface LoginInput {
  email: string
  password: string
}
```

## Step 3: Comprehensive Test Plan

### Component 1: auth.service.ts

#### Unit Tests - Happy Path (8 tests)
1. ✅ TODO: register() creates user with hashed password
2. ✅ TODO: register() generates verification token
3. ✅ TODO: register() sends verification email
4. ✅ TODO: login() returns tokens for verified user
5. ✅ TODO: login() validates password correctly
6. ✅ TODO: verifyEmail() activates user account
7. ✅ TODO: requestPasswordReset() generates reset token
8. ✅ TODO: resetPassword() updates password with valid token

#### Unit Tests - Error Path (10 tests)
1. ✅ TODO: register() rejects duplicate email
2. ✅ TODO: register() rejects weak passwords
3. ✅ TODO: register() rejects invalid email format
4. ✅ TODO: login() rejects unverified users
5. ✅ TODO: login() rejects invalid credentials
6. ✅ TODO: login() enforces rate limiting
7. ✅ TODO: verifyEmail() rejects invalid token
8. ✅ TODO: verifyEmail() rejects expired token
9. ✅ TODO: resetPassword() rejects expired token
10. ✅ TODO: resetPassword() rejects weak new password

#### Edge Cases (4 tests)
1. ✅ TODO: register() handles concurrent duplicate registrations
2. ✅ TODO: login() handles deleted user
3. ✅ TODO: verifyEmail() handles already verified user
4. ✅ TODO: resetPassword() invalidates old tokens

### Component 2: token.service.ts

#### Unit Tests (6 tests)
1. ✅ TODO: generateAccessToken() creates valid JWT
2. ✅ TODO: generateRefreshToken() creates valid refresh token
3. ✅ TODO: verifyToken() validates correct token
4. ✅ TODO: verifyToken() rejects expired token
5. ✅ TODO: verifyToken() rejects malformed token
6. ✅ TODO: verifyToken() rejects tampered token

### Component 3: auth.controller.ts

#### Integration Tests (8 tests)
1. ✅ TODO: POST /auth/register creates user and returns 201
2. ✅ TODO: POST /auth/register returns 400 for invalid input
3. ✅ TODO: POST /auth/register returns 409 for duplicate email
4. ✅ TODO: POST /auth/login returns tokens and 200
5. ✅ TODO: POST /auth/login returns 401 for invalid credentials
6. ✅ TODO: POST /auth/verify-email returns 200 on success
7. ✅ TODO: POST /auth/request-reset returns 200 and sends email
8. ✅ TODO: POST /auth/reset-password returns 200 on success

### Integration Tests - Full Flow (4 tests)
1. ✅ TODO: Complete registration → verification → login flow
2. ✅ TODO: Complete password reset flow
3. ✅ TODO: Protected endpoint rejects invalid token
4. ✅ TODO: Protected endpoint accepts valid token

**Total: 40 test cases**

All test cases added to todo list. Starting TDD implementation...

---

## Step 4: Build Component 1 - auth.service.ts

### Phase 1: Define Interface (RED)

```typescript
// src/auth/auth.service.ts
import { User, RegisterInput, LoginInput, AuthTokens } from './types'

export class AuthService {
  async register(input: RegisterInput): Promise<User> {
    throw new Error('Not implemented')
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    throw new Error('Not implemented')
  }

  async verifyEmail(token: string): Promise<void> {
    throw new Error('Not implemented')
  }

  async requestPasswordReset(email: string): Promise<void> {
    throw new Error('Not implemented')
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    throw new Error('Not implemented')
  }
}
```

### Phase 2: Write Tests First (RED)

```typescript
// src/auth/auth.service.test.ts
import { AuthService } from './auth.service'
import { UserRepository } from './user.repository'
import { EmailService } from './email.service'
import { TokenService } from './token.service'

describe('AuthService', () => {
  let authService: AuthService
  let userRepo: jest.Mocked<UserRepository>
  let emailService: jest.Mocked<EmailService>
  let tokenService: jest.Mocked<TokenService>

  beforeEach(() => {
    userRepo = createMockUserRepository()
    emailService = createMockEmailService()
    tokenService = createMockTokenService()
    authService = new AuthService(userRepo, emailService, tokenService)
  })

  describe('register - Happy Path', () => {
    it('creates user with hashed password', async () => {
      const input = {
        email: 'user@example.com',
        password: 'SecurePass123!'
      }

      const user = await authService.register(input)

      expect(user.email).toBe(input.email)
      expect(user.passwordHash).toBeDefined()
      expect(user.passwordHash).not.toBe(input.password) // Password should be hashed
      expect(user.isVerified).toBe(false)
    })

    it('generates verification token', async () => {
      const input = {
        email: 'user@example.com',
        password: 'SecurePass123!'
      }

      const user = await authService.register(input)

      expect(user.verificationToken).toBeDefined()
      expect(user.verificationToken).toMatch(/^[a-f0-9]{64}$/) // 32-byte hex token
    })

    it('sends verification email', async () => {
      const input = {
        email: 'user@example.com',
        password: 'SecurePass123!'
      }

      await authService.register(input)

      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        input.email,
        expect.any(String) // verification token
      )
    })
  })

  describe('register - Error Path', () => {
    it('rejects duplicate email', async () => {
      userRepo.findByEmail.mockResolvedValue(existingUser)

      const input = {
        email: 'existing@example.com',
        password: 'SecurePass123!'
      }

      await expect(authService.register(input)).rejects.toThrow('Email already registered')
    })

    it('rejects weak passwords', async () => {
      const input = {
        email: 'user@example.com',
        password: 'weak'
      }

      await expect(authService.register(input)).rejects.toThrow('Password too weak')
    })

    it('rejects invalid email format', async () => {
      const input = {
        email: 'invalid-email',
        password: 'SecurePass123!'
      }

      await expect(authService.register(input)).rejects.toThrow('Invalid email format')
    })
  })

  describe('login - Happy Path', () => {
    it('returns tokens for verified user', async () => {
      const verifiedUser = createVerifiedUser()
      userRepo.findByEmail.mockResolvedValue(verifiedUser)
      tokenService.generateAccessToken.mockReturnValue('access-token')
      tokenService.generateRefreshToken.mockReturnValue('refresh-token')

      const input = {
        email: 'user@example.com',
        password: 'SecurePass123!'
      }

      const tokens = await authService.login(input)

      expect(tokens.accessToken).toBe('access-token')
      expect(tokens.refreshToken).toBe('refresh-token')
    })

    it('validates password correctly', async () => {
      const user = await createUserWithPassword('SecurePass123!')
      userRepo.findByEmail.mockResolvedValue(user)

      const validInput = {
        email: 'user@example.com',
        password: 'SecurePass123!'
      }

      await expect(authService.login(validInput)).resolves.toBeDefined()

      const invalidInput = {
        email: 'user@example.com',
        password: 'WrongPassword'
      }

      await expect(authService.login(invalidInput)).rejects.toThrow('Invalid credentials')
    })
  })

  describe('login - Error Path', () => {
    it('rejects unverified users', async () => {
      const unverifiedUser = createUnverifiedUser()
      userRepo.findByEmail.mockResolvedValue(unverifiedUser)

      const input = {
        email: 'user@example.com',
        password: 'SecurePass123!'
      }

      await expect(authService.login(input)).rejects.toThrow('Email not verified')
    })

    it('rejects invalid credentials', async () => {
      userRepo.findByEmail.mockResolvedValue(null)

      const input = {
        email: 'nonexistent@example.com',
        password: 'SecurePass123!'
      }

      await expect(authService.login(input)).rejects.toThrow('Invalid credentials')
    })
  })
})
```

### Phase 3: Run Tests - Verify FAIL

```bash
npm test auth.service.test.ts

FAIL src/auth/auth.service.test.ts
  ✕ creates user with hashed password (4 ms)
    Error: Not implemented
  ✕ generates verification token (2 ms)
    Error: Not implemented
  [... all tests fail as expected ...]

0 tests passed, 8 tests failed
```

✅ Tests fail as expected. Ready to implement.

### Phase 4: Implement Minimal Code (GREEN)

```typescript
// src/auth/auth.service.ts
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { User, RegisterInput, LoginInput, AuthTokens } from './types'
import { UserRepository } from './user.repository'
import { EmailService } from './email.service'
import { TokenService } from './token.service'

export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private emailService: EmailService,
    private tokenService: TokenService
  ) {}

  async register(input: RegisterInput): Promise<User> {
    // Validate email format
    if (!this.isValidEmail(input.email)) {
      throw new Error('Invalid email format')
    }

    // Check for duplicate email
    const existing = await this.userRepo.findByEmail(input.email)
    if (existing) {
      throw new Error('Email already registered')
    }

    // Validate password strength
    if (!this.isStrongPassword(input.password)) {
      throw new Error('Password too weak')
    }

    // Hash password
    const passwordHash = await bcrypt.hash(input.password, 10)

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex')

    // Create user
    const user = await this.userRepo.create({
      email: input.email,
      passwordHash,
      isVerified: false,
      verificationToken,
      createdAt: new Date()
    })

    // Send verification email
    await this.emailService.sendVerificationEmail(
      user.email,
      verificationToken
    )

    return user
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    // Find user
    const user = await this.userRepo.findByEmail(input.email)
    if (!user) {
      throw new Error('Invalid credentials')
    }

    // Check if verified
    if (!user.isVerified) {
      throw new Error('Email not verified')
    }

    // Validate password
    const isValid = await bcrypt.compare(input.password, user.passwordHash)
    if (!isValid) {
      throw new Error('Invalid credentials')
    }

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken(user)
    const refreshToken = this.tokenService.generateRefreshToken(user)

    return {
      accessToken,
      refreshToken
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.userRepo.findByVerificationToken(token)
    if (!user) {
      throw new Error('Invalid verification token')
    }

    await this.userRepo.update(user.id, {
      isVerified: true,
      verificationToken: null
    })
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.userRepo.findByEmail(email)
    if (!user) {
      // Don't reveal if email exists
      return
    }

    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenExpiry = new Date(Date.now() + 3600000) // 1 hour

    await this.userRepo.update(user.id, {
      resetToken,
      resetTokenExpiry
    })

    await this.emailService.sendPasswordResetEmail(email, resetToken)
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findByResetToken(token)
    if (!user || !user.resetTokenExpiry) {
      throw new Error('Invalid reset token')
    }

    if (user.resetTokenExpiry < new Date()) {
      throw new Error('Reset token expired')
    }

    if (!this.isStrongPassword(newPassword)) {
      throw new Error('Password too weak')
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)

    await this.userRepo.update(user.id, {
      passwordHash,
      resetToken: null,
      resetTokenExpiry: null
    })
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  private isStrongPassword(password: string): boolean {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special char
    return (
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password)
    )
  }
}
```

### Phase 5: Run Tests - Verify PASS

```bash
npm test auth.service.test.ts

PASS src/auth/auth.service.test.ts
  AuthService
    register - Happy Path
      ✓ creates user with hashed password (45 ms)
      ✓ generates verification token (38 ms)
      ✓ sends verification email (12 ms)
    register - Error Path
      ✓ rejects duplicate email (8 ms)
      ✓ rejects weak passwords (6 ms)
      ✓ rejects invalid email format (5 ms)
    login - Happy Path
      ✓ returns tokens for verified user (42 ms)
      ✓ validates password correctly (89 ms)
    login - Error Path
      ✓ rejects unverified users (11 ms)
      ✓ rejects invalid credentials (10 ms)

10 tests passed
```

✅ All tests passing! Moving to next component...

✅ TODO COMPLETED: All auth.service.ts tests

---

## Step 5: Build Component 2 - token.service.ts

[Repeat TDD cycle: Interface → Tests → Implement → Verify]

---

## Step 6: Build Component 3 - auth.controller.ts

[Repeat TDD cycle with integration tests]

---

## Step 7: Integration Tests

```typescript
// src/auth/auth.integration.test.ts
describe('Authentication Flow - Integration', () => {
  let app: Express
  let db: Database

  beforeAll(async () => {
    app = await createTestApp()
    db = await setupTestDatabase()
  })

  afterAll(async () => {
    await db.close()
  })

  it('completes full registration → verification → login flow', async () => {
    // Register
    const registerRes = await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'SecurePass123!'
      })
      .expect(201)

    expect(registerRes.body).toHaveProperty('userId')

    // Get verification token from email mock
    const verificationToken = getLastSentEmail().token

    // Verify email
    await request(app)
      .post('/auth/verify-email')
      .send({ token: verificationToken })
      .expect(200)

    // Login
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'SecurePass123!'
      })
      .expect(200)

    expect(loginRes.body).toHaveProperty('accessToken')
    expect(loginRes.body).toHaveProperty('refreshToken')

    // Access protected endpoint
    await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200)
  })

  it('completes password reset flow', async () => {
    // Create verified user first
    const user = await createVerifiedUser('test@example.com', 'OldPass123!')

    // Request reset
    await request(app)
      .post('/auth/request-reset')
      .send({ email: 'test@example.com' })
      .expect(200)

    // Get reset token from email mock
    const resetToken = getLastSentEmail().token

    // Reset password
    await request(app)
      .post('/auth/reset-password')
      .send({
        token: resetToken,
        newPassword: 'NewPass456!'
      })
      .expect(200)

    // Login with new password
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'NewPass456!'
      })
      .expect(200)

    expect(loginRes.body).toHaveProperty('accessToken')

    // Old password should not work
    await request(app)
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'OldPass123!'
      })
      .expect(401)
  })
})
```

---

## Step 8: Final Coverage Report

All 40 tests implemented and passing!

```bash
npm test -- --coverage

File                    | % Stmts | % Branch | % Funcs | % Lines
------------------------|---------|----------|---------|--------
auth.service.ts         |   100   |   100    |   100   |   100
token.service.ts        |   96    |   100    |   100   |   96
auth.controller.ts      |   94    |   91     |   100   |   94
user.model.ts           |   100   |   100    |   100   |   100
email.service.ts        |   88    |   75     |   100   |   88
validation.ts           |   100   |   100    |   100   |   100
------------------------|---------|----------|---------|--------
Overall                 |   96    |   94     |   100   |   96

Coverage: 96% ✅ (Target: 90%)
```

✅ Feature complete with comprehensive test coverage!

## Summary

**Feature Built:** User Authentication System
**Components:** 6 modules
**Tests Written:** 40 test cases
**Coverage:** 96%
**Time:** Tests written FIRST for every component

The feature is production-ready with:
- Full test coverage
- Error handling
- Security best practices (password hashing, rate limiting)
- Email verification
- Password reset
- JWT authentication
```

## Key Principles

### 1. Tests Are Specifications
Tests describe **how the software should behave**, not how it's implemented. Write tests as executable specifications that document expected behavior.

**Good (spec-based):**
```typescript
it('returns user profile when given valid user ID', async () => {
  const profile = await getProfile('user-123')
  expect(profile.name).toBe('Alice')
  expect(profile.email).toBe('alice@example.com')
})

it('throws NotFound error when user does not exist', async () => {
  await expect(getProfile('nonexistent')).rejects.toThrow('User not found')
})
```

**Bad (implementation-focused):**
```typescript
it('calls database.query with SELECT statement', async () => {
  await getProfile('user-123')
  expect(database.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?', ['user-123'])
})
```

**Why spec-based?**
- Tests survive refactoring (change implementation, keep behavior)
- Tests read like requirements documentation
- Tests focus on what users/callers care about
- Tests don't break when internal details change

### 2. Tests First, Always
- Write interface/types first
- Write failing tests second
- Implement code third
- Never implement without tests

### 3. Incremental Development
- Build one component at a time
- Verify each component before moving to next
- Integration tests at the end

### 4. Minimal Implementation
- Write just enough code to make tests pass
- Don't add features not covered by tests
- Refactor only after tests are green

### 5. Complete Coverage
- Happy path scenarios
- Error handling
- Edge cases
- Integration between components

## Coverage Requirements

**Minimum: 90% overall coverage**

This 90% requirement includes ALL of the following test types:

1. **Unit Tests - Happy Path**
   - Normal operations with valid inputs
   - Expected successful outcomes
   - Common use cases
   - All public methods called with valid data

2. **Unit Tests - Error States**
   - Invalid inputs and validation failures
   - Exception handling
   - Error messages and error codes
   - Failure scenarios
   - Boundary violations

3. **Integration Tests**
   - API endpoints (request/response cycles)
   - Database operations (CRUD)
   - External service interactions
   - Component-to-component communication
   - End-to-end user flows

**All three categories must be comprehensively covered to reach 90%.**

Missing any category (e.g., only testing happy paths) will result in insufficient coverage and incomplete feature development.

## Best Practices

**DO:**
- ✅ Write tests as behavior specifications ("it should X when Y")
- ✅ Test observable outputs and side effects, not internal implementation
- ✅ Plan architecture before coding
- ✅ Write comprehensive test plan up front
- ✅ Use todos for tracking progress
- ✅ Build one component at a time
- ✅ Run tests after each implementation
- ✅ Test integration points thoroughly
- ✅ Aim for 90%+ coverage including unit happy path, unit error states, and integration tests

**DON'T:**
- ❌ Test implementation details (which methods called, internal state)
- ❌ Mock everything—prefer testing real behavior where practical
- ❌ Skip planning phase
- ❌ Write code before tests
- ❌ Build multiple components in parallel
- ❌ Skip integration tests
- ❌ Ignore test failures
- ❌ Add untested features

## Command Comparison

| Command | Use Case | Approach |
|---------|----------|----------|
| `/tdd` | Single function/component | Write tests → Implement |
| `/tdd-feature` | Complete feature (multiple components) | Plan → Tests → Implement all components |
| `/backfill-tests` | Add tests to existing code | Analyze → Plan → Add tests |

## Integration with Other Commands

- Use `/plan` first if unsure about architecture
- Use `/tdd-feature` to build the feature with tests
- Use `/code-review` to review implementation quality
- Use `/e2e` to add end-to-end tests for critical flows
- Use `/build-fix` if build/test errors occur

## Related Resources

See testing and development guidelines:
- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/skills/tdd/SKILL.md` (for single components)
- `~/.pi/agent/skills/backfill-tests/SKILL.md` (for existing code)
