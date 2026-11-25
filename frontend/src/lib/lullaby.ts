/**
 * An original, slow music-box lullaby synthesized live with Web Audio (no samples, no borrowed melody).
 * Three-four time at 60 bpm: a plucked bell voice with a long decay over one soft low note per bar, in a
 * small room reverb. Quiet on purpose; it should sit under a conversation, not over it.
 * shortcut: synth voices only; swap in a licensed recording if a real music box is wanted.
 */

const BEAT = 1; // seconds per beat (60 bpm)
const BARS: { root: number; notes: [number, number][] }[] = [
  // [beat within the bar (0..2.5), midi]
  { root: 48, notes: [[0, 72], [1, 76], [2, 79]] },
  { root: 53, notes: [[0, 77], [1, 76], [2, 74]] },
  { root: 55, notes: [[0, 74], [1.5, 71], [2, 72]] },
  { root: 48, notes: [[0, 76], [2, 72]] },
  { root: 45, notes: [[0, 69], [1, 72], [2, 76]] },
  { root: 53, notes: [[0, 77], [1, 74], [2, 72]] },
  { root: 55, notes: [[0, 71], [1, 74], [2.5, 72]] },
  { root: 48, notes: [[0, 72]] },
];
const BAR = 3 * BEAT;
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
    this.master.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 3); // slow fade-in
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    // small room: a short decaying noise impulse
    const verb = ctx.createConvolver();
    const len = Math.round(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.master.connect(tone);
    tone.connect(ctx.destination);
    tone.connect(verb).connect(wet).connect(ctx.destination);
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
    while (this.next < ctx.currentTime + 0.4) {
      const { root, notes } = BARS[this.bar % BARS.length];
      this.pluck(hz(root), this.next, 0.35, 3.2, false);
      for (const [beat, m] of notes) this.pluck(hz(m), this.next + beat * BEAT, 0.5, 2.2, true);
      this.next += BAR;
      this.bar++;
    }
  }

  /** A struck tine: fast attack, long exponential decay, a faint inharmonic overtone for the bell colour. */
  private pluck(f: number, at: number, level: number, decay: number, bell: boolean) {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    env.connect(this.master);
    for (const [mult, amp] of bell ? [[1, 1], [2.76, 0.18], [5.4, 0.05]] : [[1, 1]]) {
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
