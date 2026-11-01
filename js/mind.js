// Public "read my mind" page. No API key, no power: it displays the thought
// feed and submits requests that the phone may or may not act on.

import { CONFIG } from './config.js?v=20261031201418';
import { createRelay } from './relay.js?v=20261031201418';
import { RIDDLES } from './riddles.js?v=20261031201418';
import { emoteToGrid, drawGridToCanvas, normalizeEmoteRows } from './bitmap.js?v=20261031201418';
import { store, randomId } from './util.js?v=20261031201418';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mode = params.get('relay') || 'firebase';

let gid = store.get('guestId', '');
if (!/^[a-z0-9]{12,40}$/.test(gid)) {
  gid = 'g' + randomId(23);
  store.set('guestId', gid);
}
let riddleIdx = store.get('riddle', Math.floor(Math.random() * RIDDLES.length)) % RIDDLES.length;
let ticket = store.get('ticket', null);
let lastSend = 0;
let relay;

function msg(text, cls = '') {
  $('msg').textContent = text || '';
  $('msg').className = 'msg ' + cls;
}

function showRiddle() {
  $('riddle').textContent = RIDDLES[riddleIdx].q;
  store.set('riddle', riddleIdx);
}

function stage(name) {
  $('stage-riddle').classList.toggle('hidden', name !== 'riddle');
  $('stage-emote').classList.toggle('hidden', name !== 'emote');
}

function fmtTime(t) {
  if (typeof t !== 'number') return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderFeed(list) {
  const ol = $('feed');
  ol.innerHTML = '';
  if (!list.length) {
    ol.innerHTML = '<li class="muted">no thoughts yet. robot is probably napping.</li>';
    return;
  }
  for (const th of list.slice(0, CONFIG.relay.thoughtsShown)) {
    const li = document.createElement('li');
    li.className = 'k-' + String(th.kind || 'thought').replace(/[^a-z]/g, '');
    const time = document.createElement('time');
    time.textContent = fmtTime(th.t);
    const span = document.createElement('span');
    span.textContent = String(th.text || '').slice(0, 280);
    li.append(time, span);
    ol.appendChild(li);
  }
}

function renderStatus(s) {
  const online = s && s.online && typeof s.t === 'number' && Date.now() - s.t < 3 * CONFIG.relay.heartbeatMs;
  $('status').textContent = online ? (s.mode === 'talk' ? '● TALK MODE' : '● ONLINE') : '○ OFFLINE';
  $('status').className = 'status ' + (online ? (s.mode === 'talk' ? 'warn' : 'ok') : 'off');
}

function showPreview(p) {
  const rows = normalizeEmoteRows(p?.rows, CONFIG.game.emoteWidth, CONFIG.game.emoteHeight);
  if (!rows) return;
  drawGridToCanvas($('preview'), emoteToGrid(rows), { scale: 5 });
  $('preview-cap').textContent = String(p.caption || '').slice(0, 24);
  $('preview-wrap').classList.remove('hidden');
}

const loadedAt = Date.now();

function onReply(r) {
  if (!r || typeof r !== 'object') return;
  if (typeof r.t === 'number' && r.t < loadedAt - 60000) return; // stale reply from an earlier visit
  const text = String(r.msg || '').slice(0, 200);
  switch (r.status) {
    case 'unlocked':
      ticket = typeof r.ticket === 'string' ? r.ticket : null;
      store.set('ticket', ticket);
      stage('emote');
      msg(text, 'ok');
      $('emote').focus();
      break;
    case 'busy':
      stage('emote');
      msg(text, 'warn');
      break;
    case 'queued':
    case 'showing':
      showPreview(r.preview);
      msg(text, 'ok');
      break;
    case 'rendering':
    case 'judging':
      msg(text, 'wait');
      break;
    case 'done':
    case 'vetoed':
    case 'rejected':
    case 'denied':
    case 'cooldown':
      ticket = null;
      store.del('ticket');
      stage('riddle');
      msg(text, r.status === 'done' ? 'ok' : 'warn');
      break;
    default:
      msg(text, 'warn');
  }
}

async function send(req) {
  const now = Date.now();
  if (now - lastSend < 4000) return msg('SLOW DOWN, HUMAN. ONE THOUGHT AT A TIME.', 'warn');
  lastSend = now;
  try {
    await relay.sendRequest({ g: gid, ...req });
    msg('TRANSMITTING TO ROBOT…', 'wait');
  } catch (e) {
    msg('ROBOT UNREACHABLE. TRY AGAIN IN A BIT.', 'warn');
  }
}

$('answer-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('answer').value.trim().slice(0, 200);
  if (!text) return;
  send({ kind: 'answer', text, riddle: RIDDLES[riddleIdx].id });
};
$('emote-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('emote').value.trim().slice(0, 120);
  if (!text || !ticket) return;
  send({ kind: 'emote', text, ticket });
};
$('new-riddle').onclick = () => {
  riddleIdx = (riddleIdx + 1) % RIDDLES.length;
  showRiddle();
};

showRiddle();
stage(ticket ? 'emote' : 'riddle');
try {
  relay = await createRelay({ mode });
  relay.onThoughts(CONFIG.relay.thoughtsShown, renderFeed);
  relay.onStatus(renderStatus);
  relay.onReplies(gid, onReply);
} catch (e) {
  console.warn(e);
  $('status').textContent = '○ OFFLINE';
  $('feed').innerHTML = '<li class="muted">the robot\'s mind is offline right now.</li>';
  relay = await createRelay({ mode: 'off' });
}
