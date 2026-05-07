const state = {
  tasks: [],
  selectedId: null,
  logFor: null,
};

const els = {
  refresh: document.getElementById('refresh'),
  newTask: document.getElementById('new-task'),
  notice: document.getElementById('notice'),
  health: document.getElementById('health'),
  editor: document.getElementById('editor'),
  editorEyebrow: document.getElementById('editor-eyebrow'),
  editorTitle: document.getElementById('editor-title'),
  closeEditor: document.getElementById('close-editor'),
  form: document.getElementById('task-form'),
  deleteTask: document.getElementById('delete-task'),
  tasks: document.getElementById('tasks'),
  count: document.getElementById('count'),
};

function showNotice(message, tone = 'info') {
  els.notice.textContent = message;
  els.notice.className = `notice ${tone}`;
  els.notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    els.notice.hidden = true;
  }, 5000);
}

function taskName(task) {
  return (task.title || '').trim() || task.id;
}

function statusClass(task) {
  if (task.running) return 'running';
  if (!task.enabled) return 'disabled';
  if (task.lastStatus === 'failed' || task.lastStatus === 'failure') return 'failed';
  if (task.lastStatus === 'success') return 'success';
  return '';
}

function statusText(task) {
  if (task.running) return 'Running';
  if (!task.enabled) return 'Disabled';
  if (task.lastStatus === 'failed' || task.lastStatus === 'failure') return 'Needs attention';
  if (task.lastStatus === 'success') return 'Active';
  return task.cron || task.at ? 'Scheduled' : 'Manual';
}

function scheduleText(task) {
  if (task.cron) return `Cron ${task.cron}`;
  if (task.at) return `Once ${task.at}`;
  return 'Manual';
}

function taskRank(task) {
  if (task.running) return 0;
  if (task.lastStatus === 'failed' || task.lastStatus === 'failure') return 1;
  if (task.enabled) return 2;
  return 3;
}

function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) =>
      taskRank(a) - taskRank(b) ||
      String(b.lastRunAt || '').localeCompare(String(a.lastRunAt || '')) ||
      taskName(a).localeCompare(taskName(b)),
  );
}

function compactPrompt(prompt) {
  const text = String(prompt || '').trim();
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = busy ? 'Working…' : label;
}

async function load() {
  try {
    const [tasks, health] = await Promise.all([window.PA.automations.list(), window.PA.automations.readSchedulerHealth()]);
    state.tasks = Array.isArray(tasks) ? sortTasks(tasks) : [];
    renderHealth(health);
    renderTasks();
  } catch (error) {
    showNotice(`Failed to load automations: ${error.message}`, 'error');
  }
}

function renderHealth(health) {
  if (!health || !health.lastEvaluatedAt) {
    els.health.textContent = 'Scheduler has not checked automations yet.';
    return;
  }
  const checked = new Date(health.lastEvaluatedAt);
  const label = Number.isFinite(checked.getTime()) ? checked.toLocaleString() : health.lastEvaluatedAt;
  els.health.textContent =
    health.status === 'stale' ? `Scheduler stale. Last checked ${label}.` : `Scheduler healthy. Last checked ${label}.`;
}

function renderTasks() {
  els.count.textContent = state.tasks.length === 1 ? '1 automation' : `${state.tasks.length} automations`;
  if (state.tasks.length === 0) {
    els.tasks.innerHTML = '<div class="empty">No automations yet.</div>';
    return;
  }

  els.tasks.replaceChildren(...state.tasks.map(renderTask));
}

function renderTask(task) {
  const article = document.createElement('article');
  article.className = 'task';
  article.dataset.taskId = task.id;

  const main = document.createElement('div');
  main.className = 'row-main';

  const body = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'task-title';
  title.innerHTML = `<span class="dot ${statusClass(task)}"></span><h3>${escapeHtml(taskName(task))}</h3>`;
  const meta = document.createElement('p');
  meta.className = 'details';
  meta.textContent = `${statusText(task)} · ${scheduleText(task)} · ${task.targetType === 'conversation' ? 'Thread' : 'Job'}${task.cwd ? ` · ${task.cwd}` : ''}`;
  const prompt = document.createElement('p');
  prompt.className = 'prompt';
  prompt.textContent = compactPrompt(task.prompt);
  body.append(title, meta, prompt);

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(
    actionButton('Run', () => runTask(task.id)),
    actionButton(task.enabled ? 'Disable' : 'Enable', () => toggleTask(task.id, !task.enabled)),
    actionButton('Edit', () => openEditor(task.id)),
    actionButton(state.logFor === task.id ? 'Hide log' : 'Log', () => toggleLog(task.id, article)),
  );

  main.append(body, actions);
  article.append(main);
  if (state.logFor === task.id) {
    void renderLog(task.id, article);
  }
  return article;
}

function actionButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function runTask(id) {
  try {
    await window.PA.automations.run(id);
    showNotice('Automation run started.');
    await load();
  } catch (error) {
    showNotice(`Could not run automation: ${error.message}`, 'error');
  }
}

async function toggleTask(id, enabled) {
  try {
    await window.PA.automations.update(id, { enabled });
    await load();
  } catch (error) {
    showNotice(`Could not update automation: ${error.message}`, 'error');
  }
}

async function toggleLog(id, article) {
  state.logFor = state.logFor === id ? null : id;
  if (state.logFor === id) await renderLog(id, article);
  renderTasks();
}

async function renderLog(id, article) {
  let pre = article.querySelector('.log');
  if (!pre) {
    pre = document.createElement('pre');
    pre.className = 'log';
    article.append(pre);
  }
  pre.textContent = 'Loading log…';
  try {
    const result = await window.PA.automations.readLog(id);
    pre.textContent = result.log || 'No log yet.';
  } catch (error) {
    pre.textContent = `No log available: ${error.message}`;
  }
}

function openEditor(id = null) {
  state.selectedId = id;
  const task = id ? state.tasks.find((item) => item.id === id) : null;
  els.editor.hidden = false;
  els.editorEyebrow.textContent = task ? task.id : 'New automation';
  els.editorTitle.textContent = task ? 'Edit automation' : 'Create automation';
  els.deleteTask.hidden = !task;
  fillForm(task);
  els.editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function closeEditor() {
  state.selectedId = null;
  els.editor.hidden = true;
  els.form.reset();
  els.form.enabled.checked = true;
}

function fillForm(task) {
  els.form.reset();
  els.form.enabled.checked = task ? task.enabled !== false : true;
  els.form.title.value = task?.title || '';
  els.form.prompt.value = task?.prompt || '';
  els.form.scheduleType.value = task?.at ? 'at' : 'cron';
  els.form.cron.value = task?.cron || (task?.at ? '' : '0 9 * * 1-5');
  els.form.at.value = task?.at || '';
  els.form.cwd.value = task?.cwd || '';
  els.form.targetType.value = task?.targetType || 'background-agent';
  els.form.threadMode.value = task?.threadMode || 'dedicated';
  els.form.threadConversationId.value = task?.threadConversationId || '';
  els.form.model.value = task?.model || '';
  els.form.timeoutSeconds.value = task?.timeoutSeconds || '';
  els.form.catchUpWindowSeconds.value = task?.catchUpWindowSeconds || '';
}

function readForm() {
  const scheduleType = els.form.scheduleType.value;
  return pruneEmpty({
    title: els.form.title.value.trim(),
    enabled: els.form.enabled.checked,
    prompt: els.form.prompt.value.trim(),
    cron: scheduleType === 'cron' ? els.form.cron.value.trim() : null,
    at: scheduleType === 'at' ? els.form.at.value.trim() : null,
    cwd: els.form.cwd.value.trim() || null,
    targetType: els.form.targetType.value,
    threadMode: els.form.threadMode.value,
    threadConversationId: els.form.threadConversationId.value.trim() || null,
    model: els.form.model.value.trim() || null,
    timeoutSeconds: numberOrNull(els.form.timeoutSeconds.value),
    catchUpWindowSeconds: numberOrNull(els.form.catchUpWindowSeconds.value),
  });
}

function pruneEmpty(input) {
  const next = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== '') next[key] = value;
  }
  return next;
}

function numberOrNull(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

async function saveForm(event) {
  event.preventDefault();
  const submit = els.form.querySelector('button[type="submit"]');
  setBusy(submit, true, 'Save automation');
  try {
    const input = readForm();
    if (state.selectedId) {
      await window.PA.automations.update(state.selectedId, input);
      showNotice('Automation updated.');
    } else {
      await window.PA.automations.create(input);
      showNotice('Automation created.');
    }
    closeEditor();
    await load();
  } catch (error) {
    showNotice(`Could not save automation: ${error.message}`, 'error');
  } finally {
    setBusy(submit, false, 'Save automation');
  }
}

async function deleteSelected() {
  if (!state.selectedId) return;
  if (!window.confirm(`Delete ${state.selectedId}?`)) return;
  try {
    await window.PA.automations.delete(state.selectedId);
    showNotice('Automation deleted.');
    closeEditor();
    await load();
  } catch (error) {
    showNotice(`Could not delete automation: ${error.message}`, 'error');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

els.refresh.addEventListener('click', load);
els.newTask.addEventListener('click', () => openEditor());
els.closeEditor.addEventListener('click', closeEditor);
els.form.addEventListener('submit', saveForm);
els.deleteTask.addEventListener('click', deleteSelected);
void load();
