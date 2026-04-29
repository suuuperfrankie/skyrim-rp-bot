import { saveTokens, loadTokens } from './config.js';

const SCOPES = ['chat:read', 'chat:edit'];
const DEVICE_ENDPOINT = 'https://id.twitch.tv/oauth2/device';
const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_ENDPOINT = 'https://id.twitch.tv/oauth2/validate';

export async function startDeviceFlow(clientId) {
  const body = new URLSearchParams({ client_id: clientId, scopes: SCOPES.join(' ') });
  const res = await fetch(DEVICE_ENDPOINT, { method: 'POST', body });
  if (!res.ok) throw new Error(`Device flow start failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function pollOnceForToken(clientId, deviceCode) {
  const body = new URLSearchParams({
    client_id: clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  });
  const res = await fetch(TOKEN_ENDPOINT, { method: 'POST', body });
  if (res.ok) return { status: 'ok', tokens: await res.json() };
  const err = await res.json().catch(() => ({}));
  if (err.message === 'authorization_pending') return { status: 'pending' };
  if (err.message === 'slow_down') return { status: 'slow_down' };
  return { status: 'error', error: err.message || `http ${res.status}` };
}

async function pollForToken(clientId, deviceCode, intervalSeconds) {
  let interval = intervalSeconds;
  while (true) {
    await new Promise(r => setTimeout(r, interval * 1000));
    const res = await pollOnceForToken(clientId, deviceCode);
    if (res.status === 'ok') return res.tokens;
    if (res.status === 'slow_down') { interval += 5; continue; }
    if (res.status === 'pending') continue;
    throw new Error(`Token poll failed: ${res.error}`);
  }
}

export async function validateToken(accessToken) {
  const res = await fetch(VALIDATE_ENDPOINT, { headers: { Authorization: `OAuth ${accessToken}` } });
  return res.ok ? res.json() : null;
}

async function refreshAccessToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const res = await fetch(TOKEN_ENDPOINT, { method: 'POST', body });
  if (!res.ok) return null;
  return res.json();
}

// Returns { tokens, login } if existing tokens are still valid (or can be refreshed). null otherwise.
export async function tryExistingTokens(config) {
  const existing = loadTokens();
  if (!existing?.access_token) return null;
  const info = await validateToken(existing.access_token);
  if (info) return { tokens: existing, login: info.login };
  if (existing.refresh_token) {
    const refreshed = await refreshAccessToken(config.clientId, existing.refresh_token);
    if (refreshed) {
      saveTokens(refreshed);
      const info2 = await validateToken(refreshed.access_token);
      if (info2) return { tokens: refreshed, login: info2.login };
    }
  }
  return null;
}

// Legacy console-based flow (kept as a fallback).
export async function ensureAuth(config) {
  const existing = await tryExistingTokens(config);
  if (existing) return existing;

  console.log('\n=== Twitch authorization ===');
  const device = await startDeviceFlow(config.clientId);
  console.log(`\n  Open: ${device.verification_uri}`);
  console.log(`  Code: ${device.user_code}`);
  console.log('\nWaiting for you to authorize...\n');

  const tokens = await pollForToken(config.clientId, device.device_code, device.interval);
  saveTokens(tokens);
  const info = await validateToken(tokens.access_token);
  console.log(`Authorized as: ${info.login}\n`);
  return { tokens, login: info.login };
}
