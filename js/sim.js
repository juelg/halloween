// On-screen LED mask. Implements the same interface as the real mask so the
// brain can't tell the difference.

import { CONFIG } from './config.js';
import { renderFace, columnsToGrid } from './faces.js';
import { textToColumns, centerColumns } from './bitmap.js';

export class MaskSim {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = CONFIG.mask.width;
    this.h = CONFIG.mask.height;
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

  frame(t) {
    const s = this.state;
    if (s.kind === 'face') return renderFace(s.name, this.w, this.h, t);
    if (s.kind === 'columns') return columnsToGrid(s.cols, this.w, this.h);
    if (s.kind === 'scroll') {
      const elapsed = (t - s.start) / 1000;
      const offset = Math.round(this.w - elapsed * CONFIG.mask.scrollColsPerSec);
      const total = this.w + s.cols.length;
      const wrapped = ((offset + s.cols.length) % total + total) % total - s.cols.length;
      return columnsToGrid(s.cols, this.w, this.h, wrapped);
    }
    return renderFace('neutral', this.w, this.h, t);
  }

  draw(grid) {
    const { canvas, ctx } = this;
    const cssW = canvas.clientWidth || 600;
    const px = Math.max(4, Math.floor(cssW / this.w));
    if (canvas.width !== px * this.w) {
      canvas.width = px * this.w;
      canvas.height = px * this.h;
    }
    ctx.fillStyle = '#020304';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const b = 0.25 + 0.75 * this.brightness;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
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
    return ((this.w + nCols) / CONFIG.mask.scrollColsPerSec) * 1000;
  }

  async setBrightness(n) {
    this.brightness = Math.max(0, Math.min(255, n)) / 255;
  }

  async playEmoteBitmap(cols) {
    this.state = { kind: 'columns', cols: centerColumns(cols, this.w) };
  }
}
