# Changelog

## [1.5.0](https://github.com/nebhale/glaze-manager/releases/tag/v1.5.0) · 2026-11-07

- A connected scale can look up jars by number, browse catalog choices, and create a jar, link its tag, and save the first reading together. Retrying the same setup returns the original result.
- Scales can record a reading for a manually selected jar.
- Manufacturer is optional when creating or editing a glaze. Existing manufacturer assignments are preserved during upgrade.

## [1.4.0](https://github.com/nebhale/glaze-manager/releases/tag/v1.4.0) · 2026-11-07

- Clear a linked NFC tag from Jar details. The confirmation shows the tag ID, glaze name, and jar number.
- Container weights are labeled **Weight (g)** when adding or editing a container in Settings.

## [1.3.2](https://github.com/nebhale/glaze-manager/releases/tag/v1.3.2) · 2026-11-07

- When adding or editing a jar, the glaze dropdown shows the glaze name and product code, such as Honey Flux (PC-17). Glazes without a code show only their name.

## [1.3.1](https://github.com/nebhale/glaze-manager/releases/tag/v1.3.1) · 2026-11-05

- Vessel glaze notes now use “3 coats” as the example. The vessel photo upload tile shows a camera icon and retains its accessible label.

## [1.3.0](https://github.com/nebhale/glaze-manager/releases/tag/v1.3.0) · 2026-11-05

- Track pottery vessels by permanent number, name, location, and photos. Record each glaze application with an optional note and revisit archived pieces.
- Browse vessel photos alongside glaze reference images and follow them back to the finished piece.
- Delete unused glazes and manufacturers. Linked records identify what needs to be reassigned or removed first.

## [1.2.0](https://github.com/nebhale/glaze-manager/releases/tag/v1.2.0) · 2026-11-05

- Record an optional cost in US dollars for each jar. The Cost field appears between Location and Notes when adding or editing a jar. Existing jars start with a blank cost.

## [1.1.0](https://github.com/nebhale/glaze-manager/releases/tag/v1.1.0) · 2026-11-05

- Sort the Glazes list by Name or Product Line in either direction. Search results use the same order, and opening a glaze or reloading keeps your selection. Glazes without a product line appear last when sorting by Product Line.

## [1.0.0](https://github.com/nebhale/glaze-manager/releases/tag/v1.0.0) · 2026-11-04

First stable release.

- Track individual jars by glaze, container, shelf location, and permanent jar number.
- See net glaze weight, last use, and low-stock warnings in a desktop or mobile inventory.
- Record a manual gross weight or accept confirmed NFC scale readings with retry protection.
- Manage glaze photos, cone values, manufacturers, and reusable containers.
- Archive and restore jars, or confirm permanent deletion.
- Self-host on AMD64 or ARM64 with Docker Compose and a persistent SQLite and media volume.
