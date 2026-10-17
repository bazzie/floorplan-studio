// Roof geometry, shared by the plan (ridge lines) and the 3D view (surfaces).
// Heights are relative to the top of the walls the roof rests on; the roof's
// outline follows those walls and the overhang is added around it.
//
//   hip:   every eave slopes up; each face is the part of the roof nearest to its
//          eave (exact for convex outlines; split L-shapes into several roofs)
//   gable: two faces meeting at a ridge along the long side (or across, when
//          `ridge_turned`), with upright gable walls at the ends
//   shed:  one face rising from one long side to the other, with walls under it
//   flat:  a level roof

export const ROOF_TYPES = { gable: "Gable (zadeldak)", hip: "Hip (schilddak)", shed: "Shed / lean-to (lessenaarsdak)", flat: "Flat" };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);

/** The outline counter-clockwise (in plan coordinates, y down), without repeated points. */
function ccw(points) {
  const pts = points.filter((p, i) => len(sub(p, points[(i + 1) % points.length])) > 1e-6);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a > 0 ? pts : [...pts].reverse(); // (plan y points down: positive area = inward normals on the left)
}

/** Inward unit normal of edge a->b of a ccw polygon. */
const inward = (a, b) => {
  const d = sub(b, a);
  const l = len(d) || 1;
  return [-d[1] / l, d[0] / l];
};

/** Polygon grown outward by `o` (each edge moved out, corners re-intersected). */
function offset(pts, o) {
  if (!o) return pts.map((p) => [...p]);
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const m = inward(a, b);
    return { p: [a[0] - m[0] * o, a[1] - m[1] * o], d: sub(b, a) };
  });
  return lines.map((L, i) => {
    const P = lines[(i - 1 + n) % n];
    const den = P.d[0] * L.d[1] - P.d[1] * L.d[0];
    if (Math.abs(den) < 1e-9) return L.p;
    const t = ((L.p[0] - P.p[0]) * L.d[1] - (L.p[1] - P.p[1]) * L.d[0]) / den;
    return [P.p[0] + P.d[0] * t, P.p[1] + P.d[1] * t];
  });
}

/** Keep the part of polygon `poly` where f(p) <= 0 (f linear). */
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Rectangle around the outline, aligned with its longest edge: origin, axes, extents. */
function frame(pts, turned) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const d = sub(pts[(i + 1) % pts.length], pts[i]);
    if (!best || len(d) > len(best)) best = d;
  }
  const ext = (axis) => [Math.min(...pts.map((p) => dot(p, axis))), Math.max(...pts.map((p) => dot(p, axis)))];
  const perp = (a) => [-a[1], a[0]];
  let u = [best[0] / len(best), best[1] / len(best)];
  const [eu, ev] = [ext(u), ext(perp(u))];
  // The ridge runs along the long side, unless turned
  if ((eu[1] - eu[0] >= ev[1] - ev[0]) === !!turned) u = perp(u);
  const v = perp(u);
  const [u0, u1] = ext(u);
  const [v0, v1] = ext(v);
  return { u, v, u0, u1, v0, v1, at: (a, b) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b] };
}

/**
 * Roof surfaces. Returns
 *   faces:  [{ pts: [[x, y, z]...] (convex, ccw from above), slope: [dx, dy] (uphill unit
 *            vector in plan), along: [dx, dy] }]
 *   walls:  upright gable / shed walls [[x, y, z]...]
 *   edges:  eave and verge lines for fascia boards [[x, y, z], [x, y, z]]
 *   lines:  ridge and hip lines for the plan [[x, y], [x, y]]
 *   outline: the roof's outer edge in plan (with overhang)
 */
export function roofGeometry(roof) {
  const P = ccw(roof.points);
  const o = Math.max(0, roof.overhang ?? 0.3);
  const type = roof.type || "gable";
  const t = type === "flat" ? 0 : Math.tan((Math.min(75, Math.max(0, roof.pitch ?? 35)) * Math.PI) / 180);
  const out = { faces: [], walls: [], edges: [], lines: [], outline: [] };
  if (P.length < 3) return out;

  if (type === "hip" || type === "flat") {
    const Q = offset(P, o);
    out.outline = Q;
    if (type === "flat" || t === 0) {
      out.faces.push({ pts: Q.map((p) => [p[0], p[1], 0]), slope: [0, 0], along: [1, 0] });
      for (let i = 0; i < Q.length; i++) out.edges.push([[...Q[i], 0], [...Q[(i + 1) % Q.length], 0]]);
      return out;
    }
    const n = Q.length;
    const edge = Q.map((a, i) => ({ a, b: Q[(i + 1) % n], m: inward(a, Q[(i + 1) % n]) }));
    const d = (k, p) => dot(edge[k].m, sub(p, edge[k].a)); // distance in from eave k
    edge.forEach((E, i) => {
      let face = Q;
      for (let j = 0; j < n && face.length >= 3; j++) {
        if (j !== i) face = clip(face, (p) => d(i, p) - d(j, p));
      }
      if (face.length < 3) return;
      const z = (p) => (d(i, p) - o) * t;
      out.faces.push({ pts: face.map((p) => [p[0], p[1], z(p)]), slope: E.m, along: sub(E.b, E.a).map((x) => x / len(sub(E.b, E.a))) });
      out.edges.push([[...E.a, -o * t], [...E.b, -o * t]]);
      // Ridge / hip lines: face edges that aren't on the eave
      for (let k = 0; k < face.length; k++) {
        const p = face[k];
        const q = face[(k + 1) % face.length];
        if (Math.abs(d(i, p)) > 1e-6 || Math.abs(d(i, q)) > 1e-6) out.lines.push([p, q]);
      }
    });
    return out;
  }

  // Gable and shed: on the outline's aligned rectangle
  const F = frame(P, roof.ridge_turned);
  let [a0, a1, b0, b1] = [F.u0 - o, F.u1 + o, F.v0 - o, F.v1 + o];
  out.outline = [F.at(a0, b0), F.at(a1, b0), F.at(a1, b1), F.at(a0, b1)];
  const pt = (a, b, z) => [...F.at(a, b), z];
  if (type === "shed") {
    // Low eave at v0, rising to v1 (or the other way round when flipped)
    if (roof.flipped) {
      const turn = (x) => x.map((c) => -c);
      Object.assign(F, { u: turn(F.u), v: turn(F.v), u0: -F.u1, u1: -F.u0, v0: -F.v1, v1: -F.v0 });
      F.at = (a, b) => [F.u[0] * a + F.v[0] * b, F.u[1] * a + F.v[1] * b];
      [a0, a1, b0, b1] = [F.u0 - o, F.u1 + o, F.v0 - o, F.v1 + o];
    }
    const z = (b) => (b - F.v0) * t;
    out.faces.push({ pts: [pt(a0, b0, z(b0)), pt(a1, b0, z(b0)), pt(a1, b1, z(b1)), pt(a0, b1, z(b1))], slope: F.v, along: F.u });
    out.walls.push([pt(F.u0, F.v0, 0), pt(F.u0, F.v1, 0), pt(F.u0, F.v1, z(F.v1))]);
    out.walls.push([pt(F.u1, F.v0, 0), pt(F.u1, F.v1, 0), pt(F.u1, F.v1, z(F.v1))]);
    out.walls.push([pt(F.u0, F.v1, 0), pt(F.u1, F.v1, 0), pt(F.u1, F.v1, z(F.v1)), pt(F.u0, F.v1, z(F.v1))]);
    out.edges.push([pt(a0, b0, z(b0)), pt(a1, b0, z(b0))], [pt(a0, b1, z(b1)), pt(a1, b1, z(b1))],
      [pt(a0, b0, z(b0)), pt(a0, b1, z(b1))], [pt(a1, b0, z(b0)), pt(a1, b1, z(b1))]);
    return out;
  }
  // Gable: ridge along u, halfway across
  const vm = (F.v0 + F.v1) / 2;
  const h = (vm - F.v0) * t;
  const eave = -o * t;
  const neg = (v) => v.map((x) => -x);
  out.faces.push({ pts: [pt(a0, b0, eave), pt(a1, b0, eave), pt(a1, vm, h), pt(a0, vm, h)], slope: F.v, along: F.u });
  out.faces.push({ pts: [pt(a1, b1, eave), pt(a0, b1, eave), pt(a0, vm, h), pt(a1, vm, h)], slope: neg(F.v), along: neg(F.u) });
  out.walls.push([pt(F.u0, F.v0, 0), pt(F.u0, F.v1, 0), pt(F.u0, vm, h)]);
  out.walls.push([pt(F.u1, F.v1, 0), pt(F.u1, F.v0, 0), pt(F.u1, vm, h)]);
  out.edges.push([pt(a0, b0, eave), pt(a1, b0, eave)], [pt(a0, b1, eave), pt(a1, b1, eave)],
    [pt(a0, b0, eave), pt(a0, vm, h)], [pt(a0, vm, h), pt(a0, b1, eave)],
    [pt(a1, b0, eave), pt(a1, vm, h)], [pt(a1, vm, h), pt(a1, b1, eave)]);
  out.lines.push([F.at(a0, vm), F.at(a1, vm)]);
  return out;
}

/** Height of the ridge above the wall tops (for labels and bounds). */
export const roofHeight = (roof) => Math.max(0, ...roofGeometry(roof).faces.flatMap((f) => f.pts.map((p) => p[2])));
