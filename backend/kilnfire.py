"""Read Kilnfire's member API using a renewable, cookie-based login session."""

import json
import re
from datetime import UTC, datetime
from html.parser import HTMLParser
from http.cookiejar import Cookie
from urllib.parse import unquote, urljoin, urlsplit

import httpx

PHOTO_LIMIT = 25 * 1024 * 1024
AUTH_MESSAGE = "Your Kilnfire session has expired. Sign in again in Settings."


class KilnfireError(Exception):
    pass


class LoginRequired(KilnfireError):
    pass


def normalize_endpoint(value):
    parsed = urlsplit(value.strip())
    host = parsed.hostname or ""
    if (
        parsed.scheme != "https"
        or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kilnfire\.com", host)
        or host == "www.kilnfire.com"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "Use your studio's HTTPS address, such as https://marinpottery.kilnfire.com."
        )
    return f"https://{host}"


def photo_url(value):
    if not isinstance(value, str) or not value:
        return None
    url = urljoin("https://kilnfire.s3.amazonaws.com/", value)
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or not re.fullmatch(r"kilnfire\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com", parsed.hostname or "")
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or not re.fullmatch(r"/\d+/pieces/[a-zA-Z0-9_.-]+", parsed.path)
        or parsed.fragment
    ):
        raise KilnfireError("Kilnfire returned an unsupported photo address.")
    return url


class LoginForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.token = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("name") == "_token":
            self.token = attrs.get("value")


def is_auth_cookie(name):
    return name in {"kiln_fire_session", "XSRF-TOKEN"} or name.startswith("remember_web_")


class KilnfireClient:
    def __init__(self, endpoint, cookies=None, *, transport=None):
        self.endpoint = normalize_endpoint(endpoint)
        self.http = httpx.Client(
            base_url=self.endpoint,
            timeout=httpx.Timeout(30, connect=10),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
            headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        for item in json.loads(cookies or "[]"):
            if is_auth_cookie(item["name"]):
                self.http.cookies.jar.set_cookie(Cookie(**item))
        self.transport = transport

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.http.close()

    def cookies(self):
        # CookieJar retains expiry/domain information so Laravel's remember
        # cookie can renew a session after its shorter-lived cookie expires.
        return json.dumps(
            [
                {
                    "version": c.version,
                    "name": c.name,
                    "value": c.value,
                    "port": c.port,
                    "port_specified": c.port_specified,
                    "domain": c.domain,
                    "domain_specified": c.domain_specified,
                    "domain_initial_dot": c.domain_initial_dot,
                    "path": c.path,
                    "path_specified": c.path_specified,
                    "secure": c.secure,
                    "expires": c.expires,
                    "discard": c.discard,
                    "comment": c.comment,
                    "comment_url": c.comment_url,
                    "rest": c._rest,
                    "rfc2109": c.rfc2109,
                }
                for c in self.http.cookies.jar
                if is_auth_cookie(c.name)
            ]
        )

    def request(self, method, path, **kwargs):
        url = urljoin(self.endpoint, path)
        try:
            for _ in range(6):
                if (urlsplit(url).scheme, urlsplit(url).netloc) != (
                    urlsplit(self.endpoint).scheme,
                    urlsplit(self.endpoint).netloc,
                ):
                    raise KilnfireError("Kilnfire redirected outside the configured studio.")
                headers = {}
                if method != "GET":
                    for cookie in self.http.cookies.jar:
                        if cookie.name == "XSRF-TOKEN":
                            headers["X-XSRF-TOKEN"] = unquote(cookie.value)
                response = self.http.request(method, url, headers=headers, **kwargs)
                if not response.is_redirect:
                    return response
                location = response.headers.get("location")
                if not location:
                    break
                url = urljoin(url, location)
                if response.status_code == 303 or (
                    response.status_code in (301, 302) and method == "POST"
                ):
                    method, kwargs = "GET", {}
            raise KilnfireError("Kilnfire returned too many redirects.")
        except httpx.HTTPError:
            raise KilnfireError("Unable to reach Kilnfire. Please try again.") from None

    def api(self, method, path, **kwargs):
        for attempt in range(2):
            response = self.request(method, path, **kwargs)
            expired = response.status_code in (401, 419) or (
                response.status_code == 200
                and "application/json" not in response.headers.get("content-type", "")
            )
            if expired:
                if attempt == 0:
                    # This gives Laravel a chance to restore the session from
                    # its remember cookie and renew the CSRF token.
                    self.request("GET", "/pieces")
                    continue
                raise LoginRequired(AUTH_MESSAGE)
            if response.status_code != 200:
                raise KilnfireError("Kilnfire could not complete this request. Please try again.")
            try:
                data = response.json()
            except ValueError:
                raise KilnfireError("Kilnfire returned an invalid response.") from None
            if not isinstance(data, dict) or data.get("status") != "success":
                raise KilnfireError("Kilnfire returned an unexpected response.")
            return data
        raise LoginRequired(AUTH_MESSAGE)

    def login(self, email, password):
        response = self.request("GET", "/login")
        form = LoginForm()
        form.feed(response.text)
        if response.status_code != 200 or not form.token:
            raise KilnfireError("Unable to start Kilnfire sign-in. Please try again.")
        self.request(
            "POST",
            "/login",
            data={"_token": form.token, "email": email, "password": password, "remember": "on"},
        )
        try:
            self.list_page(1)
        except LoginRequired:
            raise LoginRequired(
                "Kilnfire did not accept that login. Check your email and password."
            ) from None

    def list_page(self, page):
        data = self.api(
            "POST",
            f"/pieces/data?page={page}",
            json={"user_id": 0, "search": "", "billing_filter": "all", "firing_type_filter": None},
        )
        result = data.get("pieces")
        if (
            not isinstance(result, dict)
            or not isinstance(result.get("data"), list)
            or type(result.get("last_page")) is not int
            or not 1 <= result["last_page"] <= 10000
            or result.get("current_page") != page
        ):
            raise KilnfireError("Kilnfire returned an invalid piece list.")
        return result

    def detail(self, piece_id):
        data = self.api("GET", f"/pieces/{piece_id}/data?view=yes")
        piece = data.get("piece")
        if not isinstance(piece, dict) or piece.get("id") != piece_id:
            raise KilnfireError("Kilnfire returned an invalid piece.")
        return piece

    def pieces(self):
        ids = set()
        page = 1
        while True:
            result = self.list_page(page)
            for piece in result["data"]:
                piece_id = piece.get("id") if isinstance(piece, dict) else None
                if type(piece_id) is not int or not 1 <= piece_id <= 9223372036854775807:
                    raise KilnfireError("Kilnfire returned an invalid piece ID.")
                if piece_id in ids:
                    raise KilnfireError("Kilnfire's piece list changed. Refresh and try again.")
                ids.add(piece_id)
                yield normalize_piece(self.detail(piece_id))
            if page >= result["last_page"]:
                break
            page += 1

    def download_photo(self, url):
        # Media uses a separate client, with no session cookies or auth headers.
        url = photo_url(url)
        try:
            with httpx.Client(
                timeout=httpx.Timeout(30, connect=10), trust_env=False, transport=self.transport
            ) as media:
                for _ in range(4):
                    with media.stream("GET", url) as response:
                        if response.is_redirect:
                            url = photo_url(urljoin(url, response.headers.get("location", "")))
                            continue
                        if response.status_code != 200:
                            raise KilnfireError(
                                "A Kilnfire photo could not be downloaded. Try again."
                            )
                        content = bytearray()
                        for chunk in response.iter_bytes():
                            content.extend(chunk)
                            if len(content) > PHOTO_LIMIT:
                                raise KilnfireError("A Kilnfire photo is larger than 25 MB.")
                        return bytes(content)
                raise KilnfireError("A Kilnfire photo redirected too many times.")
        except httpx.HTTPError:
            raise KilnfireError("A Kilnfire photo could not be downloaded. Try again.") from None


def normalize_date(value):
    if not value or not isinstance(value, str):
        return None
    try:
        date = datetime.fromisoformat(value)
        return date.replace(tzinfo=date.tzinfo or UTC).astimezone(UTC).isoformat()
    except ValueError:
        return None


def normalize_piece(piece):
    images = []
    seen = set()
    source = piece.get("images") or []
    if not isinstance(source, list) or len(source) > 100:
        raise KilnfireError("Kilnfire returned an unsupported photo list.")
    for image in source:
        if not isinstance(image, dict):
            raise KilnfireError("Kilnfire returned an invalid photo.")
        url = photo_url(image.get("image"))
        if url and url not in seen:
            seen.add(url)
            images.append({"image": url, "thumb": photo_url(image.get("thumb")) or url})
    primary = photo_url(piece.get("image"))
    if primary and primary not in seen:
        images.insert(0, {"image": primary, "thumb": photo_url(piece.get("thumb")) or primary})
    firings = piece.get("kiln_firings") or []
    if not isinstance(firings, list) or any(not isinstance(f, dict) for f in firings):
        raise KilnfireError("Kilnfire returned an invalid firing list.")
    firings = sorted(
        firings,
        key=lambda f: (normalize_date(f.get("start_firing_at")) or "", str(f.get("id", ""))),
    )
    firing_type = None
    if firings:
        kind = firings[-1].get("kiln_firing_type")
        if isinstance(kind, dict) and isinstance(kind.get("name"), str):
            firing_type = kind["name"].strip() or None
    return {
        "piece_id": piece["id"],
        "name": str(piece.get("name") or "").strip() or f"Piece #{piece['id']}",
        "firing_type": firing_type,
        "created_at": normalize_date(piece.get("created_at")),
        "images": json.dumps(images),
    }
