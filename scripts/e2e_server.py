"""Run the production app against disposable data for browser acceptance tests."""

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn
from backend.app import create_app

with TemporaryDirectory(prefix="glaze-e2e-") as directory:
    uvicorn.run(create_app(Path(directory)), host="127.0.0.1", port=8001, log_level="warning")
