# Glaze Manager scale interface inventory

Draft for feature selection, 2 November 2026. The proposed scale is a daily jar
weighing and setup station, with its own Wi-Fi, calibration, and maintenance
controls. Glaze Manager remains the source of inventory records and history.

The reference is [Niko11111/SpoolmanScale](https://github.com/Niko11111/SpoolmanScale/tree/v0.8.3),
using the public v0.8.3 source and its current user guide. The user confirmed this
project and its 3.5-inch, landscape 480×320 touchscreen as the reference.
The documented reference uses a WT32-SC01
Plus, PN532 reader, NAU7802 ADC, and a 2 kg load cell; a 5 kg cell is also an
option. Matching the display size does not yet select our load-cell capacity.
[Reference hardware](https://niko11111.github.io/SpoolmanScale-Docs/#hardware-at-a-glance)

Wi-Fi configuration, scale zeroing, and calibration are explicitly wanted.
Other inclusions below are proposals. Decision IDs D01–D26 are awaiting yes/no;
none should be read as user approval or an implemented firmware feature.

## Inventory and overlap

In the tables, **API** means Glaze Manager already has the underlying operation
or data, although the scale screen still needs to be built. **Extend** means its
device response, contract, or model needs work. **Local** means scale firmware
functionality, independent of the inventory application.

### Daily weighing

Reference: [main screen](https://niko11111.github.io/SpoolmanScale-Docs/use/main-screen/),
[weighing](https://niko11111.github.io/SpoolmanScale-Docs/use/weighing/), and
[weight actions in v0.8.3](https://github.com/Niko11111/SpoolmanScale/blob/v0.8.3/src/ui/confirm_popup.cpp).

| ID | SpoolmanScale capability | Glaze Manager counterpart and disposition |
| --- | --- | --- |
| W01 | Idle screen; wake when an object is placed | Local. Include idle, touch wake, and placement wake where supported. |
| W02 | Identity, manufacturer, material, color, spool ID | API + Extend. Show permanent jar number, glaze, and manufacturer. The compact lookup currently omits jar number. |
| W03 | Stored remaining weight and fill indication | API. Show saved remaining grams, percent when known, and low-stock state. |
| W04 | Live scale weight with empty-spool deduction | Local + API. Show live gross and calculated glaze remaining using the jar's saved tare. |
| W05 | Difference between scale and inventory | Local calculation. Show signed change from the previous saved amount; call it a weight change, not consumption. |
| W06 | Manual weight update and confirmation | API. Include deliberate confirmation, saving, acknowledgement, and retry states. |
| W07 | Stable-weight automatic update with countdown | Local behavior that changes the agreed device workflow. D14. |
| W08 | Choose bagged/unbagged weight and configure bag deduction | No direct need. Glaze protocol already weighs the jar. Omit a second global deduction; an accessory/tray mode would need separate requirements. |
| W09 | Weigh or enter the empty spool weight | API. Capture or enter empty jar weight, explicitly for this jar. D03. |
| W10 | Apply empty-spool weight at spool, filament, or vendor scope | Partial API. Jar presets replace the shared-default concept. Do not apply one tare across a manufacturer; D13 covers editing defaults on the scale. |
| W11 | New-spool/full-weight action | API. Send the gross starting weight of the full jar. The server subtracts tare for the progress bar. D04. |
| W12 | Use as a plain scale without a recognized spool | Local. Include a clearly unsaved weight view for an untagged or unknown object. Saving to an untagged jar is a separate choice, D05. |
| W13 | TARE the platform | Local. Include **Zero scale**; it must not overwrite a jar's empty weight. |
| W14 | Automatic zero-drift correction on an empty pad | Local. D15; allow only when confidently empty, with no tag or active weigh-in. |
| W15 | Calibrate with a known weight; reset calibration | Local. Include guided empty-platform/reference-weight steps, saved result, and confirmed calibration reset. |
| W16 | Work without a fitted load cell | Local. A separate NFC-terminal product mode, not required for a scale. Defer. |

### Tags and inventory records

Reference: [first spools](https://niko11111.github.io/SpoolmanScale-Docs/use/first-spools/),
[tag operations](https://niko11111.github.io/SpoolmanScale-Docs/use/tags/),
[linking source](https://github.com/Niko11111/SpoolmanScale/blob/v0.8.3/src/ui/spool_flow.cpp),
and [record actions](https://github.com/Niko11111/SpoolmanScale/blob/v0.8.3/src/ui/more_info_screen.cpp).

| ID | SpoolmanScale capability | Glaze Manager counterpart and disposition |
| --- | --- | --- |
| T01 | Detect a tag and fetch its linked spool | API. Include scan, lookup, unknown, missing-tag, and changed-tag states. |
| T02 | Unknown-tag choices: link, create, copy, or weigh only | Partial API. Keep an app-setup handoff as a fallback; D01 and D02 add local setup actions. |
| T03 | Link an existing spool from filtered lists or by spool ID | API. Choose manufacturer/glaze/jar or enter a permanent jar number. D01. This associates the UID; it does not write tag memory. |
| T04 | Copy an existing spool to make another | API. Create another jar of the same glaze/preset, with a fresh number, tag association, and empty history. D02. |
| T05 | Create a spool from a filament database | Partial API. Create a jar from our existing glaze catalog. External catalog import remains outside the app's scope. D02. |
| T06 | Create filament/spool records from a manufacturer's tag | No equivalent today. Our plain UID tags contain no trusted glaze catalog record. Omit automatic glaze creation. |
| T07 | Warn about a tag owned elsewhere; explicitly move it | API. Preserve explicit move/replace confirmation and history. D01. |
| T08 | Unlink one or all tags | API for one tag per jar. Unlink without deleting the jar or history. D01. |
| T09 | Add a second tag to one spool | Extend. Our model permits one tag per jar. D24. |
| T10 | Inspect tag identity and decoded contents | Local. Include UID and reader status in diagnostics. Filament-specific decoded data is unnecessary. |
| T11 | Write tag contents; choose a format and ask/always/off behavior | New firmware function. A jar URL could be useful, but OpenSpool/FilaMan/ACE content is irrelevant. D23. |
| T12 | Compare tag contents to inventory; offer a rewrite | No equivalent with UID-only identification. Defer with D23. |
| T13 | Erase writable tag contents | Optional hardware utility, D23. Erasing memory and unlinking a server association are different operations. |
| T14 | Archive an empty spool; its weight action can also set remaining to zero | API, but preserve glaze semantics: archive separately from recording a weight. Empty jars do not automatically archive. D08. |
| T15 | Reactivate an archived spool | API. Explicitly restore a jar before allowing a new saved measurement. D08. |
| T16 | Offer to release tags after archiving, including erasing an NTAG | API for unlink only. Archiving currently keeps the tag. Optional explicit unlink offer is D09; erase remains D23. |
| T17 | Backend-specific spool status editing | No matching status model beyond active/archived. Do not invent opened/sealed/in-use statuses. |

### Details and other workshop actions

Reference: [detail view](https://niko11111.github.io/SpoolmanScale-Docs/use/main-screen/#detail-view),
[drying and location](https://niko11111.github.io/SpoolmanScale-Docs/use/drying/),
[AMS view](https://niko11111.github.io/SpoolmanScale-Docs/use/ams/), and
[labels](https://niko11111.github.io/SpoolmanScale-Docs/use/labels/).

| ID | SpoolmanScale capability | Glaze Manager counterpart and disposition |
| --- | --- | --- |
| R01 | Open a detailed product/spool record | API + Extend. Read glaze code, cone, location, tare, baseline, last weighed time, and notes. Use a secondary screen. |
| R02 | Set or clear a storage location | API. Change a jar's location; prefer existing locations with optional text entry. D06. |
| R03 | Ask for a location when removing a spool | Local + API. D07. A reader dropout must not count as a physical removal. |
| R04 | Show last-used date; choose what counts as use | Partial API. Show **Last weighed**. The app does not record last use, and a weigh-in does not prove use. |
| R05 | Record drying today | No direct glaze counterpart. Do not translate this into a fictitious glaze-drying workflow. Quick weigh-in notes are considered separately in D11. |
| R06 | Drying reminders, per-material intervals, sealed-storage multiplier | No current app equivalent. Stirring, water additions, or shelf-life reminders would be separate product requirements. Defer. |
| R07 | View printers/AMS bays, material, amount, humidity, temperature, active bay, and drying | No counterpart. Omit printer/AMS pages. |
| R08 | Assign a spool to a printer/bay manually or after removal; record batch drying | No counterpart. Omit printer assignment and batch drying. |
| R09 | Print a label for the current spool, with QR link | Extend. Jar number/glaze/cone labels could be useful, but label printing is not in the app. D22. |
| R10 | Bluetooth discovery, printer selection, label size/model, test print, alignment, forget printer | Local peripheral setup, needed only if D22 is yes. |

### Connection and device care

Reference: [initial setup](https://niko11111.github.io/SpoolmanScale-Docs/use/),
[backend settings](https://niko11111.github.io/SpoolmanScale-Docs/use/backends/),
[display source](https://github.com/Niko11111/SpoolmanScale/blob/v0.8.3/src/ui/display_screen.cpp),
[system source](https://github.com/Niko11111/SpoolmanScale/blob/v0.8.3/src/ui/system_screen.cpp),
[diagnostics](https://niko11111.github.io/SpoolmanScale-Docs/help/), and
[updates](https://niko11111.github.io/SpoolmanScale-Docs/use/updating/).

| ID | SpoolmanScale capability | Glaze Manager counterpart and disposition |
| --- | --- | --- |
| S01 | First-run setup wizard | Local. Include Wi-Fi → Glaze Manager server → calibration → ready. |
| S02 | Scan/rescan networks, select SSID, enter password, reconnect | Local. Include touchscreen setup, change network, and clear connection feedback. |
| S03 | Configure Wi-Fi by phone through a temporary access point | Local. D16; useful for long passwords. |
| S04 | Configure Wi-Fi through the USB web flasher | Provisioning tool, separate from touchscreen design. Defer unless firmware distribution needs it. |
| S05 | View network name, IP, and signal | Local. Include under Connection and distinguish Wi-Fi failure from server failure. |
| S06 | Pick backend, configure host/port/credentials, test connection | Local + API. Configure and test one Glaze Manager URL and device name/ID. No current app login or API key. |
| S07 | Backend-specific extra fields, tag compatibility, automatic linking, remote requests | Omit Spoolman/FilaMan/BamBuddy-specific settings. A future app-to-scale control channel is a new feature. |
| S08 | Brightness, dim timeout, screen-off timeout | Local. Include adjustable brightness and inactivity behavior. |
| S09 | Deep-sleep timeout | Local and hardware-dependent. D20. Screen off and CPU deep sleep must be separate choices. |
| S10 | Language, time zone, and date format | Local. Use English and a configured studio time zone initially; additional languages are D26. |
| S11 | Hardware/connection indicators and explanatory fault popups | Local. Include calibration needed, unavailable ADC/NFC, unstable/invalid weight, Wi-Fi and server failure, with recovery actions. |
| S12 | Verify the NFC reset line | Hardware-specific service operation. Include only if our wiring and driver support it; otherwise expose reader status/restart. |
| S13 | Firmware/device information and support links | Local. Include version, device ID, network information, calibration state, and useful diagnostic details. |
| S14 | Restart; confirm factory reset | Local. Include restart and deliberate device-settings reset. It must never delete server inventory. |
| S15 | Check updates, view releases, install with progress; automatic check and prerelease options | Local release infrastructure. D18 for an on-screen updater. A reliable firmware upload/recovery path is baseline; copying SpoolmanScale's updater is not implied. |
| S16 | Browser firmware upload and downgrade to a chosen build | Maintenance tooling. Keep an engineer-operated update/recovery path; broad self-service controls follow D18/D19. |

### Companion browser interface

These belong to SpoolmanScale's own web server, not all to its 480×320 touch UI.
Reference: [web interface](https://niko11111.github.io/SpoolmanScale-Docs/use/web/),
[theme page source](https://github.com/Niko11111/SpoolmanScale/blob/v0.8.3/src/web/pages/page_theme.cpp),
and [label editor source](https://github.com/Niko11111/SpoolmanScale/blob/v0.8.3/src/web/pages/page_label.cpp).

| ID | SpoolmanScale capability | Glaze Manager counterpart and disposition |
| --- | --- | --- |
| B01 | Live status, weight, current spool, connection, diagnostics | Glaze Manager receives scans and committed measurements, not live load-cell readings. A live mirror requires Extend. D19. |
| B02 | Browser configuration of backend, display, device name, time, tag options, and list limits | Local. D19 for a second configuration site hosted by the device; the existing Glaze Manager settings page configures studio inventory. |
| B03 | Enable/disable web server, settings, maintenance; optional PIN | Local controls needed only for a device web console. D19. |
| B04 | View, filter, stream, download logs; choose log level and SD/internal storage | Basic diagnostic access is useful. A full browser log console and persistent SD logging are D19. |
| B05 | Read/compare/write/erase tags from the browser | New device command/control channel. Defer with D19/D23. |
| B06 | Label designer, printer setup, preview, and test print | New feature; D22. Avoid putting a label designer on the small touchscreen. |
| B07 | Light/dark/backend palettes, custom accent and surface colors, preview/reset | Use the chosen design direction for mockups. Shipping a theme picker/editor is a separate decision, D21. |
| B08 | Browser firmware updates and embedding inside another backend | D18/D19 for updates; backend embedding is unnecessary for our standalone Glaze Manager app. |

## Glaze Manager features beyond the reference

These are opportunities from the app, not claims about SpoolmanScale. Evidence:
[inventory UI](../frontend/src/pages/Inventory.tsx),
[jar detail UI](../frontend/src/pages/ContainerDetail.tsx),
[catalog UI](../frontend/src/pages/Catalog.tsx),
[forms](../frontend/src/forms.tsx),
[settings](../frontend/src/pages/Studio.tsx), and
[API implementation](../backend/app.py).

| Existing app feature | Scale treatment |
| --- | --- |
| Permanent jar numbers; exact `#12` search | Primary identity cue. Numeric lookup is D05; selection while linking is D01. |
| Search/sort/filter inventory, low stock, needs setup, archived jars | A compact browser is D10. Keep the web app's full faceted filtering on the web. |
| Product code, product line, cone, classification, notes | Read-only jar/glaze details. Preserve cone `06` versus `6`; do not substitute filament temperatures. |
| Product and test-tile photographs; captions; cover choice | Optional viewing, D12. Uploading/editing/deleting images stays in the app. |
| Weight history with source, timestamp, note, and correction reason | Recent history and correction of the last reading: D10. |
| Notes on measurements, including water/refill observations | Optional quick notes, D11. They do not imply new event types or automatic consumption calculations. |
| Empty-jar presets and full-net defaults by glaze/preset | Select existing presets during creation, D02. Editing shared defaults on the scale is D13. |
| Studio low-stock threshold | Use the studio threshold for warnings. Edit it in Settings. |
| Add/edit/duplicate manufacturers and glazes; product URLs | Keep catalog administration in the app. A scale-created jar uses an existing glaze. |
| Live browser notifications after a scan/save | Already available. Automatically selecting the scanned jar in an inventory browser is not currently implemented. |
| Operational backup and restore | Server tasks documented in operations. No scale screen. |

## Baseline punch list

Unchecked boxes mean implementation work, not unresolved product decisions.
The first three items are explicitly requested; the rest are the proposed core.

- [ ] **C01 Configure Wi-Fi:** discover/select a network, enter credentials,
  reconnect/change it, and inspect connection status.
- [ ] **C02 Zero scale:** a clearly labeled platform-zero operation, independent
  of the jar's saved tare.
- [ ] **C03 Calibrate:** guided reference-weight calibration, persistent result,
  calibration-needed state, and confirmed reset.
- [ ] **C04 Configure Glaze Manager:** server URL including port, connection test,
  persistent device identity, and useful failure messages.
- [ ] **C05 Identify the jar:** detect NFC, resolve the current association, show
  jar number/glaze/manufacturer, and clear selection on removal or tag change.
- [ ] **C06 Show the weight:** readable live gross grams, stable/settling state,
  jar tare, calculated net and percent when known, previous saved amount and
  signed difference. Secondary quantities can live on details rather than all
  competing on the home screen.
- [ ] **C07 Confirm and save:** require a stable usable reading and deliberate
  confirmation; show Saved only after acknowledgement. Update stock from the
  response.
- [ ] **C08 Recover cleanly:** distinct unknown-tag, archived-jar, incomplete-setup,
  below-tare, connection-failure, save-uncertain, and conflict states. Preserve
  the same pending request for retry while the same jar remains present.
- [ ] **C09 Use without inventory:** show an unsaved standalone gross weight even
  without Wi-Fi or a recognized tag. This is not offline inventory recording.
- [ ] **C10 Read details:** jar/glaze reference fields, location, baseline, tare,
  last weighed time, and notes; provide the app address for further setup.
- [ ] **C11 Adjust the display:** brightness, dim/off timers, wake on touch and
  supported placement detection. No deep sleep implied.
- [ ] **C12 Maintain the device:** status/diagnostics, version, restart, confirmed
  settings reset, and an update/recovery path that preserves normal settings.

### Preserve the existing inventory rules

The [device contract](device-api.md) and [stock calculations](../backend/domain.py)
already establish these rules:

- Send gross weight including the jar; let the server subtract the jar's
  tare. Never submit net weight as gross.
- Missing tare or full baseline stays unknown. A missing baseline prevents a
  percentage, but does not prevent weight-based low-stock warnings. Compare known
  remaining grams to `threshold_g`, which defaults to 150 g. Missing gross or
  tare weight prevents calculating remaining stock and requires setup.
- Below-tare readings show zero net with a review notice. Values over 100% remain
  valid observations; do not silently reset the baseline or truncate the number.
- A refill or water addition can increase weight. A decrease is not automatically
  labeled glaze consumption.
- Save retries use one unchanged request and identifier. A conflict requires
  refreshed data and a new confirmation. Removal clears local pending state,
  but cannot undo a request the server may already have committed.
- Archived jars reject measurements until restored. Archiving does not unlink a
  tag. Reusing a physical jar for a different glaze creates a new jar record and
  explicitly moves the tag, preserving the old record's history.
- Voiding a measurement preserves its record and reason. It is not a deletion.
- A slow NFC read/dropout must not save to a different jar or unexpectedly reset
  an active operation. Selection lifetime needs explicit firmware handling.

## Decisions awaiting yes or no

Answer by ID; accepting the recommendations as a group and listing exceptions
is sufficient. A No means omit from the first scale UI, not remove it from the
web app or rule it out forever.

| ID | Proposed scale feature | Recommend | Effect and implementation boundary |
| --- | --- | --- | --- |
| D01 | Link, replace, move, and unlink NFC tags on the scale | Yes | Existing APIs. Show the old and new jar for moves/replacements; no tag-memory write. |
| D02 | Add another jar of an existing glaze, including duplicate-jar shortcut | Yes | Existing catalog/create APIs; copy settings, not readings or tag ownership. No full glaze/manufacturer editor. |
| D03 | Measure or enter this jar's empty weight | Yes | Existing revision-checked jar edit. Changes current calculations, not historical measurement snapshots. |
| D04 | Set this jar's gross starting weight by entry or a confirmed full-jar measurement | Yes | Existing jar edit. Send the gross reading. Changing the baseline and recording a weigh-in are separate operations that need a clear failure/retry design. |
| D05 | Select a jar by number/list and save without NFC | Yes | Requires an explicit manual-selection device mode in the contract/API. Do not impersonate a web measurement or fabricate a tag. |
| D06 | Change the jar's storage location | Yes | Existing jar edit; choose recent/existing locations or enter one. |
| D07 | Automatically ask for location on every removal | No | Adds an interruption to each weighing; location can remain an explicit action. |
| D08 | Archive and restore jars on the scale | Yes | Existing APIs. Separate archive from setting weight to zero; restore explicitly before weighing. |
| D09 | Offer to unlink the tag immediately after archiving | No | Keep the association by default; explicit tag management remains available through D01. |
| D10 | Compact inventory/low-stock list, recent weight history, and undo last saved reading | Yes | Existing list/history/void APIs. Correction requires confirmation and a reason; start with recent readings, not a full charting interface. |
| D11 | Attach quick weigh-in notes such as “Added water” or “Refilled” | Yes | Existing measurement note. Optional and off the normal save path; no new event/reminder model. |
| D12 | Show product/test-tile photos on the scale | No | Existing image URLs, but decoding, loading, and small-screen presentation add work. Start with readable text details. |
| D13 | Edit shared jar presets and low-stock thresholds on the scale | No | The app already does this. Keep changes that affect future jars/studio policy in the web settings. |
| D14 | Save automatically after a stable reading, without a tap | No | Changes the explicit-confirmation contract. Manual save first; a later opt-in mode would need clear arming/removal behavior. |
| D15 | Correct small zero drift automatically when the platform is empty | Yes | Local firmware; only with reliable empty-platform detection. Never zero a jar or subtract genuine material. |
| D16 | Set up Wi-Fi from a phone using a temporary access point | Yes | Local provisioning path alongside touchscreen entry, particularly useful for passwords. |
| D17 | Show a QR code that opens the jar in Glaze Manager | Yes | Encode the existing jar URL; no printing or phone-NFC support required. |
| D18 | Check/download/install firmware releases from the touchscreen | No | Start with an operator-driven OTA/upload path plus version/progress display. A self-service release browser needs our own release service/configuration. |
| D19 | Provide a separate device-hosted web console for live readings, settings, logs, and maintenance | No | Adds a second UI and device-control surface. Basic diagnostics and engineering logs remain in the baseline. |
| D20 | Put the processor into deep sleep after inactivity | No | Can prevent tag/weight wake and network access unless hardware supports the wake source. Dim/screen-off first. |
| D21 | Let users switch themes on the scale at runtime | No | Compare themes in mockups and ship the selected theme first. Keep styling centralized so a selector can follow later. |
| D22 | Print jar labels and configure a Bluetooth label printer | No | New peripheral/workflow; current app deliberately omits QR labels. |
| D23 | Write a jar URL/data to NFC memory and erase tags | No | UID linking is sufficient for identification. URL writing is a distinct optional feature; do not erase third-party data as a side effect. |
| D24 | Support multiple NFC tags per jar | No | Requires a data-model/API change; one tag per jar is the current rule. |
| D25 | Keep unsent readings across power loss for later automatic sync | No | Durable offline queues are explicitly outside the current contract. Plain weighing still works offline. |
| D26 | Add language selection beyond English | No | English initially; retain a structure that allows localization later. |

Additional proposed exclusions: filament drying/reminders, printer/AMS control,
filament catalog imports and tag formats, a load-cell-free terminal mode, bag
deduction, ounces/volume conversion, recipe/mixing workflows, catalog/photo
administration, SD-card log controls, and USB flashing screens in the normal UI.
These can be reopened if one has a concrete studio use case. Display precision
should follow hardware validation; do not imply milligram accuracy just because
the server stores milligrams.

## API work revealed by this inventory

Current evidence is in [schemas](../backend/schemas.py),
[device serialization](../backend/services.py), and
[endpoints](../backend/app.py). Existing endpoints are callable by firmware;
“not in the compact device contract” does not mean “missing from the backend.”

| Work | Why it matters |
| --- | --- |
| Add permanent jar number to `DeviceJar` and `device_view` | Needed even for the core NFC weighing screen. It exists in the full container response today. |
| Decide how to fetch reference details | `DeviceJar` omits location, last-weighed time, glaze ID/code/cone, and photos. Fetch the full jar for details, or extend a bounded compact response. |
| Add documented device workflows for chosen jar/tag edits | Bind/move/replace/unlink, create, archive/restore, location, tare, baseline, and void endpoints already exist. Document revision refresh and identity checks around each flow. |
| Add manual-selection device measurements if D05 is yes | `MeasurementInput` requires `device_id` and `tag_uid` for `source=device`; the save endpoint verifies current tag ownership. Preserve that protection for NFC mode. |
| Handle uncertain mutation results beyond measurements | Measurement saves are idempotent; jar creation, binding, and edits do not all share that retry contract. Prevent duplicate jars or repeated edits after a lost response. |
| Design multi-step setup recovery | Creating a jar then binding a tag, or changing a baseline then recording a weight, is currently multiple requests. Make partial success visible and resumable. |
| Choose lightweight listing strategy | Existing lists are paginated. Location values are free text, with no dedicated location-list endpoint. Avoid downloading full photo-rich inventory just to pick a shelf. |
| Define calibration, stability, and capacity locally | The server accepts weights far above a small load cell's rating and does not prove stability/calibration. Firmware must reject unusable readings before confirmation. |
| Keep live and saved values distinct | `/scans` records the latest detected UID, not continuous presence or live weight. Live browser mirroring is additional work, D19. |

## Mockup brief after feature selection

The visual references selected by the user are the dark variants of:

- Climate — Platine et or.
- Alarm clock — Graphite.
- Cameras — Craie et ardoise.
- Local AI server — Ardoise.
- Arcade game menu — Pixel.

They are visual references from the
[Axellum dashboard](https://github.com/Axellum/M5-Tab5-ESPHome-LVGL), not a decision
to import that dashboard or its much larger layouts. The mockups should translate
their surfaces, typography, accents, and density to the actual 480×320 canvas.

First establish the selected screens and flows, then compare the same content
and state across theme variants. Keep navigation and actions constant so the
theme comparison is meaningful. Use native-scale previews and an enlarged view;
do not judge readability only from a scaled-up image. Prefer LVGL-native widgets
and styles; mockups should identify any effect that would need custom rendering.

The first screen set should cover:

1. Idle/standalone scale, recognized jar settling, and stable jar ready to save.
2. Confirmation, saving, saved, retry/uncertain acknowledgement, and conflict.
3. Low stock, missing tare/baseline, below-tare warning, archived jar, and unknown tag.
4. Jar details and the selected jar actions from D01–D13/D17.
5. Numeric jar lookup, tag linking, or new-jar flow if selected.
6. Settings, Wi-Fi setup, server test, zeroing, and calibration.
7. No Wi-Fi, server unavailable, NFC fault, and uncalibrated/unstable scale.

Long glaze names, exact jar numbers, cone `06` versus `6`, dirty-finger touch
targets, and unambiguous unsaved/saved labels belong in every theme evaluation.
Warnings need words or symbols as well as color. The selected theme must remain
readable with the studio lighting and chosen brightness.

Mockup work starts after the feature decisions are settled. No application code,
API behavior, firmware, or themes have been changed by this inventory.
