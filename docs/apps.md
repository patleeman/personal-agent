# Apps

Apps are small, durable web UIs stored in the knowledge base. They wrap a skill or prompt with a form, launch background agent runs, and show run status inside the Personal Agent desktop app.

Use apps when a workflow is repeatable enough to deserve a button instead of another hand-written prompt. They are intentionally simple: static HTML plus the built-in Personal Agent client.

## Storage layout

Apps live under the vault root in `apps/{app-id}/`:

```text
knowledge-base/repo/apps/
  auto-research/
    APP.md
    run.html
```

`APP.md` is the manifest. The app page is ordinary HTML loaded in the Apps view.

```md
---
name: Auto Research
description: Launch overnight optimization sessions and track progress
prompt: '/skill:auto-research'
entry: run.html
---
```

Required manifest fields:

| Field         | Description                                   |
| ------------- | --------------------------------------------- |
| `name`        | Display name in the Apps list                 |
| `description` | Short summary shown on the app card           |
| `prompt`      | Base prompt or skill the app wraps            |
| `entry`       | HTML file to load first, usually `index.html` |

Optional navigation metadata can be added with `nav`. Today it is parsed for app metadata/page counts; app pages should still render their own links or controls when they need multi-page movement.

```yaml
nav:
  - label: Run
    page: run.html
  - label: History
    page: history.html
```

## App page basics

Start from `packages/desktop/server/apps/app-scaffold.html` when creating a new app. Include the component CSS and client script:

```html
<link rel="stylesheet" href="/pa/components.css" />
<script src="/pa/client.js"></script>
```

The client exposes `window.PA` and the `<pa-*>` component library. Use explicit closing tags for custom elements (`<pa-field ...></pa-field>`), not XML-style self-closing tags; HTML does not self-close custom elements.

The usual flow is:

1. Render a `<pa-form>` with `<pa-field>` inputs.
2. Listen for the `pa:run` event from a `<pa-button action="run">`.
3. Assemble a concrete prompt from form values.
4. Call `PA.run({ prompt, source: 'app:{app-id}' })`.
5. Subscribe with `PA.onStatus(runId, handler)` and update status/results.

Minimal example:

```html
<pa-card title="Run research">
  <pa-form id="research-form">
    <pa-field label="Goal" name="goal" type="text" placeholder="Reduce bundle size"></pa-field>
    <pa-button action="run" variant="primary">Start</pa-button>
  </pa-form>
</pa-card>

<pa-card title="Status" style="margin-top: 16px">
  <pa-status id="run-status" status="idle"></pa-status>
</pa-card>

<script>
  document.addEventListener('pa:run', async (event) => {
    const { form, button } = event.detail;
    const values = form.getValues();
    const status = document.getElementById('run-status');
    const prompt = `/skill:auto-research goal: ${values.goal}`;

    button.setLoading(true);
    status.setStatus('running', 'Starting run...');

    try {
      const { runId } = await PA.run({ prompt, source: 'app:auto-research' });
      status.setStatus('running', `Run started: ${runId}`);
      PA.onStatus(runId, (event) => {
        const run = event.detail?.run;
        const runStatus = run?.status?.status || run?.status || 'unknown';
        status.setStatus(runStatus, runStatus);
      });
    } catch (error) {
      status.setStatus('error', error.message);
    } finally {
      button.setLoading(false);
    }
  });
</script>
```

## Built-in client API

`/pa/client.js` provides:

| API                          | Description                                             |
| ---------------------------- | ------------------------------------------------------- |
| `PA.run({ prompt, source })` | Starts a durable background agent run                   |
| `PA.getRun(runId)`           | Fetches the latest run snapshot                         |
| `PA.onStatus(runId, fn)`     | Subscribes to run updates over SSE; returns unsubscribe |
| `PA.navigate(page)`          | Emits a `pa:navigate` event for app-local handling      |

Run requests are handled by `POST /api/runs`. They create durable runs with source metadata `{ type: 'app', id: appId }` and task slug `app-{appId}`.

## Components

The component library is deliberately small:

| Component               | Use                                           |
| ----------------------- | --------------------------------------------- |
| `<pa-card>`             | Section container with optional `title`       |
| `<pa-form>`             | Form wrapper with `getValues()`               |
| `<pa-field>`            | Text, number, textarea, toggle/checkbox input |
| `<pa-button>`           | Run button and loading state                  |
| `<pa-status>`           | Status badge/message                          |
| `<pa-table>`            | Simple tabular results                        |
| `<pa-chart>`            | Lightweight chart rendering                   |
| `.pa-row` / `.pa-stack` | Layout helper classes                         |

Prefer one focused page with a form and a status/results area. Do not build a mini product unless the workflow actually needs it. Tiny hammer, tiny nail.

## Discovery and viewing

The desktop app lists apps from `GET /api/apps`, which scans the vault `apps/` directory for subdirectories containing `APP.md` manifests. Apps appear in the top-level **Apps** page and in the Workbench Apps rail.

If an app does not appear:

- Confirm the directory is under the configured vault root: `knowledge-base/repo/apps/{app-id}/`.
- Confirm `APP.md` has YAML frontmatter bounded by `---`.
- Confirm `entry` points to an existing HTML file in the same app directory.
- Refresh the Apps page.

## Security and constraints

Apps are local desktop app surfaces, not hosted services. They should not contain secrets. If a workflow needs credentials, use existing Personal Agent auth, MCP, provider, or settings flows instead of hard-coding tokens in app HTML.

Keep app pages static and self-contained. Use the provided `/pa/client.js` APIs for agent work rather than inventing new local HTTP routes unless the product feature truly needs them.
