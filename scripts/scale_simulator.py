"""Exercise the scale contract using only Python's standard library."""

import argparse
import json
import urllib.error
import urllib.request
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--device", default="simulated-scale")
    parser.add_argument("--uid", default="04A2B3C4D5E6F7")
    parser.add_argument(
        "--weight", type=float, help="Confirmed gross grams including the jar"
    )
    parser.add_argument(
        "--replay",
        action="store_true",
        help="Replay an identical save to simulate a lost acknowledgement",
    )
    parser.add_argument(
        "--stale",
        action="store_true",
        help="Submit an intentionally stale revision to test conflict handling",
    )
    parser.add_argument("--note")
    args = parser.parse_args()

    def call(path, body):
        request = urllib.request.Request(
            args.url.rstrip("/") + "/api/v1" + path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    try:
        scan = call("/scans", {"device_id": args.device, "uid": args.uid})
        print(json.dumps(scan, indent=2))
        if args.weight is None:
            return
        if not scan["container"]:
            print("Unknown tag. Link it from the scale or through the tag binding API, then run this command again.")
            return
        jar = scan["container"]
        payload = {
            "request_id": str(uuid4()),
            "gross_g": args.weight,
            "expected_revision": jar["revision"] - (1 if args.stale else 0),
            "source": "device",
            "device_id": args.device,
            "tag_uid": scan["uid"],
            "note": args.note,
        }
        path = f"/containers/{jar['container_id']}/measurements"
        first = call(path, payload)
        print(json.dumps(first, indent=2))
        if args.replay:
            second = call(path, payload)
            assert first == second, "Retry unexpectedly changed the save result"
            print("Replay returned the original acknowledgement; no duplicate measurement.")
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}: {error.read().decode()}")
        raise SystemExit(1) from None
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"Connection failed; no save was acknowledged: {error}")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
