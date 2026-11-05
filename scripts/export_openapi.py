"""Export the API contract; regenerate frontend types after running this command."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.app import app

(ROOT / "openapi.json").write_text(json.dumps(app.openapi(), indent=2) + "\n")
print("Exported openapi.json")
