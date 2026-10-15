// Sideways test run: starts a local server, opens the game in headless
// Chromium and checks the things that have broken before.
//   node tests/run.js            (needs Playwright: npm i -D playwright)
// Exits non-zero if anything fails.
const { spawn, execSync } = require('child_process');
const path = require('path');

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(path.join(globalRoot, 'playwright'));
}
const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '..');
const PORT = 8799;
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH || (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name, Date.now() - t0]); console.log(`  ok   ${name}`); }
  catch (e) { results.push([false, name, Date.now() - t0, e]); console.log(`  FAIL ${name}\n       ${String(e.message || e).split('\n')[0]}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
  // A fake game controller the tests can move.
  await ctx.addInitScript(() => {
    window.__fakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__padOn = false;
    const real = navigator.getGamepads?.bind(navigator);
    navigator.getGamepads = () => (window.__padOn ? [{ id: 'test pad', connected: true, mapping: 'standard', ...window.__fakePad }] : (real ? real() : []));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|leaderboard|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  const S = (fn, arg) => page.evaluate(fn, arg);
  const ready = async () => { await page.goto(URL); await page.waitForFunction(() => !!window.__sideways, null, { timeout: 20000 }); };

  console.log('Sideways tests');
  await check('boots with no errors and shows the welcome to a new player', async () => {
    await ready();
    await page.waitForTimeout(800);
    assert(errors.length === 0, 'page errors: ' + errors.join(' | '));
    assert(await S(() => !document.getElementById('welcome').hidden), 'welcome card not shown on first visit');
    await page.click('#wel-skip');
    assert(await S(() => !document.getElementById('start').hidden), 'title menu not shown after skipping');
    await page.reload(); await page.waitForTimeout(600);
    assert(await S(() => document.getElementById('welcome').hidden), 'welcome shown again after skipping');
  });

  await check('every car builds in every style (and as a ghost, and in cockpit)', async () => {
    const bad = await S(async () => {
      const { buildCarModel, carSkins } = await import('/src/carModel.js');
      const { CARS, CAR_ORDER } = await import('/src/car.js');
      const out = [];
      for (const id of CAR_ORDER) for (const sk of carSkins(CARS[id])) {
        try { const m = buildCarModel(CARS[id], { skin: sk.id }); m.setCockpit(true); m.setCockpit(false); m.dispose(); buildCarModel(CARS[id], { skin: sk.id, ghost: true }).dispose(); }
        catch (e) { out.push(`${id}:${sk.id} ${e.message}`); }
        if (!sk.id) out.push(`${id} has a style with no id`);
      }
      return out;
    });
    assert(bad.length === 0, bad.join('; '));
  });

  await check('every Works style comes with its own paint', async () => {
    const bad = await S(async () => {
      const { carSkins } = await import('/src/carModel.js');
      const { CARS, CAR_ORDER } = await import('/src/car.js');
      return CAR_ORDER.filter((id) => !carSkins(CARS[id])[0]?.paint);
    });
    assert(bad.length === 0, 'no works paint: ' + bad.join(', '));
  });

  for (const [kind, seed] of [['daily', null], ['classic', 900031], ['random', 274801], ['endurance', 3000123], ['champ', null], ['practice', null]]) {
    await check(`${kind} stage builds`, async () => {
      const r = await S(([kind, seed]) => {
        const s = window.__sideways;
        if (kind === 'champ') seed = 1000000 + 10;
        if (kind === 'daily') seed = 20261001;
        s.loadStage(kind, seed ?? 0);
        return { n: s.road.n, len: s.road.length, finish: s.stage.finish };
      }, [kind, seed]);
      assert(r.n > 100 && r.len > 300, `road too short: ${JSON.stringify(r)}`);
      assert(errors.length === 0, errors.join(' | '));
    });
  }

  await check('no rock, tree or prop reaches into the road (Classics + random)', async () => {
    const bad = await S(() => {
      const s = window.__sideways, out = [];
      for (const [kind, seed] of [['classic', 900031], ['classic', 900122], ['classic', 900228], ['classic', 900016], ['classic', 900151], ['random', 274801], ['random', 512345]]) {
        s.loadStage(kind, seed);
        const road = s.road;
        s.obGrid.forEach((list) => { for (const o of list) {
          const q = road.nearest(o.x, o.z);
          if (q.along < s.stage.start - 20 || q.along > s.stage.finish + 20) continue;
          if (q.dist - o.r < road.width / 2) out.push(`${seed}@${Math.round(q.along)}m`);
        } });
      }
      return out;
    });
    assert(bad.length === 0, 'in the road: ' + bad.slice(0, 8).join(', '));
  });

  await check('a stage starts from the menu and the clock runs', async () => {
    await ready();
    await S(() => document.getElementById('btn-daily').click());
    await page.waitForTimeout(500);
    await S(() => document.getElementById('garage-go').click());
    await page.waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 15000 });
    // Wait out the countdown like a player would, then floor it.
    await page.waitForFunction(() => ['ready', 'running'].includes(window.__sideways.run.state), null, { timeout: 15000 });
    await S(() => { window.__sideways.auto = () => ({ throttle: 1, brake: 0, steer: 0, handbrake: false }); });
    await page.waitForTimeout(6000);
    const t = await S(() => window.__sideways.run.t);
    await S(() => { window.__sideways.auto = null; });
    assert(t > 0.5, `clock did not run (t=${t})`);
  });

  await check('a test driver finishes a Classic stage', async () => {
    await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
    const r = await S(() => { const r = window.__bot('vector', 'classic', 900122, { sign: -1, maxT: 200, gripK: 0.62 }); delete r.trace; return r; });
    assert(r.done, `did not finish: ${JSON.stringify(r)}`);
  });

  await check('cars finish two Classics within 6% of each other', async () => {
    const times = await S(() => {
      const out = {};
      for (const c of ['stiletto', 'pocket', 'quadra', 'vector', 'raider', 'brute']) {
        let sum = 0;
        for (const sd of [900122, 900016]) {
          let r = window.__bot(c, 'classic', sd, { sign: -1, maxT: 200, gripK: 0.66 });
          if (!r.done) r = window.__bot(c, 'classic', sd, { sign: -1, maxT: 200, gripK: 0.58 });
          sum += r.done ? r.t : 999;
        }
        out[c] = +sum.toFixed(1);
      }
      return out;
    });
    const v = Object.values(times), lo = Math.min(...v), hi = Math.max(...v);
    assert(hi / lo < 1.06, `spread too wide: ${JSON.stringify(times)}`);
    console.log('       ' + JSON.stringify(times));
  });

  await check('pause menu, copy stage code, paste stage code', async () => {
    await ready();
    await S(() => { localStorage.setItem('sideways.welcomed', '1'); });
    await page.reload(); await page.waitForFunction(() => !!window.__sideways);
    await S(() => navigator.clipboard.writeText('Stage code 274801'));
    await page.click('#btn-paste');
    await page.waitForTimeout(150);
    assert((await page.inputValue('#code-in')) === '274801', 'paste did not fill the code');
    await S(() => document.querySelector('#code-form button[type=submit]').click());
    await page.waitForTimeout(400);
    await S(() => document.getElementById('garage-go').click());
    await page.waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(await S(() => !document.getElementById('pause').hidden), 'pause did not open');
    await S(() => navigator.clipboard.writeText(''));
    await page.click('#btn-pcopy');
    await page.waitForTimeout(200);
    assert((await S(() => navigator.clipboard.readText())) === '274801', 'copy code did not copy');
  });

  await check('random stage setup makes the stage you asked for', async () => {
    await ready();
    await S(() => { document.getElementById('btn-random').click(); });
    await S(() => { for (const [k, v] of [['theme', 'snow'], ['weather', 'night'], ['hills', 'flat']]) document.querySelector(`[data-gen="${k}"][data-v="${v}"]`).click(); });
    await S(() => document.getElementById('gen-go').click());
    await page.waitForTimeout(300);
    await S(() => document.getElementById('garage-go').click());
    await page.waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 15000 });
    const r = await S(async () => { const s = window.__sideways; const { pickTheme } = await import('/src/themes.js'); const p = pickTheme(s.stage.seed); return { theme: p.theme.id, hills: p.hilliness, weather: s.weather.id }; });
    assert(r.theme === 'snow' && r.weather === 'night' && r.hills < 0.9, JSON.stringify(r));
  });

  await check('game controller drives and moves through menus', async () => {
    await ready();
    await S(() => { window.__padOn = true; window.__fakePad.axes[0] = -0.8; window.__fakePad.buttons[7] = { pressed: true, value: 0.9 }; });
    await page.waitForTimeout(200);
    // Driving input is off in the menus, so read it as it would be in a race.
    const st = await S(() => { const i = window.__sideways.input, was = i.enabled; i.enabled = true; const r = { ...i.update(1 / 60) }; i.enabled = was; return r; });
    assert(st.steer > 0.5 && st.throttle > 0.8, `pad not read: ${JSON.stringify(st)}`);
    await S(() => { window.__fakePad.axes[0] = 0; window.__fakePad.buttons[7] = { pressed: false, value: 0 }; });
    // D-pad down then A on the title should move focus and press something.
    await S(() => { document.activeElement?.blur(); });
    // Press and release, polling in between (frames can be slow in a headless browser).
    const press = (i) => S((i) => {
      const inp = window.__sideways.input;
      window.__fakePad.buttons[i] = { pressed: true, value: 1 }; inp.pollPad();
      window.__fakePad.buttons[i] = { pressed: false, value: 0 }; inp.pollPad();
    }, i);
    await press(13);
    const focused = await S(() => document.activeElement?.id || document.activeElement?.tagName);
    assert(focused && focused !== 'BODY', 'D-pad did not focus anything');
    await S(() => { window.__padOn = false; });
  });

  await check('phone drag steering gives analogue steer', async () => {
    const st = await S(async () => {
      const s = window.__sideways;
      await s.input.setSteerMode('drag');
      s.input.dragSteer = 0.4;
      const r = s.input.update(1 / 60).steer;
      await s.input.setSteerMode('buttons');
      return r;
    });
    assert(Math.abs(st - 0.4) < 1e-6, `drag steer not used: ${st}`);
  });

  await check('Auto graphics steps down when the frame rate is low', async () => {
    // Headless Chromium draws in software, so it runs slowly: Auto should notice.
    await S(() => { localStorage.setItem('sideways.welcomed', '1'); localStorage.removeItem('sideways.autoq'); localStorage.setItem('sideways.quality', 'auto'); });
    await ready();
    await S(() => document.getElementById('btn-practice').click());
    await page.waitForTimeout(400);
    await S(() => document.getElementById('garage-go').click());
    await page.waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 15000 });
    await page.waitForFunction(() => !!localStorage.getItem('sideways.autoq'), null, { timeout: 30000 });
    const label = await S(() => document.querySelector('#opt-quality option[value="auto"]').textContent);
    assert(/Auto \((Medium|Low|Lowest)\)/.test(label), 'menu label: ' + label);
  });

  await check('no errors logged during the run', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });

  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
