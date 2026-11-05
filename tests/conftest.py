from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


@pytest.fixture
def client(tmp_path: Path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


@pytest.fixture
def catalog(client):
    manufacturer = client.post("/api/v1/manufacturers", json={"name": "AMACO"}).json()
    glaze = client.post(
        "/api/v1/glazes",
        json={
            "name": "Blue Rutile",
            "manufacturer_id": manufacturer["id"],
            "cone": "5/6",
            "classification": "glaze",
        },
    ).json()
    preset = client.post("/api/v1/presets", json={"name": "Pint jar", "tare_g": 100}).json()
    return {"manufacturer": manufacturer, "glaze": glaze, "preset": preset}


@pytest.fixture
def jar(client, catalog):
    return client.post(
        "/api/v1/containers",
        json={
            "glaze_id": catalog["glaze"]["id"],
            "preset_id": catalog["preset"]["id"],
            "full_weight_g": 500,
            "location": "Top shelf",
        },
    ).json()
