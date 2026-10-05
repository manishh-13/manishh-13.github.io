// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
require('../gen.js');
const G = globalThis.IslandGen;
const walk = (w) => (x, y, i) => G.walkCost(w.tile[i]);

test('the home island is the same every time', () => {
  const a = G.makeWorld(13), b = G.makeWorld(13);
  assert.deepEqual(a.tile, b.tile);
  assert.equal(a.seed, 13);
});

test('every landmark is placed and every door can be reached on foot', () => {
  const w = G.makeWorld(13);
  assert.deepEqual(w.structures.map((s) => s.id).sort(), ['campfire', 'chest', 'lighthouse', 'windmill', 'workshop', 'xray']);
  for (const s of w.structures) {
    if (s.id === 'campfire') continue;
    const path = G.astar(w.W, w.H, w.spawn.x, w.spawn.y + 1, s.door.x, s.door.y, walk(w), true);
    assert.ok(path && path.length > 0, s.id + ' is reachable');
  }
  assert.equal(w.roads.length, 4, 'a road to each building except the chest');
});

test('the name is carved in full', () => {
  const w = G.makeWorld(13);
  const blocks = G.NAME.join('').split('').filter((c) => c === '█').length;
  assert.equal(w.tile.filter((t) => t === G.T.RUNE).length, blocks);
});

test('random islands still grow and stay walkable', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const w = G.makeWorld(seed);
    assert.ok(w.placed.campfire && w.placed.workshop, 'seed ' + seed + ' has a fire and a workshop');
    for (const s of w.structures) {
      if (s.id === 'campfire') continue;
      assert.ok(G.astar(w.W, w.H, w.spawn.x, w.spawn.y + 1, s.door.x, s.door.y, walk(w), true), 'seed ' + seed + ': ' + s.id + ' reachable');
    }
  }
});

test('a door with no way in is reported as unreachable', () => {
  const w = G.makeWorld(13), s = w.placed.lighthouse, D = s.door;
  // wall the door in with mountains: if A* still claims a route, the test above proves nothing
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    w.tile[(D.y + dy) * w.W + D.x + dx] = G.T.MOUNT;
  }
  const path = G.astar(w.W, w.H, w.spawn.x, w.spawn.y + 1, D.x, D.y, (x, y, i) => G.walkCost(w.tile[i]), true);
  assert.equal(path, null);
});
