import type {
  DemoCaseInfo,
  EvaluationPayload,
  FullNightAnalysis,
  HealthStatus,
  WindowInspectorData,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE !== undefined
    ? process.env.NEXT_PUBLIC_API_BASE
    : typeof window !== "undefined" && window.location.port === "3000"
      ? "http://localhost:7860"
      : "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(apiUrl("/api/health"));
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function fetchCases(): Promise<DemoCaseInfo[]> {
  const res = await fetch(apiUrl("/api/cases"));
  if (!res.ok) throw new Error(`Failed to fetch cases: ${res.status}`);
  return res.json();
}

export async function analyzeCase(
  caseId: string,
  options: {
    threshold?: number | null;
    inject_noise_snr_db?: number | null;
    compare_baseline?: boolean;
  } = {}
): Promise<FullNightAnalysis> {
  const res = await fetch(apiUrl(`/api/analyze/case/${encodeURIComponent(caseId)}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threshold: options.threshold ?? null,
      inject_noise_snr_db: options.inject_noise_snr_db ?? null,
      compare_baseline: options.compare_baseline ?? true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Analysis failed (${res.status}): ${err}`);
  }
  return res.json();
}

export async function inspectWindow(
  caseId: string,
  minuteIndex: number,
  injectNoiseSnrDb?: number | null
): Promise<WindowInspectorData> {
  const res = await fetch(apiUrl("/api/analyze/window"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id: caseId,
      minute_index: minuteIndex,
      inject_noise_snr_db: injectNoiseSnrDb ?? null,
    }),
  });
  if (!res.ok) throw new Error(`Window inspect failed: ${res.status}`);
  return res.json();
}

export async function uploadCsvEcg(file: File, threshold?: number): Promise<FullNightAnalysis> {
  const form = new FormData();
  form.append("file", file);
  const query = threshold !== undefined ? `?threshold=${encodeURIComponent(String(threshold))}` : "";
  const res = await fetch(apiUrl(`/api/analyze/upload${query}`), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed (${res.status}): ${err}`);
  }
  return res.json();
}

export async function fetchEvaluation(): Promise<EvaluationPayload> {
  const res = await fetch(apiUrl("/api/evaluation"));
  if (!res.ok) throw new Error(`Evaluation fetch failed: ${res.status}`);
  return res.json();
}
