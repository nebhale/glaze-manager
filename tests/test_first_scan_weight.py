from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

UID = "04A2B3C4"


def make_jar(client, catalog, **weights):
    response = client.post(
        "/api/v1/containers",
        json={"glaze_id": catalog["glaze"]["id"], "tare_g": 25, **weights},
    )
    assert response.status_code == 201
    jar = response.json()
    response = client.put(
        f"/api/v1/tags/{UID}/binding",
        json={"container_id": jar["id"], "expected_revision": jar["revision"]},
    )
    assert response.status_code == 200
    return response.json()


def current(client, jar):
    return client.get(f"/api/v1/containers/{jar['id']}").json()


def history(client, jar):
    return client.get(f"/api/v1/containers/{jar['id']}/measurements").json()


def weigh(client, jar, gross, **overrides):
    return client.post(
        f"/api/v1/containers/{jar['id']}/measurements",
        json={
            "request_id": str(uuid4()),
            "expected_revision": current(client, jar)["revision"],
            "source": "device",
            "device_id": "studio-scale",
            "tag_uid": UID,
            "gross_g": gross,
            **overrides,
        },
    )


def edit(client, jar, **values):
    response = client.patch(
        f"/api/v1/containers/{jar['id']}",
        json={"expected_revision": current(client, jar)["revision"], **values},
    )
    assert response.status_code == 200
    return response.json()


def test_first_scan_sets_gross_baseline_once_and_retries_do_not_reset_it(client, catalog):
    jar = make_jar(client, catalog, tare_g=25.125)
    scan = client.post("/api/v1/scans", json={"device_id": "studio-scale", "uid": UID})
    assert scan.json()["container"]["full_weight_g"] is None
    assert history(client, jar) == []

    request_id = str(uuid4())
    first = weigh(client, jar, 859.375, request_id=request_id)
    assert first.status_code == 200
    assert first.json()["stock"]["remaining_g"] == 834.25
    assert first.json()["stock"]["percentage"] == 100
    assert current(client, jar)["full_weight_g"] == 859.375
    original = history(client, jar)[0]
    assert original["full_weight_g"] == 859.375 and original["percentage"] == 100
    assert client.get(f"/api/v1/tags/{UID}").json()["container"]["full_weight_g"] == 859.375

    assert weigh(client, jar, 442.25).json()["stock"]["percentage"] == 50
    assert weigh(client, jar, 1693.625).json()["stock"]["percentage"] == 200
    assert current(client, jar)["full_weight_g"] == 859.375

    edit(client, jar, full_weight_g=1025.125)
    assert weigh(client, jar, 525.125).json()["stock"]["percentage"] == 50
    replay = weigh(client, jar, 859.375, request_id=request_id, expected_revision=jar["revision"])
    assert replay.status_code == 200 and replay.json() == first.json()
    assert current(client, jar)["full_weight_g"] == 1025.125
    readings = history(client, jar)
    assert len(readings) == 4
    assert next(reading for reading in readings if reading["id"] == original["id"]) == original


def test_manual_full_weight_before_first_scan_is_preserved(client, catalog):
    jar = make_jar(client, catalog, full_weight_g=1000)
    assert weigh(client, jar, 512.5).json()["stock"]["percentage"] == 50
    assert current(client, jar)["full_weight_g"] == 1000
    assert history(client, jar)[0]["full_weight_g"] == 1000


def test_web_reading_does_not_initialize_or_consume_the_first_device_scan(client, catalog):
    jar = make_jar(client, catalog)
    response = weigh(client, jar, 825, source="web", device_id=None, tag_uid=None)
    assert response.status_code == 200 and response.json()["stock"]["percentage"] is None
    assert current(client, jar)["full_weight_g"] is None
    assert weigh(client, jar, 125).json()["stock"]["percentage"] == 100
    assert current(client, jar)["full_weight_g"] == 125
    assert current(client, jar)["low_stock"]  # Warnings still depend on grams, not percentage.


@pytest.mark.parametrize("manual_full,expected", [(None, 900), (1000, 1000)])
def test_unknown_tare_preserves_original_gross_scan_and_keeps_history(
    client, catalog, manual_full, expected
):
    jar = make_jar(client, catalog, tare_g=None)
    assert weigh(client, jar, 900).json()["stock"]["percentage"] is None
    assert weigh(client, jar, 700).json()["stock"]["percentage"] is None
    original = history(client, jar)
    assert current(client, jar)["full_weight_g"] == 900
    updated = edit(client, jar, tare_g=100, **({"full_weight_g": manual_full} if manual_full else {}))
    assert updated["full_weight_g"] == expected
    assert updated["remaining_g"] == 600
    assert updated["percentage"] == round(600 / (expected - 100) * 100, 3)
    assert history(client, jar) == original
    assert weigh(client, jar, 500).status_code == 200
    assert current(client, jar)["full_weight_g"] == expected


@pytest.mark.parametrize("tare,gross,full", [(0, 125, 125), (25, 25, 25), (25, 0, None)])
def test_first_gross_scan_with_empty_jar_or_zero_reading(
    client, catalog, tare, gross, full
):
    jar = make_jar(client, catalog, tare_g=tare)
    assert weigh(client, jar, gross).status_code == 200
    assert current(client, jar)["full_weight_g"] == full
    assert weigh(client, jar, 1000).status_code == 200
    assert current(client, jar)["full_weight_g"] == full


def test_invalid_or_rejected_readings_do_not_establish_a_baseline(client, catalog):
    jar = make_jar(client, catalog)
    assert weigh(client, jar, -1).status_code == 422
    assert weigh(client, jar, 525, expected_revision=jar["revision"] - 1).status_code == 409
    assert weigh(client, jar, 525, tag_uid="04A2B3C5").status_code == 409
    edit(client, jar, archived=True)
    assert weigh(client, jar, 525).status_code == 409
    assert current(client, jar)["full_weight_g"] is None
    assert history(client, jar) == []
    edit(client, jar, archived=False)
    assert weigh(client, jar, 625).json()["stock"]["percentage"] == 100
    assert current(client, jar)["full_weight_g"] == 625


def test_simultaneous_first_scans_only_use_the_accepted_reading(client, catalog):
    jar = make_jar(client, catalog)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(
            workers.map(
                lambda gross: weigh(client, jar, gross, expected_revision=jar["revision"]),
                [525, 625],
            )
        )
    assert sorted(result.status_code for result in results) == [200, 409]
    accepted = next(result.json() for result in results if result.status_code == 200)
    assert accepted["stock"]["percentage"] == 100
    assert current(client, jar)["full_weight_g"] == accepted["stock"]["gross_g"]
    assert len(history(client, jar)) == 1


def test_voiding_first_scan_does_not_replace_baseline_with_a_later_reading(client, catalog):
    jar = make_jar(client, catalog)
    first = weigh(client, jar, 525).json()
    response = client.post(
        f"/api/v1/measurements/{first['measurement_id']}/void",
        json={"expected_revision": current(client, jar)["revision"], "reason": "Wrong reading"},
    )
    assert response.status_code == 200
    assert weigh(client, jar, 275).json()["stock"]["percentage"] == 50
    assert current(client, jar)["full_weight_g"] == 525
    edit(client, jar, full_weight_g=275)
    assert current(client, jar)["percentage"] == 100


def test_voiding_scan_without_tare_preserves_original_gross_baseline(client, catalog):
    jar = make_jar(client, catalog, tare_g=None)
    first = weigh(client, jar, 525).json()
    response = client.post(
        f"/api/v1/measurements/{first['measurement_id']}/void",
        json={"expected_revision": current(client, jar)["revision"], "reason": "Wrong jar"},
    )
    assert response.status_code == 200
    assert weigh(client, jar, 275).status_code == 200
    assert edit(client, jar, tare_g=25)["full_weight_g"] == 525
