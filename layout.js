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

// The bento. Frames fill the width in bands, one under the other, and each band is a tree of frames
// side by side or stacked. Every node's height is an exact line in its width (h = w / a + b, b for the
// gaps inside it), so widths can be solved rather than rounded: every frame keeps its picture's shape
// to the pixel, nothing is cropped, and there are no holes. Sizes are what's left free to vary.
const leaf = f => ({ f, a: f.aspect, b: 0 });
const beside = (p, q, gap) => { const a = p.a + q.a; return { p, q, across: true, a, b: (p.a * p.b + q.a * q.b - gap) / a }; };
const above = (p, q, gap) => ({ p, q, a: 1 / (1 / p.a + 1 / q.a), b: p.b + q.b + gap });

function build(frames, want, irr, seed, gap) {
  if (frames.length === 1) return leaf(frames[0]);
  const n = frames.length, lean = (noise(seed, 'cut' + frames[0].id + n) - 0.5) * irr;
  const m = Math.min(n - 1, Math.max(1, Math.round(n * (0.5 + lean))));
  const [l, r] = [frames.slice(0, m), frames.slice(m)];
  const mean = frames.reduce((sum, f) => sum + f.aspect, 0) / n;
  if (want > mean) return beside(build(l, want * m / n, irr, seed, gap), build(r, want * (n - m) / n, irr, seed, gap), gap);
  return above(build(l, want * n / m, irr, seed, gap), build(r, want * n / (n - m), irr, seed, gap), gap);
}
function place(node, x, y, w, gap, out) {
  const h = w / node.a + node.b;
  if (node.f) out.push({ f: node.f, x, y, w, h });
  else if (node.across) {
    const pw = node.p.a * (h - node.p.b);
    place(node.p, x, y, pw, gap, out);
    place(node.q, x + pw + gap, y, w - pw - gap, gap, out);
  } else {
    place(node.p, x, y, w, gap, out);
    place(node.q, x, y + w / node.p.a + node.p.b + gap, w, gap, out);
  }
  return out;
}
// A band of the next k frames, its height kept under the window and no frame under `min` wide
function band(frames, at, k, o) {
  const make = k => {
    const part = frames.slice(at, at + k), mean = part.reduce((sum, f) => sum + f.aspect, 0) / k;
    const node = build(part, o.width * mean / o.base, o.irr, o.seed, o.gap);
    const tiles = place(node, 0, 0, o.width, o.gap, []);
    return { k, tiles, h: o.width / node.a + node.b, narrow: Math.min(...tiles.map(t => t.w)) };
  };
  let b = make(k);
  while (b.narrow < o.min && b.k > 1) b = make(b.k - 1);    // a frame's width comes first
  while (b.h > o.maxH && at + b.k < frames.length) {        // then the window's height
    const more = make(b.k + 1);
    if (more.narrow < o.min) break;
    b = more;
  }
  return b;
}
export function pack(frames, { width, gap = 0, base, irr = 0, seed = 1, maxH = Infinity, min = 1 }) {
  const o = { width, gap, base, irr, seed, maxH, min }, bands = [];
  for (let at = 0; at < frames.length;) {
    const k = Math.max(1, Math.round(width / base * (1 + irr * 1.5 * noise(seed, 'band' + frames[at].id))));
    let b = band(frames, at, Math.min(k, frames.length - at), o);
    if (frames.length - at - b.k === 1) b = band(frames, at, b.k + 1, o);   // nothing left alone at the foot
    at += b.k;
    bands.push({ b, from: at - b.k });
  }
  // A last band too tall for the window joins the one above it
  const last = bands.at(-1), before = bands.at(-2);
  if (before && last.b.h > maxH) {
    const joined = band(frames, before.from, frames.length - before.from, o);
    if (joined.k === frames.length - before.from) { bands.pop(); bands.pop(); bands.push({ b: joined }); }
  }
  const tiles = [];
  let y = 0;
  for (const { b } of bands) {
    for (const t of b.tiles) tiles.push({ ...t, y: t.y + y });
    y += b.h + gap;
  }
  return { tiles, height: Math.max(0, y - gap) };
}
