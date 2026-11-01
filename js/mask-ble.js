// Shining Mask over Web Bluetooth.
// Protocol ported from BrickCraftDream/Shining-Mask-stuff (ble-protocol.md),
// GoneUp/mask-go (MIT) and beclamide/mask-controller (MIT).
// Needs the global `aesjs` (aes-js 3.1.2, loaded by index.html).

import { CONFIG } from './config.js?v=20261031193659';
import { encodeColumns } from './bitmap.js?v=20261031193659';

const SERVICE = 0xfff0;
const CHAR_CMD = 'd44bc439-abfd-45a2-b575-925416129600';
const CHAR_NOTIFY = 'd44bc439-abfd-45a2-b575-925416129601';
const CHAR_UPLOAD = 'd44bc439-abfd-45a2-b575-92541612960a';
const KEY = hex('32672f7974ad43451d9c6c894a0e8764');

// Text display modes (MODE command).
export const TEXT_MODE = { steady: 1, blink: 2, scrollLeft: 3, scrollRight: 4 };

function hex(s) {
  return Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
}
const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MaskBLE extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.chars = {};
    this.queue = Promise.resolve();
    this.waiters = [];
    this.aes = null;
  }

  get connected() {
    return !!this.device?.gatt?.connected && !!this.chars.cmd;
  }

  log(msg) {
    this.dispatchEvent(new CustomEvent('log', { detail: msg }));
  }

  // Opens Chrome's device chooser: connects only to the mask Tobi picks.
  async connect() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth not available (use Chrome on Android, over HTTPS)');
    if (!window.aesjs) throw new Error('aes-js failed to load');
    this.aes = new window.aesjs.ModeOfOperation.ecb(KEY);
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, { namePrefix: 'MASK' }],
      optionalServices: [SERVICE],
    });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.chars = {};
      this.log('disconnected');
      this.dispatchEvent(new Event('disconnect'));
    });
    await this.attach();
    return device.name;
  }

  async reconnect() {
    if (!this.device) throw new Error('no mask chosen yet');
    await this.attach();
  }

  async attach() {
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SERVICE);
    this.chars.cmd = await svc.getCharacteristic(CHAR_CMD);
    this.chars.notify = await svc.getCharacteristic(CHAR_NOTIFY);
    this.chars.upload = await svc.getCharacteristic(CHAR_UPLOAD);
    this.chars.notify.addEventListener('characteristicvaluechanged', (e) => this.onNotify(e.target.value));
    await this.chars.notify.startNotifications();
    this.log(`connected to ${this.device.name}`);
    this.dispatchEvent(new Event('connect'));
  }

  disconnect() {
    this.device?.gatt?.disconnect();
  }

  onNotify(view) {
    const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let text = '';
    try {
      const block = raw.length >= 16 ? this.aes.decrypt(raw.slice(0, 16)) : raw;
      const len = Math.min(block[0], 15);
      text = dec.decode(block.slice(1, 1 + len)).replace(/[^\x20-\x7e]/g, '');
    } catch (e) {
      text = '?';
    }
    this.log(`← ${text}`);
    const i = this.waiters.findIndex((w) => text.startsWith(w.prefix));
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1);
      clearTimeout(w.timer);
      w.resolve(text);
    }
  }

  // Register before writing so a fast reply isn't missed.
  expect(prefix, ms = CONFIG.mask.ackTimeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { prefix, resolve };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`timeout waiting for ${prefix}`));
      }, ms);
      this.waiters.push(w);
    });
  }

  // Every GATT operation goes through this queue: one in flight at a time.
  run(job) {
    const p = this.queue.then(() => {
      if (!this.connected) throw new Error('mask not connected');
      return job();
    });
    this.queue = p.catch(() => {});
    return p;
  }

  frame(cmd, args = [], lenOverride) {
    const name = enc.encode(cmd);
    const buf = new Uint8Array(16);
    buf[0] = lenOverride ?? name.length + args.length;
    buf.set(name, 1);
    buf.set(args, 1 + name.length);
    return this.aes.encrypt(buf);
  }

  async write(char, data) {
    if (char.properties.writeWithoutResponse) await char.writeValueWithoutResponse(data);
    else await char.writeValueWithResponse(data);
  }

  async rawCommand(cmd, args = [], lenOverride) {
    this.log(`→ ${cmd} ${Array.from(args).join(',')}`);
    await this.write(this.chars.cmd, this.frame(cmd, args, lenOverride));
  }

  command(cmd, args = [], lenOverride) {
    return this.run(() => this.rawCommand(cmd, args, lenOverride));
  }

  // --- simple commands ---
  setBrightness(n) {
    return this.command('LIGHT', [Math.max(0, Math.min(255, n | 0))]);
  }
  // The official app sends length 5 here (captured in mask-controller);
  // mask-go sends 6. Both reportedly work.
  showImage(id) {
    return this.command('IMAG', [id & 0xff]);
  }
  playAnimation(id) {
    return this.command('ANIM', [id & 0xff]);
  }
  playDIY(id) {
    return this.command('PLAY', [1, id & 0xff]);
  }
  setTextMode(mode) {
    return this.command('MODE', [mode]);
  }
  setTextSpeed(speed) {
    return this.command('SPEED', [speed & 0xff]);
  }
  setTextColor(enable, [r, g, b]) {
    return this.command('FC', [enable ? 1 : 0, r, g, b]);
  }
  setTextEffect(enable, mode) {
    return this.command('M', [enable ? 1 : 0, mode]);
  }

  // --- text-channel bitmap upload (DATS → DATSOK → chunks/REOK → DATCP → DATCPOK) ---
  uploadColumns(cols) {
    const { bitmap, colors } = encodeColumns(cols);
    const all = new Uint8Array(bitmap.length + colors.length);
    all.set(bitmap);
    all.set(colors, bitmap.length);
    return this.upload(all, [all.length >> 8, all.length & 0xff, bitmap.length >> 8, bitmap.length & 0xff, 0]);
  }

  // Full-colour DIY image (EXPERIMENTAL): raw RGB bytes into DIY slot `index`,
  // then shown with playDIY(index). Pixel layout still to be confirmed on the mask.
  uploadImage(rgb, index) {
    return this.upload(rgb, [rgb.length >> 8, rgb.length & 0xff, index >> 8, index & 0xff, 1]);
  }

  upload(all, datsArgs) {
    return this.run(async () => {
      const t0 = performance.now();
      const ok = this.expect('DATSOK');
      await this.rawCommand('DATS', datsArgs);
      await ok;
      const chunk = CONFIG.mask.uploadChunk;
      for (let off = 0, n = 0; off < all.length; off += chunk, n++) {
        const part = all.slice(off, off + chunk);
        const size = CONFIG.mask.padUploadPackets ? 100 : part.length + 2;
        const pkt = new Uint8Array(size);
        pkt[0] = part.length + 1;
        pkt[1] = n & 0xff;
        pkt.set(part, 2);
        const ack = this.expect('REOK');
        await this.chars.upload.writeValueWithoutResponse(pkt);
        await ack;
      }
      const done = this.expect('DATCPOK');
      await this.rawCommand('DATCP');
      await done;
      this.log(`upload ${all.length}B in ${Math.round(performance.now() - t0)} ms`);
    });
  }

  async showColumns(cols, mode = TEXT_MODE.steady) {
    await this.uploadColumns(cols);
    await this.setTextMode(mode);
  }
}

export { sleep };
