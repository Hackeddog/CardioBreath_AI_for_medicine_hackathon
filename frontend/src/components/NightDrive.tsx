"use client";

import React, { useEffect, useRef } from "react";

/**
 * Background world in a "hi-bit" pixel-art style: every layer is painted at a low internal resolution
 * (about 250 px tall, with ordered dithering) and scaled up crisp, then scrolled smoothly at full screen
 * resolution so motion glides instead of stepping. Glows, fog, light shafts and reflections are baked
 * into canvases once per resize, so a frame is only a handful of drawImage calls.
 * Decorative only: aria-hidden, no pointer events; paused by the header control or reduced motion.
 */

const NEON = { pink: "#ff3e9a", red: "#ff4060", cyan: "#3ef0ff", yellow: "#ffd84d", violet: "#b07cff", mint: "#5cf2b0" };
const NEON_LIST = Object.values(NEON);
const SKY = ["#070a1f", "#0a1434", "#0e2548", "#124663", "#1a6f80"]; // top -> horizon haze
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const SIGNS = ["SLEEP LAB", "OPEN 24H", "MOTEL", "NOODLES", "CLINIC", "BREATHE", "眠", "夜", "心", "息"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

function cnv(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
function hex(c: string) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

/** Upscale a low-res canvas by an integer factor with hard pixel edges. */
function crisp(src: HTMLCanvasElement, s: number) {
  const out = cnv(src.width * s, src.height * s);
  const g = out.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** Add a soft bloom of `neon` underneath its crisp copy (baked once). */
function bloom(target: HTMLCanvasElement, neon: HTMLCanvasElement, radius: number) {
  const g = target.getContext("2d")!;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.filter = `blur(${radius}px)`;
  g.drawImage(neon, 0, 0);
  g.filter = `blur(${radius * 3}px)`;
  g.globalAlpha = 0.6;
  g.drawImage(neon, 0, 0);
  g.restore();
  g.drawImage(neon, 0, 0);
}

/* ---------- layers (painted at low res `lw x lh`, scale `P`) ---------- */

function paintSky(lw: number, lh: number, horizon: number) {
  const c = cnv(lw, lh);
  const g = c.getContext("2d")!;
  const img = g.createImageData(lw, lh);
  const cols = SKY.map(hex);
  for (let y = 0; y < lh; y++) {
    const t = Math.min(1, y / horizon) * (cols.length - 1);
    const b = Math.min(cols.length - 2, Math.floor(t));
    const f = t - b;
    for (let x = 0; x < lw; x++) {
      const col = f > BAYER[(y % 4) * 4 + (x % 4)] ? cols[b + 1] : cols[b];
      const i = (y * lw + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const r = rng(3);
  for (let i = 0; i < lw * 0.25; i++) {
    g.fillStyle = r() > 0.85 ? "#9ff6ff" : "#dfe7ff";
    g.globalAlpha = 0.3 + r() * 0.6;
    g.fillRect(Math.floor(r() * lw), Math.floor(r() * horizon * 0.55), 1, 1);
  }
  g.globalAlpha = 1;
  return c;
}

function paintMoon(rad: number) {
  const d = rad * 2 + 1;
  const c = cnv(d, d);
  const g = c.getContext("2d")!;
  for (let y = 0; y < d; y++)
    for (let x = 0; x < d; x++) {
      const dx = x - rad, dy = y - rad;
      const q = (dx * dx + dy * dy) / (rad * rad);
      if (q > 1) continue;
      const shade = dx * 0.5 + dy * 0.7 > rad * 0.35;
      const crater = Math.abs(Math.sin(x * 1.7) * Math.cos(y * 1.3)) > 0.93;
      g.fillStyle = crater ? "#c9e9ee" : shade ? "#d6f2f3" : q > 0.85 ? "#eafcff" : "#f6ffff";
      g.fillRect(x, y, 1, 1);
    }
  return c;
}

/** Far megastructures: pale, fogged by distance. Returns low-res art plus neon overlay. */
function paintFar(lw: number, h: number, P: number) {
  const art = cnv(lw, h);
  const g = art.getContext("2d")!;
  const neon = cnv(lw * P, h * P);
  const n = neon.getContext("2d")!;
  const r = rng(11);
  for (let x = 0; x < lw; ) {
    const w = 8 + Math.floor(r() * 22);
    let bh = Math.floor(h * (0.35 + r() * 0.62));
    let bx = x;
    let bw = w;
    // stepped setbacks toward the top
    for (let tier = 0; tier < 3 && bh > 6; tier++) {
      g.fillStyle = tier === 0 ? "#163a55" : "#1a4560";
      g.fillRect(bx, h - bh, bw, bh);
      if (r() > 0.6) {
        g.fillStyle = "#2b6f86";
        g.fillRect(bx + (r() > 0.5 ? 0 : bw - 1), h - bh, 1, bh); // lit edge
      }
      const nbw = Math.max(3, Math.floor(bw * (0.5 + r() * 0.3)));
      bx += Math.floor((bw - nbw) / 2);
      bw = nbw;
      bh = Math.floor(bh * (1.08 + r() * 0.12));
      if (bh > h) break;
    }
    g.fillStyle = "#3a8ea6";
    for (let wy = 0; wy < h; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (r() < 0.05) g.fillRect(wx, h - 1 - wy, 1, 1);
    if (r() > 0.55) {
      const col = pick(r, [NEON.cyan, NEON.pink, NEON.violet]);
      n.globalAlpha = 0.55;
      n.fillStyle = col;
      n.fillRect((x + Math.floor(w / 2)) * P, (h - Math.floor(h * 0.3)) * P, Math.max(1, P / 2), h * 0.25 * P);
    }
    if (w > 18 && r() > 0.5) {
      // holo billboard
      const bw2 = w - 6;
      const bh2 = Math.floor(bw2 * 0.6);
      const by = h - Math.floor(h * (0.4 + r() * 0.2));
      const col = pick(r, [NEON.pink, NEON.cyan, NEON.violet]);
      n.globalAlpha = 0.35;
      n.fillStyle = col;
      n.fillRect((x + 3) * P, by * P, bw2 * P, bh2 * P);
      n.globalAlpha = 0.5;
      n.fillStyle = "#ffffff";
      for (let s = 0; s < bh2 * P; s += P) n.fillRect((x + 3) * P, by * P + s, bw2 * P, 1);
    }
    if (r() > 0.6) n.fillStyle = "#ff4060", (n.globalAlpha = 1), n.fillRect((x + Math.floor(w / 2)) * P, (h - Math.floor(h * 0.98)) * P, P, P);
    x += w + Math.floor(r() * 3);
  }
  n.globalAlpha = 1;
  return { art, neon };
}

/** Mid city: detailed blocks, lit windows, rooftop clutter, neon signs. Signs drawn at full res. */
function paintMid(lw: number, h: number, P: number, font: string) {
  const art = cnv(lw, h);
  const g = art.getContext("2d")!;
  const neon = cnv(lw * P, h * P);
  const n = neon.getContext("2d")!;
  const r = rng(29);
  const signs: { x: number; y: number; w: number; h: number }[] = [];
  for (let x = 0; x < lw; ) {
    const w = 12 + Math.floor(r() * 26);
    const bh = Math.floor(h * (0.28 + r() * 0.62));
    const y = h - bh;
    g.fillStyle = "#0e1840";
    g.fillRect(x, y, w, bh);
    g.fillStyle = "#14215a";
    g.fillRect(x, y, w, 1); // roof highlight
    g.fillStyle = "#0a1232";
    g.fillRect(x + w - 2, y, 2, bh); // side shadow
    if (r() > 0.5) {
      g.fillStyle = "#0e1840";
      g.fillRect(x + 2, y - 3, 4, 3); // rooftop unit
      g.fillRect(x + w - 6, y - 5, 2, 5);
    }
    for (let wy = y + 3; wy < h - 2; wy += 3)
      for (let wx = x + 2; wx < x + w - 3; wx += 2)
        if (r() < 0.22) {
          g.fillStyle = r() < 0.72 ? "#ffcf8a" : pick(r, ["#5ff2ff", "#ff4fa3", "#b07cff"]);
          g.globalAlpha = 0.45 + r() * 0.5;
          g.fillRect(wx, wy, 1, 1);
        }
    g.globalAlpha = 1;
    if (bh > h * 0.35 && r() > 0.38) {
      const label = pick(r, SIGNS);
      const vertical = label.length === 1;
      const col = pick(r, [NEON.pink, NEON.cyan, NEON.red, NEON.yellow, NEON.violet]);
      const fs = P * (vertical ? 9 : 6);
      n.font = `${fs}px ${font}`;
      const tw = vertical ? fs * 1.2 : n.measureText(label).width + P * 4;
      const th = vertical ? fs * 1.5 : fs + P * 3;
      const sx = Math.round((x + w / 2) * P - tw / 2);
      const sy = Math.round((y + 4 + r() * Math.max(4, bh * 0.3)) * P);
      n.fillStyle = "rgba(6,4,20,0.9)";
      n.fillRect(sx, sy, tw, th);
      n.strokeStyle = col;
      n.lineWidth = P;
      n.strokeRect(sx + P / 2, sy + P / 2, tw - P, th - P);
      n.fillStyle = col;
      n.textAlign = "center";
      n.textBaseline = "middle";
      n.fillText(label, sx + tw / 2, sy + th / 2 + P / 2);
      signs.push({ x: sx, y: sy, w: tw, h: th });
    }
    x += w + 1 + Math.floor(r() * 3);
  }
  return { art, neon, signs };
}

/** Street side: lamp posts with warm light pools and a neon guardrail. */
function paintNear(lw: number, h: number, P: number) {
  const art = cnv(lw, h);
  const g = art.getContext("2d")!;
  const neon = cnv(lw * P, h * P);
  const n = neon.getContext("2d")!;
  const r = rng(47);
  g.fillStyle = "#070a1c";
  g.fillRect(0, h - 4, lw, 4);
  n.fillStyle = NEON.cyan;
  n.globalAlpha = 0.85;
  n.fillRect(0, (h - 4) * P, lw * P, Math.max(1, P / 2));
  n.globalAlpha = 1;
  for (let x = 10; x < lw; x += 60 + Math.floor(r() * 16)) {
    g.fillStyle = "#0b1030";
    g.fillRect(x, Math.floor(h * 0.12), 2, h);
    g.fillRect(x - 4, Math.floor(h * 0.12), 8, 1);
    n.fillStyle = "#ffe2b0";
    n.fillRect((x - 4) * P, Math.floor(h * 0.12 + 1) * P, 8 * P, P);
    const pool = n.createLinearGradient(0, h * 0.14 * P, 0, h * P);
    pool.addColorStop(0, "rgba(255,214,150,0.22)");
    pool.addColorStop(1, "rgba(255,214,150,0)");
    n.fillStyle = pool;
    n.beginPath();
    n.moveTo((x - 3) * P, h * 0.14 * P);
    n.lineTo((x + 5) * P, h * 0.14 * P);
    n.lineTo((x + 24) * P, h * P);
    n.lineTo((x - 22) * P, h * P);
    n.closePath();
    n.fill();
  }
  return { art, neon };
}

/* 30 x 10 car, facing right. k outline, g glass, b body, l body highlight, d lower body, t tail, h head, w wheel, c hub. */
const CAR = [
  "..........kkkkkkkkk...........",
  "........kkgggggg.ggkk.........",
  ".......kgggggggg.gggk.........",
  "..kkkkklllllllllllllllllkk....",
  ".kbbbbbbbbbbbbbbbbbbbbbbbbbk..",
  "tbbbbbbbbbbbbbbbbbbbbbbbbbbbhh",
  "kbbdddddbbbbbbbbbbbbbbdddddbbk",
  ".kddwwwddddddddddddddddwwwddk.",
  "...wwcww..............wwcww...",
  "....www................www....",
];

function paintCar(body: string, P: number) {
  const light = `rgb(${hex(body).map((v) => Math.min(255, v + 70)).join(",")})`;
  const map: Record<string, string> = { k: "#05030f", g: "#7fe9ff", b: body, l: light, d: "#120b2e", t: "#ff3b5c", h: "#fff4c8", w: "#04020c", c: "#6b62c9" };
  const lo = cnv(30, 10);
  const g = lo.getContext("2d")!;
  CAR.forEach((row, y) => [...row].forEach((ch, x) => map[ch] && ((g.fillStyle = map[ch]), (g.globalAlpha = ch === "g" ? 0.6 : 1), g.fillRect(x, y, 1, 1))));
  const sprite = crisp(lo, P);
  // baked glow: headlight cone, tail glow, underglow
  const glow = cnv(sprite.width + 70 * P, sprite.height + 6 * P);
  const n = glow.getContext("2d")!;
  const ox = 10 * P;
  const beam = n.createLinearGradient(ox + 30 * P, 0, ox + 80 * P, 0);
  beam.addColorStop(0, "rgba(255,240,200,0.5)");
  beam.addColorStop(1, "rgba(255,240,200,0)");
  n.fillStyle = beam;
  n.beginPath();
  n.moveTo(ox + 29 * P, 5 * P);
  n.lineTo(ox + 80 * P, 1 * P);
  n.lineTo(ox + 80 * P, 11 * P);
  n.closePath();
  n.fill();
  n.fillStyle = body;
  n.globalAlpha = 0.8;
  n.fillRect(ox + 4 * P, 9.5 * P, 22 * P, P);
  n.globalAlpha = 1;
  n.fillStyle = "#ff3b5c";
  n.fillRect(ox, 5 * P, P * 2, P);
  const baked = cnv(glow.width, glow.height);
  bloom(baked, glow, P * 1.5);
  return { sprite, glow: baked, ox };
}

function paintFlyer(col: string, P: number) {
  const lo = cnv(14, 5);
  const g = lo.getContext("2d")!;
  g.fillStyle = "#121a45";
  g.fillRect(2, 1, 10, 3);
  g.fillRect(4, 0, 6, 1);
  g.fillStyle = col;
  g.fillRect(2, 4, 10, 1);
  g.fillStyle = "#fff4c8";
  g.fillRect(12, 2, 2, 1);
  g.fillStyle = "#ff3b5c";
  g.fillRect(0, 2, 2, 1);
  const sprite = crisp(lo, P);
  const baked = cnv(sprite.width, sprite.height);
  bloom(baked, sprite, P);
  return baked;
}

function paintFog(w: number, h: number, seed: number, col: string) {
  const c = cnv(w, h);
  const g = c.getContext("2d")!;
  const r = rng(seed);
  const [cr, cg, cb] = hex(col);
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = h * (0.3 + r() * 0.6), rad = h * (0.25 + r() * 0.4);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${cr},${cg},${cb},0.10)`);
    grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    if (x + rad > w) (g.fillStyle = grd), g.save(), g.translate(-w, 0), g.fillRect(x - rad, y - rad, rad * 2, rad * 2), g.restore();
  }
  return c;
}

function paintRays(W: number, H: number, mx: number, my: number) {
  const c = cnv(W, H);
  const g = c.getContext("2d")!;
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.62 + i * 0.07);
    const len = H * 1.4;
    const ex = mx + Math.cos(a) * len, ey = my + Math.sin(a) * len;
    const grd = g.createLinearGradient(mx, my, ex, ey);
    grd.addColorStop(0, "rgba(170,245,255,0.10)");
    grd.addColorStop(1, "rgba(170,245,255,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(mx + Math.cos(a - 0.035) * len, my + Math.sin(a - 0.035) * len);
    g.lineTo(mx + Math.cos(a + 0.035) * len, my + Math.sin(a + 0.035) * len);
    g.closePath();
    g.fill();
  }
  return c;
}

/* ---------- component ---------- */

export default function NightDrive({ page, paused, dim }: { page: number; paused: boolean; dim: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef(page);
  const pausedRef = useRef(paused);
  const kick = useRef<() => void>(() => {});
  pageRef.current = page;

  useEffect(() => {
    pausedRef.current = paused;
    kick.current();
  }, [paused]);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d", { alpha: false })!; // opaque: the sky covers every pixel, and it composites faster
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let font = "monospace";
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let cam = 0;
    let pageCam = 0;

    // scene state, rebuilt on resize
    let W = 0, H = 0, P = 3, horizon = 0, roadH = 0;
    let sky: HTMLCanvasElement, moon: HTMLCanvasElement;
    let far: HTMLCanvasElement, mid: HTMLCanvasElement, midRefl: HTMLCanvasElement, near: HTMLCanvasElement, road: HTMLCanvasElement;
    let fogA: HTMLCanvasElement, fogB: HTMLCanvasElement;
    let signs: { x: number; y: number; w: number; h: number }[] = [];
    let moonX = 0, moonY = 0;
    let cars: { s: ReturnType<typeof paintCar>; lane: 0 | 1; x: number; v: number }[] = [];
    let flyers: { s: HTMLCanvasElement; x: number; y: number; v: number; ph: number }[] = [];
    let motes: { x: number; y: number; v: number; ph: number }[] = [];
    let drops: { x: number; y: number; v: number }[] = [];

    const build = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(rect.width * dpr);
      H = Math.round(rect.height * dpr);
      cv.width = W;
      cv.height = H;
      P = Math.max(2, Math.round(H / 250)); // one art pixel, in device pixels
      const lw = Math.ceil(W / P);
      const lh = Math.ceil(H / P);
      roadH = Math.round(lh * 0.2) * P;
      horizon = H - roadH;
      const lhz = Math.round(horizon / P);
      const tileLW = Math.max(lw + 40, 520);
      const r = rng(5);

      sky = crisp(paintSky(lw, lh, lhz), P);
      const moonR = Math.max(9, Math.round(lh * 0.075));
      moon = crisp(paintMoon(moonR), P);
      moonX = Math.round(W * 0.78);
      moonY = Math.round(H * 0.16);
      const halo = cnv(moon.width * 4, moon.height * 4);
      const hg = halo.getContext("2d")!;
      const hgrad = hg.createRadialGradient(halo.width / 2, halo.height / 2, moon.width * 0.4, halo.width / 2, halo.height / 2, halo.width / 2);
      hgrad.addColorStop(0, "rgba(160,240,255,0.35)");
      hgrad.addColorStop(1, "rgba(160,240,255,0)");
      hg.fillStyle = hgrad;
      hg.fillRect(0, 0, halo.width, halo.height);
      const skyG = sky.getContext("2d")!;
      skyG.globalCompositeOperation = "lighter";
      skyG.drawImage(halo, moonX - halo.width / 2, moonY - halo.height / 2);
      skyG.globalCompositeOperation = "source-over";
      skyG.drawImage(moon, moonX - moon.width / 2, moonY - moon.height / 2);
      skyG.globalCompositeOperation = "lighter";
      skyG.drawImage(paintRays(W, H, moonX, moonY), 0, 0); // light shafts baked in: one less full-screen pass per frame
      skyG.globalCompositeOperation = "source-over";

      const farH = Math.round(lhz * 0.78);
      const f = paintFar(tileLW, farH, P);
      far = crisp(f.art, P);
      // distance haze over the far layer
      const fg = far.getContext("2d")!;
      const haze = fg.createLinearGradient(0, 0, 0, far.height);
      haze.addColorStop(0, "rgba(26,111,128,0)");
      haze.addColorStop(1, "rgba(26,111,128,0.55)");
      fg.fillStyle = haze;
      fg.globalCompositeOperation = "source-atop";
      fg.fillRect(0, 0, far.width, far.height);
      fg.globalCompositeOperation = "source-over";
      bloom(far, f.neon, P * 1.5);

      const midH = Math.round(lhz * 0.52);
      const m = paintMid(tileLW, midH, P, font);
      mid = crisp(m.art, P);
      bloom(mid, m.neon, P * 1.5);
      signs = m.signs;
      // pre-blurred, flipped copy for the wet road
      midRefl = cnv(mid.width, mid.height);
      const rg = midRefl.getContext("2d")!;
      rg.filter = `blur(${P}px)`;
      rg.translate(0, mid.height);
      rg.scale(1, -1);
      rg.drawImage(mid, 0, 0);

      const nearH = Math.round(lhz * 0.3);
      const nr = paintNear(tileLW, nearH, P);
      near = crisp(nr.art, P);
      bloom(near, nr.neon, P * 2);

      road = cnv(W, roadH);
      const rdg = road.getContext("2d")!;
      const asphalt = rdg.createLinearGradient(0, 0, 0, roadH);
      asphalt.addColorStop(0, "#0d1534");
      asphalt.addColorStop(1, "#04061a");
      rdg.fillStyle = asphalt;
      rdg.fillRect(0, 0, W, roadH);
      rdg.fillStyle = "rgba(90,200,230,0.06)";
      for (let i = 0; i < 40; i++) rdg.fillRect(Math.round((r() * W) / P) * P, Math.round((r() * roadH) / P) * P, P * (6 + Math.floor(r() * 18)), P); // puddle glints

      fogA = paintFog(W * 2, horizon, 71, "#4fd6e0");
      fogB = paintFog(W * 2, Math.round(horizon * 0.45), 83, "#b07cff"); // horizon band only

      const colors = [NEON.pink, NEON.cyan, NEON.violet, NEON.yellow, NEON.mint, NEON.red, "#e8e8ff"];
      cars = colors.map((c, i) => ({ s: paintCar(c, P), lane: (i % 2) as 0 | 1, x: r() * W * 1.5, v: i % 2 ? -(0.9 + r() * 0.5) : 0.15 + r() * 0.25 }));
      flyers = [NEON.cyan, NEON.pink, NEON.violet, NEON.yellow].map((c) => ({ s: paintFlyer(c, P), x: r() * W, y: horizon * (0.12 + r() * 0.3), v: (r() > 0.5 ? 1 : -1) * (0.04 + r() * 0.05), ph: r() * 6 }));
      motes = Array.from({ length: 40 }, () => ({ x: r() * W, y: r() * horizon, v: 0.01 + r() * 0.02, ph: r() * 6 }));
      drops = Array.from({ length: 130 }, () => ({ x: r(), y: r(), v: 0.6 + r() * 0.5 }));
    };

    const tiled = (img: HTMLCanvasElement, offset: number, y: number) => {
      const w = img.width;
      for (let x = -(((offset % w) + w) % w); x < W; x += w) g.drawImage(img, x, y);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const moving = !pausedRef.current && !reduce;
      if (moving) {
        t += dt;
        cam += W * 0.03 * dt; // constant cruise
        // stage change: frame-rate independent ease toward the new stretch of road
        pageCam += (pageRef.current * W * 0.55 - pageCam) * (1 - Math.exp(-dt * 2.4));
      }
      const pos = cam + pageCam;
      g.imageSmoothingEnabled = false;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";

      g.drawImage(sky, 0, 0);

      for (const fl of flyers) {
        if (moving) fl.x += fl.v * W * dt;
        const span = W + fl.s.width * 2;
        const x = (((fl.x % span) + span) % span) - fl.s.width;
        const y = fl.y + Math.sin(t * 0.8 + fl.ph) * P * 2;
        g.save();
        if (fl.v < 0) g.translate(x * 2 + fl.s.width, 0), g.scale(-1, 1);
        g.drawImage(fl.s, x, y);
        g.restore();
      }

      tiled(far, pos * 0.06, horizon - far.height);
      g.globalAlpha = 0.9;
      tiled(fogA, pos * 0.04 + t * W * 0.004, 0);
      g.globalAlpha = 1;
      const midY = horizon - mid.height;
      tiled(mid, pos * 0.22, midY);
      // occasional neon flicker on one sign
      if (moving && Math.floor(t * 12) % 71 === 0 && signs.length) {
        const s = signs[Math.floor(t) % signs.length];
        const w = mid.width;
        g.fillStyle = "rgba(6,4,20,0.65)";
        for (let x = -((((pos * 0.22) % w) + w) % w); x < W; x += w) g.fillRect(x + s.x, midY + s.y, s.w, s.h);
      }
      g.globalAlpha = 0.6;
      tiled(fogB, pos * 0.12 + t * W * 0.007, horizon - fogB.height);
      g.globalAlpha = 1;
      tiled(near, pos * 0.7, horizon - near.height);

      // wet road: base, mirrored city, moon shimmer, rushing lane dashes
      g.drawImage(road, 0, horizon);
      g.save();
      g.beginPath();
      g.rect(0, horizon, W, roadH);
      g.clip();
      g.globalAlpha = 0.26;
      g.globalCompositeOperation = "lighter";
      const rw = midRefl.width;
      for (let x = -((((pos * 0.22) % rw) + rw) % rw); x < W; x += rw) g.drawImage(midRefl, x, horizon, rw, midRefl.height * 0.7);
      g.globalAlpha = 0.5;
      g.fillStyle = "#bff4ff";
      for (let i = 0; i < 9; i++) {
        const y = horizon + P * (2 + i * 2);
        const len = (14 - i) * P * (1.3 + Math.sin(t * 2.2 + i * 1.7) * 0.5);
        g.fillRect(Math.round((moonX - len / 2) / P) * P, y, Math.round(len / P) * P, P);
      }
      g.restore();
      g.fillStyle = "rgba(255,216,77,0.55)";
      const dashY = horizon + Math.round((roadH * 0.5) / P) * P;
      for (let x = -((pos * 1.15) % (P * 26)); x < W; x += P * 26) g.fillRect(x, dashY, P * 11, P);

      // traffic: lane 0 travels with us, lane 1 is oncoming
      const laneY = [H - P * 4, horizon + Math.round((roadH * 0.42) / P) * P];
      for (const c of cars) {
        if (moving) c.x += (c.v - 0.03) * W * dt;
        const span = W + c.s.glow.width * 2;
        const x = (((c.x % span) + span) % span) - c.s.glow.width;
        const y = laneY[c.lane] - c.s.sprite.height;
        g.save();
        if (c.lane === 1) g.translate(x * 2 + c.s.sprite.width, 0), g.scale(-1, 1);
        g.globalCompositeOperation = "lighter";
        g.drawImage(c.s.glow, x - c.s.ox, y - P);
        g.globalCompositeOperation = "source-over";
        g.drawImage(c.s.sprite, x, y);
        g.restore();
      }

      // dust motes in the light, then rain
      g.fillStyle = "#a6f6ff";
      for (const m of motes) {
        if (moving) (m.y -= m.v * H * dt), (m.x -= m.v * W * 0.3 * dt);
        if (m.y < 0) m.y += horizon;
        if (m.x < 0) m.x += W;
        g.globalAlpha = 0.25 + 0.35 * Math.sin(t * 1.5 + m.ph) ** 2;
        g.fillRect(Math.round(m.x / P) * P, Math.round(m.y / P) * P, P, P);
      }
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(180,225,255,0.20)";
      g.lineWidth = Math.max(1, P / 3);
      g.beginPath();
      for (const d of drops) {
        if (moving) d.y += d.v * dt;
        if (d.y > 1) d.y -= 1;
        const x = d.x * W, y = d.y * H;
        g.moveTo(x, y);
        g.lineTo(x - P * 1.5, y + P * 6);
      }
      g.stroke();

      if (moving) raf = requestAnimationFrame(frame);
    };

    kick.current = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        build();
        kick.current();
      }, 150);
    };

    let alive = true;
    document.fonts.ready.then(() => {
      if (!alive) return;
      font = getComputedStyle(document.documentElement).getPropertyValue("--font-hud").trim() || "monospace";
      build();
      kick.current();
    });
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-[var(--bar-h)] top-[var(--header-h)] z-0">
      <canvas ref={ref} data-scene data-running={!paused} className="h-full w-full [image-rendering:pixelated]" />
      {/* calmer scene behind data stages, so moving traffic never competes with a chart */}
      <div className={`absolute inset-0 bg-[#0d0a26] transition-opacity duration-700 ${dim ? "opacity-55" : "opacity-0"}`} />
    </div>
  );
}
