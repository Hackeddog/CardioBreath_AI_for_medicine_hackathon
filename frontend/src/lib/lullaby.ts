/**
 * An original, slow felt-piano piece synthesized live with Web Audio (no samples, no borrowed melody or
 * progression): gentle broken chords in the left hand, a sparse melody on top, a soft room reverb.
 * Quiet on purpose; it should sit under a conversation, not over it.
 * shortcut: synth voices only; swap in a licensed recording if a real piano is wanted.
 */

const EIGHTH = 0.4; // seconds (75 bpm)
const BAR = EIGHTH * 8;
// Original 8-bar progression in G: bass root plus four chord tones for the broken-chord pattern.
const CHORDS: { root: number; arp: number[] }[] = [
  { root: 43, arp: [50, 55, 59, 62] }, // Gmaj7
  { root: 40, arp: [47, 54, 55, 59] }, // Em9
  { root: 36, arp: [43, 47, 50, 52] }, // Cmaj9
  { root: 38, arp: [45, 50, 52, 57] }, // Dsus2
  { root: 35, arp: [42, 47, 50, 54] }, // Bm7
  { root: 36, arp: [43, 47, 52, 55] }, // Cmaj7
  { root: 33, arp: [45, 48, 52, 55] }, // Am7
  { root: 38, arp: [45, 50, 54, 57] }, // D
];
const PATTERN = [0, 1, 2, 1, 3, 1, 2, 1]; // which chord tone on each eighth
// Original melody, per bar: [eighth, midi, seconds held]. Sparse on purpose; some bars rest.
const MELODY: [number, number, number][][] = [
  [[0, 71, 2.4], [5, 74, 1.6]],
  [[2, 71, 1.2], [4, 69, 2.4]],
  [[0, 67, 2.4], [6, 69, 1]],
  [[0, 66, 3.2]],
  [[0, 66, 1.2], [2, 69, 1.2], [4, 74, 2.4]],
  [[0, 72, 2.4], [5, 71, 1.6]],
  [[0, 69, 1.6], [4, 67, 1.2], [6, 69, 1]],
  [],
];
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class Lullaby {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private timer = 0;
  private next = 0;
  private bar = 0;

  get playing() {
    return this.ctx !== null;
  }

  async start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3); // slow fade-in
    const felt = ctx.createBiquadFilter(); // dull the hammers: a felt-piano softness
    felt.type = "lowpass";
    felt.frequency.value = 1900;
    // room: a decaying noise impulse
    const verb = ctx.createConvolver();
    const len = Math.round(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.master.connect(felt);
    felt.connect(ctx.destination);
    felt.connect(verb).connect(wet).connect(ctx.destination);
    await ctx.resume();
    this.next = ctx.currentTime + 0.2;
    this.bar = 0;
    this.timer = window.setInterval(() => this.schedule(), 100);
    this.schedule();
  }

  stop() {
    const ctx = this.ctx;
    if (!ctx) return;
    clearInterval(this.timer);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    this.ctx = null;
    setTimeout(() => ctx.close(), 700);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.next < ctx.currentTime + 0.5) {
      const i = this.bar % CHORDS.length;
      const { root, arp } = CHORDS[i];
      this.note(hz(root), this.next, 0.32, BAR * 1.2);
      PATTERN.forEach((k, e) => this.note(hz(arp[k]), this.next + e * EIGHTH, 0.15, 1.8));
      for (const [e, m, hold] of MELODY[i]) this.note(hz(m), this.next + e * EIGHTH, 0.34, hold + 1.2);
      this.next += BAR;
      this.bar++;
    }
  }

  /** A soft piano note: quick but not clicky attack, a few decaying harmonics, long tail. */
  private note(f: number, at: number, level: number, decay: number) {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    env.connect(this.master);
    for (const [mult, amp] of [[1, 1], [2, 0.35], [3, 0.12], [4, 0.05]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f * mult;
      g.gain.value = amp;
      o.connect(g).connect(env);
      o.start(at);
      o.stop(at + decay + 0.05);
    }
  }
}
