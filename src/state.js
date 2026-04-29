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
    const trimmed = censor(text.trim()).slice(0, this.config.maxSuggestionLength);
    if (!trimmed) return false;
    this.suggestionUsers.add(user);
    this.suggestions.push({ user, text: trimmed });
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
      const pool = [...this.suggestions];
      this.finalists = [];
      while (this.finalists.length < count && pool.length) {
        const idx = Math.floor(Math.random() * pool.length);
        this.finalists.push(pool.splice(idx, 1)[0]);
      }
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
