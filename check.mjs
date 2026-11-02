// node check.mjs — fails loudly if the grid or the caption parsing breaks.
import assert from 'node:assert/strict';
import { parseCaption, parseRich, sequence, pack } from './layout.js';

// captions: first line is the title, the rest is the description
assert.deepEqual(parseCaption('Title\nLine one\n\nLine two\n'), { title: 'Title', desc: 'Line one\n\nLine two' });
assert.deepEqual(parseCaption('Title\n\nBody'), { title: 'Title', desc: 'Body' });
assert.deepEqual(parseCaption('Only a title'), { title: 'Only a title', desc: '' });
assert.deepEqual(parseCaption(undefined), { title: '', desc: '' });

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
let runs = 0, narrowest = Infinity, tallest = 0, varied = 0;
for (const width of [340, 700, 1000, 1400, 2200]) for (const gap of [0, 5, 24]) for (const scale of [0.4, 1, 1.5, 3]) for (const irr of [0, 0.3, 0.6, 1]) for (const group of [0, 0.5, 1]) for (let seed = 1; seed <= 10; seed++) {
  const base = scale * (120 + 0.14 * width);
  const { tiles, height } = pack(sequence(posts, { group, seed }), { width, gap, base, irr, seed, maxH: 800, min: 76 });
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
assert.ok(narrowest >= 76, `a frame came out ${narrowest}px wide`);

// grouping: more of it keeps a post's frames closer together
const spreadAt = group => {
  let sum = 0, n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { tiles } = pack(sequence(posts, { group, seed }), { width: 1400, gap: 5, base: 300, irr: 0.6, seed, maxH: 800, min: 76 });
    for (const a of tiles) {
      const near = tiles.filter(b => b !== a && b.f.post === a.f.post).map(b => Math.hypot(a.x - b.x, a.y - b.y));
      if (near.length) { sum += Math.min(...near); n++; }
    }
  }
  return sum / n;
};
const [g0, g5, g1] = [0, 0.5, 1].map(spreadAt);
assert.ok(g0 > g5 && g5 > g1, `grouping should tighten: ${g0.toFixed(1)}, ${g5.toFixed(1)}, ${g1.toFixed(1)}`);

// order: newest and A–Z come first, reading from the top
for (const group of [0, 0.7, 1]) for (let seed = 1; seed <= 20; seed++) {
  const firstOf = order => pack(sequence(posts, { order, group, seed }), { width: 1400, gap: 5, base: 300, irr: 0.6, seed, maxH: 800, min: 76 }).tiles.toSorted((a, b) => a.y - b.y || a.x - b.x)[0].f.post;
  assert.equal(firstOf('chronological').id, posts.toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))[0].id);
  assert.equal(firstOf('alphabetical').id, posts.toSorted((a, b) => a.title.localeCompare(b.title))[0].id);
}

// the same seed gives the same grid; another gives another
const ids = seed => sequence(posts, { seed }).map(f => f.id).join();
assert.equal(ids(5), ids(5));
assert.notEqual(ids(5), ids(6));

console.log(`ok: ${runs} layouts, none cropped, narrowest frame ${narrowest.toFixed(0)}px, tallest ${tallest.toFixed(0)}px; post spread ${g0.toFixed(1)} → ${g5.toFixed(1)} → ${g1.toFixed(1)} px as grouping rises`);
