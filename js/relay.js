// Message relay between the phone (brain) and guests (mind page).
//   thoughts/   phone writes, everyone reads
//   requests/   guests push, phone reads (and deletes once handled)
//   replies/<guestId>/   phone writes, that guest reads
//   status      phone heartbeat
// Phone writes are authorised by a token the rules compare against
// admin/token. The token itself is never stored where anyone can read it:
// each phone write is a multi-path update that also writes proof/<nonce>,
// which is unreadable, and the rules check that proof (see database.rules.json).
//
// Backends: 'firebase' (real) and 'local' (BroadcastChannel; two tabs, same
// browser) for testing without Firebase.

import { randomId } from './util.js?v=20261031203544';

const FB = 'https://www.gstatic.com/firebasejs/12.19.0/';

export async function createRelay({ mode, token }) {
  if (mode === 'firebase') return new FirebaseRelay(token).init();
  if (mode === 'local') return new LocalRelay().init();
  return new NullRelay();
}

class NullRelay {
  name = 'off';
  async postThought() {}
  async setStatus() {}
  now() {
    return Date.now();
  }
  onRequest() {}
  async reply() {}
  async ackRequest() {}
  onThoughts() {}
  onStatus() {}
  async sendRequest() {
    throw new Error('relay off');
  }
  onReplies() {}
}

class FirebaseRelay {
  name = 'firebase';
  constructor(token) {
    this.token = token;
  }

  async init() {
    const { firebaseConfig } = await import('../firebase-config.js?v=20261031203544');
    if (!firebaseConfig?.databaseURL || firebaseConfig.databaseURL.includes('YOUR_')) {
      throw new Error('firebase-config.js not filled in yet');
    }
    const app = await import(FB + 'firebase-app.js');
    this.fb = await import(FB + 'firebase-database.js');
    this.db = this.fb.getDatabase(app.initializeApp(firebaseConfig));
    this.offset = 0;
    this.fb.onValue(this.fb.ref(this.db, '.info/serverTimeOffset'), (s) => (this.offset = s.val() || 0));
    return this;
  }

  // Phone write: data at `path` plus proof/<nonce> = token, atomically.
  async phoneWrite(path, data) {
    const { ref, update, serverTimestamp } = this.fb;
    const n = randomId(24);
    await update(ref(this.db), {
      [path]: { ...data, t: serverTimestamp(), n },
      ['proof/' + n]: this.token,
    });
  }

  async postThought({ text, kind = 'thought' }) {
    const { ref, push } = this.fb;
    const id = push(ref(this.db, 'thoughts')).key;
    await this.phoneWrite('thoughts/' + id, { text, kind });
  }

  async setStatus(status) {
    await this.phoneWrite('status', status);
  }

  // Server clock, so "cleared at" compares correctly with thought timestamps.
  now() {
    return Date.now() + this.offset;
  }

  onRequest(cb) {
    const { ref, query, orderByChild, startAt, onChildAdded } = this.fb;
    const q = query(ref(this.db, 'requests'), orderByChild('t'), startAt(Date.now() - 2 * 60 * 1000));
    onChildAdded(q, (snap) => cb({ id: snap.key, ...snap.val() }));
  }

  // Delete a handled request (proof keyed 'd' + request id).
  async ackRequest(id) {
    const { ref, update } = this.fb;
    await update(ref(this.db), { ['requests/' + id]: null, ['proof/d' + id]: this.token });
  }

  async reply(guestId, payload) {
    const { ref, push } = this.fb;
    const id = push(ref(this.db, 'replies/' + guestId)).key;
    await this.phoneWrite(`replies/${guestId}/${id}`, payload);
  }

  onThoughts(n, cb) {
    const { ref, query, limitToLast, onValue } = this.fb;
    onValue(query(ref(this.db, 'thoughts'), limitToLast(n)), (snap) => {
      const list = [];
      snap.forEach((c) => {
        list.push({ id: c.key, ...c.val() });
      });
      cb(list.reverse());
    });
  }

  onStatus(cb) {
    const { ref, onValue } = this.fb;
    onValue(ref(this.db, 'status'), (snap) => cb(snap.val()));
  }

  async sendRequest(req) {
    const { ref, push, serverTimestamp } = this.fb;
    await push(ref(this.db, 'requests'), { ...req, t: serverTimestamp() });
  }

  onReplies(guestId, cb) {
    const { ref, query, limitToLast, onChildAdded } = this.fb;
    onChildAdded(query(ref(this.db, 'replies/' + guestId), limitToLast(1)), (snap) => cb(snap.val()));
  }
}

// Same API over BroadcastChannel + localStorage (for local testing only).
class LocalRelay {
  name = 'local';
  async init() {
    this.ch = new BroadcastChannel('halloween-relay');
    this.handlers = {};
    this.ch.onmessage = (e) => (this.handlers[e.data.type] || []).forEach((h) => h(e.data.payload));
    return this;
  }
  on(type, h) {
    (this.handlers[type] ||= []).push(h);
  }
  send(type, payload) {
    this.ch.postMessage({ type, payload });
    (this.handlers[type] || []).forEach((h) => h(payload)); // also deliver locally
  }
  thoughts() {
    try {
      return JSON.parse(localStorage.getItem('relay.thoughts') || '[]');
    } catch {
      return [];
    }
  }
  async postThought({ text, kind = 'thought' }) {
    const list = [{ id: randomId(8), text, kind, t: Date.now() }, ...this.thoughts()].slice(0, 50);
    localStorage.setItem('relay.thoughts', JSON.stringify(list));
    this.send('thoughts', list);
  }
  now() {
    return Date.now();
  }
  async setStatus(status) {
    const s = { ...status, t: Date.now() };
    localStorage.setItem('relay.status', JSON.stringify(s));
    this.send('status', s);
  }
  onRequest(cb) {
    this.on('request', cb);
  }
  async ackRequest() {}
  async reply(guestId, payload) {
    this.send('reply', { guestId, payload: { ...payload, t: Date.now() } });
  }
  onThoughts(n, cb) {
    cb(this.thoughts().slice(0, n));
    this.on('thoughts', (list) => cb(list.slice(0, n)));
  }
  onStatus(cb) {
    try {
      cb(JSON.parse(localStorage.getItem('relay.status') || 'null'));
    } catch {}
    this.on('status', cb);
  }
  async sendRequest(req) {
    this.ch.postMessage({ type: 'request', payload: { id: randomId(12), ...req, t: Date.now() } });
  }
  onReplies(guestId, cb) {
    this.on('reply', (m) => m.guestId === guestId && cb(m.payload));
  }
}
