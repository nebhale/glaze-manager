from datetime import datetime, timezone
from typing import ClassVar
from uuid import uuid4

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    manufacturer_id: Mapped[str | None] = mapped_column(ForeignKey("manufacturers.id"), index=True)
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


class JarSetupReceipt(Base):
    # Survive jar deletion so a delayed retry cannot recreate a retired jar.
    __tablename__ = "jar_setup_receipts"
    request_id: Mapped[str] = mapped_column(primary_key=True)
    request_hash: Mapped[str]
    response_json: Mapped[str] = mapped_column(Text)


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


class Vessel(Base):
    __tablename__ = "vessels"
    # Keep retired vessel numbers retired.
    __table_args__: ClassVar = {"sqlite_autoincrement": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str | None]
    source_url: Mapped[str | None]
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    photos: Mapped[list["VesselPhoto"]] = relationship(
        order_by=lambda: (VesselPhoto.cover.desc(), VesselPhoto.created_at, VesselPhoto.id),
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class GlazeApplication(Base):
    __tablename__ = "glaze_applications"
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    vessel_id: Mapped[int] = mapped_column(ForeignKey("vessels.id", ondelete="CASCADE"), index=True)
    glaze_id: Mapped[str] = mapped_column(ForeignKey("glazes.id"), index=True)
    application_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(default=timestamp)


class PhotoFields:
    id: Mapped[str] = mapped_column(primary_key=True, default=identity)
    filename: Mapped[str]
    thumbnail: Mapped[str]
    caption: Mapped[str | None]
    cover: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(default=timestamp)


class Photo(PhotoFields, Base):
    __tablename__ = "photos"
    glaze_id: Mapped[str] = mapped_column(ForeignKey("glazes.id"), index=True)


class VesselPhoto(PhotoFields, Base):
    __tablename__ = "vessel_photos"
    vessel_id: Mapped[int] = mapped_column(ForeignKey("vessels.id", ondelete="CASCADE"), index=True)


class Setting(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    low_stock_threshold_mg: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_LOW_STOCK_THRESHOLD_MG, server_default="150000"
    )


class KilnfireConnection(Base):
    __tablename__ = "kilnfire_connection"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    endpoint: Mapped[str]
    # Only opaque authentication cookies are retained, never login credentials.
    cookies: Mapped[str | None] = mapped_column(Text)
    needs_login: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_at: Mapped[str | None]


class KilnfirePiece(Base):
    __tablename__ = "kilnfire_pieces"
    endpoint: Mapped[str] = mapped_column(primary_key=True)
    piece_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    firing_type: Mapped[str | None]
    created_at: Mapped[str | None]
    images: Mapped[str] = mapped_column(Text, default="[]")
    # Preserve existing archive choices under the original column name.
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    vessel_id: Mapped[int | None] = mapped_column(
        ForeignKey("vessels.id", ondelete="SET NULL"), unique=True, index=True
    )


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(primary_key=True)
    tag_uid: Mapped[str]
    last_seen: Mapped[str] = mapped_column(default=timestamp)
