FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt
COPY backend/ .
# Model artifacts are NOT baked into git; mount ./artifacts or set ARTIFACT_URL (see docs/DEPLOYMENT.md)
ENV CRASHLAB_HOME=/app CRASHLAB_ARTIFACT_DIR=/artifacts CRASHLAB_DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request as u;u.urlopen('http://localhost:8000/api/health')"
CMD ["sh", "-c", "python -m crashlab.fetch_artifacts && alembic upgrade head && uvicorn crashlab.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
