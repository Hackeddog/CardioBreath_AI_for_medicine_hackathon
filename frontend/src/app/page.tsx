"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import Navbar, { type Tab } from "@/components/Navbar";
import Hero, { Evidence } from "@/components/Hero";
import TriageSummaryPanel from "@/components/TriageSummaryPanel";
import FullNightTimeline from "@/components/FullNightTimeline";
import SignalInspector from "@/components/SignalInspector";
import ResearchBenchmarkView from "@/components/ResearchBenchmarkView";
import { AnalysisProgress, NoticeBanner, WorkbenchSkeleton, friendlyError, type Notice } from "@/components/ui";
import { analyzeCase, fetchCases, fetchEvaluation, fetchHealth, inspectWindow, uploadCsvEcg } from "@/lib/api";
import type { DemoCaseInfo, EvaluationPayload, FullNightAnalysis, HealthStatus, WindowInspectorData } from "@/lib/types";

const NOISE_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Clean", value: null },
  { label: "10 dB", value: 10 },
  { label: "5 dB", value: 5 },
  { label: "0 dB", value: 0 },
];

const SLIDER_DEBOUNCE_MS = 300;

const keyOf = (caseId: string, thr: number | null, snr: number | null, base: boolean) =>
  JSON.stringify([caseId, thr, snr, base]);

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("workbench");
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
    setActiveTab("workbench");
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

  const goToWorkbench = () => {
    setActiveTab("workbench");
    if (cases[0] && selectedCase !== cases[0].case_id) {
      setSelectedCase(cases[0].case_id);
      setNoiseSnr(null);
    } else if (cases[0] && !analysis && !loadingNight && appliedThreshold !== null) {
      runNightAnalysis(cases[0].case_id, appliedThreshold, noiseSnr, compareBaseline); // retry after a failed load
    }
    requestAnimationFrame(() => {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("workbench")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
      document.getElementById("triage-title")?.focus({ preventScroll: true });
    });
  };

  const pickFile = () => fileRef.current?.click();
  const showProgress = loadingNight && (analysis === null || uploading);

  return (
    <div id="top" className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} health={health} />

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

      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 sm:px-6">
        {activeTab === "workbench" ? (
          <>
            <Hero analysis={analysis} ecg={heroEcg} onTrySample={goToWorkbench} onUpload={pickFile} />

            <section id="workbench" aria-label="Screening workbench" className="scroll-mt-20 space-y-6 border-t border-line pb-16 pt-10">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <h2 className="font-pixel text-2xl font-bold">Screen a night</h2>
                <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
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
                    className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm"
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
                  <div className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
                    {NOISE_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={loadingNight}
                        aria-pressed={noiseSnr === opt.value}
                        onClick={() => setNoiseSnr(opt.value)}
                        className={`min-h-11 px-3 font-hud text-xl leading-none ${
                          noiseSnr === opt.value ? "bg-primary text-primary-ink" : "text-muted hover:text-ink"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={pickFile}
                    disabled={uploading}
                    aria-describedby="upload-hint"
                    className="btn-secondary"
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    Upload ECG (CSV)
                  </button>
                  <p id="upload-hint" className="sr-only">
                    CSV with an ecg column in millivolts and an optional time column in seconds, at least 60 seconds long.
                  </p>
                </div>
                </div>
              </div>

              {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}
              {showProgress && <AnalysisProgress />}

              {analysis && threshold !== null ? (
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
                  <div className="lg:col-span-4">
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
                  <div className="space-y-6 lg:col-span-8">
                    <FullNightTimeline
                      analysis={analysis}
                      selectedMinute={selectedMinute}
                      onSelectMinute={setSelectedMinute}
                      showBaseline={compareBaseline}
                    />
                    <SignalInspector data={windowData} loading={loadingWindow || loadingNight} threshold={analysis.threshold_used} />
                  </div>
                </div>
              ) : loadingNight ? (
                <WorkbenchSkeleton />
              ) : (
                <div className="card p-10 text-center">
                  <p className="text-lg font-semibold">No recording loaded</p>
                  <p className="mt-1 text-muted">Load the sample night or upload a single-lead ECG as CSV.</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    {cases.length > 0 && (
                      <button type="button" onClick={goToWorkbench} className="btn-primary">
                        Try a sample night
                      </button>
                    )}
                    <button type="button" onClick={pickFile} className="btn-secondary">
                      Upload ECG
                    </button>
                  </div>
                </div>
              )}
            </section>

            <Evidence
              evaluation={evaluation}
              onOpenResearch={() => {
                setActiveTab("research");
                window.scrollTo({ top: 0 });
              }}
            />
          </>
        ) : (
          <ResearchBenchmarkView evaluation={evaluation} health={health} />
        )}
      </main>

      <footer className="border-t border-line py-6 text-sm text-muted">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 sm:flex-row sm:justify-between sm:px-6">
          <p>
            <strong className="font-semibold text-ink">Screening aid, not a diagnosis.</strong> CardioBreath, AI for
            Medicine Hackathon 2026.
          </p>
          <p>Data: PhysioNet Apnea-ECG v1.0.0 (Penzel et al., 2000)</p>
        </div>
      </footer>
    </div>
  );
}
