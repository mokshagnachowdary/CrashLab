"""Verify container model artifacts, optionally downloading a missing bundle."""
import logging
import os
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from .config import ARTIFACT_DIR

logger = logging.getLogger("crashlab.artifacts")
REQUIRED_ARTIFACTS = (
    "baselines.pkl",
    "cvae.pt",
    "manifest.json",
    "research_results.json",
    "returns.csv",
)


def _missing_artifacts() -> list[str]:
    return [
        name for name in REQUIRED_ARTIFACTS
        if not (ARTIFACT_DIR / name).is_file()
    ]


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    logger.info("Checking model artifacts in %s", ARTIFACT_DIR)
    missing = _missing_artifacts()
    if missing:
        url = os.getenv("ARTIFACT_URL")
        if not url:
            logger.error(
                "Missing required artifacts in %s: %s",
                ARTIFACT_DIR,
                ", ".join(missing),
            )
            raise SystemExit(1)

        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                archive_path = Path(temp_dir) / "artifacts.tgz"
                urllib.request.urlretrieve(url, archive_path)
                with tarfile.open(archive_path) as tar:
                    tar.extractall(ARTIFACT_DIR, filter="data")
        except (OSError, tarfile.TarError, urllib.error.URLError, ValueError) as exc:
            logger.error(
                "Artifact download or extraction failed (%s); the configured URL was not logged",
                type(exc).__name__,
            )
            raise SystemExit(1) from None

        missing = _missing_artifacts()
        if missing:
            logger.error(
                "Artifact bundle did not provide required files in %s: %s",
                ARTIFACT_DIR,
                ", ".join(missing),
            )
            raise SystemExit(1)

    logger.info("All required model artifacts are present in %s", ARTIFACT_DIR)


if __name__ == "__main__":
    main()
