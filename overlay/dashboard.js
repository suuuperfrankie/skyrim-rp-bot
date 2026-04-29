(() => {
  const els = {
    pill: document.getElementById('conn-pill'),
    channel: document.getElementById('status-channel'),
    phase: document.getElementById('status-phase'),
    time: document.getElementById('status-time'),
    auto: document.getElementById('status-auto'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    btnForceVote: document.getElementById('btn-force-vote'),
    btnTest: document.getElementById('btn-test'),
    btnCopy: document.getElementById('btn-copy'),
    obsUrl: document.getElementById('obs-url'),
    roundInfo: document.getElementById('round-info'),
    lastWinner: document.getElementById('last-winner'),
    log: document.getElementById('log'),
    autoscroll: document.getElementById('autoscroll'),
    btnClearLog: document.getElementById('btn-clear-log')
  };

  const LS_LAST_WINNER = 'skyrim-rp-bot:last-winner';
  let lastSnap = null;
  let endsAt = null;
  let lastSeenWinnerKey = null;   // de-dupe storing the same winner repeatedly

  // Display the OBS URL masked, but keep the real value on a data attribute for the Copy button.
  const realObsUrl = `${location.origin}/overlay/`;
  els.obsUrl.dataset.realUrl = realObsUrl;
  els.obsUrl.textContent = realObsUrl.replace(/[^/:.]/g, '*');

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour12: false });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function setConnected(yes) {
    els.pill.textContent = yes ? 'connected' : 'disconnected';
    els.pill.classList.toggle('connected', yes);
    els.pill.classList.toggle('disconnected', !yes);
  }

  // --- Tabs ---
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(`tab-${btn.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });

  // --- Log ---
  function appendLog(entry) {
    const div = document.createElement('div');
    div.className = `entry ${entry.level}`;
    div.innerHTML = `<span class="ts">${fmtTime(entry.time)}</span>${escapeHtml(entry.msg)}`;
    els.log.appendChild(div);
    while (els.log.children.length > 500) els.log.firstChild.remove();
    if (els.autoscroll.checked) els.log.scrollTop = els.log.scrollHeight;
  }

  // --- Status / round rendering ---
  function renderStatus(snap) {
    if (!snap) return;
    els.phase.textContent = snap.phase;
    els.phase.className = `phase-badge ${snap.phase}`;
    if (snap.endsAt) endsAt = snap.endsAt;
    else { endsAt = null; els.time.textContent = '-'; }
    // Force Voting only valid during collecting phase, with at least one suggestion.
    if (els.btnForceVote) {
      els.btnForceVote.disabled = !(snap.phase === 'collecting' && (snap.suggestionCount || 0) >= 1);
    }
  }

  function renderRound(snap) {
    if (!snap || snap.phase === 'idle') {
      els.roundInfo.innerHTML = '<p class="empty">No round running. Click <b>Start Round</b> or type <code>!rp</code> in chat.</p>';
      return;
    }
    if (snap.phase === 'collecting') {
      els.roundInfo.innerHTML = `
        <div class="collecting-state">
          <div class="num">${snap.suggestionCount}</div>
          <div class="label">suggestion${snap.suggestionCount === 1 ? '' : 's'} so far</div>
        </div>`;
      return;
    }
    if (snap.phase === 'voting') {
      const total = snap.voteCounts.reduce((a, b) => a + b, 0);
      const max = Math.max(...snap.voteCounts);
      const rows = snap.finalists.map((f, i) => {
        const v = snap.voteCounts[i] || 0;
        const pct = total ? Math.round((v / total) * 100) : 0;
        const leading = v === max && max > 0;
        return `
          <div class="finalist-row ${leading ? 'leading' : ''}">
            <span class="num">${i + 1}</span>
            <span class="text">${escapeHtml(f.text)}</span>
            <span class="vbar"><span style="width:${pct}%"></span></span>
            <span class="votes">${v} · ${pct}%</span>
          </div>`;
      }).join('');
      els.roundInfo.innerHTML = rows;
      return;
    }
    if (snap.phase === 'winner' && snap.winner) {
      const v = snap.winner.votes;
      els.roundInfo.innerHTML = `
        <div class="winner-card">
          <div class="label">Winner</div>
          <div class="text">${escapeHtml(snap.winner.text)}</div>
          <div class="meta">${v} vote${v === 1 ? '' : 's'}${snap.winner.tieBroken === 'random' ? ' · tiebreak' : ''}</div>
        </div>`;
    }
  }

  function renderLastWinner() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_LAST_WINNER) || 'null'); } catch (_e) {}
    if (!saved) {
      els.lastWinner.innerHTML = '<p class="empty">Waiting for the first round to finish.</p>';
      return;
    }
    const t = new Date(saved.at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
    els.lastWinner.innerHTML = `
      <div class="row-card">
        <span class="text">${escapeHtml(saved.text)}</span>
        <span class="meta">${saved.votes} vote${saved.votes === 1 ? '' : 's'} · ${escapeHtml(t)}</span>
      </div>`;
  }

  function maybeStoreWinner(snap) {
    if (!snap || snap.phase !== 'winner' || !snap.winner) return;
    const key = `${snap.winner.text}::${snap.winner.votes}::${snap.endsAt || ''}`;
    if (key === lastSeenWinnerKey) return;
    lastSeenWinnerKey = key;
    const record = {
      text: snap.winner.text,
      votes: snap.winner.votes,
      at: Date.now()
    };
    try { localStorage.setItem(LS_LAST_WINNER, JSON.stringify(record)); } catch (_e) {}
    renderLastWinner();
  }

  function tick() {
    if (endsAt) {
      const remaining = Math.max(0, endsAt - Date.now());
      els.time.textContent = `${Math.ceil(remaining / 1000)}s`;
    }
    requestAnimationFrame(tick);
  }
  tick();

  // --- API ---
  async function fetchStatus() {
    try {
      const r = await fetch('/api/status');
      const s = await r.json();
      els.channel.textContent = `#${s.channel || 'unknown'}`;
      els.auto.textContent = s.autoMode ? 'ON' : 'OFF';
      const tog = document.getElementById('status-chat-toggle');
      const lab = document.getElementById('status-chat-label');
      if (tog) {
        tog.checked = s.chatMessagesEnabled !== false;
        if (lab) lab.textContent = tog.checked ? 'on' : 'off';
      }
    } catch (_e) {}
  }
  // Wire the chat-message toggle once; the initial state is set by fetchStatus().
  (() => {
    const tog = document.getElementById('status-chat-toggle');
    const lab = document.getElementById('status-chat-label');
    if (!tog) return;
    tog.addEventListener('change', async () => {
      try {
        const r = await fetch('/api/chat-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: tog.checked })
        });
        const j = await r.json();
        if (j.ok && lab) lab.textContent = j.chatMessagesEnabled ? 'on' : 'off';
      } catch (e) {
        appendLog({ time: Date.now(), level: 'error', msg: `[dashboard] chat toggle failed: ${e.message}` });
      }
    });
  })();
  async function callAction(path) {
    try {
      const r = await fetch(`/api/${path}`, { method: 'POST' });
      return await r.json();
    } catch (e) {
      appendLog({ time: Date.now(), level: 'error', msg: `[dashboard] action ${path} failed: ${e.message}` });
    }
  }

  els.btnStart.addEventListener('click', () => callAction('start'));
  els.btnStop.addEventListener('click', () => callAction('stop'));
  els.btnForceVote.addEventListener('click', async () => {
    const r = await callAction('force-voting');
    if (r && r.ok === false) {
      appendLog({ time: Date.now(), level: 'warn', msg: `[dashboard] force voting rejected: ${r.message || 'unknown'}` });
    }
  });
  els.btnTest.addEventListener('click', async () => {
    if (els.btnTest.classList.contains('running')) return;
    els.btnTest.classList.add('running');
    els.btnTest.textContent = '⚙  Testing…';
    const r = await callAction('test');
    if (r && r.ok === false) {
      els.btnTest.classList.remove('running');
      els.btnTest.textContent = '⚙  Test Overlay';
      appendLog({ time: Date.now(), level: 'warn', msg: `[dashboard] test rejected: ${r.message || 'unknown reason'}` });
      return;
    }
    // total test duration ≈ 4 + 6 + 6 = 16s
    setTimeout(() => {
      els.btnTest.classList.remove('running');
      els.btnTest.textContent = '⚙  Test Overlay';
    }, 16500);
  });
  els.btnCopy.addEventListener('click', async () => {
    try {
      // Use the real URL stored on data-real-url, not the masked text content.
      await navigator.clipboard.writeText(els.obsUrl.dataset.realUrl || els.obsUrl.textContent);
      els.btnCopy.textContent = 'Copied!';
      setTimeout(() => (els.btnCopy.textContent = 'Copy'), 1500);
    } catch (_e) {
      els.btnCopy.textContent = 'Copy failed';
      setTimeout(() => (els.btnCopy.textContent = 'Copy'), 1500);
    }
  });
  els.btnClearLog.addEventListener('click', () => { els.log.innerHTML = ''; });

  // ----- Settings tab -----
  const SETTINGS_FIELDS = [
    { k: 'collectionSeconds',       l: 'Suggestion phase duration',  hint: 'How long the !suggest window is open. Bot announces this in chat.', type: 'int', min: 5,  max: 600 },
    { k: 'votingSeconds',           l: 'Voting phase duration',      hint: 'How long chat has to type 1/2/3.',                                  type: 'int', min: 5,  max: 300 },
    { k: 'winnerDisplaySeconds',    l: 'Winner display duration',    hint: 'How long the winning option stays glowing on screen.',              type: 'int', min: 1,  max: 120 },
    { k: 'finalistsCount',          l: 'Number of finalists',        hint: 'How many suggestions move to the voting round.',                    type: 'int', min: 1,  max: 5 },
    { k: 'maxSuggestionLength',     l: 'Max suggestion length',      hint: 'Trim user suggestions longer than this.',                           type: 'int', min: 20, max: 500 },
    { k: 'autoMode',                l: 'Auto-mode (auto-start rounds)', hint: 'Bot starts a new round on its own. Restart bot for a change to take effect.', type: 'bool' },
    { k: 'autoModeCooldownSeconds', l: 'Auto-mode cooldown',         hint: 'Seconds between auto-started rounds. Restart bot to apply.',         type: 'int', min: 10, max: 3600 }
  ];

  async function loadSettings() {
    try {
      const r = await fetch('/api/settings');
      const s = await r.json();
      const form = document.getElementById('settings-form');
      form.innerHTML = SETTINGS_FIELDS.map(f => {
        const v = s[f.k];
        let input;
        if (f.type === 'bool') {
          input = `<input type="checkbox" id="set-${f.k}" ${v ? 'checked' : ''} />`;
        } else {
          input = `<input type="number" id="set-${f.k}" min="${f.min}" max="${f.max}" value="${v}" />`;
        }
        return `
          <div class="set-row">
            <div>
              <label class="set-label" for="set-${f.k}">${f.l}</label>
              <span class="set-hint">${f.hint}</span>
            </div>
            ${input}
          </div>`;
      }).join('');

      SETTINGS_FIELDS.forEach(f => {
        const el = document.getElementById(`set-${f.k}`);
        el.addEventListener('change', () => {
          const value = f.type === 'bool' ? el.checked : parseInt(el.value, 10);
          saveSetting(f.k, value, el);
        });
      });
    } catch (e) {
      const status = document.getElementById('settings-status');
      if (status) { status.textContent = `Failed to load settings: ${e.message}`; status.className = 'hint error'; }
    }
  }
  async function saveSetting(key, value, inputEl) {
    const status = document.getElementById('settings-status');
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      const j = await r.json();
      if (!j.ok) {
        status.textContent = `${(j.errors || ['save failed']).join(', ')}`;
        status.className = 'hint error';
        return;
      }
      status.textContent = `Saved ${key} = ${value}`;
      status.className = 'hint ok';
      setTimeout(() => { if (status.textContent.startsWith('Saved')) { status.textContent = ''; status.className = 'hint'; } }, 1800);
    } catch (e) {
      status.textContent = `Save failed: ${e.message}`;
      status.className = 'hint error';
    }
  }
  loadSettings();

  // ----- Roleplay mode toggle -----
  let currentMode = 'mixed';
  function renderModeButtons() {
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === currentMode);
    });
  }
  async function setMode(m) {
    try {
      const r = await fetch(`/api/mode/${encodeURIComponent(m)}`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) { currentMode = j.mode; renderModeButtons(); }
    } catch (_e) {}
  }
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  // pull current mode on load
  fetch('/api/mode').then(r => r.json()).then(j => {
    if (j.ok) { currentMode = j.mode; renderModeButtons(); }
  }).catch(() => {});

  // ----- Stream Deck / hotkey URL list -----
  function renderStreamDeckUrls() {
    const list = document.getElementById('streamdeck-urls');
    if (!list) return;
    const base = location.origin;
    const rows = [
      ['Start Round',   `${base}/api/start`],
      ['Stop Round',    `${base}/api/stop`],
      ['Force Voting',  `${base}/api/force-voting`],
      ['Mode: Mixed',   `${base}/api/mode/mixed`],
      ['Mode: Serious', `${base}/api/mode/serious`],
      ['Mode: Funny',   `${base}/api/mode/funny`]
    ];
    list.innerHTML = rows.map(([label, url]) => `
      <div class="row">
        <label>${label}</label>
        <code>${url}</code>
        <button class="btn btn-mini" data-url="${url}">Copy</button>
      </div>`).join('');
    list.querySelectorAll('button[data-url]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.url);
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => (btn.textContent = orig), 1300);
        } catch (_e) {}
      });
    });
  }
  renderStreamDeckUrls();

  // ----- Customize tab -----
  // Each entry: cssVariable, label, min, max, step, unit, default
  const CUSTOMIZE_FIELDS = [
    // Voting panel position
    { v: '--voting-offset-x',           l: 'Voting panel offset X',      min: -500, max: 500,  step: 1,    unit: 'px',  def: 0 },
    { v: '--voting-offset-y',           l: 'Voting panel offset Y',      min: -500, max: 500,  step: 1,    unit: 'px',  def: 0 },
    // Voting / dialogue
    { v: '--voting-title-font-size',    l: 'Voting title font size',     min: 0.6, max: 4.0,   step: 0.05, unit: 'rem', def: 1.5 },
    { v: '--voting-title-margin-top',   l: 'Voting title space above',   min: 0,   max: 12,    step: 0.1,  unit: 'rem', def: 7 },
    { v: '--voting-title-padding-left', l: 'Voting title padding-left',  min: 0,   max: 16,    step: 0.1,  unit: 'rem', def: 6.5 },
    { v: '--voting-title-stroke',       l: 'Voting title stroke (px)',   min: 0,   max: 12,    step: 0.5,  unit: 'px',  def: 3 },
    { v: '--voting-title-timer-right',  l: 'Title timer right margin',   min: 0,   max: 16,    step: 0.1,  unit: 'rem', def: 8 },
    { v: '--finalist-font-size',        l: 'Finalist font size',         min: 0.8, max: 4.0,   step: 0.05, unit: 'rem', def: 2 },
    { v: '--finalist-letter-spacing',   l: 'Finalist letter spacing',    min: -0.05, max: 0.5, step: 0.005, unit: 'em',  def: 0 },
    { v: '--finalist-padding-top',      l: 'Finalist padding-top (align option 1 with ornament)', min: 0, max: 400, step: 1, unit: 'px', def: 95 },
    { v: '--finalist-padding-left',     l: 'Finalist padding-left',      min: 0,   max: 250,   step: 1,    unit: 'px',  def: 90 },
    { v: '--finalist-stroke',           l: 'Finalist stroke (px)',       min: 0,   max: 12,    step: 0.5,  unit: 'px',  def: 3 },
    { v: '--png-height',                l: 'Dialogue PNG height',        min: 30,  max: 200,   step: 1,    unit: 'vh',  def: 105 },
    { v: '--png-brightness',            l: 'Dialogue PNG brightness',    min: 0.2, max: 1.5,   step: 0.05, unit: '',    def: 0.8 },
    { v: '--png-contrast',              l: 'Dialogue PNG contrast',      min: 0.5, max: 3.0,   step: 0.05, unit: '',    def: 1.7 },
    // Suggestions / collecting panel
    { v: '--card-opacity',                       l: 'Suggestion card opacity',           min: 0,   max: 1,    step: 0.05, unit: '',    def: 0.95 },
    { v: '--titlebox-opacity',                   l: 'Suggestion title box opacity',      min: 0,   max: 1,    step: 0.05, unit: '',    def: 1 },
    { v: '--suggestions-title-font-size',        l: 'Suggestion title font size',        min: 0.6, max: 3.0,  step: 0.05, unit: 'rem', def: 1.4 },
    { v: '--suggestions-instruction-font-size',  l: 'Suggestion instruction font size',  min: 0.6, max: 3.0,  step: 0.05, unit: 'rem', def: 1.5 },
    { v: '--suggestions-count-font-size',        l: 'Suggestion count number size',      min: 1.0, max: 5.0,  step: 0.05, unit: 'rem', def: 2.6 },
    { v: '--suggestions-count-label-font-size',  l: 'Suggestion count label size',       min: 0.5, max: 2.0,  step: 0.05, unit: 'rem', def: 0.95 },
    { v: '--suggestions-title-margin-bottom',    l: 'Suggestion title-box gap below',    min: 0,   max: 6,    step: 0.05, unit: 'rem', def: 1.2 }
  ];
  const LS_CUSTOMIZE = 'skyrim-rp-bot:customize';

  function loadCustomize() {
    try { return JSON.parse(localStorage.getItem(LS_CUSTOMIZE) || '{}'); } catch (_e) { return {}; }
  }
  function saveCustomize(values) {
    try { localStorage.setItem(LS_CUSTOMIZE, JSON.stringify(values)); } catch (_e) {}
  }
  let customizeValues = loadCustomize();

  function valueFor(field) {
    return customizeValues[field.v] !== undefined ? customizeValues[field.v] : field.def;
  }
  function formatValue(field, num) {
    const stepStr = String(field.step);
    const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
    return Number(num).toFixed(decimals).replace(/\.0+$/, '') + field.unit;
  }
  function formatNumberOnly(field, num) {
    const stepStr = String(field.step);
    const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
    return Number(num).toFixed(decimals);
  }

  // outbound WS for live updates (separate small client; the main connect() socket is read-mostly)
  let styleWs = null;
  function ensureStyleWs() {
    if (styleWs && (styleWs.readyState === WebSocket.OPEN || styleWs.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    styleWs = new WebSocket(`${proto}://${location.host}/ws`);
    styleWs.onopen = () => {
      // push current customize values so the overlay matches
      for (const f of CUSTOMIZE_FIELDS) {
        const v = valueFor(f);
        sendStyleUpdate(f.v, formatValue(f, v));
      }
    };
    styleWs.onclose = () => { styleWs = null; setTimeout(ensureStyleWs, 800); };
    styleWs.onerror = () => styleWs && styleWs.close();
  }
  function sendStyleUpdate(name, value) {
    if (!styleWs || styleWs.readyState !== WebSocket.OPEN) return;
    try { styleWs.send(JSON.stringify({ type: 'style', payload: { name, value } })); } catch (_e) {}
  }
  ensureStyleWs();

  function renderCustomize() {
    const form = document.getElementById('customize-form');
    if (!form) return;
    form.innerHTML = CUSTOMIZE_FIELDS.map((f, i) => {
      const v = valueFor(f);
      return `
        <div class="cust-row" data-i="${i}">
          <label class="cust-label" for="cust-${i}">${f.l}</label>
          <input class="cust-input" type="range" id="cust-${i}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" />
          <input class="cust-value" type="text" id="cust-val-${i}" value="${formatNumberOnly(f, v)}${f.unit}" />
        </div>`;
    }).join('');

    // wire up listeners
    CUSTOMIZE_FIELDS.forEach((f, i) => {
      const slider = document.getElementById(`cust-${i}`);
      const text = document.getElementById(`cust-val-${i}`);
      slider.addEventListener('input', () => {
        const num = parseFloat(slider.value);
        text.value = `${formatNumberOnly(f, num)}${f.unit}`;
        applyAndSave(f, num);
      });
      text.addEventListener('change', () => {
        const m = String(text.value).match(/-?\d+(\.\d+)?/);
        if (!m) { text.value = `${formatNumberOnly(f, valueFor(f))}${f.unit}`; return; }
        let num = parseFloat(m[0]);
        if (num < f.min) num = f.min;
        if (num > f.max) num = f.max;
        slider.value = num;
        text.value = `${formatNumberOnly(f, num)}${f.unit}`;
        applyAndSave(f, num);
      });
    });
  }
  function applyAndSave(f, num) {
    customizeValues[f.v] = num;
    saveCustomize(customizeValues);
    sendStyleUpdate(f.v, formatValue(f, num));
  }
  renderCustomize();

  document.getElementById('customize-reset').addEventListener('click', () => {
    customizeValues = {};
    saveCustomize(customizeValues);
    renderCustomize();
    // push every default to the overlay
    for (const f of CUSTOMIZE_FIELDS) sendStyleUpdate(f.v, formatValue(f, f.def));
  });
  document.getElementById('customize-test').addEventListener('click', () => callAction('test'));

  // ----- Cogwheel menu -----
  const cogBtn = document.getElementById('cog-btn');
  const cogMenu = document.getElementById('cog-menu');
  const cogVersion = document.getElementById('cog-version');
  const cogUpdate = document.getElementById('cog-update');
  const cogReleases = document.getElementById('cog-releases');
  const cogReset = document.getElementById('cog-reset');
  let appInfo = { version: '?', githubLatestUrl: '', githubReleasesPage: '#' };

  async function loadAppInfo() {
    try {
      const r = await fetch('/api/app-info');
      appInfo = await r.json();
      cogVersion.textContent = appInfo.version;
      if (appInfo.githubReleasesPage) cogReleases.href = appInfo.githubReleasesPage;
      // In packaged distribution builds, hide the Customize tab and its content.
      if (appInfo.packaged) {
        const tab = document.querySelector('.tab[data-tab="customize"]');
        const content = document.getElementById('tab-customize');
        if (tab) tab.style.display = 'none';
        if (content) content.style.display = 'none';
      }
    } catch (_e) {}
  }
  loadAppInfo();

  cogBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cogMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!cogMenu.contains(e.target) && e.target !== cogBtn) cogMenu.classList.add('hidden');
  });

  cogUpdate.addEventListener('click', async (e) => {
    e.preventDefault();
    cogUpdate.textContent = 'Checking…';
    try {
      const r = await fetch(appInfo.githubLatestUrl);
      if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
      const j = await r.json();
      const latest = (j.tag_name || '').replace(/^v/, '');
      if (!latest) throw new Error('no tag_name in response');
      if (cmpVersion(latest, appInfo.version) > 0) {
        cogUpdate.textContent = `Update available: v${latest}`;
        cogUpdate.title = j.html_url || '';
        appendLog({ time: Date.now(), level: 'info', msg: `[update] new version available: v${latest}` });
      } else {
        cogUpdate.textContent = 'Up to date ✓';
        setTimeout(() => (cogUpdate.textContent = 'Check for Updates'), 2500);
      }
    } catch (err) {
      cogUpdate.textContent = 'Check failed';
      appendLog({ time: Date.now(), level: 'warn', msg: `[update] check failed: ${err.message}. (Edit src/server.js → githubLatestUrl once you have a real repo.)` });
      setTimeout(() => (cogUpdate.textContent = 'Check for Updates'), 2500);
    }
  });

  function cmpVersion(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  cogReset.addEventListener('click', () => {
    if (confirm('Re-run setup wizard? Your current settings will stay until you save new ones.')) {
      location.href = '/setup';
    }
  });

  // --- WS ---
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { setConnected(true); fetchStatus(); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') {
          lastSnap = msg.payload;
          renderStatus(msg.payload);
          renderRound(msg.payload);
          maybeStoreWinner(msg.payload);
        } else if (msg.type === 'log') {
          appendLog(msg.payload);
        } else if (msg.type === 'log_history') {
          for (const e of msg.payload) appendLog(e);
        }
      } catch (_e) {}
    };
    ws.onclose = () => { setConnected(false); setTimeout(connect, 800); };
    ws.onerror = () => ws.close();
  }

  // initial render of stored last winner
  renderLastWinner();
  connect();
  fetchStatus();
})();
