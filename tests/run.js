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
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
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
    window.__rumbles = [];
    window.__fakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), vibrationActuator: { playEffect: async (type, o) => { window.__rumbles.push(o); } } };
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
    await page.waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 30000 });
    // Wait out the countdown like a player would, then floor it.
    // (The countdown runs on frame time; headless software rendering is slow.)
    await page.waitForFunction(() => ['ready', 'running'].includes(window.__sideways.run.state), null, { timeout: 45000 });
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

  await check('steering sensitivity, dead zone, rumble and handbrake assist', async () => {
    if (!(await S(() => !!window.__sideways))) await ready();
    const r = await S(() => {
      const s = window.__sideways, i = s.input, F = s.FEEL, was = i.enabled, saved = { ...F };
      i.enabled = true; window.__padOn = true;
      const steerAt = (x) => { window.__fakePad.axes[0] = x; return i.update(1 / 60).steer; };
      F.sens = 1; F.dead = 0.12; const base = steerAt(-0.5);
      F.sens = 1.6; const quick = steerAt(-0.5);
      F.dead = 0.3; const inDead = steerAt(-0.25);
      window.__fakePad.axes[0] = 0;
      F.rumble = true; window.__rumbles.length = 0; s.crash(12); const rumbled = window.__rumbles.length;
      window.__padOn = false; i.pollPad(); i.enabled = was;
      // Handbrake assist: heading into a hairpin, steering into it.
      s.loadStage('classic', 900016);
      const c = s.sharpCorners[0];
      const k = s.road.indexAt(c.entry - 2);
      s.placeOnRoad(k); s.run.state = 'racing';
      s.car.vx = Math.sin(s.car.yaw) * 14; s.car.vz = Math.cos(s.car.yaw) * 14; s.car.speed = 14;
      s.car.steerInput = c.dir; s.car.drifting = false;
      F.hbAssist = true;
      const pulled = s.handbrakeAssist({ throttle: 1, brake: 0, steer: c.dir, handbrake: false }, 1 / 120).handbrake;
      F.hbAssist = false; s.handbrakeAssist({ throttle: 0, brake: 0, steer: 0, handbrake: false }, 1);
      const off = s.handbrakeAssist({ throttle: 1, brake: 0, steer: c.dir, handbrake: false }, 1 / 120).handbrake;
      Object.assign(F, saved);
      return { base, quick, inDead, rumbled, pulled, off };
    });
    assert(r.quick > r.base * 1.4, `sensitivity had no effect: ${JSON.stringify(r)}`);
    assert(r.inDead === 0, `dead zone not applied: ${JSON.stringify(r)}`);
    assert(r.rumbled > 0, 'a crash did not rumble the controller');
    assert(r.pulled && !r.off, `handbrake assist wrong: ${JSON.stringify(r)}`);
    await ready();
  });

  await check('endurance stages change weather and light along the way', async () => {
    if (!(await S(() => !!window.__sideways))) await ready();
    const r = await S(() => {
      const s = window.__sideways, out = [];
      for (let seed = 3000001; seed < 3000041 && out.length < 3; seed++) {
        s.loadStage('endurance', seed);
        const P = s.skyPlan, L = s.road.length;
        if (!P || P.keys.length < 2) continue;
        const ids = [], fogs = [];
        for (const f of [0.02, 0.5, 0.97]) { s.updateSky(f * L); ids.push(s.weather.id); fogs.push(s.scene.fog.color.getHexString()); }
        s.updateSky(0);
        out.push({ seed, keys: P.keys.map((k) => k.w.id), ids, fogs, back: s.weather.id });
      }
      return out;
    });
    assert(r.length >= 3, 'too few endurance stages with a weather story: ' + JSON.stringify(r));
    for (const x of r) {
      assert(x.ids[0] === x.keys[0] && x.ids[2] === x.keys[x.keys.length - 1], 'weather did not follow the plan: ' + JSON.stringify(x));
      assert(x.fogs[0] !== x.fogs[2], 'sky did not change: ' + JSON.stringify(x));
      assert(x.back === x.keys[0], 'restart did not reset the weather: ' + JSON.stringify(x));
    }
  });

  await check('crowd noise near spectators, echo between canyon walls', async () => {
    if (!(await S(() => !!window.__sideways))) await ready();
    const r = await S(() => {
      const s = window.__sideways;
      s.loadStage('classic', 900031);
      const R = s.road, st = R.indexAt(10), far = R.indexAt(R.length * 0.5);
      s.placeOnRoad(st);
      const atStart = s.trackside.update(0.016, s.car.x, s.car.z, { speed: 20 });
      // Find the most enclosed spot on a few canyon stages.
      let maxEcho = 0, openEcho = 1;
      for (let seed = 900001; seed < 900400; seed++) {
        s.loadStage('classic', seed);
        if (s.stage.theme.id !== 'desert') continue;
        for (let a = 50; a < s.road.length - 50; a += 40) {
          s.placeOnRoad(s.road.indexAt(a));
          s.stepSim?.(0.02, { throttle: 0, brake: 0, steer: 0, handbrake: false });
          s.measureEcho(); maxEcho = Math.max(maxEcho, s.echo.k);
        }
        if (maxEcho > 0.3) break;
      }
      s.loadStage('practice'); s.placeOnRoad(5); s.measureEcho(); openEcho = s.echo.k;
      return { atStart, maxEcho, openEcho };
    });
    assert(r.atStart > 0.2, 'no crowd noise at the start: ' + JSON.stringify(r));
    assert(r.maxEcho > 0.3 && r.openEcho < 0.1, 'echo wrong: ' + JSON.stringify(r));
  });

  await check('replay director: speed, slow motion, cameras and a saved clip', async () => {
    await ready();
    await S(() => { const s = window.__sideways; s.start('classic', 900122); });
    await page.waitForTimeout(500);
    const r0 = await S(() => {
      const s = window.__sideways, R = s.road, smp = s.recorder.samples;
      smp.length = 0;
      for (let i = 0; i < 300; i++) { const k = R.indexAt(30 + i * 1.2); smp.push([i * 0.05, R.px[k], R.py[k] + (i > 100 && i < 130 ? 2 : 0), R.pz[k], Math.atan2(R.tx[k], R.tz[k]), 0, 0]); }
      s.run.state = 'finished';
      s.startReplay();
      s.replay.speed = 0.5;
      return { on: s.replay.on };
    });
    assert(r0.on, 'replay did not start');
    await page.waitForTimeout(2500);
    const r1 = await S(() => {
      const s = window.__sideways, t1 = s.replay.t;
      const cams = [];
      for (let k = 0; k < 6; k++) { s.replayCam(); cams.push(s.replay.cam); }
      return { t1, cams, label: document.getElementById('rp-speed').textContent };
    });
    assert(r1.t1 > 0 && r1.t1 < 3, `replay time wrong at half speed: ${r1.t1}`);
    assert(new Set(r1.cams).size === 6 && r1.label === '0.5×', 'cameras/speed label: ' + JSON.stringify(r1));
    await S(() => window.__sideways.toggleClip());
    // Software rendering is slow: wait until a few frames have been encoded.
    await page.waitForFunction(() => (window.__sideways.clip.sizes || []).some((n) => n > 1000), null, { timeout: 30000 }).catch(() => {});
    await S(() => window.__sideways.toggleClip());
    await page.waitForFunction(() => !document.getElementById('clip-panel').hidden, null, { timeout: 15000 }).catch(async (e) => {
      throw new Error(e.message + ' ' + JSON.stringify(await S(() => ({ mr: !!window.MediaRecorder, toast: document.getElementById('toast').textContent, sizes: window.__sideways.clip.sizes, st: window.__sideways.clip.rec?.state, rec: document.getElementById('rp-clip').className }))));
    });
    const r2 = await S(() => ({ src: document.getElementById('clip-video').src, href: document.getElementById('clip-save').getAttribute('download') }));
    assert(r2.src.startsWith('blob:') && /\.(webm|mp4)$/.test(r2.href), 'clip not made: ' + JSON.stringify(r2));
    await S(() => { document.getElementById('clip-close').click(); window.__sideways.stopReplay(); });
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

  await check('shared ghosts: a best run uploads, and another player\'s ghost can be raced', async () => {
    // A stand-in for the claude.ai shared database (only there for real).
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await c2.addInitScript(() => {
      const docs = new Map();
      window.__docs = docs;
      const db = {
        collection: (path) => ({
          limit() { return this; },
          onSnapshot(cb) {
            const send = () => cb({ docs: [...docs].filter(([p]) => p.split('/').length === 2 && p.startsWith(path + '/')).map(([p, d]) => ({ id: p.split('/')[1], data: () => d })) });
            send(); window.__resend = send; return () => {};
          },
        }),
        doc: (path) => ({
          get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
          set: async (d) => { docs.set(path, JSON.parse(JSON.stringify(d))); window.__resend?.(); },
          update: async (d) => { const cur = docs.get(path) || {}; docs.set(path, { ...cur, ...d, best: { ...(cur.best || {}), ...(d.best || {}) } }); window.__resend?.(); },
        }),
      };
      window.claude = { use: async (n) => (n === 'db' ? db : n === 'user' ? { id: async () => 'me-123' } : null) };
      localStorage.setItem('sideways.welcomed', '1');
      localStorage.setItem('sideways.nick', 'Tester');
    });
    const p2 = await c2.newPage();
    const errs2 = []; p2.on('pageerror', (e) => errs2.push(String(e)));
    await page.goto('about:blank'); // one WebGL page at a time
    await p2.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p2.waitForFunction(() => window.__sideways?.board?.available, null, { timeout: 60000 });
    const r = await p2.evaluate(async () => {
      const s = window.__sideways, { packGhost } = await import('/src/ghost.js');
      s.loadStage('classic', 900122);
      // Upload my ghost, then plant a rival's.
      const samples = [];
      for (let i = 0; i < 400; i++) { const k = s.road.indexAt(30 + i * 5); samples.push([i * 0.05, s.road.px[k], s.road.py[k], s.road.pz[k], 0, 0, 0]); }
      await s.board.submitGhost(900122, { car: 'vector', color: '#ff0000', t: 92.5, d: packGhost(samples) });
      const mine = window.__docs.get('scores/me-123/ghosts/s900122');
      window.__docs.set('scores/rival-9/ghosts/s900122', { car: 'brute', color: '#00ff00', t: 90.1, d: packGhost(samples) });
      const btn = document.createElement('button');
      await s.raceGhostOf('rival-9', 'Speedy', btn);
      return { uploaded: !!mine && Array.isArray(mine.d) && mine.d.length > 50, ghost: !!s.ghostModel, hud: document.getElementById('hud-best').textContent };
    });
    await c2.close();
    assert(r.uploaded, 'my ghost was not uploaded');
    assert(r.ghost && /VS SPEEDY/.test(r.hud), 'rival ghost not raced: ' + JSON.stringify(r));
    assert(errs2.length === 0, errs2.join(' | '));
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
