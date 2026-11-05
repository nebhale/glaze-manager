import asyncio
import hashlib
import io
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
from pydantic import ValidationError
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models as m
from . import schemas as s
from .database import Base, data_directory, make_engine, session_factory
from .domain import grams, matches_cone, milligrams, normalize_uid, revision_check
from .services import (
    Events,
    container_stock,
    container_view,
    fields,
    glaze_view,
    initialize_starting_weight,
    lookup,
    measurement_view,
    page,
    photo_view,
    preset_view,
    require,
)

register_heif_opener()
log = logging.getLogger("glaze")
logging.basicConfig(level=logging.INFO, format="%(message)s")
ROOT = Path(__file__).resolve().parent.parent


def create_app(data_dir: Path | None = None):
    directory = data_dir or data_directory()
    engine = make_engine(directory)
    sessions = session_factory(engine)
    media = directory / "media"
    media.mkdir(parents=True, exist_ok=True)
    events = Events()

    @asynccontextmanager
    async def lifespan(app):
        Base.metadata.create_all(engine)
        with sessions() as db:
            if db.get(m.Setting, 1) is None:
                db.add(m.Setting(id=1))
                db.commit()
        yield
        engine.dispose()

    app = FastAPI(title="Glaze Manager", version="1.0.0", lifespan=lifespan)
    app.state.engine = engine
    app.state.sessions = sessions

    def database(request: Request):
        with sessions() as db:
            # Serialize read/validate/write transactions, including optimistic checks.
            if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                db.execute(text("BEGIN IMMEDIATE"))
            try:
                yield db
            finally:
                db.rollback()

    DB = Annotated[Session, Depends(database)]

    def commit(db, kind="inventory"):
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "This record is already linked or is still in use.") from None
        events.publish(kind)

    @app.middleware("http")
    async def request_log(request, call_next):
        started = time.monotonic()
        response = await call_next(request)
        if not request.url.path.startswith("/api/v1/events"):
            log.info(
                json.dumps(
                    {
                        "method": request.method,
                        "path": request.url.path,
                        "status": response.status_code,
                        "duration_ms": round((time.monotonic() - started) * 1000),
                    }
                )
            )
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, exc):
        return JSONResponse(
            status_code=409, content={"detail": "This record is already linked or is still in use."}
        )

    @app.get("/healthz")
    def health(db: DB):
        db.execute(text("SELECT 1"))
        return {"status": "ok"}

    @app.get("/api/v1/suggestions/{field}", response_model=list[str])
    def suggestions(field: Literal["product_line", "location", "cone"], db: DB):
        column = {
            "product_line": m.Glaze.product_line,
            "location": m.Container.location,
            "cone": m.Glaze.cone,
        }[field]
        # Include all stored values, including archived jars, without depending
        # on the inventory's filters or pagination. Preserve the stored spelling.
        values = {
            value.strip()
            for value in db.scalars(select(column).where(column.is_not(None)).distinct())
            if value.strip()
        }
        unique = {}
        for value in sorted(values, key=lambda value: (value.casefold(), value)):
            unique.setdefault(value.casefold(), value)
        return list(unique.values())

    @app.get("/api/v1/cones", response_model=list[str])
    def cones(db: DB):
        return suggestions("cone", db)

    @app.get("/api/v1/manufacturers", response_model=s.Page[s.ManufacturerOut])
    def manufacturers(
        db: DB,
        q: str = "",
        number: int = Query(1, alias="page", ge=1),
        size: int = Query(100, alias="page_size", ge=1, le=1000),
    ):
        rows = db.scalars(select(m.Manufacturer).order_by(m.Manufacturer.name)).all()
        return page([fields(x) for x in rows if q.casefold() in x.name.casefold()], number, size)

    @app.post("/api/v1/manufacturers", response_model=s.ManufacturerOut, status_code=201)
    def create_manufacturer(body: s.ManufacturerInput, db: DB):
        item = m.Manufacturer(**body.model_dump())
        db.add(item)
        commit(db)
        return fields(item)

    @app.put("/api/v1/manufacturers/{identifier}", response_model=s.ManufacturerOut)
    def edit_manufacturer(identifier: str, body: s.ManufacturerInput, db: DB):
        item = require(db, m.Manufacturer, identifier)
        for key, value in body.model_dump().items():
            setattr(item, key, value)
        commit(db)
        return fields(item)

    @app.get("/api/v1/glazes", response_model=s.Page[s.GlazeOut])
    def glazes(
        db: DB,
        q: str = "",
        manufacturer_id: str | None = None,
        sort: Literal["name", "product_line"] = "name",
        descending: bool = False,
        number: int = Query(1, alias="page", ge=1),
        size: int = Query(100, alias="page_size", ge=1, le=1000),
    ):
        rows = db.scalars(select(m.Glaze)).all()
        result = [
            glaze_view(db, x)
            for x in rows
            if (not manufacturer_id or x.manufacturer_id == manufacturer_id)
        ]
        result = [
            x
            for x in result
            if q.casefold()
            in " ".join(
                str(x.get(k) or "")
                for k in (
                    "name",
                    "manufacturer_name",
                    "product_code",
                    "product_line",
                )
            ).casefold()
        ]
        result.sort(
            key=lambda glaze: (glaze["name"].casefold(), glaze["id"]),
            reverse=sort == "name" and descending,
        )
        if sort == "product_line":
            with_line = sorted(
                (glaze for glaze in result if glaze["product_line"]),
                key=lambda glaze: glaze["product_line"].casefold(),
                reverse=descending,
            )
            result = with_line + [glaze for glaze in result if not glaze["product_line"]]
        return page(result, number, size)

    @app.get("/api/v1/glazes/{identifier}", response_model=s.GlazeOut)
    def glaze(identifier: str, db: DB):
        return glaze_view(db, require(db, m.Glaze, identifier))

    @app.post("/api/v1/glazes", response_model=s.GlazeOut, status_code=201)
    def create_glaze(body: s.GlazeInput, db: DB):
        require(db, m.Manufacturer, body.manufacturer_id)
        item = m.Glaze(**body.model_dump())
        db.add(item)
        commit(db)
        return glaze_view(db, item)

    @app.put("/api/v1/glazes/{identifier}", response_model=s.GlazeOut)
    def edit_glaze(identifier: str, body: s.GlazeInput, db: DB):
        item = require(db, m.Glaze, identifier)
        require(db, m.Manufacturer, body.manufacturer_id)
        for key, value in body.model_dump().items():
            setattr(item, key, value)
        for container in db.scalars(select(m.Container).where(m.Container.glaze_id == identifier)):
            container.revision += 1
        commit(db)
        return glaze_view(db, item)

    @app.get("/api/v1/presets", response_model=s.Page[s.PresetOut])
    def presets(
        db: DB,
        number: int = Query(1, alias="page", ge=1),
        size: int = Query(100, alias="page_size", ge=1, le=1000),
    ):
        return page(
            [preset_view(x) for x in db.scalars(select(m.Preset).order_by(m.Preset.name))],
            number,
            size,
        )

    @app.post("/api/v1/presets", response_model=s.PresetOut, status_code=201)
    def create_preset(body: s.PresetInput, db: DB):
        item = m.Preset(name=body.name, tare_mg=milligrams(body.tare_g))
        db.add(item)
        commit(db)
        return preset_view(item)

    @app.put("/api/v1/presets/{identifier}", response_model=s.PresetOut)
    def edit_preset(identifier: str, body: s.PresetInput, db: DB):
        item = require(db, m.Preset, identifier)
        item.name, item.tare_mg = body.name, milligrams(body.tare_g)
        commit(db)
        return preset_view(item)

    def merge_edit(body, current, schema):
        # Validate the complete record, including cross-field rules, while only
        # applying submitted fields. All comparisons run inside BEGIN IMMEDIATE.
        existing = {key: current[key] for key in schema.model_fields}
        try:
            validated = schema.model_validate({**existing, **body.changes}).model_dump()
        except ValidationError as exc:
            raise HTTPException(422, exc.errors(include_context=False)) from None
        changed = any(current[key] != validated[key] for key in body.changes)
        if changed and any(current[key] != value for key, value in body.expected.items()):
            raise HTTPException(
                409, "This field changed elsewhere. Review the saved value before retrying."
            )
        return validated, changed

    @app.get("/api/v1/manufacturers/{identifier}", response_model=s.ManufacturerOut)
    def manufacturer(identifier: str, db: DB):
        return fields(require(db, m.Manufacturer, identifier))

    @app.patch("/api/v1/manufacturers/{identifier}", response_model=s.ManufacturerOut)
    def patch_manufacturer(identifier: str, body: s.RecordPatch, db: DB):
        item = require(db, m.Manufacturer, identifier)
        values, changed = merge_edit(body, fields(item), s.ManufacturerInput)
        if changed:
            return edit_manufacturer(identifier, s.ManufacturerInput(**values), db)
        return fields(item)

    @app.patch("/api/v1/glazes/{identifier}", response_model=s.GlazeOut)
    def patch_glaze(identifier: str, body: s.RecordPatch, db: DB):
        item = require(db, m.Glaze, identifier)
        values, changed = merge_edit(body, glaze_view(db, item), s.GlazeInput)
        if changed:
            return edit_glaze(identifier, s.GlazeInput(**values), db)
        return glaze_view(db, item)

    @app.get("/api/v1/presets/{identifier}", response_model=s.PresetOut)
    def preset(identifier: str, db: DB):
        return preset_view(require(db, m.Preset, identifier))

    @app.patch("/api/v1/presets/{identifier}", response_model=s.PresetOut)
    def patch_preset(identifier: str, body: s.RecordPatch, db: DB):
        item = require(db, m.Preset, identifier)
        values, changed = merge_edit(body, preset_view(item), s.PresetInput)
        if changed:
            return edit_preset(identifier, s.PresetInput(**values), db)
        return preset_view(item)

    @app.get("/api/v1/containers", response_model=s.Page[s.ContainerOut])
    def containers(
        db: DB,
        q: str = "",
        glaze_id: str | None = None,
        manufacturer_id: str | None = None,
        classification: str | None = None,
        cone: str | None = None,
        location: str | None = None,
        status: str = "active",
        sort: str = "name",
        descending: bool = False,
        number: int = Query(1, alias="page", ge=1),
        size: int = Query(50, alias="page_size", ge=1, le=1000),
    ):
        if status not in {"active", "archived", "all", "low", "incomplete"} or sort not in {
            "number",
            "name",
            "percentage",
            "remaining_g",
            "last_weighed_at",
            "location",
        }:
            raise HTTPException(422, "Invalid inventory filter or sort.")
        rows = db.scalars(select(m.Container).order_by(m.Container.created_at)).all()
        result = []
        for item in rows:
            if status != "all" and item.archived != (status == "archived"):
                continue
            if glaze_id and item.glaze_id != glaze_id:
                continue
            value = container_view(db, item)
            glaze = value["glaze"]
            if any(
                wanted and str(glaze.get(key) or "").casefold() != wanted.casefold()
                for key, wanted in [
                    ("manufacturer_id", manufacturer_id),
                    ("classification", classification),
                ]
            ):
                continue
            if cone and not matches_cone(glaze["cone"], cone):
                continue
            if location and location.casefold() not in (item.location or "").casefold():
                continue
            if (
                status == "low"
                and not value["low_stock"]
                or status == "incomplete"
                and not value["incomplete"]
            ):
                continue
            haystack = " ".join(
                str(x or "")
                for x in [
                    glaze["name"],
                    glaze["manufacturer_name"],
                    glaze["product_code"],
                    item.location,
                    glaze["product_line"],
                ]
            )
            if q.strip().startswith("#"):
                if q.strip() != f"#{item.number}":
                    continue
            elif q.casefold() not in haystack.casefold() and q.strip() != str(item.number):
                continue
            result.append(value)
        key = lambda x: x["glaze"]["name"].casefold() if sort == "name" else x.get(sort)
        known = sorted([x for x in result if key(x) is not None], key=key, reverse=descending)
        unknown = [x for x in result if key(x) is None]
        return page(known + unknown, number, size)

    @app.get("/api/v1/summary")
    def summary(db: DB):
        active = [
            container_stock(db, x)
            for x in db.scalars(select(m.Container).where(m.Container.archived.is_(False)))
        ]
        return {
            "containers": len(active),
            "glazes": len(db.scalars(select(m.Glaze)).all()),
            "low": sum(x["low_stock"] for x in active),
            "incomplete": sum(x["incomplete"] for x in active),
        }

    @app.post("/api/v1/containers", response_model=s.ContainerOut, status_code=201)
    def create_container(body: s.ContainerInput, db: DB):
        require(db, m.Glaze, body.glaze_id)
        values = body.model_dump(exclude={"tare_g", "full_weight_g"})
        tare, full = milligrams(body.tare_g), milligrams(body.full_weight_g)
        if body.preset_id:
            preset = require(db, m.Preset, body.preset_id)
            if "tare_g" not in body.model_fields_set:
                tare = preset.tare_mg
        # POST transactions hold BEGIN IMMEDIATE, so allocation is serialized.
        highest_current = db.scalar(select(func.max(m.Container.number))) or 0
        highest_retired = db.scalar(select(func.max(m.RetiredJarNumber.number))) or 0
        number = max(highest_current, highest_retired) + 1
        item = m.Container(**values, number=number, tare_mg=tare, full_weight_mg=full)
        db.add(item)
        commit(db)
        return container_view(db, item)

    @app.get("/api/v1/containers/{identifier}", response_model=s.ContainerOut)
    def container(identifier: str, db: DB):
        return container_view(db, require(db, m.Container, identifier))

    @app.patch("/api/v1/containers/{identifier}", response_model=s.ContainerOut)
    def edit_container(identifier: str, body: s.ContainerEdit, db: DB):
        item = require(db, m.Container, identifier)
        revision_check(item, body.expected_revision)
        values = body.model_dump(exclude_unset=True, exclude={"expected_revision"})
        if "glaze_id" in values:
            if not values["glaze_id"]:
                raise HTTPException(422, "Choose a glaze.")
            require(db, m.Glaze, values["glaze_id"])
        if "preset_id" in values and values["preset_id"] != item.preset_id:
            preset = require(db, m.Preset, values["preset_id"]) if values["preset_id"] else None
            if "tare_g" not in values:
                item.tare_mg = preset.tare_mg if preset else None
        for key, value in values.items():
            if key in {"tare_g", "full_weight_g"}:
                setattr(item, key.removesuffix("_g") + "_mg", milligrams(value))
            elif key != "archived" or value is not None:
                setattr(item, key, value)
        item.revision += 1
        commit(db)
        return container_view(db, item)

    @app.delete("/api/v1/containers/{identifier}", status_code=204)
    def delete_container(identifier: str, body: s.RevisionInput, db: DB):
        item = require(db, m.Container, identifier)
        revision_check(item, body.expected_revision)
        db.add(m.RetiredJarNumber(number=item.number))
        db.execute(delete(m.Measurement).where(m.Measurement.container_id == identifier))
        db.delete(item)
        commit(db)

    @app.get("/api/v1/containers/{identifier}/measurements", response_model=list[s.MeasurementOut])
    def measurements(identifier: str, db: DB):
        require(db, m.Container, identifier)
        return [
            measurement_view(x)
            for x in db.scalars(
                select(m.Measurement)
                .where(m.Measurement.container_id == identifier)
                .order_by(m.Measurement.measured_at.desc(), m.Measurement.id.desc())
            )
        ]

    @app.post("/api/v1/containers/{identifier}/measurements", response_model=s.SaveResult)
    def weigh(identifier: str, body: s.MeasurementInput, db: DB):
        payload = json.dumps({"container_id": identifier, **body.model_dump()}, sort_keys=True)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        prior = db.scalar(select(m.Measurement).where(m.Measurement.request_id == body.request_id))
        if prior:
            if prior.request_hash != digest:
                raise HTTPException(
                    409, "That request identifier was already used for a different reading."
                )
            return json.loads(prior.response_json)
        item = require(db, m.Container, identifier)
        revision_check(item, body.expected_revision)
        if item.archived:
            raise HTTPException(409, "Restore this jar before weighing it.")
        if body.source == "device" and item.tag_uid != body.tag_uid:
            raise HTTPException(409, "The tag association changed. Scan the jar again.")
        gross_mg = milligrams(body.gross_g)
        if body.source == "device":
            initialize_starting_weight(db, item, gross_mg)
        measurement = m.Measurement(
            container_id=identifier,
            gross_mg=gross_mg,
            tare_mg=item.tare_mg,
            full_weight_mg=item.full_weight_mg,
            source=body.source,
            device_id=body.device_id,
            note=body.note,
            request_id=body.request_id,
            request_hash=digest,
        )
        db.add(measurement)
        item.revision += 1
        db.flush()
        response = {
            "measurement_id": measurement.id,
            "container_id": item.id,
            "revision": item.revision,
            "stock": container_stock(db, item),
        }
        measurement.response_json = json.dumps(response)
        commit(db)
        return response

    @app.post("/api/v1/measurements/{identifier}/void", response_model=s.ContainerOut)
    def void_measurement(identifier: str, body: s.VoidInput, db: DB):
        measurement = require(db, m.Measurement, identifier)
        item = require(db, m.Container, measurement.container_id)
        revision_check(item, body.expected_revision)
        if measurement.voided:
            raise HTTPException(409, "This reading is already voided.")
        measurement.voided, measurement.void_reason = True, body.reason
        item.revision += 1
        commit(db)
        return container_view(db, item)

    @app.get("/api/v1/tags/{uid}", response_model=s.LookupOut)
    def tag_lookup(uid: str, db: DB):
        try:
            return lookup(db, normalize_uid(uid))
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @app.post("/api/v1/scans", response_model=s.ScanOut)
    def scan(body: s.ScanInput, db: DB):
        device = db.get(m.Device, body.device_id)
        if not device:
            device = m.Device(id=body.device_id, tag_uid=body.uid)
            db.add(device)
        device.tag_uid, device.last_seen = body.uid, m.timestamp()
        commit(db, "scan")
        return {"device_id": body.device_id, "last_seen": device.last_seen, **lookup(db, body.uid)}

    @app.get("/api/v1/scans", response_model=list[s.ScanOut])
    def scans(db: DB):
        return [
            {"device_id": d.id, "last_seen": d.last_seen, **lookup(db, d.tag_uid)}
            for d in db.scalars(select(m.Device).order_by(m.Device.last_seen.desc()).limit(100))
        ]

    @app.put("/api/v1/tags/{uid}/binding", response_model=s.ContainerOut)
    def bind(uid: str, body: s.BindInput, db: DB):
        try:
            uid = normalize_uid(uid)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        item = require(db, m.Container, body.container_id)
        revision_check(item, body.expected_revision)
        if item.archived:
            raise HTTPException(409, "Restore the destination jar before binding a tag.")
        owner = db.scalar(select(m.Container).where(m.Container.tag_uid == uid))
        if owner and owner.id != item.id:
            if not body.move:
                raise HTTPException(
                    409, "This tag belongs to another jar. Explicitly confirm moving it."
                )
            owner.tag_uid = None
            owner.revision += 1
            db.flush()
        if item.tag_uid and item.tag_uid != uid and not body.replace:
            raise HTTPException(409, "This jar already has a tag. Explicitly confirm replacing it.")
        item.tag_uid = uid
        item.revision += 1
        commit(db)
        return container_view(db, item)

    @app.delete("/api/v1/containers/{identifier}/tag", response_model=s.ContainerOut)
    def unlink(identifier: str, body: s.RevisionInput, db: DB):
        item = require(db, m.Container, identifier)
        revision_check(item, body.expected_revision)
        item.tag_uid = None
        item.revision += 1
        commit(db)
        return container_view(db, item)

    @app.get("/api/v1/settings", response_model=s.SettingsInput)
    def settings(db: DB):
        return {"low_stock_threshold_g": grams(require(db, m.Setting, 1).low_stock_threshold_mg)}

    @app.put("/api/v1/settings", response_model=s.SettingsInput)
    def edit_settings(body: s.SettingsInput, db: DB):
        require(db, m.Setting, 1).low_stock_threshold_mg = milligrams(body.low_stock_threshold_g)
        for container in db.scalars(select(m.Container)):
            container.revision += 1
        commit(db)
        return settings(db)

    @app.patch("/api/v1/settings", response_model=s.SettingsInput)
    def patch_settings(body: s.RecordPatch, db: DB):
        values, changed = merge_edit(body, settings(db), s.SettingsInput)
        return edit_settings(s.SettingsInput(**values), db) if changed else settings(db)

    @app.post("/api/v1/glazes/{identifier}/photos", response_model=s.PhotoOut, status_code=201)
    def upload_photo(identifier: str, db: DB, file: UploadFile = File()):
        require(db, m.Glaze, identifier)
        content = file.file.read(25 * 1024 * 1024 + 1)
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(413, "Choose a photo smaller than 25 MB.")
        try:
            original = Image.open(io.BytesIO(content))
            if original.format not in {"JPEG", "PNG", "WEBP", "HEIF", "HEIC"}:
                raise ValueError("Unsupported image format")
            image = ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((3000, 3000))
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(422, "Choose a valid JPEG, PNG, WebP, or HEIC photo.") from None
        photo_id = str(uuid4())
        filename, thumbnail = f"{photo_id}.jpg", f"{photo_id}-thumb.jpg"
        image.save(media / filename, quality=88)
        image.thumbnail((480, 480))
        image.save(media / thumbnail, quality=82)
        existing = db.scalar(select(m.Photo).where(m.Photo.glaze_id == identifier))
        photo = m.Photo(
            id=photo_id,
            glaze_id=identifier,
            filename=filename,
            thumbnail=thumbnail,
            cover=existing is None,
        )
        db.add(photo)
        try:
            commit(db)
        except Exception:
            (media / filename).unlink(missing_ok=True)
            (media / thumbnail).unlink(missing_ok=True)
            raise
        return photo_view(photo)

    @app.get("/api/v1/photos/{identifier}/caption", response_model=s.PhotoEdit)
    def photo_caption(identifier: str, db: DB):
        photo = require(db, m.Photo, identifier)
        return {"caption": photo.caption, "cover": photo.cover}

    @app.patch("/api/v1/photos/{identifier}/caption", response_model=s.PhotoOut)
    def patch_photo_caption(identifier: str, body: s.RecordPatch, db: DB):
        if set(body.changes) != {"caption"}:
            raise HTTPException(422, "Only the caption can be edited here.")
        values, changed = merge_edit(body, photo_caption(identifier, db), s.PhotoEdit)
        if changed:
            return edit_photo(identifier, s.PhotoEdit(caption=values["caption"]), db)
        return photo_view(require(db, m.Photo, identifier))

    @app.patch("/api/v1/photos/{identifier}", response_model=s.PhotoOut)
    def edit_photo(identifier: str, body: s.PhotoEdit, db: DB):
        photo = require(db, m.Photo, identifier)
        if "caption" in body.model_fields_set:
            photo.caption = body.caption
        if body.cover:
            for sibling in db.scalars(select(m.Photo).where(m.Photo.glaze_id == photo.glaze_id)):
                sibling.cover = sibling.id == identifier
        commit(db)
        return photo_view(photo)

    @app.delete("/api/v1/photos/{identifier}", status_code=204)
    def delete_photo(identifier: str, db: DB):
        photo = require(db, m.Photo, identifier)
        paths = [media / photo.filename, media / photo.thumbnail]
        if photo.cover:
            sibling = db.scalar(
                select(m.Photo)
                .where(m.Photo.glaze_id == photo.glaze_id, m.Photo.id != photo.id)
                .order_by(m.Photo.created_at)
            )
            if sibling:
                sibling.cover = True
        db.delete(photo)
        commit(db)
        for path in paths:
            path.unlink(missing_ok=True)

    @app.get("/api/v1/events")
    async def event_stream(request: Request):
        async def messages():
            subscription = events.subscribe()
            try:
                yield 'data: {"type":"connected"}\n\n'
                while not await request.is_disconnected():
                    try:
                        value = await asyncio.wait_for(subscription[1].get(), timeout=15)
                        yield f"data: {value}\n\n"
                    except asyncio.TimeoutError:
                        yield ": heartbeat\n\n"
            finally:
                events.unsubscribe(subscription)

        return StreamingResponse(
            messages(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    app.mount("/media", StaticFiles(directory=media), name="media")
    frontend = Path(os.environ.get("GLAZE_FRONTEND_DIR", str(ROOT / "frontend" / "dist"))).resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def frontend_file(path: str):
        if path.startswith(("api/", "media/")):
            raise HTTPException(404, "Not found.")
        target = (frontend / path).resolve()
        if target.is_relative_to(frontend) and target.is_file():
            return FileResponse(target)
        if (frontend / "index.html").is_file():
            return FileResponse(frontend / "index.html")
        return JSONResponse(
            {"detail": "Frontend not built. Run npm run build in frontend/. API docs: /docs"},
            status_code=503,
        )

    return app


app = create_app()
