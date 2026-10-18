// Robot vacuums: which room is being cleaned, and a robot driving lanes through it.
// Robot lawn mowers (a lawn_mower entity: mowing, returning, docked, paused, error): the outdoor area their charging station is in, mowed in random straight
// lines that turn at its edge (the way Gardena's mowers work, inside their boundary wire).
//
// The room comes from the vacuum's "current room" sensor (Dreame and similar
// integrations: a sensor of the same device with a `room_id` attribute), mapped to a
// room of the plan with the piece's `vacuum_rooms` ({ vacuum room id: plan room id }),
// or else matched by name. The pose is kept per piece, so the 2D plan and the 3D view
// show the robot in the same place.

import { t } from "./i18n.js";
import { domainOf, pointInPolygon, polygonArea } from "./model.js";
import { isOutdoor } from "./materials.js";

const SPEED = 0.32; // m/s, about what a robot vacuum drives while cleaning
const LANE = 0.3; // lane spacing (m)
const INSET = 0.2; // keep the robot's centre this far from the walls

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The vacuum's rooms (from its `rooms` attribute: { map name: [{ id, name }] }). */
export function vacuumRooms(hass, vacuumId) {
  const rooms = hass?.states?.[vacuumId]?.attributes?.rooms;
  if (!rooms || typeof rooms !== "object") return [];
  const list = Array.isArray(rooms) ? rooms : Object.values(rooms).flat();
  return list.filter((r) => r && r.id !== undefined).map((r) => ({ id: String(r.id), name: r.name || t("Room {n}", { n: r.id }) }));
}

/** Sensor reporting the room the vacuum is in (same device, `room_id` attribute). */
export function currentRoomSensor(hass, vacuumId) {
  const device = hass?.entities?.[vacuumId]?.device_id;
  const states = hass?.states || {};
  if (device) {
    for (const [id, ent] of Object.entries(hass.entities)) {
      if (ent.device_id === device && domainOf(id) === "sensor" && states[id]?.attributes?.room_id !== undefined) return id;
    }
  }
  const guess = `sensor.${vacuumId.split(".")[1]}_current_room`;
  return states[guess] ? guess : null;
}

// Station work during a clean (the vacuum still says "cleaning"): at the dock, or on its way there
const AT_DOCK = new Set(["washing", "washing_paused", "clean_add_water", "drying", "charging", "charging_completed",
  "auto_emptying", "emptying", "station_cleaning", "draining"]);
const TO_DOCK = new Set(["returning", "returning_to_wash", "returning_to_drain", "returning_auto_empty", "back_home"]);

/**
 * While "cleaning": is the robot actually at its station (washing its mop, refilling,
 * charging) or driving back to it? From the vacuum's own flags (Dreame: washing, drying,
 * returning) and its status sensors. "dock", "returning" or null (out cleaning).
 */
export function stationWork(hass, vacuumId) {
  const a = hass?.states?.[vacuumId]?.attributes || {};
  if (a.returning) return "returning";
  if (a.washing || a.washing_paused || a.drying) return "dock";
  const device = hass?.entities?.[vacuumId]?.device_id;
  if (!device) return null;
  let found = null;
  for (const [id, ent] of Object.entries(hass.entities)) {
    if (ent.device_id !== device || domainOf(id) !== "sensor") continue;
    const st = hass.states[id]?.state;
    if (AT_DOCK.has(st)) found = "dock";
    else if (TO_DOCK.has(st) && !found) found = "returning";
  }
  return found;
}

/** Plan room (of `rooms`) the vacuum is cleaning now, or null. */
export function cleaningRoom(hass, piece, rooms) {
  const sensor = currentRoomSensor(hass, piece.entity_id);
  const st = sensor && hass.states[sensor];
  const id = st?.attributes?.room_id;
  if (id === undefined || id === null) return null;
  const mapped = piece.vacuum_rooms?.[String(id)];
  if (mapped) return rooms.find((r) => r.id === mapped) || null;
  // Not mapped: match the vacuum's name for the room with the plan room or its area
  const names = [st.state, st.attributes.room_name, vacuumRooms(hass, piece.entity_id).find((r) => r.id === String(id))?.name]
    .map(squash).filter((n) => n.length >= 3);
  return rooms.find((r) => {
    const own = [r.name, hass.areas?.[r.area_id]?.name, r.area_id].map(squash).filter((n) => n.length >= 3);
    return own.some((n) => names.includes(n));
  }) || null;
}

/** Back-and-forth lanes through a room (a lawnmower pattern), as waypoints. */
export function cleaningPath(points) {
  const ys = points.map((p) => p[1]);
  const [y0, y1] = [Math.min(...ys) + INSET, Math.max(...ys) - INSET];
  const path = [];
  let flip = false;
  for (let y = y0; y <= y1 + 1e-6; y += LANE) {
    // Where this lane crosses the room's outline
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    // The widest stretch inside the room on this lane
    let best = null;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const [a, b] = [xs[i] + INSET, xs[i + 1] - INSET];
      if (b > a && (!best || b - a > best[1] - best[0])) best = [a, b];
    }
    if (!best) continue;
    const lane = flip ? [[best[1], y], [best[0], y]] : [[best[0], y], [best[1], y]];
    path.push(...lane);
    flip = !flip;
  }
  if (!path.length) {
    // A tiny room: circle its middle
    const c = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
    return [c];
  }
  return path;
}

// ---------- robot lawn mowers ----------

const MOW_SPEED = 0.3; // m/s
const MOW_INSET = 0.25; // keep the mower's centre this far inside the area's edge (the boundary wire)

/**
 * The outdoor area a mower mows: the one its charging station (its place on the plan) is in,
 * grass first (a station on a path inside the lawn); or, for a station just outside, the
 * nearest outdoor area, grass first.
 */
export function mowingArea(piece, rooms) {
  const at = [piece.x, piece.y];
  const rank = (r) => (r.floor_material === "grass" ? 0 : 1);
  const outdoor = rooms.filter(isOutdoor);
  const around = outdoor.filter((r) => pointInPolygon(at, r.points))
    .sort((a, b) => rank(a) - rank(b) || polygonArea(a.points) - polygonArea(b.points));
  if (around.length) return around[0];
  return outdoor.map((r) => ({ r, d: edgeDistance(at, r.points) + 3 * rank(r) })).sort((a, b) => a.d - b.d)[0]?.r || null;
}

/** Distance from p to the nearest edge of a polygon. */
function edgeDistance(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** Repeatable random numbers per mower, so its path doesn't jump when the page redraws. */
function random(m) {
  m.seed = (m.seed + 0x6d2b79f5) | 0;
  let x = Math.imul(m.seed ^ (m.seed >>> 15), 1 | m.seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** A repeatable random spot well inside an area (null if none is found). */
function spotInside(m, area) {
  const pts = area.points;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  for (let k = 0; k < 60; k++) {
    const p = [Math.min(...xs) + random(m) * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + random(m) * (Math.max(...ys) - Math.min(...ys))];
    if (pointInPolygon(p, pts) && edgeDistance(p, pts) >= MOW_INSET) return p;
  }
  return null;
}

/**
 * Mow: drive straight on; at the edge, turn to a new random heading back into the area (as a
 * robot mower does at its boundary wire). From the station, first drive into the area.
 */
function mow(m, area, dt) {
  const pts = area.points;
  const inside = (p) => pointInPolygon(p, pts) && edgeDistance(p, pts) >= MOW_INSET;
  const key = `${area.id}:${pts.flat().join(",")}`;
  if (m.mowKey !== key) {
    m.mowKey = key;
    m.dir = null;
  }
  let step = MOW_SPEED * dt;
  if (!inside(m.pos) && !m.dir) {
    // Leaving the station: towards the middle of the area (or any spot inside it)
    const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    let target = inside(c) ? c : null;
    for (let k = 0; !target && k < 40; k++) {
      const p = pts[Math.floor(random(m) * pts.length)];
      const q = [p[0] + (c[0] - p[0]) * random(m), p[1] + (c[1] - p[1]) * random(m)];
      if (inside(q)) target = q;
    }
    if (!target) return false;
    const d = Math.hypot(target[0] - m.pos[0], target[1] - m.pos[1]);
    m.rotation = heading(m.pos, target);
    if (d <= step) {
      m.pos = target;
      m.dir = Math.atan2(target[1] - c[1] || 1e-6, target[0] - c[0]) + Math.PI * (random(m) - 0.5);
    } else {
      m.pos = [m.pos[0] + ((target[0] - m.pos[0]) * step) / d, m.pos[1] + ((target[1] - m.pos[1]) * step) / d];
    }
    return true;
  }
  if (m.dir === null || m.dir === undefined) m.dir = random(m) * Math.PI * 2;
  for (let n = 0; step > 1e-6 && n < 8; n++) {
    const next = [m.pos[0] + Math.cos(m.dir) * step, m.pos[1] + Math.sin(m.dir) * step];
    if (inside(next)) {
      m.pos = next;
      break;
    }
    // At the edge: a new heading that leads back in, mostly away from the edge
    let turned = false;
    for (let k = 0; k < 24 && !turned; k++) {
      const a = m.dir + Math.PI + (random(m) - 0.5) * Math.PI * 1.2;
      if (inside([m.pos[0] + Math.cos(a) * 0.3, m.pos[1] + Math.sin(a) * 0.3])) {
        m.dir = a;
        turned = true;
      }
    }
    if (!turned) m.dir = random(m) * Math.PI * 2;
    step *= 0.5;
  }
  m.rotation = heading([0, 0], [Math.cos(m.dir), Math.sin(m.dir)]);
  return true;
}

/** Heading (plan rotation, degrees clockwise) facing from a to b; the robot's front is +y. */
const heading = (a, b) => (Math.atan2(-(b[0] - a[0]), b[1] - a[1]) * 180) / Math.PI;

const poses = new Map(); // piece id -> motion state, shared by the plan and the 3D view

/**
 * Advance a robot to time `now` (seconds) and return its pose { x, y, rotation, moving }.
 * Time-based, so the plan and the 3D view can both ask in the same frame.
 * Cleaning: drive the lanes of the room being cleaned (looping); paused or stuck:
 * stay put; returning: drive straight home; otherwise: at its place on the plan.
 */
export function robotPose(hass, piece, rooms, now = performance.now() / 1000) {
  const home = { x: piece.x, y: piece.y, rotation: piece.rotation || 0, moving: false };
  const state = hass?.states?.[piece.entity_id]?.state;
  let m = poses.get(piece.id);
  if (!m || m.homeKey !== `${piece.x},${piece.y},${piece.rotation}`) {
    m = { homeKey: `${piece.x},${piece.y},${piece.rotation}`, pos: [piece.x, piece.y], rotation: home.rotation, path: null, roomKey: null, i: 0,
      seed: [...String(piece.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) };
    poses.set(piece.id, m);
  }
  const dt = Math.min(0.25, Math.max(0, now - (m.last ?? now)));
  m.last = now;
  const drive = (target, step) => {
    const d = Math.hypot(target[0] - m.pos[0], target[1] - m.pos[1]);
    if (d > 1e-4) m.rotation = heading(m.pos, target);
    if (d <= step) {
      m.pos = [...target];
      return step - d;
    }
    m.pos = [m.pos[0] + ((target[0] - m.pos[0]) * step) / d, m.pos[1] + ((target[1] - m.pos[1]) * step) / d];
    return 0;
  };
  const mower = domainOf(piece.entity_id) === "lawn_mower";
  if (state === "mowing") {
    m.roomKey = null;
    m.out = true;
    const area = mowingArea(piece, rooms);
    const moving = area ? mow(m, area, dt) : false;
    return { x: m.pos[0], y: m.pos[1], rotation: m.rotation, moving };
  }
  m.mowKey = null;
  const station = state === "cleaning" ? stationWork(hass, piece.entity_id) : null;
  if (state === "cleaning" && !station) {
    const room = cleaningRoom(hass, piece, rooms)
      || rooms.find((r) => pointInPolygon(m.pos, r.points)) || null;
    if (!room) return { x: m.pos[0], y: m.pos[1], rotation: m.rotation, moving: false };
    const key = `${room.id}:${room.points.flat().join(",")}`;
    if (m.roomKey !== key) {
      m.roomKey = key;
      m.path = cleaningPath(room.points);
      // Start at the nearest lane end
      let best = 0;
      m.path.forEach((p, i) => { if (Math.hypot(p[0] - m.pos[0], p[1] - m.pos[1]) < Math.hypot(m.path[best][0] - m.pos[0], m.path[best][1] - m.pos[1])) best = i; });
      m.i = best;
      m.transit = true; // getting there (from the dock or another room) goes quicker
    }
    let step = SPEED * (m.transit ? 2.5 : 1) * dt;
    for (let n = 0; step > 0 && n < 50; n++) {
      step = drive(m.path[m.i], step);
      if (step > 0 || Math.hypot(m.path[m.i][0] - m.pos[0], m.path[m.i][1] - m.pos[1]) < 1e-4) {
        m.i = (m.i + 1) % m.path.length;
        m.transit = false;
      }
    }
    return { x: m.pos[0], y: m.pos[1], rotation: m.rotation, moving: true };
  }
  m.roomKey = null;
  if (state === "returning" || station === "returning") {
    if (mower && !m.out) {
      // Not seen mowing since the page opened: it's somewhere on its lawn, coming home
      const area = mowingArea(piece, rooms);
      const spot = area && spotInside(m, area);
      if (spot) m.pos = spot;
    }
    m.out = true;
    // (a mower finds its way back along its boundary wire: no hurry)
    drive([piece.x, piece.y], (mower ? MOW_SPEED * 0.6 : SPEED * 1.5) * dt);
    const there = Math.hypot(piece.x - m.pos[0], piece.y - m.pos[1]) < 1e-3;
    if (there) m.rotation = home.rotation;
    return { x: m.pos[0], y: m.pos[1], rotation: m.rotation, moving: !there };
  }
  if (["paused", "error"].includes(state)) {
    if (mower && !m.out) {
      // Stopped out on the lawn (not seen there since the page opened): somewhere on it
      const area = mowingArea(piece, rooms);
      const spot = area && spotInside(m, area);
      if (spot) m.pos = spot;
      m.out = true;
    }
    return { x: m.pos[0], y: m.pos[1], rotation: m.rotation, moving: false };
  }
  // Docked (or busy at the station mid-clean): at its place on the plan
  m.out = false;
  m.pos = [piece.x, piece.y];
  m.rotation = home.rotation;
  return home;
}

/** Is a robot on the move (so its view needs to keep animating)? */
export function robotBusy(hass, piece) {
  const state = hass?.states?.[piece.entity_id]?.state;
  if (state === "returning" || state === "mowing") return true;
  return state === "cleaning" && stationWork(hass, piece.entity_id) !== "dock";
}
