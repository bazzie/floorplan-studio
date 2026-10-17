"""HTTP views: the panel's frontend files and blueprint image upload/serving."""

from __future__ import annotations

import hashlib
import re
import time
import uuid
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import ALLOWED_IMAGE_TYPES, DOMAIN, IMAGE_URL, MAX_IMAGE_BYTES, STATIC_URL
from .store import ID_RE

# Unreferenced uploads older than this are removed when an image is uploaded
ORPHAN_MAX_AGE = 24 * 3600


def _find_image(image_dir: Path, image_id: str) -> Path | None:
    for suffix in ALLOWED_IMAGE_TYPES.values():
        path = image_dir / f"{image_id}{suffix}"
        if path.is_file():
            return path
    return None


def _sniff_image_type(head: bytes) -> str | None:
    """Image type from a file's first bytes; browsers don't always label AVIF or WebP."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp":
        # ISO-BMFF: major brand, then minor version, then compatible brands
        size = int.from_bytes(head[:4], "big")
        brands = [head[8:12]] + [head[i : i + 4] for i in range(16, min(size, len(head)) - 3, 4)]
        if b"avif" in brands or b"avis" in brands:
            return "image/avif"
    return None


def _cleanup_orphans(image_dir: Path, keep: set[str]) -> None:
    now = time.time()
    for path in image_dir.glob("*"):
        if path.stem in keep or not path.is_file():
            continue
        if now - path.stat().st_mtime > ORPHAN_MAX_AGE:
            path.unlink(missing_ok=True)


# Optional version folder in front of a frontend file, e.g. "v3f9a0c12d4e5/plan2d.js"
VERSION_PREFIX = re.compile(r"^v[0-9a-f]{8,40}/")


def frontend_version(root: Path) -> str:
    """Fingerprint of all frontend files, used as a version folder in their URLs.

    The panel and every module it imports load from the same versioned folder,
    so a browser can never mix an old cached file with a new one.
    """
    digest = hashlib.sha1()
    for path in sorted(root.rglob("*.js")):
        stat = path.stat()
        digest.update(f"{path.relative_to(root)}:{stat.st_size}:{stat.st_mtime_ns}".encode())
    return "v" + digest.hexdigest()[:12]


def _frontend_file(root: Path, filename: str) -> Path | None:
    path = (root / filename).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path


class FrontendView(HomeAssistantView):
    """Serve the panel's JavaScript.

    Sent with ``Cache-Control: no-cache`` so browsers (and the companion app)
    always check for a newer version; updates to the panel then show up on the
    next load instead of an old cached copy being used.
    """

    url = STATIC_URL + "/{filename:.+}"
    name = f"{DOMAIN}:frontend"
    requires_auth = False  # loaded as an ES module by the frontend, like other panels

    def __init__(self, root: Path) -> None:
        """Initialize the view."""
        self.root = root.resolve()

    async def get(self, request: web.Request, filename: str) -> web.StreamResponse:
        """Return a frontend file."""
        hass: HomeAssistant = request.app["hass"]
        filename = VERSION_PREFIX.sub("", filename)
        path = await hass.async_add_executor_job(_frontend_file, self.root, filename)
        if path is None:
            return web.Response(status=404)
        return web.FileResponse(path, headers={"Cache-Control": "no-cache"})


class ImageUploadView(HomeAssistantView):
    """Accept a multipart image upload and return its id."""

    url = IMAGE_URL
    name = f"api:{DOMAIN}:image_upload"
    requires_auth = True

    def __init__(self, image_dir: Path) -> None:
        """Initialize the view."""
        self.image_dir = image_dir

    async def post(self, request: web.Request) -> web.Response:
        """Store an uploaded image."""
        hass: HomeAssistant = request.app["hass"]
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "file":
            return self.json_message("Missing 'file' field", 400)

        data = bytearray()
        while chunk := await field.read_chunk():
            data.extend(chunk)
            if len(data) > MAX_IMAGE_BYTES:
                return self.json_message("Image too large", 413)

        # Go by the file's contents, not the label the browser gave it
        content_type = _sniff_image_type(bytes(data[:64]))
        if content_type is None:
            label = field.headers.get("Content-Type", "unknown")
            return self.json_message(f"Unsupported image type: {label}", 415)
        suffix = ALLOWED_IMAGE_TYPES[content_type]

        image_id = uuid.uuid4().hex
        keep = hass.data[DOMAIN]["store"].referenced_image_ids() | {image_id}

        def _write() -> None:
            self.image_dir.mkdir(parents=True, exist_ok=True)
            (self.image_dir / f"{image_id}{suffix}").write_bytes(bytes(data))
            _cleanup_orphans(self.image_dir, keep)

        await hass.async_add_executor_job(_write)
        return self.json({"image_id": image_id})


class ImageServeView(HomeAssistantView):
    """Serve a previously uploaded image (authenticated)."""

    url = IMAGE_URL + "/{image_id}"
    name = f"api:{DOMAIN}:image"
    requires_auth = True

    def __init__(self, image_dir: Path) -> None:
        """Initialize the view."""
        self.image_dir = image_dir

    async def get(self, request: web.Request, image_id: str) -> web.StreamResponse:
        """Return the image file."""
        if not ID_RE.match(image_id):
            return self.json_message("Invalid id", 400)
        hass: HomeAssistant = request.app["hass"]
        path = await hass.async_add_executor_job(_find_image, self.image_dir, image_id)
        if path is None:
            return self.json_message("Not found", 404)
        content_type = next(t for t, suffix in ALLOWED_IMAGE_TYPES.items() if path.suffix == suffix)
        return web.FileResponse(
            path, headers={"Cache-Control": "private, max-age=86400", "Content-Type": content_type}
        )
