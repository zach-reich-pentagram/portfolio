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

// The bento. Each frame goes in the highest, leftmost free cell, so no holes can open up inside
// the grid, and every gap across the top of the free space is the width of whole frames, so it is
// never narrower than `min`. A frame's height follows its picture, so cropping stays slight.
export function pack(frames, { cols, irr = 0, group = 0, seed = 1, maxRows = Infinity, min = 2 }) {
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
  return { tiles, ...settle(tiles, cols, sky, min) };
}

// The bottom edge comes out jagged. Even it up by trimming the tallest frames and stretching the
// shortest, but only while a frame stays within LIMIT of its picture's shape: an uneven last row
// is better than a strip of someone's work. Returns the height and the free cells left at the foot.
const LIMIT = 1.6;
function settle(tiles, cols, sky, min) {
  const fits = (t, w, h) => { const a = w / h / t.f.aspect; return a < LIMIT && 1 / a < LIMIT; };
  const mean = sky.reduce((a, b) => a + b, 0) / cols;
  const line = Math.max(Math.round(mean), ...tiles.map(t => t.y + min));
  for (const t of tiles) if (t.y + t.h > line && fits(t, t.w, line - t.y)) t.h = line - t.y;
  const rows = Math.max(0, ...tiles.map(t => t.y + t.h));

  const used = new Uint8Array(cols * rows);
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
      if (fits(t, t.w, t.h + 1) && free(t.x, t.x + t.w, t.y + t.h, t.y + t.h + 1)) { t.h++; mark(t); moved = true; }
      if (fits(t, t.w + 1, t.h) && free(t.x - 1, t.x, t.y, t.y + t.h)) { t.x--; t.w++; mark(t); moved = true; }
      if (fits(t, t.w + 1, t.h) && free(t.x + t.w, t.x + t.w + 1, t.y, t.y + t.h)) { t.w++; mark(t); moved = true; }
    }
  }
  return { rows, holes: used.reduce((n, u) => n + !u, 0) };
}
