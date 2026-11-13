# Kilnfire API for importing pieces

Kilnfire exposes the piece list and firing history through the same JSON
endpoints its web app uses. An importer can enumerate the signed-in member's
pieces, fetch each piece's details, and read the type and timestamps of every
associated kiln firing.

Base URL: `https://<studio>.kilnfire.com`. The endpoints below were checked on
`https://marinpottery.kilnfire.com` on November 13, 2026, using a member session.
This is an internal, unversioned web API. Examples are trimmed and use synthetic
piece and firing IDs. No credentials or member records are included here.

## Authentication

Requests use the website's session cookies. The site sets
`kiln_fire_session` as an HttpOnly cookie and `XSRF-TOKEN` as a readable cookie.
The observed cookie domain is `.kilnfire.com`, with Secure and SameSite=Lax.

For JSON requests, use:

```http
Accept: application/json
Content-Type: application/json
X-Requested-With: XMLHttpRequest
X-XSRF-TOKEN: <URL-decoded value of the XSRF-TOKEN cookie>
```

Keep the session and XSRF cookies together in the HTTP client's cookie jar.
A browser request on the Kilnfire origin can use `credentials: "same-origin"`.
A POST to the list endpoint using browser `fetch`, these headers, and the
existing session returned HTTP 200 and `status: "success"`.

An unauthenticated `GET /pieces` redirects to `/login`. The login page exposes
a `POST /login` form with `_token`, `email`, `password`, and optional `remember`
fields. The `_token` comes from that login page and must accompany the same
cookie jar. Fresh sign-in and member imports were verified through Glaze Manager.
Session renewal follows Laravel's remember-cookie flow; forced expiration is
covered by integration tests rather than waiting for a live session to expire.
The inspected requests use session authentication; they do not establish an API
key or OAuth flow.

For a glaze-manager connection, establish authentication with Kilnfire separately
from importing data. Safari's existing session is sufficient for this investigation
but does not automatically authenticate the glaze-manager backend.

## Piece list

```http
POST /pieces/data?page=1
Content-Type: application/json

{
  "user_id": 0,
  "search": "",
  "billing_filter": "all",
  "firing_type_filter": null
}
```

This is a read operation despite using POST. `user_id: 0` returned the current
member's pieces. Use that value for a member import rather than supplying another
user's ID. `billing_filter` is required: a null value returned HTTP 422 with
`errors.billing_filter` and the message `The billing filter field is required.`

The response has these top-level fields:

| Field | Meaning |
| --- | --- |
| `status` | `"success"` for the successful request |
| `pieces` | Paginated piece records |
| `organization` | Studio settings, including `metric` and `use_kilnloading` |
| `user` | Current member context |
| `member` | Additional member context; nullable |
| `kiln_firing_types` | Nullable; it was null for this member's list response |

`pieces` includes `data`, `current_page`, `last_page`, `per_page`, `total`,
`from`, `to`, `next_page_url`, `prev_page_url`, `first_page_url`, `last_page_url`,
`path`, and pagination `links`. The observed page size was 30. Advance the `page`
query parameter while continuing to use POST and the same JSON body; the next
page URL does not change the request method to GET. Only one populated page was
available in the inspected account.

List records include `id`, `name`, `notes`, image paths, dimensions, `qty`,
`ready_at`, `last_submitted_at`, `created_at`, and `updated_at`. They did **not**
include `kiln_firings` or `firing_fees`, so a list-only import cannot recover the
firing history.

Additional filter values appear in the frontend source but were not exercised:

| Parameter | Values used by the frontend |
| --- | --- |
| `billing_filter` | `all`, `unbilled`, `billed`, `issue`, `users`, `pickup` |
| `firing_type_filter` | null, `unfired`, or a kiln firing type ID |
| `search` | Free text |

## Piece details and firing history

```http
GET /pieces/{piece_id}/data?view=yes
Accept: application/json
X-Requested-With: XMLHttpRequest
```

The web app's piece view uses this exact URL. The response includes `status`,
`piece`, `piece_timeline`, `mode`, `organization`, `user`, `firing_prices`,
`firing_issue_types`, `user_perks`, `has_payment_method`, and
`piece_need_card_message`. Import the piece-related fields and discard unrelated
account and payment context.

A partial response illustrates the fields needed for an import:

```json
{
  "status": "success",
  "piece": {
    "id": 12345,
    "name": "Cup",
    "notes": "",
    "length": 3,
    "width": 3,
    "height": 2,
    "qty": 1,
    "ready_at": null,
    "last_submitted_at": "2026-10-22T03:34:10.000000Z",
    "created_at": "2026-10-22T03:34:10.000000Z",
    "updated_at": "2026-10-22T03:34:10.000000Z",
    "kiln_firings": [
      {
        "id": 6789,
        "kiln_firing_type_id": 2,
        "start_firing_at": "2026-10-27T00:09:37.000000Z",
        "start_cooling_at": "2026-10-27T15:09:37.000000Z",
        "end_cooling_at": "2026-10-28T06:09:37.000000Z",
        "unloaded_at": "2026-10-29T18:12:19.000000Z",
        "kiln_firing_type": {
          "id": 2,
          "name": "Bisque",
          "firing_hours": "15.00",
          "cooling_hours": "15.00"
        }
      }
    ],
    "firing_fees": [],
    "firing_issues": [],
    "images": []
  },
  "piece_timeline": [
    {
      "title": "Bisque Firing",
      "type": "kiln_firing_started",
      "date": "2026-10-27T00:09:37.000000Z"
    },
    {
      "title": "Unloaded",
      "type": "kiln_firing_unloaded",
      "date": "2026-10-29T18:12:19.000000Z"
    }
  ]
}
```

`piece.kiln_firings[]` is the structured association between a piece and its kiln
firings. Each observed record also included a `pivot` with `piece_id` and
`kiln_firing_id`. Preserve the full array so later glaze firings or refirings can
coexist with earlier bisque firings. Read the firing kind from
`kiln_firing_type.name` and retain its studio-specific ID.

`piece_timeline[]` provides display events with `title`, `type`, and `date`.
Observed event types were `piece_created`, `firing_fee`, `kiln_firing_started`,
and `kiln_firing_unloaded`. Use the structured firing records to identify firings;
timeline titles are display text.

## Scheduled and completed firing states

The frontend computes the firing phase from timestamps. An importer can use the
following ordered rules for each associated firing:

| Condition | Imported state |
| --- | --- |
| `unloaded_at` is non-null | Completed and unloaded |
| Required timestamps are missing or invalid | Unknown |
| Now is before `start_firing_at` | Scheduled |
| Now is before `start_cooling_at` | Firing |
| Now is before `end_cooling_at` | Cooling |
| Cooling time has passed and `unloaded_at` is null | Awaiting unload |

The intermediate phases are schedule estimates. Passing `end_cooling_at` alone
does not establish that staff unloaded the kiln. Completion should use
`unloaded_at`. The source frontend checks these same time boundaries; the table
uses consecutive intervals to avoid gaps at exact timestamp equality.

An empty `kiln_firings` array means there is no recorded kiln assignment. It does
not identify the intended firing kind. Keep submission, assignment, and completion
as separate facts:

- `firing_fees[].created_at` records a firing submission or charge. Its nested
  `firing_price.name` names the fee, which may be generic. An observed completed
  Bisque firing had an `MP Student Firing` fee.
- `firing_fees[].paid_at` describes payment, not firing completion.
- `piece.ready_at` was null even for pieces with unloaded Bisque firings. It is
  not a reliable substitute for firing completion.

The account contained both unassigned submissions and completed Bisque firings.
Scheduled, firing, cooling, multiple-firing, and Glaze examples were not present
in its piece history; their handling follows the frontend's phase logic and the
array structure rather than live examples of those states. No cone, temperature,
or atmosphere field appeared in the inspected firing records.

## Firing type catalog

```http
GET /kiln-firings/types/data
```

This returned HTTP 200 with `{ "status": "success", "kiln_firing_types": [...] }`.
Each type includes `id`, `name`, `firing_hours`, and `cooling_hours`. The inspected
studio returned `Glaze` and `Bisque`. Names and IDs belong to the studio; avoid
hardcoding those IDs in an importer.

The bundle also references `POST /kiln-firings/data?page=1` for a global firing
list, but that request returned HTTP 404 in the member session. The piece import
can obtain its firing associations from piece details without that endpoint.

## Photos and measurements

Detail responses expose `piece.images[]` records with `id`, `image`, `thumb`,
`order`, and timestamps, plus organization, user, and piece IDs. The piece also
has primary `image` and `thumb` paths. The observed browser resolved paths such
as `/368/pieces/<filename>.jpg` against `https://kilnfire.s3.amazonaws.com`,
not against the studio's web origin. The importer deduplicates repeated image
addresses and copies originals into local photos and thumbnails. Its piece
association prevents repeat imports from duplicating photos.

`organization.metric` controls measurement units in the frontend: centimeters
and kilograms when true, inches and pounds when false. Some numeric values,
including `total_cubic` and firing duration hours, arrive as decimal strings;
optional dimensions and weights can be null.

## Import implementation in glaze-manager

Settings stores a studio origin and opaque authentication cookies in
`kilnfire_connection`. Login credentials are submitted once, forwarded to that
studio's login form, and discarded. Authentication cookies are never returned to
the frontend. The login asks Kilnfire for its remember cookie; subsequent requests
retain rotated cookies and attempt to restore the session before asking for a
new login. HTTP failures do not erase a valid connection.

Each entry to the import screen fetches every list page and then each piece's
details. The snapshot is replaced only after the complete refresh succeeds. An
observed piece retained its creation-time `updated_at` after its firing was
unloaded, so this refresh does not use that timestamp as an incremental cursor.

`kilnfire_pieces` caches the description, creation date, most recent assigned
firing type, and photo addresses needed for the candidate tiles. The composite
identity is studio origin plus source piece ID. Firing types keep their source
names, including studio-specific values. Pieces without a kiln assignment stay
unclassified rather than deriving a kind from their fee. Detailed firing history,
billing, dimensions, and other account information are not imported into vessels.

The cache also retains archived choices and the optional vessel association.
Linked pieces are excluded even when Show archived is enabled. Each source piece
can link to one vessel, and each vessel can link to one source piece. A vessel's
foreign key uses `ON DELETE SET NULL`; deletion releases its source piece without
discarding the cache. Manual unlinking clears the association and restores the
candidate without deleting local photos.

Importing rechecks the current member's piece list and fetches fresh details.
The name, all photos, source URL, and association are saved together. If any photo
fails, the vessel and link stay unchanged. Repeated requests for an already
imported piece return its linked vessel without duplicating photos. Existing
vessels retain their local number, location, archive status, photos, and glaze
applications; only their name and source URL are replaced, and photos are added.
The expected existing name prevents importing over a simultaneous name edit.

The optional `Vessel.source_url` field is read-only and appears as **Kilnfire**
on the vessel page, with the same open-link action as other URL fields. Only
importing/linking populates it; unlinking clears it. Manual vessel creation
and edits cannot set or change this field.

## Sources

- The authenticated [piece list](https://marinpottery.kilnfire.com/pieces), its
  list endpoint, and detail endpoints for the member's listed pieces.
- The [frontend bundle](https://marinpottery.kilnfire.com/build/assets/app-fea4cd5c.js)
  for request construction, available filters, and firing phase predicates.
- The [login page](https://marinpottery.kilnfire.com/login) and unauthenticated
  redirect headers for cookie names and the login form structure.
- The [firing type endpoint](https://marinpottery.kilnfire.com/kiln-firings/types/data).
