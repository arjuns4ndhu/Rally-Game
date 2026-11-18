// The co-driver's voice. If recorded clips exist (voice/manifest.json maps
// each spoken phrase, like "left 3", "long", "100", "into", to a sound
// file), calls are stitched together from them. Otherwise the browser's
// own speech synthesis reads the notes out. See
// .claude/skills/codriver-voice for how to make a recorded voice.
export class CoDriverVoice {
  constructor(audio) {
    this.audio = audio;          // AudioEngine: clips play through its master volume
    this.clips = null;           // phrase -> AudioBuffer, once loaded
    this.loading = null;
    this.voice = null;
    this.playing = [];
    this.muted = false;
    this.volume = 1;
  }

  // Load recorded clips if the game ships them (quietly does nothing if not).
  async loadClips(base = 'voice/') {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const res = await fetch(base + 'manifest.json', { cache: 'force-cache' });
        if (!res.ok) return;
        const man = await res.json();
        const ctx = this.audio.ctx;
        if (!ctx || !man || typeof man.phrases !== 'object') return;
        const out = new Map();
        await Promise.all(Object.entries(man.phrases).map(async ([phrase, file]) => {
          if (typeof file !== 'string' || !/^[\w./-]+$/.test(file)) return;
          const buf = await (await fetch(base + file)).arrayBuffer();
          out.set(phrase.toLowerCase(), await ctx.decodeAudioData(buf));
        }));
        if (out.size) this.clips = out;
      } catch { /* no recorded voice: speech synthesis it is */ }
    })();
    return this.loading;
  }

  _pickVoice() {
    if (this.voice || !window.speechSynthesis) return this.voice;
    const vs = speechSynthesis.getVoices();
    this.voice = vs.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) || vs.find((v) => /en-GB/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
    return this.voice;
  }

  stop() {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    for (const s of this.playing) { try { s.stop(); } catch { /* ignore */ } }
    this.playing = [];
  }

  // text: one call, phrases separated by commas ("left 3, long, 100").
  speak(text) {
    if (this.muted || !text) return;
    this.stop();
    const parts = text.toLowerCase().replace(/!/g, '').split(',').map((p) => p.trim()).filter(Boolean);
    const ctx = this.audio.ctx;
    if (this.clips && ctx && parts.every((p) => this.clips.has(p))) {
      // Recorded: queue the clips back to back, a short breath between.
      let t = ctx.currentTime + 0.02;
      for (const p of parts) {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = this.clips.get(p); g.gain.value = 1.4 * this.volume;
        src.connect(g).connect(this.audio.sfxBus);
        src.start(t);
        this.playing.push(src);
        t += src.buffer.duration + 0.04;
      }
      return;
    }
    if (!window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(parts.join(', '));
      const v = this._pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang || 'en-GB';
      u.rate = 1.3; u.pitch = 0.95; u.volume = Math.max(0, Math.min(1, this.volume));
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
}
