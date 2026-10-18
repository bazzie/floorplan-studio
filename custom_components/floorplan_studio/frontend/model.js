// Shared geometry, document and entity-state helpers for Floorplan Studio.
import { t } from "./i18n.js";

export const uid = () =>
  Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);

export const clone = (o) => JSON.parse(JSON.stringify(o));

export const newFloor = (level = 0, name = t("Floor")) => ({
  id: uid(),
  name,
  level,
  wall_height: 2.6,
  blueprint: null,
  walls: [],
  rooms: [],
  openings: [],
  markers: [],
  furniture: [],
});

/** Older documents (or ones from an older backend) may lack newer lists. */
export function normalizeDoc(doc) {
  doc.floors.forEach((f) => {
    f.furniture = f.furniture || [];
  });
  return doc;
}

// Per-browser preferences (localStorage may be unavailable, e.g. private mode)
export const readPref = (k, d) => {
  try {
    return localStorage.getItem(`floorplan_studio.${k}`) ?? d;
  } catch (_e) {
    return d;
  }
};
export const writePref = (k, v) => {
  try {
    localStorage.setItem(`floorplan_studio.${k}`, v);
  } catch (_e) {
    /* ignore */
  }
};

export const GRID_SIZES = [0.05, 0.1, 0.25, 0.5, 1];

export const OPENING_DEFAULTS = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
};

/**
 * Doors/windows stacked on top of each other on the same wall (centres closer than
 * half the narrower one's width). Returns groups of overlapping openings.
 */
function overlappingOpenings(floor) {
  const groups = [];
  const seen = new Set();
  for (const w of floor.walls) {
    const len = dist(w.a, w.b);
    const on = floor.openings.filter((o) => o.wall_id === w.id && o.type).sort((a, b) => a.t - b.t);
    for (let i = 0; i < on.length; i++) {
      if (seen.has(on[i].id)) continue;
      const group = [on[i]];
      for (let j = i + 1; j < on.length; j++) {
        const o = on[j];
        if (seen.has(o.id) || o.type !== on[i].type) continue;
        if (group.some((g) => Math.abs(g.t - o.t) * len < Math.min(g.width, o.width) / 2)) group.push(o);
      }
      if (group.length > 1) {
        group.forEach((o) => seen.add(o.id));
        groups.push(group);
      }
    }
  }
  return groups;
}

/** Number of doors/windows that are duplicates of another one on the same spot. */
export const countDuplicateOpenings = (floor) =>
  overlappingOpenings(floor).reduce((n, g) => n + g.length - 1, 0);

/**
 * Remove stacked duplicate doors/windows. Of each stack the most configured one is
 * kept (linked entity, style, flipped hinge/swing; the oldest on a tie), and an entity
 * or style set only on a removed copy is moved onto it. Returns the number removed.
 */
export function removeDuplicateOpenings(floor) {
  const score = (o) => (o.entity_id ? 4 : 0) + (o.style ? 2 : 0) + (o.flip_hinge ? 1 : 0) + (o.flip_swing ? 1 : 0);
  const order = new Map(floor.openings.map((o, i) => [o.id, i]));
  const drop = new Set();
  for (const group of overlappingOpenings(floor)) {
    const [keep, ...rest] = [...group].sort((a, b) => score(b) - score(a) || order.get(a.id) - order.get(b.id));
    for (const o of rest) {
      if (!keep.entity_id && o.entity_id) keep.entity_id = o.entity_id;
      if (!keep.style && o.style) keep.style = o.style;
      drop.add(o.id);
    }
  }
  floor.openings = floor.openings.filter((o) => !drop.has(o.id));
  return drop.size;
}

// ---------- geometry ----------

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Projection of p on segment ab: returns {t (0..1), point, d}. */
export function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = lerp(a, b, t);
  return { t, point, d: dist(p, point) };
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(a / 2);
}

/**
 * Where to put a room's label: its centre, unless that's covered by other rooms
 * (a garden around the house); then the free spot inside it nearest the centre.
 */
export function labelPoint(room, others = []) {
  const c = polygonCenter(room.points);
  // Keep clear of the covering rooms' edges (and walls) too
  const M = 0.7;
  const covered = (p) => others.some((o) => o !== room &&
    [[0, 0], [M, 0], [-M, 0], [0, M], [0, -M]].some(([dx, dy]) => pointInPolygon([p[0] + dx, p[1] + dy], o.points)));
  if (!covered(c)) return c;
  const xs = room.points.map((p) => p[0]);
  const ys = room.points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(x1 - x0, y1 - y0) / 40;
  let best = null;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p = [x, y];
      if (!pointInPolygon(p, room.points) || covered(p)) continue;
      const d = (x - c[0]) ** 2 + (y - c[1]) ** 2;
      if (!best || d < best.d) best = { p, d };
    }
  }
  return best ? best.p : c;
}

/** Visual centre of a polygon (area centroid, falls back to vertex mean). */
export function polygonCenter(pts) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f;
    cx += (pts[j][0] + pts[i][0]) * f;
    cy += (pts[j][1] + pts[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    return [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export const snapToGrid = (p, step) => [
  Math.round(p[0] / step) * step,
  Math.round(p[1] / step) * step,
];

/** Constrain b so that a->b is a multiple of 45 degrees. */
export function snapAngle(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
}

export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export const roundPt = (p) => [round(p[0]), round(p[1])];

/**
 * Move everything on a floor by (dx, dy) metres: walls (doors and windows go
 * along), rooms, markers, furniture and the blueprint. Positions are taken from
 * `from` (a copy of the floor made before a drag) so repeated calls don't drift.
 */
export function shiftFloor(floor, dx, dy, from = floor) {
  const mv = (p) => roundPt([p[0] + dx, p[1] + dy]);
  floor.walls.forEach((w, i) => Object.assign(w, { a: mv(from.walls[i].a), b: mv(from.walls[i].b) }));
  floor.rooms.forEach((r, i) => (r.points = from.rooms[i].points.map(mv)));
  (floor.roofs || []).forEach((r, i) => (r.points = from.roofs[i].points.map(mv)));
  for (const key of ["markers", "furniture"]) {
    (floor[key] || []).forEach((m, i) => ([m.x, m.y] = mv([from[key][i].x, from[key][i].y])));
  }
  if (floor.blueprint && from.blueprint) [floor.blueprint.x, floor.blueprint.y] = mv([from.blueprint.x, from.blueprint.y]);
}

/**
 * Split a wall into solid spans around its openings.
 * Returns [{from, to, bottom, top}] with from/to in metres along the wall.
 */
export function wallPieces(wall, openings, wallHeight) {
  const len = dist(wall.a, wall.b);
  const ops = openings
    .filter((o) => o.wall_id === wall.id)
    .map((o) => {
      const c = o.t * len;
      return {
        from: Math.max(0, c - o.width / 2),
        to: Math.min(len, c + o.width / 2),
        sill: Math.min(o.sill || 0, wallHeight),
        top: Math.min((o.sill || 0) + o.height, wallHeight),
        opening: o,
      };
    })
    .sort((x, y) => x.from - y.from);

  const pieces = [];
  let cursor = 0;
  for (const o of ops) {
    if (o.from > cursor) pieces.push({ from: cursor, to: o.from, bottom: 0, top: wallHeight });
    if (o.sill > 0) pieces.push({ from: o.from, to: o.to, bottom: 0, top: o.sill });
    if (o.top < wallHeight) pieces.push({ from: o.from, to: o.to, bottom: o.top, top: wallHeight });
    cursor = Math.max(cursor, o.to);
  }
  if (cursor < len) pieces.push({ from: cursor, to: len, bottom: 0, top: wallHeight });
  return { pieces, openings: ops, length: len };
}

/** Bounding box of everything on a floor (and its blueprint). */
export function floorBounds(floor, blueprintAspect) {
  const xs = [];
  const ys = [];
  const add = (p) => {
    xs.push(p[0]);
    ys.push(p[1]);
  };
  floor.walls.forEach((w) => {
    add(w.a);
    add(w.b);
  });
  floor.rooms.forEach((r) => r.points.forEach(add));
  floor.markers.forEach((m) => add([m.x, m.y]));
  if (floor.blueprint && blueprintAspect) {
    const bp = floor.blueprint;
    add([bp.x, bp.y]);
    add([bp.x + bp.width, bp.y + bp.width * blueprintAspect]);
  }
  if (!xs.length) return null;
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Floors sorted by level with their base elevation in metres. */
export function stackFloors(floors) {
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const ground = sorted.findIndex((f) => f.level >= 0);
  const base = ground === -1 ? sorted.length : ground;
  const out = sorted.map((f) => ({ floor: f, elevation: 0 }));
  let z = 0;
  for (let i = base; i < out.length; i++) {
    out[i].elevation = z;
    z += out[i].floor.wall_height + 0.2;
  }
  z = 0;
  for (let i = base - 1; i >= 0; i--) {
    z -= out[i].floor.wall_height + 0.2;
    out[i].elevation = z;
  }
  return out;
}

// ---------- entity state ----------

const ACTIVE_STATES = new Set([
  "on", "open", "opening", "closing", "home", "playing", "unlocked",
  "heat", "cool", "heat_cool", "auto", "dry", "fan_only", "cleaning", "mowing", "detected",
]);

const TOGGLE_DOMAINS = new Set([
  "light", "switch", "fan", "input_boolean", "cover", "lock",
  "media_player", "climate", "automation", "script", "scene", "button",
]);

export const domainOf = (entityId) => (entityId || "").split(".")[0];

export const canToggle = (entityId) => TOGGLE_DOMAINS.has(domainOf(entityId));

export function isActive(stateObj) {
  if (!stateObj) return false;
  if (domainOf(stateObj.entity_id) === "climate") return stateObj.state !== "off";
  return ACTIVE_STATES.has(stateObj.state);
}

// ---------- which state changes matter ----------

const ENTITY_ID = /\b[a-z_]+\.[a-z0-9_]+\b/g;

/**
 * The entities whose state the plan shows: those named anywhere in the plan, the other
 * entities of their devices (a washer's progress, a camera's motion sensor, a soundbar's
 * surround switch), the lights and temperature sensors of the rooms' areas, sensors that
 * point at a player (the app in front on an Apple TV) and the sun. A Home Assistant
 * update that changes none of these (a power meter elsewhere in the house) can be
 * skipped by the views, which matters on slower devices: Home Assistant sends one for
 * every state change in the house.
 */
export function planEntities(hass, doc) {
  const states = hass?.states || {};
  const entities = hass?.entities || {};
  const devices = hass?.devices || {};
  const ids = new Set(["sun.sun"]);
  const text = JSON.stringify(doc || {});
  for (const m of text.matchAll(ENTITY_ID)) if (m[0] in states) ids.add(m[0]);
  const areas = new Set([...text.matchAll(/"area_id":"([^"]+)"/g)].map((m) => m[1]));
  for (const area of areas) {
    const temp = hass?.areas?.[area]?.temperature_entity_id;
    if (temp) ids.add(temp);
  }
  const deviceIds = new Set([...ids].map((id) => entities[id]?.device_id).filter(Boolean));
  for (const ent of Object.values(entities)) {
    const area = ent.area_id || devices[ent.device_id]?.area_id;
    if (deviceIds.has(ent.device_id) || (area && areas.has(area))) ids.add(ent.entity_id);
  }
  for (const [id, st] of Object.entries(states)) {
    if (ids.has(st.attributes?.media_player_entity_id)) ids.add(id);
  }
  return ids;
}

/**
 * Does a new hass object change anything the plan shows? (When `ids` is unknown: yes.)
 * Registries, language and theme count; of the states only those of `ids`.
 */
export function hassChanged(prev, next, ids) {
  if (!prev || !ids) return true;
  for (const k of ["entities", "devices", "areas", "language", "locale", "themes", "selectedTheme"]) {
    if (prev[k] !== next[k]) return true;
  }
  if (prev.states === next.states) return false;
  for (const id of ids) if (prev.states[id] !== next.states[id]) return true;
  return false;
}

export const isUnavailable = (stateObj) =>
  !stateObj || stateObj.state === "unavailable" || stateObj.state === "unknown";

const COLOR_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];

/**
 * A white light's colour at a colour temperature (K), as it looks in the room: a
 * blackbody's colour (Tanner Helland's fit), taken a good way towards white. Eyes adapt
 * to the light around them: a 2000 K lamp reads as a cosy amber, not the deep orange of
 * its raw colour (255, 137, 14), and 2700 K as ordinary warm white.
 */
export function kelvinRgb(kelvin) {
  const t = Math.min(10000, Math.max(1500, kelvin)) / 100;
  const clamp = (v) => Math.min(255, Math.max(0, v));
  const r = t <= 66 ? 255 : clamp(329.698727446 * (t - 60) ** -0.1332047592);
  const g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * (t - 60) ** -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  const ADAPT = 0.55; // how far towards white
  return [r, g, b].map((c) => Math.round(c + (255 - c) * ADAPT));
}

/**
 * The colour a light shines in: its colour, or for white light the colour of its colour
 * temperature (see kelvinRgb); null when it has neither (a plain dimmable light).
 */
function lightRgb(stateObj) {
  const a = stateObj?.attributes || {};
  const modes = a.supported_color_modes;
  const colour = Array.isArray(modes) ? modes.some((m) => COLOR_MODES.includes(m)) : true;
  // White light (a tunable-white lamp, or a colour lamp set to a white): HA's rgb_color
  // for it is the raw blackbody colour, far too orange for warm white
  const kelvin = a.color_temp_kelvin ?? (a.color_temp ? 1e6 / a.color_temp : null);
  if ((!colour || a.color_mode === "color_temp") && kelvin) return `rgb(${kelvinRgb(kelvin).join(",")})`;
  if (!colour) return null;
  const rgb = a.rgb_color;
  return Array.isArray(rgb) && rgb.length === 3 ? `rgb(${rgb.join(",")})` : null;
}

/** Colour that represents an active entity (light colour where known). */
export function activeColor(stateObj, fallback) {
  const rgb = lightRgb(stateObj);
  if (rgb) return rgb;
  if (domainOf(stateObj?.entity_id) === "light") return "#ffc94d";
  return fallback;
}

/** Brightness factor 0..1 for lights, 1 for anything else. */
export function brightness(stateObj) {
  const b = stateObj?.attributes?.brightness;
  return typeof b === "number" ? Math.max(0.25, b / 255) : 1;
}

export function formatState(hass, stateObj) {
  if (!stateObj) return "—";
  const media = domainOf(stateObj.entity_id) === "media_player" && mediaState(hass, stateObj);
  return media || plainState(hass, stateObj);
}

/** The state as Home Assistant shows it (translated, with unit). */
function plainState(hass, stateObj) {
  if (hass?.formatEntityState) {
    try {
      return hass.formatEntityState(stateObj);
    } catch (_e) {
      /* fall through */
    }
  }
  const unit = stateObj.attributes?.unit_of_measurement;
  return unit ? `${stateObj.state} ${unit}` : stateObj.state;
}

/**
 * What a media player is doing, in a few words: the title while playing
 * ("▶ Title") or paused ("⏸ Title"), the app or input while on/idle (or just
 * "On"; a TV on its home screen reports "idle"). Null: use the plain state.
 */
function mediaState(hass, stateObj) {
  const a = stateObj.attributes || {};
  const title = a.media_title && (a.media_artist ? `${a.media_artist} – ${a.media_title}` : a.media_title);
  switch (stateObj.state) {
    case "playing":
    case "buffering":
      return title ? `▶ ${title}` : a.app_name || a.source || null;
    case "paused":
      return title ? `⏸ ${title}` : null;
    case "idle":
    case "on":
      return a.app_name || a.source || plainState(hass, { ...stateObj, state: "on" });
    default:
      return null;
  }
}

export const friendlyName = (hass, entityId) =>
  hass?.states?.[entityId]?.attributes?.friendly_name || entityId || "";

/** Run the action for tapping an entity (toggle / more-info). */
export const DOUBLE_TAP_MS = 280; // max time between the taps of a double-tap

export const DOUBLE_TAP_ACTIONS = { zoom: "Zoom in", "more-info": "Open more-info", toggle: "Toggle", none: "Nothing" };

/** What a double-tap does: as set, else more-info when a tap toggles, else zoom in. */
export const doubleTapAction = (item) =>
  item?.double_tap_action || (item?.entity_id && item.tap_action === "toggle" ? "more-info" : "zoom");

/**
 * Tells single taps from double taps. A single tap waits DOUBLE_TAP_MS for a
 * second one (so a double-tap on a lamp doesn't also toggle it twice), unless
 * there's no double-tap action, in which case it runs at once.
 */
export class TapSorter {
  constructor() {
    this._last = null;
    this._timer = null;
  }

  /** key: what was tapped; single / double: functions to run (or null for nothing). */
  tap(key, x, y, single, double) {
    const now = performance.now();
    const last = this._last;
    clearTimeout(this._timer);
    if (double && last && last.key === key && now - last.time < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < 24) {
      this._last = null;
      double();
      return;
    }
    this._last = double ? { key, time: now, x, y } : null;
    if (!single) return;
    if (double) this._timer = setTimeout(single, DOUBLE_TAP_MS);
    else single();
  }
}

/** Run a piece's / marker's double-tap action; "zoom" calls zoom(). Returns null if it does nothing. */
export function doubleTapHandler(el, hass, item, zoom) {
  const action = doubleTapAction(item);
  if (action === "none") return null;
  if (action === "zoom") return zoom;
  if (!item.entity_id) return null;
  return () => runTapAction(el, hass, item.entity_id, action);
}

export function runTapAction(el, hass, entityId, action) {
  if (!entityId || action === "none") return;
  // A camera can't toggle; "toggle" switches its floodlight instead
  const flood = action === "toggle" && floodlightEntity(hass, entityId);
  if (flood) {
    hass.callService("homeassistant", "toggle", { entity_id: flood });
    return;
  }
  if (action === "toggle" && canToggle(entityId)) {
    const domain = domainOf(entityId);
    if (domain === "scene" || domain === "script") {
      hass.callService(domain, "turn_on", { entity_id: entityId });
    } else if (domain === "button") {
      hass.callService("button", "press", { entity_id: entityId });
    } else {
      hass.callService("homeassistant", "toggle", { entity_id: entityId });
    }
    return;
  }
  el.dispatchEvent(
    new CustomEvent("hass-more-info", {
      detail: { entityId },
      bubbles: true,
      composed: true,
    })
  );
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

/** A colour that is safe to put into markup (hex, a name, or rgb()/hsl()), else null. */
export const safeColor = (c) =>
  typeof c === "string" && /^(#[0-9a-f]{3,8}|[a-z]{1,30}|(rgb|hsl)a?\([0-9.,%\s/+-]{1,26}\))$/i.test(c) ? c : null;

/** Create an icon element that follows entity state when HA provides one. */
export function createStateIcon(hass, stateObj, icon) {
  if (customElements.get("ha-state-icon")) {
    const el = document.createElement("ha-state-icon");
    el.hass = hass;
    el.stateObj = stateObj;
    if (icon) el.icon = icon;
    return el;
  }
  const el = document.createElement("ha-icon");
  el.icon = icon || stateObj?.attributes?.icon || "mdi:circle-medium";
  return el;
}

// ---------- HA areas ----------

const areaIndexCache = new WeakMap();

/** Map area_id -> entity ids, using entity area or its device's area. Cached per registry. */
function areaIndex(hass) {
  const entities = hass?.entities;
  if (!entities) return new Map();
  let idx = areaIndexCache.get(entities);
  if (!idx) {
    idx = new Map();
    for (const [id, ent] of Object.entries(entities)) {
      const area = ent.area_id || hass.devices?.[ent.device_id]?.area_id;
      if (!area) continue;
      if (!idx.has(area)) idx.set(area, []);
      idx.get(area).push(id);
    }
    areaIndexCache.set(entities, idx);
  }
  return idx;
}

export const areaEntities = (hass, areaId, domain) =>
  (areaIndex(hass).get(areaId) || []).filter((id) => !domain || domainOf(id) === domain);

/** Sorted list of HA areas ({area_id, name}) for pickers. */
export const listAreas = (hass) =>
  Object.values(hass?.areas || {}).sort((a, b) => a.name.localeCompare(b.name));

/**
 * State that drives a room's highlight: its own entity if set. Lights don't recolour the
 * floor (a placed lamp lights it with its glow instead), so a light entity, or the lights
 * of the linked area, never highlight a room.
 */
export function roomHighlight(hass, room) {
  const st = room.entity_id && domainOf(room.entity_id) !== "light" ? hass?.states?.[room.entity_id] : undefined;
  return { active: !!st && isActive(st), stateObj: st };
}

/** Entity shown under the room name: explicit sensor, else the area's temperature sensor. */
export const roomLabelEntity = (hass, room) =>
  room.sensor_entity_id || (room.area_id && hass?.areas?.[room.area_id]?.temperature_entity_id) || null;

/** Entity opened when the room is tapped. */
export const roomTapEntity = (hass, room) => room.entity_id || roomLabelEntity(hass, room);

// ---------- compass ----------

export const normalizeAngle = (deg) => ((deg % 360) + 360) % 360;

/**
 * SVG compass rose. `rotation` is where north points on screen, in degrees
 * clockwise from straight up. Letters stay upright.
 */
export function compassSvg(rotation, size = 72) {
  const c = size / 2;
  const r = c - 3;
  const lr = r - 10; // letter radius
  const at = (deg, rad) => {
    const a = ((rotation + deg) * Math.PI) / 180;
    return [c + rad * Math.sin(a), c - rad * Math.cos(a)];
  };
  // The four letters in the current language (Dutch: N O Z W), north first
  const names = t("N E S W").split(" ");
  const letters = [0, 90, 180, 270]
    .map((d, i) => {
      const [x, y] = at(d, lr);
      return `<text x="${x}" y="${y}" class="${i === 0 ? "n" : ""}" text-anchor="middle" dominant-baseline="central">${names[i] || ""}</text>`;
    })
    .join("");
  const ticks = Array.from({ length: 8 }, (_, i) => {
    const [x1, y1] = at(i * 45, r - (i % 2 ? 3 : 5));
    const [x2, y2] = at(i * 45, r);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-label="Compass, north at ${Math.round(normalizeAngle(rotation))}°">
    <circle cx="${c}" cy="${c}" r="${r}" class="bg"/>
    <g class="ticks">${ticks}</g>
    <g transform="rotate(${rotation} ${c} ${c})">
      <polygon class="needle-n" points="${c},${c - lr + 8} ${c - 4},${c} ${c + 4},${c}"/>
      <polygon class="needle-s" points="${c},${c + lr - 8} ${c - 4},${c} ${c + 4},${c}"/>
    </g>
    <circle cx="${c}" cy="${c}" r="2" class="hub"/>
    ${letters}
  </svg>`;
}

export const COMPASS_STYLE = `
.compass { position:absolute; right:10px; top:10px; z-index:2; border-radius:50%;
  filter:drop-shadow(0 1px 3px rgba(0,0,0,.3)); user-select:none; -webkit-user-select:none; touch-action:none; }
.compass.interactive { cursor:grab; }
.compass.interactive:active { cursor:grabbing; }
.compass svg { display:block; width:72px; height:72px; }
.compass .bg { fill:var(--card-background-color,#fff); stroke:var(--divider-color,#ccc); }
.compass .ticks line { stroke:var(--secondary-text-color,#888); stroke-width:1.2; }
.compass .needle-n { fill:var(--error-color,#db4437); }
.compass .needle-s { fill:var(--secondary-text-color,#999); opacity:.6; }
.compass .hub { fill:var(--primary-text-color,#222); }
.compass text { font:600 11px sans-serif; fill:var(--primary-text-color,#222); }
.compass text.n { fill:var(--error-color,#db4437); }
`;

// ---------- entity palette ----------

const DOMAIN_ORDER = [
  "light", "switch", "fan", "cover", "climate", "media_player", "lock", "vacuum", "lawn_mower",
  "camera", "binary_sensor", "sensor", "input_boolean", "button", "scene", "script",
];

/** Entities worth placing on a plan: existing, not hidden, not config/diagnostic. */
export function isPlaceable(hass, entityId) {
  if (!hass?.states?.[entityId]) return false;
  const reg = hass.entities?.[entityId];
  return !reg || (!reg.hidden && !reg.entity_category);
}

/** Sort by domain usefulness, then by name. */
export function sortEntities(hass, ids) {
  const rank = (id) => {
    const i = DOMAIN_ORDER.indexOf(domainOf(id));
    return i === -1 ? DOMAIN_ORDER.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || friendlyName(hass, a).localeCompare(friendlyName(hass, b)));
}

export const areaOfEntity = (hass, entityId) => {
  const ent = hass?.entities?.[entityId];
  return ent?.area_id || hass?.devices?.[ent?.device_id]?.area_id || null;
};

/** Sensible marker defaults for an entity dropped on the plan. */
export const newMarker = (entityId, x, y) => ({
  id: uid(),
  entity_id: entityId,
  x,
  y,
  icon: null,
  tap_action: canToggle(entityId) ? "toggle" : "more-info",
  show_state: ["sensor", "climate"].includes(domainOf(entityId)),
});

// ---------- light rendering ----------

const WARM_WHITE = "rgb(255,214,140)";

/** Lights that are on, with colour and strength, for glow/beam rendering. */
export function activeLight(hass, entityId) {
  if (domainOf(entityId) !== "light") return null;
  const st = hass?.states?.[entityId];
  if (!st || st.state !== "on") return null;
  // Lights without a colour option glow warm white
  return { color: lightRgb(st) || WARM_WHITE, level: brightness(st) };
}

// ---------- media players ----------

/**
 * Is a screen (TV, monitor, projector) showing something? Media players are on
 * in every state except off/standby: a TV on its home screen or in art mode
 * reports "idle" or "on", a paused film "paused".
 */
/**
 * How hard a radiator linked to this entity is heating, 0..1 (0 = not heating):
 * a climate entity that reports it's heating (or, without hvac_action, is in heat
 * mode below its target), a heating-power sensor in % (e.g. Tado), or anything
 * else that's on (a valve, switch or boiler relay).
 */
export function heatLevel(stateObj) {
  if (!stateObj) return 0;
  const a = stateObj.attributes || {};
  const domain = domainOf(stateObj.entity_id);
  if (domain === "climate") {
    if (a.hvac_action) return a.hvac_action === "heating" || a.hvac_action === "preheating" ? 1 : 0;
    if (!["heat", "heat_cool", "auto"].includes(stateObj.state)) return 0;
    const target = a.temperature ?? a.target_temp_low;
    return a.current_temperature == null || target == null || a.current_temperature < target ? 1 : 0;
  }
  if (domain === "valve") {
    if (a.current_position != null) return Math.min(1, Math.max(0, a.current_position / 100));
    return stateObj.state === "open" ? 1 : 0;
  }
  const n = Number(stateObj.state);
  if (stateObj.state !== "" && Number.isFinite(n)) {
    if (n <= 0) return 0;
    return a.unit_of_measurement === "%" ? Math.min(1, n / 100) : 1;
  }
  return isActive(stateObj) ? 1 : 0;
}

export const isHeating = (stateObj) => heatLevel(stateObj) > 0;

const MOTION_CLASSES = new Set(["motion", "occupancy", "presence"]);

/**
 * Motion / person sensors that are on, from the same device as `entityId` (a
 * camera's own detection sensors), plus the entity itself if it's a sensor.
 */
export function cameraAlerts(hass, entityId) {
  if (!hass || !entityId) return [];
  const isAlert = (id) => {
    const st = hass.states?.[id];
    if (domainOf(id) !== "binary_sensor" || st?.state !== "on") return false;
    return MOTION_CLASSES.has(st.attributes?.device_class) || /motion|person|presence/.test(id);
  };
  return deviceEntityIds(hass, entityId).filter(isAlert);
}

/** The entity plus the other entities of its device (from the entity registry). */
function deviceEntityIds(hass, entityId) {
  const device = hass?.entities?.[entityId]?.device_id;
  const ids = device ? Object.values(hass.entities).filter((e) => e.device_id === device).map((e) => e.entity_id) : [];
  return [...new Set([entityId, ...ids])];
}

/** Person sensors of a camera's device that are on. */
export const cameraPersons = (hass, entityId) =>
  deviceEntityIds(hass, entityId).filter(
    (id) => domainOf(id) === "binary_sensor" && /person/.test(id) && hass.states?.[id]?.state === "on"
  );

/**
 * A camera's own floodlight, if it's on: a light of the same device, or a switch
 * named like one (Eufy: switch.<camera>_light; not "_light_enable" or "status_led").
 * Returns { entity_id, level } or null.
 */
export function cameraFloodlight(hass, entityId) {
  const id = floodlightEntity(hass, entityId);
  const st = id && hass.states?.[id];
  if (st?.state !== "on") return null;
  return { entity_id: id, level: domainOf(id) === "light" ? Math.max(0.25, (st.attributes?.brightness ?? 255) / 255) : 1 };
}

/** A camera's floodlight entity (on or off), or null if its device has none. */
export function floodlightEntity(hass, entityId) {
  if (!hass || !entityId || domainOf(entityId) !== "camera") return null;
  return deviceEntityIds(hass, entityId).find((id) => {
    const domain = domainOf(id);
    return domain === "light" || (domain === "switch" && /(^|_)(flood)?light$/.test(id.split(".")[1]));
  }) || null;
}

/**
 * Picture of a camera's latest detection: an image entity of the same device (Eufy's
 * "event image" and the like), for cameras that only have live video while streaming.
 */
export function cameraEventImage(hass, entityId) {
  if (!hass || !entityId || domainOf(entityId) !== "camera") return null;
  const images = deviceEntityIds(hass, entityId).filter((id) => domainOf(id) === "image");
  return images.find((id) => /event|snapshot|detect|last/.test(id.split(".")[1])) || images[0] || null;
}

/**
 * The app in front on a player, from an "apple_tv_focus" foreground-app sensor for it
 * (attribute media_player_entity_id). Apple TVs only report the app that last published
 * Now Playing info, so apps like Odido TV otherwise show up as the previous app.
 * { name, bundle } or null when there is no such sensor or it doesn't know yet.
 */
export function foregroundApp(hass, playerId) {
  const states = hass?.states || {};
  for (const [id, st] of Object.entries(states)) {
    if (!id.startsWith("sensor.") || st.attributes?.media_player_entity_id !== playerId) continue;
    if (["unknown", "unavailable", ""].includes(st.state)) return null;
    return { name: st.state, bundle: st.attributes.bundle_id || "" };
  }
  return null;
}

/** Is a camera sending live video right now? */
export const cameraStreaming = (stateObj) => stateObj?.state === "streaming";

// Online status of a game console (PlayStation Network: playing on the console, busy, online)
const CONSOLE_ON = new Set(["availabletoplay", "busy", "online"]);

// Washing machines and dryers: states of a status sensor while a programme runs
// (Home Connect: "run"; other integrations use words like these)
const LAUNDRY_RUN = new Set(["run", "running", "washing", "wash", "rinse", "rinsing", "spin", "spinning", "drying", "in_use"]);
const LAUNDRY_SPIN = new Set(["spin", "spinning"]);
const SPIN_MINUTES = 10; // a wash ends with the spin: its last minutes, when the phase isn't reported

/**
 * What a washing machine or dryer is doing, from its linked entity (a status sensor, or a
 * binary sensor that's on while it runs) and, from the same device, the programme's
 * progress and end time (Home Connect has both). `spinning`: a washing machine's final
 * spin, from the state when the integration reports it, else the last minutes of the
 * programme. Returns { running, spinning, progress (0..1 or null), finished }.
 */
export function laundryState(hass, entityId, { washer = true } = {}) {
  const st = hass?.states?.[entityId];
  if (!st) return { running: false, spinning: false, progress: null, finished: false };
  const state = String(st.state).toLowerCase();
  const running = domainOf(entityId) === "binary_sensor" ? state === "on" : LAUNDRY_RUN.has(state);
  const finished = state === "finished";
  let progress = null;
  let remaining = null; // minutes
  const device = hass.entities?.[entityId]?.device_id;
  for (const ent of device ? Object.values(hass.entities) : []) {
    if (ent.device_id !== device || domainOf(ent.entity_id) !== "sensor") continue;
    const s = hass.states[ent.entity_id];
    const key = `${ent.translation_key || ""} ${ent.entity_id}`;
    if (!s) continue;
    if (/progress|voortgang/.test(key)) {
      const v = parseFloat(s.state);
      if (Number.isFinite(v)) progress = Math.max(0, Math.min(1, v / 100));
    } else if (/finish_time|end_time|eindtijd/.test(key)) {
      const t = Date.parse(s.state);
      if (Number.isFinite(t)) remaining = (t - Date.now()) / 60000;
    }
  }
  const spinning = running && washer && (LAUNDRY_SPIN.has(state)
    || (remaining !== null ? remaining <= SPIN_MINUTES : progress !== null && progress >= 0.9));
  return { running, spinning, progress: running ? progress : finished ? 1 : null, finished };
}

export function isScreenOn(stateObj) {
  if (!stateObj) return false;
  if (domainOf(stateObj.entity_id) === "media_player") {
    return !["off", "standby", "unavailable", "unknown"].includes(stateObj.state);
  }
  if (domainOf(stateObj.entity_id) === "sensor" && (CONSOLE_ON.has(stateObj.state) || LAUNDRY_RUN.has(stateObj.state))) return true;
  return isActive(stateObj);
}

/**
 * What a game console is playing, from entities of the same device (PlayStation
 * Network: the "now playing" sensor and its cover image). { title, picture } or null.
 */
export function consolePlaying(hass, entityId) {
  const device = hass?.entities?.[entityId]?.device_id;
  if (!device) return null;
  let title = null;
  let picture = null;
  for (const [id, ent] of Object.entries(hass.entities)) {
    if (ent.device_id !== device || !/now_playing/.test(ent.translation_key || "")) continue;
    const st = hass.states[id];
    if (!st || ["unknown", "unavailable", ""].includes(st.state)) continue;
    if (domainOf(id) === "sensor") title = st.state;
    if (domainOf(id) === "image") picture = st.attributes?.entity_picture || null;
  }
  return title || picture ? { title, picture } : null;
}

export const isPlaying = (stateObj) =>
  domainOf(stateObj?.entity_id) === "media_player" && stateObj.state === "playing";

/**
 * Is sound coming out of a piece? Playing media, or for wired (passive) speakers, an
 * amplifier that's on and not muted (amplifiers like the NAD T 778 only say on/off).
 */
export const isSounding = (stateObj, passive = false) =>
  isPlaying(stateObj) || (passive && domainOf(stateObj?.entity_id) === "media_player"
    && stateObj.state === "on" && !stateObj.attributes?.is_volume_muted);

/**
 * How the surround speakers of a Sonos home theatre (its soundbar's player) play right
 * now: 0 silent (not playing, or surround switched off in the Sonos app), 1 full (TV
 * sound, or music with "surround music full volume" on), 0.5 ambient (music, which the
 * surrounds play softly at the music surround level).
 */
export function surroundLevel(hass, playerId) {
  const st = hass?.states?.[playerId];
  if (!isPlaying(st)) return 0;
  const ids = deviceEntityIds(hass, playerId);
  const setting = (...keys) => {
    const id = ids.find((e) => domainOf(e) === "switch"
      && keys.some((k) => hass.entities?.[e]?.translation_key === k || e.endsWith(`_${k}`)));
    return id ? hass.states?.[id]?.state : undefined;
  };
  if (setting("surround_enabled") === "off") return 0;
  const tv = String(st.attributes?.media_content_id || "").startsWith("x-sonos-htastream:") || st.attributes?.source === "TV";
  return tv || setting("surround_mode", "surround_music_full_volume") === "on" ? 1 : 0.5;
}

/**
 * Whether the Sub bonded to a Sonos soundbar (its player) plays: 1 while the soundbar plays,
 * 0 when it doesn't or the sub is switched off in the Sonos app ("Subwoofer enabled").
 */
export function subLevel(hass, playerId) {
  if (!isPlaying(hass?.states?.[playerId])) return 0;
  const id = deviceEntityIds(hass, playerId).find((e) => domainOf(e) === "switch"
    && (hass.entities?.[e]?.translation_key === "sub_enabled" || e.endsWith("_subwoofer_enabled") || e.endsWith("_sub_enabled")));
  return id && hass.states?.[id]?.state === "off" ? 0 : 1;
}

/** Pulsing ring + gentle beat for markers of media players that are playing. */
export const PLAYING_STYLE = `
.marker.playing .bubble { position:relative; animation:fps-beat 1.6s ease-in-out infinite; }
.marker.playing .bubble::after { content:""; position:absolute; inset:-2px; border-radius:50%; pointer-events:none;
  border:3px solid var(--fps-marker-active, var(--fps-active)); animation:fps-ring 1.6s ease-out infinite; }
@keyframes fps-beat { 0%, 100% { transform:scale(1); } 50% { transform:scale(1.1); } }
@keyframes fps-ring { 0% { transform:scale(1); opacity:.85; } 100% { transform:scale(2); opacity:0; } }
@media (prefers-reduced-motion: reduce) {
  .marker.playing .bubble, .marker.playing .bubble::after { animation:none; }
}
`;

/**
 * Where sound from a point reaches within `range` (m): rays cast all around, stopped by
 * walls (doorways let it through, windows don't). Points in plan coordinates.
 */
export function soundArea(c, range, floor) {
  const segs = [];
  for (const w of floor?.walls || []) {
    const { pieces, length } = wallPieces(w, floor.openings || [], 100);
    if (!length) continue;
    const u = [(w.b[0] - w.a[0]) / length, (w.b[1] - w.a[1]) / length];
    for (const pc of pieces) {
      if (pc.bottom > 0) continue; // above a doorway
      const p = [w.a[0] + u[0] * pc.from, w.a[1] + u[1] * pc.from];
      const q = [w.a[0] + u[0] * pc.to, w.a[1] + u[1] * pc.to];
      // Skip walls out of reach (distance from the point to the span)
      const t = Math.max(0, Math.min(1, ((c[0] - p[0]) * (q[0] - p[0]) + (c[1] - p[1]) * (q[1] - p[1])) / ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 || 1)));
      if (Math.hypot(c[0] - p[0] - t * (q[0] - p[0]), c[1] - p[1] - t * (q[1] - p[1])) > range) continue;
      segs.push([p, q, (w.thickness || 0) / 2]);
    }
  }
  const angles = [];
  for (let i = 0; i < 96; i++) angles.push((i / 96) * 2 * Math.PI);
  for (const [p, q] of segs) for (const e of [p, q]) {
    const a = Math.atan2(e[1] - c[1], e[0] - c[0]);
    angles.push(a - 1e-4, a + 1e-4); // sharp corners
  }
  angles.sort((a, b) => a - b);
  return angles.map((a) => {
    const d = [Math.cos(a), Math.sin(a)];
    let t = range;
    for (const [p, q, half] of segs) {
      const e = [q[0] - p[0], q[1] - p[1]];
      const den = d[0] * e[1] - d[1] * e[0];
      if (Math.abs(den) < 1e-9) continue;
      const w = [p[0] - c[0], p[1] - c[1]];
      const tt = (w[0] * e[1] - w[1] * e[0]) / den;
      const s = (w[0] * d[1] - w[1] * d[0]) / den;
      // Stop at the wall's face (half its thickness before the centre line)
      if (s >= 0 && s <= 1 && tt > 0.02) t = Math.min(t, Math.max(0, tt - half / Math.max(0.2, Math.abs(den) / Math.hypot(e[0], e[1]))));
    }
    return [c[0] + d[0] * t, c[1] + d[1] * t];
  });
}
