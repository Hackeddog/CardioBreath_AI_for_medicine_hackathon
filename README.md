# CardioBreath

**Single-Lead ECG Sleep Apnea Screening via Cardiopulmonary Coupling & Deep Sequence Modeling**

> Submission repository for **AI for Medicine: A Global Student Hackathon on the Future of Care** (Open Health AI Collective · Devpost).

## Overview

CardioBreath turns an inexpensive overnight single-lead ECG (100 Hz) into an explainable, calibrated sleep apnea pre-screening triage tool by extracting **ECG-Derived Respiration (EDR)** and **RR-Interval (RRI)** cardiopulmonary coupling streams and classifying overnight sleep epochs with a **5-fold Deep Ensemble of Dual-Stream Multi-Scale 1D-CNN + BiGRU** models.

## Planned Architecture

- **Dataset:** PhysioNet Apnea-ECG Database v1.0.0 (35 training nights `a01–c10`, 35 locked held-out test nights `x01–x35` with Challenge 2000 `event-2-answers`, plus 8 respiratory-belt recordings for EDR validation).
- **Biomedical DSP:** Zero-phase bandpass (`0.5–40 Hz`), Pan-Tompkins / NeuroKit2 R-peak detection, ectopic RR filtering, 4 Hz cubic-spline EDR + RRI extraction, and a per-minute **Signal Quality Index (SQI)** abstention gate + non-sinus rhythm check.
- **Models & Baselines:** Classical `HRV + LightGBM` baseline, Raw 1-min ECG `1D-CNN` baseline, single-stream/context ablations, and `CardioBreathNet` (Dual-Stream Multi-Scale 1D-CNN + BiGRU + Temperature Scaling + 1D Grad-CAM + ONNX export).
- **Clinical Dashboard:** Next.js + FastAPI interactive full-night apnea timeline, synced 3-track signal inspector (ECG / EDR / RRI + Grad-CAM saliency), `eAHI` triage summary, and live motion-artifact stress-test toggle.

## Clinical Disclaimer

CardioBreath is a research and **pre-screening triage prototype** estimating minute-level apnea burden (`eAHI`). It is **not** a clinical diagnostic device and does not replace full in-lab polysomnography (PSG).

## Attribution

- Penzel T, Moody GB, Mark RG, Goldberger AL, Peter JH. *The Apnea-ECG Database.* Computers in Cardiology 2000; 27:255–258.
- Goldberger AL, et al. *PhysioBank, PhysioToolkit, and PhysioNet.* Circulation 2000; 101(23):e215–e220.

## AI Tool Disclosure

AI coding assistants (Antigravity / Gemini) were used to assist with repository scaffolding, boilerplate code generation, documentation drafting, and test authoring; all clinical design, modeling decisions, and evaluation runs are reviewed and verified by the team.
