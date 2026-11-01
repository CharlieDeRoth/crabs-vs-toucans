// Generates the app icon set, store screenshots (web + App Store + Google Play sizes), the Play feature graphic,
// and the icon/splash sources for @capacitor/assets, for Crabs vs Toucans.
// Drives headless Edge/Chrome over the DevTools protocol, so everything is drawn by the real game code.
// Usage:  node tools/capture.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const PORT = 9333;
const SHOT_W = 1920, SHOT_H = 1080;
// Store screenshot sets. The viewport is laid out at w x h CSS px, then rendered at dpr, so the files are w*dpr x h*dpr.
const SHOT_SETS = [
  { dir: 'screenshots', w: 1920, h: 1080, dpr: 1 },                       // web / Google Play phone (16:9)
  { dir: 'store/ios-iphone-6.9in', w: 1434, h: 660, dpr: 2, cap: 112 },   // 2868 x 1320, iPhone 6.9" landscape
  { dir: 'store/ios-ipad-13in', w: 1376, h: 1032, dpr: 2 },               // 2752 x 2064, iPad 13" landscape
  { dir: 'store/play-tablet-10in', w: 1280, h: 800, dpr: 2, cap: 120 },   // 2560 x 1600, Android 10" tablet
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) throw new Error('Edge or Chrome not found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cvt-capture-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) {
      await sleep(200);
      try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) {}
    }
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map(), events = [];
    ws.onmessage = m => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) events.push(msg.method);
    };
    const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
      return r.result.result.value;
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: SHOT_W, height: SHOT_H, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: GAME });
    for (let i = 0; i < 50 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
    await evaluate(`await document.fonts.ready; await new Promise(r => setTimeout(r, 800));`);

    // ---------- app icons ----------
    const icons = await evaluate(ICON_JS);
    const iconDir = path.join(ROOT, 'icons'); fs.mkdirSync(iconDir, { recursive: true });
    for (const [size, url] of Object.entries(icons)) fs.writeFileSync(path.join(iconDir, `icon-${size}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log('icons:', Object.keys(icons).join(', '));
    fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(iconDir, 'icon-1024.png'), path.join(ROOT, 'assets', 'icon-only.png'));   // @capacitor/assets source

    // ---------- store screenshots ----------
    // ---------- Capacitor icon/splash sources + Play feature graphic ----------
    const assets = await evaluate(ASSETS_JS);
    for (const [name, url] of Object.entries(assets)) {
      const f = path.join(ROOT, name); fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); console.log('asset:', name);
    }
    await evaluate(SETUP_JS);
    for (const set of SHOT_SETS) {
      const shotDir = path.join(ROOT, set.dir); fs.mkdirSync(shotDir, { recursive: true });
      await send('Emulation.setDeviceMetricsOverride', { width: set.w, height: set.h, deviceScaleFactor: set.dpr, mobile: false });
      await evaluate(`document.documentElement.style.setProperty('--cap', '${set.cap || 150}px'); dispatchEvent(new Event('resize'));`);
      for (const [i, shot] of SHOTS.entries()) {
        await evaluate(`resetScene(); ${shot.js}; caption(${JSON.stringify(shot.title)}, ${JSON.stringify(shot.sub)}); fitLayout();`);
        await sleep(shot.wait || 900);
        const png = await send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(shotDir, `${String(i + 1).padStart(2, '0')}-${shot.name}.png`);
        fs.writeFileSync(file, Buffer.from(png.result.data, 'base64'));
        console.log('shot:', set.dir + '/' + path.basename(file));
      }
    }
    ws.close();
  } finally {
    proc.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

// The icon is composed on a 64x64 pixel grid from the game's own sprites, then scaled up with crisp nearest-neighbour.
const ICON_JS = `
  const base = mk(64, 64), g = base.getContext('2d'); g.imageSmoothingEnabled = false;
  const sky = ['#9fd6f2', '#aee0f5', '#bfe6f6', '#d4e8f4', '#e8dcef', '#f6d6e6', '#ffd6e4'];
  for (let y = 0; y < 64; y++) { g.fillStyle = sky[Math.min(sky.length - 1, Math.floor(y / 8))]; g.fillRect(0, y, 64, 1); }
  g.fillStyle = 'rgba(255,255,255,.35)';                              // sun rays
  for (let a = 0; a < 6.28; a += 0.52) for (let r = 6; r < 60; r++) g.fillRect(Math.round(8 + Math.cos(a) * r), Math.round(8 + Math.sin(a) * r), 1, 1);
  disc(g, 8, 8, 6, '#fff1a1'); disc(g, 7, 7, 4, '#fff8cc');
  g.fillStyle = '#d4ad7c'; g.fillRect(0, 51, 64, 1); g.fillStyle = '#f5e1b5'; g.fillRect(0, 52, 64, 12);   // sandy beach
  g.fillStyle = '#e5c995'; [[5, 56], [19, 60], [44, 55], [57, 59], [33, 62]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
  ell(g, 32, 57, 14, 2, 'rgba(160,120,90,.35)');                       // crab shadow
  g.drawImage(TW.king.frames[0], 16, 25, 32, 32);                      // the King Crab, 2x
  g.drawImage(KING_CROWN, 26, 25, 12, 8);
  g.save(); g.translate(62, 3); g.scale(-1, 1); g.drawImage(TT.teen.spr[0], 0, 0, 20, 16); g.restore();   // toucan swooping in
  g.fillStyle = '#ffffff'; [[45, 20], [49, 22], [53, 20]].forEach(([x, y]) => g.fillRect(x, y, 2, 1));
  [[14, 20], [52, 34], [9, 40]].forEach(([x, y]) => { g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); });
  const out = {};
  for (const size of [1024, 512, 192, 180, 32]) {
    const c = mk(size, size), cg = c.getContext('2d');
    cg.imageSmoothingEnabled = size % 64 !== 0;                         // only smooth sizes that aren't clean multiples
    cg.drawImage(base, 0, 0, size, size);
    out[size] = c.toDataURL('image/png');
  }
  return out;
`;

// Icon foreground/background (Android adaptive icons), splash screens and the 1024x500 Play feature graphic.
const ASSETS_JS = `
  const out = {}, png = c => c.toDataURL('image/png');
  const crisp = (w, h) => { const c = mk(w, h), g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; };
  const sky = (g, w, h) => { const cols = ['#9fd6f2', '#aee0f5', '#bfe6f6', '#d4e8f4', '#e8dcef', '#f6d6e6', '#ffd6e4']; for (let i = 0; i < cols.length; i++) { g.fillStyle = cols[i]; g.fillRect(0, Math.floor(i * h / cols.length), w, Math.ceil(h / cols.length) + 1); } };
  // the hero art: King Crab + swooping toucan on a 64x64 grid, transparent background
  const [art, ag] = crisp(64, 64);
  ell(ag, 32, 57, 14, 2, 'rgba(160,120,90,.35)'); ag.drawImage(TW.king.frames[0], 16, 25, 32, 32); ag.drawImage(KING_CROWN, 26, 25, 12, 8);
  ag.save(); ag.translate(58, 6); ag.scale(-1, 1); ag.drawImage(TT.teen.spr[0], 0, 0, 20, 16); ag.restore();
  out['icons/icon-1024.png'] = null;   // already written by the icon step; Capacitor reads the copy below
  // Android adaptive icon: art inside the central 66% safe zone
  const [fg, fgg] = crisp(1024, 1024); fgg.drawImage(art, 176, 150, 672, 672); out['assets/icon-foreground.png'] = png(fg);
  const [bg, bgg] = crisp(1024, 1024); sky(bgg, 1024, 1024); bgg.fillStyle = '#f5e1b5'; bgg.fillRect(0, 780, 1024, 244); out['assets/icon-background.png'] = png(bg);
  // splash screens: art + title, centred in the area every phone shape keeps (about 1200px of the 2732 square)
  for (const [name, col, ink] of [['splash', '#f3eefc', '#e8506e'], ['splash-dark', '#2b2340', '#ff8fa3']]) {
    const [sp, sg] = crisp(2732, 2732); sg.fillStyle = col; sg.fillRect(0, 0, 2732, 2732);
    sg.drawImage(art, 1016, 900, 700, 700);
    sg.font = '700 96px "Press Start 2P", monospace'; sg.textAlign = 'center'; sg.fillStyle = ink; sg.fillText('CRABS vs TOUCANS', 1366, 1740);
    out['assets/' + name + '.png'] = png(sp);
  }
  // Google Play feature graphic 1024x500: a slice of the meadow map, the crab squad and the title
  const [fgx, fx] = crisp(1024, 500);
  { const b = MAPS.isles.bg, sh = b.width * 500 / 1024; fx.drawImage(b, 0, (b.height - sh) / 2, b.width, sh, 0, 0, 1024, 500); }
  fx.fillStyle = 'rgba(243,238,252,.55)'; fx.fillRect(0, 0, 1024, 500);
  const squad = ['glock', 'clawer', 'sniper', 'minigun', 'drone', 'king'];
  squad.forEach((k, i) => fx.drawImage(TW[k].frames[0], 62 + i * 152, 300, 144, 144));
  [[700, 40, 1], [860, 120, -1], [120, 70, 1]].forEach(([x, y, d]) => { fx.save(); fx.translate(x + (d < 0 ? 100 : 0), y); fx.scale(d, 1); fx.drawImage(TT.teen.spr[0], 0, 0, 100, 80); fx.restore(); });
  fx.textAlign = 'center'; fx.font = '700 50px "Press Start 2P", monospace';
  fx.fillStyle = '#ffffff'; fx.fillText('CRABS vs TOUCANS', 517, 205); fx.fillStyle = '#e8506e'; fx.fillText('CRABS vs TOUCANS', 512, 200);
  fx.font = '600 30px "Pixelify Sans", monospace'; fx.fillStyle = '#3a2a3e'; fx.fillText('A cosy pixel tower defence', 512, 252);
  out['store/play-feature-graphic.png'] = png(fgx);
  delete out['icons/icon-1024.png'];
  return out;
`;

// Helpers injected once: scene reset, marketing caption, and a "nice spots" finder for placing crabs.
const SETUP_JS = `
  try { localStorage.clear(); } catch (e) {}
  for (const h of HERO_IDS) { HERO_SAVE.owned[h] = true; }
  HERO_SAVE.cc = 2350; goldenUnlocked = true; buildShop();
  window.unlockAch = () => {};   // no achievement pop-ups in marketing shots
  Object.assign(STATS, { pops: 12480, bestCombo: 87, perfect: 31, loginDay: dayKey(), tutorialDone: true, streak: 4, dailyWins: 9 });
  const st = document.createElement('style');
  st.textContent = 'body.mk{padding-top:var(--cap,150px);background:linear-gradient(160deg,#ffe3ee,#e6dcff 55%,#d6f0ff)}' +
    'body.mk #wrap{max-width:1640px}body.mk.in-menu #wrap{max-width:1470px}body.mk .node{min-height:96px}' +
    '#mkcap{position:fixed;top:0;left:0;right:0;height:var(--cap,150px);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:50;pointer-events:none}' +
    '#mkcap b{font-family:"Press Start 2P",monospace;font-size:40px;color:#e8506e;text-shadow:4px 4px 0 #fff,7px 7px 0 #3a2a3e33}' +
    '#mkcap span{font-size:24px;color:#5a4a6a;margin-top:14px;font-weight:600}';
  document.head.appendChild(st);
  window.caption = (t, s) => {
    let c = document.getElementById('mkcap');
    if (!c) { c = document.createElement('div'); c.id = 'mkcap'; document.body.appendChild(c); }
    c.innerHTML = '<b>' + t + '</b><span>' + s + '</span>'; document.body.classList.add('mk');
  };
  window.resetScene = () => { achQueue.length = 0; document.getElementById('achBanner').classList.remove('show'); };
  window.spotsNear = (min, max) => { const out = []; for (let y = 36; y < H - 30; y += 9) for (let x = 36; x < W - 30; x += 9) { const d = pathDist(x, y); if (d > min && d < max && canPlace(x, y)) out.push([x, y]); } return out; };
  window.build = list => { for (const [type, lvl, gx, gy, path] of list) { const sp = spotsNear(38, 90).sort((a, b) => Math.hypot(a[0] - gx, a[1] - gy) - Math.hypot(b[0] - gx, b[1] - gy)).find(s => canPlace(s[0], s[1])); if (!sp) continue; const t = placeTower(type, sp[0], sp[1]); if (t) for (let i = 0; i < lvl; i++) upgradeTower(t, path); } S.fx = S.fx.filter(f => f.k !== 'txt' && f.k !== 'ring'); };
  window.run = (secs) => { for (let i = 0; i < secs * 50 && S.state === 'play'; i++) update(0.02); };
  window.freeze = () => { S.state = 'paused'; S.toast = null; document.getElementById('overlay').classList.add('hide'); document.body.classList.remove('in-menu'); updateUI(true); };
`;

const SHOTS = [
  { name: 'title', title: 'CRABS vs TOUCANS', sub: 'A cosy pixel tower defence. Stop the toucans at the border!', wait: 2500,
    js: `newGame(); setMap('isles'); M.crabs = null; M.birds = []; showOverlay('menu');` },
  { name: 'defend', title: 'DEFEND THE BORDER!', sub: '6 crabs, 9 kinds of toucan, 15 rounds of feathery chaos', wait: 900,
    js: `HERO_SAVE.equipped = null; buildShop(); startClassic(); S.coins = 99999;
         build([['glock', 3, 230, 120], ['clawer', 2, 160, 300], ['sniper', 2, 470, 320], ['minigun', 4, 300, 380], ['king', 2, 560, 250], ['drone', 3, 640, 140], ['glock', 2, 880, 300], ['minigun', 3, 820, 420]]);
         S.round = 8; S.coins = 642; startRound(); run(14); freeze(); S.selected = S.towers.find(t => t.type === 'king'); updateUI(true);` },
  { name: 'upgrades', title: 'UPGRADE YOUR CRABS', sub: 'Two upgrade paths per crab, each with its own look: rocket pods, hand cannons, frost beams...', wait: 900,
    js: `startMatch('city', 4); S.coins = 99999;
         build([['minigun', 5, 300, 330, 'B'], ['sniper', 5, 520, 300], ['glock', 5, 380, 120, 'B'], ['king', 5, 760, 290, 'B'], ['golden', 2, 430, 250], ['clawer', 5, 170, 300], ['drone', 5, 640, 420]]);
         S.coins = 1180; S.round = 3; startRound(); run(19); freeze(); S.selected = S.towers.find(t => t.type === 'minigun'); updateUI(true);` },
  { name: 'daily', title: 'NEW CHALLENGES DAILY', sub: 'Daily challenges, login rewards and a wardrobe of crab colours', wait: 1200,
    js: `newGame(); showOverlay('daily');` },
  { name: 'islands', title: '3 ISLANDS TO CONQUER', sub: 'Meadows, a pastel city and a temple in the clouds', wait: 1200,
    js: `PROG.isles = 6; PROG.city = 3; STATS.stars.isles = [3, 3, 2, 3, 3, 2]; STATS.stars.city = [3, 2, 3, 0, 0, 0]; newGame(); showOverlay('islands');` },
  { name: 'boss', title: 'EPIC BOSS BATTLES', sub: 'Toucanzilla, Toucanbot and the crab-destroying Toucangod', wait: 900,
    js: `HERO_SAVE.equipped = 'unicorn'; buildShop(); startMatch('olympus', 6); S.coins = 99999;
         build([['king', 4, 330, 250], ['minigun', 4, 470, 380], ['sniper', 4, 300, 420], ['unicorn', 0, 560, 260], ['drone', 4, 700, 300], ['golden', 1, 450, 200]]);
         S.coins = 860; S.round = 3; S.inRound = false; startRound(); S.spawns = []; S.enemies = [];
         const god = spawnEnemy('god', PATH_LEN * 0.55); for (let k = 1; k < 7; k++) spawnEnemy(['elder', 'winged', 'twin'][k % 3], PATH_LEN * 0.55 - 150 - k * 70);
         god.hp = god.max * 0.62; run(0.6); const t = S.towers.find(o => o.type === 'king'); god.mark = t; god.markT = 0.9;
         useAbility(S.towers.find(o => o.type === 'unicorn')); run(0.25); freeze();` },
  { name: 'heroes', title: 'RECRUIT HEROES', sub: 'Crab Conqueror, Sir Crabycorn and Shrimp, bought with Crab Coins', wait: 1200,
    js: `HERO_SAVE.equipped = 'conq'; HERO_SAVE.skin.shrimp = 'mantis'; HERO_SAVE.nodes.shrimp.mantis = true; newGame(); showOverlay('heroes');` },
  { name: 'skilltree', title: 'UNLOCK SKILL TREES', sub: 'Special abilities, power-ups and cool skins for every hero', wait: 1200,
    js: `Object.assign(HERO_SAVE.nodes.conq, { powder: true, quick: true, barrage: true, navy: true }); HERO_SAVE.skin.conq = 'navy'; HERO_SAVE.cc = 640; showOverlay('tree', 'conq');
         document.querySelector('.modal').scrollTop = 0;` },
];

main().catch(e => { console.error(e); process.exit(1); });
