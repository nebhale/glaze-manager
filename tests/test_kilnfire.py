import io
import json
from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
from urllib.parse import parse_qs

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from backend import models as m

ORIGIN = "https://studio.kilnfire.com"
LOGIN = {"email": "potter@example.com", "password": "a private test password"}


def image_bytes(color="red"):
    stream = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(stream, format="PNG")
    return stream.getvalue()


def source_piece(identifier, name, kind, created):
    return {
        "id": identifier,
        "name": name,
        "created_at": created,
        "images": [
            {"image": f"/1/pieces/{identifier}.png", "thumb": f"/1/pieces/{identifier}-thumb.png"}
        ],
        "kiln_firings": []
        if kind is None
        else [{"id": 1, "start_firing_at": created, "kiln_firing_type": {"name": kind}}],
        "firing_fees": [{"firing_price": {"name": "Student firing"}}],
    }


class Studio:
    def __init__(self):
        self.pieces = {
            10: source_piece(10, "Basalt cup", "Bisque", "2026-10-01T00:00:00Z"),
            20: source_piece(20, "Tall vase", "Raku", "2026-10-03T00:00:00Z"),
            30: source_piece(30, "Wide bowl", None, "2026-10-02T00:00:00Z"),
        }
        self.pieces[10]["images"].append({"image": "/1/pieces/second.png", "thumb": None})
        self.valid = False
        self.renewable = True
        self.network_error = False
        self.failed_detail = None
        self.failed_photo = None
        self.photo_redirect = None
        self.redirect_login = None
        self.rotated = None
        self.requests = []

    def transport(self, request):
        self.requests.append(request)
        if self.network_error:
            raise httpx.ConnectError("Unavailable", request=request)
        if request.url.host == "kilnfire.s3.amazonaws.com":
            assert "cookie" not in request.headers and "x-xsrf-token" not in request.headers
            if self.photo_redirect:
                return httpx.Response(302, headers={"location": self.photo_redirect})
            if request.url.path == self.failed_photo:
                return httpx.Response(503)
            return httpx.Response(200, content=image_bytes(), headers={"content-type": "image/png"})
        assert request.url.host.endswith(".kilnfire.com")
        cookies = SimpleCookie(request.headers.get("cookie", ""))
        path = request.url.path
        if path == "/login" and request.method == "GET":
            if self.redirect_login:
                return httpx.Response(307, headers={"location": self.redirect_login})
            return httpx.Response(
                200,
                text='<form><input name="_token" value="form-token"></form>',
                headers=[
                    ("content-type", "text/html"),
                    ("set-cookie", "XSRF-TOKEN=csrf%2B; Domain=.kilnfire.com; Path=/; Secure"),
                    (
                        "set-cookie",
                        "kiln_fire_session=anonymous; Domain=.kilnfire.com; Path=/; Secure; HttpOnly",
                    ),
                ],
            )
        if path == "/login" and request.method == "POST":
            body = parse_qs(request.content.decode())
            assert body["_token"] == ["form-token"]
            assert body["remember"] == ["on"]
            assert request.headers["x-xsrf-token"] == "csrf+"
            self.valid = body["email"] == [LOGIN["email"]] and body["password"] == [
                LOGIN["password"]
            ]
            if not self.valid:
                return httpx.Response(422, json={"errors": {"email": ["Invalid login"]}})
            return httpx.Response(
                302,
                headers=[
                    ("location", "/dashboard"),
                    (
                        "set-cookie",
                        "kiln_fire_session=authenticated; Domain=.kilnfire.com; Path=/; Secure; HttpOnly",
                    ),
                    (
                        "set-cookie",
                        "remember_web_example=renewal-token; Domain=.kilnfire.com; Path=/; Secure; HttpOnly",
                    ),
                    ("set-cookie", "unrelated_preference=ignored; Domain=.kilnfire.com; Path=/"),
                ],
            )
        if path == "/dashboard":
            return httpx.Response(200, text="Dashboard", headers={"content-type": "text/html"})
        if path == "/pieces":
            if self.renewable and "remember_web_example" in cookies:
                self.valid = True
                return httpx.Response(
                    200,
                    text="Pieces",
                    headers=[
                        ("content-type", "text/html"),
                        (
                            "set-cookie",
                            "kiln_fire_session=renewed; Domain=.kilnfire.com; Path=/; Secure; HttpOnly",
                        ),
                        ("set-cookie", "XSRF-TOKEN=new-csrf; Domain=.kilnfire.com; Path=/; Secure"),
                    ],
                )
            return httpx.Response(302, headers={"location": "/login"})
        if not self.valid or "kiln_fire_session" not in cookies:
            return httpx.Response(401, json={"message": "Unauthenticated"})
        if path == "/pieces/data":
            assert request.method == "POST"
            assert request.headers["x-xsrf-token"] in {"csrf+", "new-csrf"}
            assert json.loads(request.content) == {
                "user_id": 0,
                "search": "",
                "billing_filter": "all",
                "firing_type_filter": None,
            }
            number = int(request.url.params["page"])
            items = list(self.pieces.values())
            headers = (
                {
                    "set-cookie": f"kiln_fire_session={self.rotated}; Domain=.kilnfire.com; Path=/; Secure"
                }
                if self.rotated
                else {}
            )
            return httpx.Response(
                200,
                headers=headers,
                json={
                    "status": "success",
                    "pieces": {
                        "current_page": number,
                        "last_page": max(1, (len(items) + 1) // 2),
                        "data": [{"id": p["id"]} for p in items[(number - 1) * 2 : number * 2]],
                    },
                },
            )
        if path.startswith("/pieces/") and path.endswith("/data"):
            identifier = int(path.split("/")[2])
            assert request.url.params["view"] == "yes"
            if identifier == self.failed_detail:
                return httpx.Response(503)
            return httpx.Response(200, json={"status": "success", "piece": self.pieces[identifier]})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")


@pytest.fixture
def studio(client):
    remote = Studio()
    client.app.state.kilnfire_transport = httpx.MockTransport(remote.transport)
    return remote


def connect(client):
    response = client.put("/api/v1/kilnfire", json={"endpoint": ORIGIN + "/"})
    assert response.status_code == 200
    response = client.post("/api/v1/kilnfire/login", json=LOGIN)
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "connected"


def refresh(client):
    response = client.post("/api/v1/kilnfire/pieces/refresh")
    assert response.status_code == 200, response.text
    return response.json()


def candidates(client, **params):
    response = client.get("/api/v1/kilnfire/pieces", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def imported(client, piece_id=10, **body):
    return client.post(
        f"/api/v1/kilnfire/pieces/{piece_id}/import", json={"endpoint": ORIGIN, **body}
    )


def test_login_retains_only_tokens_and_disconnect_keeps_import_history(client, studio, caplog):
    assert client.get("/api/v1/kilnfire").json()["state"] == "not_configured"
    connect(client)
    with client.app.state.sessions() as db:
        row = db.get(m.KilnfireConnection, 1)
        tokens = json.loads(row.cookies)
        assert {c["name"] for c in tokens} == {
            "XSRF-TOKEN",
            "kiln_fire_session",
            "remember_web_example",
        }
        assert LOGIN["email"] not in row.cookies and LOGIN["password"] not in row.cookies
    for secret in (LOGIN["email"], LOGIN["password"], "renewal-token", "authenticated"):
        assert secret not in client.get("/api/v1/kilnfire").text
        assert secret not in caplog.text
    assert client.get("/api/v1/kilnfire").headers["cache-control"] == "no-store"
    refresh(client)
    vessel = imported(client).json()
    assert client.delete("/api/v1/kilnfire").json()["state"] == "signed_out"
    with client.app.state.sessions() as db:
        assert db.get(m.KilnfireConnection, 1).cookies is None
        assert db.get(m.KilnfirePiece, (ORIGIN, 10)).vessel_id == vessel["id"]
    assert client.post("/api/v1/kilnfire/pieces/refresh").status_code == 401


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://kilnfire.com",
        "http://studio.kilnfire.com",
        "https://kilnfire.com.evil.test",
        "https://studio.kilnfire.com/pieces",
        "https://user:password@studio.kilnfire.com",
        "https://127.0.0.1",
        "https://studio.kilnfire.com:8443",
        "https://www.kilnfire.com",
    ],
)
def test_studio_address_is_a_specific_https_kilnfire_origin(client, endpoint):
    assert client.put("/api/v1/kilnfire", json={"endpoint": endpoint}).status_code == 422


def test_invalid_login_does_not_store_credentials_or_anonymous_cookies(client, studio):
    client.put("/api/v1/kilnfire", json={"endpoint": ORIGIN}).raise_for_status()
    response = client.post("/api/v1/kilnfire/login", json={**LOGIN, "password": "incorrect"})
    assert response.status_code == 401 and "did not accept" in response.json()["detail"]
    with client.app.state.sessions() as db:
        assert db.get(m.KilnfireConnection, 1).cookies is None
    assert client.get("/api/v1/kilnfire").json()["state"] == "signed_out"


def test_session_renewal_cookie_rotation_and_unrecoverable_expiry(client, studio):
    connect(client)
    studio.valid, studio.rotated = False, "rotated-session"
    assert client.post("/api/v1/kilnfire/check").json()["state"] == "connected"
    with client.app.state.sessions() as db:
        assert "rotated-session" in db.get(m.KilnfireConnection, 1).cookies
    studio.valid, studio.renewable = False, False
    assert client.post("/api/v1/kilnfire/check").status_code == 401
    assert client.get("/api/v1/kilnfire").json()["state"] == "needs_login"
    studio.renewable = True
    assert client.post("/api/v1/kilnfire/login", json=LOGIN).json()["state"] == "connected"


def test_network_failure_does_not_discard_the_saved_session(client, studio):
    connect(client)
    studio.network_error = True
    assert client.post("/api/v1/kilnfire/check").status_code == 502
    assert client.get("/api/v1/kilnfire").json()["state"] == "connected"
    studio.network_error = False
    assert client.post("/api/v1/kilnfire/check").status_code == 200


@pytest.mark.parametrize(
    "redirect", ["https://evil.test/login", "http://studio.kilnfire.com/login"]
)
def test_login_redirects_cannot_forward_credentials_outside_https_studio(client, studio, redirect):
    studio.redirect_login = redirect
    client.put("/api/v1/kilnfire", json={"endpoint": ORIGIN})
    assert client.post("/api/v1/kilnfire/login", json=LOGIN).status_code == 502
    assert len(studio.requests) == 1


def test_all_remote_pages_are_newest_first_before_pagination_and_keep_custom_types(client, studio):
    connect(client)
    assert refresh(client) == {"count": 3}
    result = candidates(client, page_size=2, page=2)
    assert result["total"] == 3 and result["items"][0]["piece_id"] == 10
    result = candidates(client)
    assert [p["piece_id"] for p in result["items"]] == [20, 30, 10]
    assert [p["firing_type"] for p in result["items"]] == ["Raku", None, "Bisque"]
    assert result["items"][-1]["image_count"] == 2
    assert (
        result["items"][-1]["thumbnail_url"]
        == "https://kilnfire.s3.amazonaws.com/1/pieces/10-thumb.png"
    )


def test_archived_choices_survive_refresh_and_can_be_restored(client, studio):
    connect(client)
    refresh(client)
    path = "/api/v1/kilnfire/pieces/20"
    body = {"endpoint": ORIGIN, "archived": True}
    assert client.patch(path, json=body).json()["archived"]
    studio.pieces[20]["name"] = "Renamed vase"
    refresh(client)
    assert candidates(client)["total"] == 2
    result = candidates(client, show_archived=True)
    assert result["total"] == 3
    archived = next(p for p in result["items"] if p["piece_id"] == 20)
    assert archived["archived"] and archived["name"] == "Renamed vase"
    assert not client.patch(path, json={**body, "archived": False}).json()["archived"]
    assert candidates(client)["total"] == 3


def test_import_copies_all_images_and_is_idempotent_then_unlink_and_delete_restore_candidate(
    client, studio
):
    connect(client)
    refresh(client)
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses = list(workers.map(lambda _: imported(client), range(2)))
    assert all(r.status_code == 200 for r in responses)
    first = responses[0].json()
    assert first["id"] == responses[1].json()["id"]
    assert first["name"] == "Basalt cup" and len(first["photos"]) == 2
    assert first["photos"][0]["cover"] and not first["photos"][1]["cover"]
    assert first["source_url"] == f"{ORIGIN}/pieces/10"
    assert first["kilnfire_link"] == {"endpoint": ORIGIN, "piece_id": 10}
    assert client.get("/api/v1/vessels").json()["total"] == 1
    assert candidates(client, show_archived=True)["total"] == 2
    assert all(client.get(p["url"]).status_code == 200 for p in first["photos"])
    assert all(client.get(p["thumbnail_url"]).status_code == 200 for p in first["photos"])
    refresh(client)
    assert candidates(client)["total"] == 2
    path = f"/api/v1/vessels/{first['id']}"
    result = client.delete(f"{path}/kilnfire").json()
    assert result["kilnfire_link"] is None and result["source_url"] is None
    assert result["photos"] == first["photos"] and candidates(client)["total"] == 3
    second = imported(client).json()
    assert second["id"] != first["id"]
    client.delete(f"/api/v1/vessels/{second['id']}").raise_for_status()
    assert candidates(client)["total"] == 3
    assert client.get(first["photos"][0]["url"]).status_code == 200


def test_import_into_existing_preserves_local_data_and_prevents_silent_relinking(
    client, studio, catalog
):
    connect(client)
    refresh(client)
    vessel = client.post("/api/v1/vessels", json={"name": "Existing", "location": "Shelf"}).json()
    path = f"/api/v1/vessels/{vessel['id']}"
    client.patch(path, json={"changes": {"archived": True}, "expected": {"archived": False}})
    photo = client.post(
        f"{path}/photos", files={"file": ("local.png", image_bytes("blue"), "image/png")}
    ).json()
    client.post(
        f"{path}/applications", json={"glaze_id": catalog["glaze"]["id"]}
    ).raise_for_status()
    assert imported(client, vessel_id=vessel["id"], expected_name="Stale").status_code == 409
    assert client.get(path).json()["name"] == "Existing"
    response = imported(client, vessel_id=vessel["id"], expected_name="Existing")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["id"] == vessel["id"] and result["name"] == "Basalt cup"
    assert result["location"] == "Shelf" and result["archived"]
    assert len(result["applications"]) == 1 and len(result["photos"]) == 3
    assert result["photos"][0] == photo
    assert all(not p["cover"] for p in result["photos"][1:])
    assert client.get("/api/v1/kilnfire/vessel-options").json() == []
    assert (
        imported(client, 20, vessel_id=vessel["id"], expected_name="Basalt cup").status_code == 409
    )
    client.delete(f"{path}/kilnfire").raise_for_status()
    options = client.get("/api/v1/kilnfire/vessel-options", params={"q": f"#{vessel['id']}"}).json()
    assert options == [{"id": vessel["id"], "name": "Basalt cup", "archived": True}]


def test_failed_photo_download_rolls_back_the_entire_import(client, studio):
    connect(client)
    refresh(client)
    studio.failed_photo = "/1/pieces/second.png"
    response = imported(client)
    assert response.status_code == 502
    assert client.get("/api/v1/vessels").json()["total"] == 0
    assert candidates(client)["total"] == 3
    with client.app.state.sessions() as db:
        assert db.scalar(select(m.VesselPhoto.id)) is None
    studio.failed_photo = None
    assert len(imported(client).json()["photos"]) == 2


def test_photo_redirect_cannot_reach_private_or_unrelated_hosts(client, studio):
    connect(client)
    refresh(client)
    studio.photo_redirect = "http://127.0.0.1/private"
    assert imported(client).status_code == 502
    assert client.get("/api/v1/vessels").json()["total"] == 0


def test_failed_refresh_keeps_last_complete_snapshot_and_missing_pieces_are_removed(client, studio):
    connect(client)
    refresh(client)
    before = candidates(client)
    studio.pieces[10]["name"] = "Edited cup"
    studio.failed_detail = 20
    assert client.post("/api/v1/kilnfire/pieces/refresh").status_code == 502
    assert candidates(client) == before
    studio.failed_detail = None
    del studio.pieces[30]
    refresh(client)
    result = candidates(client)
    assert result["total"] == 2 and result["items"][1]["name"] == "Edited cup"
    assert imported(client, 30).status_code == 409


def test_changing_studios_requires_login_and_does_not_mix_archived_choices(client, studio):
    connect(client)
    refresh(client)
    client.patch("/api/v1/kilnfire/pieces/10", json={"endpoint": ORIGIN, "archived": True})
    second = "https://other.kilnfire.com"
    assert client.put("/api/v1/kilnfire", json={"endpoint": second}).json()["state"] == "signed_out"
    assert candidates(client)["total"] == 0
    assert imported(client).status_code == 409
    assert client.post("/api/v1/kilnfire/login", json=LOGIN).status_code == 200
    refresh(client)
    assert candidates(client)["total"] == 3
    client.put("/api/v1/kilnfire", json={"endpoint": ORIGIN}).raise_for_status()
    assert candidates(client)["total"] == 2


def test_kilnfire_url_can_only_be_populated_by_import_and_cleared_by_unlink(client, studio):
    path = "/api/v1/vessels"
    assert (
        client.post(path, json={"name": "Cup", "source_url": "javascript:alert(1)"}).status_code
        == 422
    )
    assert (
        client.post(path, json={"name": "Cup", "source_url": "https://example.com/cup"}).status_code
        == 422
    )
    vessel = client.post(path, json={"name": "Cup"}).json()
    assert vessel["source_url"] is None
    response = client.patch(
        f"{path}/{vessel['id']}",
        json={
            "changes": {"source_url": "https://example.com/cup"},
            "expected": {"source_url": None},
        },
    )
    assert response.status_code == 422
    connect(client)
    refresh(client)
    vessel = imported(client, vessel_id=vessel["id"], expected_name="Cup").json()
    assert vessel["source_url"] == f"{ORIGIN}/pieces/10"
    response = client.patch(
        f"{path}/{vessel['id']}",
        json={
            "changes": {"source_url": None},
            "expected": {"source_url": vessel["source_url"]},
        },
    )
    assert response.status_code == 422
    assert client.get(f"{path}/{vessel['id']}").json()["source_url"] == vessel["source_url"]
    response = client.delete(f"{path}/{vessel['id']}/kilnfire")
    assert response.status_code == 200 and response.json()["source_url"] is None
