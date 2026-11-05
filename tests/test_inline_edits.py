import pytest


def patch(client, path, changes, expected):
    return client.patch(f"/api/v1{path}", json={"changes": changes, "expected": expected})


def test_unrelated_glaze_edits_merge_and_stale_same_field_conflicts(client, catalog, jar):
    path = f"/glazes/{catalog['glaze']['id']}"
    assert patch(client, path, {"product_code": "PC-20"}, {"product_code": None}).status_code == 200
    response = patch(client, path, {"product_line": "Celadon"}, {"product_line": None})
    assert response.status_code == 200
    assert response.json()["product_code"] == "PC-20"
    assert patch(client, path, {"product_code": "PC-56"}, {"product_code": None}).status_code == 409
    before = client.get(f"/api/v1/containers/{jar['id']}").json()["revision"]
    # Lost acknowledgements can be replayed without changing the record again.
    assert patch(client, path, {"product_code": "PC-20"}, {"product_code": None}).status_code == 200
    assert client.get(f"/api/v1/containers/{jar['id']}").json()["revision"] == before


@pytest.mark.parametrize(
    "changes,expected",
    [
        ({"name": None}, {"name": "Blue Rutile"}),
        ({"name": "  "}, {"name": "Blue Rutile"}),
        ({"cone": "x" * 201}, {"cone": "5/6"}),
        ({"product_url": "javascript:alert(1)"}, {"product_url": None}),
        ({"low_stock_threshold_g": 100}, {"low_stock_threshold_g": None}),
        ({"id": "new"}, {"id": "old"}),
        ({"name": "Changed"}, {}),
        ({}, {}),
    ],
)
def test_patch_validates_complete_record_and_expected_fields(client, catalog, changes, expected):
    path = f"/glazes/{catalog['glaze']['id']}"
    assert patch(client, path, changes, expected).status_code == 422
    assert client.get(f"/api/v1{path}").json()["name"] == "Blue Rutile"


def test_cone_text_can_be_changed_and_cleared(client, catalog):
    path = f"/glazes/{catalog['glaze']['id']}"
    assert patch(client, path, {"cone": "04/02"}, {"cone": "5/6"}).status_code == 200
    assert client.get("/api/v1/suggestions/cone").json() == ["04/02"]
    response = patch(client, path, {"cone": None}, {"cone": "04/02"})
    assert response.status_code == 200
    assert response.json()["cone"] is None
    assert client.get("/api/v1/suggestions/cone").json() == []


def test_manufacturer_and_preset_partial_edits_preserve_other_fields(client, catalog):
    maker = f"/manufacturers/{catalog['manufacturer']['id']}"
    assert (
        patch(client, maker, {"website": "https://example.com"}, {"website": None}).status_code
        == 200
    )
    assert patch(client, maker, {"name": "New name"}, {"name": "AMACO"}).status_code == 200
    assert client.get(f"/api/v1{maker}").json()["website"] == "https://example.com"
    preset = f"/presets/{catalog['preset']['id']}"
    assert patch(client, preset, {"tare_g": 95.125}, {"tare_g": 100}).status_code == 200
    assert patch(client, preset, {"name": "Updated"}, {"name": "Pint jar"}).status_code == 200
    assert client.get(f"/api/v1{preset}").json()["tare_g"] == 95.125
    assert patch(client, preset, {"name": None}, {"name": "Updated"}).status_code == 422


def test_threshold_patch_updates_stock_and_rejects_stale_edits(client, jar):
    response = patch(
        client, "/settings", {"low_stock_threshold_g": 250}, {"low_stock_threshold_g": 150}
    )
    assert response.status_code == 200
    assert client.get(f"/api/v1/containers/{jar['id']}").json()["threshold_g"] == 250
    assert (
        patch(
            client, "/settings", {"low_stock_threshold_g": 200}, {"low_stock_threshold_g": 150}
        ).status_code
        == 409
    )
    assert (
        patch(
            client, "/settings", {"low_stock_threshold_g": 0}, {"low_stock_threshold_g": 250}
        ).status_code
        == 200
    )


def test_caption_patch_preserves_cover_and_detects_conflicts(client, catalog):
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), "purple").save(buffer, format="PNG")
    photo = client.post(
        f"/api/v1/glazes/{catalog['glaze']['id']}/photos",
        files={"file": ("tile.png", buffer.getvalue(), "image/png")},
    ).json()
    path = f"/photos/{photo['id']}/caption"
    response = patch(client, path, {"caption": "Cone 6"}, {"caption": None})
    assert response.status_code == 200
    assert response.json()["cover"] is True
    assert client.get(f"/api/v1{path}").json()["caption"] == "Cone 6"
    assert patch(client, path, {"caption": "Cone 5"}, {"caption": None}).status_code == 409
    assert patch(client, path, {"caption": None}, {"caption": "Cone 6"}).status_code == 200
    assert patch(client, path, {"cover": False}, {"cover": True}).status_code == 422
