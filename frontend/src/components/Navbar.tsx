"use client";

import React, { useRef } from "react";
import { Activity, BarChart3, ShieldAlert, Upload, Zap } from "lucide-react";
import type { DemoCaseInfo, HealthStatus } from "@/lib/types";

interface NavbarProps {
  activeTab: "workbench" | "research";
  onTabChange: (tab: "workbench" | "research") => void;
  cases: DemoCaseInfo[];
  selectedCase: string;
  onSelectCase: (caseId: string) => void;
  noiseSnr: number | null;
  onNoiseChange: (snr: number | null) => void;
  onUploadCsv: (file: File) => void;
  health: HealthStatus | null;
  loading: boolean;
}

const NOISE_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Clean", value: null },
  { label: "10 dB", value: 10 },
  { label: "5 dB", value: 5 },
  { label: "0 dB", value: 0 },
];

export default function Navbar({
  activeTab,
  onTabChange,
  cases,
  selectedCase,
  onSelectCase,
  noiseSnr,
  onNoiseChange,
  onUploadCsv,
  health,
  loading,
}: NavbarProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className="bg-[#0B1F36] text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Brand Logo + Subtitle */}
        <div className="flex items-center gap-4">
          <img
            src="/logo-dark.svg"
            alt="CardioBreath Logo"
            className="h-10 w-auto select-none"
          />
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-500/15 border border-teal-400/30 text-[11px] font-medium text-teal-200">
            <span className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
            {health
              ? `${health.n_onnx_folds}-Fold ONNX CPU · T=${health.temperature.toFixed(2)}`
              : "Connecting API..."}
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center bg-slate-900/70 p-1 rounded-lg border border-slate-700/70">
          <button
            type="button"
            onClick={() => onTabChange("workbench")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === "workbench"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            Screening Workbench
          </button>
          <button
            type="button"
            onClick={() => onTabChange("research")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === "research"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Locked x01–x35 Benchmark &amp; Honesty
          </button>
        </nav>

        {/* Controls (Case selector, Upload CSV, Motion Noise Stress Test) */}
        {activeTab === "workbench" && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Held-Out Case Switcher */}
            <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-700 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Held-Out:
              </span>
              <select
                aria-label="Select held-out test night"
                value={selectedCase}
                disabled={loading}
                onChange={(e) => onSelectCase(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
              >
                {cases.map((c) => (
                  <option key={c.case_id} value={c.case_id} className="bg-slate-900 text-white">
                    {c.case_id} — {c.clinical_tier} ({c.duration_hours}h)
                  </option>
                ))}
                {selectedCase.startsWith("upload_") && (
                  <option value={selectedCase} className="bg-slate-900 text-teal-300">
                    Uploaded ECG ({selectedCase})
                  </option>
                )}
              </select>
            </div>

            {/* Upload CSV */}
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadCsv(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-slate-100 transition disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5 text-teal-300" />
              Upload CSV
            </button>

            {/* Motion Noise Stress-Test Selector */}
            <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-700 rounded-lg p-1">
              <span className="flex items-center gap-1 px-1.5 text-[11px] font-semibold text-amber-300">
                <Zap className="h-3 w-3" />
                Noise:
              </span>
              {NOISE_OPTIONS.map((opt) => {
                const active = noiseSnr === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={loading}
                    onClick={() => onNoiseChange(opt.value)}
                    className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                      active
                        ? opt.value === null
                          ? "bg-teal-600 text-white"
                          : "bg-amber-500 text-slate-950"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Persistent Non-Diagnostic Clinical Honesty Ribbon */}
      <div className="bg-slate-900/90 border-t border-slate-800/80 px-4 py-1 text-[11px] text-slate-300 flex items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-3.5 w-3.5 text-teal-400 shrink-0" />
        <span>
          <strong className="text-teal-300">Clinical Pre-Screening Prototype:</strong> Estimates
          minute-level apnea burden (<code className="text-teal-200">eAHI</code>) from single-lead
          ECG to prioritize PSG referrals — not a standalone diagnostic device.
        </span>
      </div>
    </header>
  );
}
