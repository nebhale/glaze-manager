from concurrent.futures import ThreadPoolExecutor


def test_numbers_are_unique_stable_and_searchable(client, catalog, jar):
    assert jar["number"] == 1
    with ThreadPoolExecutor(max_workers=4) as workers:
        responses = list(
            workers.map(
                lambda _: client.post(
                    "/api/v1/containers", json={"glaze_id": catalog["glaze"]["id"]}
                ),
                range(8),
            )
        )
    assert all(response.status_code == 201 for response in responses)
    created = [response.json() for response in responses]
    assert sorted(item["number"] for item in created) == list(range(2, 10))
    archived = client.patch(
        f"/api/v1/containers/{jar['id']}",
        json={"archived": True, "expected_revision": jar["revision"]},
    ).json()
    assert archived["number"] == 1
    newest = client.post("/api/v1/containers", json={"glaze_id": catalog["glaze"]["id"]}).json()
    assert newest["number"] == 10
    for order in [False, True]:
        items = client.get(
            "/api/v1/containers",
            params={
                "sort": "number",
                "descending": order,
                "status": "all",
            },
        ).json()["items"]
        assert [item["number"] for item in items] == sorted(range(1, 11), reverse=order)
    result = client.get("/api/v1/containers", params={"q": "#1", "status": "all"}).json()
    assert [item["id"] for item in result["items"]] == [jar["id"]]
    assert (
        client.get("/api/v1/containers", params={"q": "10"}).json()["items"][0]["id"]
        == newest["id"]
    )
    assert (
        client.patch(
            f"/api/v1/containers/{newest['id']}",
            json={
                "number": 99,
                "expected_revision": newest["revision"],
            },
        ).status_code
        == 422
    )
