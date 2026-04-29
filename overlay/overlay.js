(() => {
  const root = document.getElementById('root');
  const collectingEl = document.getElementById('collecting');
  const votingEl = document.getElementById('voting');
  const title = document.getElementById('title');
  const suggestionCount = document.getElementById('suggestion-count');
  const timerFill = document.getElementById('timer-fill');
  const timerText = document.getElementById('timer-text');
  const voteTimerFill = document.getElementById('vote-timer-fill');
  const voteTimerText = document.getElementById('vote-timer-text');
  const titleTimerFill = document.getElementById('title-timer-fill');
  const modeTag = document.getElementById('mode-tag');
  const finalistsEl = document.getElementById('finalists');

  const PHASE_TITLES = {
    collecting: 'CHAT SUGGESTIONS',
    voting: 'THE PEOPLE DECIDE',
    winner: 'THE CHAT PICKED'
  };

  const COLLECT_ENTER_MS = 700;
  const COLLECT_EXIT_MS  = 600;
  const VOTING_ENTER_MS  = 720;
  const VOTING_EXIT_MS   = 620;

  let currentPhase = 'idle';
  let endsAt = null;
  let phaseDurationMs = null;
  let pendingTimers = [];

  function clearPendingTimers() {
    pendingTimers.forEach(clearTimeout);
    pendingTimers = [];
  }
  function later(fn, ms) { const t = setTimeout(fn, ms); pendingTimers.push(t); return t; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- Per-phase show / hide helpers ----
  function isVisible(el) {
    return el.classList.contains('active') ||
           el.classList.contains('entering') ||
           el.classList.contains('leaving');
  }

  function fullyResetVoting() {
    votingEl.classList.remove('entering', 'leaving', 'active', 'winner-mode');
    finalistsEl.querySelectorAll('li').forEach(li => li.classList.remove('is-winner', 'leading'));
  }
  function fullyResetCollecting() {
    collectingEl.classList.remove('entering', 'leaving', 'active');
  }

  function showCollecting() {
    fullyResetCollecting();
    // Forcibly null any in-flight animation so the next 'entering' class always restarts cleanly.
    collectingEl.style.animation = 'none';
    void collectingEl.offsetWidth;       // force reflow so the 'none' takes effect
    collectingEl.style.animation = '';   // clear inline override; CSS rules can apply again
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        collectingEl.classList.add('entering');
      });
    });
    later(() => {
      collectingEl.classList.remove('entering');
      collectingEl.classList.add('active');
    }, COLLECT_ENTER_MS + 30);
  }
  function hideCollecting() {
    // If collecting wasn't actually visible, skip the fade-out (otherwise it flashes
    // because the leaving keyframe starts at opacity 1).
    if (!isVisible(collectingEl)) { fullyResetCollecting(); return; }
    collectingEl.classList.remove('entering');
    collectingEl.classList.add('leaving');
    later(() => {
      collectingEl.classList.remove('leaving', 'active');
    }, COLLECT_EXIT_MS);
  }

  function showVoting() {
    fullyResetVoting();
    votingEl.style.animation = 'none';
    void votingEl.offsetWidth;
    votingEl.style.animation = '';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        votingEl.classList.add('entering');
      });
    });
    later(() => {
      votingEl.classList.remove('entering');
      votingEl.classList.add('active');
    }, VOTING_ENTER_MS + 30);
  }
  function hideVoting() {
    // Same flash-prevention: don't fade out something that wasn't shown.
    if (!isVisible(votingEl)) { fullyResetVoting(); return; }
    votingEl.classList.remove('entering', 'winner-mode');
    votingEl.classList.add('leaving');
    later(() => {
      votingEl.classList.remove('leaving', 'active');
      finalistsEl.querySelectorAll('li').forEach(li => li.classList.remove('is-winner'));
    }, VOTING_EXIT_MS);
  }

  function setRootVisible(visible) {
    root.classList.toggle('hidden', !visible);
  }

  // ---- Render dialogue options ----
  function renderFinalists(snap) {
    const total = snap.voteCounts.reduce((a, b) => a + b, 0);
    const max = Math.max(...snap.voteCounts);
    const items = snap.finalists.map((f, i) => {
      const v = snap.voteCounts[i] || 0;
      const pct = total ? Math.round((v / total) * 100) : 0;
      const leading = v === max && max > 0;
      return `
        <li class="${leading ? 'leading' : ''}" data-idx="${i}">
          <span class="num">${i + 1})</span>${escapeHtml(f.text)}
          <span class="vote-meta">${v} vote${v === 1 ? '' : 's'} · ${pct}%</span>
        </li>
      `;
    }).join('');
    finalistsEl.innerHTML = items;
  }

  function markWinner(snap) {
    if (!snap.winner) return;
    const lis = finalistsEl.querySelectorAll('li');
    lis.forEach(li => {
      const idx = parseInt(li.dataset.idx, 10);
      if (idx === snap.winner.index) {
        li.classList.add('is-winner');
      }
    });
    votingEl.classList.add('winner-mode');
  }

  // ---- Timer tick ----
  function tick() {
    if (currentPhase === 'collecting' || currentPhase === 'voting') {
      const remaining = Math.max(0, (endsAt || 0) - Date.now());
      const pct = phaseDurationMs ? (remaining / phaseDurationMs) * 100 : 0;
      const seconds = Math.ceil(remaining / 1000);
      if (currentPhase === 'collecting') {
        timerFill.style.width = `${pct}%`;
        timerText.textContent = seconds;
      } else {
        voteTimerFill.style.width = `${pct}%`;
        voteTimerText.textContent = seconds;
        if (titleTimerFill) titleTimerFill.style.width = `${pct}%`;
      }
    }
    requestAnimationFrame(tick);
  }

  // ---- Phase transitions ----
  function transition(prev, next, snap) {
    clearPendingTimers();
    currentPhase = next;

    // update timer envelope
    if (snap.endsAt) {
      endsAt = snap.endsAt;
      phaseDurationMs = snap.endsAt - Date.now();
    } else {
      endsAt = null;
      phaseDurationMs = null;
    }

    // From any non-idle phase to idle: hide the active phase, then hide root.
    if (next === 'idle') {
      if (prev === 'collecting') {
        hideCollecting();
        later(() => setRootVisible(false), COLLECT_EXIT_MS + 50);
      } else if (prev === 'voting' || prev === 'winner') {
        hideVoting();
        later(() => setRootVisible(false), VOTING_EXIT_MS + 50);
      } else {
        setRootVisible(false);
      }
      return;
    }

    setRootVisible(true);

    if (next === 'collecting') {
      // Only update the suggestions-panel title when we're entering it.
      title.textContent = PHASE_TITLES.collecting || 'CHAT SUGGESTIONS';
      hideVoting();
      showCollecting();
      return;
    }

    if (next === 'voting') {
      // Slide collecting off, then fade voting in.
      const wasCollecting = prev === 'collecting';
      if (wasCollecting) {
        hideCollecting();
        later(() => {
          renderFinalists(snap);
          showVoting();
        }, COLLECT_EXIT_MS + 60);
      } else {
        renderFinalists(snap);
        showVoting();
      }
      return;
    }

    if (next === 'winner') {
      // Stay on the dialogue layout (already showing). Mark winner and reveal.
      // If we somehow skipped voting (shouldn't happen normally), make voting visible first.
      if (prev !== 'voting') {
        renderFinalists(snap);
        showVoting();
        later(() => markWinner(snap), VOTING_ENTER_MS + 100);
      } else {
        markWinner(snap);
      }
      return;
    }
  }

  function applySnapshot(snap) {
    if (snap.phase !== currentPhase) {
      transition(currentPhase, snap.phase, snap);
    } else if (snap.endsAt && snap.endsAt !== endsAt) {
      endsAt = snap.endsAt;
    }

    // mode tag (small label on the suggestion panel)
    if (modeTag) {
      const m = snap.mode || 'mixed';
      if (m === 'mixed') { modeTag.hidden = true; modeTag.textContent = ''; }
      else { modeTag.hidden = false; modeTag.textContent = `${m} mode`; modeTag.className = `mode-tag ${m}`; }
    }

    // dynamic content per phase (re-render on every snapshot during voting)
    if (snap.phase === 'collecting') {
      suggestionCount.textContent = snap.suggestionCount;
    } else if (snap.phase === 'voting') {
      // Re-render finalists every snapshot to update vote counts;
      // but only if voting layout is the active one (to avoid wiping winner state).
      if (!votingEl.classList.contains('winner-mode')) {
        // Preserve animation state by only updating if finalist list is rendered
        if (finalistsEl.children.length === snap.finalists.length) {
          // update only the changed counts
          const total = snap.voteCounts.reduce((a, b) => a + b, 0);
          const max = Math.max(...snap.voteCounts);
          snap.finalists.forEach((_, i) => {
            const li = finalistsEl.children[i];
            const v = snap.voteCounts[i] || 0;
            const pct = total ? Math.round((v / total) * 100) : 0;
            const leading = v === max && max > 0;
            li.classList.toggle('leading', leading);
            const meta = li.querySelector('.vote-meta');
            if (meta) meta.textContent = `${v} vote${v === 1 ? '' : 's'} · ${pct}%`;
          });
        } else {
          renderFinalists(snap);
        }
      }
    }
  }

  function applyStyleOverride(name, value) {
    if (typeof name !== 'string' || !name.startsWith('--')) return;
    document.documentElement.style.setProperty(name, String(value));
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') applySnapshot(msg.payload);
        else if (msg.type === 'style' && msg.payload) applyStyleOverride(msg.payload.name, msg.payload.value);
      } catch (_e) { /* ignore */ }
    };
    ws.onclose = () => setTimeout(connect, 500);
    ws.onerror = () => ws.close();
  }

  connect();
  tick();
})();
