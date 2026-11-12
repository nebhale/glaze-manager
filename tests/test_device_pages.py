import json

from backend.device_options import option_page


def test_exact_wire_budget_and_single_entry_fallback():
    choices = [{"label": '陶"\\' * 20}, {"label": "A" * 200}]
    complete = option_page(choices, 9)
    assert option_page(choices, 9, len(complete.body)).body == complete.body
    split = json.loads(option_page(choices, 9, len(complete.body) - 1).body)
    assert split == {"items": choices[:1], "next_offset": 10}
    assert json.loads(option_page([], 0).body) == {"items": [], "next_offset": None}
    row = {"value": "1", "label": "#1 red", "detail": {"name": "X" * 4100}}
    assert json.loads(option_page([row], 0).body)["items"] == [{"value": "1", "label": "#1 red"}]


def test_enriched_inventory_keeps_legacy_options(client, catalog):
    for _ in range(11):
        client.post("/api/v1/containers", json={"glaze_id": catalog["glaze"]["id"]}).raise_for_status()
    path = "/api/v1/device/options/jars"
    legacy = client.get(path).json()
    assert len(legacy["items"]) == 11 and legacy["next_offset"] is None
    assert "detail" not in legacy["items"][0]
    page = client.get(path, params={"details": True})
    assert len(page.content) <= 4096
    row = page.json()["items"][0]
    full = client.get("/api/v1/device/jars/" + row["value"]).json()
    assert all(full[key] == value for key, value in row["detail"].items())

