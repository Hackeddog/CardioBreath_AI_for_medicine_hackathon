"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import TriageSummaryPanel from "@/components/TriageSummaryPanel";
import FullNightTimeline from "@/components/FullNightTimeline";
import SignalInspector from "@/components/SignalInspector";
import ResearchBenchmarkView from "@/components/ResearchBenchmarkView";
import {
  analyzeCase,
  fetchCases,
  fetchEvaluation,
  fetchHealth,
  inspectWindow,
  uploadCsvEcg,
} from "@/lib/api";
import type {
  DemoCaseInfo,
  EvaluationPayload,
  FullNightAnalysis,
  HealthStatus,
  WindowInspectorData,
} from "@/lib/types";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"workbench" | "research">("workbench");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [cases, setCases] = useState<DemoCaseInfo[]>([]);
  const [selectedCase, setSelectedCase] = useState<string>("x08");
  const [threshold, setThreshold] = useState<number>(0.6);
  const [defaultThreshold, setDefaultThreshold] = useState<number>(0.6);
  const [noiseSnr, setNoiseSnr] = useState<number | null>(null);
  const [compareBaseline, setCompareBaseline] = useState<boolean>(true);

  const [analysis, setAnalysis] = useState<FullNightAnalysis | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  const [windowData, setWindowData] = useState<WindowInspectorData | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationPayload | null>(null);

  const [loadingNight, setLoadingNight] = useState<boolean>(true);
  const [loadingWindow, setLoadingWindow] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const nightRequestId = useRef(0);

  // Initial bootstrap: health, held-out cases, evaluation report
  useEffect(() => {
    Promise.all([fetchHealth(), fetchCases(), fetchEvaluation()])
      .then(([h, c, ev]) => {
        setHealth(h);
        setThreshold(h.default_threshold);
        setDefaultThreshold(h.default_threshold);
        setCases(c);
        setEvaluation(ev);
        if (c.length > 0) setSelectedCase(c[0].case_id);
      })
      .catch((err: Error) => setErrorMsg(err.message));
  }, []);

  // Load full-night analysis whenever case, threshold, noise SNR, or baseline toggle changes
  const runNightAnalysis = useCallback(
    async (caseId: string, thr: number, snr: number | null, compBase: boolean) => {
      const requestId = ++nightRequestId.current;
      setLoadingNight(true);
      setErrorMsg(null);
      try {
        const res = await analyzeCase(caseId, {
          threshold: thr,
          inject_noise_snr_db: snr,
          compare_baseline: compBase,
        });
        // Slider drags fire many requests; drop any response that a newer request superseded
        if (requestId !== nightRequestId.current) return;
        setAnalysis(res);
        setSelectedMinute((prev) =>
          res.case_id !== analysis?.case_id || prev >= res.duration_minutes
            ? res.default_inspect_minute
            : prev
        );
      } catch (err) {
        if (requestId !== nightRequestId.current) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to analyze recording.");
      } finally {
        if (requestId === nightRequestId.current) setLoadingNight(false);
      }
    },
    [analysis?.case_id]
  );

  useEffect(() => {
    if (!selectedCase) return;
    runNightAnalysis(selectedCase, threshold, noiseSnr, compareBaseline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCase, threshold, noiseSnr, compareBaseline]);

  // Load 3-track Signal Inspector + 1D Grad-CAM whenever selected minute or noise changes
  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    setLoadingWindow(true);
    inspectWindow(analysis.case_id, selectedMinute, noiseSnr)
      .then((w) => {
        if (!cancelled) setWindowData(w);
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : "Window inspect failed.");
      })
      .finally(() => {
        if (!cancelled) setLoadingWindow(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysis?.case_id, selectedMinute, noiseSnr]);

  const handleUploadCsv = async (file: File) => {
    ++nightRequestId.current; // an in-flight case analysis must not overwrite the upload result
    setLoadingNight(true);
    setErrorMsg(null);
    try {
      const res = await uploadCsvEcg(file, threshold);
      setNoiseSnr(null);
      setAnalysis(res);
      setSelectedCase(res.case_id);
      setSelectedMinute(res.default_inspect_minute);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "CSV upload failed.");
    } finally {
      setLoadingNight(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F7FA]">
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        cases={cases}
        selectedCase={selectedCase}
        onSelectCase={(cid) => {
          setSelectedCase(cid);
          setNoiseSnr(null);
        }}
        noiseSnr={noiseSnr}
        onNoiseChange={setNoiseSnr}
        onUploadCsv={handleUploadCsv}
        health={health}
        loading={loadingNight}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5">
        {errorMsg && (
          <div className="mb-4 rounded-lg bg-rose-50 border border-rose-300 px-4 py-2.5 text-xs font-semibold text-rose-800">
            Error: {errorMsg}
          </div>
        )}

        {activeTab === "workbench" ? (
          analysis ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Triage Rail (4 cols) */}
              <div className="lg:col-span-4 xl:col-span-3">
                <TriageSummaryPanel
                  analysis={analysis}
                  threshold={threshold}
                  defaultThreshold={defaultThreshold}
                  onThresholdChange={setThreshold}
                  compareBaseline={compareBaseline}
                  onToggleBaseline={setCompareBaseline}
                />
              </div>

              {/* Right Interactive Signal Workspace (8 cols) */}
              <div className="lg:col-span-8 xl:col-span-9 space-y-4">
                <FullNightTimeline
                  analysis={analysis}
                  selectedMinute={selectedMinute}
                  onSelectMinute={setSelectedMinute}
                  showBaseline={compareBaseline}
                />
                <SignalInspector
                  data={windowData}
                  loading={loadingWindow || loadingNight}
                  threshold={threshold}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
              <div className="inline-block h-7 w-7 animate-spin rounded-full border-4 border-teal-600 border-r-transparent mb-3" />
              <div className="text-sm font-bold text-[#0F2942]">
                Running 5-Fold ONNX Cardiopulmonary Inference...
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Extracting ECG-Derived Respiration (EDR), RRI tachogram, and Signal Quality Index
              </div>
            </div>
          )
        ) : (
          <ResearchBenchmarkView evaluation={evaluation} />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-3 px-6 text-[11px] text-slate-500">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong>CardioBreath</strong> · AI for Medicine Hackathon 2026 (Open Health AI Collective)
          </span>
          <span>
            Dataset: PhysioNet Apnea-ECG v1.0.0 (Penzel et al., 2000) · Held-Out Test AUROC{" "}
            <strong className="text-teal-700">0.973</strong> · eAHI MAE{" "}
            <strong className="text-teal-700">3.27 /hr</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
