# Contributing

Use Python 3.12–3.14, uv, and Node.js 24. From a checkout:

```sh
uv sync --locked
npm ci --prefix frontend
npm run build --prefix frontend
uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Open <http://localhost:8000>. For hot reload, run `npm run dev --prefix frontend` in another terminal and open <http://localhost:5173>. Vite proxies API and media requests to the backend. Set `GLAZE_DATA_DIR` to use a disposable database and media directory. For a local container build, run `docker compose -f compose.yaml -f compose.build.yaml up --build -d`.

## Pull requests

Work on a branch and open a pull request to main. Explain the change and include the checks you ran. Use synthetic data for fixtures and screenshots. For API changes, commit both generated files alongside the implementation.

```sh
uv run pytest -q
uv run python scripts/export_openapi.py
npm run types --prefix frontend
npm run build --prefix frontend
(cd frontend && npx playwright install chromium && npm run test:e2e)
```

The browser suite starts an isolated server on port 8001. CI checks the generated API contract, exercises the desktop and phone UI, and builds and smoke-tests the production container on AMD64 and ARM64 runners. All three required checks must pass before squash merge. Dependabot opens weekly updates for Python, npm, Docker, and GitHub Actions.

## Publishing

Update the Python project, frontend package, lockfiles, API version, Compose image reference, README quick start, and changelog together. After the checks on main pass, tag that commit with `vMAJOR.MINOR.PATCH` and publish a GitHub release. Publishing triggers verification and builds both architectures by digest. The workflow publishes the versioned multi-architecture image with SBOM and provenance, then assigns the appropriate minor and latest aliases. Prereleases receive only an exact version tag. The registry credentials come from GitHub Actions.

Check that an anonymous client can pull the exact published image before announcing the release.
