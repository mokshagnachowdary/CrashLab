"""Container start-up: if artifacts are missing and ARTIFACT_URL is set, download + unpack them (no secrets in the repo)."""
import os, tarfile, tempfile, urllib.request
from pathlib import Path
from .config import ARTIFACT_DIR

def main():
    if (ARTIFACT_DIR / "cvae.pt").exists(): return print("artifacts present")
    url = os.getenv("ARTIFACT_URL")
    if not url: return print("WARNING: no artifacts and ARTIFACT_URL unset; /api health will report models unavailable")
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".tgz") as f:
        urllib.request.urlretrieve(url, f.name)
        with tarfile.open(f.name) as t: t.extractall(ARTIFACT_DIR, filter="data")
    print("artifacts downloaded")
if __name__ == "__main__": main()
