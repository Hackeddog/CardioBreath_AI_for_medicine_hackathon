"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import Navbar, { PAGES } from "@/components/Navbar";
import Hero, { Evidence } from "@/components/Hero";
import NightDrive from "@/components/NightDrive";
import Tour from "@/components/Tour";
import TriageSummaryPanel from "@/components/TriageSummaryPanel";
import FullNightTimeline from "@/components/FullNightTimeline";
import SignalInspector from "@/components/SignalInspector";
import ResearchBenchmarkView from "@/components/ResearchBenchmarkView";
import { AnalysisProgress, NoticeBanner, friendlyError, type Notice } from "@/components/ui";
import { analyzeCase, fetchCases, fetchEvaluation, fetchHealth, inspectWindow, uploadCsvEcg } from "@/lib/api";
import type { DemoCaseInfo, EvaluationPayload, FullNightAnalysis, HealthStatus, WindowInspectorData } from "@/lib/types";

const NOISE_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Clean", value: null },
  { label: "10 dB", value: 10 },
  { label: "5 dB", value: 5 },
  { label: "0 dB", value: 0 },
];

const SLIDER_DEBOUNCE_MS = 300;
const P = Object.fromEntries(PAGES.map((p, i) => [p.id, i])) as Record<(typeof PAGES)[number]["id"], number>;

const keyOf = (caseId: string, thr: number | null, snr: number | null, base: boolean) =>
  JSON.stringify([caseId, thr, snr, base]);

const pageFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, "");
  const i = PAGES.findIndex((p) => p.id === id);
  return i < 0 ? 0 : i;
};

export default function HomePage() {
  const [page, setPage] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [scenePaused, setScenePaused] = useState(false);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [cases, setCases] = useState<DemoCaseInfo[]>([]);
  const [selectedCase, setSelectedCase] = useState<string>("");
  // null until /api/health returns the validated default, so the first night is requested once.
  const [threshold, setThreshold] = useState<number | null>(null);
  const [appliedThreshold, setAppliedThreshold] = useState<number | null>(null);
  const [defaultThreshold, setDefaultThreshold] = useState<number>(0.6);
  const [noiseSnr, setNoiseSnr] = useState<number | null>(null);
  const [compareBaseline, setCompareBaseline] = useState<boolean>(true);

  const [analysis, setAnalysis] = useState<FullNightAnalysis | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  const [windowData, setWindowData] = useState<WindowInspectorData | null>(null);
  const [heroEcg, setHeroEcg] = useState<WindowInspectorData | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationPayload | null>(null);

  const [loadingNight, setLoadingNight] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [loadingWindow, setLoadingWindow] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nightRequestId = useRef(0);
  const loadedKey = useRef("");
  const shownCase = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pageRefs = useRef<(HTMLElement | null)[]>([]);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  /* ---------- sideways navigation ---------- */

  // Each stage has its own URL (#/night), so links, reloads and the back button work.
  const go = useCallback((i: number) => {
    const n = Math.min(PAGES.length - 1, Math.max(0, i));
    window.location.hash = `/${PAGES[n].id}`;
  }, []);

  useEffect(() => {
    const sync = () => setPage(pageFromHash());
    sync();
    window.addEventListener("hashchange", sync);
    // The scene always starts running; only an OS-level reduced-motion setting starts it still.
    setScenePaused(matchMedia("(prefers-reduced-motion: reduce)").matches);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // If focus was inside the page that just slid away (now inert), hand it to the new page.
  useEffect(() => {
    const active = document.activeElement;
    const current = pageRefs.current[page];
    if (current && active && active !== document.body && !current.contains(active) && active.closest("[data-page]")) {
      current.focus({ preventScroll: true });
    }
  }, [page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, [role='slider'], [contenteditable='true']")) return;
      if (e.key === "ArrowRight") go(pageFromHash() + 1);
      else if (e.key === "ArrowLeft") go(pageFromHash() - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, tourOpen]);

  const toggleScene = () => setScenePaused((p) => !p);

  /* ---------- data (unchanged behaviour) ---------- */

  useEffect(() => {
    Promise.all([fetchHealth(), fetchCases(), fetchEvaluation()])
      .then(([h, c, ev]) => {
        setHealth(h);
        setThreshold(h.default_threshold);
        setAppliedThreshold(h.default_threshold);
        setDefaultThreshold(h.default_threshold);
        setCases(c);
        setEvaluation(ev);
        if (c.length > 0) setSelectedCase(c[0].case_id);
        else setLoadingNight(false);
      })
      .catch((err) => {
        setNotice(friendlyError(err, "analysis"));
        setLoadingNight(false);
      });
  }, []);

  // Slider moves update the label at once; the request waits until dragging pauses.
  useEffect(() => {
    if (threshold === null) return;
    const t = setTimeout(() => setAppliedThreshold(threshold), SLIDER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [threshold]);

  const runNightAnalysis = useCallback(async (caseId: string, thr: number, snr: number | null, compBase: boolean) => {
    const requestId = ++nightRequestId.current;
    setLoadingNight(true);
    setNotice(null);
    try {
      const res = await analyzeCase(caseId, { threshold: thr, inject_noise_snr_db: snr, compare_baseline: compBase });
      // A newer request (slider, case switch, upload) superseded this one: drop the late answer.
      if (requestId !== nightRequestId.current) return;
      loadedKey.current = keyOf(caseId, thr, snr, compBase);
      const newCase = res.case_id !== shownCase.current; // read before the ref moves; the updater runs later
      shownCase.current = res.case_id;
      setAnalysis(res);
      setSelectedMinute((prev) => (newCase || prev >= res.duration_minutes ? res.default_inspect_minute : prev));
    } catch (err) {
      if (requestId !== nightRequestId.current) return;
      setNotice(friendlyError(err, "analysis", caseId));
    } finally {
      if (requestId === nightRequestId.current) setLoadingNight(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedCase || appliedThreshold === null) return;
    if (keyOf(selectedCase, appliedThreshold, noiseSnr, compareBaseline) === loadedKey.current) return;
    runNightAnalysis(selectedCase, appliedThreshold, noiseSnr, compareBaseline);
  }, [selectedCase, appliedThreshold, noiseSnr, compareBaseline, runNightAnalysis]);

  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    const caseId = analysis.case_id;
    // Short delay so stepping the timeline with arrow keys doesn't fire a request per key press.
    const t = setTimeout(() => {
      setLoadingWindow(true);
      inspectWindow(caseId, selectedMinute, noiseSnr)
        .then((w) => {
          if (cancelled) return;
          setWindowData(w);
          if (!caseId.startsWith("upload_")) setHeroEcg((h) => h ?? w); // hero keeps the first sample strip
        })
        .catch((err) => !cancelled && setNotice(friendlyError(err, "window", caseId)))
        .finally(() => !cancelled && setLoadingWindow(false));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [analysis?.case_id, selectedMinute, noiseSnr]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUploadCsv = async (file: File) => {
    const requestId = ++nightRequestId.current; // an in-flight case analysis must not overwrite the upload result
    go(P.result);
    setLoadingNight(true);
    setUploading(true);
    setNotice(null);
    try {
      const res = await uploadCsvEcg(file, appliedThreshold ?? undefined);
      if (requestId !== nightRequestId.current) return;
      // Mark this result as loaded so selecting the upload doesn't analyze it a second time.
      loadedKey.current = keyOf(res.case_id, appliedThreshold, null, compareBaseline);
      shownCase.current = res.case_id;
      setNoiseSnr(null);
      setAnalysis(res);
      setSelectedCase(res.case_id);
      setSelectedMinute(res.default_inspect_minute);
    } catch (err) {
      if (requestId === nightRequestId.current) setNotice(friendlyError(err, "upload"));
    } finally {
      if (requestId === nightRequestId.current) {
        setLoadingNight(false);
        setUploading(false);
      }
    }
  };

  const trySample = () => {
    if (cases[0] && selectedCase !== cases[0].case_id) {
      setSelectedCase(cases[0].case_id);
      setNoiseSnr(null);
    } else if (cases[0] && !analysis && !loadingNight && appliedThreshold !== null) {
      runNightAnalysis(cases[0].case_id, appliedThreshold, noiseSnr, compareBaseline); // retry after a failed load
    }
    go(P.result);
  };

  const pickFile = () => fileRef.current?.click();
  const showProgress = loadingNight && (analysis === null || uploading);
  const sel = analysis?.timeline[selectedMinute];

  const needNight = (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <p className="font-pixel text-lg font-bold">No night loaded yet</p>
      <p className="mt-2 text-muted">{loadingNight ? "The sample night is still being analyzed." : "Load the sample night or upload an ECG first."}</p>
      <button type="button" onClick={() => go(P.result)} className="btn-primary mt-5">
        Go to the result
      </button>
    </div>
  );

  const pageBody: React.ReactNode[] = [
    /* start */
    <Hero
      key="start"
      analysis={analysis}
      ecg={heroEcg}
      onTrySample={trySample}
      onUpload={pickFile}
      onTour={() => setTourOpen(true)}
      onSeeNight={() => go(P.night)}
    />,

    /* result */
    <div key="result" className="grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-5">
        {showProgress && <AnalysisProgress />}
        {analysis && threshold !== null ? (
          <div className={showProgress ? "mt-6" : ""}>
            <TriageSummaryPanel
              analysis={analysis}
              threshold={threshold}
              defaultThreshold={defaultThreshold}
              onThresholdChange={setThreshold}
              compareBaseline={compareBaseline}
              onToggleBaseline={setCompareBaseline}
              updating={loadingNight}
            />
          </div>
        ) : (
          !loadingNight && (
            <div className="card p-8 text-center">
              <p className="font-pixel text-lg font-bold">No recording loaded</p>
              <p className="mt-2 text-muted">Load the sample night or upload a single-lead ECG as CSV.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {cases.length > 0 && (
                  <button type="button" onClick={trySample} className="btn-primary">
                    Try a sample night
                  </button>
                )}
                <button type="button" onClick={pickFile} className="btn-secondary">
                  Upload ECG
                </button>
              </div>
            </div>
          )
        )}
      </div>

      <div className="space-y-5 lg:col-span-7">
        <div>
          <h2 className="font-pixel text-2xl font-bold">Screen a night</h2>
          <p className="mt-2 max-w-[56ch] text-muted">
            Pick a held-out test night or upload your own recording. The result updates for whatever is loaded here.
          </p>
          <p className="mt-2 text-sm">
            <strong className="font-semibold">Screening aid, not a diagnosis.</strong>{" "}
            <span className="text-muted">Confirm with polysomnography.</span>
          </p>
        </div>
        <div id="toolbar" className="card space-y-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="case-select" className="text-sm font-medium">
              Recording
            </label>
            <select
              id="case-select"
              value={selectedCase}
              disabled={loadingNight}
              onChange={(e) => {
                setSelectedCase(e.target.value);
                setNoiseSnr(null);
              }}
              className="min-h-11 px-3 text-sm"
            >
              {cases.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id}, sleep-lab tier {c.clinical_tier} ({c.duration_hours} h)
                </option>
              ))}
              {selectedCase.startsWith("upload_") && <option value={selectedCase}>Uploaded ECG</option>}
            </select>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Simulated electrode noise</legend>
            <div className="flex flex-wrap gap-1 bg-surface-2 p-1">
              {NOISE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  disabled={loadingNight}
                  aria-pressed={noiseSnr === opt.value}
                  onClick={() => setNoiseSnr(opt.value)}
                  className={`min-h-11 flex-1 px-3 font-hud text-xl leading-none ${
                    noiseSnr === opt.value ? "bg-primary text-primary-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <button type="button" onClick={pickFile} disabled={uploading} aria-describedby="upload-hint" className="btn-secondary w-full">
              <Upload className="h-4 w-4" aria-hidden />
              Upload ECG (CSV)
            </button>
            <p id="upload-hint" className="text-sm text-muted">
              An <code>ecg</code> column in mV, optional <code>time</code> in seconds, at least 60 s.
            </p>
          </div>
        </div>

        {analysis && (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => go(P.night)} className="btn-primary">
              See the night ▶
            </button>
            <button type="button" onClick={() => go(P.signals)} className="btn-secondary">
              Inspect the signals
            </button>
          </div>
        )}
      </div>
    </div>,

    /* night */
    analysis ? (
      <div key="night" className="space-y-4">
        <FullNightTimeline analysis={analysis} selectedMinute={selectedMinute} onSelectMinute={setSelectedMinute} showBaseline={compareBaseline} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => go(P.signals)} className="btn-primary">
            Inspect {sel?.time_label ?? "this minute"} ▶
          </button>
          <p className="text-sm text-muted">Opens the ECG, breathing and heart rate around the selected minute.</p>
        </div>
      </div>
    ) : (
      <div key="night">{needNight}</div>
    ),

    /* signals */
    analysis ? (
      // Width follows the free height (chart aspect ~2.5:1), so the whole inspector fits without scrolling.
      <div key="signals" className="mx-auto w-full" style={{ maxWidth: "max(820px, calc((100dvh - var(--header-h) - var(--bar-h) - 260px) * 2.6))" }}>
        <SignalInspector
          data={windowData}
          loading={loadingWindow || loadingNight}
          threshold={analysis.threshold_used}
          controls={
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSelectedMinute((m) => Math.max(0, m - 1))} className="btn-secondary px-3" aria-label="Previous minute">
                ◀
              </button>
              <span className="min-w-[4.5rem] text-center font-hud text-2xl leading-none" aria-live="polite">
                {sel?.time_label ?? "…"}
              </span>
              <button
                type="button"
                onClick={() => setSelectedMinute((m) => Math.min(analysis.duration_minutes - 1, m + 1))}
                className="btn-secondary px-3"
                aria-label="Next minute"
              >
                ▶
              </button>
            </div>
          }
        />
      </div>
    ) : (
      <div key="signals">{needNight}</div>
    ),

    /* how */
    <Evidence key="how" evaluation={evaluation} onOpenResearch={() => go(P.research)} />,

    /* research */
    <ResearchBenchmarkView key="research" evaluation={evaluation} health={health} />,
  ];

  return (
    <div id="top" className="flex h-dvh flex-col overflow-hidden">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          pageRefs.current[page]?.focus();
        }}
        className="sr-only z-[80] bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Navbar
        page={page}
        onPage={go}
        health={health}
        onTour={() => setTourOpen(true)}
        scenePaused={scenePaused}
        onToggleScene={toggleScene}
      />
      <NightDrive page={page} paused={scenePaused} dim={page > 0} />

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload ECG CSV file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadCsv(file);
          e.target.value = "";
        }}
      />

      {notice && (
        <div className="fixed inset-x-4 top-[calc(var(--header-h)+12px)] z-50 mx-auto max-w-xl">
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        </div>
      )}

      <main
        id="main"
        className="relative z-10 min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => {
          const t = e.target as HTMLElement;
          swipe.current = e.pointerType === "touch" && !t.closest("[data-hscroll], input, [role='slider']") ? { x: e.clientX, y: e.clientY } : null;
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx < 0 ? 1 : -1));
        }}
      >
        <div className="stage-track flex h-full" style={{ transform: `translateX(${-page * 100}%)` }}>
          {PAGES.map((p, i) => (
            <section
              key={p.id}
              ref={(el) => {
                pageRefs.current[i] = el;
              }}
              data-page={p.id}
              aria-label={`${p.label}, stage ${i + 1} of ${PAGES.length}`}
              tabIndex={0} // a scrolling stage must be reachable by keyboard so it can be scrolled
              inert={i !== page}
              className="h-full w-full shrink-0 overflow-y-auto focus-visible:[outline-offset:-3px]"
            >
              <div className="mx-auto flex min-h-full max-w-[1280px] flex-col justify-center px-4 py-5 sm:px-6 sm:py-6">
                {pageBody[i]}
              </div>
            </section>
          ))}
        </div>
      </main>

      <nav
        aria-label="Stage navigation"
        className="fixed inset-x-0 bottom-0 z-40 h-[var(--bar-h)] border-t-[3px] border-line bg-[rgb(13_10_38/0.94)]"
      >
        <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
          <button type="button" onClick={() => go(page - 1)} disabled={page === 0} className="btn-secondary min-w-[6.5rem] px-3">
            ◀ <span className="hidden sm:inline">{page > 0 ? PAGES[page - 1].label : "Back"}</span>
            <span className="sm:hidden">Back</span>
          </button>
          <div className="flex flex-col items-center gap-1">
            <p className="font-hud text-xl leading-none text-gold" aria-live="polite">
              Stage {page + 1} of {PAGES.length} · {PAGES[page].label}
            </p>
            <div className="hidden gap-1 sm:flex">
              {PAGES.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Go to ${p.label}`}
                  aria-current={i === page ? "step" : undefined}
                  className="grid h-11 w-11 place-items-center"
                >
                  <span className={`block h-2.5 w-5 ${i === page ? "bg-primary" : i < page ? "bg-line-strong" : "bg-line"}`} />
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={page === PAGES.length - 1}
            className="btn-primary min-w-[6.5rem] px-3"
          >
            <span className="hidden sm:inline">{page < PAGES.length - 1 ? PAGES[page + 1].label : "Done"}</span>
            <span className="sm:hidden">Next</span> ▶
          </button>
        </div>
      </nav>

      <Tour open={tourOpen} onClose={() => setTourOpen(false)} onPage={go} />
    </div>
  );
}
