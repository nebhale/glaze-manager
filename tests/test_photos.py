import io

import pytest
from PIL import Image


@pytest.mark.parametrize("resource", ["glazes", "vessels"])
def test_upload_replaces_key_photo_even_after_manual_selection(client, catalog, resource):
    glaze = catalog["glaze"]
    vessel = client.post("/api/v1/vessels", json={"name": "Bowl"}).json()
    owners = {"glazes": glaze, "vessels": vessel}
    other_resource = "vessels" if resource == "glazes" else "glazes"
    path = f"/api/v1/{resource}/{owners[resource]['id']}"
    other_path = f"/api/v1/{other_resource}/{owners[other_resource]['id']}"
    neighbor = client.post(f"/api/v1/{resource}", json={"name": "Other"}).json()
    neighbor_path = f"/api/v1/{resource}/{neighbor['id']}"
    buffer = io.BytesIO()
    Image.new("RGB", (30, 40), "purple").save(buffer, format="PNG")

    def upload(owner_path):
        result = client.post(
            f"{owner_path}/photos",
            files={"file": ("tile.png", buffer.getvalue(), "image/png")},
        )
        assert result.status_code == 201
        assert result.json()["cover"] is True
        return result.json()

    def selected():
        return [photo["id"] for photo in client.get(path).json()["photos"] if photo["cover"]]

    other = upload(other_path)
    neighbor_photo = upload(neighbor_path)
    first = upload(path)
    assert selected() == [first["id"]]
    second = upload(path)
    assert selected() == [second["id"]]
    edit_path = f"{path}/photos" if resource == "vessels" else "/api/v1/photos"
    client.patch(f"{edit_path}/{first['id']}", json={"cover": True}).raise_for_status()
    assert selected() == [first["id"]]
    third = upload(path)
    assert selected() == [third["id"]]
    invalid = client.post(
        f"{path}/photos", files={"file": ("invalid.png", b"invalid", "image/png")}
    )
    assert invalid.status_code == 422
    assert selected() == [third["id"]]
    assert len(client.get(path).json()["photos"]) == 3
    assert client.get(other_path).json()["photos"] == [other]
    assert client.get(neighbor_path).json()["photos"] == [neighbor_photo]


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


@pytest.mark.parametrize("resource", ["glazes", "vessels"])
def test_photo_library_jpeg_with_auxiliary_image(client, catalog, resource):
    owner = (
        catalog["glaze"]
        if resource == "glazes"
        else client.post("/api/v1/vessels", json={"name": "Mug"}).json()
    )
    image = Image.new("RGB", (600, 900), "purple")
    exif = image.getexif()
    exif[274] = 6
    exif[315] = "Private camera owner"
    buffer = io.BytesIO()
    # Photo Library JPEGs can contain an auxiliary image, such as an HDR gain map.
    image.save(
        buffer,
        format="MPO",
        save_all=True,
        append_images=[Image.new("L", (300, 450), "white")],
        exif=exif,
    )
    with Image.open(io.BytesIO(buffer.getvalue())) as original:
        assert original.format == "MPO" and original.n_frames == 2
    result = client.post(
        f"/api/v1/{resource}/{owner['id']}/photos",
        files={"file": ("IMG_1234.JPG", buffer.getvalue(), "image/jpeg")},
    )
    assert result.status_code == 201
    assert result.json()["cover"] is True
    for field, size in [("url", (900, 600)), ("thumbnail_url", (480, 320))]:
        response = client.get(result.json()[field])
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        with Image.open(io.BytesIO(response.content)) as photo:
            assert photo.format == "JPEG" and photo.size == size
            assert photo.getpixel((0, 0)) == pytest.approx((128, 0, 128), abs=3)
            assert not photo.getexif()
            assert "mp" not in photo.info


@pytest.mark.parametrize("resource", ["glazes", "vessels"])
@pytest.mark.parametrize("image_format", ["GIF", "TIFF"])
def test_unsupported_photo_format_is_rejected(client, catalog, resource, image_format):
    owner = (
        catalog["glaze"]
        if resource == "glazes"
        else client.post("/api/v1/vessels", json={"name": "Mug"}).json()
    )
    buffer = io.BytesIO()
    Image.new("RGB", (30, 40), "purple").save(buffer, format=image_format)
    result = client.post(
        f"/api/v1/{resource}/{owner['id']}/photos",
        files={"file": ("photo.jpg", buffer.getvalue(), "image/jpeg")},
    )
    assert result.status_code == 422
    assert client.get(f"/api/v1/{resource}/{owner['id']}").json()["photos"] == []


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
