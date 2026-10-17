"""Persistent storage for Floorplan Studio."""

from __future__ import annotations

import re
import uuid
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import SIGNAL_UPDATED, STORAGE_KEY, STORAGE_VERSION

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_id = vol.All(str, vol.Match(ID_RE))
_num = vol.Coerce(float)
_point = vol.All([_num], vol.Length(min=2, max=2))
_entity = vol.Any(None, vol.All(str, vol.Length(max=255)))
# CSS colours only (hex, a name, or rgb()/hsl()): the panel puts them into SVG markup.
# Anything else becomes None, also in stored plans, so an old value can't stop loading.
COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,30}|(rgb|hsl)a?\([0-9.,%\s/+-]{1,26}\))$")


def _color(value: Any) -> str | None:
    return value if isinstance(value, str) and COLOR_RE.match(value) else None


# Material keys (e.g. "wood", "herringbone"); the panel defines what they look
# like and falls back to a default for unknown ones, so new materials only need
# a panel update
_material = vol.Any(None, vol.All(str, vol.Match(r"^[a-z0-9_]{1,32}$")))
_floor_material = _material
_wall_material = _material

WALL_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _id,
        vol.Required("a"): _point,
        vol.Required("b"): _point,
        vol.Optional("thickness", default=0.15): vol.All(_num, vol.Range(0.01, 2)),
    },
    extra=vol.REMOVE_EXTRA,
)

ROOM_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _id,
        vol.Optional("name", default=""): vol.All(str, vol.Length(max=100)),
        vol.Required("points"): vol.All([_point], vol.Length(min=3, max=500)),
        vol.Optional("color", default="#8ab4f8"): vol.All(_color, lambda c: c or "#8ab4f8"),
        # Home Assistant area this room represents
        vol.Optional("area_id"): vol.Any(None, vol.All(str, vol.Length(max=255))),
        # Entity that drives the room highlight (light, switch, binary_sensor...)
        vol.Optional("entity_id"): _entity,
        # Entity whose value is shown as the room label (e.g. temperature)
        vol.Optional("sensor_entity_id"): _entity,
        # Finishes: the floor, and the room's side of the walls around it
        vol.Optional("floor_material"): _floor_material,
        vol.Optional("floor_color"): _color,
        # Direction of the floor pattern (planks, herringbone, tiles), degrees
        vol.Optional("floor_rotation"): vol.Any(None, vol.All(_num, vol.Range(0, 360))),
        vol.Optional("wall_material"): _wall_material,
        vol.Optional("wall_color"): _color,
    },
    extra=vol.REMOVE_EXTRA,
)

OPENING_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _id,
        vol.Required("wall_id"): _id,
        vol.Required("type"): vol.In(["door", "window"]),
        # Position of the opening centre along the wall, 0..1
        vol.Required("t"): vol.All(_num, vol.Range(0, 1)),
        vol.Optional("width", default=0.9): vol.All(_num, vol.Range(0.1, 10)),
        vol.Optional("height", default=2.1): vol.All(_num, vol.Range(0.1, 10)),
        vol.Optional("sill", default=0.0): vol.All(_num, vol.Range(0, 10)),
        # Doors: hinge at the wall's end side instead of its start side, and/or
        # swing to the other side of the wall
        vol.Optional("flip_hinge", default=False): bool,
        vol.Optional("flip_swing", default=False): bool,
        # Doors: panelled (default), glass in the top half (4 panes or one), a full glass
        # door, or two sliding leaves with glass in the middle
        vol.Optional("style"): vol.Any(None, vol.In(["panel", "half_glass", "half_glass_single", "glass", "sliding_double"])),
        vol.Optional("entity_id"): _entity,
    },
    extra=vol.REMOVE_EXTRA,
)

DOUBLE_TAP_ACTIONS = ["zoom", "more-info", "toggle", "none"]

ROOF_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _id,
        vol.Optional("name", default=""): vol.All(str, vol.Length(max=100)),
        # Outline along the walls it rests on (the overhang is added around it)
        vol.Required("points"): vol.All([_point], vol.Length(min=3, max=200)),
        vol.Optional("type", default="gable"): vol.In(["gable", "hip", "shed", "flat"]),
        vol.Optional("pitch", default=35.0): vol.All(_num, vol.Range(0, 75)),
        vol.Optional("overhang", default=0.3): vol.All(_num, vol.Range(0, 3)),
        # Gable / shed: run the ridge across the short side instead of along the long one
        vol.Optional("ridge_turned", default=False): bool,
        # Shed: the high side on the other edge
        vol.Optional("flipped", default=False): bool,
        vol.Optional("material"): _material,
        vol.Optional("color"): _color,
    },
    extra=vol.REMOVE_EXTRA,
)

MARKER_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _id,
        vol.Required("entity_id"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("x"): _num,
        vol.Required("y"): _num,
        vol.Optional("icon"): vol.Any(None, vol.All(str, vol.Length(max=100))),
        vol.Optional("tap_action", default="more-info"): vol.In(
            ["more-info", "toggle", "none"]
        ),
        # Unset: more-info when a tap toggles, else zoom in (decided by the panel)
        vol.Optional("double_tap_action"): vol.In(DOUBLE_TAP_ACTIONS),
        vol.Optional("show_state", default=False): bool,
    },
    extra=vol.REMOVE_EXTRA,
)

FURNITURE_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _id,
        # Catalog key, e.g. "sofa" or "floor_lamp" (unknown types render as a box)
        vol.Required("type"): vol.All(str, vol.Length(min=1, max=40)),
        vol.Optional("name"): vol.Any(None, vol.All(str, vol.Length(max=100))),
        vol.Required("x"): _num,
        vol.Required("y"): _num,
        vol.Required("w"): vol.All(_num, vol.Range(0.05, 20)),
        vol.Required("d"): vol.All(_num, vol.Range(0.05, 20)),
        vol.Required("h"): vol.All(_num, vol.Range(0.01, 10)),
        # Height of the surface the piece stands on (e.g. a speaker on a shelf)
        vol.Optional("z", default=0.0): vol.All(_num, vol.Range(0, 10)),
        vol.Optional("rotation", default=0.0): vol.All(_num, vol.Range(0, 360)),
        vol.Optional("color"): _color,
        vol.Optional("entity_id"): _entity,
        vol.Optional("tap_action", default="more-info"): vol.In(
            ["more-info", "toggle", "none"]
        ),
        # Unset: more-info when a tap toggles, else zoom in (decided by the panel)
        vol.Optional("double_tap_action"): vol.In(DOUBLE_TAP_ACTIONS),
        vol.Optional("show_state", default=False): bool,
        # Spot lights: full beam angle in degrees (unset: the catalog default)
        vol.Optional("beam_angle"): vol.Any(None, vol.All(_num, vol.Range(5, 170))),
        # Directional spots: degrees from straight down (unset: straight down)
        vol.Optional("tilt"): vol.Any(None, vol.All(_num, vol.Range(0, 90))),
        # Lamps: how much light it casts in the views (factor; unset = 1)
        vol.Optional("light_strength"): vol.Any(None, vol.All(_num, vol.Range(0.05, 5))),
        # AV sources (Apple TV, console, TV): the amplifier/receiver they're plugged
        # into and the input they're on, so speakers can follow what's playing
        vol.Optional("connected_to"): _entity,
        vol.Optional("connected_input"): vol.Any(None, vol.All(str, vol.Length(max=100))),
        # Sonos speakers bonded to a soundbar as rear surrounds (entity_id: the soundbar's player)
        vol.Optional("surround"): vol.Any(None, bool),
        # Robot vacuums: the vacuum's room ids mapped to rooms of the plan
        vol.Optional("vacuum_rooms"): vol.Any(
            None, vol.All({vol.Match(r"^\d{1,6}$"): _id}, vol.Length(max=100))
        ),
    },
    extra=vol.REMOVE_EXTRA,
)

BLUEPRINT_SCHEMA = vol.Schema(
    {
        vol.Required("image_id"): _id,
        vol.Optional("x", default=0.0): _num,
        vol.Optional("y", default=0.0): _num,
        # Width of the image in metres; height follows the aspect ratio
        vol.Optional("width", default=10.0): vol.All(_num, vol.Range(0.1, 1000)),
        vol.Optional("opacity", default=0.5): vol.All(_num, vol.Range(0, 1)),
        vol.Optional("show_in_view", default=False): bool,
    },
    extra=vol.REMOVE_EXTRA,
)

FLOOR_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _id,
        vol.Optional("name", default="Floor"): vol.All(str, vol.Length(max=100)),
        vol.Optional("level", default=0): vol.Coerce(int),
        vol.Optional("wall_height", default=2.6): vol.All(_num, vol.Range(0.5, 20)),
        vol.Optional("blueprint"): vol.Any(None, BLUEPRINT_SCHEMA),
        vol.Optional("walls", default=list): [WALL_SCHEMA],
        vol.Optional("rooms", default=list): [ROOM_SCHEMA],
        vol.Optional("openings", default=list): [OPENING_SCHEMA],
        vol.Optional("markers", default=list): [MARKER_SCHEMA],
        vol.Optional("roofs", default=list): [ROOF_SCHEMA],
        vol.Optional("furniture", default=list): vol.All(
            [FURNITURE_SCHEMA], vol.Length(max=500)
        ),
    },
    extra=vol.REMOVE_EXTRA,
)

DATA_SCHEMA = vol.Schema(
    {
        # Compass direction of north, degrees clockwise from the top of the plan
        vol.Optional("north", default=0.0): vol.All(_num, vol.Range(0, 360)),
        # Finish of the outside of the house (wall faces not facing a room)
        vol.Optional("exterior_material"): _wall_material,
        vol.Optional("exterior_color"): _color,
        vol.Optional("floors", default=list): vol.All(
            [FLOOR_SCHEMA], vol.Length(max=50)
        ),
    },
    extra=vol.REMOVE_EXTRA,
)


def default_data() -> dict[str, Any]:
    """Return an initial, empty floorplan."""
    return {
        "floors": [
            {
                "id": uuid.uuid4().hex[:12],
                "name": "Ground floor",
                "level": 0,
                "wall_height": 2.6,
                "blueprint": None,
                "walls": [],
                "rooms": [],
                "openings": [],
                "markers": [],
                "furniture": [],
            }
        ]
    }


class FloorplanStore:
    """Wrap a HA Store holding the floorplan document."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the store."""
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY
        )
        self.data: dict[str, Any] = default_data()
        # Incremented on every save so clients can detect stale edits
        self.revision = 0

    async def async_load(self) -> None:
        """Load data from disk."""
        stored = await self._store.async_load()
        if stored:
            self.data = DATA_SCHEMA(stored)
            if not self.data["floors"]:
                self.data = default_data()

    async def async_save(self, data: dict[str, Any]) -> tuple[dict[str, Any], int]:
        """Validate, broadcast and persist a new document; return it and its revision."""
        validated = DATA_SCHEMA(data)
        self.data = validated
        self.revision += 1
        revision = self.revision
        # Broadcast before awaiting the disk write so a save that lands meanwhile
        # can't make this one report the other's data or revision
        self._notify(validated, revision)
        await self._store.async_save(validated)
        return validated, revision

    @callback
    def _notify(self, data: dict[str, Any], revision: int) -> None:
        async_dispatcher_send(self.hass, SIGNAL_UPDATED, data, revision)

    def referenced_image_ids(self) -> set[str]:
        """Return all image ids used as blueprints."""
        return {
            floor["blueprint"]["image_id"]
            for floor in self.data["floors"]
            if floor.get("blueprint")
        }
