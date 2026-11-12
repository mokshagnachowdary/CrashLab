FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt
COPY backend/ .
COPY artifacts/ /artifacts/
ENV PYTHONPATH=/app \
    CRASHLAB_HOME=/app \
    CRASHLAB_ARTIFACT_DIR=/artifacts \
    CRASHLAB_DATA_DIR=/data \
    PYTHONUNBUFFERED=1
RUN set -eu; \
    missing=0; \
    for artifact in baselines.pkl cvae.pt manifest.json research_results.json returns.csv; do \
        if [ ! -s "${CRASHLAB_ARTIFACT_DIR}/${artifact}" ]; then \
            printf 'Missing required artifact: %s/%s\n' "${CRASHLAB_ARTIFACT_DIR}" "${artifact}" >&2; \
            missing=1; \
        fi; \
    done; \
    if [ "${missing}" -ne 0 ]; then exit 1; fi; \
    printf 'Verified required model artifacts in %s\n' "${CRASHLAB_ARTIFACT_DIR}"
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request as u;u.urlopen('http://localhost:8000/api/health')"
CMD ["sh", "-c", "python -m crashlab.fetch_artifacts && alembic upgrade head && uvicorn crashlab.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
