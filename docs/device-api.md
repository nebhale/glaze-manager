# Device API contract

All endpoints are under `/api/v1`. Send JSON with `Content-Type: application/json`.
Weights are grams; the server stores integer milligrams. NFC UIDs are hex strings
(4–32 digits); case, spaces, colons, and hyphens are normalized. Tags identify
physical containers, not glaze products. A tag has one owner and a container has
one tag. `device_id` is a stable name of up to 64 letters, digits, dots, colons,
underscores, or hyphens.

## Scan and lookup

Report a newly detected tag:

```http
POST /api/v1/scans
Content-Type: application/json

{"device_id":"studio-scale","uid":"04:A2:B3:C4:D5:E6:F7"}
```

The response contains `device_id`, `last_seen`, normalized `uid`, and `container`.
For an unbound tag, `container` is `null`. The scale can link it using the binding endpoint below.
The latest scan for each device is available from `GET /api/v1/scans`.
The timestamp identifies a recent scan, not proof that a jar is still present.

A bound container has these compact fields:

```json
{
  "container_id": "a-container-uuid",
  "number": 128,
  "revision": 2,
  "glaze_name": "Blue Rutile",
  "manufacturer_name": "AMACO",
  "tare_g": 100,
  "full_weight_g": 500,
  "archived": false,
  "gross_g": 250,
  "remaining_g": 150,
  "percentage": 37.5,
  "low_stock": false,
  "incomplete": false,
  "below_tare": false,
  "threshold_g": 150
}
```

Weight inputs/calculations can be `null`. Show unknown values as unavailable,
never as zero. `archived` containers must be restored in the web app before
receiving new weights. `below_tare` flags a reading that needs review.

`low_stock` is true for active jars with known remaining weight below
`threshold_g` (150 g by default), even when `full_weight_g` and `percentage` are
unknown. `incomplete` means the gross or empty-jar weight is missing. All jars use the studio setting `low_stock_threshold_g`. The percentage uses net weights: `100 × remaining_g / (full_weight_g − tare_g)`. A missing weight or nonpositive denominator yields `null`.

`GET /api/v1/tags/{uid}` performs the same lookup without reporting another scan;
it returns `{ "uid": "…", "container": { … } }`. Use it while waiting for an
unknown tag to be bound. Do not emit scan reports for every load-cell sample.

## Confirm and save

Calibrate, zero the empty platform, stabilize the load-cell reading, and confirm
on the touchscreen. Scale zeroing is separate from the jar's tare. Submit the
gross weight including the jar; the server subtracts container tare.

```http
POST /api/v1/containers/a-container-uuid/measurements
Content-Type: application/json

{
  "request_id": "9133d402-920e-47bf-9ada-fd3ab315d16d",
  "expected_revision": 2,
  "gross_g": 250,
  "source": "device",
  "device_id": "studio-scale",
  "tag_uid": "04A2B3C4D5E6F7",
  "note": null
}
```

Generate a unique `request_id` once per confirmed weigh-in (8–100 characters).
Keep the complete submitted payload unchanged for retries. The acknowledged
response contains `measurement_id`, `container_id`, the new `revision`, and
`stock` with the calculated weight/status fields above. Display “Saved” only
after a successful response. A retry returns the original acknowledgement,
including its revision, even if the container has subsequently changed. Perform
a fresh lookup before another weigh-in.

The server atomically verifies the revision, active status, and current tag
association before saving. Duplicate request identifiers with different payloads
are rejected. Reassigning a tag cannot send an old reading to its new owner.

`full_weight_g` is the gross starting weight, including the container.
Send gross readings in `gross_g` for both manual and device measurements.
If the jar has no starting weight, the first accepted device measurement sets
it to that reading when positive, even if the tare is unknown. The measurement
and starting weight are saved in the same transaction. Subsequent readings
keep that starting weight until a user edits it. A manual weigh-in, tag lookup,
or retry does not initialize a new baseline. Historical readings use their
own saved tare and starting weight to calculate percentages.

## Firmware state transitions

1. **Idle:** no jar/tag; no pending reading.
2. **Lookup:** report a new tag, or retry lookup after a connection failure.
3. **Unknown:** link an existing jar by permanent number, or create, link and weigh
   a new jar with the setup operation below. Refresh lookup after linking.
4. **Ready:** display identity, current weight, and setup/low-stock status.
5. **Confirm:** show the stable gross weight and proposed difference. A tap creates
   an immutable pending payload using the revision from the displayed lookup.
6. **Saving:** send the payload. A transport failure retains it in RAM only while
   that jar remains present. Retry the identical payload with bounded backoff
   (1, 2, 4, then 8 seconds) or an explicit Retry button.
7. **Saved:** show the committed result until removal. A new weigh-in requires
   a fresh lookup, a deliberate tap and a new request identifier.

On removal or tag change, clear the pending state and return to lookup/idle.
Clearing local state cannot cancel a request already received by the server;
if a response was lost, the weight may already be committed. Do not create a
replacement identifier to “try again.”

On `409`, stop retrying, display the error, refresh lookup, and ask for confirmation
again with a fresh revision and request identifier. Do not automatically convert
a stale reading into a current one. No durable offline queue is required.

## Errors and ESPHome details

| Status | Meaning | Device action |
| --- | --- | --- |
| `200` | Scan/lookup/save acknowledged | Use the returned state |
| `404` | Referenced container no longer exists | Return to lookup |
| `409` | Stale revision, changed tag, archived jar, or request-ID conflict | Refresh and reconfirm |
| `422` | Invalid fields, UID, or weight | Show the error; correct input |
| Network/`5xx` | No trustworthy acknowledgement | Retry the same pending payload while present |

Error responses contain `detail` (text or a validation-error list).
No authentication header is required on the trusted studio network.

With ESPHome `http_request`, enable `capture_response: true` and set
`max_response_buffer_size: 4096` for device endpoints. Check the HTTP status in
`on_response`; `on_error` covers transport failures, not all non-200 responses.
Use a JSON lambda for numeric fields, and distinguish JSON `null` from zero.
See [ESPHome HTTP requests](https://esphome.io/components/http_request/).

The browser uses `GET /api/v1/events` (server-sent events). Devices do not need
that connection. Events are refresh hints, not an ordered or durable event log.

## Scale-side binding

`PUT /tags/{uid}/binding` accepts `container_id`, `expected_revision`, and optional
`move`/`replace` booleans (both default false). `move` authorizes taking the tag
from another container; `replace` authorizes removing the destination's old tag.
The normal web flow asks the user to select these explicitly. Both containers'
revisions change when a tag moves. Archive keeps the association intact.

When someone selects a jar from the scale dropdown, send `source: "device"`,
`device_id`, and `manual_selection: true`, and omit `tag_uid`. The server
checks the selected jar’s revision and active status. Scanned measurements
still require the current tag binding.

Web readings use the same measurement endpoint with `source: "web"` and no
device fields. The web interface supports incomplete jars and manual correction;
firmware need not implement catalog editing, photos, tag writing, or history.

## Scale-side jar setup

`GET /api/v1/device/jars/{number}` looks up the exact permanent jar number and
returns the compact jar plus `location`, `product_code`, `cone`, and `tag_uid`.
Use an 8192-byte response buffer for details. An unknown number returns 404.

`GET /api/v1/device/options/{kind}` accepts `manufacturers`, `glazes`,
`presets`, `locations`, `cones`, `product-lines`, `jars`, or `unlinked-jars`. The `jars` list includes active jars
in permanent-number order. For tag assignment, `unlinked-jars` includes only active jars
without a tag, sorted by glaze name and product code. Both lists use jar numbers as values. Pass `manufacturer_id` when browsing its glazes.
Optional `q` filters names and glaze codes. The response contains `items`
with `value`, `label`, and optional `code`. Pass `next_offset` as `offset` for
the next page, and stop at null. Each page fits the 4096-byte picker buffer, including its JSON envelope. The number of entries varies. On the jars list, pass `details=true` for a compact `detail` on each entry. If an enriched entry cannot fit alone, use the jar number to fetch its full details.
Location, cone, and product line values are free text. Catalog choices use IDs.

With a stable gross reading, submit one confirmed setup to
`POST /api/v1/device/jar-setups`. Include the UID when creating a jar for a scanned
tag. Omit it when the user chooses to create an untagged jar from the inventory list.

```json
{
  "request_id": "16a88d63-c381-4dd5-b5f7-333fd1f04089",
  "device_id": "studio-scale",
  "uid": "04010203",
  "glaze_id": "a-glaze-uuid",
  "preset_id": "a-preset-uuid",
  "location": "Studio",
  "cost_usd": "18.50",
  "gross_g": 756
}
```

Supply either `glaze_id` or `new_glaze` with a `name` and an optional `manufacturer_id`. A
new glaze is created in the same transaction as the jar and measurement.
Preset, location and cost may be omitted. The server allocates
the number, copies the selected preset tare, binds the UID if supplied, and records the first
measurement together. It returns the measurement acknowledgement plus `number`.
A repeated identical request returns the original result, including after jar
deletion. A changed payload or an already-claimed UID returns 409. Use the same
in-memory retry and tag-presence rules as an ordinary measurement.
