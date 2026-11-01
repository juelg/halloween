// Thin adapter: the rest of the app calls showFace / scrollText / setBrightness /
// playEmoteImage and doesn't care whether the simulator or the real mask
// (or both, mirrored) is listening.
//
// Real mask, 'diy' face mode (default): our faces are uploaded once into the
// mask's DIY image slots (INSTALL FACES in the mask lab, a few minutes), then
// switching faces is a single PLAY command. Animated faces loop over a few
// slots. 'builtin' mode uses the mask's own images by id instead.

import { CONFIG } from './config.js?v=20261031193659';
import { BUILTIN_DEFAULT, fullFaceFrames, gridToImageBytes } from './faces.js?v=20261031193659';
import { textToColumns } from './bitmap.js?v=20261031193659';
import { MaskBLE, TEXT_MODE } from './mask-ble.js?v=20261031193659';
import { MaskSim } from './sim.js?v=20261031193659';
import { store } from './util.js?v=20261031193659';

// Bump when the face art changes, so the lab knows the installed set is stale.
export const FACES_VERSION = 1;

export class Mask extends EventTarget {
  constructor(simCanvas) {
    super();
    this.sim = new MaskSim(simCanvas);
    this.ble = new MaskBLE();
    this.useReal = store.get('useRealMask', true); // "real" only matters once connected
    this.faceMode = store.get('faceMode', 'diy'); // 'diy' | 'builtin'
    if (this.faceMode === 'custom') this.faceMode = 'diy';
    this.builtin = { ...BUILTIN_DEFAULT, ...store.get('builtinMap', {}) };
    this.diy = store.get('diySlots', null); // { version, faces: { name: [slot…] }, emoteSlot }
    this.current = 'neutral';
    this.anim = null;
    this.ble.addEventListener('log', (e) => this.emit('log', e.detail));
    this.ble.addEventListener('connect', () => {
      this.emit('status');
      this.real(() => this.resetTextEffects());
    });
    this.ble.addEventListener('disconnect', () => this.emit('status'));
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get realActive() {
    return this.useReal && this.ble.connected;
  }

  get diyReady() {
    return this.faceMode === 'diy' && !!this.diy?.faces?.neutral;
  }

  get status() {
    if (this.ble.connected) return this.useReal ? `MASK ${this.ble.device.name}` : 'SIM (mask idle)';
    return 'SIM';
  }

  setUseReal(v) {
    this.useReal = v;
    store.set('useRealMask', v);
    this.emit('status');
  }

  setFaceMode(m) {
    this.faceMode = m;
    store.set('faceMode', m);
  }

  assignBuiltin(name, cmd, id) {
    this.builtin[name] = { cmd, id };
    const saved = store.get('builtinMap', {});
    saved[name] = { cmd, id };
    store.set('builtinMap', saved);
  }

  connect() {
    return this.ble.connect();
  }

  // Real-mask calls must never break the show: log and carry on.
  async real(fn) {
    if (!this.realActive) return;
    try {
      await fn();
    } catch (e) {
      this.emit('log', `mask error: ${e.message}`);
    }
  }

  // Leftover gradient / fixed-colour text effects (e.g. from the official app)
  // override our per-column colours.
  async resetTextEffects() {
    await this.ble.setTextEffect(false, 0);
    await this.ble.setTextColor(false, [255, 255, 255]);
  }

  // Upload every face frame into DIY slots 1..n. Stops at the first slot the
  // mask refuses and keeps what worked. progress(done, total, face).
  async installFaces(progress = () => {}) {
    if (!this.ble.connected) throw new Error('mask not connected');
    this.stopAnim();
    const frames = fullFaceFrames();
    const faces = {};
    let slot = 0;
    for (const f of frames) {
      slot++;
      try {
        await this.ble.uploadImage(gridToImageBytes(f.grid), slot);
      } catch (e) {
        this.emit('log', `slot ${slot} (${f.face}) failed: ${e.message}; stopping here`);
        slot--;
        break;
      }
      (faces[f.face] ||= []).push(slot);
      progress(slot, frames.length, f.face);
    }
    if (!faces.neutral) throw new Error('no faces installed');
    this.diy = { version: FACES_VERSION, faces, emoteSlot: slot + 1, at: Date.now() };
    store.set('diySlots', this.diy);
    this.setFaceMode('diy');
    await this.showFace(this.current);
    return this.diy;
  }

  stopAnim() {
    if (this.anim) clearTimeout(this.anim.timer);
    this.anim = null;
  }

  startAnim(slots) {
    const anim = { i: 0 };
    const tick = async () => {
      if (this.anim !== anim) return;
      anim.i = (anim.i + 1) % slots.length;
      if (this.realActive) await this.ble.playDIY(slots[anim.i]).catch(() => {});
      if (this.anim === anim) anim.timer = setTimeout(tick, CONFIG.mask.animFrameMs);
    };
    this.anim = anim;
    anim.timer = setTimeout(tick, CONFIG.mask.animFrameMs);
  }

  async showFace(name) {
    this.current = name;
    this.stopAnim();
    await this.sim.showFace(name);
    await this.real(async () => {
      if (this.diyReady) {
        const slots = this.diy.faces[name] || this.diy.faces.neutral;
        await this.ble.playDIY(slots[0]);
        if (slots.length > 1) this.startAnim(slots);
      } else {
        const b = this.builtin[name] || this.builtin.neutral;
        await (b.cmd === 'ANIM' ? this.ble.playAnimation(b.id) : this.ble.showImage(b.id));
      }
    });
  }

  // Short words only: the band shows about 5 letters at once.
  // Resolves after roughly one full pass, so callers can sequence.
  async scrollText(text, rgb = [255, 255, 255]) {
    text = String(text).slice(0, 24);
    this.stopAnim();
    const ms = await this.sim.scrollText(text, rgb);
    await this.real(async () => {
      // Text draws over whatever image is showing: black it out first.
      if (this.diyReady && this.diy.faces.black) await this.ble.playDIY(this.diy.faces.black[0]);
      await this.ble.showColumns(textToColumns(text, rgb), TEXT_MODE.scrollLeft);
    });
    return ms;
  }

  async setBrightness(n) {
    await this.sim.setBrightness(n);
    await this.real(() => this.ble.setBrightness(n));
  }

  // 16-row columns in the eye band (lab test bitmap).
  async showColumns(cols) {
    this.stopAnim();
    await this.sim.showColumns(cols);
    await this.real(async () => {
      if (this.diyReady && this.diy.faces.black) await this.ble.playDIY(this.diy.faces.black[0]);
      await this.ble.showColumns(cols, TEXT_MODE.steady);
    });
  }

  // grid[58][46]: a full-face picture (guest emotes). Uploaded live into the
  // spare slot after the faces (takes a few seconds). Falls back to scrolling
  // `fallbackText` if that fails.
  async playEmoteImage(grid, fallbackText = '') {
    this.stopAnim();
    await this.sim.showImage(grid);
    if (!this.realActive) return true;
    const slot = this.diy?.emoteSlot || 1;
    try {
      await this.ble.uploadImage(gridToImageBytes(grid), slot);
      await this.ble.playDIY(slot);
      return true;
    } catch (e) {
      this.emit('log', `emote upload failed (${e.message}), falling back to text`);
      if (fallbackText) await this.real(() => this.ble.showColumns(textToColumns(fallbackText), TEXT_MODE.scrollLeft));
      return false;
    }
  }
}
