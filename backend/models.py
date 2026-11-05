from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .domain import DEFAULT_LOW_STOCK_THRESHOLD_MG


def identity():
    return str(uuid4())


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class Manufacturer(Base):
    __tablename__ = "manufacturers"
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    name: Mapped[str] = mapped_column(String(200))
    website: Mapped[str | None]
    notes: Mapped[str | None] = mapped_column(Text)


class Glaze(Base):
    __tablename__ = "glazes"
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    manufacturer_id: Mapped[str] = mapped_column(ForeignKey("manufacturers.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    product_code: Mapped[str | None]
    product_line: Mapped[str | None]
    cone: Mapped[str | None]
    classification: Mapped[str | None]
    product_url: Mapped[str | None]
    notes: Mapped[str | None] = mapped_column(Text)


class Preset(Base):
    __tablename__ = "presets"
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    name: Mapped[str] = mapped_column(String(200))
    tare_mg: Mapped[int | None] = mapped_column(Integer)


class Container(Base):
    __tablename__ = "containers"
    __table_args__ = (UniqueConstraint("number", name="uq_containers_number"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    number: Mapped[int] = mapped_column(Integer)
    glaze_id: Mapped[str] = mapped_column(ForeignKey("glazes.id"), index=True)
    preset_id: Mapped[str | None] = mapped_column(ForeignKey("presets.id"))
    location: Mapped[str | None] = mapped_column(index=True)
    cost_cents: Mapped[int | None]
    notes: Mapped[str | None] = mapped_column(Text)
    tare_mg: Mapped[int | None] = mapped_column(Integer)
    full_weight_mg: Mapped[int | None] = mapped_column(Integer)
    tag_uid: Mapped[str | None] = mapped_column(String(64), unique=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(default=timestamp)


class RetiredJarNumber(Base):
    __tablename__ = "retired_jar_numbers"
    number: Mapped[int] = mapped_column(primary_key=True)


class Measurement(Base):
    __tablename__ = "measurements"
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    container_id: Mapped[str] = mapped_column(ForeignKey("containers.id"), index=True)
    gross_mg: Mapped[int] = mapped_column(Integer)
    tare_mg: Mapped[int | None] = mapped_column(Integer)
    full_weight_mg: Mapped[int | None] = mapped_column(Integer)
    measured_at: Mapped[str] = mapped_column(default=timestamp, index=True)
    source: Mapped[str]
    device_id: Mapped[str | None]
    note: Mapped[str | None] = mapped_column(Text)
    voided: Mapped[bool] = mapped_column(default=False)
    void_reason: Mapped[str | None]
    request_id: Mapped[str] = mapped_column(unique=True)
    request_hash: Mapped[str]
    response_json: Mapped[str] = mapped_column(Text, default="{}")


class Photo(Base):
    __tablename__ = "photos"
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    glaze_id: Mapped[str] = mapped_column(ForeignKey("glazes.id"), index=True)
    filename: Mapped[str]
    thumbnail: Mapped[str]
    caption: Mapped[str | None]
    cover: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(default=timestamp)


class Setting(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    low_stock_threshold_mg: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_LOW_STOCK_THRESHOLD_MG, server_default="150000"
    )


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(primary_key=True)
    tag_uid: Mapped[str]
    last_seen: Mapped[str] = mapped_column(default=timestamp)
