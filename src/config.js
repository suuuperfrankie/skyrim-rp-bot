import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { appPath } from './paths.js';

const SETTINGS_DIR = appPath('settings');
const CONFIG_PATH = path.join(SETTINGS_DIR, 'config.json');
const TOKENS_PATH = path.join(SETTINGS_DIR, 'tokens.json');

const DEFAULTS = {
  channel: '',
  clientId: '',
  port: 3000,
  collectionSeconds: 30,
  votingSeconds: 20,
  winnerDisplaySeconds: 13,
  maxSuggestionLength: 200,
  finalistsCount: 3,
  autoMode: false,
  autoModeCooldownSeconds: 60,
  modsCanTrigger: true,
  theme: 'skyrim'
};

function ensureDir() {
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

export function loadConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return { ...DEFAULTS, ...data };
}

export function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function loadTokens() {
  ensureDir();
  if (!fs.existsSync(TOKENS_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
}

export function saveTokens(tokens) {
  ensureDir();
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export async function firstRunSetup(config) {
  console.log('\n=== First-time setup ===');
  console.log('You need a Twitch application client ID.');
  console.log('  1. Go to https://dev.twitch.tv/console/apps');
  console.log('  2. Click "Register Your Application"');
  console.log('  3. Name: anything (e.g., "My RP Bot")');
  console.log('  4. OAuth Redirect URLs: http://localhost');
  console.log('  5. Category: Chat Bot');
  console.log('  6. Client Type: Public');
  console.log('  7. Copy the Client ID and paste below.\n');

  const rl = readline.createInterface({ input, output });
  const clientId = (await rl.question('Twitch Client ID: ')).trim();
  const channel = (await rl.question('Twitch channel name (the channel the bot will join): ')).trim().toLowerCase().replace(/^#/, '');
  rl.close();

  const next = { ...config, clientId, channel };
  saveConfig(next);
  console.log('\nSaved to settings/config.json. You can edit that file anytime to change behavior.\n');
  return next;
}
