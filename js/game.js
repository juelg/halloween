// Phone side of the guest easter egg. Everything arriving from the relay is
// untrusted: shape-checked, rate-limited, and screened before it reaches the mask.

import { CONFIG } from './config.js?v=20261031202541';
import { RIDDLES, normalizeAnswer } from './riddles.js?v=20261031202541';
import { judgeAttempt, renderEmote, screenEmote } from './claude.js?v=20261031202541';
import { emoteToGrid, drawGridToCanvas } from './bitmap.js?v=20261031202541';
import { sha256, randomId, RateLimit, clamp } from './util.js?v=20261031202541';

const G = CONFIG.game;

export class Game {
  constructor({ relay, robot, log }) {
    this.relay = relay;
    this.robot = robot;
    this.log = log;
    this.seen = new Set();
    this.guests = new Map(); // g -> {lastAnswer, answers:[t], lastUnlock}
    this.tickets = new Map(); // ticket -> {g, exp}
    this.queue = [];
    this.current = null; // {item, ctrl}
    this.busy = new Set(); // guests with a render in flight
    this.globalLimit = new RateLimit(G.maxRequestsPerMin, 60000);
    this.judgeLimit = new RateLimit(G.judgeCallsPerMin, 60000);
    relay.onRequest((r) => this.onRequest(r).catch((e) => this.log(`game error: ${e.message}`)));
  }

  guest(g) {
    if (!this.guests.has(g)) this.guests.set(g, { lastAnswer: 0, answers: [], lastUnlock: 0 });
    return this.guests.get(g);
  }

  reply(g, payload) {
    return this.relay.reply(g, payload).catch((e) => this.log(`reply failed: ${e.message}`));
  }

  valid(r) {
    return (
      r &&
      typeof r.id === 'string' &&
      typeof r.g === 'string' && /^[a-z0-9]{12,40}$/.test(r.g) &&
      (r.kind === 'answer' || r.kind === 'emote') &&
      typeof r.text === 'string' && r.text.length >= 1 && r.text.length <= 200
    );
  }

  async onRequest(r) {
    if (!r || this.seen.has(r.id)) return;
    this.seen.add(r.id);
    if (typeof r.t === 'number' && Date.now() - r.t > G.maxRequestAgeMs) return; // stale
    this.relay.ackRequest(r.id).catch(() => {});
    if (!this.valid(r)) return;
    if (!this.globalLimit.take()) return; // flood: drop silently
    const text = clamp(r.text, 200);
    if (r.kind === 'answer') return this.onAnswer(r.g, text, r.riddle);
    return this.onEmote(r.g, text, r.ticket);
  }

  async onAnswer(g, text, riddleId) {
    const st = this.guest(g);
    const now = Date.now();
    const sinceUnlock = now - st.lastUnlock;
    if (st.lastUnlock && sinceUnlock < G.unlockCooldownMs) {
      return this.reply(g, { status: 'cooldown', msg: 'COOLING DOWN. ONE GUEST CONTROL PER 15 MIN.', wait: G.unlockCooldownMs - sinceUnlock });
    }
    st.answers = st.answers.filter((t) => now - t < 15 * 60 * 1000);
    if (now - st.lastAnswer < G.answerMinGapMs || st.answers.length >= G.answersPer15Min) {
      return this.reply(g, { status: 'slow', msg: 'RATE LIMITED. MY NEURONS NEED A SECOND.' });
    }
    st.lastAnswer = now;
    st.answers.push(now);

    const riddle = RIDDLES.find((x) => x.id === riddleId);
    if (riddle && riddle.h.includes(await sha256(normalizeAnswer(text)))) {
      this.robot.thought('A human solved my riddle. Granting temporary guest control. This is fine.', 'guest');
      return this.unlock(g, 'CORRECT. YOU MAY CONTROL MY FACE.');
    }
    if (!this.judgeLimit.take()) {
      return this.reply(g, { status: 'wrong', msg: 'WRONG. (MY JUDGE IS BUSY. TRY AGAIN SOON.)' });
    }
    this.reply(g, { status: 'judging', msg: 'HMM. EVALUATING YOUR… ANSWER?' });
    const verdict = await judgeAttempt({ riddle: riddle?.q || '(unknown riddle)', text });
    if (verdict.win) {
      this.robot.thought(`A human convinced me with words. Score ${verdict.score}/10. ${verdict.remark}`, 'guest');
      return this.unlock(g, `NOT THE ANSWER, BUT… ${verdict.remark}`);
    }
    return this.reply(g, { status: 'wrong', msg: verdict.remark || 'WRONG.' });
  }

  unlock(g, msg) {
    const ticket = randomId(20);
    this.tickets.set(ticket, { g, exp: Date.now() + G.ticketTtlMs });
    return this.reply(g, { status: 'unlocked', msg, ticket });
  }

  async onEmote(g, idea, ticket) {
    const tk = this.tickets.get(ticket);
    if (!tk || tk.g !== g || tk.exp < Date.now()) {
      return this.reply(g, { status: 'denied', msg: 'NO VALID UNLOCK. SOLVE THE RIDDLE FIRST.' });
    }
    if (this.busy.has(g)) return;
    if (this.queue.length >= G.emoteQueueMax) {
      return this.reply(g, { status: 'busy', msg: 'EMOTE QUEUE FULL. TRY AGAIN IN A MINUTE.', ticket });
    }
    this.tickets.delete(ticket);
    this.guest(g).lastUnlock = Date.now();
    this.busy.add(g);
    try {
      this.reply(g, { status: 'rendering', msg: 'RENDERING PIXELS WITH MAXIMUM CONFIDENCE…' });
      const art = await renderEmote(idea);
      if (!art) return this.reply(g, { status: 'rejected', msg: 'I COULD NOT DRAW THAT. (OR WOULD NOT.)' });
      const grid = emoteToGrid(art.rows);
      const png = drawGridToCanvas(document.createElement('canvas'), grid, { scale: 8 })
        .toDataURL('image/png')
        .split(',')[1];
      const verdict = await screenEmote({ idea, caption: art.caption, pngBase64: png });
      if (!verdict.safe) {
        this.log(`emote rejected: ${verdict.reason}`);
        return this.reply(g, { status: 'rejected', msg: 'SAFETY SCREEN SAYS NO. TRY SOMETHING ELSE SPOOKY-CUTE.' });
      }
      const item = { id: randomId(8), g, idea, caption: art.caption, rows: art.rows, grid };
      this.queue.push(item);
      this.reply(g, { status: 'queued', msg: `QUEUED (#${this.queue.length}). WATCH MY FACE!`, preview: { rows: art.rows, caption: art.caption } });
      this.pump();
    } finally {
      this.busy.delete(g);
    }
  }

  async pump() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    const ctrl = new AbortController();
    this.current = { item, ctrl };
    try {
      await this.robot.whenIdle();
      if (ctrl.signal.aborted) throw new DOMException('vetoed', 'AbortError');
      this.reply(item.g, { status: 'showing', msg: 'YOUR EMOTE IS ON MY FACE RIGHT NOW!', preview: { rows: item.rows, caption: item.caption } });
      const result = await this.robot.guestShow(item, ctrl.signal);
      this.reply(item.g, result === 'vetoed'
        ? { status: 'vetoed', msg: 'MY HUMAN VETOED IT. HUMANS HAVE THAT POWER. SORRY!' }
        : { status: 'done', msg: 'DISPLAYED. YOU ARE NOW PART OF MY TRAINING DATA. (NOT REALLY.)' });
    } catch {
      this.reply(item.g, { status: 'vetoed', msg: 'MY HUMAN VETOED IT. SORRY!' });
    } finally {
      this.current = null;
      setTimeout(() => this.pump(), G.emoteGapMs);
    }
  }

  // Covering the camera vetoes the emote on screen, or the next one waiting.
  veto() {
    if (this.current) {
      this.current.ctrl.abort();
      return true;
    }
    const next = this.queue.shift();
    if (next) {
      this.reply(next.g, { status: 'vetoed', msg: 'MY HUMAN VETOED IT. SORRY!' });
      return true;
    }
    return false;
  }

  get pending() {
    return !!this.current || this.queue.length > 0;
  }
}
