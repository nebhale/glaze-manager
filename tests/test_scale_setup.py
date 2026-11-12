import concurrent.futures

import pytest
from sqlalchemy import event, func, select

from backend import models as m


def setup_body(catalog):
    return {
        "request_id": "studio-setup-001",
        "device_id": "studio-scale",
        "uid": "04:01:02:03",
        "glaze_id": catalog["glaze"]["id"],
        "preset_id": catalog["preset"]["id"],
        "gross_g": 756,
        "location": "Shelf A",
        "cost_usd": "18.50",
    }


def test_atomic_setup_and_replay(client, catalog):
    payload = setup_body(catalog)
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(lambda _: client.post("/api/v1/device/jar-setups", json=payload), range(2))
        )
    assert [result.status_code for result in results] == [200, 200]
    saved = results[0].json()
    assert saved == results[1].json()
    device = client.get(f"/api/v1/device/jars/{saved['number']}").json()
    assert device["container_id"] == saved["container_id"]
    assert (device["full_weight_g"], device["remaining_g"], device["tare_g"]) == (756, 656, 100)
    assert device["tag_uid"] == "04010203"
    path = f"/api/v1/containers/{saved['container_id']}"
    assert client.get(path).json()["cost_usd"] == "18.50"
    assert len(client.get(f"{path}/measurements").json()) == 1
    assert (
        client.post(
            "/api/v1/device/jar-setups", json={**payload, "request_id": "different-setup"}
        ).status_code
        == 409
    )
    assert (
        client.post("/api/v1/device/jar-setups", json={**payload, "gross_g": 700}).status_code
        == 409
    )
    assert client.get("/api/v1/containers").json()["total"] == 1
    assert client.request("DELETE", path, json={"expected_revision": saved["revision"]}).is_success
    assert client.post("/api/v1/device/jar-setups", json=payload).json() == saved
    assert client.get("/api/v1/containers").json()["total"] == 0
    other = client.post("/api/v1/containers", json={"glaze_id": payload["glaze_id"]}).json()
    response = client.post(
        f"/api/v1/containers/{other['id']}/measurements",
        json={
            "request_id": payload["request_id"],
            "gross_g": 50,
            "expected_revision": other["revision"],
        },
    )
    assert response.status_code == 409


def test_untagged_setup_can_be_replayed_and_linked_later(client, catalog):
    payload = setup_body(catalog)
    del payload["uid"]
    path = "/api/v1/device/jar-setups"
    first = client.post(path, json=payload)
    first.raise_for_status()
    saved = first.json()
    assert client.post(path, json=payload).json() == saved
    detail = client.get(f"/api/v1/device/jars/{saved['number']}").json()
    assert detail["tag_uid"] is None
    assert detail["full_weight_g"] == 756
    assert len(client.get(f"/api/v1/containers/{saved['container_id']}/measurements").json()) == 1
    assert client.post(path, json={**payload, "uid": "ABCD"}).status_code == 409
    second = client.post(path, json={**payload, "request_id": "another-untagged-jar"}).json()
    assert second["number"] != saved["number"]
    binding = {"container_id": saved["container_id"], "expected_revision": saved["revision"]}
    client.put("/api/v1/tags/ABCD/binding", json=binding).raise_for_status()
    assert client.get("/api/v1/tags/ABCD").json()["container"]["number"] == saved["number"]


def test_setup_without_container_or_with_invalid_preset(client, catalog):
    payload = setup_body(catalog)
    assert (
        client.post(
            "/api/v1/device/jar-setups", json={**payload, "preset_id": "missing"}
        ).status_code
        == 404
    )
    with client.app.state.sessions() as db:
        for model in (m.JarSetupReceipt, m.Container, m.Measurement):
            assert db.scalar(select(func.count()).select_from(model)) == 0
    result = client.post("/api/v1/device/jar-setups", json={**payload, "preset_id": None}).json()
    assert result["stock"]["remaining_g"] is None
    assert result["number"] == 1
    assert client.get("/api/v1/device/jars/1").json()["full_weight_g"] == 756


def test_bounded_device_reads(client, catalog):
    manufacturer = catalog["manufacturer"]["id"]
    for i in range(8):
        client.post(
            "/api/v1/glazes",
            json={
                "manufacturer_id": manufacturer,
                "name": f"青{i}" * 100,
                "product_code": "青" * 200,
                "notes": "x" * 20000,
            },
        ).raise_for_status()
    path = "/api/v1/device/options/glazes"
    offset, found = 0, []
    while offset is not None:
        response = client.get(
            path, params={"q": "青", "manufacturer_id": manufacturer, "offset": offset}
        )
        response.raise_for_status()
        assert len(response.content) <= 4096
        body = response.json()
        found += [row["value"] for row in body["items"]]
        offset = body["next_offset"]
    assert len(set(found)) == len(found) == 8
    assert client.get(path, params={"q": "%"}).json()["items"] == []
    assert client.get("/api/v1/device/jars/123").status_code == 404


def test_setup_rolls_back_jar_when_measurement_fails(client, catalog):
    def interrupt_measurement(mapper, connection, measurement):
        raise RuntimeError("interrupted measurement")

    event.listen(m.Measurement, "before_insert", interrupt_measurement)
    try:
        with pytest.raises(RuntimeError, match="interrupted measurement"):
            client.post("/api/v1/device/jar-setups", json=setup_body(catalog))
    finally:
        event.remove(m.Measurement, "before_insert", interrupt_measurement)
    assert client.get("/api/v1/containers").json()["total"] == 0
    assert client.get("/api/v1/tags/04010203").json()["container"] is None
    assert client.post("/api/v1/device/jar-setups", json=setup_body(catalog)).json()["number"] == 1


def test_unlinked_jar_picker_filters_before_paging_and_sorts_labels(client, catalog):
    client.post("/api/v1/device/jar-setups", json=setup_body(catalog)).raise_for_status()
    uncoded = client.post("/api/v1/containers", json={"glaze_id": catalog["glaze"]["id"]}).json()
    for name in ["zinc", "Sage", "Honey", "Copper", "amber", "Archived"]:
        glaze = client.post(
            "/api/v1/glazes",
            json={
                "manufacturer_id": catalog["manufacturer"]["id"],
                "name": name,
                "product_code": "PC-12",
            },
        ).json()
        jar = client.post("/api/v1/containers", json={"glaze_id": glaze["id"]}).json()
        if name == "Archived":
            client.patch(
                f"/api/v1/containers/{jar['id']}",
                json={"expected_revision": jar["revision"], "archived": True},
            ).raise_for_status()
    path = "/api/v1/device/options/unlinked-jars"
    page = client.get(path).json()
    assert page["next_offset"] == 4
    last = client.get(path, params={"offset": page["next_offset"]}).json()
    assert last["next_offset"] is None
    rows = page["items"] + last["items"]
    assert [row["label"] for row in rows] == [
        "amber (PC-12)",
        "Blue Rutile",
        "Copper (PC-12)",
        "Honey (PC-12)",
        "Sage (PC-12)",
        "zinc (PC-12)",
    ]
    assert rows[1]["value"] == str(uncoded["number"])


def test_manually_selected_device_jar(client, catalog):
    saved = client.post("/api/v1/device/jar-setups", json=setup_body(catalog)).json()
    number = saved["number"]
    options = client.get("/api/v1/device/options/jars").json()
    assert options["items"][0]["value"] == str(number)
    path = f"/api/v1/containers/{saved['container_id']}/measurements"
    body = {
        "source": "device", "device_id": "scale", "gross_g": 700,
        "expected_revision": saved["revision"], "request_id": "manual-device-01",
    }
    assert client.post(path, json=body).status_code == 422
    assert client.post(path, json={**body, "tag_uid": "ABCDEF01"}).status_code == 409
    body["manual_selection"] = True
    assert client.post(path, json={**body, "tag_uid": "04010203"}).status_code == 422
    first = client.post(path, json=body)
    assert first.status_code == 200
    assert client.post(path, json=body).json() == first.json()
    assert client.post(path, json={**body, "request_id": "manual-device-02"}).status_code == 409


def test_new_glaze_in_atomic_setup(client, catalog):
    body = setup_body(catalog)
    body["new_glaze"] = {"name": "Kiln test", "manufacturer_id": catalog["manufacturer"]["id"]}
    assert client.post("/api/v1/device/jar-setups", json=body).status_code == 422
    del body["glaze_id"]
    path = "/api/v1/device/jar-setups"
    assert client.post(path, json={**body, "preset_id": "missing"}).status_code == 404
    assert client.get("/api/v1/device/options/glazes?q=Kiln").json()["items"] == []
    saved = client.post(path, json=body)
    assert saved.status_code == 200
    assert client.post(path, json=body).json() == saved.json()
    assert len(client.get("/api/v1/device/options/glazes?q=Kiln").json()["items"]) == 1
