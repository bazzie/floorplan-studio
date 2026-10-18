"""Constants for Floorplan Studio."""

DOMAIN = "floorplan_studio"
VERSION = "0.5.10"

PANEL_URL_PATH = "floorplan-studio"
PANEL_TITLE = "Floorplan"
# Sidebar title by Home Assistant's system language (the panel itself follows each
# user's own language)
PANEL_TITLES = {"nl": "Plattegrond"}
PANEL_ICON = "mdi:floor-plan"
PANEL_COMPONENT = "floorplan-studio-panel"

STATIC_URL = "/floorplan_studio_static"
IMAGE_URL = "/api/floorplan_studio/image"

STORAGE_KEY = DOMAIN
STORAGE_VERSION = 1
IMAGE_DIR = DOMAIN  # relative to the HA config directory

MAX_IMAGE_BYTES = 15 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}

SIGNAL_UPDATED = f"{DOMAIN}_updated"
