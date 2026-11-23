# CardioBreath

**Single-Lead ECG Sleep Apnea Screening via Cardiopulmonary Coupling & Deep Sequence Modeling**

> Built for **AI for Medicine: A Global Student Hackathon on the Future of Care** (Open Health AI Collective · Devpost).

---

## 1. The Clinical Problem & Target Beneficiary

Nearly **80% of Obstructive Sleep Apnea (OSA)** goes undiagnosed because gold-standard in-lab polysomnography (PSG) costs **$1,000–$3,000+**, requires 20+ wired sensors, and carries months-long waitlists.

**CardioBreath** enables **primary-care clinics, rural health workers, and home-monitoring patients** to pre-screen for sleep apnea using a low-cost overnight single-lead ECG (100 Hz). By extracting **ECG-Derived Respiration (EDR)** and **Cyclic Variation of Heart Rate (RRI)** directly from the heartbeat, CardioBreath scores every minute of sleep with a calibrated **5-fold Deep Ensemble** and estimates clinical apnea burden (**`eAHI`, events/hr**) in under **1.5 seconds on CPU**.

---

## 2. Technical Architecture

1. **Biomedical DSP Front-End (`src/dsp.py`):**
   * Zero-phase 4th-order Butterworth bandpass (`0.5–40 Hz`), Pan-Tompkins / NeuroKit2 R-peak detection, and physiological ectopic RR rejection (`0.30–2.00 s`, local median filter).
   * Cubic-spline 4 Hz extraction of **EDR** (R-peak amplitude envelope, `0.08–0.60 Hz`) and **RRI** tachogram with per-recording robust median/MAD z-scoring.
   * **Physical EDR Validation (`scripts/preprocess.py`):** Validated directly against simultaneous ground-truth respiratory belts (`Resp C`) on all 8 multi-sensor Apnea-ECG recordings (`a01r–a04r`, `b01r`, `c01r–c03r`), achieving **0.94 breaths/min MAE** (`0.00 bpm` exact match on 4 of 8 nights) and **0.705** mean best-60s waveform correlation.
   * **Signal Quality Index (SQI) Gate + Rhythm Check:** Rejects flatlines, saturation spikes, and severe EMG/motion noise (`5–30 Hz` QRS vs. `32–48 Hz` EMG gating) so degraded epochs abstain cleanly rather than hallucinating apnea, plus flags suspected non-sinus/AFib rhythm.
2. **Deep Learning Core (`src/models.py`):**
   * **CardioBreathNet:** Dual modality stems (`EDR` + `RRI`, 5-min window = `2 × 1200` @ 4 Hz) → **Multi-Scale 1D-CNN** (`5s / 15s / 31s` parallel kernels + Squeeze-and-Excitation) → **2-Layer Bidirectional GRU** → **Temporal Attention Pooling**.
   * **Uncertainty & Calibration (`src/calibration.py`):** Trained across **5 strict subject-disjoint folds** (`configs/folds.json`, `seed=42`). Out-of-fold L-BFGS-B **Temperature Scaling** (`T = 1.835`, CV-locked threshold `0.60`) + 5-fold Deep Ensemble yielding 90% `eAHI` confidence intervals.
   * **Explainability & Edge Deployment:** Live **1D Grad-CAM** saliency overlays + 5-fold **ONNX Runtime CPU** export (`1.67 MB`/fold, `max_diff <= 7e-7` vs. PyTorch).

---

## 3. Held-Out Evaluation (`x01–x35`, 35 Unseen Nights, 17,248 Minutes)

All hyperparameters, thresholds, and calibration temperatures were selected strictly via **5-fold subject-disjoint CV** on the 35 learning nights (`a01–c10`). The official held-out test set (`x01–x35`, Challenge 2000 `event-2-answers`) was locked until a single final evaluation run (`python evaluate.py --split test --seed 42`).

| Model | AUROC (95% CI) | AUPRC | Accuracy | Sens | Spec | F1 | eAHI MAE (events/hr) | eAHI Pearson *r* | Screen Sens (`>=5`) | ECE |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline 1: HRV + LightGBM** | 0.909 [0.879, 0.936] | 0.853 | 0.790 | 0.914 | 0.712 | 0.770 | 10.33 [7.70, 13.39] | 0.863 | 1.000 | 0.089 |
| **Baseline 2: Raw 1-min ECG CNN** | 0.777 [0.663, 0.869] | 0.727 | 0.685 | 0.718 | 0.664 | 0.637 | 17.81 [12.87, 23.19] | 0.372 | 0.957 | 0.144 |
| **Ablation A: RRI-Only (5-min)** | 0.965 [0.947, 0.978] | 0.951 | 0.902 | 0.904 | 0.901 | 0.876 | 3.97 [2.81, 5.33] | 0.963 | 1.000 | 0.064 |
| **Ablation B: EDR-Only (5-min)** | 0.900 [0.850, 0.938] | 0.878 | 0.832 | 0.774 | 0.868 | 0.779 | 6.53 [4.24, 8.88] | 0.876 | 0.957 | 0.048 |
| **Ablation C: Dual-Stream (1-min)** | 0.931 [0.905, 0.955] | 0.894 | 0.851 | 0.869 | 0.839 | 0.817 | 5.61 [3.92, 7.51] | 0.933 | 1.000 | 0.100 |
| **CardioBreath (Dual-Stream 5-Fold)** | **0.973 [0.961, 0.982]** | **0.958** | **0.909** | 0.832 | **0.958** | **0.876** | **3.27 [1.75, 5.01]** | **0.965** | **1.000** | **0.052** |

* **Key Takeaways:** Physics-guided Dual-Stream cardiopulmonary modeling beats end-to-end raw ECG CNN by **+0.196 AUROC** (`-81.6%` `eAHI` MAE) and beats classical HRV+LightGBM by **+11.9 points accuracy** (`-68.3%` `eAHI` MAE), achieving **100% patient-level screening sensitivity** (`eAHI >= 5`) with **95.8% per-minute specificity**.

---

## 4. Clinical Honesty: Who Benefits, Who Could Be Harmed & Failure Analysis

* **Who Benefits:** Undiagnosed adults in rural or under-resourced settings facing high PSG costs/waitlists, and sleep clinics triaging referral backlogs.
* **Who Could Be Harmed & Mitigations:**
  1. **Arrhythmia / AFib Patients:** Atrial fibrillation or frequent ectopy disrupts RRI independent of breathing. *Mitigation:* Built-in non-sinus rhythm screen warns clinicians to bypass ECG screening for full PSG.
  2. **Minute-Level `eAHI` vs. True PSG Event-Count AHI:** PhysioNet Apnea-ECG provides 1-minute labels (`A`/`N`), so `eAHI` estimates apnea-minutes/hr rather than exact discrete hypopnea/apnea event counts. *Mitigation:* Explicitly labeled as **Estimated Apnea Burden (`eAHI`)** and scoped strictly as pre-screening triage—never autonomous diagnosis.
  3. **False Negatives vs. False Positives (Honest Held-Out Error Analysis — `reports/figures/failure_cases_test.png`):**
     * *Under-predicted night (`x25`, True `eAHI=34.2` vs. Pred `12.0`):* CardioBreath visibly detected all 4 overnight apnea clusters (`p` rose from `~0.08` to `0.45–0.75`), but the CV-locked F1 cutoff (`0.60`) sliced through mid-confidence epochs. Crucially, `x25` was still triaged positive (`12.0 >= 5`) for PSG referral, and our UI provides a clinician sensitivity slider.
     * *High-confidence false positive (`x30 @ min 244`, `p=0.98`):* Pronounced cyclic RRI swings occurred in a transitional minute immediately flanking severe apnea episodes.
  4. **Cohort & Hardware Shift:** Trained on hospital-grade 100 Hz ECGs (adult German sleep-lab cohort); noisy consumer wrist wearables and pediatric/elderly cohorts require external validation.

### What We Would Do With Another Month
1. **Cross-Hospital External Validation:** Zero-shot and domain-adapted testing on **UCDDB** (Ireland), **SHHS**, and **MESA** multi-ethnic cohorts.
2. **Central vs. Obstructive Apnea Subtyping:** Extend the head to separate obstructive vs. central sleep apnea patterns using EDR effort collapse vs. preservation.
3. **Prospective Patch Pilot:** Validate on low-cost single-lead wearable ECG patches with real overnight motion artifacts and SpO2 spot checks.

---

## 5. Reproducibility & Quickstart

### Run the Live Clinical Dashboard Locally
```bash
# 1. Backend API (FastAPI + 5-fold ONNX + LightGBM + 1D Grad-CAM)
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 7860

# 2. Frontend UI (in a second terminal)
cd frontend && npm install && npm run dev
```

### Reproduce Full Training & Locked Held-Out Evaluation From Scratch
```bash
python scripts/download_data.py              # Downloads PhysioNet Apnea-ECG + event-2-answers
python scripts/preprocess.py                 # Runs DSP, caches tensors & 8-night EDR belt validation
python train.py --model all --seed 42        # Trains all baselines, ablations & CardioBreathNet (or use notebooks/train_colab.ipynb on T4 GPU)
python scripts/export_onnx.py --model cardiobreath --quantize
python evaluate.py --split test --seed 42    # Regenerates reports/benchmark_table_test.md & all figures
pytest tests/ -v                             # Runs full DSP, ML, calibration, ONNX, metrics & API test suite
```

### Single-Container Deployment (Hugging Face Spaces Docker SDK)
```bash
docker build -t cardiobreath .
docker run -p 7860:7860 cardiobreath
```

---

## 6. Attribution & AI Tool Disclosure

* **Dataset Attribution:** Penzel T, Moody GB, Mark RG, Goldberger AL, Peter JH. *The Apnea-ECG Database.* Computers in Cardiology 2000; 27:255–258. Goldberger AL et al. *PhysioBank, PhysioToolkit, and PhysioNet.* Circulation 2000; 101(23):e215–e220.
* **Open-Source Libraries:** PyTorch, ONNX Runtime, WFDB, NeuroKit2, SciPy, LightGBM, scikit-learn, FastAPI, Next.js, Tailwind CSS, Recharts.
* **AI Tool Disclosure:** AI coding assistants (Antigravity / Gemini) were used to assist with code scaffolding, DSP/PyTorch implementation, UI components, documentation drafting, and automated test authoring; all modeling choices, training runs, and held-out evaluations were executed and verified by the team.
