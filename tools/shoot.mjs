// Screenshots and drives the island through the Chrome DevTools Protocol. This is how og.png and docs/banner.png are made.
// Usage: node tools/shoot.mjs scenario.json
// A scenario is { url?, port?, path?, viewport?, reduce?, steps: [...] }; a step can wait, eval, key, click, tap, move or shot.
// Serves the repo itself, so no build and no dependencies (Node 22+ has WebSocket). Set CHROME if Chrome lives elsewhere.
// Example: { "viewport": { "width": 1200, "height": 630, "dsf": 1 }, "path": "/?og&t=0.45&fs=14&r=20&cy=66", "steps": [{ "wait": 2500, "shot": "og.png" }] }
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.env.OUT || process.cwd();
const sc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { const nf = path.join(ROOT, '404.html'); if (fs.existsSync(nf)) { res.writeHead(404, { 'content-type': types['.html'] }); fs.createReadStream(nf).pipe(res); } else { res.writeHead(404); res.end('not found'); } return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(sc.port || 4321);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 600);
const proc = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'isl-')), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'log'].includes(m.params.type)) logs.push(m.params.type.toUpperCase() + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level !== 'verbose') logs.push('LOG ' + m.params.entry.level + ' ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'EVAL-ERROR ' + JSON.stringify(r.result.exceptionDetails.exception?.description) : r.result?.result?.value; };
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
const vp = sc.viewport || { width: 1440, height: 900, dsf: 2 };
await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf || 2, mobile: !!vp.mobile });
if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (sc.reduce) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.navigate', { url: sc.url || ('http://localhost:' + (sc.port || 4321) + (sc.path || '/')) });
for (const st of sc.steps) {
  if (st.wait) await sleep(st.wait);
  if (st.eval) { const v = await evalJS(st.eval); if (v !== undefined) console.log('eval:', st.eval.slice(0, 60), '=>', JSON.stringify(v)); }
  if (st.key) { for (const k of [].concat(st.key)) { await send('Input.dispatchKeyEvent', { type: 'keyDown', code: k.code, key: k.key, windowsVirtualKeyCode: k.vk || 0 }); await sleep(k.hold || 60); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: k.code, key: k.key, windowsVirtualKeyCode: k.vk || 0 }); await sleep(40); } }
  if (st.click) { const [x, y] = st.click; for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); }
  if (st.tap) { const [x, y] = st.tap; await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(50); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  if (st.move) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: st.move[0], y: st.move[1] }); }
  if (st.shot) { const r = await send('Page.captureScreenshot', { format: 'png', ...(st.full ? { captureBeyondViewport: true } : {}) }); fs.writeFileSync(path.join(OUT, st.shot), Buffer.from(r.result.data, 'base64')); console.log('shot', st.shot); }
}
console.log('--- console/log entries:', logs.length); for (const l of logs) console.log(l);
ws.close(); proc.kill(); srv.close(); process.exit(0);
