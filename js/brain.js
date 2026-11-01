// The robot's brain: runs on Tobi's phone. The only place that makes decisions
// or calls Claude.

import { CONFIG } from './config.js?v=20261031193659';
import { store, sleep, pick, randomId, weightedPick } from './util.js?v=20261031193659';
import { FACES } from './faces.js?v=20261031193659';
import { emoteToColumns, emoteToGrid } from './bitmap.js?v=20261031193659';

// Lab overrides must land before the mask/sim read CONFIG.
CONFIG.mask.padUploadPackets = store.get('padUpload', CONFIG.mask.padUploadPackets);

const { Mask, FACES_VERSION } = await import('./mask.js?v=20261031193659');
const { Vision } = await import('./vision.js?v=20261031193659');
const { react, getKey, testKey } = await import('./claude.js?v=20261031193659');
const { createRelay } = await import('./relay.js?v=20261031193659');
const { Game } = await import('./game.js?v=20261031193659');
const { saveSelfie, listSelfies, deleteSelfie, downloadBlob } = await import('./selfies.js?v=20261031193659');

const $ = (id) => document.getElementById(id);
const T = CONFIG.trigger;

// Abortable wait.
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

function log(msg) {
  const el = $('log');
  const line = `${new Date().toLocaleTimeString()} ${msg}\n`;
  el.textContent = (line + el.textContent).slice(0, 6000);
  console.log('[robot]', msg);
}

class Robot {
  constructor() {
    this.mask = new Mask($('sim'));
    this.vision = new Vision($('video'));
    this.relay = null;
    this.game = null;
    this.started = false;
    this.mode = 'robot'; // 'robot' | 'talk'
    this.phase = 'idle'; // idle | reacting | sleep | selfie | guest | crash
    this.holdStart = 0;
    this.lastNear = performance.now();
    this.nextAllowed = 0;
    this.selfieCtrl = null;
    this.idleWaiters = [];
    this.voice = store.get('voice', true);
    this.saver = store.get('saver', false);
    this.brightness = store.get('brightness', 90);
    this.lastThoughtAt = 0;
    this.thoughtQueue = Promise.resolve();
    this.mask.addEventListener('log', (e) => labLog(e.detail));
    this.mask.addEventListener('status', () => this.renderStatus());
    this.vision.addEventListener('faces', (e) => this.onFaces(e.detail));
    this.vision.addEventListener('cover', () => this.onCover());
    this.mask.setBrightness(this.brightness);
    this.mask.showFace('sleep');
  }

  // ------------------------------------------------------------ lifecycle

  async start() {
    if (this.started) return;
    $('btn-start').disabled = true;
    $('btn-start').textContent = 'BOOTING…';
    this.unlockSpeech();
    this.wakeLock(); // never let a wake-lock prompt block boot
    try {
      await this.vision.start((step) => log(`boot: ${step}`));
    } catch (e) {
      log(`camera/vision failed: ${e.message}`);
      $('btn-start').disabled = false;
      $('btn-start').textContent = 'START ROBOT';
      return;
    }
    this.started = true;
    this.vision.run(this.saver ? T.detectFpsSaver : T.detectFps);
    this.mask.sim.setFps(this.saver ? 8 : 20);
    $('btn-start').textContent = 'RUNNING';
    await this.connectRelay();
    this.idleLoop();
    setInterval(() => this.renderHud(), 500);
    setInterval(() => this.heartbeat(), CONFIG.relay.heartbeatMs);
    await this.mask.scrollText('BOOTING v0.1… CONFIDENCE 100%', [0, 220, 255]);
    this.mask.showFace('neutral');
    this.say('Embodied agent online. Confidence: one hundred percent. Accuracy: pending.');
    this.thought('Booted up at a party. Calibrating my costume classifier. Confidence: unreasonably high.', 'system');
    this.lastNear = performance.now();
    this.renderStatus();
    if (!getKey()) log('no API key saved: reactions will use canned lines');
  }

  async connectRelay() {
    const mode = store.get('relayMode', 'off');
    try {
      this.relay = await createRelay({ mode, token: store.get('writeToken', '') });
      this.game = new Game({ relay: this.relay, robot: this, log });
      this.heartbeat();
      log(`relay: ${this.relay.name}`);
    } catch (e) {
      log(`relay failed (${e.message}); running without it`);
      this.relay = await createRelay({ mode: 'off' });
      this.game = null;
    }
    this.renderStatus();
  }

  heartbeat() {
    this.relay?.setStatus({ online: true, mode: this.mode }).catch((e) => log(`status write failed: ${e.message}`));
  }

  async wakeLock() {
    const grab = async () => {
      try {
        this.lock = await navigator.wakeLock?.request('screen');
      } catch (e) {
        log(`wake lock unavailable: ${e.message}`);
      }
    };
    await grab();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') grab();
    });
  }

  // ------------------------------------------------------------ outputs

  unlockSpeech() {
    try {
      speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    } catch {}
  }

  say(text) {
    if (!this.voice || !text || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = CONFIG.voice.pitch;
      u.rate = CONFIG.voice.rate;
      const v = speechSynthesis.getVoices().find((v) => /en[-_](US|GB)/i.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch {}
  }

  // Thoughts go out through a small queue so the public feed isn't spammed.
  thought(text, kind = 'thought') {
    log(`💭 ${text}`);
    if (!this.relay) return;
    this.thoughtQueue = this.thoughtQueue.then(async () => {
      const gap = Date.now() - this.lastThoughtAt;
      if (gap < CONFIG.relay.minThoughtGapMs) await sleep(CONFIG.relay.minThoughtGapMs - gap);
      this.lastThoughtAt = Date.now();
      await this.relay.postThought({ text: String(text).slice(0, 280), kind }).catch((e) => log(`thought failed: ${e.message}`));
    });
  }

  // ------------------------------------------------------------ perception

  onFaces(faces) {
    const now = performance.now();
    const close = faces.filter((f) => f.w >= T.minFaceWidth).sort((a, b) => b.w - a.w);
    this.faceCount = faces.filter((f) => f.w >= T.countFaceWidth).length;
    this.nearest = close[0];
    if (close.length) {
      this.lastNear = now;
      if (this.phase === 'sleep') this.wake();
    }
    const c = close[0];
    if (c && Math.abs(c.cx - 0.5) < T.maxCenterOffset) this.holdStart ||= now;
    else this.holdStart = 0;

    if (this.mode !== 'robot' || this.phase !== 'idle') return;
    if (this.holdStart && now - this.holdStart >= T.holdMs && now >= this.nextAllowed) {
      this.reaction(this.faceCount);
    } else if (now - this.lastNear > T.sleepAfterMs) {
      this.sleepMode();
    }
  }

  onCover() {
    log('camera covered');
    if (this.selfieCtrl) {
      this.selfieCtrl.abort();
      return;
    }
    if (this.game?.veto()) {
      log('guest emote vetoed');
      return;
    }
    this.toggleTalk();
  }

  // ------------------------------------------------------------ behaviours

  setPhase(p) {
    this.phase = p;
    if (p === 'idle') {
      const w = this.idleWaiters;
      this.idleWaiters = [];
      w.forEach((r) => r());
    }
    this.renderStatus();
  }

  whenIdle() {
    if (this.phase === 'idle' || this.phase === 'sleep') return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  scheduleNext() {
    this.nextAllowed = performance.now() + T.cooldownMs + Math.random() * T.cooldownJitterMs;
    this.holdStart = 0;
  }

  async idleLoop() {
    for (;;) {
      const gap = CONFIG.idle.minGapMs + Math.random() * (CONFIG.idle.maxGapMs - CONFIG.idle.minGapMs);
      await sleep(this.saver ? gap * 2 : gap);
      if (this.phase !== 'idle') continue;
      const r = Math.random();
      if (r < CONFIG.idle.scanChance) {
        await this.mask.showFace('scan');
        await sleep(3500);
      } else if (r < 0.55) {
        await this.mask.showFace('blink');
        await sleep(160);
      } else if (r < 0.8) {
        await this.mask.showFace(pick(['look_left', 'look_right']));
        await sleep(900);
      } else if (r < 0.88) {
        await this.mask.showFace('scan');
        await sleep(1800);
      }
      if (this.phase === 'idle') await this.mask.showFace(this.mode === 'talk' ? 'happy' : 'neutral');
    }
  }

  async sleepMode() {
    this.setPhase('sleep');
    await this.mask.showFace('sleep');
    this.thought('No humans nearby. Entering low-power mode. Dreaming of electric sheep (costumed).', 'system');
  }

  async wake() {
    this.setPhase('reacting');
    await this.mask.showFace('surprised');
    await sleep(1500);
    await this.mask.showFace('excited');
    await sleep(1200);
    await this.mask.showFace('neutral');
    this.nextAllowed = Math.max(this.nextAllowed, performance.now() + 1000);
    this.setPhase('idle');
  }

  async toggleTalk() {
    this.mode = this.mode === 'robot' ? 'talk' : 'robot';
    this.holdStart = 0;
    $('btn-talk').classList.toggle('on', this.mode === 'talk');
    this.renderStatus();
    if (this.phase === 'sleep') this.setPhase('idle');
    if (this.mode === 'talk') {
      speechSynthesis?.cancel?.();
      await this.mask.showFace('wink');
      this.thought('Pausing my vision model so my human can talk. Very generous of me.', 'system');
    } else {
      await this.mask.showFace('scan');
      this.thought('Vision model re-engaged. Costume classifier: hungry.', 'system');
      this.scheduleNext();
      this.nextAllowed = performance.now() + 5000;
    }
    await sleep(2500);
    if (this.phase === 'idle') await this.mask.showFace(this.mode === 'talk' ? 'happy' : 'neutral');
    this.heartbeat();
  }

  async reaction(faceCount, forced) {
    if (this.phase !== 'idle' && this.phase !== 'sleep') return;
    this.setPhase('reacting');
    try {
      const weights = { ...CONFIG.routines };
      if (faceCount < CONFIG.selfieMinFaces) delete weights.selfie;
      const routine = forced || weightedPick(weights);
      log(`reaction: ${routine} (${faceCount} faces)`);
      if (routine === 'crash') return await this.crashGag();
      if (routine === 'selfie') return await this.selfie(faceCount);
      await this.claudeReaction(routine, faceCount);
    } catch (e) {
      log(`reaction error: ${e.message}`);
    } finally {
      this.scheduleNext();
      if (this.phase !== 'idle') {
        await this.mask.showFace(this.mode === 'talk' ? 'happy' : 'neutral');
        this.setPhase('idle');
      }
    }
  }

  async claudeReaction(routine, faceCount) {
    const jpeg = this.vision.grabJpeg();
    await this.mask.showFace('thinking');
    const t0 = performance.now();
    const r = await react({ jpegBase64: jpeg, faceCount, routine });
    log(`claude ${r.ok ? 'ok' : 'FAILED: ' + r.error} in ${Math.round(performance.now() - t0)} ms — saw: ${r.see}`);
    if (this.mode !== 'robot') return; // Tobi switched to talk mode meanwhile
    // The face and the voice carry the joke; the caption goes to the guest feed.
    await this.mask.showFace(r.face);
    this.say(r.say);
    this.thought(r.caption ? `[${r.caption}] ${r.thought}` : r.thought);
    await sleep(3500);
    await this.mask.showFace('blink');
    await sleep(160);
    await this.mask.showFace(r.face);
    await sleep(2500);
  }

  async crashGag() {
    this.setPhase('crash');
    await this.mask.showFace('glitch');
    this.say('Segmentation fault. Core dumped. Core... dumped?');
    await sleep(1800);
    const ms = await this.mask.scrollText('ERROR', [255, 40, 30]);
    await sleep(Math.min(ms, 4000));
    await this.mask.showFace('dead');
    await sleep(2500);
    await this.mask.showFace('sleep');
    await sleep(1500);
    await this.mask.showFace('scan');
    await sleep(1500);
    await this.mask.showFace('blink');
    await sleep(300);
    await this.mask.showFace('neutral');
    this.say('Reboot complete. I remember nothing. I am fine.');
    this.thought('[kernel panic] Rebooted. No memories lost. (All memories lost.) Everything is fine.', 'system');
    await sleep(2000);
  }

  async selfie(faceCount) {
    this.setPhase('selfie');
    const ctrl = new AbortController();
    this.selfieCtrl = ctrl;
    try {
      const gesture = this.vision.loadGesture(); // load while we ask
      await this.mask.showFace('excited');
      this.say(`${faceCount} humans detected. Selfie? Give me a thumbs up!`);
      this.mask.scrollText('SELFIE?', [255, 60, 170]);
      await gesture;
      const until = performance.now() + CONFIG.selfieWaitMs;
      let ok = false;
      while (performance.now() < until) {
        await wait(200, ctrl.signal);
        if (this.vision.thumbsUp()) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        await this.mask.showFace('sad');
        this.say('No thumbs. Selfie request denied by humans. I respect consent.');
        await wait(2000, ctrl.signal);
        return;
      }
      await this.mask.showFace('happy');
      this.say('Three. Two. One.');
      await wait(2600, ctrl.signal);
      const blob = await this.vision.grabSelfie(`${faceCount} HUMANS + 1 ROBOT // ${new Date().toLocaleString()}`);
      await saveSelfie(blob);
      await this.mask.showFace('laugh');
      this.say('Selfie captured. Stored on my local disk only. Not in my training set. Probably.');
      this.thought(`Took a selfie with ${faceCount} humans. Stored on my human's phone only, not uploaded anywhere.`, 'system');
      renderSelfies();
      await sleep(3000);
    } catch (e) {
      if (e.name === 'AbortError') {
        log('selfie cancelled');
        await this.mask.showFace('sad');
        await sleep(1500);
      } else {
        log(`selfie error: ${e.message}`);
      }
    } finally {
      this.selfieCtrl = null;
    }
  }

  // Called by the guest game once the robot is idle.
  async guestShow(item, signal) {
    this.setPhase('guest');
    try {
      await this.mask.showFace('excited');
      this.say(`Guest control engaged. Displaying: ${item.caption.toLowerCase()}`);
      await wait(1500, signal);
      await this.mask.playEmoteImage(emoteToGrid(item.rows), item.caption);
      await wait(CONFIG.game.emoteShowMs, signal);
      this.thought(`A guest took control of my face: "${item.caption}". I allowed it. Character growth.`, 'guest');
      return 'done';
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
      this.mask.scrollText('VETOED', [255, 40, 30]);
      await sleep(2500);
      return 'vetoed';
    } finally {
      await this.mask.showFace('neutral');
      this.setPhase('idle');
    }
  }

  // ------------------------------------------------------------ UI

  renderStatus() {
    $('st-mode').textContent = this.started ? `${this.mode.toUpperCase()} · ${this.phase.toUpperCase()}` : 'OFF';
    $('st-mode').className = 'pill ' + (this.mode === 'talk' ? 'warn' : this.started ? 'ok' : '');
    $('st-mask').textContent = this.mask.status;
    $('st-mask').className = 'pill ' + (this.mask.realActive ? 'ok' : '');
    $('st-relay').textContent = `RELAY ${this.relay?.name?.toUpperCase() || 'OFF'}`;
    $('st-relay').className = 'pill ' + (this.relay && this.relay.name !== 'off' ? 'ok' : '');
    $('btn-target').textContent = this.mask.useReal ? 'USE: REAL MASK' : 'USE: SIMULATOR';
  }

  renderHud() {
    const n = this.nearest;
    const wait = Math.max(0, Math.round((this.nextAllowed - performance.now()) / 1000));
    const hold = this.holdStart ? Math.round(performance.now() - this.holdStart) : 0;
    const l = this.vision.luma;
    $('hud').textContent =
      `faces ${this.faceCount ?? 0} · near ${n ? Math.round(n.w * 100) + '%' : '–'} · hold ${hold}ms · next ${wait}s` +
      ` · luma ${l ? Math.round(l.mean) + '/' + Math.round(l.std) : '–'}${this.vision.covered ? ' COVERED' : ''}` +
      ` · mic ${Math.round(this.vision.audioLevel * 100)}` +
      (this.game ? ` · queue ${this.game.queue.length}` : '');
  }
}

// ---------------------------------------------------------------- wiring

const robot = new Robot();
window.robot = robot; // handy from the console

function labLog(msg) {
  const el = $('lab-log');
  el.textContent = (`${new Date().toLocaleTimeString()} ${msg}\n` + el.textContent).slice(0, 4000);
}

async function renderSelfies() {
  const list = await listSelfies();
  const box = $('selfies');
  box.innerHTML = list.length ? '' : '<p class="hint">none yet</p>';
  for (const s of list) {
    const url = URL.createObjectURL(s.blob);
    const fig = document.createElement('figure');
    fig.innerHTML = `<img alt="selfie" src="${url}"><figcaption><button data-a="dl">SAVE</button><button data-a="rm" class="danger">DELETE</button></figcaption>`;
    fig.querySelector('[data-a=dl]').onclick = () => downloadBlob(s.blob, s.id + '.jpg');
    fig.querySelector('[data-a=rm]').onclick = async () => {
      if (confirm('Delete this selfie?')) {
        await deleteSelfie(s.id);
        renderSelfies();
      }
    };
    box.appendChild(fig);
  }
}

$('btn-start').onclick = () => robot.start();
$('btn-talk').onclick = () => robot.toggleTalk();
$('btn-react').onclick = () => robot.started && robot.reaction(robot.faceCount ?? 1, null);
$('btn-crash').onclick = () => robot.started && robot.reaction(0, 'crash');
$('btn-lab').onclick = () => $('lab').classList.toggle('hidden');
$('btn-cam').onclick = () => {
  const hidden = $('video').classList.toggle('hidden');
  $('btn-cam').textContent = hidden ? 'SHOW CAMERA' : 'HIDE CAMERA';
};
$('btn-target').onclick = () => robot.mask.setUseReal(!robot.mask.useReal);
$('btn-mask').onclick = async () => {
  try {
    const name = await robot.mask.connect();
    log(`mask connected: ${name}`);
    await robot.mask.setBrightness(robot.brightness);
    await robot.mask.showFace(robot.mask.current);
  } catch (e) {
    log(`mask connect failed: ${e.message}`);
  }
  robot.renderStatus();
};

// Setup panel
$('set-key').value = getKey() ? '••••••••' : '';
$('set-key-save').onclick = () => {
  const v = $('set-key').value.trim();
  if (v && !v.startsWith('••')) {
    store.set('apiKey', v);
    $('set-key').value = '••••••••';
    log('API key saved on this phone');
  }
};
$('set-key-forget').onclick = () => {
  store.del('apiKey');
  $('set-key').value = '';
  log('API key forgotten');
};
$('set-key-test').onclick = async () => {
  if (!getKey()) return log('TEST CLAUDE: no key saved yet (paste it and tap SAVE KEY)');
  log('TEST CLAUDE: calling…');
  try {
    const r = await testKey();
    log(`TEST CLAUDE: OK in ${r.ms} ms, model ${CONFIG.claude.reactModel} says "${r.greeting}"`);
  } catch (e) {
    log(`TEST CLAUDE: FAILED (${e.message})`);
  }
};
// Uses whatever token is in the box (saved or not), so it can be checked before saving.
$('set-relay-test').onclick = async () => {
  const token = $('set-token').value.trim();
  if (!token) return log('TEST FIREBASE: no token in the box');
  log('TEST FIREBASE: connecting…');
  try {
    const relay = await createRelay({ mode: 'firebase', token });
    await Promise.race([
      relay.setStatus({ online: true, mode: robot.mode }),
      sleep(10000).then(() => Promise.reject(new Error('no answer in 10 s (offline?)'))),
    ]);
    log('TEST FIREBASE: OK, database reachable and token accepted');
  } catch (e) {
    const denied = /permission/i.test(e.message);
    log(`TEST FIREBASE: FAILED (${denied ? 'token rejected: it must match admin/token exactly' : e.message})`);
  }
};
$('set-relay').value = store.get('relayMode', 'off');
$('set-relay').onchange = (e) => {
  store.set('relayMode', e.target.value);
  log('relay mode saved; reload the page to apply');
};
$('set-token').value = store.get('writeToken', '');
$('set-token-gen').onclick = () => {
  $('set-token').value = randomId(40);
  $('set-token').type = 'text';
  log('new token generated: SAVE it, then paste it into Firebase at admin/token');
};
$('set-token-show').onclick = async () => {
  $('set-token').type = $('set-token').type === 'password' ? 'text' : 'password';
  try {
    await navigator.clipboard.writeText($('set-token').value);
    log('token copied');
  } catch {}
};
$('set-token-save').onclick = () => {
  store.set('writeToken', $('set-token').value.trim());
  log('token saved on this phone; reload to apply');
};
$('set-token-forget').onclick = () => {
  store.del('writeToken');
  $('set-token').value = '';
  log('token forgotten');
};
$('set-voice').checked = robot.voice;
$('set-voice').onchange = (e) => {
  robot.voice = e.target.checked;
  store.set('voice', robot.voice);
  if (!robot.voice) speechSynthesis?.cancel?.();
};
$('set-saver').checked = robot.saver;
$('set-saver').onchange = (e) => {
  robot.saver = e.target.checked;
  store.set('saver', robot.saver);
  if (robot.started) robot.vision.run(robot.saver ? T.detectFpsSaver : T.detectFps);
  robot.mask.sim.setFps(robot.saver ? 8 : 20);
  if (robot.saver) {
    $('video').classList.add('hidden');
    setBrightness(Math.min(robot.brightness, 60));
  }
};
function setBrightness(v) {
  robot.brightness = v;
  store.set('brightness', v);
  $('set-bright').value = v;
  $('lab-bright').value = v;
  $('lab-bright-v').value = v;
  robot.mask.setBrightness(v);
}
$('set-bright').value = robot.brightness;
$('set-bright').onchange = (e) => setBrightness(+e.target.value);

// Mask lab
$('lab-bright').value = robot.brightness;
$('lab-bright-v').value = robot.brightness;
$('lab-bright').oninput = (e) => ($('lab-bright-v').value = e.target.value);
$('lab-bright').onchange = (e) => setBrightness(+e.target.value);
const labSend = async () => {
  const id = +$('lab-id').value;
  const cmd = $('lab-cmd').value;
  const b = robot.mask.ble;
  if (!b.connected) return labLog('mask not connected');
  try {
    if (cmd === 'IMAG') await b.showImage(id);
    else if (cmd === 'ANIM') await b.playAnimation(id);
    else await b.playDIY(id);
  } catch (e) {
    labLog(e.message);
  }
};
$('lab-send').onclick = labSend;
$('lab-prev').onclick = () => {
  $('lab-id').value = Math.max(0, +$('lab-id').value - 1);
  labSend();
};
$('lab-next').onclick = () => {
  $('lab-id').value = Math.min(255, +$('lab-id').value + 1);
  labSend();
};
for (const name of Object.keys(FACES)) $('lab-face').add(new Option(name, name));
$('lab-assign').onclick = () => {
  const cmd = $('lab-cmd').value;
  if (cmd === 'PLAY') return labLog('assign IMAG or ANIM ids only');
  robot.mask.assignBuiltin($('lab-face').value, cmd, +$('lab-id').value);
  labLog(`${$('lab-face').value} = ${cmd} ${$('lab-id').value} (saved)`);
};
$('lab-scroll').onclick = () => robot.mask.scrollText($('lab-text').value, [0, 220, 255]);
$('lab-bitmap').onclick = async () => {
  const rows = [
    '........................',
    '.......wwwwwwwwww.......',
    '.....ww..........ww.....',
    '....w..............w....',
    '...w...cc......cc...w...',
    '...w...cc......cc...w...',
    '...w................w...',
    '...w..y..........y..w...',
    '...w...y........y...w...',
    '...w....yyyyyyyy....w...',
    '....w..............w....',
    '.....ww..........ww.....',
    '.......wwwwwwwwww.......',
    '........................',
    '..rrrrooooyyyyggggbbbbpp',
    '........................',
  ];
  await robot.mask.showColumns(emoteToColumns(rows));
  labLog('test bitmap sent');
};
// Ruler on the 16-row text channel: count what's visible to find the real width
// and where the band sits.
$('lab-ruler').onclick = async () => {
  const b = robot.mask.ble;
  if (!b.connected) return labLog('mask not connected');
  const hues = [[255, 0, 0], [255, 120, 0], [255, 230, 0], [0, 255, 0], [0, 220, 255], [0, 60, 255], [200, 0, 255]];
  const cols = Array.from({ length: 64 }, (_, i) => {
    const tick = i % 5 === 0;
    const bits = Array.from({ length: 16 }, (_, y) => y === 0 || y === 15 || tick || (y === 7 && i % 10 < 5));
    return { bits, rgb: tick && i % 10 ? [255, 255, 255] : hues[Math.floor(i / 10)] };
  });
  try {
    // Leftover gradient / fixed-colour text effects override per-column colours.
    await b.setTextEffect(false, 0);
    await b.setTextColor(false, [255, 255, 255]);
    await b.showColumns(cols, 1);
    labLog('ruler sent: 0-9 red, 10-19 orange, 20-29 yellow, 30-39 green, 40-49 cyan, 50-59 blue, 60-63 purple');
  } catch (e) {
    labLog(`ruler failed: ${e.message}`);
  }
};

// EXPERIMENTAL full-colour DIY image: red top-left corner, green top-right,
// blue bottom-left, white border and a yellow diagonal, so size, orientation
// and pixel order are obvious from one look.
$('lab-image').onclick = async () => {
  const b = robot.mask.ble;
  if (!b.connected) return labLog('mask not connected');
  const w = +$('lab-iw').value, h = +$('lab-ih').value, slot = +$('lab-islot').value;
  const byCol = $('lab-iorder').value === 'col';
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = [0, 0, 0];
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c = [255, 255, 255];
      if (Math.abs(x / w - y / h) < 0.03) c = [255, 220, 0];
      if (x < 6 && y < 6) c = [255, 0, 0];
      if (x >= w - 6 && y < 6) c = [0, 255, 0];
      if (x < 6 && y >= h - 6) c = [0, 0, 255];
      rgb.set(c, (byCol ? x * h + y : y * w + x) * 3);
    }
  }
  labLog(`uploading ${w}x${h} ${byCol ? 'column' : 'row'} order = ${rgb.length} B to slot ${slot}…`);
  const t0 = performance.now();
  try {
    await b.uploadImage(rgb, slot);
    await b.playDIY(slot);
    labLog(`image uploaded in ${((performance.now() - t0) / 1000).toFixed(1)} s, PLAY 1 ${slot} sent`);
  } catch (e) {
    labLog(`image upload failed: ${e.message}`);
  }
};
// Probe: BC (background colour) black, to hide the built-in image behind text.
$('lab-bgblack').onclick = async () => {
  const b = robot.mask.ble;
  if (!b.connected) return labLog('mask not connected');
  try {
    await b.command('BC', [1, 0, 0, 0]);
    labLog('BC 1 0 0 0 sent (background black)');
  } catch (e) {
    labLog(`BC failed: ${e.message}`);
  }
};
$('lab-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('lab-log').textContent);
    labLog('log copied');
  } catch (e) {
    labLog(`copy failed: ${e.message}`);
  }
};
$('lab-faces').onclick = async () => {
  for (const name of Object.keys(FACES)) {
    labLog(`face: ${name}`);
    await robot.mask.showFace(name);
    await sleep(1500);
  }
  await robot.mask.showFace('neutral');
};
function installStatus() {
  const d = robot.mask.diy;
  $('lab-install-status').textContent = d
    ? `${Object.keys(d.faces).length} faces in slots 1–${d.emoteSlot - 1}${d.version !== FACES_VERSION ? ' (OUTDATED: install again)' : ''}`
    : 'not installed yet: one-time upload, a few minutes, keep the phone close';
}
installStatus();
$('lab-install').onclick = async () => {
  if (!robot.mask.ble.connected) return labLog('mask not connected');
  $('lab-install').disabled = true;
  const t0 = performance.now();
  try {
    const d = await robot.mask.installFaces((done, total, face) => {
      $('lab-install-status').textContent = `uploading ${done}/${total} (${face})…`;
    });
    labLog(`faces installed in ${Math.round((performance.now() - t0) / 1000)} s; emote slot ${d.emoteSlot}`);
    $('lab-facemode').value = 'diy';
  } catch (e) {
    labLog(`install failed: ${e.message}`);
  } finally {
    $('lab-install').disabled = false;
    installStatus();
  }
};
$('lab-facemode').value = robot.mask.faceMode;
$('lab-facemode').onchange = (e) => robot.mask.setFaceMode(e.target.value);
$('lab-pad').checked = CONFIG.mask.padUploadPackets;
$('lab-pad').onchange = (e) => {
  CONFIG.mask.padUploadPackets = e.target.checked;
  store.set('padUpload', e.target.checked);
};

robot.renderStatus();
renderSelfies();
if (!window.isSecureContext) log('NOT a secure context: camera and Bluetooth need https:// or localhost');
