/**
 * PA client — injected into artifact sandbox for skill apps.
 *
 * Provides window.PA (run, getRun, onStatus, navigate)
 * and <pa-*> custom elements (pa-form, pa-field, pa-button, pa-card, etc.)
 *
 * This is served as a static JS bundle at GET /pa/client.js
 * and can also be injected inline into artifact srcDoc HTML.
 */

export const PA_CLIENT_JS: string = `
(function() {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  const activeSSE = new Map();
  const extensionIdFromPath = (() => {
    const match = window.location.pathname.match(new RegExp('^/api/extensions/([^/]+)/files/'));
    return match ? decodeURIComponent(match[1]) : null;
  })();

  // ── PA client ──────────────────────────────────────────────────────────────
  window.PA = {
    /**
     * Start a new run.
     * @param {Object} opts
     * @param {string} opts.prompt - Assembled prompt string
     * @param {string} [opts.source] - Source identifier (e.g. 'app:auto-research')
     * @returns {Promise<{runId: string}>}
     */
    async run(opts) {
      const body = { prompt: opts.prompt };
      if (opts.source) body.source = opts.source;
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Failed to start run');
      }
      return res.json();
    },

    /**
     * Get a run snapshot.
     * @param {string} runId
     * @returns {Promise<Object>}
     */
    async getRun(runId) {
      const res = await fetch('/api/runs/' + encodeURIComponent(runId));
      if (!res.ok) throw new Error('Run not found');
      return res.json();
    },

    /**
     * Subscribe to run status events via SSE.
     * @param {string} runId
     * @param {function} handler - Called with each event object
     * @returns {function} unsubscribe
     */
    onStatus(runId, handler) {
      if (activeSSE.has(runId)) {
        activeSSE.get(runId).handlers.add(handler);
        return () => { activeSSE.get(runId).handlers.delete(handler); };
      }

      const state = { handlers: new Set([handler]), eventSource: null, closed: false };
      activeSSE.set(runId, state);

      function connect() {
        if (state.closed) return;
        const es = new EventSource('/api/runs/' + encodeURIComponent(runId) + '/events?tail=120');
        state.eventSource = es;

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            for (const h of state.handlers) {
              try { h(data); } catch (_) { /* ignore handler errors */ }
            }
          } catch (_) { /* ignore parse errors */ }
        };

        es.onerror = () => {
          es.close();
          if (!state.closed) {
            setTimeout(connect, 2000);
          }
        };
      }

      connect();

      return () => {
        state.handlers.delete(handler);
        if (state.handlers.size === 0) {
          state.closed = true;
          state.eventSource?.close();
          activeSSE.delete(runId);
        }
      };
    },

    extension: {
      invoke(actionId, input) {
        var extensionId = extensionIdFromPath;
        if (!extensionId) throw new Error('Extension id is unavailable');
        return requestJson('/api/extensions/' + encodeURIComponent(extensionId) + '/actions/' + encodeURIComponent(actionId), { method: 'POST', body: input || {} });
      },
      listCommands() { return requestJson('/api/extensions/commands'); },
      listSlashCommands() { return requestJson('/api/extensions/slash-commands'); }
    },

    runs: {
      start(input) {
        var extensionId = extensionIdFromPath;
        if (!extensionId) throw new Error('Extension id is unavailable');
        return requestJson('/api/extensions/' + encodeURIComponent(extensionId) + '/runs', { method: 'POST', body: input || {} });
      },
      get(runId) { return requestJson('/api/runs/' + encodeURIComponent(runId)); },
      list() { return requestJson('/api/runs'); },
      readLog(runId, tail) { return requestJson('/api/runs/' + encodeURIComponent(runId) + '/log' + (tail ? '?tail=' + encodeURIComponent(tail) : '')); },
      cancel(runId) { return requestJson('/api/runs/' + encodeURIComponent(runId) + '/cancel', { method: 'POST' }); }
    },

    vault: {
      read(path) { return requestJson('/api/vault/file?id=' + encodeURIComponent(path)); },
      write(path, content) { return requestJson('/api/vault/file', { method: 'PUT', body: { id: path, content: content } }); },
      list(path) { return requestJson('/api/vault/tree' + (path ? '?dir=' + encodeURIComponent(path) : '')); },
      search(query) { return requestJson('/api/vault/search?q=' + encodeURIComponent(query)); }
    },

    conversations: {
      list() { return requestJson('/api/sessions'); },
      get(conversationId, opts) {
        var tail = opts && opts.tailBlocks ? '?tailBlocks=' + encodeURIComponent(opts.tailBlocks) : '';
        return requestJson('/api/sessions/' + encodeURIComponent(conversationId) + tail);
      },
      getMeta(conversationId) { return requestJson('/api/sessions/' + encodeURIComponent(conversationId) + '/meta'); },
      searchIndex(sessionIds) { return requestJson('/api/sessions/search-index', { method: 'POST', body: { sessionIds: sessionIds || [] } }); }
    },

    storage: {
      get(key) {
        var extensionId = extensionIdFromPath;
        if (!extensionId) throw new Error('Extension id is unavailable');
        return requestJson('/api/extensions/' + encodeURIComponent(extensionId) + '/state/' + encodeStateKey(key));
      },
      put(key, value, opts) {
        var extensionId = extensionIdFromPath;
        if (!extensionId) throw new Error('Extension id is unavailable');
        return requestJson('/api/extensions/' + encodeURIComponent(extensionId) + '/state/' + encodeStateKey(key), { method: 'PUT', body: { value: value, expectedVersion: opts && opts.expectedVersion } });
      },
      delete(key) {
        var extensionId = extensionIdFromPath;
        if (!extensionId) throw new Error('Extension id is unavailable');
        return requestJson('/api/extensions/' + encodeURIComponent(extensionId) + '/state/' + encodeStateKey(key), { method: 'DELETE' });
      },
      list(prefix) {
        var extensionId = extensionIdFromPath;
        if (!extensionId) throw new Error('Extension id is unavailable');
        var suffix = prefix ? '?prefix=' + encodeURIComponent(prefix) : '';
        return requestJson('/api/extensions/' + encodeURIComponent(extensionId) + '/state' + suffix);
      }
    },

    automations: {
      list() { return requestJson('/api/tasks'); },
      get(taskId) { return requestJson('/api/tasks/' + encodeURIComponent(taskId)); },
      create(input) { return requestJson('/api/tasks', { method: 'POST', body: input }); },
      update(taskId, input) { return requestJson('/api/tasks/' + encodeURIComponent(taskId), { method: 'PATCH', body: input }); },
      delete(taskId) { return requestJson('/api/tasks/' + encodeURIComponent(taskId), { method: 'DELETE' }); },
      run(taskId) { return requestJson('/api/tasks/' + encodeURIComponent(taskId) + '/run', { method: 'POST' }); },
      readLog(taskId) { return requestJson('/api/tasks/' + encodeURIComponent(taskId) + '/log'); },
      readSchedulerHealth() { return requestJson('/api/tasks/scheduler-health'); }
    },

    /**
     * Navigate to another app page.
     * @param {string} page - e.g. 'history.html'
     */
    navigate(page) {
      const event = new CustomEvent('pa:navigate', { detail: { page } });
      window.dispatchEvent(event);
    }
  };

  function encodeStateKey(key) {
    return String(key || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }

  async function requestJson(path, opts) {
    const init = opts || {};
    const fetchOpts = { method: init.method || 'GET', headers: { ...(init.headers || {}) } };
    if (init.body !== undefined) {
      fetchOpts.headers['Content-Type'] = fetchOpts.headers['Content-Type'] || 'application/json';
      fetchOpts.body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    }
    const res = await fetch(path, fetchOpts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  }

  // ── Helper: emit a custom event ────────────────────────────────────────────
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ── <pa-card> ──────────────────────────────────────────────────────────────
  class PaCard extends HTMLElement {
    connectedCallback() {
      if (this._mountScheduled || this._mounted) return;
      this._mountScheduled = true;
      setTimeout(() => this.mount(), 0);
    }

    mount() {
      if (this._mounted) return;
      this._mounted = true;
      if (!this.style.display) this.style.display = 'block';

      const title = this.getAttribute('title') || '';
      const children = Array.from(this.childNodes);
      const card = document.createElement('div');
      card.className = 'pa-card';

      if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'pa-card-title';
        titleEl.textContent = title;
        card.appendChild(titleEl);
      }

      const body = document.createElement('div');
      body.className = 'pa-card-body';
      for (const child of children) body.appendChild(child);
      card.appendChild(body);

      this.replaceChildren(card);
    }
  }

  // ── <pa-form> ──────────────────────────────────────────────────────────────
  class PaForm extends HTMLElement {
    connectedCallback() {
      this.classList.add('pa-form');
      this.addEventListener('submit', (e) => e.preventDefault());
    }

    /** Collect field values by name */
    getValues() {
      const fields = this.querySelectorAll('pa-field');
      const values = {};
      for (const field of fields) {
        const name = field.getAttribute('name');
        if (name) values[name] = field.getValue();
      }
      return values;
    }

    /** Set loading state on all buttons */
    setLoading(loading) {
      const buttons = this.querySelectorAll('pa-button');
      for (const btn of buttons) btn.setLoading(loading);
    }
  }

  // ── <pa-field> ─────────────────────────────────────────────────────────────
  class PaField extends HTMLElement {
    connectedCallback() {
      const label = this.getAttribute('label') || '';
      const name = this.getAttribute('name') || '';
      const type = this.getAttribute('type') || 'text';
      const placeholder = this.getAttribute('placeholder') || '';
      const value = this.getAttribute('value') || '';
      const help = this.getAttribute('help') || '';

      let input = '';
      if (type === 'toggle' || type === 'checkbox') {
        input = '<label class="pa-field-toggle">' +
          '<input type="checkbox" name="' + escapeAttr(name) + '" ' + (value === 'true' ? 'checked' : '') + '>' +
          '<span class="pa-toggle-track"></span>' +
          '<span class="pa-toggle-label">' + escapeHtml(label) + '</span>' +
          '</label>';
        this.innerHTML = '<div class="pa-field pa-field-toggle-wrap">' + input +
          (help ? '<p class="pa-field-help">' + escapeHtml(help) + '</p>' : '') +
          '</div>';
        return;
      }

      if (type === 'textarea') {
        input = '<textarea name="' + escapeAttr(name) + '" placeholder="' + escapeAttr(placeholder) + '" class="pa-input pa-textarea">' +
          escapeHtml(value) + '</textarea>';
      } else {
        input = '<input type="' + escapeAttr(type) + '" name="' + escapeAttr(name) + '" value="' + escapeAttr(value) + '" placeholder="' + escapeAttr(placeholder) + '" class="pa-input">';
      }

      this.innerHTML = '<div class="pa-field">' +
        '<label class="pa-field-label">' + escapeHtml(label) + '</label>' +
        input +
        (help ? '<p class="pa-field-help">' + escapeHtml(help) + '</p>' : '') +
        '</div>';
    }

    getValue() {
      const type = this.getAttribute('type') || 'text';
      if (type === 'toggle' || type === 'checkbox') {
        const cb = this.querySelector('input[type="checkbox"]');
        return cb ? cb.checked : false;
      }
      const input = this.querySelector('input, textarea');
      return input ? input.value : '';
    }
  }

  // ── <pa-button> ────────────────────────────────────────────────────────────
  class PaButton extends HTMLElement {
    connectedCallback() {
      if (this._mountScheduled || this._mounted) return;
      this._mountScheduled = true;
      setTimeout(() => this.mount(), 0);
    }

    mount() {
      if (this._mounted) return;
      this._mounted = true;

      const action = this.getAttribute('action') || '';
      const variant = this.getAttribute('variant') || 'primary';
      const text = this.textContent.trim() || 'Submit';
      this.innerHTML = '<button class="pa-btn pa-btn-' + escapeAttr(variant) + '" data-action="' + escapeAttr(action) + '">' +
        '<span class="pa-btn-text">' + escapeHtml(text) + '</span>' +
        '<span class="pa-btn-spinner" style="display:none">\\u23F3</span>' +
        '</button>';

      this.querySelector('button')?.addEventListener('click', (e) => {
        if (this.hasAttribute('loading')) return;
        if (action === 'run') {
          const form = this.closest('pa-form');
          if (form) {
            emit('pa:run', { form, button: this });
          }
        } else {
          emit('pa:action', { action, button: this });
        }
      });
    }

    setLoading(loading) {
      const btn = this.querySelector('button');
      const text = this.querySelector('.pa-btn-text');
      const spinner = this.querySelector('.pa-btn-spinner');
      if (!btn) return;
      if (loading) {
        btn.setAttribute('disabled', '');
        if (text) text.style.display = 'none';
        if (spinner) spinner.style.display = 'inline';
      } else {
        btn.removeAttribute('disabled');
        if (text) text.style.display = 'inline';
        if (spinner) spinner.style.display = 'none';
      }
    }
  }

  // ── <pa-spinner> ───────────────────────────────────────────────────────────
  class PaSpinner extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<div class="pa-spinner"><div class="pa-spinner-dot"></div></div>';
    }
  }

  // ── <pa-status> ────────────────────────────────────────────────────────────
  class PaStatus extends HTMLElement {
    connectedCallback() {
      const status = this.getAttribute('status') || 'idle';
      this.innerHTML = '<div class="pa-status pa-status-' + escapeAttr(status) + '">' +
        '<span class="pa-status-dot"></span>' +
        '<span class="pa-status-text"></span>' +
        '</div>';
      this._textEl = this.querySelector('.pa-status-text');
    }

    setStatus(status, text) {
      this.setAttribute('status', status);
      this.className = 'pa-status pa-status-' + escapeAttr(status);
      if (this._textEl) this._textEl.textContent = text || '';
    }
  }

  // ── <pa-table> ─────────────────────────────────────────────────────────────
  class PaTable extends HTMLElement {
    connectedCallback() {
      const columns = this.getAttribute('columns') || '';
      const colNames = columns.split(',').map(s => s.trim()).filter(Boolean);
      this.innerHTML = '<div class="pa-table-wrap">' +
        '<table class="pa-table">' +
        '<thead><tr>' + colNames.map(c => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr></thead>' +
        '<tbody></tbody>' +
        '</table></div>';
      this._tbody = this.querySelector('tbody');
      this._colCount = colNames.length;
    }

    setData(rows) {
      if (!this._tbody) return;
      this._tbody.innerHTML = rows.map(row => {
        const cells = Array.isArray(row) ? row : [String(row)];
        return '<tr>' + cells.map(c => '<td>' + escapeHtml(String(c ?? '')) + '</td>').join('') + '</tr>';
      }).join('');
    }
  }

  // ── <pa-chart> ─────────────────────────────────────────────────────────────
  class PaChart extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<div class="pa-chart-container"><canvas class="pa-chart-canvas"></canvas></div>';
    }

    /** Simple bar/line chart using canvas.
     *  @param {Object} opts - { labels: string[], datasets: { label, data, color }[], type: 'bar'|'line' }
     */
    setChart(opts) {
      const canvas = this.querySelector('canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = this.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width || 400;
      const h = rect.height || 200;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(dpr, dpr);

      const padding = { top: 20, right: 20, bottom: 40, left: 50 };
      const chartW = w - padding.left - padding.right;
      const chartH = h - padding.top - padding.bottom;

      ctx.clearRect(0, 0, w, h);

      const labels = opts.labels || [];
      const datasets = opts.datasets || [];
      if (!labels.length || !datasets.length) return;

      // find max
      let maxVal = 0;
      for (const ds of datasets) {
        for (const v of ds.data) if (v > maxVal) maxVal = v;
      }
      maxVal = Math.ceil(maxVal * 1.1) || 1;

      // Draw Y axis labels
      ctx.fillStyle = '#999';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      const ySteps = 4;
      for (let i = 0; i <= ySteps; i++) {
        const val = (maxVal / ySteps) * i;
        const y = padding.top + chartH - (chartH / ySteps) * i;
        ctx.fillText(Math.round(val).toString(), padding.left - 6, y + 4);
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
      }

      const barWidth = chartW / labels.length * 0.6;
      const gap = chartW / labels.length * 0.4;

      for (let di = 0; di < datasets.length; di++) {
        const ds = datasets[di];
        const color = ds.color || '#4f8cff';
        const data = ds.data;

        if (opts.type === 'line') {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < data.length; i++) {
            const x = padding.left + (chartW / (data.length - 1 || 1)) * i;
            const y = padding.top + chartH - (data[i] / maxVal) * chartH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        } else {
          for (let i = 0; i < data.length; i++) {
            const x = padding.left + (chartW / labels.length) * i + gap / 2 + (barWidth * di) / datasets.length;
            const barH = (data[i] / maxVal) * chartH;
            const y = padding.top + chartH - barH;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, barWidth / datasets.length, barH);
          }
        }
      }

      // X axis labels
      ctx.fillStyle = '#999';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (let i = 0; i < labels.length; i++) {
        const x = padding.left + (chartW / labels.length) * i + chartW / labels.length / 2;
        ctx.fillText(labels[i], x, h - 8);
      }
    }
  }

  // ── Register custom elements ───────────────────────────────────────────────
  const elements = [
    ['pa-card', PaCard],
    ['pa-form', PaForm],
    ['pa-field', PaField],
    ['pa-button', PaButton],
    ['pa-spinner', PaSpinner],
    ['pa-status', PaStatus],
    ['pa-table', PaTable],
    ['pa-chart', PaChart],
  ];
  for (const [tag, cls] of elements) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str ?? '');
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    if (typeof str !== 'string') return String(str ?? '');
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
`.trim();

export const PA_CLIENT_CONTENT_TYPE = 'application/javascript';
export const PA_CLIENT_CACHE_MAX_AGE = 300; // 5 minutes
