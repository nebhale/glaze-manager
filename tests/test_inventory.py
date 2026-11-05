import io
import shutil
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import create_app
from backend.domain import CONES


def weigh(client, jar, gross, **extra):
    return client.post(
        f"/api/v1/containers/{jar['id']}/measurements",
        json={
            "request_id": str(uuid4()),
            "expected_revision": jar["revision"],
            "gross_g": gross,
            **extra,
        },
    )


def get_jar(client, jar):
    return client.get(f"/api/v1/containers/{jar['id']}").json()


def test_jar_weight_settings_and_history(client, catalog, jar):
    assert jar["tare_g"] == 100 and jar["full_weight_g"] == 500
    assert jar["incomplete"] and jar["percentage"] is None
    result = weigh(client, jar, 250)
    assert result.status_code == 200
    assert result.json()["stock"]["remaining_g"] == 150
    assert result.json()["stock"]["percentage"] == 37.5
    assert not result.json()["stock"]["low_stock"]
    history = client.get(f"/api/v1/containers/{jar['id']}/measurements").json()
    assert history[0]["tare_g"] == 100
    client.put(
        f"/api/v1/presets/{catalog['preset']['id']}", json={"name": "New weight", "tare_g": 110}
    )
    current = get_jar(client, jar)
    assert current["tare_g"] == 100 and current["full_weight_g"] == 500
    assert current["percentage"] == 37.5
    edited = client.patch(
        f"/api/v1/containers/{jar['id']}",
        json={"expected_revision": current["revision"], "tare_g": 110, "full_weight_g": 600},
    ).json()
    assert edited["remaining_g"] == 140
    history = client.get(f"/api/v1/containers/{jar['id']}/measurements").json()
    assert history[0]["remaining_g"] == 150 and history[0]["percentage"] == 37.5


@pytest.mark.parametrize(
    "weights,full", [({}, None), ({"full_weight_g": None}, None), ({"full_weight_g": 375}, 375)]
)
def test_new_jars_use_only_their_own_full_weight(client, catalog, jar, weights, full):
    response = client.post(
        "/api/v1/containers",
        json={
            "glaze_id": catalog["glaze"]["id"],
            "preset_id": catalog["preset"]["id"],
            **weights,
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created["tare_g"] == 100
    assert created["full_weight_g"] == full
    stock = weigh(client, created, 250).json()["stock"]
    assert stock["remaining_g"] == 150
    assert stock["percentage"] == (54.545 if full is not None else None)
    assert get_jar(client, jar)["full_weight_g"] == 500


@pytest.mark.parametrize("starting,expected", [(756, 100), (250, None), (200, None)])
def test_progress_uses_net_starting_weight(client, jar, starting, expected):
    updated = client.patch(
        f"/api/v1/containers/{jar['id']}",
        json={"expected_revision": jar["revision"], "tare_g": 250, "full_weight_g": starting},
    ).json()
    reading = weigh(client, updated, 756).json()["stock"]
    assert reading["remaining_g"] == 506
    assert reading["percentage"] == expected
    assert updated["starting_net_g"] == max(0, starting - 250)


def test_shared_full_weight_api_is_removed(client):
    assert "/api/v1/glaze-sizes" not in client.get("/openapi.json").json()["paths"]
    assert client.get("/api/v1/glaze-sizes").status_code == 404
    assert client.post("/api/v1/glaze-sizes", json={}).status_code in (404, 405)


@pytest.mark.parametrize("tare,full,net", [(None, None, None), (100, None, 150), (None, 500, None)])
def test_incomplete_records(client, catalog, tare, full, net):
    jar = client.post(
        "/api/v1/containers",
        json={
            "glaze_id": catalog["glaze"]["id"],
            "preset_id": catalog["preset"]["id"],
            "tare_g": tare,
            "full_weight_g": full,
        },
    ).json()
    weigh(client, jar, 250)
    jar = get_jar(client, jar)
    assert jar["gross_g"] == 250 and jar["remaining_g"] == net
    assert jar["percentage"] is None
    assert jar["incomplete"] is (net is None)
    assert not jar["low_stock"]


@pytest.mark.parametrize(
    "gross,net,percentage,below",
    [(0, 0, 0, True), (99, 0, 0, True), (100, 0, 0, False), (700, 600, 150, False)],
)
def test_weight_extremes(client, jar, gross, net, percentage, below):
    result = weigh(client, jar, gross).json()["stock"]
    assert (result["remaining_g"], result["percentage"], result["below_tare"]) == (
        net,
        percentage,
        below,
    )
    assert get_jar(client, jar)["full_weight_g"] == 500


@pytest.mark.parametrize("field,value", [("gross_g", -1), ("gross_g", 10000001)])
def test_invalid_measurements(client, jar, field, value):
    body = {"request_id": str(uuid4()), "expected_revision": 1, "gross_g": 100, field: value}
    assert client.post(f"/api/v1/containers/{jar['id']}/measurements", json=body).status_code == 422


def test_studio_threshold_boundary_and_separate_jars(client, jar):
    assert not weigh(client, jar, 250).json()["stock"]["low_stock"]  # Exactly 150 g.
    jar = get_jar(client, jar)
    assert weigh(client, jar, 249.999).json()["stock"]["low_stock"]
    spare = client.post(
        "/api/v1/containers",
        json={"glaze_id": jar["glaze_id"], "tare_g": 100, "full_weight_g": 500},
    ).json()
    weigh(client, spare, 600)
    assert client.get("/api/v1/containers?status=low").json()["total"] == 1
    client.put("/api/v1/settings", json={"low_stock_threshold_g": 100})
    assert client.get("/api/v1/containers?status=low").json()["total"] == 0
    client.put("/api/v1/settings", json={"low_stock_threshold_g": 250})
    assert get_jar(client, jar)["threshold_g"] == 250


def test_increase_and_void_restore_previous_weight(client, jar):
    first = weigh(client, jar, 150).json()
    jar = get_jar(client, jar)
    second = weigh(client, jar, 175, note="Added water").json()
    current = get_jar(client, jar)
    assert current["remaining_g"] == 75
    result = client.post(
        f"/api/v1/measurements/{second['measurement_id']}/void",
        json={"expected_revision": current["revision"], "reason": "Wrong reading"},
    )
    assert result.json()["remaining_g"] == 50
    history = client.get(f"/api/v1/containers/{jar['id']}/measurements").json()
    assert len(history) == 2 and history[0]["voided"] and history[0]["note"] == "Added water"
    result = client.post(
        f"/api/v1/measurements/{first['measurement_id']}/void",
        json={"expected_revision": result.json()["revision"], "reason": "Also incorrect"},
    )
    assert result.json()["gross_g"] is None and result.json()["incomplete"]


def test_archive_preserves_tag_and_history(client, jar):
    jar = client.put(
        "/api/v1/tags/04:a2:b3:c4/binding", json={"container_id": jar["id"], "expected_revision": 1}
    ).json()
    weigh(client, jar, 100)
    jar = get_jar(client, jar)
    archived = client.patch(
        f"/api/v1/containers/{jar['id']}",
        json={"expected_revision": jar["revision"], "archived": True},
    ).json()
    assert not archived["low_stock"] and archived["tag_uid"] == "04A2B3C4"
    assert client.get("/api/v1/containers?status=active").json()["total"] == 0
    assert client.get("/api/v1/containers?status=archived").json()["total"] == 1
    assert weigh(client, archived, 130).status_code == 409
    restored = client.patch(
        f"/api/v1/containers/{jar['id']}",
        json={"expected_revision": archived["revision"], "archived": False},
    ).json()
    assert restored["low_stock"] and restored["remaining_g"] == 0
    assert len(client.get(f"/api/v1/containers/{jar['id']}/measurements").json()) == 1


def test_idempotent_retry_and_conflicting_identifier(client, jar):
    body = {"request_id": str(uuid4()), "gross_g": 250, "expected_revision": jar["revision"]}
    path = f"/api/v1/containers/{jar['id']}/measurements"
    first = client.post(path, json=body)
    replay = client.post(path, json=body)
    assert first.status_code == 200 and replay.json() == first.json()
    assert len(client.get(path).json()) == 1
    assert client.post(path, json={**body, "gross_g": 251}).status_code == 409
    assert client.post(path, json={**body, "request_id": str(uuid4())}).status_code == 409


def test_simultaneous_writes_do_not_lose_updates(client, jar):
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: weigh(client, jar, 250).status_code, range(2)))
    assert sorted(results) == [200, 409]
    assert get_jar(client, jar)["revision"] == 2


def test_device_scan_binding_and_stale_tag_protection(client, catalog, jar):
    scan = client.post(
        "/api/v1/scans", json={"device_id": "studio-scale", "uid": "04-a2-b3-c4"}
    ).json()
    assert scan["uid"] == "04A2B3C4" and scan["container"] is None
    jar = client.put(
        "/api/v1/tags/04a2b3c4/binding", json={"container_id": jar["id"], "expected_revision": 1}
    ).json()
    snapshot = client.get("/api/v1/tags/04A2B3C4").json()["container"]
    assert snapshot["container_id"] == jar["id"]
    other = client.post("/api/v1/containers", json={"glaze_id": jar["glaze_id"]}).json()
    binding = {"container_id": other["id"], "expected_revision": other["revision"]}
    assert client.put("/api/v1/tags/04A2B3C4/binding", json=binding).status_code == 409
    assert (
        client.put("/api/v1/tags/04A2B3C4/binding", json={**binding, "move": True}).status_code
        == 200
    )
    assert (
        weigh(
            client, jar, 250, source="device", device_id="studio-scale", tag_uid="04A2B3C4"
        ).status_code
        == 409
    )
    fresh_old = get_jar(client, jar)
    assert (
        weigh(
            client, fresh_old, 250, source="device", device_id="studio-scale", tag_uid="04A2B3C4"
        ).status_code
        == 409
    )
    assert client.get("/api/v1/scans").json()[0]["container"]["container_id"] == other["id"]


def test_tag_replacement_and_malformed_tag(client, jar):
    jar = client.put(
        "/api/v1/tags/04A2B3C4/binding", json={"container_id": jar["id"], "expected_revision": 1}
    ).json()
    body = {"container_id": jar["id"], "expected_revision": jar["revision"]}
    assert client.put("/api/v1/tags/04A2B3C5/binding", json=body).status_code == 409
    assert (
        client.put("/api/v1/tags/04A2B3C5/binding", json={**body, "replace": True}).status_code
        == 200
    )
    assert client.get("/api/v1/tags/04A2B3C4").json()["container"] is None
    assert client.get("/api/v1/tags/not-a-tag").status_code == 422
    assert client.post("/api/v1/scans", json={"device_id": "desk", "uid": "x"}).status_code == 422


def test_filters_and_cone_ordering(client, catalog, jar):
    assert CONES.index("06") < CONES.index("01") < CONES.index("1") < CONES.index("6")
    assert (
        client.get(
            "/api/v1/containers?cone=6&classification=glaze&location=top&q=rutile"
        ).json()["total"]
        == 1
    )
    assert client.get("/api/v1/containers?cone=06").json()["total"] == 0
    assert client.get("/api/v1/containers?status=incomplete").json()["total"] == 1
    assert client.get("/api/v1/containers?cone=5/6").json()["total"] == 1
    response = client.post(
        "/api/v1/glazes",
        json={
            "manufacturer_id": catalog["manufacturer"]["id"],
            "name": "Experimental",
            "cone": "low fire",
        },
    )
    assert response.status_code == 201
    assert response.json()["cone"] == "low fire"
    assert client.get("/api/v1/suggestions/cone").json() == ["5/6", "low fire"]


def test_photos_cover_caption_and_validation(client, catalog):
    image = Image.new("RGB", (20, 30), "#ad91c5")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    path = f"/api/v1/glazes/{catalog['glaze']['id']}/photos"
    first = client.post(path, files={"file": ("tile.png", buffer.getvalue(), "image/png")}).json()
    second = client.post(path, files={"file": ("tile.png", buffer.getvalue(), "image/png")}).json()
    assert first["cover"] and not second["cover"]
    updated = client.patch(
        f"/api/v1/photos/{second['id']}", json={"caption": "Cone 6 on porcelain", "cover": True}
    ).json()
    assert updated["cover"] and updated["caption"] == "Cone 6 on porcelain"
    assert client.get(second["url"]).status_code == 200
    assert client.get(second["thumbnail_url"]).status_code == 200
    assert (
        client.post(path, files={"file": ("bad.png", b"not an image", "image/png")}).status_code
        == 422
    )
    assert client.delete(f"/api/v1/photos/{second['id']}").status_code == 204
    assert client.get(second["url"]).status_code == 404
    photos = client.get(f"/api/v1/glazes/{catalog['glaze']['id']}").json()["photos"]
    assert len(photos) == 1 and photos[0]["cover"]


def test_snapshot_restore_retains_inventory_media_tags_and_history(tmp_path):
    source, restored = tmp_path / "source", tmp_path / "restored"
    with TestClient(create_app(source)) as client:
        m = client.post("/api/v1/manufacturers", json={"name": "Mayco"}).json()
        g = client.post(
            "/api/v1/glazes", json={"manufacturer_id": m["id"], "name": "Blue Surf"}
        ).json()
        jar = client.post(
            "/api/v1/containers", json={"glaze_id": g["id"], "tare_g": 100, "full_weight_g": 500}
        ).json()
        jar = client.put(
            "/api/v1/tags/04A2B3C4/binding",
            json={"container_id": jar["id"], "expected_revision": 1},
        ).json()
        weigh(client, jar, 250)
        image = io.BytesIO()
        Image.new("RGB", (10, 10), "purple").save(image, "PNG")
        photo = client.post(
            f"/api/v1/glazes/{g['id']}/photos", files={"file": ("photo.png", image.getvalue())}
        ).json()
    shutil.copytree(source, restored)
    with TestClient(create_app(restored)) as client:
        jar = get_jar(client, jar)
        assert jar["remaining_g"] == 150 and jar["tag_uid"] == "04A2B3C4"
        assert len(client.get(f"/api/v1/containers/{jar['id']}/measurements").json()) == 1
        assert client.get(photo["url"]).status_code == 200


def test_missing_references_and_invalid_urls(client, catalog):
    assert client.post("/api/v1/containers", json={"glaze_id": "missing"}).status_code == 404
    assert (
        client.post(
            "/api/v1/manufacturers", json={"name": "X", "website": "javascript:alert(1)"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/containers", json={"glaze_id": catalog["glaze"]["id"], "full_weight_g": 0}
        ).status_code
        == 422
    )
    assert client.post("/api/v1/manufacturers", json={"name": "   "}).status_code == 422


def test_delete_jar_requires_current_revision_and_retires_number(client, jar):
    path = f"/api/v1/containers/{jar['id']}"
    reading = weigh(client, jar, 350).json()
    bound = client.put(
        "/api/v1/tags/04AA/binding",
        json={"container_id": jar["id"], "expected_revision": reading["revision"]},
    ).json()
    assert client.request("DELETE", path, json={"expected_revision": jar["revision"]}).status_code == 409
    assert len(client.get(f"{path}/measurements").json()) == 1
    assert client.request("DELETE", path, json={"expected_revision": bound["revision"]}).status_code == 204
    assert client.get(path).status_code == 404
    assert client.get("/api/v1/tags/04AA").json()["container"] is None
    next_jar = client.post("/api/v1/containers", json={"glaze_id": jar["glaze_id"]}).json()
    assert next_jar["number"] > jar["number"]
