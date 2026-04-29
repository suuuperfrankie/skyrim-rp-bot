(() => {
  const stepNum = document.getElementById('step-num');
  const steps = Array.from(document.querySelectorAll('.step'));

  function go(n) {
    steps.forEach(s => s.classList.toggle('active', s.dataset.step === String(n)));
    stepNum.textContent = n;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

  // Generic copy buttons (next to URL/code blocks)
  document.querySelectorAll('.copy-target').forEach(target => {
    const btn = target.querySelector('.copy-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(target.dataset.copy || target.querySelector('code')?.textContent || '');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = orig), 1400);
      } catch (_e) { btn.textContent = 'Copy failed'; }
    });
  });

  // External links: open in the OS default browser via the bot's backend
  // (the dashboard runs in Edge --app mode, where target="_blank" still opens in Edge,
  //  not the user's preferred browser, so we route through cmd `start`).
  async function openInDefaultBrowser(url) {
    try {
      await fetch('/api/open-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
    } catch (_e) {
      // last-ditch fallback: use the regular window.open which at least opens *something*
      window.open(url, '_blank', 'noopener');
    }
  }
  document.querySelectorAll('.ext-link').forEach(a => {
    a.addEventListener('click', (e) => {
      const url = a.dataset.url || a.getAttribute('href');
      if (url && url !== '#') {
        e.preventDefault();
        openInDefaultBrowser(url);
      }
    });
  });

  // Copy buttons next to external links
  document.querySelectorAll('.link-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.copy;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = orig), 1400);
      } catch (_e) { btn.textContent = 'Copy failed'; }
    });
  });

  // Step 3: save config
  const clientIdInput = document.getElementById('client-id');
  const channelInput = document.getElementById('channel');
  const cfgError = document.getElementById('config-error');
  document.getElementById('save-config').addEventListener('click', async () => {
    cfgError.textContent = '';
    const clientId = clientIdInput.value.trim();
    const channel = channelInput.value.trim().replace(/^#/, '');
    if (!clientId)  { cfgError.textContent = 'Paste your Twitch Client ID first.'; return; }
    if (!channel)   { cfgError.textContent = 'Enter your channel name.'; return; }
    try {
      const r = await fetch('/api/setup/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, channel })
      });
      const j = await r.json();
      if (!j.ok) { cfgError.textContent = j.message || 'Save failed.'; return; }
      go(4);
    } catch (e) {
      cfgError.textContent = `Save failed: ${e.message}`;
    }
  });

  // Step 4: device flow
  const startBtn = document.getElementById('start-auth');
  const authPre = document.getElementById('auth-pre');
  const authProgress = document.getElementById('auth-progress');
  const authSuccess = document.getElementById('auth-success');
  const userCodeEl = document.getElementById('user-code');
  const verifyLink = document.getElementById('verify-link');
  const authStatusEl = document.getElementById('auth-status');
  const authLoginEl = document.getElementById('auth-login');

  let pollHandle = null;
  function showSuccess(login) {
    authPre.classList.add('hidden');
    authProgress.classList.add('hidden');
    authSuccess.classList.remove('hidden');
    authLoginEl.textContent = login || '(connected)';
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
      const r = await fetch('/api/setup/start-auth', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) {
        authStatusEl.textContent = `Failed: ${j.message || 'unknown'}`;
        startBtn.disabled = false;
        return;
      }
      if (j.alreadyAuthorized) {
        showSuccess(j.login);
        return;
      }
      userCodeEl.textContent = j.userCode;
      verifyLink.href = j.verificationUri;
      verifyLink.dataset.url = j.verificationUri;
      verifyLink.textContent = j.verificationUri.replace(/^https?:\/\//, '') + ' ↗';
      const copyVerify = document.getElementById('copy-verify');
      if (copyVerify) copyVerify.dataset.copy = j.verificationUri;
      authPre.classList.add('hidden');
      authProgress.classList.remove('hidden');
      // poll status
      const poll = async () => {
        try {
          const sr = await fetch('/api/setup/auth-status');
          const sj = await sr.json();
          if (sj.status === 'ok') { showSuccess(sj.login); return; }
          if (sj.status === 'expired') {
            authStatusEl.textContent = 'Code expired - go back and request a new one.';
            return;
          }
        } catch (_e) {}
        pollHandle = setTimeout(poll, 2000);
      };
      poll();
    } catch (e) {
      authStatusEl.textContent = `Failed: ${e.message}`;
      startBtn.disabled = false;
    }
  });

  document.getElementById('copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(userCodeEl.textContent);
      const btn = document.getElementById('copy-code');
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = 'Copy'), 1400);
    } catch (_e) {}
  });

  // Step 5: finish
  document.getElementById('finish').addEventListener('click', () => {
    location.href = '/';
  });

  // On load, check current state and skip steps that are already done
  (async () => {
    try {
      const r = await fetch('/api/setup/state');
      const s = await r.json();
      if (s.hasConfig && s.hasTokens) { location.href = '/'; return; }
      if (s.hasConfig) {
        clientIdInput.value = '(saved)';
        clientIdInput.disabled = true;
        channelInput.value = s.channel || '';
        channelInput.disabled = true;
        go(4);
      }
    } catch (_e) {}
  })();
})();
