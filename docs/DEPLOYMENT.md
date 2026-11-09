# Deployment guide

> **Status: prepared, not deployed.** No GitHub remote has been added and no code has been pushed. The Render blueprint provisions the API, managed PostgreSQL, and persistent storage for simulation arrays. The frontend remains a separate Vercel deployment. Review current platform pricing and limits before creating resources.

**Sizing note (measured):** the benchmark process peaked at ~1.3 GB RSS when generating 10,000-path pools with torch loaded. The Render API is configured with a 1 CPU / 2 GB instance, one worker, and a 5,000-scenario cap. The persistent disk and database are paid resources; simulation files can otherwise be lost on restart.

## Local (Docker Compose)
```bash
cp .env.example .env            # set POSTGRES_PASSWORD
cd backend && python -m crashlab.pipeline    # trains models into ../artifacts (~10 min CPU); real data used if reachable
cd .. && docker compose up --build            # UI http://localhost:8080  API http://localhost:8000/docs
```
Migrations run automatically at container start (`alembic upgrade head`).

## Cloud (Render API + Vercel frontend)
1. **GitHub**: create an empty repository, then follow GitHub's setup instructions to add it as `origin` and push the `main` branch. Choose public/private access deliberately. The workflow at `.github/workflows/ci.yml` runs backend and frontend checks on pushes and pull requests. Do not commit `.env`, `.venv/`, `data/`, `node_modules/`, or model weights (`artifacts/*.pt`, `*.pkl`, `*.pth`, `*.ckpt`).
2. **Model artifacts**: create `artifacts.tgz` with `tar czf artifacts.tgz -C artifacts cvae.pt baselines.pkl manifest.json research_results.json returns.csv benchmarks.json`, then upload it to a location that Render can download without interactive authentication (for example, a GitHub Release asset or object storage). Keep any signed URL private and set it only as the Render `ARTIFACT_URL` secret.
3. **Render**: create a Blueprint from the GitHub repository and use the included `render.yaml`. It creates the API, managed PostgreSQL, and a 2 GB persistent disk mounted at `/data`. The API uses a 1 CPU / 2 GB instance, caps scenario generation at 5,000 paths, and runs one worker to keep memory use within the measured range. These are paid resources; review Render's current prices before confirming.
4. During initial Blueprint setup, provide:
   - `ARTIFACT_URL`: the download URL for the model archive.
   - `CORS_ORIGINS`: the exact frontend origin, such as `https://<your-project>.vercel.app` (no trailing slash). Add custom domains as comma-separated origins without spaces.
   `DATABASE_URL` is wired to the Blueprint-managed PostgreSQL database.
5. **Vercel frontend**: import the same GitHub repository, set the project root to `frontend`, build command to `npm run build`, output directory to `dist`, and `VITE_API_URL` to the Render API origin, e.g. `https://crashlab-api.onrender.com`. Re-deploy the frontend after changing this build-time variable.
6. **Verify**: `GET https://<backend-host>/api/health` must report `models_loaded: true`; also check `/api/models/comparison`. In the deployed UI, run Story Mode end-to-end and open Portfolio Risk.
7. **Troubleshooting**: `models_loaded:false` means the artifact URL/archive is unavailable or malformed; CORS errors mean the origin does not exactly match; 429 means adjust `CRASHLAB_RATE_PER_MIN`; OOM means lower `CRASHLAB_MAX_SCENARIOS`. The database stores metadata while generated `.npz` files live on the persistent disk; provision backups and disk monitoring for production.
