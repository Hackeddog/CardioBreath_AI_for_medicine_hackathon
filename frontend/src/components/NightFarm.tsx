"use client";

import React, { useEffect, useRef } from "react";

/**
 * Background: a quiet farm at night where sheep hop a fence one at a time, like counting sheep.
 * Same hi-bit technique as before: every layer is painted at about 250 px tall with ordered dithering,
 * scaled up crisp and baked once per resize, so a frame is a few drawImage calls plus a handful of sprites.
 * Only slow things move (clouds, star twinkle, fireflies, grass, sheep). Decorative only: aria-hidden.
 */

const C = {
  sky: ["#1a2036", "#1f2740", "#26304b", "#2e3955", "#38435e"], // top -> horizon
  star: "#d9d4c0",
  moon: "#efe6c8",
  moonShade: "#d6cbaa",
  cloud: "#2f3854",
  cloudLit: "#434d6a",
  farHill: "#222a41",
  town: "#283047",
  townLight: "#b39663",
  midHill: "#26332e",
  midRim: "#34443b",
  field: "#212b26",
  fieldLit: "#2d3a2f",
  grass: "#46573f",
  wood: "#6b5a48",
  woodLit: "#8a7660",
  woodShade: "#463b31",
  roof: "#2a2733",
  window: "#e2b46a",
  wool: "#e6e0cf",
  woolShade: "#b5ae9e",
  face: "#3a3642",
  mouth: "#c98d8a",
  firefly: "#e8e0a0",
  stone: ["#565964", "#5e616c", "#4f525c", "#666873"],
  mortar: "#3d3f48",
  quoin: "#73747d",
  plaster: "#857d6c",
  beam: "#3b2f27",
  thatch: "#6b5c43",
  thatchDark: "#4a3f31",
  thatchLit: "#857256",
  bushDark: "#1f2c1c",
  bush: "#2b3c26",
  bushLit: "#3f5536",
  door: "#3e3128",
  doorLine: "#30261e",
  frame: "#2a2420",
  windowDim: "#c49b5c",
  pot: "#6a4c3e",
  smoke: "#a6acbe",
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/* Sheep, 16 x 10, facing right. w wool, s wool shade, f face and legs, m open mouth (yawn). */
const BODY = [
  "....wwwww.......",
  "..wwwwwwwww.....",
  ".wwwwwwwwwwwff..",
  "wwwwwwwwwwwffff.",
  "wwwwwwwwwwwfffff",
  "swwwwwwwwwwsfff.",
  ".sswwwwwwwss....",
  "..ssssssssss....",
];
const LEGS = {
  a: ["..f..f...f..f...", "..f..f...f..f..."],
  b: ["...ff.....ff....", "...ff.....ff...."],
  tuck: [".ff........ff...", "................"],
};

// Loop timing, in seconds and foreground units (one unit = 2 art pixels: the foreground is drawn chunkier).
const SPACING = 3.5; // one sheep every 3.5 s
const SPEED = 11; // walking speed, units/s
const HOP_T = 1.1; // time in the air
const HOP_DX = 34; // distance covered by a hop (clears the 12 px fence)
const HOP_H = 15; // apex height
const PAUSE_T = 2.2; // a yawning sheep stops this long
const FENCE_W = 12;
const START_X = -18;

const yawns = (i: number) => i > 0 && (Math.imul(i, 2654435761) >>> 0) % 100 < 22;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
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
function sprite(rows: string[], map: Record<string, string>, P: number) {
  const lo = cnv(rows[0].length, rows.length);
  const g = lo.getContext("2d")!;
  rows.forEach((row, y) => [...row].forEach((ch, x) => map[ch] && ((g.fillStyle = map[ch]), g.fillRect(x, y, 1, 1))));
  return crisp(lo, P);
}

/* ---------- baked layers (low res `lw x lh`) ---------- */

function paintSky(lw: number, lh: number, hz: number, moonX: number, moonY: number, moonR: number) {
  const c = cnv(lw, lh);
  const g = c.getContext("2d")!;
  const img = g.createImageData(lw, lh);
  const cols = C.sky.map(hex);
  for (let y = 0; y < lh; y++) {
    const t = Math.min(1, y / hz) * (cols.length - 1);
    const b = Math.min(cols.length - 2, Math.floor(t));
    const f = t - b;
    for (let x = 0; x < lw; x++) {
      const col = f > BAYER[(y % 4) * 4 + (x % 4)] ? cols[b + 1] : cols[b];
      const i = (y * lw + x) * 4;
      img.data.set([col[0], col[1], col[2], 255], i);
    }
  }
  g.putImageData(img, 0, 0);
  // faint, dithered moon halo: two rings of sparse light pixels, no blur
  const [mr, mg, mb] = hex(C.moon);
  for (let y = moonY - moonR * 3; y < moonY + moonR * 3; y++)
    for (let x = moonX - moonR * 3; x < moonX + moonR * 3; x++) {
      const d = Math.hypot(x - moonX, y - moonY) / moonR;
      if (d < 1 || d > 3) continue;
      const a = 0.16 * (1 - (d - 1) / 2);
      if (a > BAYER[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)] * 0.3) {
        g.fillStyle = `rgba(${mr},${mg},${mb},${a.toFixed(3)})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  for (let y = -moonR; y <= moonR; y++)
    for (let x = -moonR; x <= moonR; x++) {
      const q = (x * x + y * y) / (moonR * moonR);
      if (q > 1) continue;
      const shade = Math.hypot(x + moonR * 0.3, y + moonR * 0.25) > moonR * 1.05; // lit from the upper left
      const mare = [[-0.3, -0.2, 0.28], [0.25, 0.1, 0.2], [-0.05, 0.4, 0.16]].some(([mx, my, mr]) => Math.hypot(x / moonR - mx, y / moonR - my) < mr);
      g.fillStyle = shade || mare ? C.moonShade : C.moon;
      g.fillRect(moonX + x, moonY + y, 1, 1);
    }
  const r = rng(3);
  g.fillStyle = C.star;
  for (let i = 0; i < lw * 0.18; i++) {
    const x = Math.floor(r() * lw), y = Math.floor(r() * hz * 0.75);
    if (Math.hypot(x - moonX, y - moonY) < moonR * 3.2) continue;
    g.globalAlpha = 0.2 + r() * 0.45;
    g.fillRect(x, y, 1, 1);
  }
  g.globalAlpha = 1;
  return c;
}

/** A strip of soft clouds that tiles horizontally. */
function paintClouds(w: number, h: number, seed: number, count: number) {
  const c = cnv(w, h);
  const g = c.getContext("2d")!;
  const r = rng(seed);
  for (let n = 0; n < count; n++) {
    const cx = r() * w, cy = h * (0.35 + r() * 0.4), rx = 14 + r() * 26, ry = 3 + r() * 3;
    for (let y = Math.floor(cy - ry * 2); y < cy + ry; y++)
      for (let x = Math.floor(cx - rx); x < cx + rx; x++) {
        const nx = (x - cx) / rx;
        const top = cy - ry * (1 + 0.8 * Math.max(0, Math.sin(nx * 4 + n) * (1 - nx * nx))); // bumpy top, flat base
        if (y < top || nx * nx > 1 - ((y - cy) / (ry * 3)) ** 2) continue;
        g.fillStyle = y - top < 1.5 ? C.cloudLit : C.cloud;
        g.fillRect(((x % w) + w) % w, y, 1, 1);
      }
  }
  return c;
}

/**
 * A medieval farmhouse of rural England and Scotland: a rubble-stone ground floor with dressed corner
 * quoins, a half-timbered upper band (dark oak beams and braces on limewash), a thick thatched roof with
 * an eyebrow window, stone chimney stacks at the gable ends, and small leaded windows glowing warm (one
 * dimmer, as if someone is heading to bed). Painted at art resolution onto `g`.
 * Returns the lit windows (for their glow) and the top of the smoking chimney.
 */
function paintCottage(g: CanvasRenderingContext2D, hx: number, by: number, r: () => number) {
  const W = 44, wallH = 17, top = by - wallH;
  const px = (x: number, y: number, c: string) => ((g.fillStyle = c), g.fillRect(x, y, 1, 1));
  const stoneBlock = (x0: number, y0: number, w: number, h: number, course: number) => {
    for (let y = y0; y < y0 + h; y++) {
      const row = Math.floor((y0 + h - 1 - y) / course);
      if ((y0 + h - 1 - y) % course === course - 1) {
        g.fillStyle = C.mortar;
        g.fillRect(x0, y, w, 1);
        continue;
      }
      // brick boundaries differ per course, so joints stagger like real coursed stone
      const rr = rng(row * 97 + x0 * 13 + 5);
      let x = x0 - Math.floor(rr() * 4);
      while (x < x0 + w) {
        const bw = 3 + Math.floor(rr() * 4);
        const shade = C.stone[Math.floor(rr() * C.stone.length)];
        for (let k = Math.max(x, x0); k < Math.min(x + bw - 1, x0 + w); k++) px(k, y, shade);
        if (x + bw - 1 >= x0 && x + bw - 1 < x0 + w) px(x + bw - 1, y, C.mortar);
        x += bw;
      }
    }
  };
  // ground floor: rubble stone, plinth and corner quoins
  const band = 8; // half-timbered rows above the stone
  stoneBlock(hx, top + band, W, wallH - band, 3);
  g.fillStyle = C.mortar;
  g.fillRect(hx, by - 1, W, 1);
  for (let c = 0, y = by - 1; y > top + band; c++, y -= 3) {
    g.fillStyle = C.quoin;
    const qw = c % 2 ? 2 : 3;
    g.fillRect(hx, y - 2, qw, 2);
    g.fillRect(hx + W - qw, y - 2, qw, 2);
  }
  // upper band: limewash between oak posts, a wall plate, a sill beam and a pair of braces
  g.fillStyle = C.plaster;
  g.fillRect(hx, top, W, band);
  g.fillStyle = C.beam;
  g.fillRect(hx, top, W, 1);
  g.fillRect(hx, top + band - 1, W, 1);
  for (let x = hx; x < hx + W; x += 7) g.fillRect(x, top, 1, band);
  g.fillRect(hx + W - 1, top, 1, band);
  for (let k = 0; k < band - 2; k++) {
    px(hx + 15 + k, top + 1 + k, C.beam); // braces lean in toward the middle bay
    px(hx + W - 16 - k, top + 1 + k, C.beam);
  }
  // thick thatch: deep overhanging eaves with a shadowed lip, straw streaks, a rounded moonlit ridge
  const roofH = 14;
  for (let k = 0; k < roofH; k++) {
    const y = top - 1 - k;
    let x0 = hx - 4 + k, x1 = hx + W + 3 - k;
    if (k >= roofH - 2) (x0 += 1), (x1 -= 1); // round off the ridge
    g.fillStyle = k === 0 ? C.thatchDark : k === 1 || k === roofH - 1 ? C.thatchLit : C.thatch;
    g.fillRect(x0, y, x1 - x0, 1);
    if (k > 1 && k < roofH - 1)
      for (let x = x0 + Math.floor(r() * 2); x < x1; x += 2 + Math.floor(r() * 3)) px(x, y, r() < 0.6 ? C.thatchDark : C.thatchLit);
  }
  // eyebrow window: the thatch lifts over a small lit window
  const dx = hx + 20, dTop = top - 8;
  // chimney stacks at both gable ends, each with a cap and a clay pot
  const stack = (x: number) => {
    stoneBlock(x, top - roofH - 6, 5, roofH + 6, 2);
    g.fillStyle = C.quoin;
    g.fillRect(x - 1, top - roofH - 7, 7, 1);
    g.fillStyle = C.pot;
    g.fillRect(x + 1, top - roofH - 9, 3, 2);
    return [x + 2.5, top - roofH - 9] as [number, number];
  };
  stack(hx + 3);
  const chimney = stack(hx + W - 8);
  // door: planked and round-headed, set in the stone
  const doorX = hx + 19, doorW = 6, doorH = 9;
  g.fillStyle = C.door;
  g.fillRect(doorX, by - doorH, doorW, doorH);
  g.fillStyle = C.doorLine;
  for (let x = doorX + 2; x < doorX + doorW; x += 2) g.fillRect(x, by - doorH + 1, 1, doorH - 1);
  px(doorX, by - doorH, C.mortar);
  px(doorX + doorW - 1, by - doorH, C.mortar);
  // small leaded windows in the timber band, warm; the right-hand one dimmer
  const windows: [number, number, number, number][] = [];
  const win = (x: number, y: number, s: number, glass: string) => {
    g.fillStyle = C.frame;
    g.fillRect(x - 1, y - 1, s + 2, s + 2);
    g.fillStyle = glass;
    g.fillRect(x, y, s, s);
    g.fillStyle = C.frame;
    g.fillRect(x + Math.floor(s / 2), y, 1, s);
    g.fillRect(x, y + Math.floor(s / 2), s, 1);
    g.fillStyle = C.quoin;
    g.fillRect(x - 1, y + s + 1, s + 2, 1); // sill
    windows.push([x, y, s, s]);
  };
  win(hx + 8, top + 2, 4, C.window);
  win(hx + W - 12, top + 2, 4, C.windowDim);
  win(dx, dTop, 3, C.window);
  g.fillStyle = C.thatchLit; // the eyebrow hood over the dormer window
  g.fillRect(dx - 2, dTop - 2, 7, 1);
  g.fillRect(dx - 1, dTop - 3, 5, 1);
  return { windows, chimney };
}

/** A soft, round shrub: bumpy crown, moonlit on the upper left, shadowed at its foot. */
function paintBush(g: CanvasRenderingContext2D, cx: number, by: number, w: number, h: number, seed: number) {
  for (let y = by - h; y < by; y++)
    for (let x = Math.floor(cx - w / 2); x <= cx + w / 2; x++) {
      const nx = (x - cx) / (w / 2), ny = (by - 1 - y) / h;
      const crown = Math.sqrt(Math.max(0, 1 - nx * nx)) * (0.82 + 0.18 * Math.sin(x * 1.7 + seed));
      if (ny > crown) continue;
      const lit = ny > crown - 0.3 && nx < 0.35 && (ny + nx * 0.3) * 0.9 > BAYER[(y % 4) * 4 + (((x % 4) + 4) % 4)];
      g.fillStyle = ny < 0.18 ? C.bushDark : lit ? C.bushLit : C.bush;
      g.fillRect(x, y, 1, 1);
    }
}

function paintLand(lw: number, lh: number, hz: number, fieldTop: number, gy: number, P: number) {
  const art = cnv(lw, lh);
  const g = art.getContext("2d")!;
  const r = rng(17);
  const col = (x: number, y0: number, color: string, rim?: string) => {
    g.fillStyle = color;
    g.fillRect(x, y0, 1, lh - y0);
    if (rim) (g.fillStyle = rim), g.fillRect(x, y0, 1, 1);
  };
  // far hills with a sleeping town on the ridge
  const far = (x: number) => Math.round(hz - 7 - 5 * Math.sin(x * 0.017 + 1) - 3 * Math.sin(x * 0.045));
  for (let x = 0; x < lw; x++) col(x, far(x), C.farHill);
  const lights: [number, number][] = [];
  for (let x = Math.round(lw * 0.42); x < lw * 0.8; ) {
    const w = 4 + Math.floor(r() * 4), h = 3 + Math.floor(r() * 4);
    const base = far(x + w / 2) + 1;
    g.fillStyle = C.town;
    g.fillRect(x, base - h, w, h);
    for (let k = 0; k < Math.ceil(w / 2); k++) g.fillRect(x + k, base - h - k, w - k * 2, 1); // pitched roof
    if (r() < 0.35) lights.push([x + 1 + Math.floor(r() * (w - 2)), base - 2]);
    x += w + 1 + Math.floor(r() * 6);
  }
  g.fillStyle = C.townLight;
  g.globalAlpha = 0.55; // a few windows still lit, the rest asleep
  for (const [x, y] of lights.slice(0, 5)) g.fillRect(x, y, 1, 1);
  g.globalAlpha = 1;
  // rolling mid hills, moonlit rim
  const mid = (x: number) => Math.round(hz + 4 - 6 * Math.sin(x * 0.011 + 2) - 2 * Math.sin(x * 0.05));
  for (let x = 0; x < lw; x++) col(x, mid(x), C.midHill, C.midRim);
  // field in the foreground: dithered lit band at the top, sparse grass specks
  const ft = (x: number) => Math.round(fieldTop - 2 * Math.sin(x * 0.02 + 0.5));
  for (let x = 0; x < lw; x++) {
    const y0 = ft(x);
    col(x, y0, C.field);
    for (let y = y0; y < y0 + 6; y++)
      if ((1 - (y - y0) / 6) * 0.8 > BAYER[(y % 4) * 4 + (x % 4)]) (g.fillStyle = C.fieldLit), g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = C.fieldLit;
  for (let i = 0; i < lw * 0.6; i++) g.fillRect(Math.floor(r() * lw), fieldTop + 6 + Math.floor(r() * (lh - fieldTop - 6)), 1, 1);
  // the farmhouse stands past the fence, in the open strip below the panels
  const hx = Math.min(Math.round(lw * 0.8), lw - 48);
  const house = paintCottage(g, hx, gy - 7, r); // a few rows behind the path, so passing sheep read as nearer
  // bushes hugging the house, and a few along the field edge
  paintBush(g, hx - 6, gy - 6, 14, 8, 1);
  paintBush(g, hx + 51, gy - 6, 12, 7, 2);
  paintBush(g, hx + 13, gy - 6, 7, 4, 3);
  for (const [fx, w, h, s] of [[0.05, 18, 9, 4], [0.28, 14, 7, 5], [0.55, 16, 8, 6]]) paintBush(g, Math.round(lw * fx), fieldTop + 4, w, h, s);
  return {
    img: crisp(art, P),
    chimney: [house.chimney[0] * P, house.chimney[1] * P] as [number, number],
    warm: paintWarmth(house.windows, hx * P + 22 * P, (gy - 18) * P, P),
  };
}

/**
 * The farmhouse's light, added on top each frame with "lighter" blending: a wide amber halo, a pool of
 * light on the grass at its feet and a bright glow at each window. Baked once; drawn as one image.
 */
function paintWarmth(windows: [number, number, number, number][], cx: number, cy: number, P: number) {
  const R = P * 70;
  const c = cnv(R * 2, R * 2);
  const g = c.getContext("2d")!;
  const ox = cx - R, oy = cy - R;
  const halo = g.createRadialGradient(R, R, 0, R, R, R);
  halo.addColorStop(0, "rgba(226,166,92,0.2)");
  halo.addColorStop(0.5, "rgba(226,166,92,0.07)");
  halo.addColorStop(1, "rgba(226,166,92,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, R * 2, R * 2);
  g.save(); // light pooling on the grass: a flattened glow at the house's feet
  g.translate(R, R + P * 12);
  g.scale(1, 0.28);
  const pool = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.75);
  pool.addColorStop(0, "rgba(232,176,100,0.3)");
  pool.addColorStop(1, "rgba(232,176,100,0)");
  g.fillStyle = pool;
  g.fillRect(-R, -R, R * 2, R * 2);
  g.restore();
  for (const [x, y, w, h] of windows) {
    const gx = (x + w / 2) * P - ox, gy = (y + h / 2) * P - oy, rad = P * (10 + w * 2);
    const glow = g.createRadialGradient(gx, gy, 0, gx, gy, rad);
    glow.addColorStop(0, "rgba(244,196,120,0.45)");
    glow.addColorStop(1, "rgba(244,196,120,0)");
    g.fillStyle = glow;
    g.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
  }
  return { img: c, x: ox, y: oy };
}

/** The fence section the sheep hop: two posts, two rails. */
function paintFence(P: number) {
  const lo = cnv(FENCE_W, 11);
  const g = lo.getContext("2d")!;
  for (const x of [1, FENCE_W - 3]) {
    g.fillStyle = C.wood;
    g.fillRect(x, 0, 2, 11);
    g.fillStyle = C.woodLit;
    g.fillRect(x, 0, 2, 1);
    g.fillStyle = C.woodShade;
    g.fillRect(x + 1, 1, 1, 10);
  }
  for (const y of [3, 7]) {
    g.fillStyle = C.wood;
    g.fillRect(0, y, FENCE_W, 2);
    g.fillStyle = C.woodLit;
    g.fillRect(0, y, FENCE_W, 1);
  }
  return crisp(lo, P);
}

/* ---------- sheep path (pure function of age, so a still frame is just as valid) ---------- */

type SheepPose = { x: number; y: number; frame: "a" | "b" | "tuck" | "yawn"; squash: number; z: number };

function sheepAt(i: number, a: number, fenceX: number): SheepPose | null {
  const hopX = fenceX - 18; // take off here (left edge of the sheep)
  const pauseX = fenceX - 46;
  const pause = yawns(i) ? PAUSE_T : 0;
  const tPause = (pauseX - START_X) / SPEED;
  const tHop = (hopX - START_X) / SPEED + pause;
  const legs = (x: number) => (Math.floor((x - START_X) / 3) % 2 ? "b" : "a");
  if (a < 0) return null;
  if (a < tHop) {
    if (pause && a >= tPause && a < tPause + pause) {
      const p = a - tPause;
      return { x: pauseX, y: 0, frame: p > 0.5 && p < 1.4 ? "yawn" : "a", squash: 0, z: p };
    }
    const x = START_X + SPEED * (a >= tPause + pause ? a - pause : a);
    return { x, y: 0, frame: legs(x), squash: 0, z: -1 };
  }
  if (a < tHop + HOP_T) {
    const u = (a - tHop) / HOP_T;
    return { x: hopX + HOP_DX * u, y: HOP_H * 4 * u * (1 - u), frame: "tuck", squash: 0, z: -1 };
  }
  const b = a - tHop - HOP_T;
  const x = hopX + HOP_DX + SPEED * b;
  return { x, y: 0, frame: legs(x), squash: b < 0.22 ? Math.sin((b / 0.22) * Math.PI) : 0, z: -1 };
}
const apexAge = (i: number, fenceX: number) => (fenceX - 18 - START_X) / SPEED + (yawns(i) ? PAUSE_T : 0) + HOP_T / 2;

/* ---------- component ---------- */

export default function NightFarm({ running, dim }: { running: boolean; dim: "none" | "light" | "heavy" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(running);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    runningRef.current = running;
    kick.current();
  }, [running]);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d", { alpha: false })!; // opaque: the sky covers every pixel
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let font = "monospace";
    let raf = 0;
    let last = performance.now();
    let t = -1; // scene clock; set on first build so the first sheep clears the fence about a second in

    let W = 0, H = 0, P = 3, F = 6, lw = 0, gy = 0, fenceX = 0, maxAge = 0;
    let built = false;
    let sky: HTMLCanvasElement, land: HTMLCanvasElement, fence: HTMLCanvasElement;
    let chimney: [number, number] = [0, 0];
    let warm: { img: HTMLCanvasElement; x: number; y: number };
    let cloudsA: HTMLCanvasElement, cloudsB: HTMLCanvasElement;
    let sheep: Record<SheepPose["frame"], HTMLCanvasElement>;
    let twinkles: { x: number; y: number; period: number; ph: number }[] = [];
    let flies: { x: number; y: number; ph: number; period: number }[] = [];
    let tufts: number[] = [];

    const build = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(rect.width * dpr);
      H = Math.round(rect.height * dpr);
      cv.width = W;
      cv.height = H;
      P = Math.max(2, Math.round(H / 250)); // one art pixel, in device pixels
      lw = Math.ceil(W / P);
      const lh = Math.ceil(H / P);
      F = P * 2;
      const fw = Math.ceil(W / F); // scene width in foreground units
      const hz = Math.round(lh * 0.72);
      const fieldTop = Math.round(lh * 0.84);
      gy = Math.round(lh * 0.955);
      fenceX = Math.round(fw * 0.72);
      maxAge = apexAge(1, fenceX) + 2 + (fw + 20 - (fenceX + 16)) / SPEED + PAUSE_T;
      if (t < 0) t = apexAge(0, fenceX) - 1.2;
      const r = rng(5);

      const moonR = Math.max(8, Math.round(lh * 0.06));
      sky = crisp(paintSky(lw, lh, hz, Math.round(lw * 0.8), Math.round(lh * 0.17), moonR), P);
      const tileW = Math.max(lw, 320);
      cloudsA = crisp(paintClouds(tileW, Math.round(hz * 0.5), 23, 5), P);
      cloudsB = crisp(paintClouds(tileW, Math.round(hz * 0.35), 41, 4), P);
      ({ img: land, chimney, warm } = paintLand(lw, lh, hz, fieldTop, gy, P));
      fence = paintFence(F);
      const map = { w: C.wool, s: C.woolShade, f: C.face, m: C.mouth };
      const yawnBody = BODY.map((row, y) => (y === 5 ? row.slice(0, 14) + "m" + row.slice(15) : row));
      sheep = {
        a: sprite([...BODY, ...LEGS.a], map, F),
        b: sprite([...BODY, ...LEGS.b], map, F),
        tuck: sprite([...BODY, ...LEGS.tuck], map, F),
        yawn: sprite([...yawnBody, ...LEGS.a], map, F),
      };
      twinkles = Array.from({ length: 14 }, () => ({ x: r() * W, y: r() * hz * 0.6 * P, period: 4 + r() * 5, ph: r() * 6 }));
      flies = Array.from({ length: 7 }, () => ({ x: r() * W, y: (hz + 6 + r() * (gy - hz - 14)) * P, ph: r() * 6, period: 3 + r() * 3 }));
      tufts = Array.from({ length: Math.ceil(lw / 14) }, (_, i) => i * 14 + Math.floor(r() * 8));
      built = true;
    };

    const tiled = (img: HTMLCanvasElement, offset: number, y: number) => {
      const w = img.width;
      for (let x = -(((offset % w) + w) % w); x < W; x += w) g.drawImage(img, x, y);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const moving = runningRef.current && !reduce;
      if (moving) t += dt;
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;

      g.drawImage(sky, 0, 0);
      g.fillStyle = C.star;
      for (const s of twinkles) {
        g.globalAlpha = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin((t / s.period) * Math.PI * 2 + s.ph));
        g.fillRect(Math.round(s.x / P) * P, Math.round(s.y / P) * P, P, P);
      }
      g.globalAlpha = 0.8;
      tiled(cloudsA, t * P * 1.6, Math.round(H * 0.05));
      g.globalAlpha = 0.6;
      tiled(cloudsB, t * P * 0.9 + W * 0.4, Math.round(H * 0.24));
      g.globalAlpha = 1;
      g.drawImage(land, 0, 0);

      // the farmhouse light breathes very slowly, like a hearth (a 6 s swell)
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.85 + 0.15 * Math.sin((t / 6) * Math.PI * 2);
      g.drawImage(warm.img, warm.x, warm.y);
      g.globalCompositeOperation = "source-over";

      // chimney smoke: soft moonlit puffs that rise, lean away on a light breeze, swell and fade
      g.fillStyle = C.smoke;
      for (let i = 0; i < 9; i++) {
        const u = ((t / 8 + i / 9) % 1 + 1) % 1;
        const x = chimney[0] + u * P * 36 + Math.sin(u * 5 + i) * P;
        const y = chimney[1] - P * 18 * Math.sqrt(u);
        const s = P * (1.5 + u * 4);
        g.globalAlpha = 0.65 * (1 - u) * Math.min(1, u * 6);
        g.fillRect(x - s, y - s / 2, s * 2, s);
        g.fillRect(x - s / 2, y - s, s, s * 2);
      }
      g.globalAlpha = 1;

      // fireflies: slow wander, slow pulse
      g.fillStyle = C.firefly;
      for (const f of flies) {
        const a = Math.max(0, Math.sin((t / f.period) * Math.PI * 2 + f.ph));
        if (a < 0.05) continue;
        const x = f.x + Math.sin(t * 0.13 + f.ph) * P * 12;
        const y = f.y + Math.sin(t * 0.21 + f.ph * 2) * P * 4;
        g.globalAlpha = a * 0.25;
        g.fillRect(x - P, y - P, P * 3, P * 3);
        g.globalAlpha = a * 0.9;
        g.fillRect(x, y, P, P);
      }
      g.globalAlpha = 1;

      const groundY = gy * P;
      g.drawImage(fence, fenceX * F, groundY - fence.height);

      // the sheep: one every SPACING seconds, each a pure function of its age
      const iMax = Math.floor(t / SPACING);
      const iMin = Math.max(0, Math.ceil((t - maxAge) / SPACING));
      let count = iMin;
      g.font = `${P * 7}px ${font}`;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      for (let i = iMin; i <= iMax; i++) {
        const age = t - i * SPACING;
        if (age >= apexAge(i, fenceX)) count++;
        const s = sheepAt(i, age, fenceX);
        if (!s || s.x * F > W + F * 2) continue;
        const img = sheep[s.frame];
        const sx = 1 + 0.1 * s.squash, sy = 1 - 0.14 * s.squash; // squash on landing, anchored at the feet
        const w = img.width * sx, h = img.height * sy;
        const x = s.x * F - (w - img.width) / 2;
        const y = groundY - s.y * F - h;
        g.drawImage(img, x, y, w, h);
        if (s.z >= 0.6) {
          g.fillStyle = C.wool;
          for (let k = 0; k < 3; k++) {
            const q = s.z - 0.6 - k * 0.45;
            if (q < 0 || q > 1.2) continue;
            g.globalAlpha = 0.8 * (1 - q / 1.2);
            g.fillText("z", x + (15 + k * 3 + Math.sin(q * 3)) * F, y - (1 + q * 8) * F);
          }
          g.globalAlpha = 1;
        }
      }

      // grass along the path, swaying a fraction of a pixel
      g.fillStyle = C.grass;
      for (const tx of tufts) {
        const sway = Math.sin(t * 0.9 + tx * 0.15) * P * 0.6;
        for (let k = 0; k < 3; k++) {
          const bx = (tx + k * 2) * P;
          const bh = (2 + ((tx + k) % 2)) * P;
          g.fillRect(bx, groundY - P, P, P * 2);
          g.fillRect(bx + sway, groundY - bh, P, bh - P);
        }
      }

      // the count, small, in the corner
      g.fillStyle = C.moon;
      g.globalAlpha = 0.75;
      g.font = `${P * 7}px ${font}`;
      g.textAlign = "right";
      g.fillText(`${count} sheep`, W - P * 6, H - P * 4);
      g.globalAlpha = 1;

      if (moving) raf = requestAnimationFrame(frame);
    };

    kick.current = () => {
      if (!built) return;
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
      font = getComputedStyle(document.documentElement).getPropertyValue("--font-pixel").trim() || "monospace";
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
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bar-h)_+_var(--badge-h))] top-[var(--header-h)] z-0">
      <canvas ref={ref} data-scene data-running={running} className="h-full w-full [image-rendering:pixelated]" />
      {/* the scene stays still and recedes behind data, so nothing moves behind a number */}
      <div
        className={`absolute inset-0 bg-bg transition-opacity duration-700 ${dim === "heavy" ? "opacity-60" : dim === "light" ? "opacity-40" : "opacity-0"}`}
      />
    </div>
  );
}
