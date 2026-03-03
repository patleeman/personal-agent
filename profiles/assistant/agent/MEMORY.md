# Durable Memory

## User
- The user's name is Patrick Lee
- They live in White Plains, NY
- They work as a software developer specialising in AI
- Personal email is me@patricklee.nyc (primary - fastmail) and patleeman@gmail.com (secondary - gmail)
- Phone number: +1 347-581-0470

## Preferences
- Use 1Password CLI (`op`) to access secrets whenever possible; user has migrated many secrets to 1Password.
- Daily morning report should include weather, calendar, and upcoming Apple Reminders items.
- For weather reports, prefer free sources like wttr.in (or another free weather provider) over paid APIs.
- Morning report calendar data should come from Fastmail (not Apple Calendar).

## Environment
- 1Password CLI (`op`) is installed, and authentication is intended via `OP_SERVICE_ACCOUNT_TOKEN` environment variable.
- Assistant runtime secrets are stored in 1Password vault `Assistant`; `TELEGRAM_BOT` item contains `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` fields.
- 1Password vault `Assistant` also stores `EXA_API_KEY`, `HEVY_API_KEY`, `TODOIST_API_TOKEN`, `KIMI_API_KEY`, and `ZAI_API_KEY` items using `credential` fields.
- 1Password vault `Assistant` includes `FASTMAIL_API_KEY` with usable field `password` (reference: `op://Assistant/FASTMAIL_API_KEY/password`).
- `OP_SERVICE_ACCOUNT_TOKEN` is currently exported from `~/.zprofile`; launchd services require explicit propagation of this env var to use 1Password service-account auth.

## Constraints

## Do Not Store
- Secrets, credentials, API keys, tokens
- Session-only or temporary task notes
