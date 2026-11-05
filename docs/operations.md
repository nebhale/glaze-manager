# Operations

## Configuration

Compose binds to `127.0.0.1:8000` by default. Set `GLAZE_BIND_ADDRESS` and
`GLAZE_PORT` to change the host address and port. Inside the image, the data
directory is `/data` and the web assets are in `/app/frontend/dist`. For source
installs these default to `./data` and `frontend/dist`; override them with
`GLAZE_DATA_DIR` and `GLAZE_FRONTEND_DIR`.

## Storage

One persistent directory contains `glaze.db` (SQLite) and `media/` (photos and
thumbnails). SQLite uses foreign keys, WAL journaling, and serialized write
transactions. Use local storage; do not place the live database on a shared
network filesystem. Run one Uvicorn worker so browser event notifications reach
all connected clients.

The application creates the current schema in a fresh data directory. For a
restore, use a snapshot made with a compatible application version.

## Consistent backup

Stop writes before copying the data directory. This captures the database,
possible WAL sidecars, and photos together. For the Compose deployment:

```sh
mkdir -p backups
docker compose stop app
docker compose cp app:/data ./backups/studio-snapshot
docker compose start app
```

Use a fresh destination name for each snapshot and store another copy off the
server. Verify that `studio-snapshot/glaze.db` and `studio-snapshot/media/` exist.
If the copy fails, restart the app and retry after correcting the error.

For local development, stop Uvicorn and copy the entire `GLAZE_DATA_DIR`. Copying
only the main SQLite file while it is running can miss committed WAL data.

## Restore into a fresh volume

Keep the original deployment and its volume intact until the restore is verified.
Use a different Compose project and port for a rehearsal:

```sh
GLAZE_PORT=8002 docker compose -p glaze-restored create app
GLAZE_PORT=8002 docker compose -p glaze-restored cp ./backups/studio-snapshot/. app:/data
GLAZE_PORT=8002 docker compose -p glaze-restored run --rm --no-deps --user 0 app chown -R 10001:10001 /data
GLAZE_PORT=8002 docker compose -p glaze-restored start app
```

Open <http://localhost:8002>. Check a known container's current weight, a photo,
and a tag lookup. Verify its stored readings with
`GET /api/v1/containers/{id}/measurements`; weight history is retained but not
displayed in the app. Do not overwrite a live data directory with a partial restore.
Backend tests perform the same stop/copy/reopen verification using disposable
directories and verify all four data categories.

## Upgrades and monitoring

1. Make a consistent backup and retain the previous image.
2. Update the Compose image tag to the desired release and run `docker compose pull`.
3. Start it using `docker compose up -d` and inspect `docker compose logs app`.
4. Confirm `/healthz` returns `{"status":"ok"}`, open a jar, and verify its stored
   readings with `GET /api/v1/containers/{id}/measurements`.

Request logs include method, path, status, and duration. The container health
check queries the running application's database. The UI shows event-stream
connection status and refetches on reconnection; no durable notification backlog
or external monitoring service is required.

## Build for both architectures

```sh
docker buildx build --platform linux/amd64,linux/arm64 --output type=oci,dest=glaze-manager.tar .
```

For a single local architecture, run `docker compose -f compose.yaml -f compose.build.yaml build`. CI builds
both architectures without publishing images. Dependency versions are locked in
`uv.lock` and `frontend/package-lock.json`.

The web app accepts photos up to 25 MB, validates their decoded format, corrects
orientation, and generates JPEGs up to 3000 pixels plus 480-pixel thumbnails.
Uploaded originals are not retained; back up the resulting media alongside the
database.
