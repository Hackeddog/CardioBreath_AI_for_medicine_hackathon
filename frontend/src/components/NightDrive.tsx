"use client";

import React, { useMemo } from "react";

/**
 * The background world: a neon city at night above a highway. Each stage of the app is the next stretch of
 * road, so the layers slide sideways at different speeds when the page changes (parallax), and cars keep
 * driving past. Decorative only: aria-hidden, no pointer events, paused by the header control or by
 * prefers-reduced-motion.
 */

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const WINDOW_COLORS = ["#2de2ff", "#ff3ea5", "#ffd84d", "#b48cff"];

function Skyline({ seed, height, base, lit, tall, signs }: { seed: number; height: number; base: string; lit: number; tall: number; signs?: boolean }) {
  const shapes = useMemo(() => {
    const r = rng(seed);
    const out: React.ReactNode[] = [];
    let x = 0;
    let i = 0;
    while (x < 2400) {
      const w = 40 + Math.floor(r() * 9) * 10;
      const h = Math.floor((0.35 + r() * 0.65) * tall);
      const y = height - h;
      out.push(<rect key={`b${i}`} x={x} y={y} width={w} height={h} fill={base} />);
      if (r() > 0.6) out.push(<rect key={`a${i}`} x={x + w / 2} y={y - 14} width="2" height="14" fill={base} />, <rect key={`al${i}`} x={x + w / 2 - 1} y={y - 16} width="4" height="3" fill="#ff3b5c" />);
      for (let wy = y + 10; wy < height - 8; wy += 14)
        for (let wx = x + 6; wx < x + w - 8; wx += 12)
          if (r() < lit) out.push(<rect key={`w${i}-${wx}-${wy}`} x={wx} y={wy} width="5" height="6" fill={WINDOW_COLORS[Math.floor(r() * 4)]} opacity={0.35 + r() * 0.5} />);
      x += w + Math.floor(r() * 3) * 6;
      i++;
    }
    return out;
  }, [seed, height, base, lit, tall]);

  return (
    <svg viewBox={`0 0 2400 ${height}`} preserveAspectRatio="xMinYMax slice" shapeRendering="crispEdges" className="h-full w-full">
      {shapes}
      {signs && (
        <g style={{ fontFamily: "var(--font-hud)" }}>
          <Sign x={210} y={height - 250} w={120} label="SLEEP LAB" color="#ff3ea5" />
          <Sign x={760} y={height - 200} w={84} label="OPEN 24H" color="#2de2ff" />
          <Sign x={1330} y={height - 270} w={44} label="♥" color="#ff3ea5" />
          <Sign x={1880} y={height - 190} w={84} label="MOTEL" color="#ffd84d" />
        </g>
      )}
    </svg>
  );
}

function Sign({ x, y, w, label, color }: { x: number; y: number; w: number; label: string; color: string }) {
  return (
    <g className="neon" style={{ color }}>
      <rect x={x} y={y} width={w} height="30" fill="#0d0a26" stroke={color} strokeWidth="3" />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" fontSize="22" fill={color}>
        {label}
      </text>
    </g>
  );
}

/* 32 x 12 pixel car, side view facing right. B body, D lower body, G glass, R roof, H headlight, T tail light, W wheel, C hubcap. */
const CAR = [
  "................................",
  "................................",
  "..........RRRRRRRRRRR...........",
  "........RRGGGGGG.GGGGGRR........",
  ".......RRGGGGGGG.GGGGGGRR.......",
  ".BBBBBBBBBBBBBBBBBBBBBBBBBBBBB..",
  "TTBBBBBBBBBBBBBBBBBBBBBBBBBBBHH.",
  ".BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.",
  ".DDDDDWWWWWDDDDDDDDDDDWWWWWDDDD.",
  ".....WWCCCWW.........WWCCCWW....",
  "......WWWWW...........WWWWW.....",
  "................................",
];

function Car({ color }: { color: string }) {
  const fill: Record<string, string> = { B: color, D: "#0b0820", G: "#7fe9ff", R: color, H: "#fff2b0", T: "#ff3b5c", W: "#05030f", C: "#6b62c9" };
  return (
    <svg viewBox="0 0 32 12" shapeRendering="crispEdges" className="h-full w-full">
      {CAR.flatMap((row, y) =>
        [...row].map((c, x) => (fill[c] ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill[c]} opacity={c === "G" ? 0.55 : 1} /> : null))
      )}
    </svg>
  );
}

const TRAFFIC = [
  { lane: "near", color: "#ff3ea5", dur: 9, delay: -2 },
  { lane: "near", color: "#5cf2b0", dur: 13, delay: -9 },
  { lane: "near", color: "#b48cff", dur: 11, delay: -5.5 },
  { lane: "far", color: "#2de2ff", dur: 15, delay: -3 },
  { lane: "far", color: "#ffd84d", dur: 12, delay: -10 },
  { lane: "far", color: "#ff6b8b", dur: 18, delay: -14 },
] as const;

export default function NightDrive({ page, paused, dim }: { page: number; paused: boolean; dim: boolean }) {
  const slide = (vw: number) => ({ transform: `translateX(${-page * vw}vw)` });
  return (
    <div
      aria-hidden
      className={`night-drive pointer-events-none fixed inset-x-0 bottom-[var(--bar-h)] top-[var(--header-h)] z-0 overflow-hidden ${paused ? "paused" : ""}`}
    >
      {/* horizon glow behind the city */}
      <div className="absolute inset-x-0 bottom-0 h-[70%]" style={{ background: "radial-gradient(60% 70% at 50% 100%, rgb(255 62 165 / 0.28), rgb(98 46 200 / 0.18) 45%, transparent 75%)" }} />

      <div className="parallax absolute bottom-[96px] left-0 h-[42%] w-[190vw] sm:bottom-[120px]" style={slide(4)}>
        <Skyline seed={7} height={360} base="#1b1350" lit={0.22} tall={340} signs />
      </div>
      <div className="parallax absolute bottom-[96px] left-0 h-[24%] w-[220vw] sm:bottom-[120px]" style={slide(10)}>
        <Skyline seed={21} height={200} base="#110b33" lit={0.1} tall={190} />
      </div>

      {/* street lamps along the far kerb */}
      <div className="lamps parallax absolute bottom-[96px] left-0 h-24 w-[260vw] sm:bottom-[120px]" style={slide(16)} />

      {/* the road */}
      <div className="road absolute inset-x-0 bottom-0 h-[96px] sm:h-[120px]">
        {TRAFFIC.map((c, i) => (
          <div
            key={i}
            className={`car ${c.lane === "near" ? "car-near" : "car-far"}`}
            // --park is where the car sits when motion is off; the animation offsets from it.
            style={{ animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s`, ["--park" as string]: `${8 + ((i * 29) % 80)}vw` }}
          >
            <span className="beam" />
            <Car color={c.color} />
          </div>
        ))}
      </div>

      {/* calmer scene behind data pages, so moving cars never compete with a chart */}
      <div className={`absolute inset-0 bg-[#0d0a26] transition-opacity duration-700 ${dim ? "opacity-60" : "opacity-0"}`} />
    </div>
  );
}
