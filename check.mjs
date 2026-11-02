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

// every layout: each frame once, nothing overlapping, nothing too small, nothing off the grid
let uneven = 0, runs = 0, worstCrop = 0;
for (const cols of [6, 9, 14, 22, 31, 48]) for (const min of [2, 3]) for (const irr of [0, 0.3, 0.6, 1]) for (const group of [0, 0.5, 1]) for (let seed = 1; seed <= 25; seed++) {
  const { tiles, rows, holes: h } = pack(sequence(posts, { group, seed }), { cols, irr, group, seed, maxRows: 40, min });
  assert.equal(tiles.length, all.length);
  assert.equal(new Set(tiles.map(t => t.f.id)).size, all.length);
  const seen = new Uint8Array(cols * rows);
  for (const t of tiles) {
    assert.ok(t.x >= 0 && t.x + t.w <= cols && t.y + t.h <= rows, 'off the grid');
    assert.ok(t.w >= min && t.h >= min, 'too small');
    const crop = t.w / t.h / t.f.aspect;
    worstCrop = Math.max(worstCrop, crop, 1 / crop);
    for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) {
      assert.equal(seen[x + y * cols], 0, 'overlap');
      seen[x + y * cols] = 1;
    }
  }
  assert.equal(seen.reduce((n, s) => n + !s, 0), h, 'hole count is wrong');
  // a free cell can only be at the foot of the grid, never with a frame below it
  for (let x = 0; x < cols; x++) for (let y = 1; y < rows; y++) assert.ok(seen[x + y * cols] <= seen[x + (y - 1) * cols], 'hole inside the grid');
  uneven += h > 0; runs++;
}
assert.ok(worstCrop < 2.5, `a frame is cropped ${worstCrop.toFixed(1)}× from its picture`);

// grouping: more of it keeps a post's frames closer together
const spreadAt = group => {
  let sum = 0, n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { tiles } = pack(sequence(posts, { group, seed }), { cols: 24, irr: 0.6, group, seed });
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
  const firstOf = order => pack(sequence(posts, { order, group, seed }), { cols: 24, irr: 0.6, group, seed }).tiles.toSorted((a, b) => a.y - b.y || a.x - b.x)[0].f.post;
  assert.equal(firstOf('chronological').id, posts.toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))[0].id);
  assert.equal(firstOf('alphabetical').id, posts.toSorted((a, b) => a.title.localeCompare(b.title))[0].id);
}

// the same seed gives the same grid; another gives another
const ids = seed => sequence(posts, { seed }).map(f => f.id).join();
assert.equal(ids(5), ids(5));
assert.notEqual(ids(5), ids(6));

console.log(`ok: ${runs} layouts (${uneven} with an uneven foot), worst crop ${worstCrop.toFixed(2)}×; post spread ${g0.toFixed(1)} → ${g5.toFixed(1)} → ${g1.toFixed(1)} cells as grouping rises`);
