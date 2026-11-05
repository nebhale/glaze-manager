from uuid import uuid4

import pytest


@pytest.mark.parametrize("full", [None, 500, 1000])
@pytest.mark.parametrize("remaining,low", [(0, True), (149.999, True), (150, False), (151, False)])
def test_low_stock_uses_remaining_weight_independently_of_full_weight(
    client, catalog, full, remaining, low
):
    jar = client.post(
        "/api/v1/containers",
        json={
            "glaze_id": catalog["glaze"]["id"],
            "tare_g": 100,
            "full_weight_g": full,
        },
    ).json()
    response = client.post(
        f"/api/v1/containers/{jar['id']}/measurements",
        json={
            "request_id": str(uuid4()),
            "expected_revision": jar["revision"],
            "gross_g": remaining + 100,
        },
    )
    assert response.status_code == 200
    stock = response.json()["stock"]
    assert stock["low_stock"] is low
    assert stock["threshold_g"] == 150
    assert stock["remaining_g"] == remaining
    assert not stock["incomplete"]
    assert (stock["percentage"] is None) is (full is None)
    assert client.get("/api/v1/containers?status=low").json()["total"] == int(low)
    assert client.get("/api/v1/containers?status=incomplete").json()["total"] == 0


def test_studio_threshold_defaults_and_units(client, catalog):
    assert client.get("/api/v1/settings").json() == {"low_stock_threshold_g": 150}
    for value in [-1, 10000001]:
        assert (
            client.put("/api/v1/settings", json={"low_stock_threshold_g": value}).status_code == 422
        )
        assert (
            client.post(
                "/api/v1/glazes",
                json={
                    "manufacturer_id": catalog["manufacturer"]["id"],
                    "name": "Invalid threshold",
                    "low_stock_threshold_g": value,
                },
            ).status_code
            == 422
        )
    # Old clients must not accidentally save percentage values as gram thresholds.
    assert client.put("/api/v1/settings", json={"low_stock_threshold": 20}).status_code == 422
    assert client.put("/api/v1/settings", json={"low_stock_threshold_g": 250.125}).json() == {
        "low_stock_threshold_g": 250.125,
    }
    jar = client.post(
        "/api/v1/containers",
        json={
            "glaze_id": catalog["glaze"]["id"],
            "tare_g": 100,
        },
    ).json()
    client.post(
        f"/api/v1/containers/{jar['id']}/measurements",
        json={
            "request_id": str(uuid4()),
            "expected_revision": jar["revision"],
            "gross_g": 300,
        },
    )
    current = client.get(f"/api/v1/containers/{jar['id']}").json()
    assert current["low_stock"] and current["threshold_g"] == 250.125
    glaze = catalog["glaze"]
    fields = {k: v for k, v in glaze.items() if k not in ("id", "manufacturer_name", "photos")}
    fields["low_stock_threshold_g"] = 100
    assert client.post("/api/v1/glazes", json=fields).status_code == 422
    assert client.put(f"/api/v1/glazes/{glaze['id']}", json=fields).status_code == 422
    assert "low_stock_threshold_g" not in glaze


def test_missing_empty_weight_cannot_trigger_a_warning(client, catalog):
    jar = client.post("/api/v1/containers", json={"glaze_id": catalog["glaze"]["id"]}).json()
    response = client.post(
        f"/api/v1/containers/{jar['id']}/measurements",
        json={
            "request_id": str(uuid4()),
            "expected_revision": jar["revision"],
            "gross_g": 50,
        },
    ).json()
    assert response["stock"]["remaining_g"] is None
    assert response["stock"]["incomplete"]
    assert not response["stock"]["low_stock"]
