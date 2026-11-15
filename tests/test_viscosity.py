import sqlite3

from fastapi.testclient import TestClient

from backend.app import create_app


def test_viscosity_is_free_text_and_follows_saved_edits(client):
    response = client.post(
        "/api/v1/glazes", json={"name": "Celadon", "viscosity": "  45 seconds (Zahn #2)  "}
    )
    assert response.status_code == 201
    glaze = response.json()
    assert glaze["viscosity"] == "45 seconds (Zahn #2)"
    path = f"/api/v1/glazes/{glaze['id']}"
    assert client.get(path).json()["viscosity"] == glaze["viscosity"]
    assert client.get("/api/v1/glazes", params={"q": "ZAHN"}).json()["items"] == [glaze]
    assert client.get("/api/v1/suggestions/viscosity").json() == [glaze["viscosity"]]

    edit = {"changes": {"viscosity": "Fluid"}, "expected": {"viscosity": glaze["viscosity"]}}
    assert client.patch(path, json=edit).json()["viscosity"] == "Fluid"
    assert client.get("/api/v1/suggestions/viscosity").json() == ["Fluid"]
    assert client.patch(path, json=edit).status_code == 200
    edit["changes"]["viscosity"] = "Thick"
    assert client.patch(path, json=edit).status_code == 409

    clear = {"changes": {"viscosity": None}, "expected": {"viscosity": "Fluid"}}
    assert client.patch(path, json=clear).json()["viscosity"] is None
    assert client.get("/api/v1/suggestions/viscosity").json() == []


def test_existing_glazes_gain_optional_viscosity_on_upgrade(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        glaze = client.post(
            "/api/v1/glazes", json={"name": "Celadon", "product_line": "Studio"}
        ).json()
        jar = client.post("/api/v1/containers", json={"glaze_id": glaze["id"]}).json()
    with sqlite3.connect(tmp_path / "glaze.db") as db:
        db.execute("ALTER TABLE glazes DROP COLUMN viscosity")

    path = f"/api/v1/glazes/{glaze['id']}"
    with TestClient(create_app(tmp_path)) as client:
        assert client.get(path).json() == {**glaze, "vessels": []}
        assert client.get(f"/api/v1/containers/{jar['id']}").json() == jar
        edit = {"changes": {"viscosity": "Thick"}, "expected": {"viscosity": None}}
        assert client.patch(path, json=edit).status_code == 200
    with TestClient(create_app(tmp_path)) as client:
        assert client.get(path).json()["viscosity"] == "Thick"
        assert client.get("/api/v1/suggestions/viscosity").json() == ["Thick"]
