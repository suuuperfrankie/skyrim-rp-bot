import { EventEmitter } from 'node:events';

export const Phase = Object.freeze({
  IDLE: 'idle',
  COLLECTING: 'collecting',
  VOTING: 'voting',
  WINNER: 'winner'
});

// Edit this list to add/remove censored words.
const PROFANITY = new Set([
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'motherfucker',
  'shit', 'shits', 'shitty', 'shitting', 'bullshit',
  'bitch', 'bitches', 'bitching',
  'cunt', 'cunts',
  'asshole', 'assholes', 'asshat', 'jackass',
  'dick', 'dicks', 'cock', 'cocks', 'cocksucker',
  'pussy', 'twat',
  'whore', 'whores', 'slut', 'sluts',
  'nigger', 'niggers', 'nigga', 'niggas',
  'faggot', 'fag', 'fags',
  'retard', 'retarded',
  'bastard', 'bastards',
  'damn', 'damnit', 'goddamn', 'goddamnit',
  'piss', 'pissed'
]);

function censor(text) {
  return text.replace(/\p{L}+/gu, (word) => {
    const lower = word.toLowerCase();
    if (PROFANITY.has(lower)) {
      return word[0] + '*'.repeat(Math.max(1, word.length - 1));
    }
    return word;
  });
}

// Words that aren't profanity (so don't get masked) but DO disrupt serious roleplay
// — used to filter the serious-mode finalist pool. Combined with PROFANITY they form
// the full "block list" for serious mode.
const CRUDE_WORDS = new Set([
  // bathroom / scatology
  'fart', 'farts', 'farting', 'farted', 'fartz',
  'poop', 'poops', 'pooping', 'pooped', 'poo', 'poopy', 'turd', 'turds',
  'pee', 'pees', 'peeing', 'peed', 'pissed', 'pissing',
  'diarrhea', 'crap', 'craps', 'crappy',
  'puke', 'puking', 'puked', 'vomit', 'vomiting', 'vomited', 'barf', 'barfing',
  // sexual / body
  'sex', 'sexy', 'sexual', 'sexuality',
  'cum', 'cums', 'cumming',
  'orgasm', 'horny', 'erection', 'erect',
  'butt', 'butts', 'booty', 'arse',
  'penis', 'dick', 'dicks', 'cock', 'cocks',
  'vagina', 'pussy', 'twat',
  'boob', 'boobs', 'tit', 'tits', 'titties',
  'naked', 'nudes', 'nude',
  'masturbate', 'masturbating', 'jerk', 'jerking',
  'rape', 'raping', 'raped',
  // generic shock
  'kill', 'murder', 'die', 'dead', 'suicide'
]);

function containsBlockedWord(text) {
  const words = String(text).toLowerCase().match(/\p{L}+/gu) || [];
  for (const w of words) {
    if (PROFANITY.has(w)) return true;
    if (CRUDE_WORDS.has(w)) return true;
  }
  return false;
}

// Used for de-duplicate detection: collapse to lowercase letters/digits/spaces only.
function normalizeForDedupe(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Heuristic scoring for roleplay mode ----
// Used to pick finalists when more suggestions than slots are available.
// Higher score = better fit for the chosen mode.
const FUNNY_HINTS = /\b(lol|lmao|lmfao|haha|hehe|rofl|xd|omg|lulz|kek|kekw|bruh|bro|sus|cringe|wtf|smh|yeet)\b/i;
const EMOJI_RE   = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u;
const SERIOUS_HINTS = /\b(carefully|consider|approach|negotiate|persuade|inform|propose|reflect|honor|honour|duty|loyal|witness|pledge|swear|reveal|confront|investigate|whisper|approach)\b/i;

export function funnyScore(text) {
  const t = String(text || '');
  let s = 0;
  if (t.length > 0 && t.length < 40)  s += 3;
  else if (t.length < 70)             s += 1;
  if (/[!?]{2,}/.test(t))             s += 2;
  if (EMOJI_RE.test(t))               s += 3;
  if (FUNNY_HINTS.test(t))            s += 4;
  // ALL CAPS bonus (only if at least 4 chars and majority alpha)
  const alpha = t.replace(/[^a-zA-Z]/g, '');
  if (alpha.length >= 4 && alpha === alpha.toUpperCase()) s += 2;
  // very short single-clause statements
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 5) s += 1;
  return s;
}

export function seriousScore(text) {
  const t = String(text || '');
  let s = 0;
  // Length: longer thoughtful suggestions get a boost
  if (t.length > 35)  s += 2;
  if (t.length > 70)  s += 2;
  // Multiple words / clauses
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 7) s += 2;
  if (wordCount >= 12) s += 1;
  // Properly capitalized first letter
  if (/^[A-Z]/.test(t)) s += 1;
  // Ends with sensible punctuation (not !!)
  if (/[.!?]$/.test(t) && !/[!?]{2,}$/.test(t)) s += 1;
  // No emoji bonus
  if (!EMOJI_RE.test(t)) s += 1;
  // No funny-slang bonus
  if (!FUNNY_HINTS.test(t)) s += 1;
  // Roleplay-style verbs
  if (SERIOUS_HINTS.test(t)) s += 3;
  return s;
}

function pickFinalistsForMode(pool, count, mode) {
  if (mode === 'serious') {
    // Filter out anything containing crude/profane words. Fall back to the full pool
    // ONLY if filtering leaves us with too few — better to have a finalist than none.
    const clean = pool.filter(s => !s.isCrude);
    const usePool = clean.length >= count ? clean : (clean.length > 0 ? clean : pool);
    const scored = usePool.map(s => ({ s, score: seriousScore(s.text) + Math.random() * 0.1 }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map(x => x.s);
  }
  if (mode === 'funny') {
    const scored = pool.map(s => ({ s, score: funnyScore(s.text) + Math.random() * 0.1 }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map(x => x.s);
  }
  // 'mixed' (default) — random pick
  const local = [...pool];
  const out = [];
  while (out.length < count && local.length) {
    const idx = Math.floor(Math.random() * local.length);
    out.push(local.splice(idx, 1)[0]);
  }
  return out;
}

export class RoundState extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.phase = Phase.IDLE;
    this.suggestions = [];
    this.suggestionUsers = new Set();
    this.finalists = [];
    this.votes = new Map();
    this.voteCounts = [0, 0, 0];
    this.winner = null;
    this.endsAt = null;
    this._tickTimer = null;
    this._endTimer = null;
  }

  snapshot() {
    return {
      phase: this.phase,
      finalists: this.finalists,
      voteCounts: this.voteCounts,
      winner: this.winner,
      endsAt: this.endsAt,
      suggestionCount: this.suggestions.length,
      mode: this.config.roleplayMode || 'mixed',
      config: {
        collectionSeconds: this.config.collectionSeconds,
        votingSeconds: this.config.votingSeconds,
        finalistsCount: this.config.finalistsCount
      }
    };
  }

  _setPhase(phase, durationSeconds = null) {
    this.phase = phase;
    this.endsAt = durationSeconds ? Date.now() + durationSeconds * 1000 : null;
    clearTimeout(this._endTimer);
    if (durationSeconds) {
      this._endTimer = setTimeout(() => this._advance(), durationSeconds * 1000);
    }
    this.emit('change', this.snapshot());
  }

  _advance() {
    if (this.phase === Phase.COLLECTING) this._startVoting();
    else if (this.phase === Phase.VOTING) this._showWinner();
    else if (this.phase === Phase.WINNER) this.reset();
  }

  startCollecting() {
    if (this.phase !== Phase.IDLE) return false;
    this.suggestions = [];
    this.suggestionUsers.clear();
    this.finalists = [];
    this.votes.clear();
    this.voteCounts = [0, 0, 0];
    this.winner = null;
    this._setPhase(Phase.COLLECTING, this.config.collectionSeconds);
    return true;
  }

  addSuggestion(user, text) {
    if (this.phase !== Phase.COLLECTING) return false;
    if (this.suggestionUsers.has(user)) return false;
    const raw = text.trim();
    const trimmed = censor(raw).slice(0, this.config.maxSuggestionLength);
    if (!trimmed) return false;
    // Reject if a near-identical suggestion already exists in this round
    // (case + punctuation insensitive).
    const norm = normalizeForDedupe(trimmed);
    if (norm && this.suggestions.some(s => normalizeForDedupe(s.text) === norm)) return false;
    this.suggestionUsers.add(user);
    // isCrude is checked against the RAW text so words like "shit"/"cum" are flagged
    // even though they get censored in the displayed text.
    this.suggestions.push({ user, text: trimmed, isCrude: containsBlockedWord(raw) });
    this.emit('change', this.snapshot());
    return true;
  }

  _startVoting() {
    const count = Math.min(this.config.finalistsCount, this.suggestions.length);
    if (count === 0) {
      this.emit('aborted', { reason: 'no-suggestions' });
      this.reset();
      return;
    }
    if (this.suggestions.length <= this.config.finalistsCount) {
      this.finalists = [...this.suggestions];
    } else {
      const mode = this.config.roleplayMode || 'mixed';
      this.finalists = pickFinalistsForMode(this.suggestions, count, mode);
    }
    this.voteCounts = this.finalists.map(() => 0);
    this._setPhase(Phase.VOTING, this.config.votingSeconds);
  }

  addVote(user, choice) {
    if (this.phase !== Phase.VOTING) return false;
    const idx = choice - 1;
    if (idx < 0 || idx >= this.finalists.length) return false;
    const previous = this.votes.get(user);
    if (previous === idx) return false;
    if (previous !== undefined) this.voteCounts[previous]--;
    this.votes.set(user, idx);
    this.voteCounts[idx]++;
    this.emit('change', this.snapshot());
    return true;
  }

  _showWinner() {
    const max = Math.max(...this.voteCounts);
    if (max === 0) {
      const idx = Math.floor(Math.random() * this.finalists.length);
      this.winner = { ...this.finalists[idx], index: idx, votes: 0, tieBroken: 'random' };
    } else {
      const tied = this.voteCounts
        .map((v, i) => ({ v, i }))
        .filter(x => x.v === max);
      const pick = tied[Math.floor(Math.random() * tied.length)];
      this.winner = {
        ...this.finalists[pick.i],
        index: pick.i,
        votes: max,
        tieBroken: tied.length > 1 ? 'random' : null
      };
    }
    this._setPhase(Phase.WINNER, this.config.winnerDisplaySeconds);
  }

  // Skip the rest of the collection timer and go straight to voting.
  // Requires at least one suggestion. Returns true on success.
  forceVoting() {
    if (this.phase !== Phase.COLLECTING) return false;
    if (this.suggestions.length === 0) return false;
    clearTimeout(this._endTimer);
    this._startVoting();
    return true;
  }

  abort() {
    clearTimeout(this._endTimer);
    this.reset();
    this.emit('aborted', { reason: 'manual' });
  }

  reset() {
    clearTimeout(this._endTimer);
    this._endTimer = null;
    this.phase = Phase.IDLE;
    this.endsAt = null;
    this.emit('change', this.snapshot());
  }
}
