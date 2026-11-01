// Layout audit: opens every screen of the game at PC, iPad and phone sizes in headless Edge/Chrome and checks
// that nothing scrolls, nothing is off-screen or clipped, and panels/menus aren't shrunk past readability.
// Usage:  node tools/layout-audit.js [outDir]      (screenshots of every case go to outDir, default ./audit)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'audit'));
const PORT = 9334;
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEVICES = [
  { name: 'pc-1920x1080', w: 1920, h: 1080 },
  { name: 'pc-1366x768', w: 1366, h: 768 },
  { name: 'pc-1280x720', w: 1280, h: 720 },
  { name: 'ipad-pro-land', w: 1366, h: 1024, mobile: true, dpr: 2 },
  { name: 'ipad-land', w: 1024, h: 768, mobile: true, dpr: 2 },
  { name: 'ipad-port', w: 768, h: 1024, mobile: true, dpr: 2 },
  { name: 'iphone-land', w: 844, h: 390, mobile: true, dpr: 3 },
  { name: 'iphone-port', w: 390, h: 844, mobile: true, dpr: 3 },
  { name: 'iphone-se-land', w: 667, h: 375, mobile: true, dpr: 2 },
  { name: 'iphone-se-port', w: 375, h: 667, mobile: true, dpr: 2 },
  { name: 'android-port', w: 360, h: 740, mobile: true, dpr: 3 },
];

// Each scene puts the game into a state; the checker then measures it.
const SCENES = {
  'game-idle':      `STATS.tutorialDone = true; STATS.loginDay = dayKey(); startClassic();`,
  'game-fork':      `startClassic(); S.coins = 9999; const t = placeTower('glock', 300, 345); upgradeTower(t); upgradeTower(t); S.selected = t;`,
  'game-aim':       `HERO_SAVE.equipped = 'conq'; HERO_SAVE.owned.conq = true; HERO_SAVE.nodes.conq.barrage = true; buildShop(); startClassic(); S.coins = 9999; const h = placeTower('conq', 480, 250); h.abilityCd = 0; S.selected = h; triggerAbility(h); S.mouse = { x: 400, y: 300 };`,
  'game-placing':   `startClassic(); selectShop('king');`,
  'game-crab':      `startClassic(); S.coins = 9999; const t = placeTower('minigun', 300, 345); for (let i = 0; i < 3; i++) upgradeTower(t); S.selected = t;`,
  'game-hero':      `HERO_SAVE.equipped = 'unicorn'; buildShop(); startClassic(); S.coins = 9999; S.selected = placeTower('unicorn', 480, 250);`,
  'game-golden':    `startClassic(); S.coins = 9999; const g = placeTower('golden', 300, 270); upgradeTower(g); S.selected = g;`,
  'game-boss':      `startMatch('olympus', 6); S.coins = 9999; S.round = 3; startRound(); S.spawns = []; spawnEnemy('god', PATH_LEN * 0.4);`,
  'menu':           `toMenuForAudit(); showOverlay('menu');`,
  'islands':        `toMenuForAudit(); showOverlay('islands');`,
  'island':         `toMenuForAudit(); showOverlay('island', 'city');`,
  'heroes':         `toMenuForAudit(); showOverlay('heroes');`,
  'tree':           `toMenuForAudit(); showOverlay('tree', 'conq');`,
  'achievements':   `toMenuForAudit(); showOverlay('achievements');`,
  'howto':          `toMenuForAudit(); showOverlay('howto');`,
  'classicMenu':    `toMenuForAudit(); showOverlay('classicMenu');`,
  'daily':          `toMenuForAudit(); showOverlay('daily');`,
  'wardrobe':       `toMenuForAudit(); HERO_SAVE.cc = 400; showOverlay('wardrobe', 'king');`,
  'records':        `toMenuForAudit(); showOverlay('records');`,
  'settings':       `toMenuForAudit(); showOverlay('settings', 'menu');`,
  'settings-pause': `startClassic(); S.round = 3; pauseGame(); showOverlay('settings', 'pause');`,
  'backup':         `toMenuForAudit(); showOverlay('backup');`,
  'restore':        `toMenuForAudit(); showOverlay('restore');`,
  'big-crab':       `SETTINGS.bigText = true; applyA11y(); startClassic(); S.coins = 9999; const t = placeTower('minigun', 300, 345); for (let i = 0; i < 3; i++) upgradeTower(t); S.selected = t;`,
  'big-fork':       `SETTINGS.bigText = true; applyA11y(); startClassic(); S.coins = 9999; const t = placeTower('glock', 300, 345); upgradeTower(t); upgradeTower(t); S.selected = t;`,
  'big-menu':       `SETTINGS.bigText = true; applyA11y(); toMenuForAudit(); showOverlay('menu');`,
  'big-settings':   `SETTINGS.bigText = true; applyA11y(); toMenuForAudit(); showOverlay('settings', 'menu');`,
  'big-tree':       `SETTINGS.bigText = true; applyA11y(); toMenuForAudit(); showOverlay('tree', 'conq');`,
  'credits':        `toMenuForAudit(); showOverlay('credits');`,
  'login':          `toMenuForAudit(); STATS.streak = 3; showOverlay('login', 100);`,
  'pause':          `startClassic(); S.round = 3; pauseGame();`,
  'match-win':      `startMatch('isles', 2); S.lives = 8; S.round = S.rounds.length; S.inRound = true; S.spawns = []; S.enemies = []; update(0.02);`,
  'match-lose':     `startMatch('isles', 2); S.round = 3; S.lives = 1; S.inRound = true; S.enemies = []; spawnEnemy('teen', PATH_LEN - 1); update(0.05);`,
  'island-win':     `startMatch('city', 6); S.lives = 10; S.round = S.rounds.length; S.inRound = true; S.spawns = []; S.enemies = []; update(0.02);`,
  'classic-win':    `startClassic(); S.round = 15; S.inRound = true; S.spawns = []; S.enemies = []; update(0.02);`,
  'classic-lose':   `startClassic(); S.round = 6; S.lives = 1; S.inRound = true; S.enemies = []; spawnEnemy('teen', PATH_LEN - 1); update(0.05);`,
};

const MEASURE = `
  updateUI(true);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  fitLayout();
  await new Promise(r => setTimeout(r, 260));   // let a sliding drawer finish
  const drawerClosed = document.body.classList.contains('drawer') && !document.body.classList.contains('drawer-open');
  const se = document.scrollingElement, vw = innerWidth, vh = innerHeight, issues = [];
  const box = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const onScreen = (el, name) => { if (!el || !el.offsetParent && getComputedStyle(el).position !== 'fixed') return; const b = box(el);
    if (b.l < -1 || b.t < -1 || b.r > vw + 1 || b.b > vh + 1) issues.push(name + ' off-screen ' + [b.l, b.t, b.r, b.b].map(Math.round).join(',')); };
  if (se.scrollHeight > vh + 1 || se.scrollWidth > vw + 1) issues.push('page scrolls ' + se.scrollWidth + 'x' + se.scrollHeight);
  const menu = document.body.classList.contains('in-menu');
  onScreen(document.getElementById('stage'), 'stage');
  if (!menu) {
    onScreen(document.getElementById('hud'), 'hud'); if (!drawerClosed) onScreen(document.getElementById('side'), 'side');
    for (const el of document.querySelectorAll('#hud > *')) if (el.offsetParent) onScreen(el, 'hud item');
    const side = document.getElementById('side');
    if (!drawerClosed) for (const b of side.querySelectorAll('.box')) { if (!b.offsetParent) continue; const z = +(b.style.zoom || 1); const bb = box(b), sb = box(side);
      if (bb.b > sb.b + 2) issues.push('side box clipped by ' + Math.round(bb.b - sb.b) + 'px');
      if (z < 0.6) issues.push('side shrunk to ' + z.toFixed(2)); }
    const st = box(document.getElementById('stage'));
    if (st.w < Math.min(vw, 960) * 0.45) issues.push('game view small: ' + Math.round(st.w) + 'px');
  }
  const o = document.getElementById('overlay'), m = o.querySelector('.modal');
  let modalZoom = 1;
  if (m && !o.classList.contains('hide')) {
    onScreen(m, 'modal');
    modalZoom = +(m.style.zoom || 1);
    if (m.classList.contains('fitscroll')) issues.push('modal scrolls inside');
    else if (modalZoom < 0.55) issues.push('modal shrunk to ' + modalZoom.toFixed(2));
    for (const b of m.querySelectorAll('button')) if (b.offsetParent) onScreen(b, 'button "' + b.textContent.trim().slice(0, 18) + '"');
    const mb = box(m);   // every card/tile must sit inside the menu box and on screen
    for (const el of m.querySelectorAll('.isl,.hero,.node,.ach,.guide>div,.match,.tab,.tlist>div,.menu-btns button')) { if (!el.offsetParent) continue; const b = box(el);
      if (b.r > Math.min(mb.r, vw) + 2 || b.l < Math.max(mb.l, 0) - 2 || b.b > Math.min(mb.b, vh) + 2) { issues.push('card outside menu: ' + (el.className || el.tagName) + ' ' + el.textContent.trim().slice(0, 16)); break; } }
  }
  // smallest visible text after any shrink-to-fit zoom
  let minText = 99, minWhere = '';
  const scope = [...(m && !o.classList.contains('hide') ? [m] : []), ...(menu ? [] : [document.getElementById('side'), document.getElementById('hud')])];
  for (const root of scope) for (const el of root.querySelectorAll('*')) {
    if (!el.offsetParent || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const px = parseFloat(getComputedStyle(el).fontSize) * (el.currentCSSZoom || 1);
    if (px < minText) { minText = px; minWhere = el.textContent.trim().slice(0, 20); } }
  if (minText < 9) issues.push('text too small: ' + minText.toFixed(1) + 'px "' + minWhere + '"');
  // wasted space: how much of the area under the HUD is neither game view nor panels
  if (!menu && !document.body.classList.contains('drawer')) { const mr = box(document.getElementById('main')), st = box(document.getElementById('stage')), sd = box(document.getElementById('side'));
    const empty = 1 - (st.w * st.h + sd.w * sd.h) / (mr.w * mr.h); if (empty > 0.33) issues.push('wasted space ' + Math.round(empty * 100) + '%'); }
  const sb = box(document.getElementById('stage'));
  return { stage: Math.round(sb.w) + 'x' + Math.round(sb.h) + '@' + Math.round(sb.l) + ',' + Math.round(sb.t), minText: +minText.toFixed(1), issues, hudH: Math.round(box(document.getElementById('hud')).h), modalZoom: +modalZoom.toFixed(2),
           sideZoom: +(+(document.querySelector('#side .box')?.style.zoom || 1)).toFixed(2), menu };
`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const exe = BROWSERS.find(p => fs.existsSync(p));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cvt-audit-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files',
    '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let fails = 0, total = 0;
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) { await sleep(200); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) {} }
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map(), events = [];
    ws.onmessage = m => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) events.push(msg.method); };
    const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
      return r.result.result.value;
    };
    await send('Page.enable'); await send('Runtime.enable');
    for (const dev of DEVICES) {
      await send('Emulation.setDeviceMetricsOverride', { width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr || 1, mobile: !!dev.mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: !!dev.mobile });
      events.length = 0;
      await send('Page.navigate', { url: GAME });
      for (let i = 0; i < 50 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
      await evaluate(`await document.fonts.ready; window.unlockAch = () => {}; for (const h of HERO_IDS) HERO_SAVE.owned[h] = true;
        goldenUnlocked = true; PROG.isles = 6; PROG.city = 2; buildShop();
        window.toMenuForAudit = () => { newGame(); setMap('isles'); STATS.loginDay = dayKey(); STATS.tutorialDone = true; };`);
      console.log(`\n${dev.name} (${dev.w}x${dev.h})`);
      let gameStage = null;   // the map must keep one size and position across every in-game screen on a device
      for (const [scene, js] of Object.entries(SCENES)) {
        total++;
        let res;
        try { await evaluate(`SETTINGS.bigText = false; applyA11y(); $('overlay').classList.add('hide'); document.body.classList.remove('in-menu'); ${js}`); res = await evaluate(MEASURE); }
        catch (e) { res = { issues: ['ERROR ' + e.message.split('\n')[0]] }; }
        if (res.stage && !res.menu) { gameStage = gameStage || res.stage; if (res.stage !== gameStage) res.issues.push(`map moved: ${gameStage} -> ${res.stage}`); }
        const png = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${dev.name}--${scene}.png`), Buffer.from(png.result.data, 'base64'));
        const ok = !res.issues.length; if (!ok) fails++;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${scene.padEnd(13)} hud ${String(res.hudH).padStart(3)}px  side x${res.sideZoom}  modal x${res.modalZoom}  text ${res.minText}px${ok ? '' : '  -> ' + res.issues.join('; ')}`);
      }
    }
    ws.close();
  } finally { proc.kill(); await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
  console.log(`\n${total - fails}/${total} passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
