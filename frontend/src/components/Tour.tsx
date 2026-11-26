"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PAGES, type PageId } from "./Navbar";

export interface TourStep {
  page: PageId;
  target: string; // CSS selector of the element to spotlight
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { page: "start", target: "#hero-title", title: "Welcome to CardioBreath", body: "It screens one night of single-lead ECG for sleep apnea. Move between stages with the arrow keys, a swipe, or the bar at the bottom." },
  { page: "result", target: "#triage-title-block", title: "The result comes first", body: "Severity, the estimated apnea burden (eAHI) and its 90% interval. If you read one thing, read this." },
  { page: "result", target: "#severity-scale", title: "Where the number sits", body: "eAHI on the clinical scale: mild from 5, moderate from 15, severe from 30. The box is the 90% interval." },
  { page: "result", target: "#toolbar", title: "Try other nights", body: "Switch to another held-out night, add simulated electrode noise to see the quality gate work, or upload your own ECG as CSV." },
  { page: "night", target: "#timeline-chart", title: "Every minute of the night", body: "Pink minutes are apnea, hatched ones were too noisy to score. Click a minute, or focus the chart and use the arrow keys." },
  { page: "signals", target: "#inspector-figure", title: "Why the model decided", body: "ECG, the breathing derived from it and heart rate around the chosen minute. The coloured strip shows where the model looked." },
  { page: "how", target: "#evidence", title: "How it works, and how well", body: "Four steps from ECG to triage, and results on 35 nights the model never saw during training." },
  { page: "research", target: "#research-title", title: "The full benchmark", body: "Baselines, ablations, calibration and the limitations. It is a screening aid, not a diagnosis." },
];

export const TOUR_PROMPT_KEY = "cardiobreath_tour_prompted_v1";

export function TourPrompt({ open, onStart, onSkip }: { open: boolean; onStart: () => void; onSkip: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onSkip();
    else if (e.key === "Tab") {
      const f = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, [tabindex='-1']") ?? [])];
      const i = f.indexOf(document.activeElement as HTMLElement);
      const n = f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length];
      n?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[rgb(8_10_20/0.72)] p-4" onClick={onSkip} onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-prompt-title"
        aria-describedby="tour-prompt-body"
        onClick={(e) => e.stopPropagation()}
        className="card-raised w-full max-w-md p-6"
      >
        <p className="text-sm font-medium leading-none text-gold">Quick walkthrough</p>
        <h2 id="tour-prompt-title" ref={headingRef} tabIndex={-1} className="mt-2 text-lg font-semibold tracking-tight">
          Take a quick tour of CardioBreath?
        </h2>
        <p id="tour-prompt-body" className="mt-2 text-sm text-muted">
          Eight short steps from single-lead ECG to apnea triage, timeline, and signal inspection.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <button type="button" onClick={onSkip} className="min-h-11 px-3 text-sm font-medium leading-none text-muted hover:text-ink">
            Skip for now
          </button>
          <button type="button" onClick={onStart} className="btn-primary px-4">
            Take the guided tour
          </button>
        </div>
      </div>
    </div>
  );
}

interface TourProps {
  open: boolean;
  onClose: () => void;
  onPage: (i: number) => void;
}

export default function Tour({ open, onClose, onPage }: TourProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const s = TOUR_STEPS[step];

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Go to the step's page, then measure its target once the slide has settled.
  const measure = useCallback(() => {
    const el = document.querySelector(s.target) as HTMLElement | null;
    if (!el) return setRect(null);
    el.scrollIntoView({ block: "center", behavior: "auto" });
    setRect(el.getBoundingClientRect());
  }, [s.target]);

  useLayoutEffect(() => {
    if (!open) return;
    onPage(PAGES.findIndex((p) => p.id === s.page));
    setRect(null);
    const t = setTimeout(measure, 650);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [open, step, s.page, measure, onPage]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step]);

  if (!open) return null;

  const last = step === TOUR_STEPS.length - 1;
  const next = () => (last ? onClose() : setStep(step + 1));
  const back = () => step > 0 && setStep(step - 1);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") back();
    else if (e.key === "Tab") {
      // keep focus inside the tour
      const f = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, [tabindex='-1']") ?? [])];
      const i = f.indexOf(document.activeElement as HTMLElement);
      const n = f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length];
      n?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const pad = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const boxW = Math.min(380, vw - 32);
  const below = rect ? rect.bottom + pad + 220 < vh : true;
  const top = rect ? (below ? rect.bottom + pad + 12 : Math.max(16, rect.top - pad - 12 - 200)) : vh / 2 - 110;
  const left = rect ? Math.min(Math.max(16, rect.left), vw - boxW - 16) : (vw - boxW) / 2;

  return (
    <div className="fixed inset-0 z-[70]" onKeyDown={onKeyDown}>
      {rect ? (
        <div
          className="pointer-events-none fixed transition-all duration-300"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 3px var(--gold), 0 0 0 9999px rgb(8 10 20 / 0.72)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgb(8_10_20/0.72)]" />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="card-raised fixed p-5"
        style={{ top, left, width: boxW }}
      >
        <p className="text-sm font-medium leading-none text-gold">
          Step {step + 1} of {TOUR_STEPS.length} · {PAGES.find((p) => p.id === s.page)?.label}
        </p>
        <h2 id="tour-title" ref={headingRef} tabIndex={-1} className="mt-2 text-lg font-semibold tracking-tight">
          {s.title}
        </h2>
        <p id="tour-body" className="mt-2 text-sm text-muted">
          {s.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-medium leading-none text-muted hover:text-ink">
            Skip tour
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={back} disabled={step === 0} className="btn-secondary px-3">
              Back
            </button>
            <button type="button" onClick={next} className="btn-primary px-4">
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
