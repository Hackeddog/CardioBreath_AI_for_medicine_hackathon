# Stage 1: Build Next.js Static Clinical Dashboard
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
ENV NEXT_PUBLIC_API_BASE=""
RUN npm run build

# Stage 2: Python 3.11 CPU Runtime (FastAPI + ONNX Runtime + LightGBM + Grad-CAM + Static UI)
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.5.1+cpu || \
    pip install --no-cache-dir torch
RUN pip install --no-cache-dir -r requirements.txt

COPY configs/ ./configs/
COPY src/ ./src/
COPY backend/ ./backend/
COPY demo_data/ ./demo_data/
COPY reports/ ./reports/
COPY artifacts/onnx/ ./artifacts/onnx/
COPY artifacts/checkpoints/lgbm/ ./artifacts/checkpoints/lgbm/
COPY artifacts/checkpoints/cardiobreath/cv_summary.json ./artifacts/checkpoints/cardiobreath/cv_summary.json
COPY artifacts/checkpoints/cardiobreath/fold_0.pt ./artifacts/checkpoints/cardiobreath/fold_0.pt
COPY --from=frontend-builder /app/frontend/out ./frontend/out

EXPOSE 7860
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860"]
