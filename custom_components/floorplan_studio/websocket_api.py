"""Websocket API for Floorplan Studio."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.auth.permissions.const import POLICY_CONTROL
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_UPDATED
from .store import FloorplanStore


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_subscribe)


def _store(hass: HomeAssistant) -> FloorplanStore:
    return hass.data[DOMAIN]["store"]


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get"})
@callback
def ws_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the floorplan document."""
    store = _store(hass)
    connection.send_result(
        msg["id"], {"data": store.data, "revision": store.revision}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save",
        vol.Required("data"): dict,
    }
)
@websocket_api.async_response
async def ws_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Validate and store a new floorplan document."""
    # Every user may edit, except those in the "Read only" group
    if not connection.user.permissions.access_all_entities(POLICY_CONTROL):
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Read-only users can't edit the floorplan")
        return
    store = _store(hass)
    try:
        data, revision = await store.async_save(msg["data"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    connection.send_result(msg["id"], {"data": data, "revision": revision})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Push the document to the client whenever it changes."""

    @callback
    def forward(data: dict[str, Any], revision: int) -> None:
        connection.send_message(
            websocket_api.event_message(
                msg["id"], {"data": data, "revision": revision}
            )
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_UPDATED, forward
    )
    connection.send_result(msg["id"])
