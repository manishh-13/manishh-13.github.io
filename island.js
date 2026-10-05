// island.js: draws the IslandGen world as living ASCII on one canvas, and lets you walk it.
(() => {
  'use strict';
  const G = window.IslandGen, T = G.T, ART = G.ART, NAME = G.NAME, hash2 = G.hash2, vnoise = G.vnoise;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const OG = params.has('og');
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOUCH = matchMedia('(hover: none)').matches;
  const HOME = 13;
  const parseSeed = (v) => { const n = parseInt(v, 10); return n > 0 && n < 1e9 ? n : null; };

  // ------------------------------------------------------------------ the places (the plain list in index.html says the same)
  const GH = 'https://github.com/manishh-13';
  const PLACES = {
    workshop: { label: 'the workshop', title: "Hi, I'm Manish", tag: 'I build things to find out how they work.',
      body: 'Maps of the internet, simulators, little tools and, apparently, islands. Every building here is something I made, so wander around and open some doors.',
      chips: ['builder', 'explorer', 'tinkerer'], links: [['My GitHub', GH, true]] },
    windmill: { label: 'the windmill', title: 'Scaling Visualiser', tag: 'Watch serverless functions scale.',
      body: 'An interactive, browser-only simulation of how serverless functions scale when traffic hits: concurrency, cold starts, warm reuse, scaling rate and throttling. Turn the load up and watch it play out.',
      chips: ['React', 'TypeScript', 'simulation'],
      links: [['Open the visualiser', 'https://manishh-13.github.io/lambda-scaling-visualiser/', true], ['Source', GH + '/lambda-scaling-visualiser']] },
    xray: { label: 'the x-ray lab', title: 'URL X-Ray', tag: 'See the internet behind a link.',
      body: 'An evidence-first, interactive map of the public infrastructure behind a URL: live DNS records, the networks and organisations behind each address, and reverse DNS. Run it locally to add redirects, headers and TLS certificates.',
      chips: ['DNS', 'networking', 'TypeScript'],
      links: [['Open URL X-Ray', 'https://manishh-13.github.io/url-x-ray/', true], ['Source', GH + '/url-x-ray']] },
    lighthouse: { label: 'the lighthouse', title: 'IP Map', tag: 'Who owns this IP address?',
      body: "Every published IP range of the world's biggest cloud on one searchable map. Paste an address to see its region and service, browse its history back to 2015, or build an allowlist. It re-syncs itself every 30 minutes.",
      chips: ['Hilbert curve', 'IPv4 + IPv6', 'self-updating', 'static site'],
      links: [['Open IP Map', 'https://manishh-13.github.io/aws-ip-map/', true], ['Source', GH + '/aws-ip-map']] },
    chest: { label: 'a buried chest', title: 'You found the seed', tag: 'Every island grows from one number.', secret: true },
  };
  const ORDER = ['workshop', 'windmill', 'xray', 'lighthouse', 'chest'];

  // ------------------------------------------------------------------ canvas and cell metrics
  const cv = $('#world'), ctx = cv.getContext('2d', { alpha: false });
  const bgc = document.createElement('canvas'), bgx = bgc.getContext('2d');
  const FONT = '"SF Mono", ui-monospace, Menlo, Monaco, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
  let dpr = 1, vw = 0, vh = 0, fs = 16, cw = 9.6, ch = 17, asp = 0.56, zoom = 1, img = null;
  const baseFont = () => {
    if (OG) return Number(params.get('fs')) || 13;
    if (innerWidth < 640) return Math.max(9, Math.floor(innerWidth / 38));
    return Math.max(13, Math.min(24, Math.floor(Math.min(innerWidth / 74, innerHeight / 44))));
  };
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect(); vw = r.width; vh = r.height;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    fs = Math.max(7, Math.round(baseFont() * zoom));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = fs + 'px ' + FONT;
    cw = ctx.measureText('M').width || fs * 0.6;
    ch = Math.round(fs * 1.08);
    asp = cw / ch;
  }

  // ------------------------------------------------------------------ world state
  let world, W, H, N, tile, vary, artAt, S, byId, spawn, nameRect, seen, revealAt, shore, landN, seenN, found, seed;
  let player, cam, cat, clock = 0, dayT = 0.36, dirty = false, cardId = null;
  const particles = [], birds = [];
  const DAY = 300, DEC = 0.5, VR = 12.5, STEP = 0.075;
  const isWater = (t) => t === T.DEEP || t === T.SHALLOW;

  function load(sd, useSave) {
    seed = sd;
    world = G.makeWorld(seed);
    ({ W, H, tile, vary, artAt, spawn, nameRect } = world); N = W * H; S = world.structures;
    byId = {}; for (const s of S) byId[s.id] = s;
    seen = new Float32Array(N); revealAt = new Float32Array(N).fill(1e9); shore = new Uint8Array(N);
    closeCard(); landN = 0; seenN = 0; found = new Set(); particles.length = 0;
    for (let i = 0; i < N; i++) if (!isWater(tile[i])) landN++;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tile[i] === T.SHALLOW) for (const j of [i - 1, i + 1, i - W, i + W]) if (!isWater(tile[j]) && tile[j] !== T.BRIDGE) { shore[i] = 1; break; }
    }
    player = { x: spawn.x, y: spawn.y + 1, fx: spawn.x, fy: spawn.y + 1, path: [], next: 0, goal: null, moved: false, bump: 0 };
    const saved = useSave ? readSave() : null;
    if (saved) {
      for (let i = 0; i < N; i++) if (saved.bits[i >> 3] & (1 << (i & 7))) { seen[i] = 1; if (!isWater(tile[i])) seenN++; }
      for (const id of saved.found || []) if (byId[id]) found.add(id);
      if (saved.p && passable(saved.p[0], saved.p[1])) { player.x = player.fx = saved.p[0]; player.y = player.fy = saved.p[1]; }
      if (typeof saved.day === 'number' && saved.day >= 0 && saved.day < 1) dayT = saved.day;
    }
    const s = byId.workshop || byId.campfire;
    cat = { x: s.door.x + 2, y: s.door.y + 1, fx: s.door.x + 2, fy: s.door.y + 1, hx: s.door.x, hy: s.door.y + 2, next: 1, sit: 0, meow: 0 };
    if (!passable(cat.x, cat.y)) { cat.x = cat.fx = cat.hx = s.door.x; cat.y = cat.fy = cat.hy = s.door.y; }
    cam = { x: player.x + 0.5, y: Math.min(player.y, spawn.y) - (saved ? 0 : 4) };
    // the opening: the world decodes outward from where you stand
    const R0 = OG ? (Number(params.get('r')) || 90) : 22, ox = saved ? player.x : spawn.x, oy = saved ? player.y : spawn.y - 6;
    revealRadius(ox, oy, R0, (d, i) => (REDUCE || OG) ? -1 : clock + 0.1 + (d / R0) * 1.05 + hash2(i, 7, 3) * 0.25);
    if (saved) {
      for (let i = 0; i < N; i++) {
        if (seen[i] !== 1 || revealAt[i] < 1e8) continue;
        if (REDUCE) { revealAt[i] = -1; continue; }
        const d = Math.hypot((i % W - player.x) * asp, ((i / W) | 0) - player.y);
        revealAt[i] = clock + 0.12 + Math.min(d, 70) / 70 * 1.6 + hash2(i, 5, 3) * 0.3;
      }
    }
    for (const id of found) markFound(id, true);
    buildPlaces(); updateMeta(); dirty = true;
  }

  function revealRadius(cx, cy, R, when) {
    const rx = Math.ceil(R / asp) + 2, ry = Math.ceil(R) + 2;
    for (let y = Math.max(0, cy - ry); y <= Math.min(H - 1, cy + ry); y++) {
      const dy = y - cy;
      for (let x = Math.max(0, cx - rx); x <= Math.min(W - 1, cx + rx); x++) {
        const dx = (x - cx) * asp, d = Math.sqrt(dx * dx + dy * dy), v = Math.min(1, (R - d) / 3);
        if (v <= 0) continue;
        const i = y * W + x;
        if (v <= seen[i]) continue;
        if (seen[i] === 0) revealAt[i] = when ? when(d, i) : (REDUCE ? -1 : clock + hash2(x, y, 9) * 0.14);
        if (seen[i] < 0.5 && v >= 0.5 && !isWater(tile[i])) seenN++;
        seen[i] = v; dirty = true;
      }
    }
  }

  // ------------------------------------------------------------------ saves (home island only): a bitset of what you have seen
  const KEY = 'island:v1:' + HOME;
  function readSave() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!o || !o.seen) return null;
      const raw = atob(o.seen), bits = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bits[i] = raw.charCodeAt(i);
      return { bits, found: o.found, p: o.p, day: o.day };
    } catch { return null; }
  }
  function writeSave() {
    if (seed !== HOME || OG || !dirty) return; dirty = false;
    try {
      const bits = new Uint8Array(Math.ceil(N / 8)); for (let i = 0; i < N; i++) if (seen[i] >= 0.5) bits[i >> 3] |= 1 << (i & 7);
      let raw = ''; for (let i = 0; i < bits.length; i += 4096) raw += String.fromCharCode.apply(null, bits.subarray(i, i + 4096));
      localStorage.setItem(KEY, JSON.stringify({ seen: btoa(raw), found: [...found], p: [player.x, player.y], day: dayT }));
    } catch { /* private mode or storage full: exploring still works, it just will not be remembered */ }
  }

  const passable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && isFinite(G.walkCost(tile[y * W + x]));

  // ------------------------------------------------------------------ time of day: 0 dawn, 0.25 noon, 0.5 sunset, 0.75 midnight
  const AMB = [[0, 0.62, 0.52, 0.68], [0.06, 0.95, 0.86, 0.82], [0.12, 1, 1, 1], [0.38, 1, 0.98, 0.94], [0.46, 1.08, 0.86, 0.62], [0.52, 0.86, 0.54, 0.5],
    [0.57, 0.46, 0.4, 0.64], [0.63, 0.27, 0.32, 0.54], [0.88, 0.27, 0.32, 0.54], [0.95, 0.46, 0.4, 0.62], [1, 0.62, 0.52, 0.68]];
  const PHASES = [[0.06, 'dawn'], [0.18, 'morning'], [0.32, 'midday'], [0.43, 'afternoon'], [0.5, 'golden hour'], [0.55, 'sunset'], [0.62, 'dusk'], [0.8, 'night'], [0.94, 'small hours'], [1, 'dawn']];
  let ambR = 1, ambG = 1, ambB = 1, night = 0, beam = null, millFrame = 0;
  const phaseName = (d) => (PHASES.find((p) => d < p[0]) || PHASES[PHASES.length - 1])[1];
  function ambient(d) {
    for (let k = 1; k < AMB.length; k++) if (d <= AMB[k][0]) {
      const a = AMB[k - 1], b = AMB[k], f = (d - a[0]) / (b[0] - a[0]);
      ambR = a[1] + (b[1] - a[1]) * f; ambG = a[2] + (b[2] - a[2]) * f; ambB = a[3] + (b[3] - a[3]) * f; return;
    }
  }
  const LT = [];
  const addLight = (x, y, r, cr, cg, cb, p) => { if (p > 0.01) LT.push({ x, y, r, r2: r * r, cr, cg, cb, p }); };
  function setupLights(t) {
    ambient(dayT);
    night = Math.max(0, Math.min(1, (1 - (0.3 * ambR + 0.59 * ambG + 0.11 * ambB)) / 0.72));
    LT.length = 0; beam = null;
    const f = byId.campfire;
    if (f) addLight(f.x + 1.5, f.y + 0.5, 9.5, 1, 0.56, 0.22, (0.22 + night) * (0.84 + 0.16 * vnoise(t * 7, 3.3, 41)));
    addLight(player.fx + 0.5, player.fy + 0.5, 6, 1, 0.82, 0.55, 0.75 * night);
    const lh = byId.lighthouse;
    if (lh) { addLight(lh.x + 3.5, lh.y + 1.5, 5, 1, 0.92, 0.62, 1.1 * night); if (night > 0.05 && !REDUCE) beam = { x: lh.x + 3.5, y: lh.y + 1.5, a: t * 0.55, p: night }; }
    const ws = byId.workshop; if (ws) addLight(ws.x + 6.5, ws.y + 5, 7, 1, 0.76, 0.4, 0.55 * night);
    const xr = byId.xray; if (xr) addLight(xr.x + 4.5, xr.y + 3.5, 7, 0.35, 0.9, 1, 0.6 * night);
    const wm = byId.windmill; if (wm) addLight(wm.x + 3.5, wm.y + 4.5, 4, 1, 0.8, 0.45, 0.35 * night);
    const cs = byId.chest; if (cs && found.has('chest')) addLight(cs.x + 3, cs.y + 1.5, 4, 1, 0.82, 0.35, 0.5 * night);
  }
  function beamAt(x, y) {
    const dx = (x + 0.5 - beam.x) * asp, dy = y + 0.5 - beam.y, d2 = dx * dx + dy * dy;
    if (d2 < 2.25 || d2 > 2116) return 0;
    const d = Math.sqrt(d2);
    let da = Math.atan2(dy, dx) - beam.a; da = (((da + Math.PI) % 6.2832) + 6.2832) % 6.2832 - Math.PI;
    const wd = 0.085 + 0.6 / d, ad = Math.abs(da); if (ad > wd) return 0;
    const q = 1 - ad / wd; return q * q * (1 - d / 46) * beam.p * 0.95;
  }

  // ------------------------------------------------------------------ what each cell looks like (glyph, fg, bg, emissive) before light
  let gch = ' ', fr = 0, fg = 0, fb = 0, br = 0, bgn = 0, bb = 0, em = 0, crisp = false;
  const FLOWERS = [[255, 128, 168], [255, 214, 96], [186, 148, 255], [246, 246, 246], [255, 156, 96]];
  const SAND = ['.', '·', '.', ':', ' ', '.', '·', ','], GR = [',', '.', ',', "'"];
  const GL = '01<>/\\|=+*#%&$?!;:{}[]';
  const water = (x, y, t) => 0.62 * vnoise(x * 0.16 + t * 0.34, y * 0.45 - t * 0.07, 11) + 0.38 * vnoise(x * 0.05 - t * 0.11, y * 0.16 + t * 0.04, 12);
  const wind = (x, y, t) => vnoise(x * 0.06 - t * 0.55, y * 0.1 + t * 0.12, 21);
  function grass(x, y, v, t, tall) {
    const k = Math.max(0, Math.min(1, (wind(x, y, t) - 0.48) * 3));
    if (tall) { gch = k > 0.55 ? '/' : '"'; fr = 128 + 70 * k; fg = 180 + 46 * k; fb = 74 + 56 * k; br = 26; bgn = 58; bb = 24; }
    else { gch = k > 0.6 ? ((v & 1) ? "'" : '`') : GR[v & 3]; fr = 86 + (v & 15) + 80 * k; fg = 150 + (v & 15) + 60 * k; fb = 60 + 50 * k; br = 20; bgn = 48; bb = 20; }
  }
  function look(x, y, i, t) {
    em = 0; crisp = false;
    const a = artAt[i];
    if (a >= 0 && lookArt(S[a], x - S[a].x, y - S[a].y, t)) { crisp = true; return; }
    const v = vary[i];
    switch (tile[i]) {
      case T.DEEP: {
        const w = water(x, y, t);
        br = 8 + 12 * w; bgn = 22 + 26 * w; bb = 46 + 34 * w;
        if (w > 0.71) { gch = '≈'; fr = 96; fg = 156; fb = 212; }
        else if (w > 0.6) { gch = '~'; fr = 54; fg = 106; fb = 164; }
        else if (v < 2 && night < 0.5 && Math.sin(t * 3 + v * 40 + x) > 0.96) { gch = '·'; fr = 220; fg = 236; fb = 255; }
        else gch = ' ';
        return;
      }
      case T.SHALLOW: {
        const w = water(x, y, t);
        br = 18 + 18 * w; bgn = 64 + 32 * w; bb = 94 + 32 * w;
        if (shore[i] && Math.sin(t * 1.8 - (v & 15) * 0.25 + x * 0.21 + y * 0.13) > 0.55) { gch = (v & 1) ? '°' : '·'; fr = 222; fg = 242; fb = 250; }
        else if (w > 0.66) { gch = '≈'; fr = 140; fg = 210; fb = 232; }
        else if (w > 0.5) { gch = '~'; fr = 112; fg = 188; fb = 220; }
        else gch = ' ';
        return;
      }
      case T.SAND: gch = SAND[v & 7]; fr = 214; fg = 194; fb = 144; br = 92; bgn = 78; bb = 48; return;
      case T.GRASS: case T.BUILD: grass(x, y, v, t, false); return;
      case T.TALL: grass(x, y, v, t, true); return;
      case T.FLOWER: { grass(x, y, v, t, false); const c = FLOWERS[v % 5]; fr = c[0]; fg = c[1]; fb = c[2]; gch = wind(x, y, t) > 0.64 ? '+' : '*'; return; }
      case T.FOREST: { const k = Math.max(0, wind(x, y, t) - 0.5) * 0.9; gch = v < 178 ? '♣' : '♠'; fr = 38 + (v & 15) + 50 * k; fg = 110 + (v & 31) + 60 * k; fb = 50 + 30 * k; br = 12; bgn = 34; bb = 18; return; }
      case T.HILL: gch = '∩'; fr = 168; fg = 158; fb = 104; br = 52; bgn = 52; bb = 30; return;
      case T.MOUNT: gch = v < 90 ? '▲' : '^'; fr = 176; fg = 176; fb = 186; br = 56; bgn = 56; bb = 62; return;
      case T.SNOW: gch = v < 128 ? '▲' : '^'; fr = 248; fg = 250; fb = 255; br = 128; bgn = 134; bb = 150; return;
      case T.PATH: gch = (v & 7) === 0 ? ':' : '·'; fr = 200; fg = 168; fb = 116; br = 74; bgn = 58; bb = 36; return;
      case T.BRIDGE: gch = '='; fr = 190; fg = 138; fb = 82; br = 56; bgn = 38; bb = 22; return;
      case T.RUNE: {
        gch = '█';
        const m = (v & 127) < 5, j = (v & 3) * 3;
        fr = (m ? 188 : 214) + j; fg = (m ? 198 : 208) + j; fb = (m ? 162 : 194) + j;
        if (night > 0) { const g = night * (0.72 + 0.28 * Math.sin(t * 1.1 - x * 0.12)); fr += (150 - fr) * g; fg += (236 - fg) * g; fb += (255 - fb) * g; em = g; }
        br = fr * 0.8; bgn = fg * 0.8; bb = fb * 0.8; return;
      }
      case T.SHADOW: gch = NAME[y - nameRect.y][x - nameRect.x]; fr = 104; fg = 110; fb = 98; br = 12; bgn = 26; bb = 13; if (night > 0) { fr += 10 * night; fg += 60 * night; fb += 90 * night; } return;
      default: gch = '?'; fr = fg = fb = 255; br = bgn = bb = 0;
    }
  }
  function lookArt(s, lx, ly, t) {
    const k = s.kind[ly][lx]; if (!k) return false;
    const frames = s.art.frames, c = frames[frames.length > 1 ? millFrame % frames.length : 0][ly][lx], id = s.id;
    if (id === 'campfire') {
      br = 34; bgn = 16; bb = 8;
      if (ly === 0) {
        const f1 = vnoise(lx * 1.9 + 3, t * 9, 43);
        gch = lx === 1 ? (f1 > 0.5 ? '^' : '*') : lx === 0 ? (f1 > 0.45 ? '(' : "'") : (f1 > 0.45 ? ')' : '`');
        const hot = lx === 1 ? 1 : 0.6 + 0.4 * f1; fr = 255; fg = 120 + 120 * hot; fb = 40 + 90 * hot * hot; em = 1; br = 70; bgn = 26; bb = 8;
      } else { gch = '='; fr = 156; fg = 96; fb = 54; }
      return true;
    }
    if (id === 'workshop') {
      if (k === 2) {
        gch = ' ';
        if (ly === 1) { br = 60; bgn = 30; bb = 24; } else if (ly <= 3) { br = 150; bgn = 68; bb = 46; }
        else { br = 58; bgn = 42; bb = 28; if (night > 0) { br += 70 * night; bgn += 44 * night; bb += 12 * night; em = 0.5 * night; } }
        return true;
      }
      if (c === ' ') return false;
      gch = c; br = 30; bgn = 26; bb = 20;
      if (ly <= 1 && lx >= 5 && lx <= 7) { fr = 182; fg = 96; fb = 70; }
      else if (ly <= 3) { fr = 214; fg = 106; fb = 72; br = 70; bgn = 34; bb = 24; }
      else if (c === '[' || c === ']') { if (night > 0.3) { fr = 255; fg = 216; fb = 124; em = night; } else { fr = 150; fg = 196; fb = 232; } }
      else if (ly === 5 && c === '_') { fr = 176; fg = 124; fb = 82; }
      else { fr = 214; fg = 166; fb = 106; }
      return true;
    }
    if (id === 'lighthouse') {
      if (k === 2) { gch = ' '; br = 226; bgn = 226; bb = 232; return true; }
      if (c === ' ') return false;
      gch = c; br = 20; bgn = 44; bb = 22;
      if (c === '^') { fr = 226; fg = 74; fb = 64; }
      else if (c === '[' || c === ']') { fr = 196; fg = 200; fb = 210; }
      else if (c === '*') { const p = 0.78 + 0.22 * Math.sin(t * 4); fr = 255; fg = 20 + 220 * p; fb = 150 * p; em = 0.6 + 0.4 * night; br = 90; bgn = 76; bb = 30; }
      else if (c === '█') { fr = 214; fg = 60; fb = 54; }
      else if (c === '|') { fr = 236; fg = 236; fb = 240; }
      else { fr = 172; fg = 166; fb = 158; }
      return true;
    }
    if (id === 'windmill') {
      if (c === ' ') return false;
      gch = c; br = 20; bgn = 46; bb = 20;
      if (ly <= 2) { if (c === 'o') { fr = 214; fg = 172; fb = 110; } else { fr = 240; fg = 236; fb = 226; } }
      else if (c === '∩') { fr = 255; fg = 200; fb = 96; em = 0.7 * night; }
      else if (c === '=') { fr = 196; fg = 154; fb = 104; }
      else { fr = 206; fg = 176; fb = 130; }
      return true;
    }
    if (id === 'xray') {
      const inside = lx > 0 && lx < s.w - 1 && ly > 0 && ly < s.h - 1, scan = ly === 1 + (Math.floor(t * 2.2) % (s.h - 2));
      if (inside) { br = 6; bgn = scan ? 92 : 44; bb = scan ? 104 : 52; em = 0.32 + 0.45 * night; }
      if (k === 2) { gch = ' '; return true; }
      gch = c;
      if (inside) { fr = 226; fg = 250; fb = 255; em = 0.55 + 0.45 * night; } else { fr = 128; fg = 204; fb = 216; br = 18; bgn = 38; bb = 42; }
      return true;
    }
    if (id === 'chest') {
      if (c === ' ') return false;
      gch = c; br = 26; bgn = 40; bb = 22;
      if (c === '$') { const p = 0.7 + 0.3 * Math.sin(t * 5 + lx); fr = 255; fg = 30 + 200 * p; fb = 80 * p; em = 0.4 + 0.5 * night; } else { fr = 178; fg = 116; fb = 62; }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ drawing
  let gX = new Float32Array(1), gY = new Float32Array(1), gC = new Int32Array(1), gS = [], gn = 0, cX = new Float32Array(1), cY = new Float32Array(1), cK = new Int32Array(1), cn = 0;
  const qkey = (r, g, b) => (Math.max(0, Math.min(31, r >> 3)) << 10) | (Math.max(0, Math.min(31, g >> 3)) << 5) | Math.max(0, Math.min(31, b >> 3));
  const colorCache = new Array(32768);
  const colorStr = (k) => colorCache[k] || (colorCache[k] = 'rgb(' + (((k >> 10) & 31) * 8 + 4) + ',' + (((k >> 5) & 31) * 8 + 4) + ',' + ((k & 31) * 8 + 4) + ')');
  function pushGlyph(s, X, Y, r, g, b) {
    if (r < 10 && g < 10 && b < 10) return;
    const q = (Math.min(31, r >> 3) << 10) | (Math.min(31, g >> 3) << 5) | Math.min(31, b >> 3);
    gX[gn] = X; gY[gn] = Y; gC[gn] = q; gS[gn] = s; gn++;
  }
  const BOX = { '═': 1, '║': 1, '╗': 1, '╔': 1, '╝': 1, '╚': 1 };
  function drawBox(s, X, Y) {
    const g = Math.max(1, cw * 0.2), lw = Math.max(1, Math.round(cw * 0.12)), cx = X + cw / 2, cy = Y + ch / 2, R = X + cw + 0.5, B = Y + ch + 0.5, e = lw / 2;
    const hl = (x1, x2, y) => ctx.fillRect(Math.min(x1, x2), y - e, Math.abs(x2 - x1), lw);
    const vl = (y1, y2, x) => ctx.fillRect(x - e, Math.min(y1, y2), lw, Math.abs(y2 - y1));
    if (s === '═') { hl(X, R, cy - g); hl(X, R, cy + g); }
    else if (s === '║') { vl(Y, B, cx - g); vl(Y, B, cx + g); }
    else if (s === '╗') { hl(X, cx + g + e, cy - g); vl(cy - g, B, cx + g); hl(X, cx - g + e, cy + g); vl(cy + g, B, cx - g); }
    else if (s === '╔') { hl(cx - g - e, R, cy - g); vl(cy - g, B, cx - g); hl(cx + g - e, R, cy + g); vl(cy + g, B, cx + g); }
    else if (s === '╝') { hl(X, cx + g + e, cy + g); vl(Y, cy + g, cx + g); hl(X, cx - g + e, cy - g); vl(Y, cy - g, cx - g); }
    else if (s === '╚') { hl(cx - g - e, R, cy + g); vl(Y, cy + g, cx - g); hl(cx + g - e, R, cy - g); vl(Y, cy - g, cx + g); }
  }
  let hover = null, frameMs = 0;
  function render(t) {
    const t0 = performance.now();
    setupLights(t);
    const camL = cam.x - vw / 2 / cw, camT = cam.y - vh / 2 / ch;
    const x0 = Math.floor(camL) - 1, y0 = Math.floor(camT) - 1, nc = Math.ceil(vw / cw) + 3, nr = Math.ceil(vh / ch) + 3;
    const ox = (x0 - camL) * cw, oy = (y0 - camT) * ch;
    if (!img || img.width !== nc || img.height !== nr) {
      bgc.width = nc; bgc.height = nr; img = bgx.createImageData(nc, nr);
      gX = new Float32Array(nc * nr); gY = new Float32Array(nc * nr); gC = new Int32Array(nc * nr); gS = new Array(nc * nr);
      cX = new Float32Array(nc * nr); cY = new Float32Array(nc * nr); cK = new Int32Array(nc * nr);
    }
    const px = img.data, pcx = Math.round(player.fx), pcy = Math.round(player.fy), kx = Math.round(cat.fx), ky = Math.round(cat.fy);
    const cloudy = night < 0.6, nr0 = nameRect, nx1 = nr0.x + nr0.w - 1, ny1 = nr0.y + nr0.h - 1;
    gn = 0; cn = 0;
    for (let r = 0; r < nr; r++) {
      const y = y0 + r, Y = oy + r * ch;
      for (let c = 0; c < nc; c++) {
        const x = x0 + c, X = ox + c * cw, o = (r * nc + c) * 4;
        let vis = 0, i = -1, bm = 0;
        if (x >= 0 && y >= 0 && x < W && y < H) { i = y * W + x; if (clock >= revealAt[i]) vis = seen[i]; if (beam) bm = beamAt(x, y); }
        if (vis <= 0 && bm < 0.04) {
          px[o] = 6; px[o + 1] = 8; px[o + 2] = 14; px[o + 3] = 255;
          const hs = hash2(x, y, 999);
          if (hs < 0.016) { const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * (0.5 + hs * 90) + hs * 4000)), k = (hs < 0.0018 ? 235 : 150) * tw; pushGlyph(hs < 0.0018 ? '+' : '.', X, Y, k * 0.86, k * 0.9, k); }
          continue;
        }
        if (vis <= 0) vis = Math.min(0.8, bm * 1.25);
        look(x, y, i, t);
        let lr = ambR, lg = ambG, lb = ambB;
        if (cloudy) { const cl = vnoise(x * 0.022 - t * 0.05, y * 0.045 - t * 0.018, 31); if (cl > 0.58) { const q = 1 - Math.min(1, (cl - 0.58) * 5) * 0.26 * (1 - night); lr *= q; lg *= q; lb *= q; } }
        for (let k = 0; k < LT.length; k++) {
          const L = LT[k], dx = (x + 0.5 - L.x) * asp, dy = y + 0.5 - L.y, d2 = dx * dx + dy * dy;
          if (d2 < L.r2) { const q = 1 - Math.sqrt(d2) / L.r, p = q * q * L.p; lr += L.cr * p; lg += L.cg * p; lb += L.cb * p; }
        }
        if (bm > 0) { lr += bm; lg += bm * 0.93; lb += bm * 0.7; }
        if (night > 0 && y >= nr0.y - 4 && y <= ny1 + 4 && x >= nr0.x - 7 && x <= nx1 + 7) {
          const ddx = Math.max(nr0.x - x, 0, x - nx1) * asp, ddy = Math.max(nr0.y - y, 0, y - ny1), d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < 3.5) { const q = 1 - d / 3.5, p = q * q * 0.5 * night * (0.8 + 0.2 * Math.sin(t * 1.1 - x * 0.12)); lr += 0.35 * p; lg += 0.75 * p; lb += p; }
        }
        if (em > 0) { if (lr < em) lr = em; if (lg < em) lg = em; if (lb < em) lb = em; }
        let FR = fr * lr * vis, FG = fg * lg * vis, FB = fb * lb * vis;
        let BR = 6 + (br * lr - 6) * vis, BG = 8 + (bgn * lg - 8) * vis, BB = 14 + (bb * lb - 14) * vis;
        const age = clock - revealAt[i];
        if (age >= 0 && age < DEC) {
          const gl = 1 - age / DEC;
          BR = BR + (6 - BR) * gl; BG = BG + (8 - BG) * gl; BB = BB + (14 - BB) * gl;
          if (gl > 0.32) { gch = GL[(((hash2(x, y, 5) * 97) | 0) + ((t * 18) | 0)) % GL.length]; FR = 70 * gl + 30; FG = 250 * gl; FB = 190 * gl + 20; }
          else { const q = gl / 0.32; FR += (90 - FR) * q; FG += (250 - FG) * q; FB += (200 - FB) * q; }
        }
        px[o] = BR; px[o + 1] = BG; px[o + 2] = BB; px[o + 3] = 255;
        if (crisp) { cX[cn] = X; cY[cn] = Y; cK[cn] = qkey(BR, BG, BB); cn++; }
        if (gch !== ' ' && !(x === pcx && y === pcy) && !(x === kx && y === ky)) pushGlyph(gch, X, Y, FR, FG, FB);
      }
    }
    bgx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bgc, 0, 0, nc, nr, ox, oy, nc * cw, nr * ch);
    for (let k = 0; k < cn; k++) { ctx.fillStyle = colorStr(cK[k]); ctx.fillRect(cX[k], cY[k], cw + 0.6, ch + 0.6); }
    const sx = (x) => (x - camL) * cw, sy = (y) => (y - camT) * ch;
    // breadcrumbs for a click-to-walk route
    if (player.path.length) {
      ctx.fillStyle = 'rgba(255, 207, 107, 0.22)';
      for (let k = 0; k < Math.min(90, player.path.length); k++) { const i = player.path[k]; ctx.fillRect(sx(i % W) + cw * 0.3, sy((i / W) | 0) + ch * 0.38, cw * 0.4, ch * 0.24); }
    }
    ctx.font = fs + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const yf = ch / 2 + fs * 0.04, xf = cw / 2;
    let last = -1;
    for (let k = 0; k < gn; k++) {
      const q = gC[k]; if (q !== last) { ctx.fillStyle = colorStr(q); last = q; }
      const s = gS[k];
      if (s === '█') ctx.fillRect(gX[k], gY[k], cw + 0.6, ch + 0.6);
      else if (BOX[s]) drawBox(s, gX[k], gY[k]);
      else ctx.fillText(s, gX[k] + xf, gY[k] + yf);
    }
    drawLife(t, sx, sy, yf, xf);
    frameMs = frameMs * 0.92 + (performance.now() - t0) * 0.08;
  }
  function seenAt(x, y) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return 0; const i = y * W + x; return clock >= revealAt[i] ? seen[i] : 0; }
  function drawLife(t, sx, sy, yf, xf) {
    const lit = (v) => Math.min(255, v * (0.35 + 0.65 * (1 - night)));
    for (const p of particles) {
      const a = 1 - p.age / p.life, vis = seenAt(p.x, p.y); if (vis <= 0) continue;
      let col, g;
      if (p.kind === 'spark') { g = a > 0.6 ? '*' : a > 0.3 ? "'" : '.'; col = 'rgba(255,' + (90 + 150 * a | 0) + ',' + (40 + 60 * a | 0) + ',' + (a * vis).toFixed(2) + ')'; }
      else if (p.kind === 'smoke') { g = a > 0.66 ? 'o' : a > 0.33 ? '°' : '.'; const v = lit(200) | 0; col = 'rgba(' + v + ',' + v + ',' + (v + 10) + ',' + (a * 0.8 * vis).toFixed(2) + ')'; }
      else { g = p.g; col = 'rgba(' + p.c[0] + ',' + p.c[1] + ',' + p.c[2] + ',' + (Math.min(1, a * 1.5) * vis).toFixed(2) + ')'; }
      ctx.fillStyle = col; ctx.fillText(g, sx(p.x) + xf, sy(p.y) + yf);
    }
    if (night < 0.55) for (const b of birds) {
      const flap = Math.floor(t * 5 + b.ph) & 1;
      for (const [dx, dy] of b.m) { const x = b.x + dx, y = b.y + dy, vis = seenAt(x, y); if (vis <= 0) continue; ctx.fillStyle = 'rgba(24,26,34,' + (0.85 * vis * (1 - night)).toFixed(2) + ')'; ctx.fillText(flap ? 'v' : '^', sx(x) + xf, sy(y) + yf); }
    }
    const cv2 = seenAt(cat.fx, cat.fy);
    if (cv2 > 0) {
      ctx.fillStyle = 'rgba(' + lit(255) + ',' + lit(170) + ',' + lit(84) + ',' + cv2 + ')'; ctx.fillText('c', sx(cat.fx) + xf, sy(cat.fy) + yf);
      if (cat.meow > 0) { ctx.save(); ctx.font = Math.round(fs * 0.8) + 'px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, cat.meow).toFixed(2) + ')'; ctx.fillText('meow', sx(cat.fx) + xf, sy(cat.fy - 1.1) + yf); ctx.restore(); }
    }
    // you
    const bx = player.bump > 0 ? Math.sin(player.bump * 60) * 2 * player.bump * 4 : 0;
    ctx.save(); ctx.shadowColor = 'rgba(255, 214, 120, 0.95)'; ctx.shadowBlur = 8 + 10 * night; ctx.fillStyle = '#fff3c8';
    ctx.font = 'bold ' + fs + 'px ' + FONT; ctx.fillText('@', sx(player.fx) + xf + bx, sy(player.fy) + yf); ctx.restore();
    if (hover) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(sx(hover[0])) + 0.5, Math.round(sy(hover[1])) + 0.5, Math.round(cw) - 1, Math.round(ch) - 1);
    }
  }

  // ------------------------------------------------------------------ HUD: places, clock, toasts, tooltip, minimap
  const hud = $('#hud'), placesEl = $('#places'), exploredEl = $('#explored'), clockEl = $('#clock'), hintEl = $('#hint');
  const card = $('#card'), tip = $('#tip'), toastEl = $('#toast'), mini = $('#mini'), mctx = mini.getContext('2d');
  const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function buildPlaces() {
    placesEl.textContent = '';
    for (const id of ORDER) {
      if (!byId[id]) continue;
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.dataset.id = id;
      b.innerHTML = '<span class="dot"></span><span class="name"></span><span class="dir"></span><span class="meta"></span>';
      b.addEventListener('click', (e) => goToPlace(id, true, e.detail === 0));
      li.appendChild(b); placesEl.appendChild(li);
    }
    refreshPlaces();
  }
  function refreshPlaces() {
    for (const b of placesEl.querySelectorAll('button')) {
      const id = b.dataset.id, P = PLACES[id], f = found.has(id), secret = P.secret && !f;
      b.parentElement.className = (f ? 'found' : '') + (secret ? ' secret' : '');
      b.querySelector('.dot').textContent = f ? '◆' : '◇';
      b.querySelector('.name').textContent = secret ? '???' : P.title;
      b.querySelector('.meta').textContent = secret ? 'somewhere out there' : P.label + (f ? '' : ', not found yet');
      b.setAttribute('aria-label', secret ? 'A secret place, not found yet' : 'Walk to ' + P.label + ': ' + P.title);
    }
    updateMeta();
  }
  function updateMeta() {
    for (const b of placesEl.querySelectorAll('button')) {
      const id = b.dataset.id, s = byId[id], el = b.querySelector('.dir');
      if (PLACES[id].secret && !found.has(id)) { el.textContent = ''; continue; }
      const dx = s.door.x - player.x, dy = s.door.y - player.y, d = Math.max(Math.abs(dx), Math.abs(dy));
      el.textContent = d <= 1 ? 'here' : ARROWS[(Math.round(Math.atan2(dy, dx * asp) / (Math.PI / 4)) + 8) % 8] + ' ' + d;
    }
    exploredEl.textContent = Math.min(100, Math.floor(100 * seenN / Math.max(1, landN))) + '% explored';
  }
  let toastTimer = 0;
  function toast(html, ms = 2800) { toastEl.innerHTML = html; toastEl.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms); }
  const updateClock = () => { clockEl.innerHTML = (dayT < 0.56 || dayT > 0.96 ? '☼ ' : '☾ ') + '<b>' + phaseName(dayT) + '</b>'; };
  const skipTime = () => { dayT = (dayT + 0.12) % 1; updateClock(); };
  const TNAME = { [T.DEEP]: 'deep water', [T.SHALLOW]: 'shallow water', [T.SAND]: 'sand', [T.GRASS]: 'meadow', [T.TALL]: 'tall grass', [T.FOREST]: 'forest',
    [T.HILL]: 'hills', [T.MOUNT]: 'mountains', [T.SNOW]: 'snowy peaks', [T.PATH]: 'a path', [T.BRIDGE]: 'a rickety bridge', [T.FLOWER]: 'wildflowers', [T.BUILD]: 'meadow' };
  function describe(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 'the edge of the world';
    if (seenAt(x, y) < 0.3) return 'unexplored';
    if (x === player.x && y === player.y) return 'you';
    if (x === Math.round(cat.fx) && y === Math.round(cat.fy)) return 'a cat. it lives here.';
    const i = y * W + x, a = artAt[i];
    if (a >= 0 && S[a].kind[y - S[a].y][x - S[a].x]) {
      const id = S[a].id; if (id === 'campfire') return 'the campfire, where you started';
      const P = PLACES[id]; return P.label + ': ' + P.title + ' · click to go';
    }
    if (tile[i] === T.RUNE || tile[i] === T.SHADOW) return 'MANISH S, carved in stone';
    return TNAME[tile[i]] || '';
  }
  function showTip(cx, cy, text) {
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text; tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(cx + 14, vw - tip.offsetWidth - 8)) + 'px'; tip.style.top = Math.min(cy + 18, vh - 34) + 'px';
  }
  const MINI = { [T.DEEP]: [16, 40, 72], [T.SHALLOW]: [40, 96, 130], [T.SAND]: [200, 180, 130], [T.GRASS]: [74, 140, 60], [T.TALL]: [100, 160, 70], [T.FOREST]: [34, 96, 46],
    [T.HILL]: [140, 130, 90], [T.MOUNT]: [150, 150, 160], [T.SNOW]: [240, 244, 250], [T.PATH]: [200, 168, 116], [T.BRIDGE]: [190, 138, 82], [T.RUNE]: [232, 228, 216],
    [T.SHADOW]: [40, 60, 44], [T.BUILD]: [255, 207, 107], [T.FLOWER]: [200, 140, 160] };
  let mimg = null;
  function drawMini() {
    if (mini.classList.contains('off') || !mini.offsetWidth) return;
    if (!mimg || mimg.width !== W || mimg.height !== H) { mini.width = W; mini.height = H; mimg = mctx.createImageData(W, H); }
    const d = mimg.data;
    for (let i = 0; i < N; i++) {
      const o = i * 4, s = clock >= revealAt[i] ? seen[i] : 0, c = MINI[tile[i]];
      d[o] = 6 + (c[0] - 6) * s; d[o + 1] = 8 + (c[1] - 8) * s; d[o + 2] = 14 + (c[2] - 14) * s; d[o + 3] = 255;
    }
    mctx.putImageData(mimg, 0, 0);
    mctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'; mctx.lineWidth = 1;
    mctx.strokeRect(Math.round(cam.x - vw / cw / 2) + 0.5, Math.round(cam.y - vh / ch / 2) + 0.5, Math.round(vw / cw), Math.round(vh / ch));
    mctx.fillStyle = (clock * 3 | 0) & 1 ? '#ffffff' : '#ffcf6b'; mctx.fillRect(player.x - 1, player.y - 1, 3, 3);
  }

  // ------------------------------------------------------------------ discovery and project cards
  function checkFound() {
    for (const s of S) {
      if (s.id === 'campfire' || found.has(s.id)) continue;
      const i = (s.y + (s.h >> 1)) * W + s.x + (s.w >> 1);
      if (seen[i] >= 0.6 && clock >= revealAt[i] + DEC * 0.6) markFound(s.id);
    }
  }
  function markFound(id, quiet) {
    if (found.has(id) && !quiet) return;
    found.add(id); dirty = true;
    if (quiet) return;
    const P = PLACES[id];
    toast(id === 'chest' ? 'You spotted <b>a buried chest</b>. Go and open it.' : 'Discovered <b>' + P.label + '</b>: ' + esc(P.title));
    if (ORDER.every((k) => found.has(k) || !byId[k])) setTimeout(() => toast('<b>Every place found.</b> You are a proper explorer.', 3600), 3000);
    refreshPlaces();
  }
  let chestOpened = false, burstDone = false, focusNext = false, returnFocus = null;
  const rollUnlocked = () => { try { return chestOpened || localStorage.getItem('island:roll') === '1'; } catch { return chestOpened; } };
  function openCard(id) {
    const P = PLACES[id]; if (!P || !byId[id]) return;
    if (!found.has(id)) markFound(id);
    cardId = id; hud.classList.add('carding');
    if (id === 'chest') { chestOpened = true; try { localStorage.setItem('island:roll', '1'); } catch { /* fine */ } }
    let body, links;
    if (id === 'chest') {
      body = '<p>This one grew from <b>' + seed + '</b>' + (seed === HOME ? ', like the handle' : '') + '. The coast, the mountains, every tree and every road come out of that number. Change it and you get a whole new world. From now on <kbd>R</kbd> rolls one too.</p>';
      links = '<button class="btn primary" data-act="roll">Roll a new island</button>' + (seed !== HOME ? '<button class="btn" data-act="home">Go home</button><button class="btn" data-act="share">Copy link</button>' : '');
      if (!burstDone) { burstDone = true; burst(byId.chest); }
    } else {
      body = '<p>' + esc(P.body) + '</p><ul class="chips">' + P.chips.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
      links = P.links.map(([t, u, primary]) => '<a class="btn' + (primary ? ' primary' : '') + '" href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + (primary ? ' ↗' : '') + '</a>').join('');
    }
    card.innerHTML = '<button class="close" type="button" aria-label="Close" data-act="close">' + (TOUCH ? 'close' : 'esc') + '</button><pre class="art" aria-hidden="true">' + esc(ART[id].frames[0].join('\n')) + '</pre>'
      + '<p class="kicker">' + esc(P.label) + '</p><p class="title" id="cardTitle">' + esc(P.title) + '</p><p class="tag">' + esc(P.tag) + '</p>' + body + '<div class="actions">' + links + '</div>';
    card.hidden = false; void card.offsetWidth; card.classList.add('open');
    if (focusNext) {
      focusNext = false; returnFocus = document.activeElement;
      (card.querySelector('.btn.primary') || card.querySelector('.btn') || card).focus({ preventScroll: true });
    }
  }
  function closeCard() {
    cardId = null; card.classList.remove('open'); hud.classList.remove('carding');
    if (card.contains(document.activeElement)) {
      const r = returnFocus; returnFocus = null;
      if (r && r.isConnected && r !== document.body) r.focus({ preventScroll: true }); else document.activeElement.blur();
    }
    setTimeout(() => { if (!cardId) card.hidden = true; }, 260);
  }
  card.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'close') closeCard();
    else if (act === 'roll') reroll(1 + Math.floor(Math.random() * 99998));
    else if (act === 'home') reroll(HOME);
    else if (act === 'share') navigator.clipboard.writeText(location.href).then(() => toast('Link copied. Send someone your island.'), () => toast(esc(location.href), 6000));
  });
  function burst(s) {
    if (REDUCE) return;
    for (let k = 0; k < 48; k++) {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 8;
      particles.push({ kind: 'confetti', x: s.x + s.w / 2, y: s.y, vx: Math.cos(a) * v / asp * 0.5, vy: Math.sin(a) * v - 6, g: '*+$•'[k % 4], c: FLOWERS[k % 5], age: 0, life: 1.1 + Math.random(), grav: 13 });
    }
  }
  function reroll(sd) {
    writeSave();
    const u = new URL(location.href); if (sd === HOME) u.searchParams.delete('seed'); else u.searchParams.set('seed', sd);
    history.replaceState(null, '', u);
    load(sd, sd === HOME);
    toast(sd === HOME ? 'Welcome home.' : 'Island <b>#' + sd + '</b>. Same buildings, brand new world.');
  }

  // ------------------------------------------------------------------ moving around
  const keys = new Set();
  const DIRS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  const canStep = (x, y, dx, dy) => passable(x + dx, y + dy) && !(dx && dy && (!passable(x + dx, y) || !passable(x, y + dy)));
  let lastBumpToast = -9, lastDoor = null;
  function bump(dx, dy) {
    player.bump = 0.14; player.next = clock + 0.14;
    const nx = player.x + dx, ny = player.y + dy, t = nx >= 0 && ny >= 0 && nx < W && ny < H ? tile[ny * W + nx] : T.DEEP;
    if (clock - lastBumpToast > 4) { lastBumpToast = clock; if (isWater(t)) toast("Too deep to swim. Find a bridge."); else if (t === T.MOUNT || t === T.SNOW) toast('Too steep to climb.'); }
  }
  function stepTo(nx, ny) {
    const diag = nx !== player.x && ny !== player.y;
    player.x = nx; player.y = ny;
    player.next = clock + STEP * G.walkCost(tile[ny * W + nx]) * (diag ? 1.3 : 1);
    if (!player.moved) { player.moved = true; hintEl.classList.add('quiet'); }
    revealRadius(nx, ny, VR);
    arrive();
  }
  function nearDoor() { for (const s of S) if (s.id !== 'campfire' && Math.max(Math.abs(player.x - s.door.x), Math.abs(player.y - s.door.y)) <= 1) return s.id; return null; }
  function arrive() {
    checkFound();
    const d = nearDoor();
    if (cardId && d !== cardId) closeCard();
    const walking = player.path.length > 0 || !!player.goal;
    if (d && d !== lastDoor && !cardId && !walking) openCard(d);
    lastDoor = walking ? null : d;
    updateMeta();
  }
  function nearestPassable(x, y, r) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d = dx * dx + dy * dy; if (d < bd && passable(x + dx, y + dy)) { bd = d; best = [x + dx, y + dy]; } }
    return best;
  }
  function walkTo(tx, ty, goal) {
    if (tx === player.x && ty === player.y) { if (goal) openCard(goal); return true; }
    const p = G.astar(W, H, player.x, player.y, tx, ty, (x, y, i) => G.walkCost(tile[i]), true);
    if (!p) { toast('No way through from here.'); return false; }
    player.path = p; player.goal = goal;
    if (cardId && goal !== cardId) closeCard();
    return true;
  }
  function goToPlace(id, fromList, viaKeyboard) {
    const s = byId[id]; if (!s) return;
    if (PLACES[id].secret && !found.has(id)) { toast("That one you'll have to find yourself."); return; }
    focusNext = !!viaKeyboard;
    if (!walkTo(s.door.x, s.door.y, id)) focusNext = false;
    if (fromList && innerWidth <= 720) $('#placesBox').open = false;
  }
  function cellAt(cx, cy) { const r = cv.getBoundingClientRect(); return [Math.floor(cam.x + (cx - r.left - vw / 2) / cw), Math.floor(cam.y + (cy - r.top - vh / 2) / ch)]; }
  function clickAt(cx, cy) {
    const [x, y] = cellAt(cx, cy); if (x < 0 || y < 0 || x >= W || y >= H) return;
    const a = artAt[y * W + x];
    if (a >= 0 && S[a].id !== 'campfire' && S[a].kind[y - S[a].y][x - S[a].x]) { goToPlace(S[a].id); return; }
    if (x === player.x && y === player.y) { const d = nearDoor(); if (d) openCard(d); return; }
    const target = passable(x, y) ? [x, y] : nearestPassable(x, y, 2);
    if (!target) { toast(isWater(tile[y * W + x]) ? 'Too deep to swim. Find a bridge.' : 'Too steep to climb.'); return; }
    walkTo(target[0], target[1], null);
  }

  // ------------------------------------------------------------------ the simulation tick
  let birdT = 5, sparkAcc = 0, smokeAcc = 0, lastSave = 0, metaT = 0, millPhase = 0;
  const FREEZE = OG || params.has('t');
  function spawnFlock() {
    const dir = Math.random() < 0.5 ? 1 : -1, n = 3 + (Math.random() * 3 | 0), vx = vw / cw, vy = vh / ch;
    const m = [[0, 0], [-2 * dir, -1], [-2 * dir, 1], [-4 * dir, -2], [-4 * dir, 2]].slice(0, n);
    birds.push({ x: cam.x - dir * (vx / 2 + 5), y: cam.y - vy * 0.35 + Math.random() * vy * 0.6, vx: dir * (7 + Math.random() * 4), vy: (Math.random() - 0.5) * 1.2, ph: Math.random() * 2, m });
  }
  function updateCat(dt) {
    const k = Math.min(1, dt * 10); cat.fx += (cat.x - cat.fx) * k; cat.fy += (cat.y - cat.fy) * k;
    if (cat.meow > 0) cat.meow -= dt * 0.8;
    cat.next -= dt; if (cat.next > 0) return;
    const near = Math.max(Math.abs(cat.x - player.x), Math.abs(cat.y - player.y));
    if (near <= 1 && cat.meow <= 0 && Math.random() < 0.5) cat.meow = 1.6;
    if (cat.sit > 0) { cat.sit--; cat.next = 0.8 + Math.random(); return; }
    if (Math.random() < 0.22) { cat.sit = 2 + (Math.random() * 4 | 0); cat.next = 1; return; }
    let dx = (Math.random() * 3 | 0) - 1, dy = (Math.random() * 3 | 0) - 1;
    if (near < 8 && near > 2 && Math.random() < 0.5) { dx = Math.sign(player.x - cat.x); dy = Math.sign(player.y - cat.y); }
    else if (Math.abs(cat.x + dx - cat.hx) > 7 || Math.abs(cat.y + dy - cat.hy) > 4) { dx = Math.sign(cat.hx - cat.x); dy = Math.sign(cat.hy - cat.y); }
    const nx = cat.x + dx, ny = cat.y + dy;
    if ((dx || dy) && passable(nx, ny) && !(nx === player.x && ny === player.y) && tile[ny * W + nx] !== T.BRIDGE) { cat.x = nx; cat.y = ny; }
    cat.next = 0.35 + Math.random() * 0.6;
  }
  function update(dt) {
    if (OG) { clock = Number(params.get('c')) || 9.5; return; }
    clock += dt;
    if (!FREEZE) dayT = (dayT + dt / DAY) % 1;
    if (clock >= player.next) {
      let dx = 0, dy = 0; for (const k of keys) { const d = DIRS[k]; if (d) { dx += d[0]; dy += d[1]; } }
      dx = Math.sign(dx); dy = Math.sign(dy);
      if (dx || dy) {
        player.path = []; player.goal = null; focusNext = false;
        if (canStep(player.x, player.y, dx, dy)) stepTo(player.x + dx, player.y + dy);
        else if (dx && dy && canStep(player.x, player.y, dx, 0)) stepTo(player.x + dx, player.y);
        else if (dx && dy && canStep(player.x, player.y, 0, dy)) stepTo(player.x, player.y + dy);
        else bump(dx, dy);
      } else if (player.path.length) {
        const i = player.path.shift(); stepTo(i % W, (i / W) | 0);
        if (!player.path.length && player.goal) { const g = player.goal; player.goal = null; openCard(g); lastDoor = nearDoor(); }
      }
    }
    const kp = REDUCE ? 1 : Math.min(1, dt * 18);
    player.fx += (player.x - player.fx) * kp; player.fy += (player.y - player.fy) * kp;
    if (player.bump > 0) player.bump = Math.max(0, player.bump - dt);
    // camera: a soft deadzone, so the view only moves when you get near its edge
    const vx = vw / cw, vy = vh / ch, narrow = innerWidth <= 720, mx = vx * (narrow ? 0.16 : 0.22), my = vy * (narrow ? 0.14 : 0.2);
    const pxc = player.fx + 0.5 + (cardId && !narrow ? vx * 0.16 : 0), pyc = player.fy + 0.5 + (cardId && narrow ? vy * 0.24 : 0);
    let tx = cam.x, ty = cam.y;
    if (pxc < cam.x - mx) tx = pxc + mx; else if (pxc > cam.x + mx) tx = pxc - mx;
    if (pyc < cam.y - my) ty = pyc + my; else if (pyc > cam.y + my) ty = pyc - my;
    const kc = REDUCE ? 1 : Math.min(1, dt * 4.5);
    cam.x += (tx - cam.x) * kc; cam.y += (ty - cam.y) * kc;
    const wm = byId.windmill;
    millPhase += dt * (1.4 + 3 * (wm ? wind(wm.x, wm.y, clock) : 0.5)) * (REDUCE ? 0.25 : 1);
    millFrame = Math.floor(millPhase);
    const f = byId.campfire;
    if (f && !REDUCE && !OG) {
      sparkAcc += dt * (3 + 6 * night);
      while (sparkAcc > 1) { sparkAcc--; particles.push({ kind: 'spark', x: f.x + 0.6 + Math.random() * 1.8, y: f.y - 0.2, vx: (Math.random() - 0.5) * 1.2 + 0.5, vy: -(2.4 + Math.random() * 2.6), age: 0, life: 0.7 + Math.random() * 0.9, grav: -0.4 }); }
    }
    const ws = byId.workshop;
    if (ws && !REDUCE && !OG) {
      smokeAcc += dt * 1.5;
      while (smokeAcc > 1) { smokeAcc--; particles.push({ kind: 'smoke', x: ws.x + 6, y: ws.y - 1, vx: 0.9 + Math.random() * 0.8, vy: -(0.9 + Math.random() * 0.6), age: 0, life: 2.4 + Math.random() * 1.4, grav: 0.05 }); }
    }
    for (let k = particles.length - 1; k >= 0; k--) {
      const p = particles[k]; p.age += dt; if (p.age >= p.life) { particles.splice(k, 1); continue; }
      p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
    birdT -= dt;
    if (birdT <= 0 && !REDUCE && !OG) { birdT = 14 + Math.random() * 18; spawnFlock(); }
    for (let k = birds.length - 1; k >= 0; k--) { const b = birds[k]; b.x += b.vx * dt; b.y += b.vy * dt; if (Math.abs(b.x - cam.x) > vx + 30) birds.splice(k, 1); }
    updateCat(dt);
    metaT -= dt; if (metaT <= 0) { metaT = 0.5; checkFound(); updateClock(); }
    if (clock - lastSave > 5) { lastSave = clock; writeSave(); }
  }

  // ------------------------------------------------------------------ input
  const typing = (e) => e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || scrollY > innerHeight * 0.5) return;
    if (DIRS[e.code]) { keys.add(e.code); e.preventDefault(); return; }
    const onControl = e.target.closest && e.target.closest('button, a, summary, [role=button]');
    switch (e.code) {
      case 'KeyE': case 'Enter': case 'Space': {
        if (onControl && e.code !== 'KeyE') return;
        const d = nearDoor(); if (d) { if (cardId === d) closeCard(); else openCard(d); }
        e.preventDefault(); break;
      }
      case 'Escape': closeCard(); break;
      case 'KeyM': mini.classList.toggle('off'); break;
      case 'KeyN': skipTime(); break;
      case 'Equal': case 'NumpadAdd': setZoom(zoom * 1.15); break;
      case 'Minus': case 'NumpadSubtract': setZoom(zoom / 1.15); break;
      case 'KeyR': if (rollUnlocked()) reroll(1 + Math.floor(Math.random() * 99998)); break;
      default:
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  function setZoom(z) { zoom = Math.max(0.55, Math.min(2.2, z)); resize(); }
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  cv.addEventListener('pointerup', (e) => { if (!down) return; const m = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null; if (m < 10) clickAt(e.clientX, e.clientY); });
  cv.addEventListener('pointercancel', () => { down = null; });
  cv.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; hover = cellAt(e.clientX, e.clientY); showTip(e.clientX, e.clientY, describe(hover[0], hover[1])); });
  cv.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
    if (seenAt(x, y) <= 0) { toast('You have not been there yet.'); return; }
    const t = passable(x, y) ? [x, y] : nearestPassable(x, y, 3); if (t) walkTo(t[0], t[1], null);
  });
  clockEl.addEventListener('click', skipTime);
  clockEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skipTime(); } });

  // ------------------------------------------------------------------ boot
  let lastNow = 0, frameNo = 0;
  let failed = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
    try { update(dt); render(clock); if ((frameNo++ & 7) === 0) drawMini(); }
    catch (err) { if (!failed) { failed = true; console.error(err); } }
  }
  resize();
  if (params.has('t')) dayT = Math.max(0, Math.min(0.999, Number(params.get('t')) || 0.44)); else if (OG) dayT = 0.44;
  const startSeed = parseSeed(params.get('seed')) ?? HOME;
  load(startSeed, startSeed === HOME && !OG);
  lastDoor = nearDoor();
  if (OG) { cam.x = Number(params.get('cx')) || spawn.x + 0.5; cam.y = Number(params.get('cy')) || spawn.y - 2; document.documentElement.classList.add('og'); $('#ogcap').hidden = params.has('nocap'); }
  else { hud.hidden = false; hud.classList.add('intro'); setTimeout(() => hud.classList.remove('intro'), REDUCE ? 0 : 1300); }
  hintEl.innerHTML = TOUCH ? 'tap anywhere to walk · <a href="#plain">plain list &darr;</a>'
    : '<kbd>WASD</kbd> or <kbd>&larr;&uarr;&rarr;&darr;</kbd> or click to walk · <kbd>E</kbd> open · <kbd>M</kbd> map · <kbd>N</kbd> time';
  if (innerWidth <= 720) $('#placesBox').open = false;
  updateClock();
  addEventListener('resize', resize);
  addEventListener('pagehide', writeSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) writeSave(); });
  requestAnimationFrame((n) => { lastNow = n; requestAnimationFrame(frame); });
  // a small handle for tests and the curious
  window.__island = {
    get state() { return { seed, player: [player.x, player.y], found: [...found], explored: +(seenN / landN).toFixed(3), dayT: +dayT.toFixed(3), frameMs: +frameMs.toFixed(2), glyphs: gn, card: cardId }; },
    setDay(d) { dayT = ((Number(d) % 1) + 1) % 1 || 0; updateClock(); }, walk: goToPlace, go: walkTo,
  };
})();
