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
    this.engineBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.applyVolumes();

    // --- Engine: three oscillators -> soft clip -> lowpass -> gain
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square';
    this.oscC = ctx.createOscillator(); this.oscC.type = 'sawtooth';
    const gA = ctx.createGain(); gA.gain.value = 0.5;
    const gB = ctx.createGain(); gB.gain.value = 0.35;
    const gC = ctx.createGain(); gC.gain.value = 0.18;
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
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : this.volumes.master;
    this.engineBus.gain.value = this.volumes.engine;
    this.sfxBus.gain.value = this.volumes.sfx;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, this.ctx.currentTime, 0.02);
  }

  setCar(spec) { this.cyl = spec.cyl || 4; this.redline = spec.redline; }

  // Called every frame with the physics car and the current surface.
  update(car, surface, dt, active = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.time += dt;
    const tc = 0.03;
    const f0 = (car.rpm / 60) * (this.cyl / 2);
    this.oscA.frequency.setTargetAtTime(f0, t, tc);
    this.oscB.frequency.setTargetAtTime(f0 * 0.5, t, tc);
    this.oscC.frequency.setTargetAtTime(f0 * 2.02, t, tc);

    const load = car.throttle;
    let vol = active ? 0.16 + load * 0.16 + (car.rpm / (this.redline || 7000)) * 0.08 : 0;
    // Limiter bounce
    if (car.rpm >= (this.redline || 7000) - 20 && load > 0.5) vol *= Math.sin(this.time * 70) > 0 ? 1 : 0.55;
    // Gear change dip
    if (car.shiftTimer > 0) vol *= 0.6;
    this.engGain.gain.setTargetAtTime(vol, t, 0.025);
    this.engFilter.frequency.setTargetAtTime(260 + load * 1900 + car.rpm * 0.22, t, 0.04);

    // Lift-off crackle
    if (active && this.lastThrottle > 0.6 && load < 0.2 && car.rpm > 4200) this.crackle();
    this.lastThrottle = load;

    const sp = Math.min(car.speed / 30, 1);
    const offroad = surface.name === 'grass';
    const inAir = surface.name === 'air';
    const slide = active && !inAir ? Math.min(1, car.rearSlide * 0.9 + car.frontSlide * 0.4) * Math.min(1, car.speed / 6) : 0;
    this.slideGain.gain.setTargetAtTime(slide * 0.55, t, 0.05);
    this.slideFilter.frequency.setTargetAtTime(offroad ? 500 : 750 + sp * 600, t, 0.1);
    this.rollGain.gain.setTargetAtTime(active && !inAir ? sp * (offroad ? 0.5 : 0.22) : 0, t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(offroad ? 180 : 260 + sp * 250, t, 0.1);
  }

  crackle() {
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
      g.gain.exponentialRampToValueAtTime(0.5, at + 0.005);
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
