// Sideways test run: starts a local server, opens the game in headless
// Chromium and checks the things that have broken before.
//   node tests/run.js            (needs Playwright: npm i -D playwright)
// Exits non-zero if anything fails.
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
  if (process.env.ONLY) await ready();

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
      for (const [kind, seed] of [['classic', 900031], ['classic', 900122], ['classic', 900228], ['classic', 900016], ['classic', 900151], ['random', 274801], ['random', 512345], ['random', 4000123], ['random', 4300123], ['random', 4600123]]) {
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

  await check('a test driver finishes a tarmac stage and a river stage', async () => {
    if (!(await S(() => !!window.__bot))) await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
    const r = await S(() => ['4000123', '4600123'].map((sd) => {
      let x = window.__bot('vector', 'random', +sd, { sign: -1, maxT: 260, gripK: 0.62 });
      if (!x.done) x = window.__bot('vector', 'random', +sd, { sign: -1, maxT: 260, gripK: 0.55 });
      delete x.trace; return x;
    }));
    assert(r.every((x) => x.done), 'did not finish: ' + JSON.stringify(r));
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

  await check('new stage types: tarmac, night forest, river crossings', async () => {
    if (!(await S(() => !!window.__sideways))) await ready();
    const r = await S(async () => {
      const s = window.__sideways, out = {};
      const { patchAt } = await import('/src/surfaces.js');
      for (const [type, seed] of [['tarmac', 4000123], ['night', 4300123], ['river', 4600123]]) {
        s.loadStage('random', seed);
        const f = s.road.fords?.[0];
        out[type] = {
          theme: s.stage.theme.id, weather: s.weather.id, surf: s.road.surfaces.gravel.name, fords: (s.road.fords || []).length,
          water: f ? patchAt(s.surfPlan, f.at, 0)?.name : null,
          note: f ? s.codriver.notes?.some?.((n) => n.kind === 'ford') : null,
        };
      }
      return out;
    });
    assert(r.tarmac.theme === 'tarmac' && r.tarmac.surf === 'tarmac', 'tarmac: ' + JSON.stringify(r.tarmac));
    assert(r.night.theme === 'nightwood' && r.night.weather === 'night', 'night: ' + JSON.stringify(r.night));
    assert(r.river.fords >= 2 && r.river.water === 'water' && r.river.note, 'river: ' + JSON.stringify(r.river));
  });

  await check('career: a rally through the menus, points, then the season podium', async () => {
    await S(() => { localStorage.removeItem('sideways.career'); localStorage.setItem('sideways.welcomed', '1'); });
    await ready();
    await S(() => document.getElementById('btn-career').click());
    const cal = await S(() => document.getElementById('career-cal').textContent);
    assert(/Next/.test(cal), 'career calendar: ' + cal);
    await S(() => document.getElementById('career-go').click());
    await page.waitForTimeout(500);
    await S(() => document.getElementById('garage-go').click());
    const labels = [];
    for (let k = 0; k < 3; k++) {
      await page.waitForFunction(() => { const s = window.__sideways; return s.careerRun && s.stage.seed === s.careerRun.seed && s.run.state === 'countdown' && document.getElementById('loading').hidden; }, null, { timeout: 60000 });
      const r = await S(() => {
        const s = window.__sideways;
        s.run.state = 'running'; s.run.t = (s.stage.finish - s.stage.start) / (82 / 3.6); s.run.splits = [1, 2, 3, 4, 5];
        s.finishRun();
        return { fin: document.getElementById('fin-career').textContent, next: document.getElementById('btn-next').textContent, retry: document.getElementById('btn-retry').hidden };
      });
      labels.push(r);
      await S(() => document.getElementById('btn-next').click());
    }
    assert(labels[0].next.startsWith('Next stage') && labels[0].retry && /SS1: \d/.test(labels[0].fin), 'stage 1 finish: ' + JSON.stringify(labels[0]));
    assert(labels[2].next.startsWith('Rally results'), 'rally end: ' + JSON.stringify(labels[2]));
    await page.waitForFunction(() => !document.getElementById('career').hidden, null, { timeout: 20000 });
    const after = await S(() => ({ last: document.getElementById('career-last').textContent, pts: window.__sideways.career.points.you, rally: window.__sideways.career.rally }));
    assert(after.rally === 1 && after.pts > 0 && /you finished/.test(after.last), 'after rally 1: ' + JSON.stringify(after));
    await page.screenshot({ path: path.join(__dirname, 'out-career.png') }).catch(() => {});
    // The other three rallies, straight through the career logic, then the finale.
    const fin = await S(async () => {
      const s = window.__sideways, C = await import('/src/career.js');
      while (s.career.rally < 4) {
        const r = C.seasonPlan(s.career.season)[s.career.rally];
        C.recordStage(s.career, { seed: r.seeds[s.career.stage], dist: 2400 }, 2400 / (85 / 3.6));
      }
      C.saveCareer(s.career);
      s.renderCareer();
      document.getElementById('career-go').click();
      return { podium: !document.getElementById('podium').hidden, title: document.getElementById('podium-title').textContent };
    });
    assert(fin.podium && fin.title === 'CHAMPION!', 'podium: ' + JSON.stringify(fin));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(__dirname, 'out-podium.png') }).catch(() => {});
    const next = await S(() => { document.getElementById('podium-go').click(); const c = window.__sideways.career; return { season: c.season, tier: c.tier, rally: c.rally, page: !document.getElementById('career').hidden }; });
    assert(next.season === 2 && next.tier === 1 && next.rally === 0 && next.page, 'next season: ' + JSON.stringify(next));
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

  await check('phone and tablet layouts: nothing important overlaps (emulated devices)', async () => {
    const DEVICES = [['iphone-se', 667, 375], ['iphone-pro-max', 932, 430], ['pixel-7', 915, 412], ['ipad-mini', 1133, 744]];
    const problems = [];
    await page.goto('about:blank');
    for (const [name, w, h] of DEVICES) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
        userAgent: name.startsWith('pixel') ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
          : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' });
      await c.addInitScript(() => { localStorage.setItem('sideways.welcomed', '1'); localStorage.setItem('sideways.fps', '1'); });
      const p = await c.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await p.waitForFunction(() => !!window.__sideways, null, { timeout: 60000 });
      // Title menu: every button reachable (the card may scroll, but not the page sideways).
      const title = await p.evaluate(() => ({ sx: document.documentElement.scrollWidth > innerWidth + 1 }));
      if (title.sx) problems.push(`${name}: title scrolls sideways`);
      await p.evaluate(() => window.__sideways.start('classic', 900122));
      await p.waitForTimeout(2500);
      await p.evaluate(() => { const n = document.getElementById('hud-note'); n.innerHTML = '<div class="pn-tile">3</div><div class="pn-tile">4</div><div class="pn-tile">5</div>'; n.classList.add('show'); n.style.opacity = '1'; });
      const r = await p.evaluate(() => {
        const box = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
        const els = { timing: '#hud-timing', speedo: '.hud-br', map: '#minimap', left: '.tc-left', right: '.tc-right', top: '.tc-top', note: '#hud-note', fps: '#hud-fps' };
        const out = {}; for (const k in els) out[k] = box(els[k]);
        out.touch = !document.getElementById('touch').hidden;
        out.vw = innerWidth; out.vh = innerHeight;
        return out;
      });
      await p.screenshot({ path: path.join(__dirname, `out-${name}.png`) }).catch(() => {});
      await c.close();
      if (!r.touch) problems.push(`${name}: touch controls not shown`);
      const hit = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
      for (const [a, b] of [['timing', 'map'], ['timing', 'top'], ['speedo', 'right'], ['left', 'right'], ['map', 'top'], ['note', 'left'], ['note', 'right'], ['note', 'timing'], ['fps', 'left'], ['fps', 'timing']]) {
        if (hit(r[a], r[b])) problems.push(`${name}: ${a} overlaps ${b}`);
      }
      for (const k of ['timing', 'speedo', 'left', 'right']) {
        const b = r[k];
        if (b && (b.l < -1 || b.t < -1 || b.r > r.vw + 1 || b.b > r.vh + 1)) problems.push(`${name}: ${k} off screen`);
      }
      if (errs.length) problems.push(`${name}: ${errs.join(' | ')}`);
    }
    assert(!problems.length, problems.join('; '));
  });

  await check('offline: installs a service worker, then boots with no connection', async () => {
    // Every module must be in the offline file list.
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const missing = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js') && !sw.includes(`'./src/${f}'`));
    assert(!missing.length, 'not cached for offline: ' + missing.join(', '));
    const c3 = await browser.newContext();
    await c3.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('sideways.welcomed', '1'); });
    const p3 = await c3.newPage();
    await page.goto('about:blank');
    await p3.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p3.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 60000 });
    await p3.evaluate(() => navigator.serviceWorker.ready);
    await p3.waitForFunction(async () => (await (await caches.open('sideways-v1')).keys()).length > 30, null, { timeout: 60000, polling: 1000 });
    await c3.setOffline(true);
    await p3.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    const ok = await p3.waitForFunction(() => !!window.__sideways, null, { timeout: 60000 }).then(() => true).catch(() => false);
    await c3.close();
    assert(ok, 'the game did not start offline');
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
