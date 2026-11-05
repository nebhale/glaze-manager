import io

from PIL import Image


def test_heic_input_is_converted_to_jpeg(client, catalog):
    buffer = io.BytesIO()
    Image.new("RGB", (30, 40), "purple").save(buffer, format="HEIF")
    result = client.post(
        f"/api/v1/glazes/{catalog['glaze']['id']}/photos",
        files={"file": ("phone.heic", buffer.getvalue(), "image/heic")},
    )
    assert result.status_code == 201
    with Image.open(io.BytesIO(client.get(result.json()["url"]).content)) as photo:
        assert photo.format == "JPEG" and photo.size == (30, 40)


def test_photo_orientation_and_metadata(client, catalog):
    image = Image.new("RGB", (30, 40), "purple")
    exif = image.getexif()
    exif[274] = 6  # Rotate 90 degrees clockwise, as with a phone camera.
    exif[315] = "Private camera owner"
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    result = client.post(
        f"/api/v1/glazes/{catalog['glaze']['id']}/photos",
        files={"file": ("phone.jpg", buffer.getvalue(), "image/jpeg")},
    )
    assert result.status_code == 201
    with Image.open(io.BytesIO(client.get(result.json()["url"]).content)) as photo:
        assert photo.size == (40, 30)
        assert not photo.getexif()
