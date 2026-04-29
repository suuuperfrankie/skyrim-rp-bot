import tmi from 'tmi.js';
import { Phase } from './state.js';

export function createBot({ config, tokens, login, state }) {
  const client = new tmi.Client({
    options: { debug: false, skipUpdatingEmotesets: true },
    connection: { secure: true, reconnect: true },
    identity: { username: login, password: `oauth:${tokens.access_token}` },
    channels: [config.channel]
  });

  let autoModeTimer = null;

  // Send a chat message only if the chat-messages toggle is on (default true).
  function say(channel, msg) {
    if (config.chatMessagesEnabled === false) return;
    client.say(channel, msg);
  }

  function isPrivileged(tags) {
    if (!config.modsCanTrigger) {
      return tags.username?.toLowerCase() === config.channel.toLowerCase();
    }
    return (
      tags.mod ||
      tags.badges?.broadcaster === '1' ||
      tags.username?.toLowerCase() === config.channel.toLowerCase()
    );
  }

  client.on('message', (channel, tags, message, self) => {
    if (self) return;
    const user = tags['display-name'] || tags.username;
    const userKey = (tags.username || '').toLowerCase();
    const text = message.trim();

    if (text.toLowerCase() === '!rp' || text.toLowerCase() === '!rpstart') {
      if (!isPrivileged(tags)) return;
      // welcome message is sent from the state-transition handler below,
      // so it fires for both chat trigger AND dashboard "Start Round" button.
      if (!state.startCollecting()) {
        say(channel, `A round is already running.`);
      }
      return;
    }

    if (
      text.toLowerCase() === '!stoprp' ||
      text.toLowerCase() === '!rpstop' ||
      text.toLowerCase() === '!rpcancel'
    ) {
      if (!isPrivileged(tags)) return;
      state.abort();
      say(channel, `SAJ RP round stopped.`);
      return;
    }

    if (text.toLowerCase().startsWith('!suggest ')) {
      const body = text.slice('!suggest '.length).trim();
      if (state.addSuggestion(userKey, body)) {
        // optional ack - keep silent to avoid chat spam
      }
      return;
    }

    if (state.phase === Phase.VOTING && /^[123]$/.test(text)) {
      state.addVote(userKey, parseInt(text, 10));
      return;
    }
  });

  // Only emit chat messages on actual phase transitions, not on every state change.
  // (state.change also fires on every vote - without this guard the bot would re-spam the vote
  //  message every time someone voted.)
  let lastAnnouncedPhase = state.phase;
  state.on('change', (snap) => {
    if (snap.phase === lastAnnouncedPhase) return;
    lastAnnouncedPhase = snap.phase;

    if (snap.phase === Phase.COLLECTING) {
      say(config.channel, `DinkDonk CHAT SUGGESTIONS OPEN!! (Type "!suggest <your idea>" ) You have ${config.collectionSeconds}s.`);
    } else if (snap.phase === Phase.VOTING) {
      say(config.channel, `DinkDonk VOTE: 1, 2, 3  •  ${config.votingSeconds}s.`);
    } else if (snap.phase === Phase.WINNER && snap.winner) {
      say(
        config.channel,
        `🏆 Winner: "${snap.winner.text}" (${snap.winner.votes} vote${snap.winner.votes === 1 ? '' : 's'})`
      );
    }
  });

  state.on('aborted', ({ reason }) => {
    if (reason === 'no-suggestions') {
      say(config.channel, `SAJ No suggestions came in Round skipped.`);
    }
  });

  function maybeStartAutoMode() {
    if (!config.autoMode) return;
    clearInterval(autoModeTimer);
    autoModeTimer = setInterval(() => {
      if (state.phase === Phase.IDLE) state.startCollecting();
    }, config.autoModeCooldownSeconds * 1000);
  }

  client.on('connected', () => {
    console.log(`Connected as ${login} to #${config.channel}`);
    maybeStartAutoMode();
  });

  return {
    connect: () => client.connect(),
    say: (msg) => client.say(config.channel, msg),
    client
  };
}
