// Engine, tyres and effects are synthesised with the Web Audio API. Music
// is three royalty-free tracks in music/ (Pixabay licence), streamed from
// <audio> elements through the same mixer, so volume and mute apply. They
// play as one playlist that carries on across every screen.
const PLAYLIST = ['music/menu-darkside-rally-house.mp3', 'music/race-clutch-boost.mp3', 'music/race-flying-finish.mp3'];
const MUSIC_VOL = 0.5;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, engine: 0.8, sfx: 0.8, music: 1 };
    this.cyl = 4;
    this.lastThrottle = 0;
    this.time = 0;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    // Streamed music tracks: their own volume, then a limiter so turning the
    // music right up gets louder without crackling.
    this.trackBus = ctx.createGain();
    this.trackBus.gain.value = this.volumes.music;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
    this.trackBus.connect(lim).connect(this.master);
    this.applyVolumes();

    // --- Engine: three oscillators -> soft clip -> lowpass -> gain
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square';
    this.oscC = ctx.createOscillator(); this.oscC.type = 'sawtooth';
    const gA = ctx.createGain(); gA.gain.value = 0.5;
    const gB = ctx.createGain(); gB.gain.value = 0.35;
    const gC = ctx.createGain(); gC.gain.value = 0.18;
    this.oscGains = [gA, gB, gC];
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = softClip(2.2);
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 3;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.oscA.connect(gA).connect(this.shaper);
    this.oscB.connect(gB).connect(this.shaper);
    this.oscC.connect(gC).connect(this.shaper);
    this.shaper.connect(this.engFilter).connect(this.engGain).connect(this.engineBus);
    [this.oscA, this.oscB, this.oscC].forEach((o) => { o.frequency.value = 40; o.start(); });

    // --- Tyres: looped noise through two filters
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true; src.start();
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'bandpass'; this.slideFilter.frequency.value = 900; this.slideFilter.Q.value = 0.8;
    this.slideGain = ctx.createGain(); this.slideGain.gain.value = 0;
    src.connect(this.slideFilter).connect(this.slideGain).connect(this.sfxBus);
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass'; this.rollFilter.frequency.value = 320;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    src.connect(this.rollFilter).connect(this.rollGain).connect(this.sfxBus);

    // --- Gravel spray: stones pinging off the arches (bright, flickering noise)
    const src2 = ctx.createBufferSource();
    src2.buffer = noise; src2.loop = true; src2.start(0, 0.7);
    this.sprayFilter = ctx.createBiquadFilter();
    this.sprayFilter.type = 'bandpass'; this.sprayFilter.frequency.value = 2600; this.sprayFilter.Q.value = 0.9;
    this.sprayGain = ctx.createGain(); this.sprayGain.gain.value = 0;
    src2.connect(this.sprayFilter).connect(this.sprayGain).connect(this.sfxBus);

    // --- Surface layers: a tonal squeal for sliding on tarmac, a soft
    // crunch for snow and ice, and a wet hiss of spray in the rain.
    const src3 = ctx.createBufferSource();
    src3.buffer = noise; src3.loop = true; src3.start(0, 1.3);
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass'; this.squealFilter.frequency.value = 1150; this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain(); this.squealGain.gain.value = 0;
    src3.connect(this.squealFilter).connect(this.squealGain).connect(this.sfxBus);
    this.crunchFilter = ctx.createBiquadFilter();
    this.crunchFilter.type = 'bandpass'; this.crunchFilter.frequency.value = 520; this.crunchFilter.Q.value = 0.7;
    this.crunchGain = ctx.createGain(); this.crunchGain.gain.value = 0;
    src3.connect(this.crunchFilter).connect(this.crunchGain).connect(this.sfxBus);
    this.wetFilter = ctx.createBiquadFilter();
    this.wetFilter.type = 'highpass'; this.wetFilter.frequency.value = 1800;
    this.wetGain = ctx.createGain(); this.wetGain.gain.value = 0;
    src.connect(this.wetFilter).connect(this.wetGain).connect(this.sfxBus);

    // --- Turbo whistle (turbo cars only)
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine'; this.turbo.frequency.value = 1800;
    this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.engineBus);
    this.turbo.start();
    this.boost = 0;

    // --- Crowd: three bands of noise, each wobbling at its own rate, sound
    // like a lot of people shouting at once. Louder as you pass spectators.
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    this.crowdGain.connect(this.sfxBus);
    [[480, 3.1], [1050, 4.7], [2200, 6.3]].forEach(([f, rate], k) => {
      const n = ctx.createBufferSource();
      n.buffer = noise; n.loop = true; n.start(0, 0.3 + k * 0.4);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 1.4;
      const g = ctx.createGain(); g.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
      const depth = ctx.createGain(); depth.gain.value = 0.35;
      lfo.connect(depth).connect(g.gain); lfo.start();
      n.connect(bp).connect(g).connect(this.crowdGain);
    });
    this.crowd = 0;

    // --- Echo off canyon walls: a filtered feedback delay fed by the engine
    // and effects. Off (no send) everywhere else.
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0;
    this.echoDelay = ctx.createDelay(1.0); this.echoDelay.delayTime.value = 0.28;
    const echoLp = ctx.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 1700;
    const echoFb = ctx.createGain(); echoFb.gain.value = 0.34;
    this.engineBus.connect(this.echoSend); this.sfxBus.connect(this.echoSend);
    this.echoSend.connect(this.echoDelay).connect(echoLp).connect(this.master);
    echoLp.connect(echoFb).connect(this.echoDelay);
    this.applyTone();
  }

  // A stream of everything you hear, for recording clips.
  stream() {
    if (!this.ctx) return null;
    if (!this._dest) { this._dest = this.ctx.createMediaStreamDestination(); this.master.connect(this._dest); }
    return this._dest.stream;
  }

  // Surroundings, every frame: crowd (0..1, how many spectators are close
  // and cheering) and echo (0..1, how enclosed the road is; delay in s).
  setEnv({ crowd = 0, echo = 0, delay = 0.28 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowd = crowd;
    this.crowdGain.gain.setTargetAtTime(crowd * 0.32, t, crowd > this.crowdGain.gain.value ? 0.15 : 0.6);
    this.echoSend.gain.setTargetAtTime(echo * 0.5, t, 0.3);
    this.echoDelay.delayTime.setTargetAtTime(delay, t, 0.5);
    // Now and then someone in the crowd whistles.
    if (crowd > 0.3 && Math.random() < crowd * 0.025) this.whistle();
  }

  whistle() {
    const ctx = this.ctx, at = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f = 2300 + Math.random() * 700, two = Math.random() < 0.5;
    o.type = 'sine';
    o.frequency.setValueAtTime(f, at);
    o.frequency.linearRampToValueAtTime(f * 1.25, at + 0.12);
    o.frequency.linearRampToValueAtTime(two ? f * 0.85 : f * 1.1, at + 0.32);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.05, at + 0.03);
    g.gain.setValueAtTime(0.05, at + 0.26);
    g.gain.linearRampToValueAtTime(0, at + 0.34);
    o.connect(g).connect(this.sfxBus);
    o.start(at); o.stop(at + 0.36);
  }

  // Engine character per car: mix of the three oscillators and filter Q.
  applyTone() {
    if (!this.ctx || !this.tone) return;
    this.oscGains.forEach((g, i) => { g.gain.value = this.tone[i]; });
    this.harm = this.tone[3];
    this.engFilter.Q.value = this.tone[4];
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : this.volumes.master;
    this.engineBus.gain.value = this.volumes.engine;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this._chipOn ? 0.5 : 0;
  }

  setVolume(v) {
    this.volumes.master = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // Music level on its own (1 = as mixed; up to 2.5x louder).
  setMusicVolume(v) {
    this.volumes.music = v;
    if (this.ctx) this.trackBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, this.ctx.currentTime, 0.02);
  }

  // The stage's ground and weather, for the tyre sounds.
  setStage(themeId, wet) { this.snowy = themeId === 'snow'; this.wet = !!wet; }

  setCar(spec) {
    this.cyl = spec.cyl || 4; this.redline = spec.redline; this.hasTurbo = !!spec.turbo;
    // 80s turbo cars chatter (compressor surge) when you lift; later ones just hiss.
    this.flutters = spec.bodyStyle === 'quattro' || spec.bodyStyle === 'groupb';
    // [saw, square sub, upper, upper harmonic ratio, filter Q]
    this.tone = {
      stratos: [0.5, 0.3, 0.22, 2.02, 3.5],     // V6 howl
      mini: [0.42, 0.2, 0.12, 2.0, 2.2],        // thin, buzzy four
      quattro: [0.5, 0.38, 0.2, 1.5, 3.0],      // offbeat five warble
      focus: [0.46, 0.32, 0.16, 2.0, 2.6],      // turbo four
      dakar: [0.52, 0.5, 0.1, 2.0, 1.8],        // deep V8 rumble
      groupb: [0.55, 0.36, 0.22, 2.0, 3.8],     // angry Group B four
    }[spec.bodyStyle] || [0.5, 0.35, 0.18, 2.02, 3];
    if (this.ctx) this.oscGains.forEach((g, i) => { g.gain.value = this.tone[i]; });
    this.harm = this.tone[3];
    if (this.ctx) this.engFilter.Q.value = this.tone[4];
  }

  // Called every frame with the physics car and the current surface.
  update(car, surface, dt, active = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.time += dt;
    const tc = 0.03;
    const f0 = (car.rpm / 60) * (this.cyl / 2);
    this.oscA.frequency.setTargetAtTime(f0, t, tc);
    this.oscB.frequency.setTargetAtTime(f0 * 0.5, t, tc);
    this.oscC.frequency.setTargetAtTime(f0 * (this.harm || 2.02), t, tc);

    const load = car.throttle;
    let vol = active ? 0.16 + load * 0.16 + (car.rpm / (this.redline || 7000)) * 0.08 : 0;
    // Limiter bounce
    if (car.rpm >= (this.redline || 7000) - 20 && load > 0.5) vol *= Math.sin(this.time * 70) > 0 ? 1 : 0.55;
    // Gear change dip
    if (car.shiftTimer > 0) vol *= 0.6;
    this.engGain.gain.setTargetAtTime(vol, t, 0.025);
    this.engFilter.frequency.setTargetAtTime(260 + load * 1900 + car.rpm * 0.22, t, 0.04);

    // Turbo: spools with throttle and revs, whistles, and blows off on a lift.
    const rf = car.rpm / (this.redline || 7000);
    const want = this.hasTurbo && active ? load * Math.max(0, rf - 0.25) / 0.75 : 0;
    const prevBoost = this.boost;
    this.boost += (want - this.boost) * Math.min(1, dt * (want > this.boost ? 2.5 : 8));
    this.turbo.frequency.setTargetAtTime(1500 + this.boost * 3200, t, 0.05);
    this.turboGain.gain.setTargetAtTime(this.boost * 0.035, t, 0.05);
    if (this.hasTurbo && active && prevBoost > 0.5 && load < 0.2) {
      if (this.flutters) this.flutter(prevBoost); else this.blowOff(prevBoost);
      this.boost = 0;
    }
    // Gear changes: a pop on a hard upshift, a blip and crackle changing down under braking.
    if (active && car.shifted === 1 && load > 0.7 && rf > 0.55) this.gearPop(this.hasTurbo ? 0.9 : 0.6);
    if (active && car.shifted === -1 && car.brake > 0.3) this.crackle(this.hasTurbo ? 0.55 : 0.35);

    // Lift-off crackle (louder pops on the turbo cars)
    if (active && this.lastThrottle > 0.6 && load < 0.2 && car.rpm > 4200) this.crackle(this.hasTurbo ? 0.8 : 0.5);
    this.lastThrottle = load;

    const sp = Math.min(car.speed / 30, 1);
    const offroad = surface.name === 'grass';
    const inAir = surface.name === 'air';
    const slide = active && !inAir ? Math.min(1, car.rearSlide * 0.9 + car.frontSlide * 0.4) * Math.min(1, car.speed / 6) : 0;
    this.slideGain.gain.setTargetAtTime(slide * 0.55, t, 0.05);
    this.slideFilter.frequency.setTargetAtTime(offroad ? 500 : 750 + sp * 600, t, 0.1);
    this.rollGain.gain.setTargetAtTime(active && !inAir ? sp * (offroad ? 0.5 : 0.22) : 0, t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(offroad ? 180 : 260 + sp * 250, t, 0.1);

    // Gravel spray: loose surfaces only, flickering like stones hitting metal.
    const loose = { gravel: 1, verge: 0.8, mud: 0.6, sand: 1.1, track: 1, grass: 0.35, tarmac: 0.05, ice: 0.1, puddle: 0.3, rubble: 1.2 }[surface.name] ?? 0;
    const spray = active && !inAir ? loose * Math.min(1, car.speed / 25) * (0.5 + car.rearSlide) * (0.55 + Math.random() * 0.45) : 0;
    this.sprayGain.gain.setTargetAtTime(spray * (this.snowy ? 0.03 : 0.1), t, 0.03);

    // Surface character on top of the rolling noise.
    const name = surface.name, ground = active && !inAir;
    const onRoad = name === 'gravel' || name === 'track' || name === 'verge';
    const tarmacSlide = ground && name === 'tarmac' ? slide : 0;
    this.squealGain.gain.setTargetAtTime(tarmacSlide * 0.22, t, 0.04);
    this.squealFilter.frequency.setTargetAtTime(1000 + sp * 400 + car.rearSlide * 300, t, 0.08);
    const snow = ground && ((this.snowy && onRoad) || name === 'ice') ? sp * (0.55 + Math.random() * 0.45) : 0;
    this.crunchGain.gain.setTargetAtTime(snow * 0.32, t, 0.03);
    this.wetGain.gain.setTargetAtTime(ground && this.wet ? sp * 0.12 : 0, t, 0.1);
  }

  // A sharp pop from the exhaust on a full-throttle upshift.
  gearPop(vol = 0.6) {
    const ctx = this.ctx, at = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(at, Math.random() * 1.5, 0.1);
  }

  // Compressor surge: the stuttering "chu-chu-chu" of an 80s turbo on a lift.
  flutter(k = 1) {
    const ctx = this.ctx, at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(2600, at);
    f.frequency.exponentialRampToValueAtTime(1100, at + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    const pulses = 7;
    for (let i = 0; i < pulses; i++) {
      const p = at + i * 0.055, v = 0.16 * k * (1 - i / (pulses + 1));
      g.gain.setValueAtTime(0.0001, p);
      g.gain.exponentialRampToValueAtTime(v, p + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, p + 0.045);
    }
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(at, Math.random(), pulses * 0.055 + 0.1);
  }

  // Turbo blow-off valve: a quick falling hiss.
  blowOff(k = 1) {
    const ctx = this.ctx, at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(3800, at);
    f.frequency.exponentialRampToValueAtTime(900, at + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.18 * k, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(at, Math.random(), 0.45);
  }

  // Driving into a puddle.
  splash(k = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(2400, at); f.frequency.exponentialRampToValueAtTime(500, at + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5 * k + 0.05, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(at, Math.random(), 0.55);
  }

  crackle(vol = 0.5) {
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = ctx.currentTime + 0.05 + i * (0.05 + Math.random() * 0.08);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 300 + Math.random() * 500; f.Q.value = 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start(at, Math.random() * 1.5, 0.08);
    }
  }

  // Short UI / countdown beep.
  beep(freq = 660, dur = 0.12, type = 'square', vol = 0.25) {
    if (!this.ctx) return;
    const ctx = this.ctx, at = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(at); o.stop(at + dur + 0.02);
  }

  // Thump for hitting things / respawn.
  thud(vol = 0.6) {
    if (!this.ctx) return;
    const ctx = this.ctx, at = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(g).connect(this.sfxBus);
    o.start(at); o.stop(at + 0.35);
  }

  // Silence the engine and tyres (back in the menus) without stopping music.
  idle() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    for (const g of [this.engGain, this.slideGain, this.rollGain, this.squealGain, this.crunchGain, this.wetGain, this.sprayGain, this.crowdGain, this.echoSend]) g?.gain.setTargetAtTime(0, at, 0.05);
  }

  // Finish jingle: a rising arpeggio, longer and brighter for a new best.
  fanfare(big = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99, 1046.5];
    const step = big ? 0.11 : 0.12;
    notes.forEach((f, i) => {
      const last = i === notes.length - 1, at = t0 + i * step, dur = last ? 0.7 : step * 0.9;
      for (const [type, mul, vol] of [['square', 1, 0.12], ['triangle', 0.5, 0.18]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g).connect(this.sfxBus);
        o.start(at); o.stop(at + dur + 0.05);
      }
    });
  }

  // ---------- Music ----------
  // One song at a time from the playlist; when it ends the next one starts.
  // Screens never stop it: only the Music switch does (and mute, via the
  // master volume).
  _track(i) {
    this._tracks ||= [];
    let t = this._tracks[i];
    if (!t) {
      const el = new Audio(PLAYLIST[i]);
      el.preload = 'auto';
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      this.ctx.createMediaElementSource(el).connect(gain).connect(this.trackBus);
      t = this._tracks[i] = { el, gain, i };
      el.addEventListener('ended', () => { if (this._now === t) this._next(); });
      // A missing or blocked file is skipped; if none will play, the old
      // chiptune loop stands in.
      el.addEventListener('error', () => { t.failed = true; if (this._now === t) this._next(); });
    }
    return t;
  }
  _next() {
    const n = PLAYLIST.length;
    for (let k = 1; k <= n; k++) {
      const i = (this._idx + k) % n;
      if (!this._track(i).failed) { this._start(i, true); return; }
    }
    this._now = null;
    if (this.musicOn) this._chiptune(true);
  }
  _start(i, fromTop) {
    const t = this._track(i), prev = this._now;
    if (prev && prev !== t) { prev.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); setTimeout(() => prev.el.pause(), 600); }
    this._idx = i; this._now = t;
    if (fromTop) t.el.currentTime = 0;
    this._level(MUSIC_VOL, 0.4);
    t.el.play().catch(() => { /* autoplay refused: stays silent until the next tap */ });
  }
  _level(v, tc) {
    const g = this._now?.gain.gain;
    if (!g) return;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(v, this.ctx.currentTime, tc);
  }
  // Duck the music for a moment (a crash), or hold it lower (sec = 0) until
  // music(true) is called again.
  duck(k = 0.35, sec = 1.2) {
    if (!this._now || !this.ctx) return;
    this._level(MUSIC_VOL * k, 0.05);
    if (sec > 0) this._now.gain.gain.setTargetAtTime(MUSIC_VOL, this.ctx.currentTime + sec, 0.4);
  }

  // Music on or off. Turning it on while it's already playing just brings
  // it back to full level (after a duck); it never restarts the song.
  music(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (!on) {
      this._chiptune(false);
      const t = this._now;
      if (t) { this._level(0, 0.2); clearTimeout(this._stopTimer); this._stopTimer = setTimeout(() => { if (!this.musicOn) t.el.pause(); }, 900); }
      return;
    }
    clearTimeout(this._stopTimer);
    if (this._now) { this._level(MUSIC_VOL, 0.3); if (this._now.el.paused) this._now.el.play().catch(() => {}); return; }
    if (this._idx == null) this._start(0, true); else this._next();
  }

  // A small chiptune loop, scheduled a little ahead of time.
  _chiptune(on) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this._chipOn = on;
    this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, on ? 0.3 : 0.15);
    if (!on || this._seq) return;
    const BPM = 116, S16 = 60 / BPM / 4;
    // Am - F - C - G, one bar each: [bass root, arpeggio notes] in MIDI.
    const BARS = [[45, [69, 72, 76, 72]], [41, [65, 69, 72, 69]], [48, [67, 72, 76, 72]], [43, [67, 71, 74, 71]]];
    const LEAD = [76, null, 79, 76, 74, null, 72, null, 74, null, 76, null, 72, null, 69, null];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const voice = (type, f, at, dur, vol) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(this.musicBus);
      o.start(at); o.stop(at + dur + 0.02);
    };
    const hat = (at, vol) => {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(at, Math.random()); src.stop(at + 0.05);
    };
    const kick = (at) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      o.connect(g).connect(this.musicBus);
      o.start(at); o.stop(at + 0.2);
    };
    let step = 0, next = ctx.currentTime + 0.1;
    this._seq = setInterval(() => {
      if (!this._chipOn && this.musicBus.gain.value < 0.01) { clearInterval(this._seq); this._seq = null; return; }
      while (next < ctx.currentTime + 0.25) {
        const bar = Math.floor(step / 16) % 4, s16 = step % 16, [root, arp] = BARS[bar];
        if (s16 % 4 === 0) voice('square', hz(root - 12 + (s16 === 8 ? 12 : 0)), next, S16 * 3.5, 0.09);
        voice('triangle', hz(arp[s16 % 4] + 12 * (s16 % 8 < 4 ? 0 : 1) - 12), next, S16 * 0.9, 0.06);
        const phrase = Math.floor(step / 64) % 2;
        const ln = phrase ? LEAD[(s16 + bar * 4) % 16] : null;
        if (ln && s16 % 2 === 0) voice('square', hz(ln), next, S16 * 1.8, 0.035);
        if (s16 === 0 || s16 === 8 || (s16 === 10 && bar === 3)) kick(next);
        if (s16 % 2 === 1) hat(next, s16 % 4 === 3 ? 0.06 : 0.03);
        next += S16; step++;
      }
    }, 60);
  }

  // Pause: the car and effects go quiet, the music keeps playing.
  suspend() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    this.engineBus.gain.setTargetAtTime(0, at, 0.03);
    this.sfxBus.gain.setTargetAtTime(0, at, 0.03);
  }
  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const at = this.ctx.currentTime;
    this.engineBus.gain.setTargetAtTime(this.volumes.engine, at, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, at, 0.03);
  }
}

function softClip(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}
