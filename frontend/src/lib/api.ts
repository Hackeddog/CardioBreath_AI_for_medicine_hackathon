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

/** HTTP failure; `detail` is FastAPI's message (only 4xx carry user-facing text). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(`HTTP ${status}`);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // non-JSON body: keep detail empty rather than echo server internals
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export async function fetchHealth(): Promise<HealthStatus> {
  return json(await fetch(apiUrl("/api/health")));
}

export async function fetchCases(): Promise<DemoCaseInfo[]> {
  return json(await fetch(apiUrl("/api/cases")));
}

export async function analyzeCase(
  caseId: string,
  options: {
    threshold?: number | null;
    inject_noise_snr_db?: number | null;
    compare_baseline?: boolean;
    signal?: AbortSignal;
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
    signal: options.signal,
  });
  return json(res);
}

export async function inspectWindow(
  caseId: string,
  minuteIndex: number,
  injectNoiseSnrDb?: number | null,
  signal?: AbortSignal
): Promise<WindowInspectorData> {
  const res = await fetch(apiUrl("/api/analyze/window"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id: caseId,
      minute_index: minuteIndex,
      inject_noise_snr_db: injectNoiseSnrDb ?? null,
    }),
    signal,
  });
  return json(res);
}

export async function uploadCsvEcg(file: File, threshold?: number, signal?: AbortSignal): Promise<FullNightAnalysis> {
  const form = new FormData();
  form.append("file", file);
  const query = threshold !== undefined ? `?threshold=${encodeURIComponent(String(threshold))}` : "";
  return json(await fetch(apiUrl(`/api/analyze/upload${query}`), { method: "POST", body: form, signal }));
}

export async function fetchEvaluation(): Promise<EvaluationPayload> {
  return json(await fetch(apiUrl("/api/evaluation")));
}
