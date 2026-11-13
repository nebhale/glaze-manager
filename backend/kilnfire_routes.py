import json
import threading
from uuid import uuid4

from fastapi import HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, select, text, update

from . import models as m
from . import schemas as s
from .kilnfire import AUTH_MESSAGE, KilnfireClient, KilnfireError, LoginRequired, normalize_piece
from .photos import encode_photo
from .services import require, vessel_view


def piece_url(piece):
    return f"{piece.endpoint}/pieces/{piece.piece_id}"


def candidate(piece):
    images = json.loads(piece.images)
    return {
        "piece_id": piece.piece_id,
        "name": piece.name,
        "firing_type": piece.firing_type,
        "created_at": piece.created_at,
        "url": piece_url(piece),
        "thumbnail_url": images[0]["thumb"] if images else None,
        "image_count": len(images),
        "archived": piece.hidden,
    }


def connection_status(row):
    if row is None:
        return {"state": "not_configured"}
    return {
        "endpoint": row.endpoint,
        "state": "needs_login" if row.needs_login else "connected" if row.cookies else "signed_out",
        "checked_at": row.checked_at,
    }


def install_kilnfire(app, sessions, media, events):
    # Keep cookie rotation and configuration changes ordered. Network operations
    # run outside SQLite write transactions so other studio edits can proceed.
    gate = threading.RLock()
    app.state.kilnfire_transport = None

    @app.exception_handler(KilnfireError)
    async def kilnfire_error(request, error):
        return JSONResponse(status_code=502, content={"detail": str(error)})

    @app.middleware("http")
    async def private_connection_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/kilnfire"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def configured(db):
        row = db.get(m.KilnfireConnection, 1)
        if row is None:
            raise HTTPException(409, "Connect your Kilnfire studio in Settings first.")
        return row

    def check_endpoint(db, endpoint):
        if configured(db).endpoint != endpoint:
            raise HTTPException(409, "The Kilnfire studio changed. Refresh and try again.")

    def run(operation, *, login=False, endpoint=None):
        with gate:
            with sessions() as db:
                row = configured(db)
                if endpoint is not None:
                    check_endpoint(db, endpoint)
                origin, cookies = row.endpoint, row.cookies
                if not login and (not cookies or row.needs_login):
                    raise HTTPException(401, AUTH_MESSAGE)
            with KilnfireClient(
                origin, None if login else cookies, transport=app.state.kilnfire_transport
            ) as client:
                try:
                    result = operation(client)
                except LoginRequired as error:
                    if not login:
                        with sessions.begin() as db:
                            row = configured(db)
                            row.cookies, row.needs_login = client.cookies(), True
                        events.publish("kilnfire")
                    raise HTTPException(401, str(error)) from None
                except Exception:
                    # A valid session may rotate even if a later photo or API
                    # request fails. Retain those tokens without marking success.
                    if not login:
                        with sessions.begin() as db:
                            configured(db).cookies = client.cookies()
                    raise
                with sessions.begin() as db:
                    row = configured(db)
                    row.cookies = client.cookies()
                    row.needs_login = False
                    row.checked_at = m.timestamp()
            return origin, result

    @app.get("/api/v1/kilnfire", response_model=s.KilnfireStatus)
    def status():
        with sessions() as db:
            return connection_status(db.get(m.KilnfireConnection, 1))

    @app.put("/api/v1/kilnfire", response_model=s.KilnfireStatus)
    def configure(body: s.KilnfireEndpoint):
        with gate, sessions.begin() as db:
            row = db.get(m.KilnfireConnection, 1)
            if row is None:
                row = m.KilnfireConnection(id=1, endpoint=body.endpoint)
                db.add(row)
            elif row.endpoint != body.endpoint:
                row.endpoint, row.cookies, row.checked_at = body.endpoint, None, None
                row.needs_login = False
            db.flush()
            result = connection_status(row)
        events.publish("kilnfire")
        return result

    @app.post("/api/v1/kilnfire/login", response_model=s.KilnfireStatus)
    def login(body: s.KilnfireLogin):
        run(lambda client: client.login(body.email, body.password.get_secret_value()), login=True)
        events.publish("kilnfire")
        return status()

    @app.post("/api/v1/kilnfire/check", response_model=s.KilnfireStatus)
    def check():
        run(lambda client: client.list_page(1))
        events.publish("kilnfire")
        return status()

    @app.delete("/api/v1/kilnfire", response_model=s.KilnfireStatus)
    def disconnect():
        with gate, sessions.begin() as db:
            row = configured(db)
            row.cookies, row.checked_at, row.needs_login = None, None, False
        events.publish("kilnfire")
        return status()

    @app.post("/api/v1/kilnfire/pieces/refresh", response_model=s.KilnfireRefresh)
    def refresh():
        endpoint, pieces = run(lambda client: list(client.pieces()))
        with gate, sessions.begin() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            check_endpoint(db, endpoint)
            db.execute(
                update(m.KilnfirePiece)
                .where(m.KilnfirePiece.endpoint == endpoint)
                .values(available=False)
            )
            for values in pieces:
                row = db.get(m.KilnfirePiece, (endpoint, values["piece_id"]))
                if row is None:
                    row = m.KilnfirePiece(endpoint=endpoint, **values)
                    db.add(row)
                else:
                    for key, value in values.items():
                        setattr(row, key, value)
                row.available = True
        events.publish("kilnfire")
        return {"count": len(pieces)}

    @app.get("/api/v1/kilnfire/pieces", response_model=s.Page[s.KilnfireCandidate])
    def candidates(
        q: str = "",
        show_archived: bool = False,
        number: int = Query(1, alias="page", ge=1, le=2147483647),
        size: int = Query(48, alias="page_size", ge=1, le=100),
    ):
        with sessions() as db:
            endpoint = configured(db).endpoint
            matching = (
                (m.KilnfirePiece.endpoint == endpoint)
                & m.KilnfirePiece.available.is_(True)
                & m.KilnfirePiece.vessel_id.is_(None)
                & m.KilnfirePiece.name.icontains(q.strip(), autoescape=True)
            )
            if not show_archived:
                matching &= m.KilnfirePiece.hidden.is_(False)
            rows = db.scalars(
                select(m.KilnfirePiece)
                .where(matching)
                .order_by(
                    m.KilnfirePiece.created_at.desc().nulls_last(), m.KilnfirePiece.piece_id.desc()
                )
                .offset((number - 1) * size)
                .limit(size)
            )
            return {
                "items": [candidate(row) for row in rows],
                "total": db.scalar(
                    select(func.count()).select_from(m.KilnfirePiece).where(matching)
                ),
                "page": number,
                "page_size": size,
            }

    @app.patch("/api/v1/kilnfire/pieces/{piece_id}", response_model=s.KilnfireCandidate)
    def archive_piece(piece_id: int, body: s.KilnfireArchive):
        with gate, sessions.begin() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            check_endpoint(db, body.endpoint)
            row = require(db, m.KilnfirePiece, (body.endpoint, piece_id))
            if row.vessel_id is not None:
                raise HTTPException(409, "This piece is already linked to a vessel.")
            row.hidden = body.archived
            result = candidate(row)
        events.publish("kilnfire")
        return result

    @app.get("/api/v1/kilnfire/vessel-options", response_model=list[s.KilnfireVesselOption])
    def vessel_options(q: str = ""):
        with sessions() as db:
            term = q.strip()
            matching = m.Vessel.name.icontains(term, autoescape=True)
            if term.removeprefix("#").isascii() and term.removeprefix("#").isdigit():
                matching |= m.Vessel.id == term.removeprefix("#")
            rows = db.scalars(
                select(m.Vessel)
                .where(
                    matching
                    & ~m.Vessel.id.in_(
                        select(m.KilnfirePiece.vessel_id).where(
                            m.KilnfirePiece.vessel_id.is_not(None)
                        )
                    )
                )
                .order_by(func.lower(m.Vessel.name), m.Vessel.id)
                .limit(50)
            )
            return [{"id": r.id, "name": r.name, "archived": r.archived} for r in rows]

    @app.post("/api/v1/kilnfire/pieces/{piece_id}/import", response_model=s.VesselOut)
    def import_piece(piece_id: int, body: s.KilnfireImport):
        endpoint = body.endpoint
        with sessions() as db:
            check_endpoint(db, endpoint)
            row = require(db, m.KilnfirePiece, (endpoint, piece_id))
            if row.vessel_id is not None:
                if body.vessel_id not in (None, row.vessel_id):
                    raise HTTPException(409, "This piece is already linked to another vessel.")
                return vessel_view(db, require(db, m.Vessel, row.vessel_id))
            if not row.available:
                raise HTTPException(409, "This piece is no longer available. Refresh the list.")
            if body.vessel_id is not None:
                require(db, m.Vessel, body.vessel_id)

        def fetch(client):
            # Re-enumerate the member list before fetching the detail, ensuring
            # the requested ID still belongs to the current login's piece list.
            found, number = False, 1
            while True:
                listing = client.list_page(number)
                if any(item.get("id") == piece_id for item in listing["data"]):
                    found = True
                    break
                if number >= listing["last_page"]:
                    break
                number += 1
            if not found:
                raise HTTPException(
                    409, "This piece is no longer in your Kilnfire list. Refresh it."
                )
            values = normalize_piece(client.detail(piece_id))
            if len(values["name"]) > 200:
                raise HTTPException(
                    422, "Shorten the piece description in Kilnfire to 200 characters."
                )
            photos = [
                encode_photo(client.download_photo(p["image"]))
                for p in json.loads(values["images"])
            ]
            return values, photos

        _, (values, photos) = run(fetch, endpoint=endpoint)
        files = []
        try:
            with gate, sessions.begin() as db:
                db.execute(text("BEGIN IMMEDIATE"))
                check_endpoint(db, endpoint)
                row = require(db, m.KilnfirePiece, (endpoint, piece_id))
                if row.vessel_id is not None:
                    if body.vessel_id not in (None, row.vessel_id):
                        raise HTTPException(409, "This piece is already linked to another vessel.")
                    return vessel_view(db, require(db, m.Vessel, row.vessel_id))
                if body.vessel_id is None:
                    vessel = m.Vessel(name=values["name"], source_url=piece_url(row))
                    db.add(vessel)
                    db.flush()
                else:
                    vessel = require(db, m.Vessel, body.vessel_id)
                    if db.scalar(
                        select(m.KilnfirePiece).where(m.KilnfirePiece.vessel_id == vessel.id)
                    ):
                        raise HTTPException(
                            409, "This vessel already has a Kilnfire link. Unlink it first."
                        )
                    if body.expected_name is None or vessel.name != body.expected_name:
                        raise HTTPException(
                            409,
                            "The vessel name changed. Choose the vessel again before importing.",
                        )
                    vessel.name, vessel.source_url = values["name"], piece_url(row)
                has_cover = bool(vessel.photos)
                for index, (full, thumb) in enumerate(photos):
                    key = str(uuid4())
                    photo = m.VesselPhoto(
                        id=key,
                        vessel_id=vessel.id,
                        filename=f"{key}.jpg",
                        thumbnail=f"{key}-thumb.jpg",
                        cover=not has_cover and index == 0,
                    )
                    for name, content in ((photo.filename, full), (photo.thumbnail, thumb)):
                        path = media / name
                        files.append(path)
                        path.write_bytes(content)
                    db.add(photo)
                for key, value in values.items():
                    setattr(row, key, value)
                row.vessel_id, row.hidden = vessel.id, False
                db.flush()
                db.expire(vessel, ["photos"])
                result = vessel_view(db, vessel)
        except Exception:
            for path in files:
                path.unlink(missing_ok=True)
            raise
        events.publish("kilnfire")
        return result

    @app.delete("/api/v1/vessels/{vessel_id}/kilnfire", response_model=s.VesselOut)
    def unlink(vessel_id: int):
        with gate, sessions.begin() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            vessel = require(db, m.Vessel, vessel_id)
            row = db.scalar(select(m.KilnfirePiece).where(m.KilnfirePiece.vessel_id == vessel_id))
            if row:
                vessel.source_url = None
                row.vessel_id, row.hidden = None, False
                db.flush()
            result = vessel_view(db, vessel)
        events.publish("kilnfire")
        return result
