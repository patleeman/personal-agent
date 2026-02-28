---
name: security-review
description: Perform comprehensive security audit of codebase. Scan for OWASP Top 10 vulnerabilities, hardcoded secrets, input validation issues, and authentication flaws. Generate prioritized findings with fixes.
---

# Security Review

Perform a systematic security audit of the codebase.

## Scope

Scan for:
1. **Hardcoded secrets** - API keys, passwords, tokens, private keys
2. **Injection vulnerabilities** - SQL, NoSQL, command, path traversal
3. **Authentication/Authorization** - Missing auth, weak passwords, broken access control
4. **XSS vulnerabilities** - Unsanitized HTML, DOM manipulation
5. **Data protection** - Sensitive data exposure, insecure storage
6. **API security** - Missing rate limiting, excessive data exposure
7. **CSRF protection** - Missing tokens, unsafe state changes
8. **Security misconfigurations** - Insecure defaults, verbose errors

## Workflow

### 1. Scan Codebase

Search for common vulnerability patterns:

**Secret patterns:**
```regex
# API keys
(sk|pk)_[a-zA-Z0-9]{32,}
api[_-]?key['"]\s*[:=]\s*['"][^'"]{20,}

# AWS credentials
AKIA[0-9A-Z]{16}

# Private keys
-----BEGIN (RSA |EC )?PRIVATE KEY-----

# Hardcoded passwords
password['"]\s*[:=]\s*['"][^'"]{8,}
```

**SQL injection:**
```typescript
// Vulnerable patterns
db.query(`SELECT * FROM ${table}`)
query("... WHERE id = '" + id + "'")
```

**Missing authentication:**
```typescript
// Check admin routes lack auth middleware
app.delete('/admin/...')
app.post('/api/admin/...')
```

**XSS vulnerabilities:**
```typescript
// React
dangerouslySetInnerHTML
// Vanilla JS
innerHTML = userInput
document.write(userInput)
```

### 2. Categorize by Severity

**🔴 CRITICAL** - Fix immediately (24 hours)
- Hardcoded secrets in code/config
- SQL injection vulnerabilities
- Missing auth on admin/destructive endpoints
- Command injection

**🟠 HIGH** - Fix within 1 week
- XSS vulnerabilities
- Missing rate limiting on auth endpoints
- Insecure session management
- Broken access control

**🟡 MEDIUM** - Fix within 1 month
- Missing security headers
- Weak input validation
- Information disclosure
- Insecure file uploads

**🟢 LOW** - Fix when convenient
- Verbose error messages
- Missing logging
- Outdated dependencies (no known exploits)

### 3. Report Format

For each finding:
```markdown
### 🔴 CRITICAL: [Short description]
**File:** `path/to/file.ts:123`

**Vulnerable Code:**
[code snippet]

**Risk:** [What can an attacker do?]

**Fix:**
[secure code example]

**Action Items:**
- [ ] TODO: [specific fix]
- [ ] TODO: [test to add]
```

### 4. Create Todos

Add each security issue as a todo item for tracking.

### 5. Prioritization Summary

Group by priority:
- **Immediate** (CRITICAL) - Fix today
- **This Week** (HIGH) - Schedule this week
- **This Month** (MEDIUM/LOW) - Add to backlog

## Common Vulnerabilities & Fixes

### Hardcoded Secrets
```typescript
// VULNERABLE
const API_KEY = "sk-proj-abc123"

// SECURE
const API_KEY = process.env.OPENAI_API_KEY
if (!API_KEY) throw new Error('OPENAI_API_KEY not set')
```

**Actions:** Rotate key, move to env var, add to .gitignore, scan git history

### SQL Injection
```typescript
// VULNERABLE
db.query(`SELECT * FROM users WHERE id = '${id}'`)

// SECURE - Parameterized query
db.query('SELECT * FROM users WHERE id = ?', [id])

// SECURE - ORM
User.findByPk(id)
```

### Missing Authentication
```typescript
// VULNERABLE
app.delete('/admin/users/:id', async (req, res) => {
  await User.destroy({ where: { id: req.params.id } })
})

// SECURE
app.delete('/admin/users/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    await User.destroy({ where: { id: req.params.id } })
  }
)
```

### XSS
```typescript
// VULNERABLE
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// SECURE - Plain text
<div>{userInput}</div>

// SECURE - Sanitized
import DOMPurify from 'dompurify'
<div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(userInput)
}} />
```

### Rate Limiting
```typescript
import rateLimit from 'express-rate-limit'

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5, // 5 attempts
  message: 'Too many attempts, try again later'
})

app.post('/auth/login', loginLimiter, loginHandler)
```

## Scan Strategy

1. **Search for patterns** using Grep tool across codebase
2. **Read suspicious files** to confirm vulnerabilities
3. **Check auth on sensitive routes** (admin, delete, update endpoints)
4. **Review user input handling** (forms, API endpoints, query params)
5. **Check for secrets** in config files, constants, environment setup

## Focus Areas

**High-risk files:**
- `config/`, `constants/` - secrets
- `api/`, `routes/`, `controllers/` - injection, auth
- `auth/`, `login/`, `session/` - authentication
- Components rendering user input - XSS

**Critical endpoints:**
- Admin routes
- Authentication (login, register, password reset)
- Data modification (create, update, delete)
- File uploads
- Payment processing

## Additional Checks

Run automated tools:
```bash
npm audit --audit-level=high
npm outdated
```

Check for:
- Missing HTTPS enforcement
- Insecure cookie settings
- Missing CORS configuration
- Verbose error messages leaking info
- Debug mode enabled in production

## Output

Provide:
1. **Executive summary** - Total findings by severity
2. **Critical findings first** - Detailed with fixes
3. **Grouped findings** - By category (secrets, injection, auth, etc.)
4. **Action plan** - Prioritized remediation steps
5. **All todos created** - For tracking

## References

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Security guidelines: `~/.pi/agent/AGENTS.md`
