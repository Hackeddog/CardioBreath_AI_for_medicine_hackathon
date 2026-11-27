"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ClinicalReportMeta } from "@/lib/pdfReport";

interface PdfPromptModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (meta: Omit<ClinicalReportMeta, "clinicalMode">) => void;
}

const inputCls = "mt-1 w-full bg-surface-2 px-3 py-2 text-sm text-ink border border-line-strong focus:outline-none";

export default function PdfPromptModal({ open, onClose, onSubmit }: PdfPromptModalProps) {
  const [interpretation, setInterpretation] = useState("");
  const [patientNameOrId, setPatientNameOrId] = useState("");
  const [ageSex, setAgeSex] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [clinicianName, setClinicianName] = useState("");
  const [credentials, setCredentials] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      const f = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, textarea, input, summary, [tabindex='-1']") ?? [])];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const n = f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length];
      n?.focus();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ interpretation, patientNameOrId, ageSex, caseNumber, clinicianName, credentials });
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[rgb(8_10_20/0.72)] p-4" onClick={onClose} onKeyDown={onKeyDown}>
      <form
        ref={dialogRef as unknown as React.RefObject<HTMLFormElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-prompt-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card-raised max-h-[90dvh] w-full max-w-lg overflow-y-auto p-6"
      >
        <p className="text-sm font-medium leading-none text-gold">Clinical report</p>
        <h2 id="pdf-prompt-title" ref={headingRef} tabIndex={-1} className="mt-2 text-lg font-semibold tracking-tight">
          Add clinical interpretation
        </h2>
        <p className="mt-1 text-sm text-muted">
          Stays in memory for this PDF only. Leave blank to print ruled lines for manual sign-off.
        </p>

        <label htmlFor="pdf-impression" className="mt-4 block text-sm font-medium">
          Interpretation / Impression
        </label>
        <textarea
          id="pdf-impression"
          rows={4}
          value={interpretation}
          onChange={(e) => setInterpretation(e.target.value)}
          placeholder="Referral notes, clinical correlation, follow-up instructions..."
          className={inputCls}
        />

        <details className="mt-4 border-t border-line pt-3">
          <summary className="min-h-11 text-sm font-semibold text-muted hover:text-ink">
            Optional patient &amp; clinician details
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted">
              Patient Name / ID
              <input type="text" value={patientNameOrId} onChange={(e) => setPatientNameOrId(e.target.value)} className={inputCls} />
            </label>
            <label className="block text-xs font-medium text-muted">
              Age / Sex
              <input type="text" value={ageSex} onChange={(e) => setAgeSex(e.target.value)} className={inputCls} />
            </label>
            <label className="block text-xs font-medium text-muted">
              Case / Recording No.
              <input type="text" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} className={inputCls} />
            </label>
            <label className="block text-xs font-medium text-muted">
              Reviewing Clinician
              <input type="text" value={clinicianName} onChange={(e) => setClinicianName(e.target.value)} className={inputCls} />
            </label>
            <label className="block text-xs font-medium text-muted sm:col-span-2">
              Credentials / License No.
              <input type="text" value={credentials} onChange={(e) => setCredentials(e.target.value)} className={inputCls} />
            </label>
          </div>
        </details>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-11 px-3 text-sm font-medium leading-none text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" className="btn-primary px-4">
            Generate PDF
          </button>
        </div>
      </form>
    </div>
  );
}
