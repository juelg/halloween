// Expression set. The simulator draws these; the real mask maps each name to a
// built-in image/animation id (see BUILTIN_DEFAULT, editable in the mask lab),
// or optionally uploads these same pixels as a custom bitmap.

const EYES = {
  open: [
    '..####..',
    '.######.',
    '########',
    '########',
    '.######.',
    '..####..',
  ],
  blink: [
    '........',
    '........',
    '........',
    '########',
    '.######.',
    '........',
  ],
  happy: [
    '...##...',
    '..####..',
    '.##..##.',
    '##....##',
    '#......#',
    '........',
  ],
  heart: [
    '.##..##.',
    '########',
    '########',
    '.######.',
    '..####..',
    '...##...',
  ],
  x: [
    '##....##',
    '.##..##.',
    '..####..',
    '..####..',
    '.##..##.',
    '##....##',
  ],
  left: [
    '.####...',
    '######..',
    '######..',
    '######..',
    '.####...',
    '........',
  ],
  right: [
    '...####.',
    '..######',
    '..######',
    '..######',
    '...####.',
    '........',
  ],
  up: [
    '..####..',
    '.######.',
    '.######.',
    '..####..',
    '........',
    '........',
  ],
  wide: [
    '.######.',
    '##....##',
    '##.##.##',
    '##.##.##',
    '##....##',
    '.######.',
  ],
  squint: [
    '........',
    '........',
    '########',
    '########',
    '........',
    '........',
  ],
  angry: [
    '##......',
    '.###....',
    '.######.',
    '.######.',
    '..####..',
    '........',
  ],
  star: [
    '...##...',
    '...##...',
    '########',
    '.######.',
    '.##..##.',
    '##....##',
  ],
  sleep: [
    '........',
    '........',
    '........',
    '##....##',
    '.######.',
    '........',
  ],
};

const MOUTHS = {
  smile: [
    '#..............#',
    '.#............#.',
    '..##........##..',
    '....########....',
  ],
  grin: [
    '################',
    '#..............#',
    '.#............#.',
    '..############..',
  ],
  flat: [
    '................',
    '.##############.',
    '................',
    '................',
  ],
  o: [
    '......####......',
    '.....#....#.....',
    '.....#....#.....',
    '......####......',
  ],
  sad: [
    '....########....',
    '..##........##..',
    '.#............#.',
    '#..............#',
  ],
  wavy: [
    '................',
    '.##...##...##...',
    '#..#.#..#.#..#.#',
    '....#....#....#.',
  ],
  smirk: [
    '................',
    '............#...',
    '...........#....',
    '.##########.....',
  ],
  none: ['................'],
  dots: [
    '................',
    '................',
    '..##...##...##..',
    '..##...##...##..',
  ],
};

const C = {
  cyan: [0, 220, 255],
  green: [40, 255, 120],
  pink: [255, 60, 170],
  red: [255, 40, 30],
  amber: [255, 170, 0],
  white: [255, 255, 255],
  purple: [170, 80, 255],
  blue: [60, 110, 255],
};

// name -> composition. `mirror` flips the right eye horizontally.
export const FACES = {
  neutral: { eyes: ['open', 'open'], mouth: 'smile', color: C.cyan },
  happy: { eyes: ['happy', 'happy'], mouth: 'smile', color: C.green },
  laugh: { eyes: ['happy', 'happy'], mouth: 'grin', color: C.green },
  surprised: { eyes: ['wide', 'wide'], mouth: 'o', color: C.amber },
  thinking: { eyes: ['up', 'up'], mouth: 'dots', color: C.purple, anim: 'dots' },
  love: { eyes: ['heart', 'heart'], mouth: 'smile', color: C.pink },
  sad: { eyes: ['open', 'open'], mouth: 'sad', color: C.blue },
  angry: { eyes: ['angry', 'angry'], mouth: 'flat', color: C.red, mirror: true },
  wink: { eyes: ['open', 'blink'], mouth: 'smirk', color: C.cyan },
  suspicious: { eyes: ['squint', 'squint'], mouth: 'flat', color: C.amber },
  confused: { eyes: ['wide', 'squint'], mouth: 'wavy', color: C.amber },
  excited: { eyes: ['star', 'star'], mouth: 'grin', color: C.amber },
  blink: { eyes: ['blink', 'blink'], mouth: 'smile', color: C.cyan },
  look_left: { eyes: ['left', 'left'], mouth: 'smile', color: C.cyan },
  look_right: { eyes: ['right', 'right'], mouth: 'smile', color: C.cyan },
  sleep: { eyes: ['sleep', 'sleep'], mouth: 'flat', color: C.blue, anim: 'zzz' },
  dead: { eyes: ['x', 'x'], mouth: 'wavy', color: C.red },
  glitch: { eyes: ['open', 'x'], mouth: 'wavy', color: C.red, anim: 'glitch' },
  scan: { eyes: ['open', 'open'], mouth: 'flat', color: C.cyan, anim: 'scan' },
};

// Faces Claude may pick for a reaction.
export const REACTION_FACES = [
  'neutral', 'happy', 'laugh', 'surprised', 'love', 'sad', 'angry', 'wink',
  'suspicious', 'confused', 'excited', 'thinking', 'glitch',
];

// Placeholder built-in ids for the real mask. Probe on Friday in the mask lab
// and assign real ids there (stored in localStorage, overrides these).
export const BUILTIN_DEFAULT = {
  neutral: { cmd: 'IMAG', id: 1 },
  happy: { cmd: 'IMAG', id: 2 },
  laugh: { cmd: 'IMAG', id: 3 },
  surprised: { cmd: 'IMAG', id: 4 },
  thinking: { cmd: 'ANIM', id: 1 },
  love: { cmd: 'IMAG', id: 5 },
  sad: { cmd: 'IMAG', id: 6 },
  angry: { cmd: 'IMAG', id: 7 },
  wink: { cmd: 'IMAG', id: 8 },
  suspicious: { cmd: 'IMAG', id: 9 },
  confused: { cmd: 'IMAG', id: 10 },
  excited: { cmd: 'IMAG', id: 11 },
  blink: { cmd: 'IMAG', id: 12 },
  look_left: { cmd: 'IMAG', id: 13 },
  look_right: { cmd: 'IMAG', id: 14 },
  sleep: { cmd: 'ANIM', id: 2 },
  dead: { cmd: 'IMAG', id: 15 },
  glitch: { cmd: 'ANIM', id: 3 },
  scan: { cmd: 'ANIM', id: 4 },
};

function stamp(grid, sprite, x0, y0, color, flip = false) {
  sprite.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = flip ? row[row.length - 1 - x] : row[x];
      const gx = x0 + x, gy = y0 + y;
      if (ch === '#' && gy >= 0 && gy < grid.length && gx >= 0 && gx < grid[0].length) grid[gy][gx] = color;
    }
  });
}

// Returns grid[h][w] of [r,g,b] | null. `t` (ms) drives the small animations.
export function renderFace(name, w, h, t = 0) {
  const f = FACES[name] || FACES.neutral;
  const grid = Array.from({ length: h }, () => Array(w).fill(null));
  const eyeY = Math.round(h * 0.12);
  const mouthY = Math.round(h * 0.62);
  const lx = Math.round(w * 0.14), rx = w - lx - 8;
  const mx = Math.round((w - 16) / 2);
  stamp(grid, EYES[f.eyes[0]], lx, eyeY, f.color);
  stamp(grid, EYES[f.eyes[1]], rx, eyeY, f.color, !!f.mirror);
  stamp(grid, MOUTHS[f.mouth], mx, mouthY, f.color);

  if (f.anim === 'dots') {
    // thinking: blank out dots one by one
    const phase = Math.floor(t / 300) % 4;
    for (let i = phase; i < 3; i++) {
      const dx = mx + 2 + i * 5;
      for (const y of [mouthY + 2, mouthY + 3]) for (const x of [dx, dx + 1]) if (grid[y]) grid[y][x] = null;
    }
  } else if (f.anim === 'zzz') {
    const phase = Math.floor(t / 600) % 3;
    const zx = w - 6 - phase, zy = 1 + (2 - phase);
    stamp(grid, ['###', '.#.', '###'], zx, zy, C.white);
  } else if (f.anim === 'scan') {
    const sx = Math.floor((t / 40) % (w * 2));
    const x = sx < w ? sx : 2 * w - sx - 1;
    for (let y = 0; y < h; y++) grid[y][x] = C.red;
  } else if (f.anim === 'glitch') {
    const seed = Math.floor(t / 90);
    for (let i = 0; i < 18; i++) {
      const r = Math.abs(Math.sin(seed * 97 + i * 13.7) * 10000);
      const x = Math.floor(r % w), y = Math.floor((r / w) % h);
      grid[y][x] = i % 3 ? C.red : C.white;
    }
    if (seed % 5 === 0) grid.unshift(grid.pop()); // vertical tear
  }
  return grid;
}

// Grid -> mask text-channel format: per column 16 on/off bits + one colour.
export function gridToColumns(grid) {
  const h = grid.length, w = grid[0].length;
  const cols = [];
  for (let x = 0; x < w; x++) {
    const bits = [];
    const counts = new Map();
    for (let y = 0; y < 16; y++) {
      const c = y < h ? grid[y][x] : null;
      bits.push(!!c);
      if (c) {
        const k = c.join(',');
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    let best = '255,255,255', n = 0;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    cols.push({ bits, rgb: best.split(',').map(Number) });
  }
  return cols;
}

// Columns -> grid, i.e. what the real mask will actually show.
export function columnsToGrid(cols, w = cols.length, h = 16, offset = 0) {
  const grid = Array.from({ length: h }, () => Array(w).fill(null));
  cols.forEach((col, i) => {
    const x = i + offset;
    if (x < 0 || x >= w) return;
    col.bits.forEach((on, y) => { if (on && y < h) grid[y][x] = col.rgb; });
  });
  return grid;
}
