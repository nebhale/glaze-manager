# Security

Report vulnerabilities through [private GitHub security advisories](https://github.com/nebhale/glaze-manager/security/advisories/new). Include the version, reproduction steps, and impact. Remove real studio data, NFC identifiers, credentials, and network addresses from examples. Security fixes target the latest stable release.

The web UI and scale API share the same trust boundary. Clients with network access can read and change studio data. Bind to loopback for local use, or restrict access to trusted devices on a LAN or VPN. An internet-facing deployment needs authentication and HTTPS at a reverse proxy.

Back up the database and media together. See [operations](docs/operations.md) for restore instructions.
