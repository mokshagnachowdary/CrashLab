# Deployment guide

> **Status:** Deployment configuration is maintained in this repository; confirm the live service state and current platform limits in Render. The blueprint configures the API and managed PostgreSQL. The frontend remains a separate Vercel deployment.

**Sizing note (measured):** the benchmark process peaked at ~1.3 GB RSS when generating 10,000-path pools with torch loaded. The API caps scenario generation at 5,000 paths. Select a service plan with sufficient memory; simulation files under `/data` can otherwise be lost on restart.

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
3. **Storage and sizing**: the API stores its data under `/data` and caps scenario generation at 5,000 paths. Review the Render service and database plans and configure persistent storage if required by the deployment; simulation files can otherwise be lost on restart.
4. During initial Blueprint setup, provide:
   - `ARTIFACT_URL`: the download URL for the model archive.
   - `CORS_ORIGINS`: the exact frontend origin, such as `https://<your-project>.vercel.app` (no trailing slash). Add custom domains as comma-separated origins without spaces.
   `DATABASE_URL` is wired to the Blueprint-managed PostgreSQL database.
5. **Vercel frontend**: import the same GitHub repository, set the project root to `frontend`, build command to `npm run build`, output directory to `dist`, and `VITE_API_URL` to the Render API origin, e.g. `https://crashlab-api.onrender.com`. Re-deploy the frontend after changing this build-time variable.
6. **Verify**: `GET https://<backend-host>/api/health` must report `models_loaded: true`; also check `/api/models/comparison`. In the deployed UI, run Story Mode end-to-end and open Portfolio Risk.
7. **Troubleshooting**: `models_loaded:false` means the artifact URL/archive is unavailable or malformed; CORS errors mean the origin does not exactly match; 429 means adjust `CRASHLAB_RATE_PER_MIN`; OOM means lower `CRASHLAB_MAX_SCENARIOS`. The database stores metadata while generated `.npz` files live on the persistent disk; provision backups and disk monitoring for production.
