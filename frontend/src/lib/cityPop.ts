/**
 * An original, relaxed city-pop style instrumental, synthesized live with the Web Audio API (no samples,
 * no recordings). Warm electric piano on maj7/9 chords with syncopated comping, a round bass line, soft
 * drums and an occasional bell arpeggio, at a slow-cruise tempo.
 * shortcut: synth voices only; swap in a licensed recording if real instruments are wanted.
 */

const BPM = 86;
const STEP = 60 / BPM / 4; // one sixteenth note
const SWING = 0.06; // a touch of lilt on the off-sixteenths

// 8-bar progression in F: voicings as MIDI notes, plus the bass root.
const CHORDS: { notes: number[]; root: number }[] = [
  { notes: [53, 57, 60, 64, 67], root: 41 }, // Fmaj9
  { notes: [52, 55, 59, 62, 66], root: 40 }, // Em9
  { notes: [50, 53, 57, 60, 64], root: 38 }, // Dm9
  { notes: [55, 60, 65, 69, 64], root: 43 }, // G13sus
  { notes: [48, 52, 55, 59, 62], root: 36 }, // Cmaj9
  { notes: [57, 60, 64, 67, 71], root: 45 }, // Am9
  { notes: [50, 53, 57, 60, 64], root: 38 }, // Dm9
  { notes: [46, 50, 56, 60, 67], root: 34 }, // Bb13
];

// 16-step patterns per bar.
const COMP: Record<number, number> = { 0: 1.6, 6: 0.45, 10: 0.45, 14: 0.9 }; // step -> length (s)
const BASS: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 7, 11: 0, 14: 7 }; // step -> semitones over root
const KICK = new Set([0, 8, 11]);
const SNARE = new Set([4, 12]);
const BELL_STEPS = [2, 5, 9, 13];

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class CityPop {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private verb!: ConvolverNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private next = 0;
  private step = 0;

  get playing() {
    return this.ctx !== null;
  }

  async start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 4200; // warm, slightly tape-like top end
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 2); // gentle fade-in
    tone.connect(comp).connect(this.master).connect(ctx.destination);

    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.verb.connect(wet).connect(tone);
    this.tone = tone;

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    await ctx.resume();
    this.step = 0;
    this.next = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = null;
    clearInterval(this.timer);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 700);
  }

  private tone!: BiquadFilterNode;

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.next < ctx.currentTime + 0.15) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16) % CHORDS.length;
      const t = this.next + (s % 2 ? SWING * STEP : 0);
      const chord = CHORDS[bar];

      if (s in COMP) for (const n of chord.notes) this.ep(hz(n), t, COMP[s], s === 0 ? 0.05 : 0.035);
      if (s in BASS) this.bass(hz(chord.root + BASS[s]), t, s === 0 ? 0.5 : 0.28);
      if (KICK.has(s)) this.kick(t);
      if (SNARE.has(s)) this.snare(t);
      if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.05 : 0.025);
      if (bar % 2 === 1 && BELL_STEPS.includes(s)) this.bell(hz(chord.notes[BELL_STEPS.indexOf(s) + 1] + 12), t);

      this.next += STEP;
      this.step++;
    }
  }

  /* ---------- voices ---------- */

  private env(t: number, peak: number, len: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    return g;
  }

  private send(node: AudioNode, amount: number) {
    node.connect(this.tone);
    if (amount > 0) {
      const s = this.ctx!.createGain();
      s.gain.value = amount;
      node.connect(s).connect(this.verb);
    }
  }

  // Electric piano: sine fundamental plus a soft bell partial, gently detuned.
  private ep(f: number, t: number, len: number, vol: number) {
    const ctx = this.ctx!;
    const g = this.env(t, vol, len);
    for (const [mult, gain, det] of [[1, 1, 3], [2, 0.18, -4], [3.01, 0.05, 0]] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * mult;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    this.send(g, 0.6);
  }

  private bass(f: number, t: number, len: number) {
    const ctx = this.ctx!;
    const g = this.env(t, 0.32, len);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    for (const type of ["triangle", "sine"] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = type === "sine" ? f / 2 : f;
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    lp.connect(g);
    this.send(g, 0);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(t, 0.45, 0.28);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.3);
    this.send(g, 0);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, vol: number, len: number, verb: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.env(t, vol, len);
    src.connect(f).connect(g);
    src.start(t);
    src.stop(t + len + 0.02);
    this.send(g, verb);
  }

  private snare(t: number) {
    this.noiseHit(t, "bandpass", 1900, 0.12, 0.18, 0.5); // brushed, soft
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, "highpass", 7500, vol, 0.05, 0);
  }

  private bell(f: number, t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = this.env(t, 0.03, 1.1);
    o.connect(g);
    o.start(t);
    o.stop(t + 1.15);
    this.send(g, 0.9);
  }
}
