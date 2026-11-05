from backend import models as m


def test_suggestions_exclude_empty_values_and_deduplicate_case(client, catalog):
    with client.app.state.sessions() as db:
        for index, value in enumerate(
            [None, "", "   ", " Pottery Choice ", "pottery choice", "Celadon"]
        ):
            db.add(
                m.Glaze(
                    manufacturer_id=catalog["manufacturer"]["id"],
                    name=f"Glaze {index}",
                    product_line=value,
                )
            )
            db.add(m.Container(number=index + 1, glaze_id=catalog["glaze"]["id"], location=value))
        db.commit()
    for field in ("product_line", "location"):
        response = client.get(f"/api/v1/suggestions/{field}")
        assert response.status_code == 200
        assert response.json() == ["Celadon", "Pottery Choice"]


def test_suggestions_include_archived_and_unpaginated_records(client, catalog):
    with client.app.state.sessions() as db:
        for index in range(1001):
            db.add(
                m.Container(
                    number=index + 1,
                    glaze_id=catalog["glaze"]["id"],
                    location="Shelf A" if index < 1000 else "Back room",
                    archived=index == 1000,
                )
            )
            db.add(
                m.Glaze(
                    manufacturer_id=catalog["manufacturer"]["id"],
                    name=f"Glaze {index}",
                    product_line="Choice" if index < 1000 else "Special line",
                )
            )
        db.commit()
    assert client.get("/api/v1/suggestions/location").json() == ["Back room", "Shelf A"]
    assert client.get("/api/v1/suggestions/product_line").json() == ["Choice", "Special line"]


def test_suggestions_follow_saved_changes_and_clearing(client, catalog, jar):
    path = f"/api/v1/containers/{jar['id']}"
    response = client.patch(
        path, json={"expected_revision": jar["revision"], "location": "Kiln room"}
    )
    assert response.status_code == 200
    assert client.get("/api/v1/suggestions/location").json() == ["Kiln room"]
    response = client.patch(
        path, json={"expected_revision": response.json()["revision"], "location": None}
    )
    assert response.status_code == 200
    assert client.get("/api/v1/suggestions/location").json() == []
    glaze = f"/api/v1/glazes/{catalog['glaze']['id']}"
    assert (
        client.patch(
            glaze,
            json={"changes": {"product_line": "Stoneware"}, "expected": {"product_line": None}},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/suggestions/product_line").json() == ["Stoneware"]


def test_suggestions_only_allow_supported_fields(client):
    assert client.get("/api/v1/suggestions/notes").status_code == 422
    assert client.get("/api/v1/suggestions/location").json() == []
