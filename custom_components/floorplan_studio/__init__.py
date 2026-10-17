"""Floorplan Studio: draw your home and view it in 2D or 3D."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import websocket_api
from .const import (
    DOMAIN,
    IMAGE_DIR,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
)
from .views import FrontendView, ImageServeView, ImageUploadView, frontend_version
from .store import FloorplanStore

FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Floorplan Studio from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    store = FloorplanStore(hass)
    await store.async_load()
    domain_data["store"] = store

    # Static paths, views and websocket commands cannot be unregistered,
    # so only register them once per HA run.
    if not domain_data.get("registered"):
        hass.http.register_view(FrontendView(FRONTEND_DIR))
        image_dir = Path(hass.config.path(IMAGE_DIR))
        hass.http.register_view(ImageUploadView(image_dir))
        hass.http.register_view(ImageServeView(image_dir))
        websocket_api.async_register(hass)
        domain_data["registered"] = True

    # Versioned folder: changes whenever the frontend files change, so browsers
    # fetch the panel and all of its modules fresh after an update
    version = await hass.async_add_executor_job(frontend_version, FRONTEND_DIR)
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_COMPONENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{STATIC_URL}/{version}/floorplan-studio-panel.js",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        config={"version": VERSION},
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    hass.data[DOMAIN].pop("store", None)
    return True
