from decimal import Decimal
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

from .domain import normalize_uid

Name = Annotated[str, Field(min_length=1, max_length=200)]
DeviceID = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_.:-]{1,64}$")]
TagUID = Annotated[str, AfterValidator(normalize_uid)]
DollarAmount = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Text = Annotated[str, Field(max_length=20000)]
Weight = Annotated[float, Field(ge=0, le=10000000, allow_inf_nan=False)]
FullWeight = Annotated[
    float,
    Field(
        ge=0.001,
        le=10000000,
        allow_inf_nan=False,
        description="Gross starting weight in grams, including the container.",
    ),
]


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RecordPatch(Schema):
    """Field-level edits with compare-and-set protection against lost updates."""

    changes: dict[str, str | float | bool | None] = Field(min_length=1)
    expected: dict[str, str | float | bool | None]

    @model_validator(mode="after")
    def matching_fields(self):
        if self.changes.keys() != self.expected.keys():
            raise ValueError("Provide the previous value for every changed field.")
        return self


class ManufacturerInput(Schema):
    name: Name
    website: str | None = None
    notes: Text | None = None

    @field_validator("website")
    @classmethod
    def url(cls, value):
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("Use an http:// or https:// URL.")
        return value or None


class ManufacturerOut(ManufacturerInput):
    id: str


class GlazeInput(Schema):
    manufacturer_id: str | None = None
    name: Name
    product_code: Name | None = None
    product_line: Name | None = None
    cone: Name | None = None
    classification: Literal["glaze", "underglaze", "other"] | None = None
    product_url: str | None = None
    notes: Text | None = None

    @field_validator("product_url")
    @classmethod
    def url(cls, value):
        return ManufacturerInput.url(value)


class PhotoAsset(Schema):
    id: str
    url: str
    thumbnail_url: str
    caption: str | None
    cover: bool


class PhotoOut(PhotoAsset):
    glaze_id: str


class VesselPhotoOut(PhotoAsset):
    vessel_id: int


class VesselInput(Schema):
    name: Name
    location: Name | None = None


class VesselEdit(VesselInput):
    archived: bool


class VesselSummary(VesselEdit):
    id: int
    source_url: Annotated[
        str | None, Field(max_length=2000, json_schema_extra={"readOnly": True})
    ] = None
    photos: list[VesselPhotoOut]


class ApplicationInput(Schema):
    glaze_id: str
    application_note: Annotated[str, Field(max_length=2000)] | None = None


class GlazeReference(Schema):
    glaze_id: str
    glaze_name: str
    manufacturer_name: str | None
    product_code: str | None


class ApplicationOut(GlazeReference):
    id: str
    application_note: str | None


class KilnfireLink(Schema):
    endpoint: str
    piece_id: int


class VesselOut(VesselSummary):
    applications: list[ApplicationOut]
    kilnfire_link: KilnfireLink | None = None


class KilnfireEndpoint(Schema):
    endpoint: str

    @field_validator("endpoint")
    @classmethod
    def studio_endpoint(cls, value):
        from .kilnfire import normalize_endpoint

        return normalize_endpoint(value)


class KilnfireLogin(Schema):
    email: Annotated[str, Field(min_length=1, max_length=254)]
    password: SecretStr = Field(min_length=1, max_length=4096)


class KilnfireStatus(Schema):
    endpoint: str | None = None
    state: Literal["not_configured", "signed_out", "connected", "needs_login"]
    checked_at: str | None = None


class KilnfireCandidate(Schema):
    piece_id: int
    name: str
    firing_type: str | None
    created_at: str | None
    url: str
    thumbnail_url: str | None
    image_count: int
    archived: bool


class KilnfireRefresh(Schema):
    count: int


class KilnfireArchive(KilnfireEndpoint):
    archived: bool


class KilnfireImport(KilnfireEndpoint):
    vessel_id: Annotated[int, Field(ge=1, le=9223372036854775807)] | None = None
    expected_name: str | None = None


class KilnfireVesselOption(Schema):
    id: int
    name: str
    archived: bool


class GlazeOut(GlazeInput):
    id: str
    manufacturer_name: str | None
    photos: list[PhotoOut]


class GlazeDetailOut(GlazeOut):
    vessels: list[VesselSummary]


class PresetInput(Schema):
    name: Name
    tare_g: Weight | None = None


class PresetOut(PresetInput):
    id: str


class ContainerInput(Schema):
    glaze_id: str
    preset_id: str | None = None
    location: Name | None = None
    cost_usd: DollarAmount | None = None
    notes: Text | None = None
    tare_g: Weight | None = None
    full_weight_g: FullWeight | None = None


class ContainerEdit(Schema):
    glaze_id: str | None = None
    expected_revision: int
    preset_id: str | None = None
    location: Name | None = None
    cost_usd: DollarAmount | None = None
    notes: Text | None = None
    tare_g: Weight | None = None
    full_weight_g: FullWeight | None = None
    archived: bool | None = None


class StockOut(Schema):
    gross_g: float | None
    remaining_g: float | None
    percentage: float | None
    low_stock: bool
    incomplete: bool
    below_tare: bool
    threshold_g: Weight


class ContainerOut(ContainerInput, StockOut):
    starting_net_g: float | None
    id: str
    number: int
    tag_uid: str | None
    archived: bool
    revision: int
    created_at: str
    last_weighed_at: str | None
    glaze: GlazeOut


class MeasurementInput(Schema):
    request_id: Annotated[str, Field(min_length=8, max_length=100)]
    gross_g: Weight
    expected_revision: int
    source: Literal["web", "device"] = "web"
    device_id: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    tag_uid: str | None = None
    manual_selection: bool = False
    note: Text | None = None

    @field_validator("tag_uid")
    @classmethod
    def tag(cls, value):
        return normalize_uid(value) if value is not None else None

    @model_validator(mode="after")
    def device(self):
        if self.manual_selection:
            if self.source != "device" or not self.device_id or self.tag_uid is not None:
                raise ValueError("Manual jar selection requires a device ID and no scanned tag.")
        elif self.source == "device" and (not self.device_id or not self.tag_uid):
            raise ValueError("Device measurements require device_id and tag_uid.")
        return self


class MeasurementOut(StockOut):
    id: str
    container_id: str
    tare_g: float | None
    full_weight_g: float | None
    measured_at: str
    source: str
    device_id: str | None
    note: str | None
    voided: bool
    void_reason: str | None


class SaveResult(Schema):
    measurement_id: str
    container_id: str
    revision: int
    stock: StockOut


class ScanInput(Schema):
    device_id: DeviceID
    uid: TagUID


class DeviceJar(StockOut):
    number: int
    container_id: str
    revision: int
    glaze_name: str
    manufacturer_name: str | None
    tare_g: float | None
    full_weight_g: float | None
    archived: bool


class DeviceJarDetails(DeviceJar):
    location: str | None
    product_code: str | None
    cone: str | None
    tag_uid: str | None


class DeviceJarSetup(Schema):
    device_id: DeviceID
    uid: TagUID | None = None
    request_id: Annotated[str, Field(min_length=8, max_length=100)]
    glaze_id: str | None = None
    new_glaze: GlazeInput | None = None
    preset_id: str | None = None
    location: Name | None = None
    cost_usd: DollarAmount | None = None
    gross_g: Weight

    @model_validator(mode="after")
    def choose_glaze(self):
        if (self.glaze_id is None) == (self.new_glaze is None):
            raise ValueError("Choose an existing glaze or supply a new glaze.")
        return self


class DeviceSetupResult(SaveResult):
    number: int


class PickerJar(Schema):
    container_id: str
    number: int
    revision: int
    glaze_name: str
    product_code: str | None
    manufacturer_name: str | None
    tare_g: float | None
    full_weight_g: float | None
    threshold_g: float
    tag_uid: str | None


class DeviceOption(Schema):
    value: str
    label: str
    code: str | None = None
    detail: PickerJar | None = None


class DeviceOptions(Schema):
    items: list[DeviceOption]
    next_offset: int | None


class LookupOut(Schema):
    uid: str
    container: DeviceJar | None


class ScanOut(LookupOut):
    device_id: str
    last_seen: str


class BindInput(Schema):
    container_id: str
    expected_revision: int
    move: bool = False
    replace: bool = False


class RevisionInput(Schema):
    expected_revision: int


class VoidInput(RevisionInput):
    reason: Annotated[str, Field(min_length=1, max_length=2000)]


class SettingsInput(Schema):
    low_stock_threshold_g: Weight


class PhotoEdit(Schema):
    caption: Annotated[str, Field(max_length=2000)] | None = None
    cover: bool = False


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
