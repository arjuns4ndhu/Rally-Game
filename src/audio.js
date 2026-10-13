// All sound is synthesised with the Web Audio API; there are no audio files.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, engine: 0.8, sfx: 0.8 };
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

    // --- Turbo whistle (turbo cars only)
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine'; this.turbo.frequency.value = 1800;
    this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.engineBus);
    this.turbo.start();
    this.boost = 0;
    this.applyTone();
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
    this.musicBus.gain.value = this.musicOn ? 0.5 : 0;
  }

  setVolume(v) {
    this.volumes.master = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, this.ctx.currentTime, 0.02);
  }

  setCar(spec) {
    this.cyl = spec.cyl || 4; this.redline = spec.redline; this.hasTurbo = !!spec.turbo;
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
    if (this.hasTurbo && active && prevBoost > 0.5 && load < 0.2) { this.blowOff(prevBoost); this.boost = 0; }

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
    this.sprayGain.gain.setTargetAtTime(spray * 0.1, t, 0.03);
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
    for (const g of [this.engGain, this.slideGain, this.rollGain]) g?.gain.setTargetAtTime(0, at, 0.05);
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

  // Menu music: a small chiptune loop, scheduled a little ahead of time.
  music(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    const ctx = this.ctx;
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
      if (!this.musicOn && this.musicBus.gain.value < 0.01) { clearInterval(this._seq); this._seq = null; return; }
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

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}

function softClip(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}
