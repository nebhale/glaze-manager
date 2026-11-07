import asyncio
import hashlib
import io
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from itertools import islice
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request, UploadFile
from fastapi import Path as PathParam
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
from pydantic import ValidationError
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from . import models as m
from . import schemas as s
from .database import Base, allow_unassigned_manufacturer, data_directory, make_engine, session_factory
from .domain import cents, grams, matches_cone, milligrams, normalize_uid, revision_check
from .services import (
    Events,
    application_view,
    container_stock,
    container_view,
    device_view,
    fields,
    glaze_references,
    glaze_view,
    initialize_starting_weight,
    lookup,
    measurement_view,
    page,
    photo_view,
    preset_view,
    require,
    vessel_summary,
    vessel_view,
)

register_heif_opener()
log = logging.getLogger("glaze")
logging.basicConfig(level=logging.INFO, format="%(message)s")
ROOT = Path(__file__).resolve().parent.parent
VesselId = Annotated[int, PathParam(ge=1, le=9223372036854775807)]


def create_app(data_dir: Path | None = None):
    directory = data_dir or data_directory()
    engine = make_engine(directory)
    sessions = session_factory(engine)
    media = directory / "media"
    media.mkdir(parents=True, exist_ok=True)
    events = Events()

    @asynccontextmanager
    async def lifespan(app):
        allow_unassigned_manufacturer(engine)
        with engine.begin() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            Base.metadata.create_all(connection)
            columns = inspect(connection).get_columns("containers")
            if not any(column["name"] == "cost_cents" for column in columns):
                connection.exec_driver_sql("ALTER TABLE containers ADD COLUMN cost_cents INTEGER")
            vessel_columns = {
                column["name"] for column in inspect(connection).get_columns("vessels")
            }
            if "location" not in vessel_columns:
                connection.exec_driver_sql("ALTER TABLE vessels ADD COLUMN location VARCHAR")
            if "archived" not in vessel_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE vessels ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0"
                )
        with sessions() as db:
            if db.get(m.Setting, 1) is None:
                db.add(m.Setting(id=1))
                db.commit()
        yield
        engine.dispose()

    app = FastAPI(title="Glaze Manager", version="1.5.0", lifespan=lifespan)
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
    def suggestions(
        field: Literal["product_line", "location", "vessel_location", "cone", "application_note"],
        db: DB,
    ):
        column = {
            "product_line": m.Glaze.product_line,
            "location": m.Container.location,
            "vessel_location": m.Vessel.location,
            "cone": m.Glaze.cone,
            "application_note": m.GlazeApplication.application_note,
        }[field]
        # Include historical values from this field and preserve the stored spelling.
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

    @app.delete("/api/v1/manufacturers/{identifier}", status_code=204)
    def delete_manufacturer(identifier: str, db: DB):
        manufacturer = require(db, m.Manufacturer, identifier)
        glaze_name = db.scalar(
            select(m.Glaze.name)
            .where(m.Glaze.manufacturer_id == identifier)
            .order_by(m.Glaze.name, m.Glaze.id)
            .limit(1)
        )
        if glaze_name is not None:
            raise HTTPException(
                409,
                f"“{glaze_name}” uses this manufacturer. Reassign the linked glazes first.",
            )
        db.delete(manufacturer)
        commit(db)

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

    @app.get("/api/v1/glaze-options", response_model=list[s.GlazeReference])
    def glaze_options(db: DB):
        query = glaze_references().order_by(
            func.lower(m.Manufacturer.name),
            func.lower(m.Glaze.name),
            m.Glaze.product_code,
            m.Glaze.id,
        )
        return db.execute(query).mappings().all()

    @app.get("/api/v1/glazes/{identifier}", response_model=s.GlazeDetailOut)
    def glaze(identifier: str, db: DB):
        result = glaze_view(db, require(db, m.Glaze, identifier))
        linked = select(m.GlazeApplication.vessel_id).where(
            m.GlazeApplication.glaze_id == identifier
        )
        vessels = db.scalars(
            select(m.Vessel)
            .where(m.Vessel.id.in_(linked))
            .order_by(func.lower(m.Vessel.name), m.Vessel.id)
            .options(selectinload(m.Vessel.photos))
        )
        return {**result, "vessels": [vessel_summary(vessel) for vessel in vessels]}

    @app.post("/api/v1/glazes", response_model=s.GlazeOut, status_code=201)
    def create_glaze(body: s.GlazeInput, db: DB):
        if body.manufacturer_id is not None:
            require(db, m.Manufacturer, body.manufacturer_id)
        item = m.Glaze(**body.model_dump())
        db.add(item)
        commit(db)
        return glaze_view(db, item)

    @app.put("/api/v1/glazes/{identifier}", response_model=s.GlazeOut)
    def edit_glaze(identifier: str, body: s.GlazeInput, db: DB):
        item = require(db, m.Glaze, identifier)
        if body.manufacturer_id is not None:
            require(db, m.Manufacturer, body.manufacturer_id)
        for key, value in body.model_dump().items():
            setattr(item, key, value)
        for container in db.scalars(select(m.Container).where(m.Container.glaze_id == identifier)):
            container.revision += 1
        commit(db)
        return glaze_view(db, item)

    @app.delete("/api/v1/glazes/{identifier}", status_code=204)
    def delete_glaze(identifier: str, db: DB):
        glaze = require(db, m.Glaze, identifier)
        jar = db.scalar(
            select(m.Container)
            .where(m.Container.glaze_id == identifier)
            .order_by(m.Container.archived, m.Container.number)
            .limit(1)
        )
        if jar:
            kind = "Archived jar" if jar.archived else "Jar"
            raise HTTPException(
                409,
                f"{kind} #{jar.number} uses this glaze. Change the jar’s glaze or delete the jar first.",
            )
        vessel_id = db.scalar(
            select(m.GlazeApplication.vessel_id)
            .where(m.GlazeApplication.glaze_id == identifier)
            .order_by(m.GlazeApplication.vessel_id)
            .limit(1)
        )
        if vessel_id is not None:
            raise HTTPException(
                409,
                f"Vessel #{vessel_id} uses this glaze. Remove the application from the vessel first.",
            )

        owned_photos = m.Photo.glaze_id == identifier
        files = db.execute(select(m.Photo.filename, m.Photo.thumbnail).where(owned_photos)).all()
        db.execute(delete(m.Photo).where(owned_photos))
        db.delete(glaze)
        commit(db)
        for filename, thumbnail in files:
            (media / filename).unlink(missing_ok=True)
            (media / thumbnail).unlink(missing_ok=True)

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

    @app.get("/api/v1/vessels", response_model=s.Page[s.VesselSummary])
    def vessels(
        db: DB,
        q: str = "",
        status: Literal["active", "archived", "all"] = "active",
        sort: Literal["id", "name", "location"] = "name",
        descending: bool = False,
        number: int = Query(1, alias="page", ge=1, le=2147483647),
        size: int = Query(50, alias="page_size", ge=1, le=1000),
    ):
        term = q.strip()
        matching = m.Vessel.name.icontains(term, autoescape=True) | m.Vessel.location.icontains(
            term, autoescape=True
        )
        digits = term.removeprefix("#")
        if digits.isascii() and digits.isdigit():
            # Compare as text so even an oversized search cannot overflow a SQLite integer.
            by_number = m.Vessel.id == digits
            matching = by_number if term.startswith("#") else matching | by_number
        if status != "all":
            matching &= m.Vessel.archived.is_(status == "archived")
        column = {
            "id": m.Vessel.id,
            "name": func.lower(m.Vessel.name),
            "location": func.lower(m.Vessel.location),
        }[sort]
        order = column.desc() if descending else column.asc()
        rows = db.scalars(
            select(m.Vessel)
            .where(matching)
            .order_by(order.nulls_last(), m.Vessel.id)
            .offset((number - 1) * size)
            .limit(size)
            .options(selectinload(m.Vessel.photos))
        )
        return {
            "items": [vessel_summary(row) for row in rows],
            "total": db.scalar(select(func.count()).select_from(m.Vessel).where(matching)),
            "page": number,
            "page_size": size,
        }

    @app.post("/api/v1/vessels", response_model=s.VesselOut, status_code=201)
    def create_vessel(body: s.VesselInput, db: DB):
        vessel = m.Vessel(**body.model_dump())
        db.add(vessel)
        commit(db)
        return vessel_view(db, vessel)

    @app.get("/api/v1/vessels/{identifier}", response_model=s.VesselOut)
    def vessel_detail(identifier: VesselId, db: DB):
        return vessel_view(db, require(db, m.Vessel, identifier))

    @app.patch("/api/v1/vessels/{identifier}", response_model=s.VesselOut)
    def patch_vessel(identifier: VesselId, body: s.RecordPatch, db: DB):
        vessel = require(db, m.Vessel, identifier)
        values, changed = merge_edit(body, fields(vessel), s.VesselEdit)
        if changed:
            for key in body.changes:
                setattr(vessel, key, values[key])
            commit(db)
        return vessel_view(db, vessel)

    @app.delete("/api/v1/vessels/{identifier}", status_code=204)
    def delete_vessel(identifier: VesselId, db: DB):
        vessel = require(db, m.Vessel, identifier)
        paths = [
            media / name for photo in vessel.photos for name in (photo.filename, photo.thumbnail)
        ]
        db.delete(vessel)
        commit(db)
        for path in paths:
            path.unlink(missing_ok=True)

    @app.post(
        "/api/v1/vessels/{identifier}/applications",
        response_model=s.ApplicationOut,
        status_code=201,
    )
    def add_application(identifier: VesselId, body: s.ApplicationInput, db: DB):
        require(db, m.Vessel, identifier)
        require(db, m.Glaze, body.glaze_id)
        application = m.GlazeApplication(vessel_id=identifier, **body.model_dump())
        db.add(application)
        commit(db)
        return application_view(db, application)

    def vessel_application(identifier, application_id, db):
        application = require(db, m.GlazeApplication, application_id)
        if application.vessel_id != identifier:
            raise HTTPException(404, "Glaze application not found on this vessel.")
        return application

    @app.get(
        "/api/v1/vessels/{identifier}/applications/{application_id}",
        response_model=s.ApplicationOut,
    )
    def get_application(identifier: VesselId, application_id: str, db: DB):
        return application_view(db, vessel_application(identifier, application_id, db))

    @app.patch(
        "/api/v1/vessels/{identifier}/applications/{application_id}",
        response_model=s.ApplicationOut,
    )
    def patch_application(identifier: VesselId, application_id: str, body: s.RecordPatch, db: DB):
        application = vessel_application(identifier, application_id, db)
        values, changed = merge_edit(body, fields(application), s.ApplicationInput)
        if changed:
            require(db, m.Glaze, values["glaze_id"])
            application.glaze_id = values["glaze_id"]
            application.application_note = values["application_note"]
            commit(db)
        return application_view(db, application)

    @app.delete("/api/v1/vessels/{identifier}/applications/{application_id}", status_code=204)
    def delete_application(identifier: VesselId, application_id: str, db: DB):
        db.delete(vessel_application(identifier, application_id, db))
        commit(db)

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

    def new_container(body: s.ContainerInput, db: Session):
        require(db, m.Glaze, body.glaze_id)
        values = body.model_dump(exclude={"tare_g", "full_weight_g", "cost_usd"})
        values["cost_cents"] = cents(body.cost_usd)
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
        db.flush()
        return item

    @app.post("/api/v1/containers", response_model=s.ContainerOut, status_code=201)
    def create_container(body: s.ContainerInput, db: DB):
        item = new_container(body, db)
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
            elif key == "cost_usd":
                item.cost_cents = cents(value)
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

    def record_weight(db: Session, item: m.Container, body: s.MeasurementInput, digest: str):
        gross_mg = milligrams(body.gross_g)
        if body.source == "device":
            initialize_starting_weight(db, item, gross_mg)
        measurement = m.Measurement(
            container_id=item.id,
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
        return response

    @app.post("/api/v1/containers/{identifier}/measurements", response_model=s.SaveResult)
    def weigh(identifier: str, body: s.MeasurementInput, db: DB):
        fields = body.model_dump(exclude=set() if body.manual_selection else {"manual_selection"})
        payload = json.dumps({"container_id": identifier, **fields}, sort_keys=True)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        prior = db.scalar(select(m.Measurement).where(m.Measurement.request_id == body.request_id))
        if prior:
            if prior.request_hash != digest:
                raise HTTPException(
                    409, "That request identifier was already used for a different reading."
                )
            return json.loads(prior.response_json)
        if db.get(m.JarSetupReceipt, body.request_id):
            raise HTTPException(409, "This request identifier already belongs to a jar setup.")
        item = require(db, m.Container, identifier)
        revision_check(item, body.expected_revision)
        if item.archived:
            raise HTTPException(409, "Restore this jar before weighing it.")
        if body.source == "device" and not body.manual_selection and item.tag_uid != body.tag_uid:
            raise HTTPException(409, "The tag association changed. Scan the jar again.")
        response = record_weight(db, item, body, digest)
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

    @app.get("/api/v1/device/jars/{number}", response_model=s.DeviceJarDetails)
    def device_jar(number: Annotated[int, PathParam(ge=1, le=9223372036854775807)], db: DB):
        item = db.scalar(select(m.Container).where(m.Container.number == number))
        if item is None:
            raise HTTPException(404, "Jar number not found.")
        glaze = require(db, m.Glaze, item.glaze_id)
        return {
            **device_view(db, item),
            "location": item.location,
            "product_code": glaze.product_code,
            "cone": glaze.cone,
            "tag_uid": item.tag_uid,
        }

    @app.get("/api/v1/device/options/{kind}", response_model=s.DeviceOptions)
    def device_options(
        kind: Literal["manufacturers", "glazes", "presets", "locations", "cones", "product-lines", "jars", "unlinked-jars"],
        db: DB,
        manufacturer_id: str | None = None,
        q: str = "",
        offset: int = Query(0, ge=0, le=2147483647),
    ):
        if kind == "jars":
            stmt = (
                select(m.Container.number, m.Glaze.name)
                .join(m.Glaze, m.Container.glaze_id == m.Glaze.id)
                .where(m.Container.archived.is_(False))
                .order_by(m.Container.number)
            )
            if q:
                match = m.Glaze.name.icontains(q, autoescape=True)
                number_query = q.removeprefix("#")
                if number_query.isascii() and number_query.isdecimal() and len(number_query) <= 19:
                    number = int(number_query)
                    if number <= 9223372036854775807:
                        match |= m.Container.number == number
                stmt = stmt.where(match)
            rows = [
                {"value": str(number), "label": f"#{number}  {name}"}
                for number, name in db.execute(stmt.offset(offset).limit(5))
            ]
        elif kind == "unlinked-jars":
            label = m.Glaze.name + func.coalesce(" (" + m.Glaze.product_code + ")", "")
            stmt = (
                select(m.Container.number, label)
                .join(m.Glaze, m.Container.glaze_id == m.Glaze.id)
                .where(m.Container.archived.is_(False), m.Container.tag_uid.is_(None))
                .order_by(func.lower(label), m.Container.number)
            )
            if q:
                stmt = stmt.where(label.icontains(q, autoescape=True))
            rows = [
                {"value": str(number), "label": caption}
                for number, caption in db.execute(stmt.offset(offset).limit(5))
            ]
        elif kind in {"locations", "cones", "product-lines"}:
            field = {"locations": "location", "cones": "cone", "product-lines": "product_line"}[kind]
            options = (
                {"value": value, "label": value}
                for value in suggestions(field, db)
                if q.casefold() in value.casefold()
            )
            rows = list(islice(options, offset, offset + 5))
        else:
            model = {"manufacturers": m.Manufacturer, "glazes": m.Glaze, "presets": m.Preset}[kind]
            columns = [model.id, model.name]
            if kind == "glazes":
                columns.append(m.Glaze.product_code)
            stmt = select(*columns)
            if kind == "glazes" and manufacturer_id is not None:
                stmt = stmt.where(m.Glaze.manufacturer_id == manufacturer_id)
            if q:
                match = model.name.icontains(q, autoescape=True)
                if kind == "glazes":
                    match |= m.Glaze.product_code.icontains(q, autoescape=True)
                stmt = stmt.where(match)
            stmt = stmt.order_by(func.lower(model.name), model.id).offset(offset).limit(5)
            rows = [
                {"value": row[0], "label": row[1], "code": row[2] if kind == "glazes" else None}
                for row in db.execute(stmt)
            ]
        # Leave room in the 4 KiB response buffer for the envelope and escaping.
        items, size = [], 0
        for row in rows[:4]:
            size += len(json.dumps(row, ensure_ascii=False).encode()) + 16
            if size > 3800:
                break
            items.append(row)
        next_offset = offset + len(items) if len(rows) > len(items) else None
        return {"items": items, "next_offset": next_offset}

    @app.post("/api/v1/device/jar-setups", response_model=s.DeviceSetupResult)
    def setup_jar(body: s.DeviceJarSetup, db: DB):
        fields = body.model_dump(mode="json", exclude={"new_glaze"} if body.new_glaze is None else set())
        payload = json.dumps(fields, sort_keys=True)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        receipt = db.get(m.JarSetupReceipt, body.request_id)
        if receipt:
            if receipt.request_hash != digest:
                raise HTTPException(409, "This request identifier belongs to another jar setup.")
            return json.loads(receipt.response_json)
        if db.scalar(select(m.Measurement.id).where(m.Measurement.request_id == body.request_id)):
            raise HTTPException(409, "This request identifier already belongs to a measurement.")
        if db.scalar(select(m.Container.id).where(m.Container.tag_uid == body.uid)):
            raise HTTPException(409, "This tag is already linked. Scan the jar again.")
        glaze_id = body.glaze_id
        if body.new_glaze is not None:
            if body.new_glaze.manufacturer_id is not None:
                require(db, m.Manufacturer, body.new_glaze.manufacturer_id)
            glaze = m.Glaze(**body.new_glaze.model_dump())
            db.add(glaze)
            db.flush()
            glaze_id = glaze.id
        jar = s.ContainerInput(
            glaze_id=glaze_id,
            preset_id=body.preset_id,
            location=body.location,
            cost_usd=body.cost_usd,
        )
        item = new_container(jar, db)
        item.tag_uid = body.uid
        reading = s.MeasurementInput(
            request_id=body.request_id,
            gross_g=body.gross_g,
            expected_revision=item.revision,
            source="device",
            device_id=body.device_id,
            tag_uid=body.uid,
        )
        result = {"number": item.number, **record_weight(db, item, reading, digest)}
        db.add(m.JarSetupReceipt(
            request_id=body.request_id, request_hash=digest, response_json=json.dumps(result)
        ))
        commit(db)
        return result

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

    def store_photo(db, file, photo, siblings):
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
        photo.id = str(uuid4())
        photo.filename, photo.thumbnail = f"{photo.id}.jpg", f"{photo.id}-thumb.jpg"
        photo.cover = db.scalar(siblings.limit(1)) is None
        try:
            image.save(media / photo.filename, quality=88)
            image.thumbnail((480, 480))
            image.save(media / photo.thumbnail, quality=82)
            db.add(photo)
            commit(db)
        except Exception:
            (media / photo.filename).unlink(missing_ok=True)
            (media / photo.thumbnail).unlink(missing_ok=True)
            raise
        return photo_view(photo)

    @app.post("/api/v1/glazes/{identifier}/photos", response_model=s.PhotoOut, status_code=201)
    def upload_photo(identifier: str, db: DB, file: UploadFile):
        require(db, m.Glaze, identifier)
        siblings = select(m.Photo.id).where(m.Photo.glaze_id == identifier)
        return store_photo(db, file, m.Photo(glaze_id=identifier), siblings)

    @app.post(
        "/api/v1/vessels/{identifier}/photos", response_model=s.VesselPhotoOut, status_code=201
    )
    def upload_vessel_photo(identifier: VesselId, db: DB, file: UploadFile):
        require(db, m.Vessel, identifier)
        siblings = select(m.VesselPhoto.id).where(m.VesselPhoto.vessel_id == identifier)
        return store_photo(db, file, m.VesselPhoto(vessel_id=identifier), siblings)

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

    def remove_photo(db, photo, siblings):
        paths = [media / photo.filename, media / photo.thumbnail]
        if photo.cover:
            model = type(photo)
            sibling = db.scalar(
                siblings.where(model.id != photo.id).order_by(model.created_at, model.id).limit(1)
            )
            if sibling:
                sibling.cover = True
        db.delete(photo)
        commit(db)
        for path in paths:
            path.unlink(missing_ok=True)

    @app.delete("/api/v1/photos/{identifier}", status_code=204)
    def delete_photo(identifier: str, db: DB):
        photo = require(db, m.Photo, identifier)
        remove_photo(db, photo, select(m.Photo).where(m.Photo.glaze_id == photo.glaze_id))

    @app.delete("/api/v1/vessels/{identifier}/photos/{photo_id}", status_code=204)
    def delete_vessel_photo(identifier: VesselId, photo_id: str, db: DB):
        photo = require(db, m.VesselPhoto, photo_id)
        if photo.vessel_id != identifier:
            raise HTTPException(404, "Photo not found on this vessel.")
        remove_photo(db, photo, select(m.VesselPhoto).where(m.VesselPhoto.vessel_id == identifier))

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
