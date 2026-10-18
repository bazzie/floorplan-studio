// Lamp light without real-time lights, for the light quality profile (slow GPUs).
//
// Real lights are costly on a weak GPU: every pixel is lit once per lamp and looked up in
// every lamp's shadow map, and each shadow map draws the scene again. Here the lamps' light
// is worked out on the CPU instead, once per lamp change:
//  - floors and the inner faces of walls get a fine grid (one mesh per floor, drawn over
//    them); its corners know which lamps reach them: light stops at walls and gets through
//    doors and windows (a line from the lamp to the corner, in plan, may only cross a wall
//    where an opening is, at a height inside it). The light itself (distance, a spot's cone,
//    the angle it falls at) is worked out per pixel for the first few lamps, so a spot's
//    pool keeps a clean edge; more lamps than that are added up on the corners,
//  - each piece of furniture, door and window gets the light at its middle, added to its
//    colour,
//  - the same grid darkens the floor along walls and under furniture (contact shadows).
// The rest of the scene is drawn with a cheap material (Lambert: no reflections) under the
// sky and the sun, without shadow maps. Which corners a lamp reaches, and how much, is
// kept per lamp, so switching or dimming one only adds up numbers.
//
// Coordinates are a floor's own: x and z are plan x and y, y is the height above its floor.

const GRID = 0.2; // grid spacing on floors (m)
const WALL_GRID = 0.25; // and on walls
const LIFT = 0.006; // the grid lies this far in front of the surface
const LAMP_SIZE = 0.3; // light stops getting stronger closer than this (as in view3d.js)
const DECAY = 1.6;
const FURNITURE_FACING = 0.45;
const SLOTS = 8; // lamps per floor whose light is worked out per pixel (the rest on the grid)
const MAX_PIECE_LIGHT = 0.9; // most lamp light on a piece of furniture (see update) // a piece's faces turn every way: about this much of the light lands
const WALL_SHADE = 0.22; // darkening of the floor right against a wall
const WALL_SHADE_REACH = 0.35;
const FOOT_SHADE = 0.32; // ... and under a piece of furniture
const FOOT_SHADE_REACH = 0.14;

// ---------- materials ----------

/**
 * three.js with MeshStandardMaterial (and MeshPhysicalMaterial) swapped for a Lambert
 * material that takes the same options: the views and the furniture builder create their
 * materials through it, so the light profile needs no changes there.
 */
export function liteThree(THREE) {
  class LiteMaterial extends THREE.MeshLambertMaterial {
    constructor(params = {}) {
      // eslint-disable-next-line no-unused-vars
      const { roughness, metalness, roughnessMap, metalnessMap, envMapIntensity, clearcoat, transmission, ior, ...rest } = params;
      super(rest);
      // (set later by some parts; kept so the code that sets them still works)
      this.roughness = roughness ?? 1;
      this.metalness = metalness ?? 0;
    }
  }
  return { ...THREE, MeshStandardMaterial: LiteMaterial, MeshPhysicalMaterial: LiteMaterial };
}

/**
 * Add lamp light to a Lambert material: `uniform` ({ value: Color }) is the light falling on
 * the piece (already divided by π), multiplied by the surface's own colour.
 */
export function addLampLight(material, uniform) {
  if (!material?.isMeshLambertMaterial) return;
  // (a material shared by several pieces takes the light of the last one)
  const patched = lampLights.has(material);
  lampLights.set(material, uniform);
  if (patched) return;
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.uLampLight = lampLights.get(material);
    shader.fragmentShader = `uniform vec3 uLampLight;\n${shader.fragmentShader}`.replace(
      "#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uLampLight;");
  };
  material.customProgramCacheKey = () => `${key?.call(material) ?? ""}|fps-lamp`;
  material.needsUpdate = true;
}
const lampLights = new WeakMap(); // material -> its lamp light uniform

// ---------- what stops light ----------

/**
 * The walls of a floor as light blockers: centre line (lengthened by half the thickness at
 * both ends, so no light slips past a corner) and the openings in it.
 * pieces(wall) gives { openings: [{ from, to, sill, top }], length } (model.js wallPieces).
 */
export function lightBlockers(floor, pieces) {
  return floor.walls.map((w) => {
    const { openings, length } = pieces(w);
    const half = (w.thickness || 0.15) / 2;
    if (length < 1e-4) return null;
    const ux = (w.b[0] - w.a[0]) / length;
    const uy = (w.b[1] - w.a[1]) / length;
    const ax = w.a[0] - ux * half;
    const ay = w.a[1] - uy * half;
    return {
      ax, ay, dx: ux * (length + 2 * half), dy: uy * (length + 2 * half), len: length + 2 * half,
      gaps: openings.filter((o) => o.to - o.from > 0.05 && o.top - o.sill > 0.05)
        .map((o) => ({ s0: o.from + half, s1: o.to + half, y0: o.sill, y1: o.top })),
      minX: Math.min(w.a[0], w.b[0]) - half, maxX: Math.max(w.a[0], w.b[0]) + half,
      minY: Math.min(w.a[1], w.b[1]) - half, maxY: Math.max(w.a[1], w.b[1]) + half,
    };
  }).filter(Boolean);
}

/** Does light get from p to q (floor coordinates [x, y, z]) without going through a wall? */
function reaches(blockers, p, q) {
  const ex = q[0] - p[0];
  const ez = q[2] - p[2];
  const minX = Math.min(p[0], q[0]);
  const maxX = Math.max(p[0], q[0]);
  const minZ = Math.min(p[2], q[2]);
  const maxZ = Math.max(p[2], q[2]);
  for (const b of blockers) {
    if (b.maxX < minX || b.minX > maxX || b.maxY < minZ || b.minY > maxZ) continue;
    const den = ex * b.dy - ez * b.dx;
    if (Math.abs(den) < 1e-12) continue; // parallel
    const wx = b.ax - p[0];
    const wz = b.ay - p[2];
    const t = (wx * b.dy - wz * b.dx) / den; // along p -> q
    if (t <= 1e-6 || t >= 1 - 1e-6) continue;
    const s = (wx * ez - wz * ex) / den; // along the wall
    if (s < 0 || s > 1) continue;
    const along = s * b.len;
    const y = p[1] + (q[1] - p[1]) * t;
    if (!b.gaps.some((g) => along >= g.s0 && along <= g.s1 && y >= g.y0 && y <= g.y1)) return false;
  }
  return true;
}

// ---------- how much light ----------

/**
 * A lamp as the baker uses it (floor coordinates): { pos: [x, y, z], dir: unit [x, y, z],
 * distance, cosOuter, cosInner (spot cone; null for light all round), power (scale on its
 * intensity: a wide lamp lit all round gives the share its cone would) }.
 */
function lampFactor(lamp, q, normal, facing) {
  const lx = lamp.pos[0] - q[0];
  const ly = lamp.pos[1] - q[1];
  const lz = lamp.pos[2] - q[2];
  const d = Math.hypot(lx, ly, lz);
  if (d >= lamp.distance || d < 1e-4) return 0;
  const ndl = normal ? (normal[0] * lx + normal[1] * ly + normal[2] * lz) / d : facing;
  if (ndl <= 0) return 0;
  let spot = 1;
  if (lamp.cosOuter !== null) {
    const c = -(lamp.dir[0] * lx + lamp.dir[1] * ly + lamp.dir[2] * lz) / d;
    if (c <= lamp.cosOuter) return 0;
    const k = Math.min(1, (c - lamp.cosOuter) / Math.max(1e-4, lamp.cosInner - lamp.cosOuter));
    spot = k * k * (3 - 2 * k);
  }
  const cut = Math.max(0, 1 - (d / lamp.distance) ** 4) ** 2;
  return (lamp.power * ndl * spot * cut) / Math.max(d, LAMP_SIZE) ** DECAY / Math.PI;
}

// ---------- the light grid of a floor ----------

export class LightSurface {
  constructor(THREE, blockers) {
    this.THREE = THREE;
    this.blockers = blockers;
    this.pos = []; // x, y, z per corner
    this.normal = []; // facing per corner
    this.albedo = []; // linear colour of the surface under it
    this.shade = []; // contact shadow 0..1
    this.index = [];
    this.probes = []; // furniture: { pos, uniform, skip (its own lamp's id) }
    this.cache = new Map(); // lamp key -> { idx, w } (corners), { pw } (probes)
  }

  _corner(x, y, z, n, albedo, shade) {
    this.pos.push(x, y, z);
    this.normal.push(...n);
    this.albedo.push(albedo.r, albedo.g, albedo.b);
    this.shade.push(shade);
    return this.pos.length / 3 - 1;
  }

  /**
   * The floor: grid cells with a corner inside one of the rooms (so the grid reaches under
   * the walls; their own geometry hides that part), at that room's height. at(x, z) gives
   * { y, albedo } of the room there, or null; skip(x, z) leaves out a cell (a stairwell);
   * shadeAt(x, z) the contact shadow.
   */
  addFloor(bounds, at, skip, shadeAt) {
    const i0 = Math.floor(bounds.minX / GRID) - 1;
    const j0 = Math.floor(bounds.minY / GRID) - 1;
    const ni = Math.ceil(bounds.maxX / GRID) + 1 - i0;
    const nj = Math.ceil(bounds.maxY / GRID) + 1 - j0;
    const info = new Array((ni + 1) * (nj + 1));
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) info[j * (ni + 1) + i] = at((i0 + i) * GRID, (j0 + j) * GRID);
    }
    const ids = new Map();
    const corner = (i, j, near) => {
      const k = j * (ni + 1) + i;
      if (!ids.has(k)) {
        const [x, z] = [(i0 + i) * GRID, (j0 + j) * GRID];
        const own = info[k] || near; // a corner just outside the rooms: like its neighbour
        ids.set(k, this._corner(x, own.y + LIFT, z, [0, 1, 0], own.albedo, shadeAt(x, z)));
      }
      return ids.get(k);
    };
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const cs = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const near = cs.map(([a, b]) => info[b * (ni + 1) + a]).find(Boolean);
        if (!near || skip((i0 + i + 0.5) * GRID, (j0 + j + 0.5) * GRID)) continue;
        const [a, b, c, d] = cs.map(([x, y]) => corner(x, y, near));
        this.index.push(a, c, b, a, d, c);
      }
    }
  }

  /**
   * One face of a wall piece: from `start` [x, z] along `u` for `length`, between heights
   * y0 and y1, facing `n` [x, z]; albedoAt(s) the finish's colour at s along it.
   */
  addWallFace(start, u, n, length, y0, y1, albedoAt) {
    if (length < 0.02 || y1 - y0 < 0.02) return;
    const ns = Math.max(1, Math.ceil(length / WALL_GRID));
    const ny = Math.max(1, Math.ceil((y1 - y0) / WALL_GRID));
    const base = this.pos.length / 3;
    for (let a = 0; a <= ns; a++) {
      const s = (length * a) / ns;
      const albedo = albedoAt(Math.min(length - 0.01, Math.max(0.01, s)));
      for (let b = 0; b <= ny; b++) {
        const y = y0 + ((y1 - y0) * b) / ny;
        // (a little darker where the wall meets the floor)
        this._corner(start[0] + u[0] * s + n[0] * LIFT, y, start[1] + u[1] * s + n[1] * LIFT, [n[0], 0, n[1]], albedo, y0 <= 0.01 && b === 0 ? 0.12 : 0);
      }
    }
    // Which way round the triangles go doesn't matter (drawn from both sides)
    for (let a = 0; a < ns; a++) {
      for (let b = 0; b < ny; b++) {
        const p = base + a * (ny + 1) + b;
        this.index.push(p, p + ny + 1, p + 1, p + 1, p + ny + 1, p + ny + 2);
      }
    }
  }

  /** A piece of furniture: the light at `pos` ([x, y, z]) goes into `uniform`; `skip` is its own lamp. */
  addProbe(pos, uniform, skip) {
    this.probes.push({ pos, uniform, skip });
  }

  /** The mesh (null when there's nothing to light). */
  build() {
    const THREE = this.THREE;
    if (!this.index.length) return null;
    const count = this.pos.length / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.normal, 3));
    const surf = new Float32Array(count * 4); // albedo and contact shadow
    for (let i = 0; i < count; i++) {
      surf.set(this.albedo.slice(i * 3, i * 3 + 3), i * 4);
      surf[i * 4 + 3] = this.shade[i];
    }
    geo.setAttribute("surf", new THREE.BufferAttribute(surf, 4));
    this.bake = new Float32Array(count * 3);
    geo.setAttribute("bake", new THREE.BufferAttribute(this.bake, 3));
    this.vis = [new Float32Array(count * 4), new Float32Array(count * 4)];
    geo.setAttribute("vis0", new THREE.BufferAttribute(this.vis[0], 4));
    geo.setAttribute("vis1", new THREE.BufferAttribute(this.vis[1], 4));
    geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
    geo.computeBoundingSphere();
    this.geo = geo;
    const slots = (make) => Array.from({ length: SLOTS }, make);
    this.uniforms = {
      uAmbient: { value: 0 },
      uCount: { value: 0 },
      uPos: { value: slots(() => new THREE.Vector3()) },
      uDir: { value: slots(() => new THREE.Vector3()) },
      uColor: { value: slots(() => new THREE.Vector3()) },
      uParam: { value: slots(() => new THREE.Vector4()) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `attribute vec4 surf; attribute vec3 bake; attribute vec4 vis0; attribute vec4 vis1;
        varying vec3 vPos; varying vec3 vNormal; varying vec4 vSurf; varying vec3 vBake; varying vec4 vVis0; varying vec4 vVis1;
        void main() {
          vPos = position; vNormal = normal; vSurf = surf; vBake = bake; vVis0 = vis0; vVis1 = vis1;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // The light of the lamps in the slots is worked out per pixel (so a spot's cone keeps
      // a clean edge); the grid only says how much of each lamp gets to a corner (walls).
      // Then as on the CPU: what the light adds on top of sky and sun, as the screen shows it.
      fragmentShader: `uniform float uAmbient; uniform int uCount;
        uniform vec3 uPos[${SLOTS}]; uniform vec3 uDir[${SLOTS}]; uniform vec3 uColor[${SLOTS}]; uniform vec4 uParam[${SLOTS}];
        varying vec3 vPos; varying vec3 vNormal; varying vec4 vSurf; varying vec3 vBake; varying vec4 vVis0; varying vec4 vVis1;
        vec3 toScreen(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
        }
        void main() {
          vec3 light = vBake;
          vec3 n = normalize(vNormal);
          for (int i = 0; i < ${SLOTS}; i++) {
            if (i >= uCount) break;
            float seen = i < 4 ? vVis0[i] : vVis1[i - 4];
            if (seen <= 0.001) continue;
            vec4 p = uParam[i]; // reach, cos of the cone's edge (-2: all round), cos of its full part
            vec3 l = uPos[i] - vPos;
            float d = length(l);
            if (d >= p.x) continue;
            l /= d;
            float facing = dot(n, l);
            if (facing <= 0.0) continue;
            float cone = p.y < -1.5 ? 1.0 : smoothstep(p.y, p.z, dot(-l, uDir[i]));
            float cut = 1.0 - pow(d / p.x, 4.0);
            light += uColor[i] * (seen * facing * cone * cut * cut / pow(max(d, ${LAMP_SIZE.toFixed(2)}), ${DECAY.toFixed(2)}) / 3.14159265);
          }
          vec3 base = min(vSurf.rgb * uAmbient, vec3(1.0));
          vec3 lit = min(base + vSurf.rgb * light, vec3(1.0));
          gl_FragColor = vec4(max(toScreen(lit) - toScreen(base), vec3(0.0)), vSurf.a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // the lamp light is added, the contact shadow darkens what's there
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 1;
    this.mesh.raycast = () => {}; // not something to tap
    this.mesh.userData.lightSurface = true;
    return this.mesh;
  }

  /**
   * Which corners a lamp gets to (within reach, not behind a wall: `idx`), how much light
   * lands there (`w`, for lamps added up on the grid) and on each piece (`pw`). Kept per lamp.
   */
  _weights(lamp) {
    let c = this.cache.get(lamp.key);
    if (c) return c;
    const idx = [];
    const w = [];
    const n = this.pos.length / 3;
    const q = [0, 0, 0];
    const normal = [0, 0, 0];
    const near = this.blockers.filter((b) => {
      // walls the lamp's light could reach at all
      const t = Math.max(0, Math.min(1, ((lamp.pos[0] - b.ax) * b.dx + (lamp.pos[2] - b.ay) * b.dy) / (b.len * b.len)));
      return Math.hypot(lamp.pos[0] - (b.ax + b.dx * t), lamp.pos[2] - (b.ay + b.dy * t)) < lamp.distance;
    });
    // (a little past its reach too, so the light fades out smoothly between corners)
    const reach = lamp.distance + WALL_GRID;
    for (let i = 0; i < n; i++) {
      q[0] = this.pos[i * 3]; q[1] = this.pos[i * 3 + 1]; q[2] = this.pos[i * 3 + 2];
      if (Math.hypot(q[0] - lamp.pos[0], q[1] - lamp.pos[1], q[2] - lamp.pos[2]) >= reach) continue;
      if (!reaches(near, lamp.pos, q)) continue;
      normal[0] = this.normal[i * 3]; normal[1] = this.normal[i * 3 + 1]; normal[2] = this.normal[i * 3 + 2];
      idx.push(i);
      w.push(lampFactor(lamp, q, normal, 0));
    }
    const pw = this.probes.map((p) => (p.skip === lamp.id ? 0 : lampFactor(lamp, p.pos, null, FURNITURE_FACING) || 0))
      .map((f, k) => (f > 1e-4 && reaches(near, lamp.pos, this.probes[k].pos) ? f : 0));
    c = { idx: Uint32Array.from(idx), w: Float32Array.from(w), pw };
    this.cache.set(lamp.key, c);
    return c;
  }

  /**
   * Light the grid and the furniture for the lamps that are on: lamps [{ ...lamp, key, id,
   * color: linear [r, g, b] times intensity }]. The first SLOTS (spots first: their cone
   * needs a clean edge, then the brightest) are worked out per pixel, the rest on the grid.
   * `ambient` is about how bright the sky and sun make the surfaces (linear, 0..1): the grid
   * adds what the lamps add on top of that, as the screen shows it.
   */
  update(lamps, ambient) {
    for (const p of this.probes) p.uniform.value.setRGB(0, 0, 0);
    const strength = (l) => Math.max(...l.color) * l.power;
    const order = [...lamps].sort((a, b) => (a.cosOuter === null) - (b.cosOuter === null) || strength(b) - strength(a));
    if (this.bake) {
      this.bake.fill(0);
      this.vis[0].fill(0);
      this.vis[1].fill(0);
    }
    order.forEach((lamp, k) => {
      const { idx, w, pw } = this._weights(lamp);
      const [r, g, b] = lamp.color;
      pw.forEach((f, i) => {
        if (!f) return;
        const c = this.probes[i].uniform.value;
        c.r += r * f;
        c.g += g * f;
        c.b += b * f;
      });
      if (!this.bake) return;
      if (k < SLOTS) {
        const vis = this.vis[k >> 2];
        for (let i = 0; i < idx.length; i++) vis[idx[i] * 4 + (k & 3)] = 1;
        const u = this.uniforms;
        u.uPos.value[k].set(...lamp.pos);
        u.uDir.value[k].set(...lamp.dir);
        u.uColor.value[k].set(r * lamp.power, g * lamp.power, b * lamp.power);
        u.uParam.value[k].set(lamp.distance, lamp.cosOuter ?? -2, lamp.cosInner, 0);
      } else {
        for (let i = 0; i < idx.length; i++) {
          const v = idx[i] * 3;
          this.bake[v] += r * w[i];
          this.bake[v + 1] += g * w[i];
          this.bake[v + 2] += b * w[i];
        }
      }
    });
    // A piece right under a lamp: no more light than turns a white surface white (more
    // only pushes a coloured one, like wood, to its brightest, most saturated hue)
    for (const p of this.probes) {
      const c = p.uniform.value;
      const top = Math.max(c.r, c.g, c.b);
      if (top > MAX_PIECE_LIGHT) c.multiplyScalar(MAX_PIECE_LIGHT / top);
    }
    if (!this.bake) return;
    this.uniforms.uCount.value = Math.min(SLOTS, order.length);
    this.uniforms.uAmbient.value = ambient;
    for (const name of ["bake", "vis0", "vis1"]) this.geo.attributes[name].needsUpdate = true;
  }
}

// ---------- contact shadows ----------

/**
 * Contact shadow on the floor at (x, z): darker along walls and under furniture that stands
 * on the floor. walls: the floor's walls; feet: [{ x, y, w, d, rotation }] footprints.
 */
export function contactShade(walls, feet) {
  return (x, z) => {
    let s = 0;
    for (const w of walls) {
      const dx = w.b[0] - w.a[0];
      const dy = w.b[1] - w.a[1];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - w.a[0]) * dx + (z - w.a[1]) * dy) / len2));
      const d = Math.hypot(x - (w.a[0] + t * dx), z - (w.a[1] + t * dy)) - (w.thickness || 0.15) / 2;
      if (d < WALL_SHADE_REACH) s = Math.max(s, WALL_SHADE * (1 - Math.max(0, d) / WALL_SHADE_REACH));
    }
    for (const f of feet) {
      const a = ((f.rotation || 0) * Math.PI) / 180;
      const [cx, cz] = [x - f.x, z - f.y];
      // into the piece's own axes (plan rotation is clockwise, see toWorld)
      const lx = Math.abs(cx * Math.cos(a) + cz * Math.sin(a)) - f.w / 2;
      const lz = Math.abs(-cx * Math.sin(a) + cz * Math.cos(a)) - f.d / 2;
      const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
      if (d < FOOT_SHADE_REACH) s = Math.max(s, FOOT_SHADE * Math.min(1, (FOOT_SHADE_REACH - d) / FOOT_SHADE_REACH));
    }
    return s;
  };
}
