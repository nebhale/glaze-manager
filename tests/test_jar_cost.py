import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


@pytest.mark.parametrize("cost", ["-0.01", "1.999", "10000000000.00"])
def test_invalid_jar_cost(client, jar, cost):
    assert client.post(
        "/api/v1/containers", json={"glaze_id": jar["glaze_id"], "cost_usd": cost}
    ).status_code == 422
    assert client.patch(
        f"/api/v1/containers/{jar['id']}",
        json={"expected_revision": jar["revision"], "cost_usd": cost},
    ).status_code == 422


def test_existing_jars_gain_optional_cost_on_upgrade(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        maker = client.post("/api/v1/manufacturers", json={"name": "Studio"}).json()
        glaze = client.post(
            "/api/v1/glazes", json={"manufacturer_id": maker["id"], "name": "Celadon"}
        ).json()
        jar = client.post("/api/v1/containers", json={"glaze_id": glaze["id"]}).json()
    with sqlite3.connect(tmp_path / "glaze.db") as db:
        db.execute("ALTER TABLE containers DROP COLUMN cost_cents")

    path = f"/api/v1/containers/{jar['id']}"
    with TestClient(create_app(tmp_path)) as client:
        assert client.get(path).json() == jar
        updated = client.patch(path, json={"expected_revision": jar["revision"], "cost_usd": "19.99"})
        assert updated.json()["cost_usd"] == "19.99"
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/v1/containers").json()["items"][0]["cost_usd"] == "19.99"
    with sqlite3.connect(tmp_path / "glaze.db") as db:
        assert db.execute("SELECT cost_cents FROM containers").fetchone() == (1999,)
