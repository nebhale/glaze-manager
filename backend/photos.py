import io

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError


def encode_photo(content):
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, "Choose a photo smaller than 25 MB.")
    try:
        with Image.open(io.BytesIO(content)) as original:
            if original.format not in {"JPEG", "PNG", "WEBP", "HEIF", "HEIC"}:
                raise ValueError("Unsupported image format")
            image = ImageOps.exif_transpose(original).convert("RGB")
        image.thumbnail((3000, 3000))
        full, thumb = io.BytesIO(), io.BytesIO()
        image.save(full, format="JPEG", quality=88)
        image.thumbnail((480, 480))
        image.save(thumb, format="JPEG", quality=82)
        return full.getvalue(), thumb.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(422, "Choose a valid JPEG, PNG, WebP, or HEIC photo.") from None
