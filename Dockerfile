FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4 \
    HOME=/tmp \
    MPLCONFIGDIR=/tmp/matplotlib

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple torch && \
    pip install --no-cache-dir -r requirements.txt

COPY configs/ ./configs/
COPY src/ ./src/
COPY backend/ ./backend/
COPY demo_data/ ./demo_data/
COPY reports/ ./reports/
COPY artifacts/onnx/ ./artifacts/onnx/
COPY artifacts/checkpoints/lgbm/ ./artifacts/checkpoints/lgbm/
COPY artifacts/checkpoints/cardiobreath/cv_summary.json ./artifacts/checkpoints/cardiobreath/cv_summary.json
COPY artifacts/checkpoints/cardiobreath/fold_0.pt ./artifacts/checkpoints/cardiobreath/fold_0.pt

RUN chmod -R a+rX /app

EXPOSE 7860
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
