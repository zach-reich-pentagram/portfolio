// node check.mjs — fails loudly if the grid or the caption parsing breaks.
import assert from 'node:assert/strict';
import { parseCaption, parseRich, sequence, pack, maxFrameHeight, randomColour, inkOn } from './layout.js';

// captions: first line is the title, the rest is the description
assert.deepEqual(parseCaption('Title\nLine one\n\nLine two\n'), { title: 'Title', desc: 'Line one\n\nLine two' });
assert.deepEqual(parseCaption('Title\n\nBody'), { title: 'Title', desc: 'Body' });
assert.deepEqual(parseCaption('Only a title'), { title: 'Only a title', desc: '' });
assert.deepEqual(parseCaption(undefined), { title: '', desc: '' });

// hover card: legible ink, and a colour that isn't grey
assert.equal(inkOn([255, 255, 255]), '#000'); assert.equal(inkOn([0, 0, 0]), '#fff'); assert.equal(inkOn([255, 255, 0]), '#000'); assert.equal(inkOn([0, 0, 255]), '#fff');
assert.deepEqual(randomColour(() => 0), { bg: `rgb(${[143, 36, 36]})`, ink: '#fff' });
for (let i = 0; i < 500; i++) {
  const rgb = randomColour().bg.match(/\d+/g).map(Number);
  assert.ok(rgb.every(v => v >= 0 && v <= 255) && Math.max(...rgb) - Math.min(...rgb) > 40, `grey or out of range: ${rgb}`);
}

// links: labelled, bare, and never a script
assert.deepEqual(parseRich('see [site](https://a.co/x) now'), [{ text: 'see ' }, { text: 'site', href: 'https://a.co/x' }, { text: ' now' }]);
assert.deepEqual(parseRich('at https://a.co/x.'), [{ text: 'at ' }, { text: 'https://a.co/x', href: 'https://a.co/x' }, { text: '.' }]);
assert.deepEqual(parseRich('[x](javascript:alert(1))'), [{ text: '[x](javascript:alert(1))' }]);

const makePosts = n => Array.from({ length: n }, (_, i) => {
  const post = { id: 'p' + i, title: 'T' + String(n - i).padStart(3, '0'), timestamp: `20${String(10 + i % 80).padStart(2, '0')}-01-01T00:00:00+0000` };
  post.frames = Array.from({ length: 1 + i % 5 }, (_, j) => ({ id: `p${i}f${j}`, post, aspect: [1, 0.8, 0.75, 1.91][(i + j) % 4] }));
  return post;
});
const posts = makePosts(40), all = posts.flatMap(p => p.frames);

// every layout: each frame once at its picture's exact shape, nothing overlapping, nothing off the page
let runs = 0, narrowest = Infinity, tallest = 0, varied = 0, rowed = 0, checked = 0;
for (const width of [340, 700, 1000, 1400, 2200]) for (const gap of [0, 5, 24]) for (const scale of [0.4, 1, 1.5, 3]) for (const irr of [0, 0.3, 0.6, 1]) for (const group of [0, 0.5, 1]) for (let seed = 1; seed <= 10; seed++) {
  const base = scale * (120 + 0.14 * width);
  const { tiles, height } = pack(sequence(posts, { group, seed }), { width, gap, base, irr, group, seed, maxH: 800, min: 76 });
  assert.equal(tiles.length, all.length);
  assert.equal(new Set(tiles.map(t => t.f.id)).size, all.length);
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  for (const t of tiles) {
    assert.ok(t.w > 0 && t.h > 0, 'empty frame');
    assert.ok(close(t.w / t.h, t.f.aspect), `cropped: ${t.w / t.h} for ${t.f.aspect}`);
    assert.ok(t.x > -1e-6 && t.x + t.w < width + 1e-6 && t.y + t.h < height + 1e-6, 'off the page');
    narrowest = Math.min(narrowest, t.w); tallest = Math.max(tallest, t.h);
    for (const o of tiles) if (o !== t) {
      const apart = o.x + 1e-6 >= t.x + t.w + gap || t.x + 1e-6 >= o.x + o.w + gap || o.y + 1e-6 >= t.y + t.h + gap || t.y + 1e-6 >= o.y + o.h + gap;
      assert.ok(apart, 'overlap, or closer than the gap');
    }
  }
  // no holes: the frames and their gaps add up to the whole rectangle
  const area = tiles.reduce((sum, t) => sum + t.w * t.h, 0);
  if (gap === 0) assert.ok(Math.abs(area - width * height) < 1e-3 * width * height, 'hole in the grid');
  if (irr > 0 && new Set(tiles.map(t => Math.round(t.w))).size > 3) varied++;
  runs++;
}
assert.ok(varied > runs / 4, 'the bento has gone uniform');
assert.ok(narrowest >= 20, `a frame came out ${narrowest}px wide`);   // the extremes here: smallest scale, biggest gap

// no clear rows, on a mix like the real one (mostly tall video): a seam all the way across would show as one
const tall = Array.from({ length: 17 }, (_, i) => {
  const post = { id: 't' + i, title: 'T' + i, timestamp: 't' };
  post.frames = Array.from({ length: i % 7 ? 1 : 6 }, (_, j) => ({ id: `t${i}f${j}`, post, aspect: [0.5625, 0.5625, 0.5625, 0.8][(i + j) % 4] }));
  return post;
});
for (const width of [1000, 1400]) for (const irr of [0.6, 1]) for (let seed = 1; seed <= 50; seed++) {
  const { tiles } = pack(sequence(tall, { seed }), { width, gap: 5, base: 1.5 * (120 + 0.14 * width), irr, seed, maxH: 828, min: 76 });
  rowed += tiles.some(t => t.y > 1 && !tiles.some(o => o.y < t.y - 1 && o.y + o.h + 5 > t.y + 1));
  checked++;
}
assert.ok(rowed < checked / 10, `${rowed} of ${checked} layouts have a seam all the way across`);

// grouping: more of it keeps a post's frames closer together
const spreadAt = group => {
  let sum = 0, n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { tiles } = pack(sequence(posts, { group, seed }), { width: 1400, gap: 5, base: 300, irr: 0.6, group, seed, maxH: 800, min: 76 });
    for (const a of tiles) {
      const near = tiles.filter(b => b !== a && b.f.post === a.f.post).map(b => Math.hypot(Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w), Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h)));   // edge to edge
      if (near.length) { sum += Math.min(...near); n++; }
    }
  }
  return sum / n;
};
const [g0, g5, g1] = [0, 0.5, 1].map(spreadAt);
// half and full grouping can both already place a post's frames side by side, so they may tie
assert.ok(g0 > g5 && g5 > g1 * 0.98, `grouping should tighten: ${g0.toFixed(1)}, ${g5.toFixed(1)}, ${g1.toFixed(1)}`);

// order: newest and A–Z come first, reading from the top
for (const group of [0, 0.7, 1]) for (let seed = 1; seed <= 20; seed++) {
  const firstOf = order => pack(sequence(posts, { order, group, seed }), { width: 1400, gap: 5, base: 300, irr: 0.6, group, seed, maxH: 800, min: 76 }).tiles.toSorted((a, b) => a.y - b.y || a.x - b.x)[0].f.post;
  assert.equal(firstOf('chronological').id, posts.toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))[0].id);
  assert.equal(firstOf('alphabetical').id, posts.toSorted((a, b) => a.title.localeCompare(b.title))[0].id);
}

// the same seed gives the same grid; another gives another
const ids = seed => sequence(posts, { seed }).map(f => f.id).join();
assert.equal(ids(5), ids(5));
assert.notEqual(ids(5), ids(6));

// Scale keeps working: frames go on growing all the way along the slider, on a tall mix like the real one
const medianWidth = scale => {
  const ws = [];
  for (let seed = 1; seed <= 20; seed++) ws.push(...pack(sequence(tall, { seed }), { width: 1400, gap: 2, base: scale / 100 * (120 + 0.14 * 1400), irr: 1, seed, maxH: maxFrameHeight(scale, 900), min: 76 }).tiles.map(t => t.w));
  return ws.sort((a, b) => a - b)[ws.length >> 1];
};
for (const [a, b] of [[100, 150], [150, 200], [200, 250]]) assert.ok(medianWidth(b) > medianWidth(a) * 1.1, `Scale ${a}→${b} barely changes the frames: ${medianWidth(a)} → ${medianWidth(b)}`);

console.log(`ok: ${runs} layouts, none cropped, ${rowed}/${checked} with a full-width seam, narrowest frame ${narrowest.toFixed(0)}px, tallest ${tallest.toFixed(0)}px; post spread ${g0.toFixed(1)} → ${g5.toFixed(1)} → ${g1.toFixed(1)} px as grouping rises`);
