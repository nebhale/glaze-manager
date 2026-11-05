# Third-party software

The project’s Apache-2.0 license covers Glaze Manager. Its dependencies retain their respective licenses.

The frontend build generates `third-party-licenses.md` alongside the web assets from the packages bundled by Vite. In a running image this file is available at `/third-party-licenses.md`. The Python distributions and wheel-provided notices are installed under `/app/.venv`. The exact Python and npm inputs are recorded in `uv.lock` and `frontend/package-lock.json`.

The runtime image derives from the official Python Debian Bookworm image. Debian package copyright files are under `/usr/share/doc`. The release workflow requests a software bill of materials and build provenance for both published architectures. The base image, interpreter, libraries, and image codecs retain their upstream licensing terms.
