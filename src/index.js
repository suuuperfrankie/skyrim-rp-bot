import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { tryExistingTokens } from './auth.js';
import { RoundState } from './state.js';
import { createBot } from './bot.js';
import { createServer } from './server.js';

function openInDefaultBrowser(url) {
  // Windows-native: `start` opens URLs in the default browser.
  // The empty "" argument is the window title (required when the URL has spaces/quotes).
  spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
}

function openAsDesktopApp(url) {
  // Edge/Chrome in --app mode = chromeless window with its own taskbar entry.
  // Not detached: closing the window exits this child, which exits the bot.
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  const profileDir = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'skyrim-rp-bot-app');
  for (const exe of candidates) {
    if (existsSync(exe)) {
      const child = spawn(
        exe,
        [`--app=${url}`, `--user-data-dir=${profileDir}`, '--window-size=1320,920', '--no-first-run', '--no-default-browser-check'],
        { stdio: 'ignore' }
      );
      child.on('exit', () => {
        console.log('Dashboard window closed - shutting down bot.');
        process.exit(0);
      });
      child.on('error', () => { /* non-fatal */ });
      return true;
    }
  }
  return false;
}

async function main() {
  const initialConfig = loadConfig();
  const state = new RoundState(initialConfig);
  const server = createServer({ config: initialConfig, state });
  await server.listen();

  // Open the dashboard as a desktop app
  try {
    const url = `http://localhost:${initialConfig.port}/`;
    if (!openAsDesktopApp(url)) openInDefaultBrowser(url);
  } catch (_e) { /* ignore */ }

  // The server hosts both the setup wizard and the dashboard.
  // It returns the final config + tokens once the user has finished setup
  // (or immediately if config + tokens are already valid from a previous run).
  console.log('Waiting for setup to complete...');
  const ready = await server.waitForReady();
  const config = ready.config;
  const tokens = ready.tokens;
  const login = ready.login;

  // Now bot can connect to Twitch IRC
  const bot = createBot({ config, tokens, login, state });
  await bot.connect();

  // wait for the channel JOIN handshake before printing Ready
  await new Promise((resolve) => {
    const target = `#${config.channel.toLowerCase()}`;
    const onJoin = (channel, _user, self) => {
      if (self && channel.toLowerCase() === target) {
        bot.client.removeListener('join', onJoin);
        resolve();
      }
    };
    bot.client.on('join', onJoin);
    setTimeout(resolve, 5000);
  });

  // Tell the server bot is connected so the dashboard can leave its "starting" state.
  server.markBotReady();

  console.log('\n=== Ready ===');
  console.log(`Type !rp in #${config.channel} to start a round.`);
  if (config.autoMode) {
    console.log(`Auto-mode ON: rounds every ${config.autoModeCooldownSeconds}s.`);
  }
  console.log('Press Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
