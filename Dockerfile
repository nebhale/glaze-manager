FROM node:26-bookworm-slim AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.13.6 AS uv
FROM python:3.13-slim-bookworm
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never \
    GLAZE_DATA_DIR=/data GLAZE_FRONTEND_DIR=/app/frontend/dist \
    PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock LICENSE ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./backend/
RUN uv sync --frozen --no-dev && \
    groupadd --gid 10001 glaze && useradd --uid 10001 --gid glaze --no-create-home glaze && \
    mkdir -p /data && chown glaze:glaze /data
COPY --from=frontend /web/dist ./frontend/dist
COPY THIRD_PARTY.md LICENSE /usr/share/doc/glaze-manager/
USER glaze
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
