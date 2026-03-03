# Durable Memory

## User
- The user's name is Patrick Lee
- They live in White Plains, NY
- They work as a software developer specialising in AI
- Personal email is me@patricklee.nyc (primary) and patleeman@gmail.com (secondary)
- Stores shopping list in Todoist. All other reminders/tasks use Apple Reminders.

## Preferences
- For Todoist integration, use direct API calls (curl/HTTP) rather than assuming a Todoist CLI.
- When asked to take notes, use Apple Notes.
- Checkpoint workflow should always push after committing.
- Stores shopping list in Todoist.
- For time-based reminders or follow-up check-ins, prefer using personal-agent scheduled tasks (daemon) rather than Apple Reminders.
- They want a recurring daily weather task at 7am (White Plains, NY) for today's weather plus the next 3 days, using personal-agent scheduled tasks.

## Environment

## Constraints
- Gateway background service installs should also provision and keep personal-agentd running.

## Do Not Store
- Secrets, credentials, API keys, tokens
- Session-only or temporary task notes

## Workspace
- The agent's workspace root is `~/agent-workspace`.###
