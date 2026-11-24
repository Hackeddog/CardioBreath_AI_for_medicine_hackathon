"use client";

import React, { useEffect, useRef } from "react";

/**
 * Background world, drawn on a canvas: a neon megacity at night above a wet highway, seen from a car that
 * keeps driving. Smooth gradients and glow (a "128-bit" look) over the pixel UI. Layers scroll at different
 * speeds all the time, and each stage change adds a burst of forward travel. Decorative only: aria-hidden,
 * no pointer events. It stops only via the header pause control or prefers-reduced-motion (single frame).
 */

const NEON = ["#2de2ff", "#ff3ea5", "#ffd84d", "#b48cff", "#5cf2b0"];
const SIGNS_V = ["眠", "夜", "心", "息"]; // sleep, night, heart, breath
const SIGNS_H = ["SLEEP LAB", "OPEN 24H", "MOTEL", "BREATHE", "NOODLES", "CLINIC"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/* ---------- static layers, rendered once per size into tiles that repeat horizontally ---------- */

function farTowers(w: number, h: number) {
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  const r = rng(11);
  const lights: { x: number; y: number }[] = [];
  let x = 0;
  while (x < w) {
    const bw = 50 + r() * 110;
    const bh = h * (0.35 + r() * 0.62);
    const y = h - bh;
    const grad = g.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, "#24185c");
    grad.addColorStop(1, "#0b0722");
    g.fillStyle = grad;
    g.fillRect(x, y, bw, bh);
    if (r() > 0.5) {
      g.fillRect(x + bw * 0.25, y - bh * 0.07, bw * 0.5, bh * 0.07);
      g.fillRect(x + bw * 0.47, y - bh * 0.16, 3, bh * 0.1);
      lights.push({ x: x + bw * 0.47 + 1, y: y - bh * 0.16 });
    }
    g.fillStyle = "rgba(180,150,255,0.10)";
    for (let wy = y + 8; wy < h - 6; wy += 9) for (let wx = x + 5; wx < x + bw - 5; wx += 7) if (r() < 0.16) g.fillRect(wx, wy, 3, 4);
    if (r() > 0.45) {
      const col = NEON[Math.floor(r() * NEON.length)];
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 12;
      g.fillStyle = col;
      g.globalAlpha = 0.55;
      g.fillRect(x + (r() > 0.5 ? 2 : bw - 4), y + 12, 2, bh * 0.7);
      g.restore();
    }
    // giant holographic billboard on some of the tall towers
    if (bw > 90 && bh > h * 0.6 && r() > 0.45) {
      const bx = x + 8;
      const by = y + bh * 0.12;
      const bwid = bw - 16;
      const bht = bwid * 0.62;
      const holo = g.createLinearGradient(bx, by, bx + bwid, by + bht);
      const a = NEON[Math.floor(r() * NEON.length)];
      const b = NEON[Math.floor(r() * NEON.length)];
      holo.addColorStop(0, a);
      holo.addColorStop(1, b);
      g.save();
      g.globalAlpha = 0.32;
      g.shadowColor = a;
      g.shadowBlur = 24;
      g.fillStyle = holo;
      g.fillRect(bx, by, bwid, bht);
      g.globalAlpha = 0.5;
      g.fillStyle = "rgba(255,255,255,0.25)";
      for (let sy = by; sy < by + bht; sy += 4) g.fillRect(bx, sy, bwid, 1); // scanlines
      g.globalAlpha = 0.9;
      g.fillStyle = "#fff";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `${Math.round(bht * 0.45)}px sans-serif`;
      g.fillText(["♥", "Z z", "眠", "♪"][Math.floor(r() * 4)], bx + bwid / 2, by + bht / 2);
      g.restore();
    }
    x += bw + r() * 16;
  }
  return { tile: c, lights };
}

function midCity(w: number, h: number, font: string) {
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  const r = rng(29);
  const signs: { x: number; y: number; w: number; h: number; col: string }[] = [];
  let x = 0;
  while (x < w) {
    const bw = 70 + r() * 130;
    const bh = h * (0.3 + r() * 0.6);
    const y = h - bh;
    const grad = g.createLinearGradient(x, 0, x + bw, 0);
    grad.addColorStop(0, "#160f3d");
    grad.addColorStop(0.5, "#1e1550");
    grad.addColorStop(1, "#120c33");
    g.fillStyle = grad;
    g.fillRect(x, y, bw, bh);
    // lit windows with a soft glow
    for (let wy = y + 10; wy < h - 8; wy += 12)
      for (let wx = x + 6; wx < x + bw - 8; wx += 10)
        if (r() < 0.22) {
          const col = r() < 0.7 ? "#ffd9a0" : NEON[Math.floor(r() * NEON.length)];
          g.globalAlpha = 0.35 + r() * 0.45;
          g.fillStyle = col;
          g.fillRect(wx, wy, 5, 6);
        }
    g.globalAlpha = 1;
    // neon roof edge
    if (r() > 0.4) {
      const col = NEON[Math.floor(r() * NEON.length)];
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 14;
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y + 1);
      g.lineTo(x + bw, y + 1);
      g.stroke();
      g.restore();
    }
    // signage
    const roll = r();
    if (roll > 0.32 && bh > 90) {
      const col = NEON[Math.floor(r() * NEON.length)];
      const vertical = roll > 0.78;
      const sw = vertical ? 30 : 92 + r() * 40;
      const sh = vertical ? 96 : 30;
      const sx = x + bw / 2 - sw / 2;
      const sy = y + 24 + r() * Math.max(10, bh * 0.3);
      g.save();
      g.fillStyle = "rgba(8,5,24,0.85)";
      g.fillRect(sx, sy, sw, sh);
      g.shadowColor = col;
      g.shadowBlur = 18;
      g.strokeStyle = col;
      g.lineWidth = 2.5;
      g.strokeRect(sx, sy, sw, sh);
      g.fillStyle = col;
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (vertical) {
        g.font = `26px ${font}`;
        const ch = SIGNS_V[Math.floor(r() * SIGNS_V.length)];
        g.fillText(ch, sx + sw / 2, sy + sh / 2);
      } else {
        g.font = `24px ${font}`;
        g.fillText(SIGNS_H[Math.floor(r() * SIGNS_H.length)], sx + sw / 2, sy + sh / 2 + 1, sw - 8);
      }
      g.restore();
      signs.push({ x: sx, y: sy, w: sw, h: sh, col });
    }
    x += bw + 4 + r() * 10;
  }
  return { tile: c, signs };
}

function streetSide(w: number, h: number) {
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  const r = rng(47);
  // guardrail with a running light strip
  g.fillStyle = "#130d36";
  g.fillRect(0, h - 14, w, 14);
  g.save();
  g.shadowColor = "#2de2ff";
  g.shadowBlur = 10;
  g.fillStyle = "rgba(45,226,255,0.8)";
  g.fillRect(0, h - 14, w, 2);
  g.restore();
  for (let x = 40; x < w; x += 260 + r() * 40) {
    // light cone
    const cone = g.createLinearGradient(0, h * 0.15, 0, h);
    cone.addColorStop(0, "rgba(255,217,160,0.28)");
    cone.addColorStop(1, "rgba(255,217,160,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(x + 4, h * 0.15);
    g.lineTo(x + 18, h * 0.15);
    g.lineTo(x + 70, h);
    g.lineTo(x - 48, h);
    g.closePath();
    g.fill();
    g.fillStyle = "#231c5e";
    g.fillRect(x + 9, h * 0.13, 4, h * 0.87);
    g.save();
    g.shadowColor = "#ffd9a0";
    g.shadowBlur = 16;
    g.fillStyle = "#ffe7bf";
    g.fillRect(x, h * 0.12, 22, 5);
    g.restore();
  }
  return c;
}

/* ---------- moving things ---------- */

interface Car { lane: 0 | 1; x: number; v: number; color: string; len: number }
interface Flyer { x: number; y: number; v: number; color: string }
interface Drop { x: number; y: number; v: number; len: number }

function drawCar(g: CanvasRenderingContext2D, c: Car, laneY: number, facingRight: boolean) {
  const L = c.len;
  const H = L * 0.3;
  const x = c.x;
  const y = laneY - H;
  g.save();
  // headlight beam
  const bx = facingRight ? x + L : x;
  const beam = g.createLinearGradient(bx, 0, bx + (facingRight ? 1 : -1) * L * 1.8, 0);
  beam.addColorStop(0, "rgba(255,240,200,0.45)");
  beam.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = beam;
  g.beginPath();
  g.moveTo(bx, y + H * 0.45);
  g.lineTo(bx + (facingRight ? 1 : -1) * L * 1.8, y + H * 0.1);
  g.lineTo(bx + (facingRight ? 1 : -1) * L * 1.8, y + H * 1.1);
  g.closePath();
  g.fill();
  // body
  const body = g.createLinearGradient(0, y, 0, y + H);
  body.addColorStop(0, c.color);
  body.addColorStop(1, "#140c30");
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(x + L * 0.04, y + H);
  g.lineTo(x + L * 0.02, y + H * 0.5);
  g.lineTo(x + L * 0.25, y + H * 0.42);
  g.lineTo(x + L * 0.38, y + H * 0.05);
  g.lineTo(x + L * 0.7, y + H * 0.05);
  g.lineTo(x + L * 0.82, y + H * 0.42);
  g.lineTo(x + L * 0.98, y + H * 0.52);
  g.lineTo(x + L * 0.97, y + H);
  g.closePath();
  g.fill();
  // glass
  g.fillStyle = "rgba(127,233,255,0.35)";
  g.beginPath();
  g.moveTo(x + L * 0.4, y + H * 0.12);
  g.lineTo(x + L * 0.68, y + H * 0.12);
  g.lineTo(x + L * 0.77, y + H * 0.42);
  g.lineTo(x + L * 0.31, y + H * 0.42);
  g.closePath();
  g.fill();
  // underglow
  g.shadowColor = c.color;
  g.shadowBlur = 16;
  g.fillStyle = c.color;
  g.globalAlpha = 0.7;
  g.fillRect(x + L * 0.12, y + H * 0.98, L * 0.76, 2);
  g.globalAlpha = 1;
  // lights
  g.shadowBlur = 14;
  g.shadowColor = "#fff2b0";
  g.fillStyle = "#fff6d0";
  g.fillRect(facingRight ? x + L * 0.93 : x + L * 0.02, y + H * 0.52, L * 0.05, H * 0.12);
  g.shadowColor = "#ff3b5c";
  g.fillStyle = "#ff3b5c";
  g.fillRect(facingRight ? x + L * 0.02 : x + L * 0.93, y + H * 0.55, L * 0.05, H * 0.1);
  // wheels
  g.shadowBlur = 0;
  g.fillStyle = "#05030f";
  for (const wx of [0.2, 0.78]) {
    g.beginPath();
    g.arc(x + L * wx, y + H, H * 0.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

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
    const g = cv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r = rng(5);
    let W = 0, H = 0, dpr = 1, horizon = 0, road = 0;
    let far: ReturnType<typeof farTowers> | null = null;
    let mid: ReturnType<typeof midCity> | null = null;
    let side: HTMLCanvasElement | null = null;
    let font = "monospace";
    let raf = 0;
    let last = performance.now();
    let cam = 0; // metres travelled, in px
    let pageCam = 0; // eased extra travel per stage
    let t = 0;

    const cars: Car[] = Array.from({ length: 7 }, (_, i) => ({
      lane: (i % 2) as 0 | 1,
      x: r() * 1600,
      v: i % 2 ? -(260 + r() * 160) : 40 + r() * 70,
      color: NEON[i % NEON.length],
      len: i % 2 ? 90 : 120,
    }));
    const flyers: Flyer[] = Array.from({ length: 4 }, () => ({ x: r() * 1600, y: 0.1 + r() * 0.3, v: (r() > 0.5 ? 1 : -1) * (30 + r() * 50), color: NEON[Math.floor(r() * 5)] }));
    const drops: Drop[] = Array.from({ length: 160 }, () => ({ x: r(), y: r(), v: 500 + r() * 400, len: 8 + r() * 14 }));

    const build = () => {
      const rect = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = rect.width;
      H = rect.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      road = Math.min(150, Math.max(96, H * 0.2));
      horizon = H - road;
      const tw = Math.max(1800, W * 1.6);
      far = farTowers(tw, horizon * 0.85);
      mid = midCity(tw, horizon * 0.55, font);
      side = streetSide(tw, Math.min(160, horizon * 0.3));
    };

    const tiled = (img: HTMLCanvasElement, offset: number, y: number, alpha = 1) => {
      const w = img.width;
      let x = -(((offset % w) + w) % w);
      g.globalAlpha = alpha;
      for (; x < W; x += w) g.drawImage(img, x, y);
      g.globalAlpha = 1;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current && !reduce) {
        t += dt;
        cam += 60 * dt; // constant cruise
        pageCam += (pageRef.current * 900 - pageCam) * Math.min(1, dt * 2.2); // stage change: a burst forward
      }
      const pos = cam + pageCam;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      // smog glow on the horizon
      const sky = g.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, "rgba(13,10,38,0)");
      sky.addColorStop(0.55, "rgba(70,20,110,0.35)");
      sky.addColorStop(1, "rgba(255,62,165,0.35)");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, horizon);

      // searchlights sweeping from the towers
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const sx = ((i * 0.37 + 0.15) * W) - ((pos * 0.05) % (W * 0.4));
        const ang = -Math.PI / 2 + Math.sin(t * 0.25 + i * 2) * 0.45;
        const len = horizon * 1.1;
        const grad = g.createLinearGradient(sx, horizon, sx + Math.cos(ang) * len, horizon + Math.sin(ang) * len);
        grad.addColorStop(0, i === 1 ? "rgba(255,62,165,0.16)" : "rgba(45,226,255,0.13)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(sx, horizon);
        g.lineTo(sx + Math.cos(ang - 0.05) * len, horizon + Math.sin(ang - 0.05) * len);
        g.lineTo(sx + Math.cos(ang + 0.05) * len, horizon + Math.sin(ang + 0.05) * len);
        g.closePath();
        g.fill();
      }
      g.restore();

      if (far && mid && side) {
        const farY = horizon - far.tile.height;
        tiled(far.tile, pos * 0.08, farY);
        // aviation lights blink
        if (Math.sin(t * 3) > 0.2) {
          g.save();
          g.fillStyle = "#ff3b5c";
          g.shadowColor = "#ff3b5c";
          g.shadowBlur = 8;
          const w = far.tile.width;
          const off = -((((pos * 0.08) % w) + w) % w);
          for (const l of far.lights) for (let k = off; k < W; k += w) g.fillRect(k + l.x - 1.5, farY + l.y - 2, 3, 3);
          g.restore();
        }

        // flying cars between the towers
        for (const f of flyers) {
          if (!pausedRef.current && !reduce) f.x += (f.v - 25) * dt;
          const fx = ((f.x % (W + 200)) + W + 200) % (W + 200) - 100;
          const fy = horizon * f.y;
          g.save();
          g.shadowColor = f.color;
          g.shadowBlur = 12;
          g.fillStyle = "#1a1240";
          g.fillRect(fx - 14, fy - 3, 28, 7);
          g.fillStyle = f.color;
          g.fillRect(fx - 14, fy + 4, 28, 2);
          g.fillStyle = f.v > 0 ? "#fff6d0" : "#ff3b5c";
          g.fillRect(fx + (f.v > 0 ? 12 : -14), fy - 1, 3, 3);
          g.restore();
        }

        // haze between layers
        const haze = g.createLinearGradient(0, horizon - mid.tile.height, 0, horizon);
        haze.addColorStop(0, "rgba(40,16,80,0)");
        haze.addColorStop(1, "rgba(120,40,140,0.28)");
        g.fillStyle = haze;
        g.fillRect(0, horizon - mid.tile.height * 1.2, W, mid.tile.height * 1.2);

        const midY = horizon - mid.tile.height;
        tiled(mid.tile, pos * 0.3, midY);
        // one sign flickers now and then
        const flick = Math.floor(t * 8) % 23 === 0;
        if (flick && mid.signs.length) {
          const s = mid.signs[Math.floor(t) % mid.signs.length];
          const w = mid.tile.width;
          const off = -((((pos * 0.3) % w) + w) % w);
          g.fillStyle = "rgba(8,5,24,0.75)";
          for (let k = off; k < W; k += w) g.fillRect(k + s.x - 4, midY + s.y - 4, s.w + 8, s.h + 8);
        }

        tiled(side, pos * 1.0, horizon - side.height);

        // wet road with mirrored city light
        const asphalt = g.createLinearGradient(0, horizon, 0, H);
        asphalt.addColorStop(0, "#1a1240");
        asphalt.addColorStop(1, "#07051a");
        g.fillStyle = asphalt;
        g.fillRect(0, horizon, W, road);
        g.save();
        g.globalCompositeOperation = "lighter";
        g.translate(0, horizon * 2);
        g.scale(1, -1);
        tiled(mid.tile, pos * 0.3, midY, 0.13);
        g.restore();
        // lane dashes rushing past
        g.fillStyle = "rgba(255,216,77,0.55)";
        const dashY = horizon + road * 0.5;
        for (let x = -((pos * 1.3) % 90); x < W; x += 90) g.fillRect(x, dashY, 44, 3);

        // traffic: lane 0 travels with us, lane 1 is oncoming
        const laneY = [horizon + road * 0.92, horizon + road * 0.42];
        const scale = [1, 0.75];
        for (const c of cars) {
          if (!pausedRef.current && !reduce) c.x += (c.v - 60) * dt;
          const span = W + 600;
          const cx = ((c.x % span) + span) % span - 300;
          drawCar(g, { ...c, x: cx, len: c.len * scale[c.lane] * Math.min(1, W / 900 + 0.35) }, laneY[c.lane], c.lane === 0);
        }

        // rain
        g.strokeStyle = "rgba(170,200,255,0.22)";
        g.lineWidth = 1;
        g.beginPath();
        for (const d of drops) {
          if (!pausedRef.current && !reduce) d.y += (d.v * dt) / H;
          if (d.y > 1) d.y -= 1;
          const x = d.x * W;
          const y = d.y * H;
          g.moveTo(x, y);
          g.lineTo(x - d.len * 0.25, y + d.len);
        }
        g.stroke();
      }

      if (!pausedRef.current && !reduce) raf = requestAnimationFrame(frame);
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
      }, 120);
    };

    document.fonts.ready.then(() => {
      font = getComputedStyle(document.documentElement).getPropertyValue("--font-hud").trim() || "monospace";
      build();
      kick.current();
    });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-[var(--bar-h)] top-[var(--header-h)] z-0">
      <canvas ref={ref} data-scene data-running={!paused} className="h-full w-full" />
      {/* calmer scene behind data stages, so moving traffic never competes with a chart */}
      <div className={`absolute inset-0 bg-[#0d0a26] transition-opacity duration-700 ${dim ? "opacity-55" : "opacity-0"}`} />
    </div>
  );
}
