import asyncio
import json
import threading

from fastapi import HTTPException
from sqlalchemy import select

from . import models as m
from .domain import DEFAULT_LOW_STOCK_THRESHOLD_MG, dollars, grams, net_weight, stock


class Events:
    """One-process notification bus. Clients refetch authoritative state on reconnect."""

    def __init__(self):
        self.listeners = set()
        self.lock = threading.Lock()

    def subscribe(self):
        queue = asyncio.Queue(maxsize=64)
        item = (asyncio.get_running_loop(), queue)
        with self.lock:
            self.listeners.add(item)
        return item

    def unsubscribe(self, item):
        with self.lock:
            self.listeners.discard(item)

    def publish(self, kind="inventory"):
        def enqueue(queue):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(json.dumps({"type": kind}))

        with self.lock:
            for loop, queue in self.listeners:
                if not loop.is_closed():
                    loop.call_soon_threadsafe(enqueue, queue)


def require(db, model, identifier):
    obj = db.get(model, identifier)
    if obj is None:
        raise HTTPException(404, "Record not found.")
    return obj


def fields(obj):
    return {column.name: getattr(obj, column.name) for column in obj.__table__.columns}


def photo_view(photo):
    owner = (
        {"vessel_id": photo.vessel_id}
        if isinstance(photo, m.VesselPhoto)
        else {"glaze_id": photo.glaze_id}
    )
    return {
        "id": photo.id,
        **owner,
        "url": f"/media/{photo.filename}",
        "thumbnail_url": f"/media/{photo.thumbnail}",
        "caption": photo.caption,
        "cover": photo.cover,
    }


def vessel_summary(vessel):
    return {**fields(vessel), "photos": [photo_view(photo) for photo in vessel.photos]}


def glaze_references():
    return select(
        m.Glaze.id.label("glaze_id"),
        m.Glaze.name.label("glaze_name"),
        m.Manufacturer.name.label("manufacturer_name"),
        m.Glaze.product_code,
    ).outerjoin(m.Manufacturer, m.Manufacturer.id == m.Glaze.manufacturer_id)


def applications_query():
    return (
        glaze_references()
        .join(m.GlazeApplication, m.GlazeApplication.glaze_id == m.Glaze.id)
        .add_columns(m.GlazeApplication.id, m.GlazeApplication.application_note)
    )


def application_view(db, application):
    query = applications_query().where(m.GlazeApplication.id == application.id)
    return db.execute(query).mappings().one()


def vessel_view(db, vessel):
    query = (
        applications_query()
        .where(m.GlazeApplication.vessel_id == vessel.id)
        .order_by(m.GlazeApplication.created_at, m.GlazeApplication.id)
    )
    return {**vessel_summary(vessel), "applications": db.execute(query).mappings().all()}


def manufacturer_name(db, glaze):
    if glaze.manufacturer_id is None:
        return None
    return require(db, m.Manufacturer, glaze.manufacturer_id).name


def glaze_view(db, glaze):
    return {
        **fields(glaze),
        "manufacturer_name": manufacturer_name(db, glaze),
        "photos": [
            photo_view(p)
            for p in db.scalars(
                select(m.Photo)
                .where(m.Photo.glaze_id == glaze.id)
                .order_by(m.Photo.cover.desc(), m.Photo.created_at)
            )
        ],
    }


def latest_measurement(db, container):
    return db.scalar(
        select(m.Measurement)
        .where(m.Measurement.container_id == container.id, m.Measurement.voided.is_(False))
        .order_by(m.Measurement.measured_at.desc(), m.Measurement.id.desc())
        .limit(1)
    )


def initialize_starting_weight(db, container, gross_mg):
    """Capture the first scale reading as a gross starting weight."""
    if container.full_weight_mg is not None or gross_mg <= 0:
        return
    previous_scan = db.scalar(
        select(m.Measurement.id)
        .where(m.Measurement.container_id == container.id, m.Measurement.source == "device")
        .limit(1)
    )
    if previous_scan is None:
        container.full_weight_mg = gross_mg


def container_stock(db, container):
    latest = latest_measurement(db, container)
    setting = db.get(m.Setting, 1)
    result = stock(
        latest.gross_mg if latest else None,
        container.tare_mg,
        container.full_weight_mg,
        setting.low_stock_threshold_mg if setting else DEFAULT_LOW_STOCK_THRESHOLD_MG,
    )
    if container.archived:
        result["low_stock"] = False
    return result


def container_view(db, container):
    result = fields(container)
    result["cost_usd"] = dollars(result.pop("cost_cents"))
    result["starting_net_g"] = grams(net_weight(container.full_weight_mg, container.tare_mg))
    result["tare_g"] = grams(result.pop("tare_mg"))
    result["full_weight_g"] = grams(result.pop("full_weight_mg"))
    latest = latest_measurement(db, container)
    return {
        **result,
        **container_stock(db, container),
        "glaze": glaze_view(db, require(db, m.Glaze, container.glaze_id)),
        "last_weighed_at": latest.measured_at if latest else None,
    }


def device_view(db, container):
    glaze = require(db, m.Glaze, container.glaze_id)
    return {
        "container_id": container.id,
        "number": container.number,
        "revision": container.revision,
        "glaze_name": glaze.name,
        "manufacturer_name": manufacturer_name(db, glaze),
        "tare_g": grams(container.tare_mg),
        "full_weight_g": grams(container.full_weight_mg),
        "archived": container.archived,
        **container_stock(db, container),
    }


def lookup(db, uid):
    container = db.scalar(select(m.Container).where(m.Container.tag_uid == uid))
    return {"uid": uid, "container": device_view(db, container) if container else None}


def measurement_view(measurement):
    return {
        "id": measurement.id,
        "container_id": measurement.container_id,
        "tare_g": grams(measurement.tare_mg),
        "full_weight_g": grams(measurement.full_weight_mg),
        "measured_at": measurement.measured_at,
        "source": measurement.source,
        "device_id": measurement.device_id,
        "note": measurement.note,
        "voided": measurement.voided,
        "void_reason": measurement.void_reason,
        **stock(measurement.gross_mg, measurement.tare_mg, measurement.full_weight_mg),
    }


def preset_view(preset):
    return {"id": preset.id, "name": preset.name, "tare_g": grams(preset.tare_mg)}


def page(items, number, size):
    return {
        "items": items[(number - 1) * size : number * size],
        "total": len(items),
        "page": number,
        "page_size": size,
    }
