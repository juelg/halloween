// Text and emote -> the mask's text-channel format (16-row columns, one colour
// per column), plus the byte encoding the mask expects.

// Render text with the browser's font and threshold it to 16 rows.
export function textToColumns(text, rgb = [255, 255, 255]) {
  const font = 'bold 13px "Courier New", monospace';
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  const w = Math.max(1, Math.ceil(ctx.measureText(text).width) + 2);
  c.width = w;
  c.height = 16;
  ctx.font = font;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, 16);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 1, 12);
  const data = ctx.getImageData(0, 0, w, 16).data;
  const cols = [];
  for (let x = 0; x < w; x++) {
    const bits = [];
    for (let y = 0; y < 16; y++) bits.push(data[(y * w + x) * 4] > 110);
    cols.push({ bits, rgb });
  }
  return cols;
}

export function blankColumns(n) {
  return Array.from({ length: n }, () => ({ bits: Array(16).fill(false), rgb: [0, 0, 0] }));
}

// Centre columns within a display of `width`.
export function centerColumns(cols, width) {
  if (cols.length >= width) return cols;
  const left = Math.floor((width - cols.length) / 2);
  return [...blankColumns(left), ...cols, ...blankColumns(width - cols.length - left)];
}

// Encoding from GoneUp/mask-go (MIT): per column, byte0 = rows 0-7 (row 0 is
// the MSB), byte1 = rows 8-15 (row 8 is the MSB). Then 3 RGB bytes per column.
export function encodeColumns(cols) {
  const bitmap = new Uint8Array(cols.length * 2);
  const colors = new Uint8Array(cols.length * 3);
  cols.forEach((col, i) => {
    let lo = 0, hi = 0;
    for (let y = 0; y < 8; y++) if (col.bits[y]) lo |= 0x80 >> y;
    for (let y = 8; y < 16; y++) if (col.bits[y]) hi |= 0x80 >> (y - 8);
    bitmap[i * 2] = lo;
    bitmap[i * 2 + 1] = hi;
    colors.set(col.rgb.map((v) => v & 0xff), i * 3);
  });
  return { bitmap, colors };
}

export const EMOTE_PALETTE = {
  r: [255, 40, 30],
  o: [255, 120, 0],
  y: [255, 220, 0],
  g: [40, 255, 80],
  c: [0, 220, 255],
  b: [50, 90, 255],
  p: [180, 70, 255],
  k: [255, 60, 170],
  w: [255, 255, 255],
};

// Emote rows (palette letters, '.' = off) -> columns; each column takes its
// most common colour, which is the real mask's limitation.
export function emoteToColumns(rows) {
  const w = rows[0].length;
  const cols = [];
  for (let x = 0; x < w; x++) {
    const bits = [];
    const counts = {};
    for (let y = 0; y < 16; y++) {
      const ch = rows[y]?.[x] || '.';
      const on = ch in EMOTE_PALETTE;
      bits.push(on);
      if (on) counts[ch] = (counts[ch] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    cols.push({ bits, rgb: best ? EMOTE_PALETTE[best[0]] : [0, 0, 0] });
  }
  return cols;
}

// Validate and normalise emote rows from the model. Returns null if unusable.
export function normalizeEmoteRows(rows, width, height = 16) {
  if (!Array.isArray(rows) || rows.length < height / 2) return null;
  const out = [];
  for (let y = 0; y < height; y++) {
    let r = typeof rows[y] === 'string' ? rows[y].toLowerCase() : '';
    r = [...r].map((ch) => (ch in EMOTE_PALETTE ? ch : '.')).join('');
    r = r.slice(0, width).padEnd(width, '.');
    out.push(r);
  }
  const lit = out.join('').replace(/\./g, '').length;
  if (lit < 8 || lit > width * height * 0.85) return null;
  return out;
}

// Emote rows (half resolution) -> full-face grid, each pixel doubled.
export function emoteToGrid(rows, k = 2) {
  return rows.flatMap((row) => {
    const wide = [...row].flatMap((ch) => Array(k).fill(EMOTE_PALETTE[ch] || null));
    return Array.from({ length: k }, () => wide.slice());
  });
}

// Draw a grid as round LEDs, optionally only inside the mask's oval (guest
// previews and the image the safety screen looks at).
export function drawGridToCanvas(canvas, grid, { scale = 6, bg = '#05070a', oval = true } = {}) {
  const h = grid.length, w = grid[0].length;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
      if (oval && dx * dx + dy * dy > 1) continue;
      const c = grid[y][x];
      ctx.fillStyle = c ? `rgb(${c.join(',')})` : '#14181f';
      ctx.beginPath();
      ctx.arc(x * scale + scale / 2, y * scale + scale / 2, scale * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

// Draw columns to a canvas as round LEDs (used for guest previews and for the
// image the safety screen looks at).
export function drawColumnsToCanvas(canvas, cols, { scale = 12, bg = '#05070a' } = {}) {
  const w = cols.length;
  canvas.width = w * scale;
  canvas.height = 16 * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  cols.forEach((col, x) => {
    col.bits.forEach((on, y) => {
      ctx.fillStyle = on ? `rgb(${col.rgb.join(',')})` : '#14181f';
      ctx.beginPath();
      ctx.arc(x * scale + scale / 2, y * scale + scale / 2, scale * 0.42, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  return canvas;
}
