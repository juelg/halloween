// On-screen LED mask: the real mask's 46 x 58 oval, portrait. Implements the
// same interface as the real mask so the brain can't tell the difference.
// Text and 16-row bitmaps appear in the eye band, like on the real mask.

import { CONFIG } from './config.js?v=20261031195155';
import { renderFullFace, columnsToGrid, inOval, FULL_W, FULL_H } from './faces.js?v=20261031195155';
import { textToColumns } from './bitmap.js?v=20261031195155';

export class MaskSim {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = FULL_W;
    this.h = FULL_H;
    this.bandTop = CONFIG.mask.bandTop;
    this.bandW = CONFIG.mask.width;
    this.brightness = 1;
    this.state = { kind: 'face', name: 'neutral' };
    this.fps = 20;
    this.paused = false;
    this.loop = this.loop.bind(this);
    this.last = 0;
    requestAnimationFrame(this.loop);
  }

  setFps(fps) {
    this.fps = fps;
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    if (this.paused || document.hidden) return;
    if (t - this.last < 1000 / this.fps) return;
    this.last = t;
    this.draw(this.frame(t));
  }

  blank() {
    return Array.from({ length: this.h }, () => Array(this.w).fill(null));
  }

  // 16-row band (text channel) drawn over a black face, like the real mask.
  band(rows) {
    const grid = this.blank();
    rows.forEach((row, y) => row.forEach((c, x) => { if (x < this.w) grid[this.bandTop + y][x] = c; }));
    return grid;
  }

  frame(t) {
    const s = this.state;
    if (s.kind === 'face') return renderFullFace(s.name, t);
    if (s.kind === 'image') return s.grid;
    if (s.kind === 'columns') return this.band(columnsToGrid(s.cols, this.bandW, 16));
    if (s.kind === 'scroll') {
      const elapsed = (t - s.start) / 1000;
      const offset = Math.round(this.bandW - elapsed * CONFIG.mask.scrollColsPerSec);
      const total = this.bandW + s.cols.length;
      const wrapped = ((offset + s.cols.length) % total + total) % total - s.cols.length;
      return this.band(columnsToGrid(s.cols, this.bandW, 16, wrapped));
    }
    return renderFullFace('neutral', t);
  }

  draw(grid) {
    const { canvas, ctx } = this;
    const cssW = canvas.clientWidth || 300;
    const px = Math.max(3, Math.floor(cssW / this.w));
    if (canvas.width !== px * this.w) {
      canvas.width = px * this.w;
      canvas.height = px * this.h;
    }
    ctx.fillStyle = '#020304';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const b = 0.25 + 0.75 * this.brightness;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!inOval(x, y)) continue;
        const c = grid[y]?.[x];
        ctx.beginPath();
        ctx.arc(x * px + px / 2, y * px + px / 2, px * 0.4, 0, Math.PI * 2);
        if (c) {
          ctx.fillStyle = `rgb(${Math.round(c[0] * b)},${Math.round(c[1] * b)},${Math.round(c[2] * b)})`;
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = px * 0.6;
        } else {
          ctx.fillStyle = '#0d1117';
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  }

  // --- mask interface ---
  async showFace(name) {
    this.state = { kind: 'face', name };
  }

  async scrollText(text, rgb = [255, 255, 255]) {
    const cols = textToColumns(text, rgb);
    this.state = { kind: 'scroll', cols, start: performance.now() };
    return this.scrollDurationMs(cols.length);
  }

  scrollDurationMs(nCols) {
    return ((this.bandW + nCols) / CONFIG.mask.scrollColsPerSec) * 1000;
  }

  async setBrightness(n) {
    this.brightness = Math.max(0, Math.min(255, n)) / 255;
  }

  async showColumns(cols) {
    this.state = { kind: 'columns', cols };
  }

  async showImage(grid) {
    this.state = { kind: 'image', grid };
  }
}
