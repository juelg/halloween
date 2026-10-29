// Thin adapter: the rest of the app calls showFace / scrollText / setBrightness /
// playEmoteBitmap and doesn't care whether the simulator or the real mask
// (or both, mirrored) is listening.

import { CONFIG } from './config.js';
import { BUILTIN_DEFAULT, renderFace, gridToColumns } from './faces.js';
import { textToColumns, centerColumns } from './bitmap.js';
import { MaskBLE, TEXT_MODE } from './mask-ble.js';
import { MaskSim } from './sim.js';
import { store } from './util.js';

export class Mask extends EventTarget {
  constructor(simCanvas) {
    super();
    this.sim = new MaskSim(simCanvas);
    this.ble = new MaskBLE();
    this.useReal = store.get('useRealMask', true); // "real" only matters once connected
    this.faceMode = store.get('faceMode', 'builtin'); // 'builtin' | 'custom'
    this.builtin = { ...BUILTIN_DEFAULT, ...store.get('builtinMap', {}) };
    this.current = 'neutral';
    this.ble.addEventListener('log', (e) => this.emit('log', e.detail));
    this.ble.addEventListener('connect', () => this.emit('status'));
    this.ble.addEventListener('disconnect', () => this.emit('status'));
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get realActive() {
    return this.useReal && this.ble.connected;
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

  async showFace(name) {
    this.current = name;
    await this.sim.showFace(name);
    await this.real(async () => {
      if (this.faceMode === 'custom') {
        const cols = gridToColumns(renderFace(name, CONFIG.mask.width, 16, 0));
        await this.ble.showColumns(cols, TEXT_MODE.steady);
      } else {
        const b = this.builtin[name] || this.builtin.neutral;
        await (b.cmd === 'ANIM' ? this.ble.playAnimation(b.id) : this.ble.showImage(b.id));
      }
    });
  }

  // Resolves after roughly one full pass, so callers can sequence.
  async scrollText(text, rgb = [255, 255, 255]) {
    text = String(text).slice(0, 64);
    const ms = await this.sim.scrollText(text, rgb);
    await this.real(async () => {
      await this.ble.showColumns(textToColumns(text, rgb), TEXT_MODE.scrollLeft);
    });
    return ms;
  }

  async setBrightness(n) {
    await this.sim.setBrightness(n);
    await this.real(() => this.ble.setBrightness(n));
  }

  // cols: [{bits:[16 bools], rgb:[r,g,b]}]. Falls back to scrolling `fallbackText`
  // if the custom upload fails on the real mask.
  async playEmoteBitmap(cols, fallbackText = '') {
    await this.sim.playEmoteBitmap(cols);
    if (!this.realActive) return true;
    try {
      await this.ble.showColumns(centerColumns(cols, CONFIG.mask.width), TEXT_MODE.steady);
      return true;
    } catch (e) {
      this.emit('log', `emote upload failed (${e.message}), falling back to text`);
      if (fallbackText) await this.real(() => this.ble.showColumns(textToColumns(fallbackText), TEXT_MODE.scrollLeft));
      return false;
    }
  }
}
