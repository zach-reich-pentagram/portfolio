// The logic behind the page, with no DOM in it, so `node check.mjs` can test it.

// A repeatable random number in [0, 1) for a seed and a key. Sliders re-pack with the same
// numbers, so the grid changes shape as they move rather than reshuffling; a refresh picks a new seed.
export function noise(seed, key) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822519);
  h ^= h >>> 13; h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

// On Instagram the first line is the title and everything after it is the description.
export function parseCaption(caption = '') {
  const [title = '', ...rest] = caption.trim().split(/\r?\n/);
  return { title: title.trim(), desc: rest.join('\n').trim() };
}

// Text to pieces of plain text and links: [label](https://…), or a bare URL. Only http(s) and
// mailto become links, and the page builds them as DOM nodes, so a caption can't inject anything.
export function parseRich(text = '') {
  const re = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]])/g;
  const out = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[1] ?? m[3], href: m[2] ?? m[3] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

// The order frames are offered to the grid. Posts are ranked by the chosen order, then each frame
// drifts from its post's place by up to `spread` posts: the whole list when grouping is 0 and order
// is random, none at 1. For newest and A–Z a post's first frame stays put, so those read strictly
// from the top, and only its other frames drift, by up to a quarter of the list.
export function sequence(posts, { order = 'random', group = 0, seed = 1 }) {
  const ranked = [...posts];
  if (order === 'chronological') ranked.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  else if (order === 'alphabetical') ranked.sort((a, b) => (a.title || '￿').localeCompare(b.title || '￿'));
  else ranked.sort((a, b) => noise(seed, 'post' + a.id) - noise(seed, 'post' + b.id));
  const ordered = order !== 'random';
  const spread = (1 - group) * (ordered ? Math.max(1, ranked.length / 4) : ranked.length);
  return ranked
    .flatMap((p, rank) => p.frames.map((f, j) => ({ f, key: rank + (ordered && !j ? 0 : spread * noise(seed, 'order' + f.id)) + j * 1e-4 })))
    .sort((a, b) => a.key - b.key)
    .map(x => x.f);
}

const BASE = 6;   // an average frame is this many columns wide

// How far a slot is from a rectangle, in cells
const away = (t, c, r) => Math.hypot(Math.max(t.x - c, 0, c - (t.x + t.w - 1)), Math.max(t.y - r, 0, r - (t.y + t.h - 1)));

// The arrangement: a rough bento on a grid. Each frame goes in the highest, leftmost free cell, so
// frames interlock with no rows or columns running through. This only decides who touches whom;
// measure() below works out the true sizes.
function arrange(frames, { cols, irr, group, seed, maxRows, min }) {
  const sky = new Array(cols).fill(0), left = [...frames], tiles = [], placed = new Map();
  const near = group * 2, hold = group > 0 ? (1 - group) ** 2 * cols * 2 + 3 : Infinity;   // in cells
  while (left.length) {
    const r = Math.min(...sky), c = sky.indexOf(r);
    let run = 1;
    while (c + run < cols && sky[c + run] === r) run++;

    // A frame whose post is already on the grid and touches this slot goes here. One whose post is
    // too far off waits for a nearer slot; otherwise the next frame in line goes.
    let nearest = Infinity, closest = 0, first = -1;
    left.forEach((f, i) => {
      const d = group > 0 ? Math.min(Infinity, ...(placed.get(f.post) || []).map(t => away(t, c, r))) : Infinity;
      if (d < nearest) { nearest = d; closest = i; }
      if (first < 0 && (d === Infinity || d <= hold)) first = i;
    });
    const pick = nearest <= near ? closest : first >= 0 ? first : closest;
    const f = left.splice(pick, 1)[0];

    // up to 4× either way, weighted towards small so a few large frames stand among many little ones
    let want = BASE * 2 ** (irr * 2 * (noise(seed, 'size' + f.id) ** 1.8 * 2 - 1));
    want = Math.min(want, maxRows * f.aspect);
    let w = Math.max(min, Math.min(run, Math.round(want)));
    if (run - w < min) w = run;    // never leave a gap too narrow for anything to fit
    const h = Math.min(Math.max(min, Math.round(w / f.aspect)), Math.max(min, maxRows));

    const t = { f, x: c, y: r, w, h };
    tiles.push(t);
    (placed.get(f.post) || placed.set(f.post, []).get(f.post)).push(t);
    for (let i = c; i < c + w; i++) sky[i] = r + h;
  }
  // Square off the foot, on the grid only: the true sizes come out flush whatever happens here
  const line = Math.max(Math.round(sky.reduce((a, b) => a + b, 0) / cols), ...tiles.map(t => t.y + min));
  for (const t of tiles) if (t.y + t.h > line) t.h = line - t.y;
  const rows = Math.max(...tiles.map(t => t.y + t.h)), used = new Uint8Array(cols * rows);
  const mark = t => { for (let y = t.y; y < t.y + t.h; y++) used.fill(1, t.x + y * cols, t.x + t.w + y * cols); };
  tiles.forEach(mark);
  const free = (x0, x1, y0, y1) => {
    if (x0 < 0 || x1 > cols || y1 > rows) return false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (used[x + y * cols]) return false;
    return true;
  };
  for (let moved = true; moved;) {
    moved = false;
    for (const t of tiles) {
      if (free(t.x, t.x + t.w, t.y + t.h, t.y + t.h + 1)) { t.h++; mark(t); moved = true; }
      if (free(t.x - 1, t.x, t.y, t.y + t.h)) { t.x--; t.w++; mark(t); moved = true; }
      if (free(t.x + t.w, t.x + t.w + 1, t.y, t.y + t.h)) { t.w++; mark(t); moved = true; }
    }
  }
  return { tiles, rows };
}

// The true sizes. Any arrangement of rectangles with set shapes has exactly one solution, the same
// sums as squaring the square: each horizontal seam is a node whose height is unknown, a frame
// carries its width across the seams above and below it (w = aspect × h), and what a seam takes in
// from above it passes on below. So every frame keeps its picture's shape exactly and the edges
// all come out flush, with no cropping and no holes.
function measure({ tiles, rows }, cols, width, gap) {
  // seams: runs of columns along a grid line where a frame ends or starts
  const seams = new Map();
  let count = 1;    // 0 is the top of the page
  const seamAt = new Map();
  const lines = new Map();
  const touch = (y, t) => { const l = lines.get(y) || lines.set(y, new Uint8Array(cols)).get(y); l.fill(1, t.x, t.x + t.w); };
  for (const t of tiles) { touch(t.y, t); touch(t.y + t.h, t); }
  for (const [y, l] of lines) for (let c = 0; c < cols; c++) {
    if (!l[c]) continue;
    const id = y === 0 ? 0 : c && l[c - 1] ? seamAt.get(y * cols + c - 1) : count++;
    seamAt.set(y * cols + c, id);
  }
  const top = t => seamAt.get(t.y * cols + t.x), bottom = t => seamAt.get((t.y + t.h) * cols + t.x);
  const foot = seamAt.get(rows * cols);

  // one line for each seam but the top: what comes in equals what goes out. A frame's full width,
  // its gap included, is aspect × (drop − gap) + gap. The foot's line is that it all adds up to the page.
  const n = count - 1, m = Array.from({ length: n }, () => new Float64Array(n + 1));
  const add = (row, t, sign) => {
    const a = t.f.aspect, s = top(t), e = bottom(t);
    if (e) m[row][e - 1] += sign * a;
    if (s) m[row][s - 1] -= sign * a;
    m[row][n] -= sign * gap * (1 - a);
  };
  for (const t of tiles) {
    const s = top(t), e = bottom(t);
    add(e - 1, t, 1);
    if (s) add(s - 1, t, -1);
  }
  m[foot - 1][n] += width + gap;
  // Gaussian elimination with pivoting
  for (let i = 0; i < n; i++) {
    let best = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[best][i])) best = r;
    [m[i], m[best]] = [m[best], m[i]];
    for (let r = 0; r < n; r++) {
      if (r === i || !m[r][i]) continue;
      const k = m[r][i] / m[i][i];
      for (let c = i; c <= n; c++) m[r][c] -= k * m[i][c];
    }
  }
  const at = id => id ? m[id - 1][n] / m[id - 1][id - 1] : 0;

  // Each frame sits against the one to its left
  const out = [...tiles].sort((a, b) => a.x - b.x).map(g => ({ g, f: g.f, y: at(top(g)), h: at(bottom(g)) - at(top(g)) - gap }));
  for (const t of out) {
    t.w = t.f.aspect * t.h;
    const by = t.g.x && out.find(o => o.x !== undefined && o.g.x + o.g.w === t.g.x && o.g.y < t.g.y + t.g.h && t.g.y < o.g.y + o.g.h);
    t.x = by ? by.x + by.w + gap : 0;
  }
  // a seam right across the page would read as a row
  const rowed = [...lines].filter(([y, l]) => y && y !== rows && l.every(Boolean)).length;
  return { tiles: out.map(({ f, x, y, w, h }) => ({ f, x, y, w, h })), height: at(foot) - gap, rowed };
}

// The size of the rough grid follows the frame size asked for. An arrangement can solve to a frame
// narrower than `min`, or have a seam right across; the next seed's sizes usually don't, so the
// best of a few is kept.
export function pack(frames, { width, gap = 0, base, irr = 0, group = 0, seed = 1, maxH = Infinity, min = 1 }) {
  const cols = Math.max(6, Math.round((width + gap) / (base / BASE))), u = (width + gap) / cols;
  const cells = Math.max(2, Math.ceil(min / u));
  let best = null, score = -Infinity;
  for (let i = 0; i < 16; i++) {
    const done = measure(arrange(frames, { cols, irr, group, seed: seed + i, min: cells, maxRows: Math.floor(maxH / u) }), cols, width, gap);
    const narrow = Math.min(...done.tiles.map(t => t.w));
    const s = (Math.min(narrow, min) - min) * 100 - done.rowed;    // a frame's width comes first
    if (s > score) { best = done; score = s; }
    if (narrow >= min && !done.rowed) break;
  }
  return best;
}
