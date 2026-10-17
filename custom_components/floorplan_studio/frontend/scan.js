// Import a LiDAR room scan (an OBJ exported by an Apple RoomPlan app such as 3D Snap or
// Polycam) as a new floor: walls, doors, windows, rooms and furniture blocks.
//
// RoomPlan exports every wall, door, window and object as its own mesh group (y up, metres).
// The groups carry no names we can rely on, so they are told apart by shape:
//   - the floor slab: flat and large
//   - walls: thin, standing on the floor, tall; their cross-section near the top becomes
//     the wall's centre line (straight walls one segment, curved ones a few)
//   - doors and doorways: thin and standing on the floor, but inside a taller wall (the
//     wall mesh has a hole there); a door when its material says so, otherwise a doorway,
//     which becomes a gap in the wall
//   - windows: thin, off the floor, inside a wall
//   - furniture: whatever else stands on the floor, plus closed boxes (wall cabinets)
// Floating text labels some apps add (category names) match none of these and are skipped.

import { t } from "./i18n.js";
import { dist, newFloor, uid } from "./model.js";
import { newFurniture } from "./furniture.js";

const THIN = 0.3; // thickest a wall, door or window can be (m)
const ON_FLOOR = 0.1; // how close to the floor a piece must start to stand on it
const MIN_WALL_HEIGHT = 1.8;
const JOIN = 0.4; // how far a wall end may move to meet another wall
const CELL = 0.05; // room-finding grid (m)
const MIN_ROOM_AREA = 0.5;

// ---------- OBJ ----------

/** Parse OBJ text into vertex positions and groups of triangles (vertex indices). */
export function parseObj(text) {
  const verts = [];
  const groups = [];
  let name = "default";
  let material = null;
  let cur = null;
  const group = () => {
    if (!cur) {
      cur = { name, material, tris: [] };
      groups.push(cur);
    }
    return cur;
  };
  for (const line of text.split("\n")) {
    const t = line.trim().split(/\s+/);
    switch (t[0]) {
      case "v":
        verts.push([+t[1], +t[2], +t[3]]);
        break;
      case "g":
      case "o":
        name = t.slice(1).join(" ") || name;
        cur = null;
        break;
      case "usemtl":
        material = t[1] || null;
        cur = null;
        break;
      case "f": {
        const idx = t.slice(1).map((s) => {
          const i = parseInt(s, 10);
          return i < 0 ? verts.length + i : i - 1;
        });
        const g = group();
        for (let i = 1; i + 1 < idx.length; i++) g.tris.push([idx[0], idx[i], idx[i + 1]]);
        break;
      }
      default:
    }
  }
  return { verts, groups: groups.filter((g) => g.tris.length) };
}

// ---------- 2D geometry ----------

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Smallest rectangle around points: centre, angle (radians) of its long side, long and short side. */
export function minRect(points) {
  const h = hull(points);
  if (h.length < 3) {
    const [a, b] = [h[0] || [0, 0], h[1] || h[0] || [0, 0]];
    return { c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], angle: Math.atan2(b[1] - a[1], b[0] - a[0]), long: dist(a, b), short: 0 };
  }
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const [a, b] = [h[i], h[(i + 1) % h.length]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const [c, s] = [Math.cos(ang), Math.sin(ang)];
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const q of h) {
      const u = q[0] * c + q[1] * s;
      const v = -q[0] * s + q[1] * c;
      [u0, u1, v0, v1] = [Math.min(u0, u), Math.max(u1, u), Math.min(v0, v), Math.max(v1, v)];
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ang, u0, u1, v0, v1, c, s };
  }
  const { ang, u0, u1, v0, v1, c, s } = best;
  const [um, vm] = [(u0 + u1) / 2, (v0 + v1) / 2];
  const centre = [um * c - vm * s, um * s + vm * c];
  return u1 - u0 >= v1 - v0
    ? { c: centre, angle: ang, long: u1 - u0, short: v1 - v0 }
    : { c: centre, angle: ang + Math.PI / 2, long: v1 - v0, short: u1 - u0 };
}

const area = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
};

const perimeter = (pts) => pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]), 0);

function inside(p, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

function segDist(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return { t, d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) };
}

/** Distance from p to a closed polygon's edge (0 when inside). */
const loopDist = (p, pts) =>
  inside(p, pts) ? 0 : Math.min(...pts.map((a, i) => segDist(p, a, pts[(i + 1) % pts.length]).d));

/** Douglas-Peucker simplification of an open polyline. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let [idx, max] = [0, 0];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]).d;
    if (d > max) [idx, max] = [i, d];
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol));
}

/** Simplify a closed loop (keeps the two points farthest apart as anchors). */
function simplifyLoop(pts, tol) {
  if (pts.length < 4) return pts;
  let far = 0;
  for (let i = 1; i < pts.length; i++) if (dist(pts[0], pts[i]) > dist(pts[0], pts[far])) far = i;
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify(pts.slice(far).concat([pts[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** Points spread evenly (by length) along a polyline. */
function resample(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (total * k) / (n - 1);
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[j]) / span));
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

// ---------- mesh groups ----------

/** Cut a group's triangles at height y: closed loops in plan coordinates (x, z). */
function section(scan, g, y) {
  const { verts } = scan;
  const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const next = new Map();
  const pts = new Map();
  for (const tri of g.tris) {
    const cut = [];
    for (let i = 0; i < 3; i++) {
      const a = verts[tri[i]];
      const b = verts[tri[(i + 1) % 3]];
      if ((a[1] - y) * (b[1] - y) < 0) {
        const t = (y - a[1]) / (b[1] - a[1]);
        cut.push([a[0] + t * (b[0] - a[0]), a[2] + t * (b[2] - a[2])]);
      }
    }
    if (cut.length !== 2) continue;
    const [ka, kb] = cut.map(key);
    if (ka === kb) continue;
    pts.set(ka, cut[0]);
    pts.set(kb, cut[1]);
    if (!next.has(ka)) next.set(ka, []);
    if (!next.has(kb)) next.set(kb, []);
    next.get(ka).push(kb);
    next.get(kb).push(ka);
  }
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let [prev, k] = [null, start];
    while (k && !used.has(k)) {
      used.add(k);
      loop.push(pts.get(k));
      const n = next.get(k).find((q) => q !== prev && !used.has(q));
      [prev, k] = [k, n];
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function describe(scan, g) {
  const ids = new Set(g.tris.flat());
  let [lo, hi] = [Infinity, -Infinity];
  const plan = [];
  const seen = new Set();
  for (const i of ids) {
    const [x, y, z] = scan.verts[i];
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
    seen.add(`${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`);
    plan.push([x, z]);
  }
  return { g, lo, hi, corners: seen.size, rect: minRect(plan) };
}

/** Centre line(s) of a wall's cross-section loop, with its thickness. */
function centreLines(loop) {
  const r = minRect(loop);
  const straight = () => {
    const [dx, dy] = [(Math.cos(r.angle) * r.long) / 2, (Math.sin(r.angle) * r.long) / 2];
    return { thickness: r.short, lines: [[[r.c[0] - dx, r.c[1] - dy], [r.c[0] + dx, r.c[1] + dy]]] };
  };
  if (area(loop) > 0.85 * r.long * r.short) return straight();
  // Curved (or bent) wall: split the loop at its two ends and average both sides
  const thickness = (2 * area(loop)) / perimeter(loop);
  const pts = simplifyLoop(loop, 0.002);
  let [i0, i1, best] = [0, 0, -1];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = dist(pts[i], pts[j]);
      if (d > best) [i0, i1, best] = [i, j, d];
    }
  }
  let sideA = pts.slice(i0, i1 + 1);
  let sideB = pts.slice(i1).concat(pts.slice(0, i0 + 1)).reverse();
  // Both sides run from one end to the other; each end has a short cap edge, which
  // belongs to one of them: leave it off, so both sides start at the cap's corners
  if (dist(sideA[0], sideA[1]) <= dist(sideB[0], sideB[1])) sideA = sideA.slice(1);
  else sideB = sideB.slice(1);
  if (dist(sideA.at(-1), sideA.at(-2)) <= dist(sideB.at(-1), sideB.at(-2))) sideA = sideA.slice(0, -1);
  else sideB = sideB.slice(0, -1);
  if (sideA.length < 2 || sideB.length < 2) return straight();
  const n = Math.max(8, Math.ceil(perimeter(pts) / 2 / 0.05));
  const a = resample(sideA, n);
  const b = resample(sideB, n);
  const mid = a.map((p, k) => [(p[0] + b[k][0]) / 2, (p[1] + b[k][1]) / 2]);
  const line = simplify(mid, 0.04);
  return { thickness, lines: line.slice(1).map((p, k) => [line[k], p]) };
}

// ---------- the import ----------

/**
 * Turn a parsed scan into a floor. Returns { floor, counts } or throws when the file
 * has no walls we recognise.
 */
export function scanToFloor(scan, { name = "Scan", level = 0 } = {}) {
  const parts = scan.groups.map((g) => describe(scan, g));

  // The floor: flat, large slabs; their top is floor level
  const slabs = parts.filter((p) => p.hi - p.lo < 0.3 && p.rect.long * p.rect.short > 4);
  const standing = (p) => p.lo < floorY + ON_FLOOR;
  let floorY = slabs.length ? Math.max(...slabs.map((p) => p.hi)) : null;
  if (floorY === null) {
    // No slab: the level most tall pieces start at
    const tall = parts.filter((p) => p.hi - p.lo > MIN_WALL_HEIGHT).map((p) => Math.round(p.lo * 50) / 50);
    if (!tall.length) throw new Error(t("No walls found in this file. Is it a room scan (RoomPlan OBJ)?"));
    const freq = new Map();
    tall.forEach((y) => freq.set(y, (freq.get(y) || 0) + 1));
    floorY = Math.min(...tall.filter((y) => freq.get(y) === Math.max(...freq.values())));
  }
  const rest = parts.filter((p) => !slabs.includes(p));

  // Thin, tall pieces on the floor: walls, doors and doorways
  const upright = rest.filter((p) => standing(p) && p.hi - floorY >= MIN_WALL_HEIGHT && p.rect.short <= 3);
  for (const p of upright) {
    // Cut just under the top, above the doors; a window reaching up to there leaves the
    // wall in pieces, so try a few heights and keep the most whole cut
    p.loops = [0.03, 0.1, 0.25, 0.5]
      .map((d) => section(scan, p.g, p.hi - d + 1.234e-5))
      .reduce((best, loops) => (best && best.length <= loops.length ? best : loops), null);
    const a = p.loops.reduce((s, l) => s + area(l), 0);
    const per = p.loops.reduce((s, l) => s + perimeter(l), 0);
    p.band = per ? (2 * a) / per : Infinity;
    // The cut must run the whole length (not just catch the top of a lamp or a shelf)
    p.spans = p.loops.length > 0 && minRect(p.loops.flat()).long >= 0.6 * p.rect.long;
  }
  const thin = upright.filter((p) => p.band <= THIN / 2 + 0.05 && p.spans);
  // A thin piece inside a taller wall is a door or doorway in it (the wall has a hole there).
  // So is a thinner, lower piece filling a gap between two walls.
  const holder = (p, among, margin = 0.03) =>
    among.find((w) => w !== p && w.hi > p.hi + margin && w.loops?.some((l) => loopDist(p.rect.c, l) < 0.1));
  const ends = (p) => [-1, 1].map((k) => [p.rect.c[0] + (k * Math.cos(p.rect.angle) * p.rect.long) / 2,
    p.rect.c[1] + (k * Math.sin(p.rect.angle) * p.rect.long) / 2]);
  const inGap = (p, among) => ends(p).every((e) => among.some((w) => w !== p && w.hi > p.hi + 0.03
    && p.rect.short < 0.75 * w.band * 2 && w.loops.some((l) => loopDist(e, l) < 0.12)));
  const named = (p, re) => re.test(p.g.material || "") || re.test(p.g.name);
  const doorish = thin.filter((p) => holder(p, thin) || inGap(p, thin) || named(p, /door|opening/i));
  const wallParts = thin.filter((p) => !doorish.includes(p));
  if (!wallParts.length) throw new Error(t("No walls found in this file. Is it a room scan (RoomPlan OBJ)?"));

  // Wall centre lines
  let walls = [];
  for (const p of wallParts) {
    for (const loop of p.loops) {
      const { thickness, lines } = centreLines(loop);
      for (const [a, b] of lines) if (dist(a, b) >= 0.05) walls.push({ a, b, thickness: Math.max(0.05, thickness), top: p.hi });
    }
  }

  // Windows: thin pieces off the floor, inside a wall and not above it
  // (flat ones are the floating labels some apps add)
  const windows = rest.filter((p) => !upright.includes(p) && p.lo > floorY + 0.15 && p.rect.short <= THIN
    && p.rect.short >= 0.02 && p.rect.long >= 0.3 && p.hi - p.lo >= 0.2 && holder(p, wallParts, -0.03));

  // Furniture: everything else on the floor, plus closed boxes (wall cabinets)
  const wallTop = Math.max(...wallParts.map((p) => p.hi));
  const furniture = rest.filter((p) => !thin.includes(p) && !windows.includes(p) && p.rect.short >= 0.02
    && (standing(p) || p.corners === 8) && p.hi <= wallTop + 0.05
    && p.rect.long >= 0.2 && p.rect.short >= 0.05 && p.hi - p.lo >= 0.05);

  // Turn the plan so most walls run along the grid
  const bins = new Map();
  for (const w of walls) {
    const deg = Math.round(((Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180) / Math.PI + 360) % 90);
    bins.set(deg % 90, (bins.get(deg % 90) || 0) + dist(w.a, w.b));
  }
  const top = [...bins.entries()].sort((x, y) => y[1] - x[1])[0][0];
  let num = 0;
  let den = 0;
  for (const w of walls) {
    let deg = ((Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180) / Math.PI + 360) % 90;
    if (deg - top > 45) deg -= 90;
    if (top - deg > 45) deg += 90;
    if (Math.abs(deg - top) <= 2) {
      num += deg * dist(w.a, w.b);
      den += dist(w.a, w.b);
    }
  }
  let turn = den ? num / den : 0;
  if (turn > 45) turn -= 90;
  const rad = (-turn * Math.PI) / 180;
  const rot = (p) => [p[0] * Math.cos(rad) - p[1] * Math.sin(rad), p[0] * Math.sin(rad) + p[1] * Math.cos(rad)];
  walls = walls.map((w) => ({ ...w, a: rot(w.a), b: rot(w.b) }));
  const turned = (p) => ({ ...p, c: rot(p.rect.c), angle: p.rect.angle + rad });

  walls = joinWalls(walls);

  const floor = newFloor(level, name);
  const heights = new Map();
  for (const w of walls) {
    const h = Math.round((w.top - floorY) * 100) / 100;
    heights.set(h, (heights.get(h) || 0) + dist(w.a, w.b));
  }
  floor.wall_height = [...heights.entries()].sort((x, y) => y[1] - x[1])[0][0];
  floor.walls = walls.map((w) => ({ id: uid(), a: w.a, b: w.b, thickness: round(w.thickness, 3) }));

  // Doorways without a door become gaps; doors and windows go on their wall
  const counts = { walls: 0, doors: 0, doorways: 0, windows: 0, rooms: 0, furniture: 0, skipped: 0 };
  const onWall = (o) => {
    let best = null;
    for (const w of floor.walls) {
      const dir = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
      let diff = Math.abs(((o.angle - dir) % Math.PI + Math.PI) % Math.PI);
      diff = Math.min(diff, Math.PI - diff);
      const { t, d } = segDist(o.c, w.a, w.b);
      // Its middle must be along the wall, not past one of its ends
      const inner = t > 0 && t < 1;
      if (inner && diff < 0.35 && d < w.thickness / 2 + 0.2 && (!best || d < best.d)) best = { w, t, d };
    }
    return best;
  };
  const gaps = [];
  for (const p of doorish.map(turned)) {
    const door = named(p, /door/i);
    const [ea, eb] = [-1, 1].map((k) => [p.c[0] + (k * Math.cos(p.angle) * p.rect.long) / 2, p.c[1] + (k * Math.sin(p.angle) * p.rect.long) / 2]);
    let hit = onWall(p);
    if (!hit) {
      if (!door) {
        // A doorway between two walls: already a gap
        gaps.push([ea, eb]);
        counts.doorways++;
        continue;
      }
      // A door between two walls: give it a wall of its own, as thick as the nearest one
      const near = floor.walls.reduce((b, w) => Math.min(segDist(ea, w.a, w.b).d, segDist(eb, w.a, w.b).d) < (b?.d ?? 0.3)
        ? { w, d: Math.min(segDist(ea, w.a, w.b).d, segDist(eb, w.a, w.b).d) } : b, null);
      if (!near) {
        counts.skipped++;
        continue;
      }
      const w = { id: uid(), a: ea, b: eb, thickness: near.w.thickness };
      floor.walls.push(w);
      hit = { w, t: 0.5 };
    }
    const len = dist(hit.w.a, hit.w.b);
    if (door) {
      const width = Math.min(p.rect.long, len - 0.02);
      floor.openings.push({ id: uid(), wall_id: hit.w.id, type: "door", t: round(clampT(hit.t, width, len), 4),
        width: round(width, 2), height: round(p.hi - floorY, 2), sill: 0, entity_id: null });
      counts.doors++;
    } else {
      splitWall(floor, hit.w, hit.t, p.rect.long);
      gaps.push([ea, eb]);
      counts.doorways++;
    }
  }
  for (const p of windows.map(turned)) {
    const hit = onWall(p);
    if (!hit) {
      counts.skipped++;
      continue;
    }
    const len = dist(hit.w.a, hit.w.b);
    const width = Math.min(p.rect.long, len - 0.02);
    floor.openings.push({ id: uid(), wall_id: hit.w.id, type: "window", t: round(clampT(hit.t, width, len), 4),
      width: round(width, 2), height: round(p.hi - p.lo, 2), sill: round(p.lo - floorY, 2), entity_id: null });
    counts.windows++;
  }

  for (const p of furniture.map(turned)) {
    const f = newFurniture("box", round(p.c[0], 3), round(p.c[1], 3));
    Object.assign(f, {
      name: t("Scanned object"),
      w: round(Math.max(0.05, p.rect.long), 2),
      d: round(Math.max(0.05, p.rect.short), 2),
      h: round(Math.max(0.01, p.hi - p.lo), 2),
      z: standing(p) ? 0 : round(p.lo - floorY, 2),
      rotation: round((((p.angle * 180) / Math.PI) % 180 + 180) % 180, 1),
    });
    floor.furniture.push(f);
  }

  floor.rooms = findRooms(floor, gaps);
  shift(floor);
  Object.assign(counts, { walls: floor.walls.length, rooms: floor.rooms.length, furniture: floor.furniture.length });
  return { floor, counts };
}

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

const clampT = (t, width, len) => Math.min(1 - width / 2 / len, Math.max(width / 2 / len, t));

/** Move wall ends onto the crossing with a nearby wall, so corners and T-joints close. */
function joinWalls(walls) {
  const moved = walls.map((w) => ({ ...w }));
  walls.forEach((w, i) => {
    for (const e of [0, 1]) {
      const p = e ? w.b : w.a;
      let best = null;
      walls.forEach((o, j) => {
        if (j === i) return;
        const x = crossing(w.a, w.b, o.a, o.b);
        if (!x) return;
        const d = dist(p, x);
        const lo = dist(o.a, o.b);
        const s = ((x[0] - o.a[0]) * (o.b[0] - o.a[0]) + (x[1] - o.a[1]) * (o.b[1] - o.a[1])) / (lo * lo);
        // The crossing must lie on (or just past the end of) the other wall. This end may
        // reach out to it, but only pull back about as far as walls overlap at a corner
        const len = dist(w.a, w.b);
        const u = ((x[0] - w.a[0]) * (w.b[0] - w.a[0]) + (x[1] - w.a[1]) * (w.b[1] - w.a[1])) / (len * len);
        const inward = (e ? 1 - u : u) * len;
        if (d < JOIN && s > -JOIN / lo && s < 1 + JOIN / lo && inward < Math.min(len / 2, Math.max(0.12, o.thickness))
          && (!best || d < best.d)) best = { d, x };
      });
      if (best) moved[i][e ? "b" : "a"] = best.x;
    }
  });
  return moved.filter((w) => dist(w.a, w.b) >= 0.05);
}

function crossing(a, b, c, d) {
  const [r, s] = [[b[0] - a[0], b[1] - a[1]], [d[0] - c[0], d[1] - c[1]]];
  const den = r[0] * s[1] - r[1] * s[0];
  const len = Math.hypot(...r) * Math.hypot(...s);
  if (Math.abs(den) < Math.sin((20 * Math.PI) / 180) * len) return null; // (nearly) parallel
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

/** Cut a doorway out of a wall: the wall becomes two, openings move to the right part. */
function splitWall(floor, w, t, width) {
  const len = dist(w.a, w.b);
  const [t0, t1] = [t - width / 2 / len, t + width / 2 / len];
  const at = (u) => [w.a[0] + (w.b[0] - w.a[0]) * u, w.a[1] + (w.b[1] - w.a[1]) * u];
  const pieces = [];
  if (t0 * len >= 0.05) pieces.push({ id: uid(), a: w.a, b: at(t0), thickness: w.thickness, from: 0, to: t0 });
  if ((1 - t1) * len >= 0.05) pieces.push({ id: uid(), a: at(t1), b: w.b, thickness: w.thickness, from: t1, to: 1 });
  floor.walls = floor.walls.filter((x) => x !== w).concat(pieces.map(({ from, to, ...x }) => x));
  floor.openings = floor.openings.filter((o) => {
    if (o.wall_id !== w.id) return true;
    const piece = pieces.find((p) => o.t >= p.from && o.t <= p.to);
    if (!piece) return false;
    o.wall_id = piece.id;
    o.t = round((o.t - piece.from) / (piece.to - piece.from), 4);
    return true;
  });
}

/**
 * Rooms: the spaces the walls (and doors) close off, found on a grid and grown to the
 * walls' centre lines.
 */
function findRooms(floor, gaps = []) {
  const pts = floor.walls.flatMap((w) => [w.a, w.b]);
  const x0 = Math.min(...pts.map((p) => p[0])) - 0.5;
  const y0 = Math.min(...pts.map((p) => p[1])) - 0.5;
  const nx = Math.ceil((Math.max(...pts.map((p) => p[0])) + 0.5 - x0) / CELL);
  const ny = Math.ceil((Math.max(...pts.map((p) => p[1])) + 0.5 - y0) / CELL);
  const WALL = -1;
  const OUT = -2;
  const grid = new Int32Array(nx * ny);
  const centre = (i, j) => [x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL];
  // Walls block (doors are on walls); so do doorways, where one room ends and the next begins
  for (const w of [...floor.walls, ...gaps.map(([a, b]) => ({ a, b, thickness: 0.1 }))]) {
    const r = w.thickness / 2 + CELL * 0.75;
    const [i0, i1] = [Math.floor((Math.min(w.a[0], w.b[0]) - r - x0) / CELL), Math.ceil((Math.max(w.a[0], w.b[0]) + r - x0) / CELL)];
    const [j0, j1] = [Math.floor((Math.min(w.a[1], w.b[1]) - r - y0) / CELL), Math.ceil((Math.max(w.a[1], w.b[1]) + r - y0) / CELL)];
    for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
      for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) {
        if (segDist(centre(i, j), w.a, w.b).d <= r) grid[j * nx + i] = WALL;
      }
    }
  }
  // Flood from the border: outside
  const flood = (seeds, label, open) => {
    const stack = [...seeds];
    const cells = [];
    while (stack.length) {
      const k = stack.pop();
      if (grid[k] !== 0) continue;
      grid[k] = label;
      cells.push(k);
      const [i, j] = [k % nx, Math.floor(k / nx)];
      if (i > 0) stack.push(k - 1);
      if (i < nx - 1) stack.push(k + 1);
      if (j > 0) stack.push(k - nx);
      if (j < ny - 1) stack.push(k + nx);
      if (open) open(k);
    }
    return cells;
  };
  const border = [];
  for (let i = 0; i < nx; i++) border.push(i, (ny - 1) * nx + i);
  for (let j = 0; j < ny; j++) border.push(j * nx, j * nx + nx - 1);
  flood(border, OUT);
  // Each enclosed space is a room
  const regions = [];
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] !== 0) continue;
    const label = regions.length + 1;
    const cells = flood([k], label);
    regions.push({ label, cells });
  }
  // Grow the rooms into the walls, about up to their centre lines (rooms on both sides
  // grow at the same pace, so they meet in the middle)
  const owner = new Int32Array(grid);
  let frontier = regions.flatMap((r) => r.cells);
  const steps = Math.ceil(Math.max(...floor.walls.map((w) => w.thickness)) / 2 / CELL);
  for (let s = 0; s < steps && frontier.length; s++) {
    const next = [];
    for (const k of frontier) {
      const [i, j] = [k % nx, Math.floor(k / nx)];
      for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1]) {
        if (n >= 0 && owner[n] === WALL) {
          owner[n] = owner[k];
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  const rooms = [];
  for (const r of regions) {
    if (r.cells.length * CELL * CELL < MIN_ROOM_AREA) continue;
    const outline = traceOutline(owner, nx, ny, r.label).map(([i, j]) => [x0 + i * CELL, y0 + j * CELL]);
    const pts2 = simplifyLoop(outline, CELL * 1.2).map((p) => [round(p[0], 3), round(p[1], 3)]);
    if (pts2.length < 3 || area(pts2) < MIN_ROOM_AREA) continue;
    rooms.push({ id: uid(), name: t("Room {n}", { n: rooms.length + 1 }), points: pts2, color: "#8ab4f8",
      area_id: null, entity_id: null, sensor_entity_id: null });
  }
  return rooms;
}

/** Longest boundary loop (grid corner coordinates) of the cells labelled `label`. */
function traceOutline(grid, nx, ny, label) {
  const at = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && grid[j * nx + i] === label;
  // Directed boundary edges with the region on the left: start corner -> end corner
  const edges = new Map();
  const add = (a, b) => {
    const k = `${a[0]},${a[1]}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(b);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add([i + 1, j], [i, j]);
      if (!at(i, j + 1)) add([i, j + 1], [i + 1, j + 1]);
      if (!at(i - 1, j)) add([i, j], [i, j + 1]);
      if (!at(i + 1, j)) add([i + 1, j + 1], [i + 1, j]);
    }
  }
  let best = [];
  while (edges.size) {
    const [startKey] = edges.keys();
    const loop = [];
    let k = startKey;
    while (edges.has(k)) {
      const list = edges.get(k);
      const b = list.pop();
      if (!list.length) edges.delete(k);
      loop.push(k.split(",").map(Number));
      k = `${b[0]},${b[1]}`;
      if (k === startKey) break;
    }
    if (loop.length > best.length) best = loop;
  }
  // Drop points in the middle of straight runs
  return best.filter((p, i) => {
    const a = best[(i - 1 + best.length) % best.length];
    const b = best[(i + 1) % best.length];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

/** Put the floor's top-left corner at (1, 1) and round coordinates to millimetres. */
function shift(floor) {
  const pts = floor.walls.flatMap((w) => [w.a, w.b]);
  const dx = 1 - Math.min(...pts.map((p) => p[0]));
  const dy = 1 - Math.min(...pts.map((p) => p[1]));
  const mv = (p) => [round(p[0] + dx, 3), round(p[1] + dy, 3)];
  for (const w of floor.walls) [w.a, w.b] = [mv(w.a), mv(w.b)];
  for (const r of floor.rooms) r.points = r.points.map(mv);
  for (const f of floor.furniture) [f.x, f.y] = mv([f.x, f.y]);
}
