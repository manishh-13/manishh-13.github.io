// Builds the island behind manishh-13.github.io. Pure and deterministic for a given seed (home is 13), so it runs in Node for tests too.
(function (root) {
  'use strict';
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash2(x, y, s) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct) { let f = 0, amp = 0.5, fr = 1, n = 0; for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, y * fr, s + i * 17); n += amp; amp *= 0.5; fr *= 2; } return f / n; }

  const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, TALL: 4, FOREST: 5, HILL: 6, MOUNT: 7, SNOW: 8, PATH: 9, BRIDGE: 10, RUNE: 11, SHADOW: 12, BUILD: 13, FLOWER: 14 };

  // "MANISH S" in the ANSI Shadow figlet font: full blocks are raised stone, the line characters are their shadow.
  const LETTERS = {
    M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
    A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
    I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
    S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
    H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
  };
  const NAME = [0, 1, 2, 3, 4, 5].map((r) => [...'MANISH S'].map((c) => LETTERS[c][r]).join(''));

  // Landmarks. Each is something built; entrance is the tile just below the bottom row at column `door`.
  const ART = {
    workshop: { door: 6, frames: [[
      '      _      ',
      '  ___| |___  ',
      ' /         \\ ',
      '/___________\\',
      '| []     [] |',
      '|    ___    |',
      '|___|   |___|']] },
    lighthouse: { door: 3, frames: [[
      '   ^   ',
      '  [*]  ',
      '  |█|  ',
      '  | |  ',
      '  |█|  ',
      '  | |  ',
      ' /___\\ ']] },
    windmill: { door: 3, frames: [[
      '   |   ',
      ' --o-- ',
      '   |   ',
      '  |=|  ',
      ' /|∩|\\ ',
      '/_|_|_\\'], [
      ' \\   / ',
      '   o   ',
      ' /   \\ ',
      '  |=|  ',
      ' /|∩|\\ ',
      '/_|_|_\\']] },
    xray: { door: 4, frames: [[
      '.-------.',
      '|  .-.  |',
      '| (o o) |',
      '|  |=|  |',
      '| /| |\\ |',
      '|  / \\  |',
      "'-------'"]] },
    chest: { door: 3, frames: [[
      ' ____ ',
      '|$$$$|',
      '|____|']] },
    campfire: { door: 1, solid: true, frames: [['   ', '===']] },
  };

  function makeWorld(seed) {
    seed = Number.isFinite(seed) ? seed | 0 : 13;
    const sE = seed - 10, sM = seed - 4, sV = seed + 64, sF = seed - 8;
    const W = 200, H = 124, N = W * H;
    const tile = new Uint8Array(N), vary = new Uint8Array(N), elev = new Float32Array(N), moist = new Float32Array(N);
    const buildAt = new Int16Array(N).fill(-1), artAt = new Int16Array(N).fill(-1);
    const I = (x, y) => y * W + x;
    const spawn = { x: 100, y: 72 };
    const nameW = NAME[0].length, nameH = NAME.length;
    const nameRect = { x: spawn.x - (nameW >> 1), y: spawn.y - 14, w: nameW, h: nameH };

    // terrain: an island from fractal noise, with a gentle clearing around the campfire and the carved name
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const nx = (x - W / 2) / (W / 2), ny = (y - H / 2) / (H / 2);
      const d = Math.sqrt(nx * nx * 0.92 + ny * ny * 1.08);
      let e = fbm(x / 34, y / 34, sE, 5) * 1.1 - d * d * 0.7 + 0.08;
      let m = fbm(x / 22 + 40, y / 22 + 40, sM, 4);
      const qx = (x - spawn.x) / 42, qy = (y - (spawn.y - 7)) / 14, q = qx * qx + qy * qy;
      if (q < 1) { const k = Math.min(1, (1 - q) * 2.5); e = e * (1 - k) + 0.47 * k; m = m * (1 - k) + 0.36 * k; }
      elev[I(x, y)] = e; moist[I(x, y)] = m; vary[I(x, y)] = Math.floor(hash2(x, y, sV) * 256);
    }
    const classify = (e, m, x, y) => {
      if (e < 0.30) return T.DEEP;
      if (e < 0.345) return T.SHALLOW;
      if (e < 0.375) return T.SAND;
      if (e < 0.6) {
        if (m > 0.56) return T.FOREST;
        if (m > 0.5) return T.TALL;
        return hash2(x, y, sF) < 0.02 ? T.FLOWER : T.GRASS;
      }
      if (e < 0.655) return T.HILL;
      if (e < 0.71) return T.MOUNT;
      return T.SNOW;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tile[I(x, y)] = classify(elev[I(x, y)], moist[I(x, y)], x, y);

    // the name, carved into the ground above the fire
    for (let r = 0; r < nameH; r++) for (let c = 0; c < nameW; c++) {
      const ch = NAME[r][c]; if (ch === ' ') continue;
      tile[I(nameRect.x + c, nameRect.y + r)] = ch === '█' ? T.RUNE : T.SHADOW;
    }

    const structures = [];
    const isLand = (t) => t === T.GRASS || t === T.TALL || t === T.FLOWER || t === T.SAND || t === T.FOREST || t === T.PATH;
    function stamp(id, x0, y0) {
      const art = ART[id], f = art.frames[0], w = f[0].length, h = f.length;
      for (let y = y0 - 1; y <= y0 + h + 1; y++) for (let x = x0 - 1; x <= x0 + w; x++) {
        const i = I(x, y); if (tile[i] !== T.RUNE && tile[i] !== T.SHADOW) tile[i] = (tile[i] === T.SAND ? T.SAND : T.GRASS);
      }
      // kind: 1 = a character in some frame (solid), 2 = floor enclosed by the outline (solid, drawn empty), 0 = open ground
      const kind = [];
      for (let y = 0; y < h; y++) {
        const row = new Uint8Array(w), a = f[y].search(/\S/), b = f[y].length - 1 - [...f[y]].reverse().join('').search(/\S/);
        for (let x = 0; x < w; x++) {
          if (art.solid || art.frames.some((fr) => fr[y][x] !== ' ')) row[x] = 1;
          else if (a >= 0 && x > a && x < b) row[x] = 2;
        }
        kind.push(row);
      }
      const s = { id, x: x0, y: y0, w, h, art, kind, door: { x: x0 + art.door, y: y0 + h } };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = I(x0 + x, y0 + y); artAt[i] = structures.length;
        if (kind[y][x]) { tile[i] = T.BUILD; buildAt[i] = structures.length; }
      }
      tile[I(s.door.x, s.door.y)] = T.PATH;
      structures.push(s);
      return s;
    }
    function fits(x0, y0, w, h) {
      if (x0 < 4 || y0 < 4 || x0 + w > W - 4 || y0 + h > H - 5) return false;
      for (let y = y0 - 2; y <= y0 + h + 2; y++) for (let x = x0 - 2; x <= x0 + w + 1; x++) if (!isLand(tile[I(x, y)])) return false;
      return true;
    }
    function site(id, tx, ty, radius) {
      const f = ART[id].frames[0], w = f[0].length, h = f.length;
      for (const r of [radius, Math.max(W, H)]) {
        let best = null, bestD = Infinity;
        for (let y0 = ty - r; y0 <= ty + r; y0++) for (let x0 = tx - r; x0 <= tx + r; x0++) {
          const d = Math.hypot(x0 - tx, y0 - ty); if (d >= bestD || !fits(x0, y0, w, h)) continue;
          bestD = d; best = [x0, y0];
        }
        if (best) return best;
      }
      return null;
    }
    const fire = stamp('campfire', spawn.x - 1, spawn.y - 1);
    const placed = { campfire: fire };
    const wanted = { workshop: [spawn.x - 30, spawn.y + 4], windmill: [spawn.x - 58, spawn.y - 32], xray: [spawn.x - 12, spawn.y + 20], chest: [spawn.x + 52, spawn.y - 46] };
    for (const [id, [tx, ty]] of Object.entries(wanted)) {
      const p = site(id, tx, ty, 18); if (p) placed[id] = stamp(id, p[0], p[1]);
    }
    // the lighthouse stands on the east coast: walk east from the fire until the land ends
    for (let x = spawn.x + 12; x < W - 8; x++) {
      const t = tile[I(x, spawn.y - 6)];
      if (t === T.SHALLOW || t === T.DEEP) { placed.lighthouse = stamp('lighthouse', x - 6, spawn.y - 12); break; }
    }

    // roads from the fire to every landmark (not to the chest: that one you have to find)
    const carveCost = (t) => t === T.BUILD ? Infinity : t === T.PATH ? 0.4 : t === T.DEEP ? 40 : t === T.SHALLOW ? 9 : t === T.MOUNT ? 30 : t === T.SNOW ? 60 : t === T.HILL ? 4 : t === T.FOREST ? 3 : t === T.RUNE || t === T.SHADOW ? 6 : 1;
    const roads = [];
    for (const id of ['workshop', 'lighthouse', 'windmill', 'xray']) {
      const s = placed[id]; if (!s) continue;
      const path = astar(W, H, spawn.x, spawn.y + 1, s.door.x, s.door.y, (x, y, i) => carveCost(tile[i]), false);
      if (!path) continue;
      for (const i of path) { const t = tile[i]; if (t === T.DEEP || t === T.SHALLOW) tile[i] = T.BRIDGE; else if (t !== T.RUNE && t !== T.SHADOW && t !== T.BUILD) tile[i] = T.PATH; }
      roads.push(path.length);
    }
    // make sure the chest is reachable on foot; if the island hides it too well, cut a faint trail
    if (placed.chest) {
      const walk = (x, y, i) => walkCost(tile[i]);
      if (!astar(W, H, spawn.x, spawn.y + 1, placed.chest.door.x, placed.chest.door.y, walk, true)) {
        const path = astar(W, H, spawn.x, spawn.y + 1, placed.chest.door.x, placed.chest.door.y, (x, y, i) => carveCost(tile[i]), false);
        if (path) for (const i of path) { const t = tile[i]; if (t === T.DEEP || t === T.SHALLOW) tile[i] = T.BRIDGE; else if (t === T.MOUNT || t === T.SNOW || t === T.HILL) tile[i] = T.PATH; }
      }
    }
    return { seed, W, H, T, tile, vary, buildAt, artAt, structures, placed, spawn, nameRect, roads, hash2, vnoise, fbm };
  }

  function walkCost(t) {
    if (t === T.DEEP || t === T.SHALLOW || t === T.MOUNT || t === T.SNOW || t === T.BUILD) return Infinity;
    if (t === T.PATH || t === T.BRIDGE) return 0.7;
    if (t === T.FOREST) return 1.6;
    if (t === T.HILL) return 1.4;
    return 1;
  }

  // A* on the grid. costFn returns Infinity for blocked tiles. Diagonals never cut corners.
  function astar(W, H, sx, sy, tx, ty, costFn, diag) {
    const N = W * H, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const hx = [], hi = [];
    const push = (f, i) => { hx.push(f); hi.push(i); let c = hx.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (hx[p] <= hx[c]) break; [hx[p], hx[c]] = [hx[c], hx[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; } };
    const pop = () => { const top = hi[0], lf = hx.pop(), li = hi.pop(); if (hx.length) { hx[0] = lf; hi[0] = li; let p = 0; for (;;) { const l = 2 * p + 1, r = l + 1; let m = p; if (l < hx.length && hx[l] < hx[m]) m = l; if (r < hx.length && hx[r] < hx[m]) m = r; if (m === p) break; [hx[p], hx[m]] = [hx[m], hx[p]]; [hi[p], hi[m]] = [hi[m], hi[p]]; p = m; } } return top; };
    const s = sy * W + sx, t = ty * W + tx;
    if (s === t) return [];
    g[s] = 0; push(Math.hypot(sx - tx, sy - ty), s);
    const dirs = diag ? [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]] : [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
    let guard = 0;
    while (hx.length && guard++ < 200000) {
      const cur = pop();
      if (cur === t) break;
      if (closed[cur]) continue; closed[cur] = 1;
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy, dc] of dirs) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx; if (closed[ni]) continue;
        const c = costFn(nx, ny, ni); if (!isFinite(c)) continue;
        if (dx && dy && (!isFinite(costFn(cx + dx, cy, cy * W + cx + dx)) || !isFinite(costFn(cx, cy + dy, (cy + dy) * W + cx)))) continue;
        const ng = g[cur] + c * dc;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ng + Math.hypot(nx - tx, ny - ty), ni); }
      }
    }
    if (came[t] === -1) return null;
    const path = []; for (let i = t; i !== s; i = came[i]) path.push(i); return path.reverse();
  }

  root.IslandGen = { makeWorld, astar, walkCost, T, ART, NAME, hash2, vnoise };
})(typeof window !== 'undefined' ? window : globalThis);
