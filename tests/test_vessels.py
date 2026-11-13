import io
import sqlite3
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from PIL import Image

from backend.app import create_app


def upload(client, path, color):
    content = io.BytesIO()
    Image.new("RGB", (30, 40), color).save(content, format="PNG")
    response = client.post(path, files={"file": ("piece.png", content.getvalue(), "image/png")})
    assert response.status_code == 201
    return response.json()


def test_vessel_numbers_survive_renames_and_deletion_independently_of_jars(client, jar):
    path = "/api/v1/vessels"
    assert jar["number"] == 1
    with ThreadPoolExecutor(max_workers=4) as workers:
        created = list(workers.map(lambda _: client.post(path, json={"name": "Cup"}), range(6)))
    assert sorted(response.json()["id"] for response in created) == list(range(1, 7))
    result = client.get(path, params={"q": "cup", "page": 2, "page_size": 4}).json()
    assert result["total"] == 6 and [v["id"] for v in result["items"]] == [5, 6]
    assert client.delete(f"{path}/6").status_code == 204
    assert client.post(path, json={"name": "Serving bowl"}).json()["id"] == 7
    edit = {"changes": {"name": "Small bowl"}, "expected": {"name": "Cup"}}
    assert client.patch(f"{path}/1", json=edit).json()["id"] == 1
    assert client.patch(f"{path}/1", json={**edit, "changes": {"name": "Other"}}).status_code == 409
    assert client.get(path, params={"q": "#1"}).json()["items"] == [
        {"id": 1, "name": "Small bowl", "location": None, "source_url": None, "archived": False, "photos": []}
    ]
    assert (
        client.post("/api/v1/containers", json={"glaze_id": jar["glaze_id"]}).json()["number"] == 2
    )


def test_vessel_sorting_precedes_pagination(client):
    path = "/api/v1/vessels"
    for name, location in (
        ("Cup C", None),
        ("cup A", "gallery"),
        ("Dish", None),
        ("Cup B", "Studio"),
        ("Cup A", "Gallery"),
    ):
        client.post(path, json={"name": name, "location": location}).raise_for_status()

    result = client.get(path, params={"page_size": 2, "page": 2}).json()
    assert [item["id"] for item in result["items"]] == [3, 4]

    def ids(sort, descending, page):
        result = client.get(
            path,
            params={
                "q": "cup",
                "sort": sort,
                "descending": descending,
                "page_size": 2,
                "page": page,
            },
        ).json()
        assert result["total"] == 4
        return [item["id"] for item in result["items"]]

    assert ids("id", False, 2) == [4, 5]
    assert ids("id", True, 1) == [5, 4]
    assert ids("name", False, 1) == [2, 5]
    assert ids("name", True, 1) == [1, 4]
    assert ids("location", False, 1) == [2, 5]
    assert ids("location", False, 2) == [4, 1]
    assert ids("location", True, 1) == [4, 2]
    assert ids("location", True, 2) == [5, 1]


def test_vessel_archive_and_location_suggestions(client, jar):
    path = "/api/v1/vessels"
    vessel = client.post(path, json={"name": "Carved bowl", "location": "Gallery"}).json()
    detail = f"{path}/{vessel['id']}"
    client.post(path, json={"name": "Mug", "location": "Studio"}).raise_for_status()
    archive = {"changes": {"archived": True}, "expected": {"archived": False}}
    assert client.patch(detail, json=archive).json()["archived"]
    assert client.get(path, params={"q": "galle"}).json()["total"] == 0
    for status, total in (("all", 2), ("active", 1), ("archived", 1)):
        assert client.get(path, params={"status": status}).json()["total"] == total
    assert (
        client.get(path, params={"q": "GALLE", "status": "archived"}).json()["items"][0]["id"]
        == vessel["id"]
    )
    assert client.get("/api/v1/suggestions/location").json() == [jar["location"]]
    assert client.get("/api/v1/suggestions/vessel_location").json() == ["Gallery", "Studio"]
    move = {"changes": {"location": "Annex"}, "expected": {"location": "Gallery"}}
    assert client.patch(detail, json=move).json()["location"] == "Annex"
    assert client.patch(detail, json={**move, "changes": {"location": None}}).status_code == 409
    assert client.get("/api/v1/suggestions/vessel_location").json() == ["Annex", "Studio"]
    restore = {"changes": {"archived": False}, "expected": {"archived": True}}
    assert client.patch(detail, json=restore).json()["archived"] is False
    assert client.get(path, params={"q": "annex"}).json()["total"] == 1


def test_existing_vessels_gain_location_and_archive_status(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        vessel = client.post("/api/v1/vessels", json={"name": "Original"}).json()
    with sqlite3.connect(tmp_path / "glaze.db") as db:
        db.execute("ALTER TABLE vessels DROP COLUMN source_url")
        db.execute("ALTER TABLE vessels DROP COLUMN archived")
        db.execute("ALTER TABLE vessels DROP COLUMN location")
    path = f"/api/v1/vessels/{vessel['id']}"
    with TestClient(create_app(tmp_path)) as client:
        assert client.get(path).json() == vessel
        update = {
            "changes": {"archived": True, "location": "Storage"},
            "expected": {"archived": False, "location": None},
        }
        client.patch(path, json=update).raise_for_status()
    with TestClient(create_app(tmp_path)) as client:
        assert client.get(path).json() == {**vessel, "archived": True, "location": "Storage"}


def test_application_links_notes_and_shared_photos(client, catalog):
    vessel = client.post("/api/v1/vessels", json={"name": "Bowl"}).json()
    assert vessel["applications"] == [] and vessel["photos"] == []
    other = client.post("/api/v1/vessels", json={"name": "Bowl"}).json()
    glaze_id = catalog["glaze"]["id"]
    glaze_path = f"/api/v1/glazes/{glaze_id}"
    vessel_path = f"/api/v1/vessels/{vessel['id']}"
    other_path = f"/api/v1/vessels/{other['id']}"
    apps = f"{vessel_path}/applications"
    assert client.post(apps, json={"glaze_id": "missing"}).status_code == 404
    direct = upload(client, f"{glaze_path}/photos", "blue")
    first = upload(client, f"{vessel_path}/photos", "red")
    second = upload(client, f"{vessel_path}/photos", "green")
    assert first["cover"] and second["cover"]
    assert client.get(glaze_path).json()["vessels"] == []

    base = client.post(apps, json={"glaze_id": glaze_id, "application_note": "3 coats"}).json()
    rim = client.post(apps, json={"glaze_id": glaze_id}).json()
    edit = {"changes": {"application_note": "overlapping"}, "expected": {"application_note": None}}
    assert (
        client.patch(f"{apps}/{rim['id']}", json=edit).json()["application_note"] == "overlapping"
    )
    assert client.get("/api/v1/suggestions/application_note").json() == ["3 coats", "overlapping"]
    applications = client.get(vessel_path).json()["applications"]
    assert [a["id"] for a in applications] == [base["id"], rim["id"]]
    assert applications[0]["glaze_name"] == "Blue Rutile"
    client.patch(
        vessel_path, json={"changes": {"archived": True}, "expected": {"archived": False}}
    ).raise_for_status()
    detail = client.get(glaze_path).json()
    assert detail["photos"] == [direct]
    assert detail["vessels"] == [
        {
            "id": vessel["id"],
            "name": "Bowl",
            "location": None,
            "source_url": None,
            "archived": True,
            "photos": [second, {**first, "cover": False}],
        }
    ]
    assert client.delete(f"/api/v1/photos/{first['id']}").status_code == 404
    assert client.delete(f"{other_path}/photos/{first['id']}").status_code == 404
    assert client.delete(f"{other_path}/applications/{base['id']}").status_code == 404
    assert client.delete(f"{vessel_path}/photos/{first['id']}").status_code == 204
    assert client.get(first["url"]).status_code == 404
    assert client.get(glaze_path).json()["vessels"][0]["photos"] == [{**second, "cover": True}]

    other_glaze = client.post(
        "/api/v1/glazes", json={"manufacturer_id": catalog["manufacturer"]["id"], "name": "Clear"}
    ).json()
    client.post(apps, json={"glaze_id": other_glaze["id"]}).raise_for_status()
    assert client.delete(f"{apps}/{base['id']}").status_code == 204
    assert len(client.get(glaze_path).json()["vessels"]) == 1
    assert client.delete(f"{apps}/{rim['id']}").status_code == 204
    assert client.get(glaze_path).json()["vessels"] == []
    other_glaze_path = f"/api/v1/glazes/{other_glaze['id']}"
    assert client.get(other_glaze_path).json()["vessels"][0]["photos"][0]["id"] == second["id"]
    assert client.get(second["url"]).status_code == 200
    assert client.delete(vessel_path).status_code == 204
    assert client.get(other_glaze_path).json()["vessels"] == []
    assert (
        client.get(second["url"]).status_code
        == client.get(second["thumbnail_url"]).status_code
        == 404
    )
    assert client.get(direct["url"]).status_code == 200
    assert client.get("/api/v1/suggestions/application_note").json() == []


def test_vessel_key_photo_is_scoped_to_its_owner_and_shared_in_glaze_views(client, catalog):
    glaze_path = f"/api/v1/glazes/{catalog['glaze']['id']}"
    glaze_photo = upload(client, f"{glaze_path}/photos", "blue")
    vessel = client.post("/api/v1/vessels", json={"name": "Key photo bowl"}).json()
    other = client.post("/api/v1/vessels", json={"name": "Other bowl"}).json()
    path = f"/api/v1/vessels/{vessel['id']}"
    other_path = f"/api/v1/vessels/{other['id']}"
    first = upload(client, f"{path}/photos", "red")
    second = upload(client, f"{path}/photos", "green")
    other_photo = upload(client, f"{other_path}/photos", "purple")
    client.post(f"{path}/applications", json={"glaze_id": catalog["glaze"]["id"]}).raise_for_status()

    assert client.patch(f"{other_path}/photos/{second['id']}", json={"cover": True}).status_code == 404
    assert client.patch(f"{path}/photos/{glaze_photo['id']}", json={"cover": True}).status_code == 404
    assert client.patch(f"/api/v1/photos/{second['id']}", json={"cover": True}).status_code == 404
    result = client.patch(
        f"{path}/photos/{second['id']}", json={"cover": True, "caption": "Finished bowl"}
    )
    assert result.status_code == 200
    selected = {**second, "cover": True, "caption": "Finished bowl"}
    assert result.json() == selected
    expected = [selected, {**first, "cover": False}]
    assert client.get(path).json()["photos"] == expected
    assert client.get("/api/v1/vessels", params={"q": "#1"}).json()["items"][0]["photos"] == expected
    detail = client.get(glaze_path).json()
    assert detail["photos"] == [glaze_photo]
    assert detail["vessels"][0]["photos"] == expected
    assert client.get(other_path).json()["photos"] == [other_photo]

    client.patch(f"{path}/photos/{first['id']}", json={"caption": "Before firing"}).raise_for_status()
    assert client.get(path).json()["photos"][0] == selected
    assert client.delete(f"{path}/photos/{second['id']}").status_code == 204
    fallback = [{**first, "cover": True, "caption": "Before firing"}]
    assert client.get(path).json()["photos"] == fallback
    assert client.get(glaze_path).json()["vessels"][0]["photos"] == fallback


def test_delete_glaze_requires_unlinking_jars_and_vessels(client, catalog, jar):
    glaze = catalog["glaze"]
    path = f"/api/v1/glazes/{glaze['id']}"
    direct = upload(client, f"{path}/photos", "blue")
    vessel = client.post("/api/v1/vessels", json={"name": "Cup"}).json()
    vessel_path = f"/api/v1/vessels/{vessel['id']}"
    sample = upload(client, f"{vessel_path}/photos", "red")
    application = client.post(f"{vessel_path}/applications", json={"glaze_id": glaze["id"]}).json()

    assert client.delete(path).status_code == 409
    jar_path = f"/api/v1/containers/{jar['id']}"
    archived = client.patch(
        jar_path, json={"archived": True, "expected_revision": jar["revision"]}
    ).json()
    blocked = client.delete(path)
    assert blocked.status_code == 409 and "Archived jar" in blocked.json()["detail"]
    client.request(
        "DELETE", jar_path, json={"expected_revision": archived["revision"]}
    ).raise_for_status()
    blocked = client.delete(path)
    assert blocked.status_code == 409 and "Vessel #" in blocked.json()["detail"]
    assert client.get(path).json()["photos"] == [direct]
    assert client.get(direct["url"]).status_code == 200

    client.delete(f"{vessel_path}/applications/{application['id']}").raise_for_status()
    assert client.delete(path).status_code == 204
    assert client.get(path).status_code == 404
    assert (
        client.get(direct["url"]).status_code
        == client.get(direct["thumbnail_url"]).status_code
        == 404
    )
    assert client.get(vessel_path).json()["photos"] == [sample]
    assert client.get(sample["url"]).status_code == 200
