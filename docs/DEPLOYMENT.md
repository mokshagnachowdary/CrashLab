# Deployment guide

> **Status:** Deployment configuration is maintained in this repository; confirm the live service state and current platform limits in Render. The blueprint configures the API and managed PostgreSQL. The frontend remains a separate Vercel deployment.

**Simulation memory:** CPU CVAE decoding is split into batches of 256 paths by default (`CRASHLAB_SIM_BATCH_SIZE`), and the Render blueprint limits simulation execution to one concurrent job (`CRASHLAB_MAX_CONCURRENT_SIMULATIONS=1`, `CRASHLAB_WORKERS=1`). Memory is logged per job at start, generation, save, and summary phases. Re-profile on the target Render plan if changing the batch/concurrency settings or the 5,000-path API limit.

**Measured local profile:** with the committed CVAE, a 10-day conditioned NIFTY/USDINR case, and proposal pools of 2,000/10,000/20,000, process peak working set for 100/500/1,000 requested paths was about 377/597/901 MB before batching and 329/338/351 MB after. The after measurements include compressed simulation persistence as well as generation and summary, while the before measurements cover generation and summary only, so the comparison is conservative. The model-loaded baseline was about 314 MB. These Windows CPU measurements are not a guarantee of Render RSS; review the structured `simulation_memory` logs after deployment.

## Local (Docker Compose)
```bash
cp .env.example .env            # set POSTGRES_PASSWORD
cd backend && python -m crashlab.pipeline    # trains models into ../artifacts (~10 min CPU); real data used if reachable
cd .. && docker compose up --build            # UI http://localhost:8080  API http://localhost:8000/docs
```
Migrations run automatically at container start (`alembic upgrade head`).

## Cloud (Render API + Vercel frontend)
1. **GitHub**: use the repository's `main` branch. The workflow at `.github/workflows/ci.yml` runs backend and frontend checks on pushes and pull requests. Do not commit `.env`, `.venv/`, `data/`, or `node_modules/`. The required model artifacts in `artifacts/` are tracked and copied into the Docker image.
2. **Render**: create a Blueprint from the GitHub repository and use the included `render.yaml`. The Docker build context is the repository root, and the build fails if any required model artifact is missing. The image sets `CRASHLAB_ARTIFACT_DIR=/artifacts`; startup verifies the artifacts before migrations and application startup. `ARTIFACT_URL` remains an optional fallback for downloading a complete artifact bundle. Keep any signed URL private and set it only as the Render secret.
3. **Storage and sizing**: the API stores its data under `/data` and caps scenario generation at 5,000 paths. Keep `CRASHLAB_SIM_BATCH_SIZE=256` and `CRASHLAB_MAX_CONCURRENT_SIMULATIONS=1` on memory-constrained service plans. Lower the inference batch size before raising concurrency if the plan approaches its memory limit. Review the Render service and database plans and configure persistent storage if required; simulation files can otherwise be lost on restart.
4. During initial Blueprint setup, provide:
   - `ARTIFACT_URL`: the download URL for the model archive.
   - `CORS_ORIGINS`: the exact frontend origin, such as `https://<your-project>.vercel.app` (no trailing slash). Add custom domains as comma-separated origins without spaces.
   `DATABASE_URL` is wired to the Blueprint-managed PostgreSQL database.
5. **Frontend**: deploy `frontend/` as a Render Static Site (`npm run build`, publish directory `dist`) or use its Dockerfile. Set the build-time variable `VITE_API_URL=https://crashlab-backend.onrender.com` in the frontend service and trigger a new deploy; Vite embeds this value into the built assets. The Dockerfile and app also default to this backend origin. The Render blueprint sets backend `CORS_ORIGINS` to `https://crashlab-qrqs.onrender.com`; update it if the frontend origin changes. The value is the backend origin only—do not append `/api`.
6. **Verify**: `GET https://crashlab-backend.onrender.com/api/health` must report `models_loaded: true`; also check `/api/models/comparison`. Confirm frontend requests use `https://crashlab-backend.onrender.com/api/...`, then run Story Mode end-to-end and open Portfolio Risk.
7. **Troubleshooting**: `models_loaded:false` means the artifact URL/archive is unavailable or malformed; CORS errors mean the origin does not exactly match; 429 means adjust `CRASHLAB_RATE_PER_MIN`; OOM means lower `CRASHLAB_MAX_SCENARIOS`. The database stores metadata while generated `.npz` files live on `/data`; provision backups and disk monitoring for production.
