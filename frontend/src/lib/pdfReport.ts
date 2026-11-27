import { jsPDF } from "jspdf";
import { sentenceCase } from "@/components/ui";
import type { FullNightAnalysis } from "./types";

export interface ClinicalReportMeta {
  clinicalMode: boolean;
  interpretation?: string;
  patientNameOrId?: string;
  ageSex?: string;
  caseNumber?: string;
  clinicianName?: string;
  credentials?: string;
}

const DISCLAIMER =
  "Screening aid, not a diagnosis. Results support referral decisions and must be confirmed by polysomnography.";

export function downloadClinicalPdf(analysis: FullNightAnalysis, meta: ClinicalReportMeta): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;
  const footerTop = pageH - 22;

  const ink: [number, number, number] = [24, 28, 40];
  const muted: [number, number, number] = [80, 87, 110];
  const rule: [number, number, number] = [203, 210, 225];
  const accent: [number, number, number] = [31, 110, 88];

  let y = 18;
  const ensureSpace = (needed: number) => {
    if (y + needed <= footerTop) return;
    doc.addPage();
    y = 18;
  };

  // 1. Header Banner
  doc.setTextColor(...accent);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("CARDIOBREATH", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("Single-Lead ECG Sleep Apnea Screening System", pageW - margin, y, { align: "right" });
  y += 4;
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("CARDIOBREATH SCREENING REPORT", pageW / 2, y, { align: "center" });
  y += 6;

  // 2. Metadata Block
  doc.setDrawColor(...rule);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  const recordingLabel = analysis.case_id.startsWith("upload_") ? "Uploaded ECG" : analysis.case_id;
  const now = new Date();
  const dateIso = now.toISOString().slice(0, 10);
  const leftRows: [string, string][] = [
    ["Patient / Recording ID", meta.patientNameOrId?.trim() || recordingLabel],
    ["Exam", "Single-Lead Overnight ECG Apnea Screening"],
    ["Model", "CardioBreath 5-Fold ONNX"],
  ];
  if (meta.clinicalMode && meta.clinicianName?.trim()) {
    leftRows.push(["Clinician", meta.clinicianName.trim()]);
  }

  const rightRows: [string, string][] = [
    ["Analysis Date", now.toLocaleString()],
    ["Duration", `${analysis.duration_hours.toFixed(2)} h (${analysis.duration_minutes} min)`],
    ["Cutoff / Noise", `${analysis.threshold_used.toFixed(2)} / ${analysis.noise_snr_db === null ? "Clean" : `${analysis.noise_snr_db} dB`}`],
  ];
  if (meta.clinicalMode && (meta.ageSex?.trim() || meta.caseNumber?.trim())) {
    const extra = [meta.ageSex?.trim(), meta.caseNumber?.trim() ? `Case ${meta.caseNumber.trim()}` : ""].filter(Boolean).join(" · ");
    rightRows.push(["Demographics / Case", extra]);
  }

  const rowCount = Math.max(leftRows.length, rightRows.length);
  doc.setFontSize(9);
  for (let i = 0; i < rowCount; i++) {
    if (leftRows[i]) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...muted);
      doc.text(`${leftRows[i][0]}:`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...ink);
      doc.text(leftRows[i][1], margin + 38, y, { maxWidth: contentW / 2 - 40 });
    }
    if (rightRows[i]) {
      const rx = margin + contentW / 2 + 4;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...muted);
      doc.text(`${rightRows[i][0]}:`, rx, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...ink);
      doc.text(rightRows[i][1], rx + 34, y, { maxWidth: contentW / 2 - 38 });
    }
    y += 5.5;
  }

  y += 1.5;
  doc.setDrawColor(...rule);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // 3. Results Section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text("Results", margin, y);
  y += 6;

  const usablePct = Math.round(analysis.usable_ratio * 1000) / 10;
  const rhythmLabel = analysis.rhythm_irregular ? "Irregular rhythm, possible AFib" : "Regular heart rhythm";
  const resultRows: [string, string][] = [
    ["Estimated Apnea Burden (eAHI)", `${analysis.eahi_pred.toFixed(1)} apnea-min/hr`],
    ["90% Confidence Interval", `${analysis.eahi_ci90_low.toFixed(1)} to ${analysis.eahi_ci90_high.toFixed(1)}`],
    ["Severity Tier", analysis.severity_tier],
    ["Signal Quality", `${usablePct.toFixed(1)}% usable (${analysis.deferred_minutes} of ${analysis.duration_minutes} min deferred)`],
    ["Heart Rhythm Screen", rhythmLabel],
    ["Recommended Action", sentenceCase(analysis.triage_action)],
  ];

  doc.setFontSize(9.5);
  for (const [label, val] of resultRows) {
    ensureSpace(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...muted);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...ink);
    const wrapped = doc.splitTextToSize(val, contentW - 58);
    doc.text(wrapped, margin + 58, y);
    y += Math.max(5.5, wrapped.length * 4.5 + 1);
  }

  // Compact light-theme severity scale bar
  ensureSpace(22);
  y += 3;
  const scaleMax = 60;
  const barW = contentW;
  const barH = 3.5;
  const segs: [number, number, [number, number, number]][] = [
    [0, 5, [110, 168, 204]],
    [5, 15, [209, 180, 74]],
    [15, 30, [217, 134, 72]],
    [30, scaleMax, [201, 90, 108]],
  ];
  const toX = (v: number) => margin + (Math.min(scaleMax, Math.max(0, v)) / scaleMax) * barW;
  for (const [from, to, color] of segs) {
    doc.setFillColor(...color);
    doc.rect(toX(from), y, toX(to) - toX(from), barH, "F");
  }
  const ciX1 = toX(analysis.eahi_ci90_low);
  const ciX2 = Math.max(ciX1 + 1.5, toX(analysis.eahi_ci90_high));
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.5);
  doc.rect(ciX1, y - 1, ciX2 - ciX1, barH + 2);
  const predX = toX(analysis.eahi_pred);
  doc.setFillColor(...ink);
  doc.circle(predX, y + barH / 2, 1.4, "F");

  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  for (const tick of [0, 5, 15, 30, 60]) {
    doc.text(tick === 60 ? "60+" : String(tick), toX(tick), y + barH + 4.5, { align: tick === 0 ? "left" : tick === 60 ? "right" : "center" });
  }
  y += 12;

  // 4. Impression / Interpretation Section
  doc.setDrawColor(...rule);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text("Impression:", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  if (meta.clinicalMode) {
    const text = meta.interpretation?.trim();
    if (text) {
      const lines = doc.splitTextToSize(text, contentW);
      for (const line of lines) {
        ensureSpace(6);
        doc.text(line, margin, y);
        y += 4.8;
      }
    } else {
      ensureSpace(26);
      doc.setDrawColor(...rule);
      for (let i = 0; i < 4; i++) {
        y += 6;
        doc.line(margin, y, pageW - margin, y);
      }
    }

    ensureSpace(24);
    y += 12;
    const sigW = (contentW - 12) / 2;
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.35);
    doc.line(margin, y, margin + sigW, y);
    doc.line(margin + sigW + 12, y, pageW - margin, y);

    doc.setFontSize(8.5);
    doc.setTextColor(...muted);
    doc.text("Reviewed by / Clinician Signature", margin, y + 4.5);
    const credLine = [meta.clinicianName?.trim(), meta.credentials?.trim()].filter(Boolean).join(", ");
    doc.text(credLine ? `${credLine} · ${dateIso}` : "Name / Credentials / Date", margin + sigW + 12, y + 4.5);
  } else {
    const summary = `Automated screening summary: ${analysis.severity_tier} apnea burden (eAHI ${analysis.eahi_pred.toFixed(1)}, 90% CI ${analysis.eahi_ci90_low.toFixed(1)}-${analysis.eahi_ci90_high.toFixed(1)}). ${sentenceCase(analysis.triage_action)}.`;
    const lines = doc.splitTextToSize(summary, contentW);
    for (const line of lines) {
      ensureSpace(6);
      doc.text(line, margin, y);
      y += 4.8;
    }
  }

  // 5. Footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...rule);
    doc.setLineWidth(0.3);
    doc.line(margin, footerTop, pageW - margin, footerTop);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(DISCLAIMER, margin, footerTop + 4.5, { maxWidth: contentW });
    doc.text(`Generated ${now.toLocaleString()}`, margin, footerTop + 10);
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, footerTop + 10, { align: "right" });
  }

  const safeId = recordingLabel.replace(/[^A-Za-z0-9_-]/g, "_");
  doc.save(`CardioBreath_Report_${safeId}_${dateIso}.pdf`);
}
