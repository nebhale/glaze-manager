import re
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException

DEFAULT_LOW_STOCK_THRESHOLD_MG = 150_000

CONES = (
    [f"0{n}" for n in range(22, 5, -1)]
    + ["05½", "05", "04", "03", "02", "01"]
    + [str(n) for n in range(1, 6)]
    + ["5½"]
    + [str(n) for n in range(6, 15)]
)


def matches_cone(stored: str | None, query: str) -> bool:
    if not stored:
        return False
    if stored.casefold() == query.strip().casefold():
        return True
    # Existing range filters still match individual firing cones in a range.
    low, _, high = stored.partition("/")
    return (
        low in CONES
        and high in CONES
        and query in CONES
        and CONES.index(low) <= CONES.index(query) <= CONES.index(high)
    )


def normalize_uid(value: str):
    uid = re.sub(r"[\s:\-]", "", value).upper()
    if not re.fullmatch(r"(?:[0-9A-F]{2}){2,16}", uid):
        raise ValueError("Use a hexadecimal NFC UID, with 4–32 digits.")
    return uid


def milligrams(value):
    if value is None:
        return None
    return int((Decimal(str(value)) * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def grams(value):
    return None if value is None else value / 1000


def net_weight(gross_mg, tare_mg):
    return None if gross_mg is None or tare_mg is None else max(gross_mg - tare_mg, 0)


def stock(gross_mg, tare_mg, full_weight_mg, threshold_mg=DEFAULT_LOW_STOCK_THRESHOLD_MG):
    net = net_weight(gross_mg, tare_mg)
    starting_net = net_weight(full_weight_mg, tare_mg)
    percent = None if net is None or not starting_net else net / starting_net * 100
    return {
        "gross_g": grams(gross_mg),
        "remaining_g": grams(net),
        "percentage": None if percent is None else round(percent, 3),
        "low_stock": net is not None and net < threshold_mg,
        "incomplete": net is None,
        "below_tare": gross_mg is not None and tare_mg is not None and gross_mg < tare_mg,
        "threshold_g": grams(threshold_mg),
    }


def revision_check(record, revision):
    if record.revision != revision:
        raise HTTPException(409, "This jar changed. Reload it and confirm again.")
