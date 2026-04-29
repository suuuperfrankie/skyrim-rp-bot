import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { appPath } from './paths.js';
import { loadConfig, saveConfig, loadTokens, saveTokens } from './config.js';
import {
  startDeviceFlow,
  pollOnceForToken,
  validateToken,
  tryExistingTokens
} from './auth.js';

const MAX_LOG_BUFFER = 300;

function captureConsole(onLog) {
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const wrap = (level) => (...args) => {
    const msg = args
      .map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
      .join(' ');
    onLog(level, msg);
    orig[level](...args);
  };
  console.log = wrap('log');
  console.info = wrap('info');
  console.warn = wrap('warn');
  console.error = wrap('error');
}

export function createServer({ config: initialConfig, state }) {
  const app = express();
  const overlayDir = appPath('overlay');
  const assetsDir = appPath('assets');

  app.use(express.json());

  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  });

  app.use('/overlay', express.static(overlayDir));
  app.use('/assets', express.static(assetsDir));

  // ----- Setup wizard / dashboard routing -----
  // We need a runtime check on each request so the wizard activates on first run
  // and disappears once setup is complete.
  let liveConfig = initialConfig;
  let liveTokens = null;
  let liveLogin = null;
  let botReady = false;

  function isFullyConfigured() {
    return !!(liveConfig.clientId && liveConfig.channel && liveTokens?.access_token);
  }

  app.get('/', (_req, res) => {
    if (!isFullyConfigured()) return res.redirect('/setup');
    res.sendFile(path.join(overlayDir, 'dashboard.html'));
  });
  app.get('/setup', (_req, res) => res.sendFile(path.join(overlayDir, 'setup.html')));
  app.get('/setup.css', (_req, res) => res.sendFile(path.join(overlayDir, 'setup.css')));
  app.get('/setup.js', (_req, res) => res.sendFile(path.join(overlayDir, 'setup.js')));
  app.get('/dashboard.css', (_req, res) => res.sendFile(path.join(overlayDir, 'dashboard.css')));
  app.get('/dashboard.js', (_req, res) => res.sendFile(path.join(overlayDir, 'dashboard.js')));

  // ----- App-level status / version -----
  let appVersion = '0.0.0';
  (async () => {
    try {
      // package.json is bundled inside the pkg snapshot when packaged, otherwise read from disk
      const pkgPath = appPath('package.json');
      const data = await readFile(pkgPath, 'utf8').catch(async () => {
        // fallback: read VERSION.txt that the build script writes
        const v = await readFile(appPath('VERSION.txt'), 'utf8');
        return JSON.stringify({ version: v.trim() });
      });
      appVersion = JSON.parse(data).version || appVersion;
    } catch (_e) { /* keep default */ }
  })();

  app.get('/api/app-info', (_req, res) => {
    res.json({
      version: appVersion,
      configured: !!(liveConfig.clientId && liveConfig.channel),
      authenticated: !!liveTokens?.access_token,
      botReady,
      packaged: !!process.pkg,           // true when running as a built .exe
      // edit this URL once a real GitHub repo exists
      githubLatestUrl: 'https://api.github.com/repos/your-username/skyrim-rp-bot/releases/latest',
      githubReleasesPage: 'https://github.com/your-username/skyrim-rp-bot/releases'
    });
  });

  // ----- Standard control endpoints (only useful once configured) -----
  app.get('/api/status', (_req, res) => {
    res.json({
      channel: liveConfig.channel,
      phase: state.phase,
      autoMode: !!liveConfig.autoMode,
      collectionSeconds: liveConfig.collectionSeconds,
      votingSeconds: liveConfig.votingSeconds,
      winnerDisplaySeconds: liveConfig.winnerDisplaySeconds,
      finalistsCount: liveConfig.finalistsCount,
      botReady
    });
  });
  app.post('/api/start', (_req, res) => {
    if (testMode) return res.json({ ok: false, message: 'test running' });
    if (!botReady)  return res.json({ ok: false, message: 'bot not connected yet' });
    const ok = state.startCollecting();
    res.json({ ok, phase: state.phase });
  });
  app.post('/api/stop', (_req, res) => {
    state.abort();
    res.json({ ok: true, phase: state.phase });
  });
  app.post('/api/force-voting', (_req, res) => {
    if (testMode) return res.json({ ok: false, message: 'test running' });
    const ok = state.forceVoting();
    res.json({
      ok,
      message: ok ? null : (state.phase !== 'collecting' ? 'not in collection phase' : 'no suggestions yet'),
      phase: state.phase
    });
  });

  // ----- Settings (round timings, finalist count, etc.) -----
  const SETTING_FIELDS = {
    collectionSeconds:        { min: 5,  max: 600, type: 'int' },
    votingSeconds:            { min: 5,  max: 300, type: 'int' },
    winnerDisplaySeconds:     { min: 1,  max: 120, type: 'int' },
    finalistsCount:           { min: 1,  max: 5,   type: 'int' },
    autoMode:                 { type: 'bool' },
    autoModeCooldownSeconds:  { min: 10, max: 3600, type: 'int' },
    maxSuggestionLength:      { min: 20, max: 500,  type: 'int' }
  };
  app.get('/api/settings', (_req, res) => {
    const out = {};
    for (const k of Object.keys(SETTING_FIELDS)) out[k] = liveConfig[k];
    res.json(out);
  });
  app.post('/api/settings', (req, res) => {
    const body = req.body || {};
    const next = { ...liveConfig };
    const errors = [];
    for (const [k, def] of Object.entries(SETTING_FIELDS)) {
      if (!(k in body)) continue;
      let v = body[k];
      if (def.type === 'int') {
        v = parseInt(v, 10);
        if (Number.isNaN(v)) { errors.push(`${k} must be a number`); continue; }
        if (v < def.min || v > def.max) { errors.push(`${k} must be ${def.min}-${def.max}`); continue; }
      } else if (def.type === 'bool') {
        v = !!v;
      }
      next[k] = v;
    }
    if (errors.length) return res.status(400).json({ ok: false, errors });
    Object.assign(liveConfig, next);     // mutate same object so closures (bot, state) see new values
    saveConfig(liveConfig);
    res.json({ ok: true, settings: Object.fromEntries(Object.keys(SETTING_FIELDS).map(k => [k, liveConfig[k]])) });
  });
  // Open an external URL in the OS default browser (NOT the Edge --app window).
  // Used by the setup wizard for "Open dev.twitch.tv" and "twitch.tv/activate" links.
  app.post('/api/open-url', (req, res) => {
    const url = String(req.body?.url || '');
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ ok: false, message: 'invalid url' });
    try {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.post('/api/test', (_req, res) => {
    if (testMode) return res.json({ ok: false, message: 'test already running' });
    if (state.phase !== 'idle') return res.json({ ok: false, message: 'real round in progress' });
    res.json({ ok: true });
    runTestSequence().catch(err => {
      console.error('test sequence error:', err.message);
      testMode = false;
    });
  });

  // ----- Setup endpoints -----
  app.get('/api/setup/state', (_req, res) => {
    res.json({
      hasConfig: !!(liveConfig.clientId && liveConfig.channel),
      hasTokens: !!liveTokens?.access_token,
      channel: liveConfig.channel || '',
      version: appVersion
    });
  });
  app.post('/api/setup/save-config', (req, res) => {
    const { clientId, channel } = req.body || {};
    if (typeof clientId !== 'string' || !clientId.trim()) return res.status(400).json({ ok: false, message: 'clientId required' });
    if (typeof channel !== 'string' || !channel.trim())   return res.status(400).json({ ok: false, message: 'channel required' });
    const next = { ...liveConfig, clientId: clientId.trim(), channel: channel.trim().toLowerCase().replace(/^#/, '') };
    saveConfig(next);
    liveConfig = next;
    state.config = liveConfig;          // keep state machine pointing at fresh config
    res.json({ ok: true });
  });

  let pendingDevice = null;        // { device_code, interval, expiresAt }
  let pollHandle = null;

  app.post('/api/setup/start-auth', async (_req, res) => {
    if (!liveConfig.clientId) return res.status(400).json({ ok: false, message: 'set client ID first' });
    try {
      // first, see if we already have valid tokens (e.g. they re-ran setup)
      const existing = await tryExistingTokens(liveConfig);
      if (existing) {
        liveTokens = existing.tokens;
        liveLogin  = existing.login;
        return res.json({ ok: true, alreadyAuthorized: true, login: existing.login });
      }
      const device = await startDeviceFlow(liveConfig.clientId);
      pendingDevice = {
        device_code: device.device_code,
        interval: device.interval,
        expiresAt: Date.now() + device.expires_in * 1000
      };
      // start a background poll loop
      if (pollHandle) clearTimeout(pollHandle);
      const tick = async () => {
        if (!pendingDevice) return;
        if (Date.now() > pendingDevice.expiresAt) { pendingDevice = null; return; }
        const r = await pollOnceForToken(liveConfig.clientId, pendingDevice.device_code);
        if (r.status === 'ok') {
          liveTokens = r.tokens;
          saveTokens(r.tokens);
          const info = await validateToken(r.tokens.access_token);
          liveLogin = info?.login || null;
          pendingDevice = null;
          if (resolveReady) {
            const fn = resolveReady; resolveReady = null;
            fn({ config: liveConfig, tokens: liveTokens, login: liveLogin });
          }
          return;
        }
        if (r.status === 'slow_down') pendingDevice.interval += 5;
        pollHandle = setTimeout(tick, pendingDevice.interval * 1000);
      };
      pollHandle = setTimeout(tick, pendingDevice.interval * 1000);

      res.json({
        ok: true,
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        expiresIn: device.expires_in
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  app.get('/api/setup/auth-status', (_req, res) => {
    if (liveTokens?.access_token) return res.json({ status: 'ok', login: liveLogin });
    if (!pendingDevice) return res.json({ status: 'idle' });
    if (Date.now() > pendingDevice.expiresAt) return res.json({ status: 'expired' });
    return res.json({ status: 'pending' });
  });

  // ----- HTTP + WS -----
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // log capture buffer
  const logBuffer = [];
  function pushLog(level, msg) {
    const entry = { time: Date.now(), level, msg };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    safeBroadcast({ type: 'log', payload: entry });
  }
  captureConsole(pushLog);

  // Last-known set of style overrides — replayed to any new WS client so the overlay
  // matches the dashboard even after a refresh.
  const styleState = {};

  wss.on('connection', (ws) => {
    try {
      ws.send(JSON.stringify({ type: 'state', payload: state.snapshot() }));
      ws.send(JSON.stringify({ type: 'log_history', payload: logBuffer }));
      // replay any cached styles
      for (const [name, value] of Object.entries(styleState)) {
        ws.send(JSON.stringify({ type: 'style', payload: { name, value } }));
      }
    } catch (_e) { /* ignore */ }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === 'style' && msg.payload && typeof msg.payload.name === 'string') {
          styleState[msg.payload.name] = msg.payload.value;
          // broadcast to all clients (including overlay)
          safeBroadcast({ type: 'style', payload: msg.payload });
        }
      } catch (_e) { /* ignore */ }
    });
  });

  function safeBroadcast(message) {
    let data;
    try { data = JSON.stringify(message); } catch { return; }
    for (const ws of wss.clients) {
      try {
        if (ws.readyState === ws.OPEN) ws.send(data);
      } catch (_e) { /* drop bad client */ }
    }
  }

  state.on('change', (snap) => {
    if (testMode) return;
    safeBroadcast({ type: 'state', payload: snap });
  });
  state.on('aborted', (info) => safeBroadcast({ type: 'aborted', payload: info }));

  // Heartbeat
  setInterval(() => {
    if (testMode) return;
    if (wss.clients.size > 0) safeBroadcast({ type: 'state', payload: state.snapshot() });
  }, 3000);

  // ---- Test mode ----
  let testMode = false;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function fakeSnap(phase, opts = {}) {
    const now = Date.now();
    return {
      phase,
      finalists: opts.finalists || [],
      voteCounts: opts.voteCounts || [0, 0, 0],
      winner: opts.winner || null,
      endsAt: opts.endsAt ?? (opts.duration ? now + opts.duration * 1000 : null),
      suggestionCount: opts.suggestionCount || 0,
      config: {
        collectionSeconds: liveConfig.collectionSeconds,
        votingSeconds: liveConfig.votingSeconds,
        finalistsCount: liveConfig.finalistsCount
      }
    };
  }
  async function runTestSequence() {
    testMode = true;
    console.log('[test] preview started');

    const COLLECT_MS = 4000;
    const colStart = Date.now();
    let count = 0;
    let endsAtCol = colStart + COLLECT_MS;
    safeBroadcast({ type: 'state', payload: fakeSnap('collecting', { suggestionCount: 0, endsAt: endsAtCol }) });
    while (Date.now() - colStart < COLLECT_MS) {
      await sleep(700);
      count = Math.min(count + 1, 12);
      safeBroadcast({ type: 'state', payload: fakeSnap('collecting', { suggestionCount: count, endsAt: endsAtCol }) });
    }

    const finalists = [
      { user: 'tester1', text: 'Steal the sweetroll from the Jarl' },
      { user: 'tester2', text: 'Yell FUS RO DAH at the next Person you see!' },
      { user: 'tester3', text: 'Pickpocket every guard in Whiterun' }
    ];
    const voteCounts = [0, 0, 0];
    const VOTE_MS = 6000;
    const voteStart = Date.now();
    const endsAtVote = voteStart + VOTE_MS;
    safeBroadcast({ type: 'state', payload: fakeSnap('voting', { finalists, voteCounts: [...voteCounts], endsAt: endsAtVote }) });
    while (Date.now() - voteStart < VOTE_MS) {
      await sleep(550);
      const r = Math.random();
      const idx = r < 0.55 ? 1 : (r < 0.8 ? 0 : 2);
      voteCounts[idx]++;
      safeBroadcast({ type: 'state', payload: fakeSnap('voting', { finalists, voteCounts: [...voteCounts], endsAt: endsAtVote }) });
    }

    const maxIdx = voteCounts.indexOf(Math.max(...voteCounts));
    const winner = { ...finalists[maxIdx], index: maxIdx, votes: voteCounts[maxIdx], tieBroken: null };
    const WIN_MS = 6000;
    safeBroadcast({ type: 'state', payload: fakeSnap('winner', { finalists, voteCounts: [...voteCounts], winner, endsAt: Date.now() + WIN_MS }) });
    await sleep(WIN_MS);

    testMode = false;
    safeBroadcast({ type: 'state', payload: state.snapshot() });
    console.log('[test] preview ended');
  }

  // ---- "Wait for ready" promise consumed by index.js ----
  let resolveReady = null;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

  // If config + tokens are already valid (existing user), short-circuit
  (async () => {
    try {
      if (liveConfig.clientId && liveConfig.channel) {
        const existing = await tryExistingTokens(liveConfig);
        if (existing) {
          liveTokens = existing.tokens;
          liveLogin = existing.login;
          if (resolveReady) {
            const fn = resolveReady; resolveReady = null;
            fn({ config: liveConfig, tokens: liveTokens, login: liveLogin });
          }
        }
      }
    } catch (_e) { /* ignore */ }
  })();

  return {
    listen: () =>
      new Promise((resolve) => {
        httpServer.listen(liveConfig.port, () => {
          const base = `http://localhost:${liveConfig.port}`;
          console.log(`Dashboard:  ${base}/`);
          console.log(`OBS Browser Source URL: ${base}/overlay/`);
          resolve();
        });
      }),
    waitForReady: () => readyPromise,
    markBotReady: () => { botReady = true; }
  };
}
