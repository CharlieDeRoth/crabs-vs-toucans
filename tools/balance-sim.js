// Balance simulator: bots of three skill levels play Classic, the Toucanzilla extra stage and every campaign
// match using the real game code (headless Edge/Chrome), plus a damage-per-coin table for every crab/upgrade.
// Usage:  node tools/balance-sim.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const PORT = 9335;
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// optional section filter: value classic extra isles city olympus (no args = everything)
const ONLY = process.argv.slice(2), want = k => !ONLY.length || ONLY.includes(k);

// Runs inside the page. Bots:
//  weak    - cheap crabs in so-so spots, almost no upgrades, never plans for camo
//  average - sensible build order in decent spots, buys upgrades, gets camo detection by round 5
//  strong  - best spots, camo detection early, balances crabs and upgrades, uses Golden Crab/hero when unlocked
const BOT_JS = `
window.unlockAch = () => {};
window.runBot = (skill, start, opts = {}) => {
  start();
  if (opts.extraFrom) { S.round = 15; S.extra = true; S.rounds = ALL_ROUNDS; S.coins = opts.extraCoins; }
  const rng = mulberry(opts.seed || 1);
  const spots = [];
  for (let y = 30; y < H - 20; y += 12) for (let x = 30; x < W - 20; x += 12) {
    if (!canPlace(x, y)) continue;
    let cov = 0; for (let d = 0; d < PATH_LEN; d += 30) { const p = posAt(d); if (Math.hypot(p.x - x, p.y - y) < 115) cov++; }
    spots.push({ x, y, cov });
  }
  spots.sort((a, b) => b.cov - a.cov);
  const pool = skill === 'strong' ? spots.slice(0, 60) : skill === 'average' ? spots.slice(0, 140) : spots.slice(30, 400);
  const pick = melee => { const ok = pool.filter(s => canPlace(s.x, s.y) && (!melee || pathDist(s.x, s.y) < 70)); return ok.length ? (skill === 'strong' ? ok[0] : ok[Math.floor(rng() * Math.min(ok.length, skill === 'weak' ? 60 : 12))]) : null; };
  const orders = {
    weak:    ['glock', 'clawer', 'glock', 'glock', 'minigun', 'clawer', 'glock', 'king', 'minigun'],
    average: ['glock', 'glock', 'clawer', 'sniper', 'minigun', 'king', 'drone', 'minigun', 'king', 'sniper', 'drone'],
    strong:  ['glock', 'sniper', 'clawer', 'minigun', 'king', 'drone', 'minigun', 'king', 'sniper', 'drone', 'king'],
  };
  const order = [...orders[skill]];
  if (opts.golden) order.splice(4, 0, 'golden');
  if (opts.hero) { HERO_SAVE.equipped = opts.hero; order.splice(2, 0, opts.hero); }
  let oi = 0, g = 0, spent = 0, wasted = 0;
  const upgradeCap = skill === 'weak' ? 1 : 5;
  while (S.state === 'play' && g++ < 400000) {
    if (g % 10 === 0) {
      const want = order[oi % order.length];
      const ups = S.towers.filter(t => t.lvl < Math.min(upgradeCap, TW[t.type].ups.length) && !(TW[t.type].kind === 'aura' && t.lvl >= goldenUpsUnlocked()));
      const cheapUp = ups.sort((a, b) => nextUpgrade(a, a.path || 'A').cost - nextUpgrade(b, b.path || 'A').cost)[0];
      const upCost = cheapUp ? nextUpgrade(cheapUp, cheapUp.path || 'A').cost : 1e9;
      const ratio = skill === 'weak' ? 0.2 : skill === 'average' ? 0.7 : 0.9;
      if (TW[want].hero && S.towers.some(t => TW[t.type].hero)) oi++;
      else if (upCost < TW[want].cost * ratio && S.coins >= upCost) upgradeTower(cheapUp, Math.random() < .5 ? 'A' : 'B');
      else if (S.coins >= TW[want].cost) { const sp = pick(TW[want].kind === 'melee'); if (sp && placeTower(want, sp.x, sp.y)) oi++; else oi++; }
      if (TT && skill !== 'weak' && S.towers.length && S.towers.some(t => t.st.ability && t.abilityCd <= 0) && S.enemies.length > 6) useAbility(S.towers.find(t => t.st.ability));
    }
    if (!S.inRound) startRound();
    update(0.02);
  }
  return { win: S.state === 'win', round: S.round, of: S.rounds.length, lives: S.lives, coins: S.coins, cc: S.ccEarned || 0, crabs: S.towers.length,
           boss: (S.enemies.find(e => TT[e.type].mega) || {}).hp };
};
// damage-per-second and dps-per-coin for every crab at every level (single target; splash/pierce noted)
window.valueTable = () => {
  const rows = [];
  for (const k of [...TW_ORDER, 'conq', 'unicorn', 'shrimp']) {
    let spent = TW[k].cost;
    for (let l = 0; l <= TW[k].ups.length; l++) {
      if (l > 0) spent += TW[k].ups[l - 1].cost;
      const s = crabStats(k, l), mult = (s.shots || 1) * (s.drones || 1) * (s.beams || 1);
      const dps = s.dmg / s.rate * mult;
      rows.push({ crab: k, lvl: l, spent, dps: +dps.toFixed(1), perCoin: +(dps / spent * 100).toFixed(2), range: Math.round(s.range), note: [TW[k].kind === 'beam' && 'pierces', TW[k].kind === 'melee' && 'hits ' + s.targets, s.splash && 'splash', s.camo && 'camo'].filter(Boolean).join(' ') });
    }
  }
  return rows;
};
`;

async function main() {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cvt-bal-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
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
    await send('Page.navigate', { url: GAME });
    for (let i = 0; i < 50 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
    await evaluate(BOT_JS);
    const fmt = r => (r.win ? 'WIN ' : 'lose') + ` r${r.round}/${r.of} lives ${String(r.lives).padStart(2)} left-over ${String(r.coins).padStart(5)}c +${r.cc}cc` + (r.boss ? ` (boss hp left ${Math.round(r.boss)})` : '');
    const SEEDS = [1, 2, 3];

    if (want('value')) {
      console.log('=== CRAB VALUE (single-target dps per 100 coins spent) ===');
      const vt = await evaluate('return valueTable();');
      for (const r of vt) console.log(`${r.crab.padEnd(8)} L${r.lvl}  spent ${String(r.spent).padStart(5)}  dps ${String(r.dps).padStart(6)}  dps/100c ${String(r.perCoin).padStart(5)}  range ${r.range}  ${r.note}`);
    }
    if (want('classic')) {
      console.log('\n=== CLASSIC (15 rounds) ===');
      for (const skill of ['weak', 'average', 'strong']) for (const seed of SEEDS) {
        const r = await evaluate(`goldenUnlocked = false; buildShop(); return runBot('${skill}', () => startClassic(), { seed: ${seed} });`);
        console.log(`${skill.padEnd(8)} seed ${seed}: ${fmt(r)}`);
      }
    }
    if (want('extra')) {
      console.log('\n=== TOUCANZILLA EXTRA STAGE (starting with a typical round-15 bank) ===');
      for (const skill of ['average', 'strong']) {
        const r = await evaluate(`return runBot('${skill}', () => startClassic(), { seed: 1, extraFrom: true, extraCoins: 2400 });`);
        console.log(`${skill.padEnd(8)}: ${fmt(r)}`);
      }
    }
    console.log('\n=== CAMPAIGN (golden crab + hero for later islands, as a progressing player would have) ===');
    for (const [isl, golden, hero] of [['isles', false, null], ['city', true, 'conq'], ['olympus', true, 'unicorn']].filter(([i]) => want(i))) {
      for (let m = 1; m <= 6; m++) {
        const line = [];
        for (const skill of ['weak', 'average', 'strong']) {
          let wins = 0, last;
          for (const seed of SEEDS) {
            const r = await evaluate(`goldenUnlocked = ${golden}; PROG.isles = ${golden ? 6 : 0}; PROG.city = ${isl === 'olympus' ? 6 : 0};
              for (const h of HERO_IDS) { HERO_SAVE.owned[h] = true; HERO_SAVE.nodes[h] = {}; } HERO_SAVE.equipped = null; buildShop();
              return runBot('${skill}', () => startMatch('${isl}', ${m}), { seed: ${seed}, golden: ${golden && skill !== 'weak'}, hero: ${hero && skill === 'strong' ? `'${hero}'` : 'null'} });`);
            if (r.win) wins++; last = r;
          }
          line.push(`${skill} ${wins}/3 (${last.win ? last.lives + ' lives' : 'r' + last.round + '/' + last.of}, ${last.coins}c left${last.boss ? ', boss ' + Math.round(last.boss) : ''})`);
        }
        console.log(`${isl.padEnd(7)} M${m}: ${line.join('  |  ')}`);
      }
    }
    ws.close();
  } finally { proc.kill(); await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
}
main().catch(e => { console.error(e); process.exit(1); });
