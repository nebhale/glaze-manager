"""Page device choices by the exact JSON bytes the scale will receive."""
import json

from fastapi.responses import Response


def option_page(rows, offset, budget=4096):
    rows = iter(rows)
    parts = []
    start = b'{"items":['
    middle = b'],"next_offset":'
    size = len(start) + len(middle) + 1
    row = next(rows, None)
    while row is not None:
        following = next(rows, None)
        cursor = str(offset + len(parts) + 1).encode() if following is not None else b"null"
        encoded = encode(row)
        if not parts and size + len(encoded) + len(cursor) > budget and "detail" in row:
            encoded = encode({key: value for key, value in row.items() if key != "detail"})
        added = len(encoded) + bool(parts)
        if size + added + len(cursor) > budget:
            if not parts:
                raise ValueError("A basic device option exceeds the response budget")
            break
        parts.append(encoded)
        size += added
        row = following
    cursor = str(offset + len(parts)).encode() if row is not None else b"null"
    return Response(start + b",".join(parts) + middle + cursor + b"}", media_type="application/json")


def encode(row):
    return json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()

