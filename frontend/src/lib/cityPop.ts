/**
 * An original, mellow city-pop style instrumental, synthesized live with the Web Audio API (no samples,
 * no recordings, no borrowed melody). Chorused electric piano on maj7/9 chords, muted "cutting" guitar
 * on the off-beat sixteenths, a round bass, a soft string pad, light drums, and an original lead melody
 * with echo that comes in on every second pass of the 8-bar loop.
 * shortcut: synth voices only; swap in a licensed recording if real instruments are wanted.
 */

const BPM = 84;
const STEP = 60 / BPM / 4; // one sixteenth note
const SWING = 0.06; // a touch of lilt on the off-sixteenths

// 8-bar progression in F (original): voicings as MIDI notes, plus the bass root.
const CHORDS: { notes: number[]; root: number }[] = [
  { notes: [53, 57, 60, 64, 67], root: 41 }, // Fmaj9
  { notes: [52, 55, 59, 62, 66], root: 40 }, // Em9
  { notes: [50, 53, 57, 60, 64], root: 38 }, // Dm9
  { notes: [55, 60, 64, 65, 69], root: 43 }, // G13sus
  { notes: [48, 52, 55, 59, 62], root: 36 }, // Cmaj9
  { notes: [57, 60, 64, 67, 71], root: 45 }, // Am9
  { notes: [50, 53, 57, 60, 64], root: 38 }, // Dm9
  { notes: [46, 50, 56, 60, 67], root: 34 }, // Bb13
];

// Lead melody (original), one entry per bar: [step, midi, seconds].
const MELODY: [number, number, number][][] = [
  [[0, 72, 0.5], [6, 76, 0.4], [10, 74, 0.4], [14, 72, 0.3]],
  [[2, 71, 0.6], [8, 74, 0.4], [12, 67, 0.6]],
  [[0, 69, 0.4], [4, 72, 0.4], [8, 76, 0.5], [12, 74, 0.5]],
  [[2, 72, 1.2], [12, 74, 0.5]],
  [[0, 76, 0.5], [6, 74, 0.4], [10, 71, 0.4], [14, 67, 0.3]],
  [[2, 72, 0.6], [8, 71, 0.4], [12, 69, 0.6]],
  [[0, 69, 0.4], [6, 72, 0.4], [10, 74, 0.4], [14, 77, 0.4]],
  [[4, 74, 0.8], [10, 72, 1.4]],
];

// 16-step patterns per bar.
const COMP: Record<number, number> = { 0: 1.6, 6: 0.45, 10: 0.45, 14: 0.9 }; // step -> length (s)
const BASS: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 7, 11: 0, 14: 7 }; // step -> semitones over root
const GUITAR = new Set([2, 6, 10, 14]); // off-beat "cutting" chops
const GHOST = new Set([7, 15]);
const KICK = new Set([0, 8, 11]);
const SNARE = new Set([4, 12]);
const BELL_STEPS = [2, 5, 9, 13];

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class CityPop {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private tone!: BiquadFilterNode;
  private verb!: ConvolverNode;
  private chorus!: GainNode; // electric piano bus with chorus
  private echo!: GainNode; // lead bus with a dotted-eighth echo
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
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 4800; // warm, slightly tape-like top end
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 2); // gentle fade-in
    this.tone.connect(comp).connect(this.master).connect(ctx.destination);

    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.verb.connect(wet).connect(this.tone);

    // Chorus: the dry piano plus a copy through a short, slowly wobbling delay.
    this.chorus = ctx.createGain();
    this.chorus.connect(this.tone);
    const cDelay = ctx.createDelay(0.05);
    cDelay.delayTime.value = 0.014;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.6;
    const depth = ctx.createGain();
    depth.gain.value = 0.004;
    lfo.connect(depth).connect(cDelay.delayTime);
    lfo.start();
    const cWet = ctx.createGain();
    cWet.gain.value = 0.7;
    this.chorus.connect(cDelay).connect(cWet).connect(this.tone);

    // Echo for the lead: dotted eighth with soft feedback.
    this.echo = ctx.createGain();
    this.echo.connect(this.tone);
    const eDelay = ctx.createDelay(1);
    eDelay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const eLp = ctx.createBiquadFilter();
    eLp.frequency.value = 2400;
    this.echo.connect(eDelay).connect(eLp).connect(fb).connect(eDelay);
    eLp.connect(this.tone);

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
      const barCount = Math.floor(this.step / 16);
      const bar = barCount % CHORDS.length;
      const pass = Math.floor(barCount / CHORDS.length);
      const t = this.next + (s % 2 ? SWING * STEP : 0);
      const chord = CHORDS[bar];

      if (s === 0) this.pad(chord.notes, t, STEP * 16);
      if (s in COMP) for (const n of chord.notes) this.ep(hz(n), t, COMP[s], s === 0 ? 0.045 : 0.03);
      if (s in BASS) this.bass(hz(chord.root + BASS[s]), t, s === 0 ? 0.5 : 0.28);
      if (GUITAR.has(s) || GHOST.has(s)) this.guitar([chord.notes[1] + 12, chord.notes[3] + 12, chord.notes[4] + 12], t, GHOST.has(s) ? 0.012 : 0.022);
      if (KICK.has(s)) this.kick(t);
      if (SNARE.has(s)) this.snare(t);
      if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.045 : 0.022);
      if (pass % 2 === 1) {
        for (const [ms, m, len] of MELODY[bar]) if (ms === s) this.lead(hz(m), t, len);
      } else if (bar % 2 === 1 && BELL_STEPS.includes(s)) {
        this.bell(hz(chord.notes[BELL_STEPS.indexOf(s) + 1] + 12), t);
      }

      this.next += STEP;
      this.step++;
    }
  }

  /* ---------- voices ---------- */

  private env(t: number, peak: number, len: number, attack = 0.012) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    return g;
  }

  private out(node: AudioNode, bus: AudioNode, verb: number) {
    node.connect(bus);
    if (verb > 0) {
      const s = this.ctx!.createGain();
      s.gain.value = verb;
      node.connect(s).connect(this.verb);
    }
  }

  private osc(type: OscillatorType, f: number, t: number, len: number, into: AudioNode, detune = 0) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(into);
    o.start(t);
    o.stop(t + len + 0.05);
    return o;
  }

  // Electric piano: sine fundamental plus soft bell partials, with a slow tape-like drift.
  private ep(f: number, t: number, len: number, vol: number) {
    const ctx = this.ctx!;
    const g = this.env(t, vol, len);
    const drift = Math.sin(t * 0.7) * 4;
    for (const [mult, gain] of [[1, 1], [2, 0.16], [3.01, 0.05]] as const) {
      const og = ctx.createGain();
      og.gain.value = gain;
      og.connect(g);
      this.osc("sine", f * mult, t, len, og, drift);
    }
    this.out(g, this.chorus, 0.55);
  }

  // Soft string pad: detuned saws, slow swell, dark filter.
  private pad(notes: number[], t: number, len: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.9);
    g.gain.setValueAtTime(0.012, t + len - 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.3);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 1100;
    lp.connect(g);
    for (const n of notes.slice(1)) for (const det of [-7, 7]) this.osc("sawtooth", hz(n), t, len + 0.3, lp, det);
    this.out(g, this.tone, 0.8);
  }

  // Muted "chicken-pick" guitar: very short plucks, band-passed.
  private guitar(notes: number[], t: number, vol: number) {
    const ctx = this.ctx!;
    const g = this.env(t, vol, 0.07, 0.003);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700;
    bp.Q.value = 1.2;
    bp.connect(g);
    for (const n of notes) this.osc("square", hz(n), t, 0.08, bp);
    this.out(g, this.tone, 0.15);
  }

  private bass(f: number, t: number, len: number) {
    const ctx = this.ctx!;
    const g = this.env(t, 0.3, len);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 520;
    lp.connect(g);
    this.osc("triangle", f, t, len, lp);
    this.osc("sine", f / 2, t, len, lp);
    this.out(g, this.tone, 0);
  }

  // Lead: a soft triangle "flute-synth" with gentle vibrato, sent to the echo.
  private lead(f: number, t: number, len: number) {
    const ctx = this.ctx!;
    const g = this.env(t, 0.05, len + 0.25, 0.04);
    const o = this.osc("triangle", f, t, len + 0.3, g);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vd = ctx.createGain();
    vd.gain.value = 9; // cents
    vib.connect(vd).connect(o.detune);
    vib.start(t + 0.12);
    vib.stop(t + len + 0.3);
    this.out(g, this.echo, 0.6);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(t, 0.42, 0.28);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.3);
    this.out(g, this.tone, 0);
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
    this.out(g, this.tone, verb);
  }

  private snare(t: number) {
    this.noiseHit(t, "bandpass", 1900, 0.11, 0.18, 0.5); // brushed, soft
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, "highpass", 7500, vol, 0.05, 0);
  }

  private bell(f: number, t: number) {
    const g = this.env(t, 0.026, 1.1);
    this.osc("sine", f, t, 1.15, g);
    this.out(g, this.tone, 0.9);
  }
}
