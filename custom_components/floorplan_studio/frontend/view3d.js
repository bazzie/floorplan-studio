// 3D dollhouse view of all floors (three.js + OrbitControls).
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { currentLanguage, t } from "./i18n.js";
import { needsMeasurement, quality, qualityMode, setMeasuredQuality, setSlowInUse } from "./quality.js";
import {
  soundArea,
  COMPASS_STYLE,
  PLAYING_STYLE,
  activeColor,
  activeLight,
  brightness,
  domainOf,
  compassSvg,
  createStateIcon,
  escapeHtml,
  formatState,
  isActive,
  isPlaying,
  surroundLevel,
  TapSorter,
  cameraAlerts,
  doubleTapHandler,
  cameraFloodlight,
  heatLevel,
  isHeating,
  isScreenOn,
  hassChanged,
  laundryState,
  isUnavailable,
  pointInPolygon,
  polygonArea,
  labelPoint,
  polygonCenter,
  projectOnSegment,
  roomHighlight,
  roomLabelEntity,
  roomTapEntity,
  runTapAction,
  stackFloors,
  wallPieces,
  readPref,
  writePref,
} from "./model.js";

const HOT = new THREE.Color("#ff5a2c"); // a heating radiator warms up towards this
import { baseHeight, beamHalfAngle, buildFurniture3D, catalogItem, containsPoint, lightAnchor, lightDirection, mergeSlices, pieceSounding, toWorld, tvSource } from "./furniture.js";
import { ROOF_MATERIALS, finishMaterial, floorFinish, isOutdoor, roofFinish, wallFinish } from "./materials.js";
import { roofGeometry } from "./roof.js";
import { createArtwork, createDeviceDisplay, createTvScreen } from "./tvscreen.js";
import { robotBusy, robotPose } from "./robot.js";
import { LightSurface, addLampLight, contactShade, lightBlockers, liteThree } from "./bakedlight.js";

// three.js with cheaper materials, for the light profile (see bakedlight.js)
const LITE = liteThree(THREE);

/**
 * Give a box world-scale UVs (metres) so textures keep their real size; along
 * the wall the coordinate continues across pieces so bricks/planks line up.
 */
function worldUVs(geo, sx, sy, sz, from, to, bottom) {
  const uv = geo.attributes.uv;
  // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let i = f * 4; i < f * 4 + 4; i++) {
      let u = uv.getX(i) * dims[f][0];
      const v = uv.getY(i) * dims[f][1] + (f >= 4 || f <= 1 ? bottom : 0);
      if (f === 4) u += from;
      if (f === 5) u -= to;
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;
}

/** Furniture that acts as a lamp: a lamp from the catalog, or anything linked to a light. */
const isLampFurniture = (f) => !!f.entity_id && domainOf(f.entity_id) === "light";

const LOW_WALL = 1.0;
const PULSE_PERIOD = 1600; // ms, same rhythm as the 2D markers
const DOOR_OPEN_ANGLE = 1.48; // radians (~85°)
const DOOR_SWING_TIME = 0.6; // seconds for a full open/close
const FRAME = 0.05; // door frame (jamb/head) width in metres
const WINDOW_OPEN_ANGLE = 0.7; // radians (~40°)
const WINDOW_FRAME = 0.06;
const SASH = 0.045; // sash frame width
const DOUBLE_SASH_FROM = 1.2; // inner width (m) from which a window gets two sashes
const easeInOut = (t) => t * t * (3 - 2 * t);
const NIGHT_SKY = 0x0b1020;
const NIGHT_GROUND = 0x15171c;
const DUSK_SUN = 0xffa860;
const DUSK_SKY = 0xf0c9a8;
const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const FLY_MS = 450; // camera flight on double-tap
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Real light sources; WebGL cost grows with each one. Lamps share a pool of this
// many lights, handed to the lamps that are on (brightest first), so a plan can
// hold any number of lamps. Lights cast shadows (budget permitting) so walls stop
// them; shadow maps are only redrawn when the scene or a state changes.
const MAX_LIGHTS = 16;

// Lamps aren't points: a shade or frosted globe spreads its light, so a wall right next to
// a lamp doesn't flare up the way it would beside a point light. Light stops getting
// stronger closer than LAMP_SIZE (m) to a lamp.
const LAMP_SIZE = 0.3;
{
  const from = "max( pow( lightDistance, decayExponent ), 0.01 )";
  if (THREE.ShaderChunk.lights_pars_begin.includes(from)) {
    THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(
      from, `pow( max( lightDistance, ${LAMP_SIZE.toFixed(2)} ), decayExponent )`);
  } else {
    console.warn("Floorplan Studio: could not soften lamp light near walls (three.js changed)");
  }
}
const SHARP_SHADOWS = 3; // lamps with the sharpest shadow maps (spot 2048 px, point 1024 px a side)
/**
 * Where a lamp's shadow map starts (m): normally 10 cm out, so the lamp's own fixture
 * casts no shadow, but just short of a wall the lamp is closer to. Otherwise the part of
 * the wall within that distance isn't in the shadow map, and light shines through it
 * (a Hue Play lying against the wall behind a bed).
 */
function lampShadowNear(x, y, walls = []) {
  let gap = Infinity;
  for (const w of walls) {
    const [dx, dy] = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - w.a[0]) * dx + (y - w.a[1]) * dy) / len2));
    gap = Math.min(gap, Math.hypot(x - (w.a[0] + t * dx), y - (w.a[1] + t * dy)) - (w.thickness || 0.15) / 2);
  }
  return Math.min(0.1, Math.max(0.003, gap * 0.7));
}
const WIDE_LAMP = 1.1; // lamps with a cone wider than this (half angle, radians) light as a point light

/**
 * Share of a point light's output (over the lower half) that a SpotLight with this cone
 * gives: its brightness fades from the centre to the edge of the cone (penumbra).
 */
const coneShares = new Map();
function coneShare(angle, penumbra) {
  const key = `${angle.toFixed(2)}|${penumbra.toFixed(2)}`;
  if (!coneShares.has(key)) {
    const [cosOuter, cosInner] = [Math.cos(angle), Math.cos(angle * (1 - penumbra))];
    let lit = 0;
    let all = 0;
    for (let i = 0; i < 200; i++) {
      const th = ((i + 0.5) / 200) * (Math.PI / 2);
      const t = Math.min(1, Math.max(0, (Math.cos(th) - cosOuter) / (cosInner - cosOuter)));
      lit += t * t * (3 - 2 * t) * Math.sin(th);
      all += Math.sin(th);
    }
    coneShares.set(key, lit / all);
  }
  return coneShares.get(key);
}
const isLightRecord = (d) => d.kind === "lamp" || d.kind === "screenlight";
const BEAM_ANGLE = 0.85; // spotlight half-angle in radians (~49°)

// Soft volumetric-looking beam: brightest near the lamp, fading towards the
// floor and towards the cone's silhouette.
const beamMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 0.85, 0.6) }, uStrength: { value: 0 } },
    clipping: true,
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      varying float vT;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vT = uv.y; // 1 at the lamp, 0 at the floor
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vT;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        #include <clipping_planes_fragment>
        float edge = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        float a = uStrength * pow(vT, 1.2) * edge * 0.38;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
const SLAB = 0.15;
// How far below the house's floor level things outdoors stand: on an outdoor area
// (laid on the ground, see the room build) or on the bare ground
const OUTDOOR_DROP = SLAB - 0.012;
const GROUND_DROP = SLAB + 0.01;
const MAX_HOLES = 8; // floor openings per floor

/**
 * Cut floor openings (stairwells, vides) out of a floor material: fragments
 * inside any of the openings' rectangles (plan x/y = world x/z) are dropped.
 * Works for any room shape, also when an opening spans several rooms.
 */
function cutHoles(mat, holes) {
  const rects = Array.from({ length: MAX_HOLES }, (_, i) => {
    const f = holes[i];
    return f ? new THREE.Vector4(f.x, f.y, f.w / 2, f.d / 2) : new THREE.Vector4();
  });
  const rots = Array.from({ length: MAX_HOLES }, (_, i) => {
    const a = ((holes[i]?.rotation || 0) * Math.PI) / 180;
    return new THREE.Vector2(Math.cos(a), Math.sin(a));
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uHoles: { value: rects }, uHoleRot: { value: rots }, uHoleCount: { value: Math.min(holes.length, MAX_HOLES) },
    });
    shader.vertexShader = `varying vec2 vHoleXZ;\n${shader.vertexShader}`.replace("#include <begin_vertex>",
      "#include <begin_vertex>\n  vHoleXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = `varying vec2 vHoleXZ;
      uniform vec4 uHoles[${MAX_HOLES}];
      uniform vec2 uHoleRot[${MAX_HOLES}];
      uniform int uHoleCount;
      bool fpsInHole(vec2 p) {
        for (int i = 0; i < ${MAX_HOLES}; i++) {
          if (i >= uHoleCount) break;
          vec2 d = p - uHoles[i].xy;
          vec2 l = vec2(d.x * uHoleRot[i].x + d.y * uHoleRot[i].y, -d.x * uHoleRot[i].y + d.y * uHoleRot[i].x);
          if (abs(l.x) < uHoles[i].z && abs(l.y) < uHoles[i].w) return true;
        }
        return false;
      }
      ${shader.fragmentShader}`.replace("void main() {", "void main() {\n  if (fpsInHole(vHoleXZ)) discard;");
  };
  mat.customProgramCacheKey = () => "fps-holes";
  return mat;
}

const STYLE = `
[hidden] { display:none !important; }
${COMPASS_STYLE}
:host { display:block; position:relative; overflow:hidden; background:var(--fps-bg); }
canvas { display:block; width:100%; height:100%; touch-action:none; outline:none; }
.overlay { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.marker { position:absolute; transform:translate(-50%,-50%); pointer-events:auto; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; }
.marker .bubble { width:30px; height:30px; border-radius:50%; display:flex; align-items:center;
  justify-content:center; background:var(--card-background-color,#fff); color:var(--fps-icon-off);
  box-shadow:0 1px 4px rgba(0,0,0,.4); }
.marker.active .bubble { color:#fff; background:var(--fps-marker-active, var(--fps-active)); }
.marker.unavailable .bubble { opacity:.45; }
${PLAYING_STYLE}
.marker .state { margin-top:2px; font-size:11px; padding:0 4px; border-radius:6px; max-width:140px; overflow:hidden; text-overflow:ellipsis;
  background:var(--card-background-color,#fff); color:var(--primary-text-color); white-space:nowrap; }
.marker ha-state-icon, .marker ha-icon { --mdc-icon-size:18px; }
.label { position:absolute; transform:translate(-50%,-50%); font-size:12px; white-space:nowrap;
  color:var(--primary-text-color); text-align:center; line-height:1.25;
  text-shadow:0 0 3px var(--fps-bg),0 0 3px var(--fps-bg); }
.label .name { font-weight:500; }
.hud { position:absolute; left:8px; bottom:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.hud .roof-op { display:flex; align-items:center; padding:2px 8px; border-radius:16px; background:var(--card-background-color,#fff);
  border:1px solid var(--divider-color,#ccc); }
.hud .roof-op input { width:90px; margin:0; }
.hud .roof-op[hidden] { display:none; }
.badge { position:absolute; transform:translate(-50%,-50%); pointer-events:none; font-size:11px; padding:1px 6px;
  border-radius:8px; background:var(--card-background-color,#fff); color:var(--primary-text-color);
  box-shadow:0 1px 3px rgba(0,0,0,.3); white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis; }
.hud button { height:32px; padding:0 10px; border-radius:8px; border:1px solid var(--divider-color);
  background:var(--card-background-color,#fff); color:var(--primary-text-color); cursor:pointer; font:inherit; font-size:13px; }
.hud button[aria-pressed="true"] { background:var(--primary-color); color:var(--text-primary-color,#fff); border-color:var(--primary-color); }
.hint { position:absolute; right:8px; bottom:8px; font-size:11px; color:var(--secondary-text-color);
  background:var(--card-background-color,#fff); padding:4px 8px; border-radius:6px; opacity:.85; }
.error { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  color:var(--error-color,#db4437); padding:16px; text-align:center; }
`;

const cssColor = (el, name, fallback) => {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch (_e) {
    return new THREE.Color(fallback);
  }
};

function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    // Material arrays may have empty slots (e.g. a floor opening's rim has no top/bottom)
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean);
    mats.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
  });
}

export class FpsView3D extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <div class="overlay"></div>
      <div class="compass"></div>
      <div class="hud">
        <button data-act="reset"></button>
        <button data-act="top"></button>
        <button data-act="low" aria-pressed="false"></button>
        <button data-act="all" aria-pressed="false"></button>
        <button data-act="roofs" aria-pressed="${readPref("roofs", "1") === "1"}"></button>
        <label class="roof-op">
          <input type="range" min="0" max="100" step="5" data-roof-opacity value="${Math.round(parseFloat(readPref("roofOpacity", "1")) * 100)}"></label>
      </div>
      <div class="hint"></div>`;
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._compass = this.shadowRoot.querySelector(".compass");
    this.north = 0;
    this._localizeHud();
    this.lowWalls = false;
    this.allFloors = false;
    this.showRoofs = readPref("roofs", "1") === "1";
    this.roofOpacity = Math.min(1, Math.max(0, parseFloat(readPref("roofOpacity", "1")) || 0));
    this._roofMeshes = [];
    const opSlider = this.shadowRoot.querySelector("[data-roof-opacity]");
    opSlider.closest("label").hidden = !this.showRoofs;
    opSlider.addEventListener("input", () => {
      this.roofOpacity = Number(opSlider.value) / 100;
      this._applyRoofOpacity();
    });
    opSlider.addEventListener("change", () => writePref("roofOpacity", String(this.roofOpacity)));
    this._markerEls = new Map();
    this._labelEls = new Map();
    this._badgeEls = new Map();
    this._roomMeshes = [];
    this._dynamic = []; // objects whose look depends on entity state
    this._overlayItems = [];
    this._builtVersion = null;
    this._textures = new Map();

    this.shadowRoot.querySelector(".hud").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "reset") this.resetCamera();
      if (act === "top") this.resetCamera(true);
      if (act === "roofs") {
        this.showRoofs = !this.showRoofs;
        writePref("roofs", this.showRoofs ? "1" : "0");
        btn.setAttribute("aria-pressed", String(this.showRoofs));
        this.shadowRoot.querySelector(".roof-op").hidden = !this.showRoofs;
        this._rebuild();
      }
      if (act === "low" || act === "all") {
        if (act === "low") this.lowWalls = !this.lowWalls;
        else this.allFloors = !this.allFloors;
        btn.setAttribute("aria-pressed", String(act === "low" ? this.lowWalls : this.allFloors));
        this._rebuild();
      }
    });
  }

  connectedCallback() {
    if (!this._renderer) this._init();
    this._ro?.observe(this);
    this._startPulseLoop();
    this.requestRender();
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    cancelAnimationFrame(this._pulseRaf);
    this._pulseRaf = null;
  }

  _init() {
    try {
      // Rendering quality for this device (quality.js): lighter on slow hardware
      this._q = quality();
      this._measure = needsMeasurement(); // an unknown GPU: time a few frames once (see _measureDevice)
      this._renderer = new THREE.WebGLRenderer({ antialias: this._q.antialias, powerPreference: "high-performance" });
    } catch (err) {
      this.shadowRoot.innerHTML += `<div class="error">3D view unavailable: ${escapeHtml(err.message)}</div>`;
      return;
    }
    const r = this._renderer;
    this._pixelRatio = Math.min(window.devicePixelRatio || 1, this._q.pixelRatio);
    r.setPixelRatio(this._pixelRatio);
    r.shadowMap.enabled = !this._q.baked;
    r.shadowMap.type = this._q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; // redrawn on demand, see _invalidateShadows()
    // Every shadow-casting light takes one of the GPU's texture slots in the
    // lighting shader (usually 16). Keep room for the sun's shadow and surface
    // textures; going over makes the shader fail and all surfaces vanish.
    this._shadowBudget = Math.min(this._q.lampShadows, Math.max(0, r.capabilities.maxTextures - 4));
    r.debug.onShaderError = (gl, program, vs, fs) => {
      // Safety net: if a GPU still refuses, use fewer shadows and redraw
      console.warn("Floorplan Studio: lighting shader failed; reducing light shadows", this._shadowBudget);
      this._shadowBudget = Math.floor(this._shadowBudget / 2);
      this._assignShadows();
      this.requestRender();
    };
    r.localClippingEnabled = true; // light beams are clipped at wall faces
    this.shadowRoot.insertBefore(r.domElement, this._overlay);

    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this._controls = new OrbitControls(this._camera, r.domElement);
    this._controls.screenSpacePanning = false;
    this._controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this._controls.minDistance = 1;
    this._controls.maxDistance = 400;
    this._controls.addEventListener("change", () => this.requestRender());
    // Looking somewhere else may change which lights deserve the shadows
    this._controls.addEventListener("end", () => {
      // ...and, with more lamps on than lights, which lamps share one
      if ((this._dynamic || []).filter((d) => isLightRecord(d) && d.intensity > 0).length > (this._lightPool || []).length) {
        this._assignLights();
        this._invalidateShadows();
      }
      this._assignShadows();
      this.requestRender();
    });

    this._hemi = new THREE.HemisphereLight(0xffffff, 0x888877, 1.6);
    this._scene.add(this._hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 40, 12);
    sun.castShadow = !this._q.baked;
    sun.shadow.autoUpdate = false;
    sun.shadow.mapSize.set(this._q.sunShadow, this._q.sunShadow);
    sun.shadow.bias = -0.0005;
    this._sun = sun;
    this._scene.add(sun, sun.target);

    this._group = new THREE.Group();
    this._scene.add(this._group);

    // Tap on a piece or room (without dragging) runs its action. Double-tap runs a
    // piece's double-tap action; elsewhere it flies the camera to that spot, or back
    // to the overview when it hits nothing.
    const dom = r.domElement;
    let down = null;
    this._taps = new TapSorter();
    dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
    dom.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      down = null;
      const [x, y] = [e.clientX, e.clientY];
      const zoom = () => {
        const hit = this._pick(x, y);
        if (hit) this.focusOn(hit.point);
        else this.resetCamera(false, true);
      };
      const { piece, room } = this._pickTap(x, y);
      if (piece?.entity_id) {
        this._taps.tap(`f:${piece.id}`, x, y, () => runTapAction(this, this._hass, piece.entity_id, piece.tap_action),
          doubleTapHandler(this, this._hass, piece, zoom));
        return;
      }
      const entity = room && roomTapEntity(this._hass, room);
      this._taps.tap(room ? `r:${room.id}` : "scene", x, y, entity ? () => runTapAction(this, this._hass, entity, "more-info") : null, zoom);
    });

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this);
  }

  /** Toolbar texts in the current language (built once, so redone when it changes). */
  _localizeHud() {
    if (this._hudLanguage === currentLanguage()) return;
    this._hudLanguage = currentLanguage();
    const root = this.shadowRoot;
    const set = (sel, title, text) => {
      const el = root.querySelector(sel);
      if (!el) return;
      if (title) el.title = t(title);
      if (text) el.textContent = t(text);
    };
    set(".compass", "Compass");
    set('[data-act="reset"]', "Reset camera", "Reset view");
    set('[data-act="top"]', "Look from above", "Top");
    set('[data-act="low"]', "Lower the walls to look inside", "Low walls");
    set('[data-act="all"]', "Show floors above the selected one", "All floors");
    set('[data-act="roofs"]', "Show or hide the roofs", "Roofs");
    set(".roof-op", "How solid the roofs are: make them see-through to see and tap what's underneath");
    set(".hint", null, "Drag: rotate · Shift/right-drag: pan · Scroll/pinch: zoom");
  }

  set hass(hass) {
    this._localizeHud();
    const prev = this._hass;
    this._hass = hass;
    // Only for changes the plan shows (`relevant`: set by the panel, see planEntities)
    if (hassChanged(prev, hass, this.relevant)) this._applyStates();
  }

  /** props: { doc, docVersion, floorId, blueprintUrls: {imageId: {url, aspect}} } */
  update(props) {
    this._localizeHud();
    const floorChanged = props.floorId !== undefined && props.floorId !== this.floorId;
    const sunKey = props.sun && JSON.stringify(props.sun);
    const dimChanged = props.dimLights !== undefined && !!props.dimLights !== !!this.dimLights;
    Object.assign(this, props);
    if (this._builtVersion !== this.docVersion || floorChanged) this._rebuild();
    else if (sunKey && sunKey !== this._sunKey) this._applySun();
    else if (dimChanged) this._applyStates();
    this.requestRender();
  }

  /**
   * Day/night: sunlight from the sun's real direction (azimuth from north,
   * elevation), a dark blue sky at night, warm low sun around dusk.
   * sun = { daylight 0..1, azimuth°, elevation° }
   */
  _applySun() {
    if (!this._renderer) return;
    const s = this.sun || { daylight: 1, azimuth: 160, elevation: 45 };
    this._sunKey = JSON.stringify(s);
    const night = 1 - s.daylight;

    // Low sun tints the sky warm before it fades to night
    const dusk = s.daylight * (1 - smoothstep(2, 20, s.elevation));
    this._scene.background = this._dayBg.clone().lerp(new THREE.Color(DUSK_SKY), 0.55 * dusk).lerp(new THREE.Color(NIGHT_SKY), night);
    this._groundMat?.color.copy(this._dayGround).lerp(new THREE.Color(NIGHT_GROUND), night);
    this._hemi.intensity = 0.3 + 1.3 * s.daylight;
    this._hemi.color.set(0xffffff).lerp(new THREE.Color(0x5d6f9e), night);
    this._hemi.groundColor.set(0x888877).lerp(new THREE.Color(0x101014), night);

    // Compass bearing -> plan direction: plan "up" is north rotated by the north setting
    const a = (((this.north || 0) + s.azimuth) * Math.PI) / 180;
    const el = (Math.max(s.elevation, 2) * Math.PI) / 180;
    const c = this._center || new THREE.Vector3();
    const dist = this._sunDistance || 40;
    this._sun.position.set(
      c.x + Math.sin(a) * Math.cos(el) * dist,
      c.y + Math.sin(el) * dist,
      c.z - Math.cos(a) * Math.cos(el) * dist
    );
    this._sun.target.position.copy(c);
    this._sun.intensity = 1.8 * s.daylight * smoothstep(-1, 6, s.elevation);
    this._sun.color.set(0xffffff).lerp(new THREE.Color(DUSK_SUN), 0.85 * (1 - smoothstep(4, 25, s.elevation)));
    this._invalidateShadows();
    this._applyStates(); // beams are stronger at night
    this.requestRender();
  }

  _resize() {
    if (!this._renderer) return;
    const w = this.clientWidth;
    const h = this.clientHeight;
    if (!w || !h) return;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    if (!this._cameraPlaced && this._bounds) this.resetCamera();
    this.requestRender();
  }

  requestRender() {
    if (this._raf || !this._renderer) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      if (this._shadowsDirty && !this._q.baked) this._renderShadows();
      this._renderer.render(this._scene, this._camera);
      this._renderCompass();
      this._positionOverlay();
      this._watchFrameRate();
      if (this._measure && this._bounds) this._measureDevice();
    });
  }

  /**
   * A GPU we can't name ("Apple GPU" on an iPad or iPhone, Firefox): draw the plan a couple
   * of dozen times the first time the 3D view opens, and pick the profile by how quickly
   * frames come (fewer than ~25 a second: light). The result is kept for this browser, so
   * it's measured once.
   */
  async _measureDevice() {
    this._measure = false;
    const gaps = [];
    let last = performance.now();
    for (let i = 0; i < 32; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (!this.isConnected || document.hidden || !this._renderer) return; // not now: again next time
      this._renderer.render(this._scene, this._camera);
      const now = performance.now();
      gaps.push(now - last);
      last = now;
    }
    // The first frames compile shaders (many with a lot of lamps); the median ignores a
    // few stray slow frames as well
    const steady = gaps.slice(8).sort((a, b) => a - b);
    const median = steady[steady.length >> 1];
    this._setMeasured(median > 40 ? "low" : "high");
  }

  /** Use a measured profile now (tells the panel); `keep`: for this device from now on. */
  _setMeasured(name, keep = true) {
    if (keep) setMeasuredQuality(name);
    else setSlowInUse();
    if (qualityMode() === "auto" && name !== this._q?.name) {
      this.applyQuality();
      this.dispatchEvent(new CustomEvent("fps-quality", { bubbles: true, composed: true, detail: { name } }));
    }
  }

  /**
   * Fewer draw calls for the building: a floor's walls, window and door frames, sills and
   * the like are hundreds of small meshes, each a draw call (again for every shadow map),
   * and a wall has a material per side (its rooms' finishes inside, the facade outside).
   * The parts that never change are regrouped per material (and shadow settings) into one
   * mesh each, which looks the same. Left alone: room floors (tap targets, coloured by
   * state), anything a live record changes (door leaves swing, lamps, screens), hidden
   * shadow walls, see-through meshes (drawn in order), furniture (merged per piece), and
   * meshes with a role of their own.
   */
  _mergeStatic(g) {
    const live = new Set();
    for (const d of this._dynamic) for (const v of Object.values(d)) if (v?.isObject3D) live.add(v);
    const casters = new Set(this._shadowCasters || []);
    const occluders = new Set(this._occluders || []);
    const taps = new Set(this._tapMeshes || []);
    const fixed = (m) => m.isMesh && !m.children.length && m.visible && !m.renderOrder && !live.has(m) && !casters.has(m)
      && m.raycast === THREE.Mesh.prototype.raycast && !Object.keys(m.userData).length
      && [].concat(m.material).every((mat) => mat && !mat.transparent && !mat.clippingPlanes?.length);
    // Candidates: the floor's own meshes, and the direct meshes of its static groups (a
    // window's frame; a door's frame, but not its swinging leaf, which lives in a subgroup)
    const candidates = [];
    g.updateMatrix();
    for (const c of g.children) {
      if (c.isMesh) {
        c.updateMatrix();
        if (fixed(c)) candidates.push({ mesh: c, matrix: c.matrix.clone() });
        continue;
      }
      let furniture = false;
      c.traverse((o) => { if (o.userData.furniture) furniture = true; });
      if (furniture || live.has(c) || Object.keys(c.userData).length) continue;
      c.updateMatrix();
      for (const m of c.children) {
        m.updateMatrix();
        if (fixed(m)) candidates.push({ mesh: m, matrix: c.matrix.clone().multiply(m.matrix) });
      }
    }
    // Slices per material: a multi-material mesh (a wall) gives one per material group
    const buckets = new Map();
    for (const { mesh, matrix } of candidates) {
      const flags = `${mesh.castShadow}|${mesh.receiveShadow}|${occluders.has(mesh)}|${taps.has(mesh)}`;
      const slices = Array.isArray(mesh.material)
        ? mesh.geometry.groups.map((gr) => ({ material: mesh.material[gr.materialIndex], start: gr.start, count: gr.count }))
        : [{ material: mesh.material }];
      for (const sl of slices) {
        const key = `${sl.material.uuid}|${flags}`;
        if (!buckets.has(key)) buckets.set(key, { material: sl.material, mesh, slices: [], sources: new Set() });
        const b = buckets.get(key);
        b.slices.push({ geometry: mesh.geometry, matrix, start: sl.start, count: sl.count });
        b.sources.add(mesh);
      }
    }
    // Only worth it when it saves draw calls; then every slice of those meshes must be merged
    const merging = new Set();
    for (const b of buckets.values()) if (b.slices.length > 1) b.sources.forEach((m) => merging.add(m));
    if (!merging.size) return;
    for (const b of buckets.values()) {
      if (![...b.sources].some((m) => merging.has(m))) continue;
      const geometry = mergeSlices(THREE, b.slices);
      if (!geometry) return; // shouldn't happen; leave this floor as it is
      const mesh = new THREE.Mesh(geometry, b.material);
      mesh.castShadow = b.mesh.castShadow;
      mesh.receiveShadow = b.mesh.receiveShadow;
      mesh.matrixAutoUpdate = false; // the slices are already in the floor's coordinates
      g.add(mesh);
      if (occluders.has(b.mesh)) this._occluders.push(mesh);
      if (taps.has(b.mesh)) this._tapMeshes.push(mesh);
    }
    for (const m of merging) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    this._occluders = (this._occluders || []).filter((o) => !merging.has(o));
    this._tapMeshes = (this._tapMeshes || []).filter((o) => !merging.has(o));
  }

  /** The quality setting changed: use the new profile (anti-aliasing needs a page reload). */
  applyQuality() {
    if (!this._renderer) return;
    this._q = quality();
    this._pixelRatio = Math.min(window.devicePixelRatio || 1, this._q.pixelRatio);
    this._renderer.setPixelRatio(this._pixelRatio);
    this._renderer.shadowMap.type = this._q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this._renderer.shadowMap.enabled = !this._q.baked;
    this._sun.castShadow = !this._q.baked;
    this._shadowBudget = Math.min(this._q.lampShadows, Math.max(0, this._renderer.capabilities.maxTextures - 4));
    const sunShadow = this._sun.shadow;
    if (sunShadow.mapSize.x !== this._q.sunShadow) {
      sunShadow.mapSize.set(this._q.sunShadow, this._q.sunShadow);
      sunShadow.map?.dispose();
      sunShadow.map = null;
    }
    this._scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) if (m) m.needsUpdate = true; // the new shadow type
    });
    this._resize();
    this._rebuild(); // light slots for the new number of lights
  }

  /**
   * Dynamic resolution: while the view keeps moving (turning, zooming, animating), frames
   * should come quickly. When they average under ~20 per second, draw fewer pixels (down
   * to half the screen's resolution); the picture gets a little softer, moving it smooth.
   */
  _watchFrameRate() {
    const now = performance.now();
    const gap = now - (this._lastFrame || 0);
    this._lastFrame = now;
    if (gap > 250) {
      this._frameGaps = []; // a pause, not a slow frame
      return;
    }
    const gaps = (this._frameGaps ||= []);
    gaps.push(gap);
    if (gaps.length < 30) return;
    const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    this._frameGaps = [];
    if (average > 50 && this._pixelRatio > 0.5) {
      this._pixelRatio = Math.max(0.5, this._pixelRatio * 0.75);
      this._renderer.setPixelRatio(this._pixelRatio);
      this._resize();
    } else if (average > 50 && this._q?.name === "high" && qualityMode() === "auto") {
      // Still too slow at the lowest resolution: switch to the light profile, until the
      // page is loaded again
      this._setMeasured("low", false);
    }
  }

  /** Turn the compass with the camera so N points at the house's north. */
  _renderCompass() {
    const azimuth = (this._controls.getAzimuthalAngle() * 180) / Math.PI;
    const rotation = Math.round(this.north + azimuth);
    const key = `${rotation}|${currentLanguage()}`; // the letters are translated
    if (this._compassRotation === key) return;
    this._compassRotation = key;
    this._compass.innerHTML = compassSvg(rotation);
  }

  // ---------- scene construction ----------

  _rebuild() {
    if (!this._renderer || !this.doc) return;
    this._builtVersion = this.docVersion;
    try {
      disposeTree(this._group);
    } catch (err) {
      // Never let cleanup stop the rebuild: that would leave a stale, half-disposed scene
      console.error("floorplan_studio: dispose failed", err);
    }
    this._dynamic?.forEach((d) => { d.tv?.texture.dispose(); d.art?.dispose(); d.display?.texture.dispose(); }); // each TV has its own screen textures
    this._group.clear();
    this._roomMeshes = [];
    this._tapMeshes = [];
    this._occluders = [];
    this._shadowCasters = [];
    this._pulses = [];
    this._spinners = [];
    this._laundry = [];
    this._robots = [];
    this._dynamic = [];
    this._overlayItems = [];
    this._roofMeshes = [];

    this._dayBg = cssColor(this, "--fps-bg", "#f4f4f4");
    this._scene.background = this._dayBg.clone();
    const wallColor = cssColor(this, "--fps-wall-3d", "#ecebe7");
    const slabColor = cssColor(this, "--fps-slab-3d", "#b9b7b1");
    // The light profile draws with cheaper materials (and no real lamp lights, see bakedlight.js)
    const T = this._q.baked ? LITE : THREE;
    if (this._T !== T) {
      this._T = T;
      this._doorMats = this._windowMats = this._glassMat = null; // made for the other profile
    }
    this._baked = [];
    const wallMat = new T.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
    const slabMat = new T.MeshStandardMaterial({ color: slabColor, roughness: 1 });

    const stack = stackFloors(this.doc.floors);
    const current = this.doc.floors.find((f) => f.id === this.floorId) || stack[0]?.floor;
    const box = new THREE.Box3();

    for (const { floor, elevation } of stack) {
      if (!this.allFloors && current && floor.level > current.level) continue;
      const g = new THREE.Group();
      g.position.y = elevation;
      const wallH = this.lowWalls ? Math.min(LOW_WALL, floor.wall_height) : floor.wall_height;
      // Light profile: the lamps' light on floors, walls and furniture (bakedlight.js)
      const firstRecord = this._dynamic.length;
      const surface = this._q.baked ? new LightSurface(THREE, lightBlockers(floor, (w) => wallPieces(w, floor.openings, floor.wall_height))) : null;
      const floorInfo = []; // per room: what the light grid needs
      this._surface = surface; // (doors and windows add themselves to it)

      // Floor openings: cut out of the room floors (also from their shadows) and
      // lined with a slab-coloured rim
      const holes = (floor.furniture || []).filter((f) => catalogItem(f.type).hole).slice(0, MAX_HOLES);
      const floorSlabMat = holes.length ? cutHoles(slabMat.clone(), holes) : slabMat;
      const holeDepthMat = holes.length ? cutHoles(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), holes) : null;
      for (const f of holes) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(f.w, SLAB, f.d), [slabMat, slabMat, null, null, slabMat, slabMat]);
        rim.material = rim.material.map((m) => m && Object.assign(m.clone(), { side: THREE.BackSide })); // the inside faces
        rim.position.set(f.x, -SLAB / 2, f.y);
        rim.rotation.y = (-(f.rotation || 0) * Math.PI) / 180;
        rim.castShadow = true;
        rim.receiveShadow = true;
        g.add(rim);
      }

      // Rooms: slab + coloured floor surface
      const outdoorRank = new Map([...floor.rooms].filter(isOutdoor)
        .sort((a, b) => polygonArea(b.points) - polygonArea(a.points)).map((r, i) => [r.id, i]));
      for (const room of floor.rooms) {
        // Outdoor areas on the lowest floor lie on the ground: a thin layer, no floor slab
        const onGround = isOutdoor(room) && elevation === stack[0].elevation;
        const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p[0], p[1])));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: onGround ? 0.02 : SLAB, bevelEnabled: false });
        geo.rotateX(Math.PI / 2); // plan (x,y) -> world (x,z), extrusion goes down
        // (overlapping outdoor areas: smaller ones a few mm higher, so a terrace lies on the lawn)
        if (onGround) geo.translate(0, -SLAB + 0.012 + 0.003 * outdoorRank.get(room.id), 0);
        const finish = floorFinish(room);
        const textured = finish.material !== "plain";
        const topMat = textured ? finishMaterial(T, "floor", finish, room.floor_rotation || 0) : new T.MeshStandardMaterial({ roughness: 0.8 });
        if (holes.length) cutHoles(topMat, holes);
        const mesh = new THREE.Mesh(geo, [topMat, floorSlabMat]);
        if (holeDepthMat) mesh.customDepthMaterial = holeDepthMat;
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData.room = room;
        this._occluders.push(mesh);
        g.add(mesh);
        this._roomMeshes.push(mesh);
        this._tapMeshes.push(mesh);
        const hasLamp = [...floor.markers, ...(floor.furniture || [])].some(
          (m) => domainOf(m.entity_id) === "light" && pointInPolygon([m.x, m.y], room.points)
        );
        this._dynamic.push({ kind: "room", room, mat: topMat, hasLamp, finishColor: textured ? new THREE.Color(finish.color) : null });
        floorInfo.push({
          room, area: polygonArea(room.points),
          y: onGround ? -SLAB + 0.012 + 0.003 * outdoorRank.get(room.id) : 0,
          // (a pattern is darker than its base colour on average)
          albedo: textured ? new THREE.Color(finish.color).multiplyScalar(0.75) : new THREE.Color(room.color || "#8ab4f8").lerp(new THREE.Color(0xf2f1ed), 0.65),
        });
        const c = isOutdoor(room) ? labelPoint(room, floor.rooms.filter((x) => !isOutdoor(x) || polygonArea(x.points) < polygonArea(room.points))) : polygonCenter(room.points);
        // Float labels inside the room so walls don't hide them from typical angles
        this._overlayItems.push({ kind: "label", room,
          pos: new THREE.Vector3(c[0], elevation + Math.min(1.0, wallH * 0.5), c[1]) });
      }

      // Blueprint as a textured floor plane (only when enabled for viewing)
      const bp = floor.blueprint;
      const bpInfo = bp && this.blueprintUrls?.[bp.image_id];
      if (bp?.show_in_view && bpInfo?.url) {
        const h = bp.width * bpInfo.aspect;
        const tex = this._texture(bpInfo.url);
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(bp.width, h),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: bp.opacity, depthWrite: false })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(bp.x + bp.width / 2, 0.004, bp.y + h / 2);
        g.add(plane);
      }

      // Wall finishes: each face shows the finish of the room it faces (or the
      // house exterior). Materials are shared per finish within this build.
      const finishMats = new Map();
      const faceMat = (room) => {
        let finish = null;
        if (room?.wall_material || room?.wall_color) finish = wallFinish(room.wall_material, room.wall_color);
        else if (!room && (this.doc.exterior_material || this.doc.exterior_color)) {
          finish = wallFinish(this.doc.exterior_material, this.doc.exterior_color);
        }
        if (!finish) return wallMat;
        const key = `${finish.material}|${finish.color}`;
        if (!finishMats.has(key)) finishMats.set(key, finishMaterial(T, "wall", finish));
        return finishMats.get(key);
      };
      const roomAt = (p) => {
        let best = null;
        let bestArea = Infinity;
        for (const r of floor.rooms) {
          if (!pointInPolygon(p, r.points)) continue;
          const a = polygonArea(r.points);
          if (a < bestArea) {
            bestArea = a;
            best = r;
          }
        }
        return best;
      };

      // Walls, split around openings and wherever the room on either side changes
      for (const wall of floor.walls) {
        const { pieces, openings, length } = wallPieces(wall, floor.openings, wallH);
        if (length < 1e-4) continue;
        const u = [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
        const n = [-u[1], u[0]]; // the box's +z face points this way
        const angle = -Math.atan2(u[1], u[0]);
        const at = (s, y) => new THREE.Vector3(wall.a[0] + u[0] * s, y, wall.a[1] + u[1] * s);
        const half = wall.thickness / 2;

        // Ends that meet another wall's middle (a T-junction) stop at that wall's
        // centre line; extending them would poke through its outer face
        const tJoint = (p) => floor.walls.some((w2) => {
          if (w2 === wall) return false;
          const c = projectOnSegment(p, w2.a, w2.b);
          return c.d < 1e-3 && c.t > 1e-3 && c.t < 1 - 1e-3;
        });
        const extendStart = tJoint(wall.a) ? 0 : half;
        const extendEnd = tJoint(wall.b) ? 0 : half;

        // Rooms on both sides along the wall, sampled every 10 cm
        const STEP = 0.1;
        const spans = [];
        for (let s0 = 0; s0 < length; s0 += STEP) {
          const s = Math.min(length, s0 + STEP / 2);
          const p = [wall.a[0] + u[0] * s, wall.a[1] + u[1] * s];
          const off = half + 0.04;
          const plus = roomAt([p[0] + n[0] * off, p[1] + n[1] * off]);
          const minus = roomAt([p[0] - n[0] * off, p[1] - n[1] * off]);
          const last = spans.at(-1);
          if (last && last.plus === plus && last.minus === minus) last.to = Math.min(length, s0 + STEP);
          else spans.push({ from: s0, to: Math.min(length, s0 + STEP), plus, minus });
        }

        for (const pc of pieces) {
          for (const sp of spans) {
            const a0 = Math.max(pc.from, sp.from);
            const b0 = Math.min(pc.to, sp.to);
            if (b0 - a0 <= 1e-4) continue;
            // Extend pieces touching the wall ends so corners close up
            const from = a0 <= 1e-6 ? a0 - extendStart : a0;
            const to = b0 >= length - 1e-6 ? b0 + extendEnd : b0;
            // Walls standing on the floor reach down past the slab to the ground,
            // so no light can slip out underneath them
            const bottom = pc.bottom <= 1e-6 ? -(SLAB + 0.02) : pc.bottom;
            const h = pc.top - bottom;
            if (pc.top - pc.bottom <= 1e-4) continue;
            const geo = new THREE.BoxGeometry(to - from, h, wall.thickness);
            worldUVs(geo, to - from, h, wall.thickness, from, to, bottom);
            // End faces show at outside corners: give them the outside finish
            const plusMat = faceMat(sp.plus);
            const minusMat = faceMat(sp.minus);
            const endMat = !sp.plus ? plusMat : !sp.minus ? minusMat : wallMat;
            const mesh = new THREE.Mesh(geo, [endMat, endMat, wallMat, wallMat, plusMat, minusMat]);
            mesh.position.copy(at((from + to) / 2, bottom + h / 2));
            mesh.rotation.y = angle;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            g.add(mesh);
            this._occluders.push(mesh);
          }
          // The pieces above are split wherever the room on a side changes (for the finishes);
          // lamps get one seamless caster per stretch, so no light slips through those seams
          const bottom = pc.bottom <= 1e-6 ? -(SLAB + 0.02) : pc.bottom;
          const from = pc.from <= 1e-6 ? pc.from - extendStart : pc.from;
          const to = pc.to >= length - 1e-6 ? pc.to + extendEnd : pc.to;
          if (spans.length > 1 && pc.top - bottom > 1e-4 && to - from > 1e-4) {
            const caster = new THREE.Mesh(new THREE.BoxGeometry(to - from, pc.top - bottom, wall.thickness), wallMat);
            caster.position.copy(at((from + to) / 2, (bottom + pc.top) / 2));
            caster.rotation.y = angle;
            caster.castShadow = true;
            caster.visible = false; // only shown while lamp shadows are drawn
            g.add(caster);
            this._shadowCasters.push(caster);
          }
          if (surface) {
            // The light grid on both faces, in the finish of the room each one faces
            for (const side of [1, -1]) {
              const start = [wall.a[0] + u[0] * from + n[0] * half * side, wall.a[1] + u[1] * from + n[1] * half * side];
              const albedoAt = (s) => {
                const sp = spans.find((x) => from + s >= x.from - 1e-6 && from + s <= x.to + 1e-6) || spans[0];
                return faceMat(side > 0 ? sp.plus : sp.minus).color;
              };
              surface.addWallFace(start, u, [n[0] * side, n[1] * side], to - from, Math.max(0, pc.bottom), pc.top, albedoAt);
            }
          }
        }

        if (wallH < floor.wall_height) {
          // Low walls: add the missing upper part as a shadow-only caster for lamps
          const full = wallPieces(wall, floor.openings, floor.wall_height).pieces;
          for (const pc of full) {
            const bottom = Math.max(pc.bottom, wallH);
            const h = pc.top - bottom;
            const from = pc.from <= 1e-6 ? pc.from - half : pc.from;
            const to = pc.to >= length - 1e-6 ? pc.to + half : pc.to;
            if (h <= 1e-4 || to - from <= 1e-4) continue;
            const caster = new THREE.Mesh(new THREE.BoxGeometry(to - from, h, wall.thickness), wallMat);
            caster.position.copy(at((from + to) / 2, bottom + h / 2));
            caster.rotation.y = angle;
            caster.castShadow = true;
            caster.visible = false; // only shown while lamp shadows are drawn
            g.add(caster);
            this._shadowCasters.push(caster);
          }
        }

        for (const op of openings) {
          const o = op.opening;
          const w = op.to - op.from;
          const h = op.top - op.sill;
          if (w <= 0 || h <= 0) continue;
          if (o.type === "window") {
            this._addWindow(g, o, op, wall, at, angle, w, h);
          } else {
            this._addDoor(g, o, op, wall, at, angle, w, h);
          }
        }
      }

      for (const m of floor.markers) {
        if (!m.entity_id) continue;
        const isLight = domainOf(m.entity_id) === "light";
        // Lights hang just under the ceiling with their beam; other markers float mid-height
        // Ceiling lights stay at the real ceiling height, also with "Low walls"
        const iconY = isLight ? Math.max(0.6, floor.wall_height - 0.35) : Math.min(1.2, wallH * 0.6);
        this._overlayItems.push({ kind: "marker", marker: m, pos: new THREE.Vector3(m.x, elevation + iconY, m.y) });
        if (isLight) {
          this._addLamp(g, m, { top: floor.wall_height - 0.05, angle: BEAM_ANGLE, walls: floor.walls });
        }
      }

      // Outdoors on the lowest floor, pieces stand on the garden (or the bare ground),
      // which lies lower than the house's floors
      const lowest = elevation === stack[0].elevation;
      const indoor = floor.rooms.filter((r) => !isOutdoor(r));
      const outdoor = floor.rooms.filter(isOutdoor);
      const dropOf = (f) => {
        if (!lowest || catalogItem(f.type).ceiling) return 0;
        const p = [f.x, f.y];
        if (indoor.some((r) => pointInPolygon(p, r.points))) return 0;
        return outdoor.some((r) => pointInPolygon(p, r.points)) ? OUTDOOR_DROP : GROUND_DROP;
      };
      for (const f of floor.furniture || []) {
        const drop = dropOf(f);
        const { group, mats, spinner, ambilight, drum, load } = buildFurniture3D(T, f, { ceiling: floor.wall_height });
        group.position.y -= drop;
        if (drum && f.entity_id) {
          this._laundry.push({ f, def: catalogItem(f.type), group, drum, load, base: group.position.clone(), angle: 0, speed: 0,
            state: { running: false, spinning: false } });
        }
        // Roofs of garden structures (kapschuur, shelter) follow the roof opacity too
        group.traverse((o) => o.userData.roof && this._roofMeshes.push(o));
        g.add(group);
        if (spinner) this._spinners.push({ f, spinner, active: false, speed: 0 });
        if (catalogItem(f.type).robot && f.entity_id) {
          // Robot vacuums drive around; they don't cast shadows (shadows are only redrawn on changes)
          group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
          this._robots.push({ f, group, rooms: floor.rooms });
        }
        group.traverse((o) => o.isMesh && this._tapMeshes.push(o));
        const def = catalogItem(f.type);
        if (surface && !def.hole) {
          // The lamps' light at the piece's middle, added to all its parts' colour
          const uniform = { value: new THREE.Color(0, 0, 0) };
          group.traverse((o) => [].concat(o.material || []).forEach((m) => addLampLight(m, uniform)));
          surface.addProbe([f.x, baseHeight(f, floor.wall_height) - drop + f.h / 2, f.y], uniform, f.id);
        }
        // Big screens (TVs, projector screens) show a small looping programme while on
        const tv = def.screenLight ? createTvScreen(THREE, f.id) : null;
        if (tv) for (const m of mats.screen) m.emissiveMap = tv.texture;
        // The Frame: a painting on screen in Art Mode
        const art = def.art ? createArtwork(THREE, f.id) : null;
        // AV receivers: the front display shows the input and volume
        const display = def.display ? createDeviceDisplay(THREE, def.display) : null;
        if (display) for (const m of mats.screen) m.emissiveMap = display.texture;
        this._dynamic.push({ kind: "furniture", f, mats, def, ambilight, tv, art, display, pieces: floor.furniture, playing: false });
        this._pulsePieces = floor.furniture;
        // Sound waves: only for speakers (players, TVs and receivers leave that to them)
        if (domainOf(f.entity_id) === "media_player" && (def.speaker || def.passive)) this._addPulse(g, f, group, floor);
        const sl = catalogItem(f.type).screenLight;
        if (sl && f.entity_id) {
          this._addScreenLight(g, f, sl, baseHeight(f, floor.wall_height));
        }
        if (isLampFurniture(f)) {
          // Light comes from where the bulb is (inside the shade, the end of an arc
          // lamp's arm, a ceiling spot), shining down, or up for uplighters
          const [x, y, z] = lightAnchor(f, floor.wall_height);
          const l = catalogItem(f.type).light || {};
          // A lamp aimed sideways (a Hue Play at the wall) turns its light with the piece;
          // a directional spot shines where it's tilted to (its beam follows)
          const tilted = lightDirection(f);
          const aim = tilted || (l.aim && [...toWorld({ ...f, x: 0, y: 0 }, [0, l.aim[0]]), l.aim[1]]);
          this._addLamp(g, { ...f, x, y }, {
            top: Math.max(0.1, z - drop - (tilted ? 0 : 0.02)), angle: beamHalfAngle(f), beam: !!l.beam && !l.up && (!aim || !!tilted), bulb: false, up: !!l.up,
            aim, soft: !!l.soft, walls: floor.walls, lens: (l.lens ?? 0) * Math.min(f.w, f.d),
          });
        }
        const flood = catalogItem(f.type).floodlight;
        if (flood && f.entity_id) {
          // Floodlight: a lamp at the camera aimed forward and down, lit by the camera's light switch
          const z = baseHeight(f, floor.wall_height) + f.h * 0.75 - drop;
          const [x, y] = toWorld(f, [0, f.d / 2]);
          this._addLamp(g, { ...f, x, y }, { top: z, angle: (flood.angle / 2) * (Math.PI / 180), beam: false, bulb: false, walls: floor.walls });
          const rec = this._dynamic[this._dynamic.length - 1];
          const [tx, ty] = toWorld(f, [0, f.d / 2 + flood.range * 0.45]);
          rec.light.target.set(tx, elevation, ty);
          rec.light.distance = flood.range * 1.25;
          // Visible beam: a soft cone from the lamp to the ground, aimed like the light
          const from = new THREE.Vector3(x, z, y);
          const dir = new THREE.Vector3(tx, 0, ty).sub(from);
          const len = dir.length();
          const coneGeo = new THREE.ConeGeometry(Math.tan(rec.light.angle * 0.75) * len, len, 40, 1, true);
          coneGeo.translate(0, -len / 2, 0); // apex at the lamp
          rec.coneMat = beamMaterial();
          rec.coneMat.clippingPlanes = this._wallClipPlanes({ x, y }, floor.walls, flood.range);
          rec.cone = new THREE.Mesh(coneGeo, rec.coneMat);
          rec.cone.position.copy(from);
          rec.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
          rec.cone.renderOrder = 10;
          rec.cone.visible = false;
          g.add(rec.cone);
          rec.lightOf = () => {
            const on = cameraFloodlight(this._hass, f.entity_id);
            return on && { color: "#fff1d6", level: on.level };
          };
        }
        if (f.show_state && f.entity_id) {
          const top = baseHeight(f, floor.wall_height) + f.h - drop;
          this._overlayItems.push({ kind: "badge", furniture: f, pos: new THREE.Vector3(f.x, elevation + top + 0.15, f.y) });
        }
      }

      if (surface && floorInfo.length) {
        // The light grid on the floor, darker along the walls and under furniture
        const pts = floor.rooms.flatMap((r) => r.points);
        const bounds = { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
          minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
        const at = (x, z) => {
          let best = null;
          for (const r of floorInfo) if ((!best || r.area < best.area) && pointInPolygon([x, z], r.room.points)) best = r;
          return best;
        };
        const feet = (floor.furniture || []).filter((f) => {
          const def = catalogItem(f.type);
          return !def.hole && !def.ceiling && !((f.z || 0) > 0.05) && f.h > 0.08;
        });
        surface.addFloor(bounds, at, (x, z) => holes.some((f) => containsPoint(f, [x, z])), contactShade(floor.walls, feet));
        const mesh = surface.build();
        if (mesh) g.add(mesh);
        this._baked.push({ surface, elevation, records: this._dynamic.slice(firstRecord).filter(isLightRecord) });
      }
      this._surface = null;

      // Roofs on top of this floor's walls (not with low walls: they'd float)
      if (this.showRoofs && !this.lowWalls) {
        for (const roof of floor.roofs || []) this._addRoof(g, roof, floor.wall_height, wallMat);
      }

      // Lights inside the house need their shadows most (walls must stop them)
      for (const d of this._dynamic) {
        if (isLightRecord(d) && d.indoor === undefined) {
          const at = [d.light.pos.x, d.light.pos.z];
          d.indoor = indoor.some((r) => pointInPolygon(at, r.points));
        }
      }
      this._mergeStatic(g);
      this._group.add(g);
      box.expandByObject(g);
    }
    this._applyRoofOpacity();
    this._buildLightPool();

    // Ground
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const span = Math.max(size.x, size.z, 10) * 3;
      this._dayGround = this._dayBg.clone().lerp(new THREE.Color(0x808078), 0.18);
      this._groundMat = new T.MeshStandardMaterial({ color: this._dayGround.clone(), roughness: 1 });
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span), this._groundMat);
      ground.rotation.x = -Math.PI / 2;
      const minY = Math.min(0, box.min.y);
      ground.position.set(center.x, minY - SLAB - 0.01, center.z);
      ground.receiveShadow = true;
      this._group.add(ground);

      const r = Math.max(size.x, size.z) * 0.8 + 5;
      Object.assign(this._sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 200 });
      this._sun.shadow.camera.updateProjectionMatrix();
      this._center = center;
      this._sunDistance = Math.max(size.x, size.z) + 30;
    }
    this._bounds = box.isEmpty() ? null : box;

    this._applySun();
    this._invalidateShadows();
    this._syncOverlayElements();
    this._applyStates();
    if (!this._cameraPlaced) this.resetCamera();
    this.requestRender();
  }

  /**
   * Light (+ optional beam cone and bulb) for a lamp; state is applied later.
   * The actual SpotLight comes from the shared pool (see _assignLights).
   */
  /** A roof: sloped faces (textured, with a plain underside), fascia boards, gable walls. */
  _addRoof(group, roof, wallTop, wallMat) {
    const geo = roofGeometry(roof);
    if (!geo.faces.length) return;
    // The outline runs along the walls' centre lines: lift the roof by the slope over
    // half a wall's thickness so the walls' outer edges don't poke through it
    const slope = roof.type === "flat" ? 0 : Math.tan(((roof.pitch ?? 35) * Math.PI) / 180);
    wallTop += 0.16 * slope + 0.02;
    const finish = roofFinish(roof);
    const top = finishMaterial(this._T, "roof", finish);
    const under = new this._T.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.9 });
    const fascia = new this._T.MeshStandardMaterial({ color: new THREE.Color(finish.color).multiplyScalar(0.7), roughness: 0.8 });
    const [tw, th] = Array.isArray(ROOF_MATERIALS[finish.material]?.tile) ? ROOF_MATERIALS[finish.material].tile : [1, 1];
    const THICK = 0.12;
    const pos = [];
    const uv = [];
    const idx = [];
    const posU = [];
    const idxU = [];
    for (const face of geo.faces) {
      // Texture runs along the eave and up the slope (measured along the surface)
      const cos = face.slope[0] || face.slope[1] ? Math.cos(Math.atan2(Math.max(...face.pts.map((p) => p[2])) - Math.min(...face.pts.map((p) => p[2])),
        Math.max(1e-6, Math.max(...face.pts.map((p) => p[0] * face.slope[0] + p[1] * face.slope[1])) - Math.min(...face.pts.map((p) => p[0] * face.slope[0] + p[1] * face.slope[1]))))) : 1;
      const base = pos.length / 3;
      for (const [x, y, z] of face.pts) {
        pos.push(x, wallTop + z, y);
        uv.push((x * face.along[0] + y * face.along[1]) / tw, (x * face.slope[0] + y * face.slope[1]) / cos / th);
        posU.push(x, wallTop + z - THICK, y);
      }
      // Faces come ccw in plan (y down) = clockwise seen from above: flip so they face up.
      // Cut into triangles by ear clipping, not a fan: a flat roof may have inward corners
      // (an outline that steps around a bay), where a fan would cover what's outside it
      const plan = face.pts.map(([x, y]) => new THREE.Vector2(x, y));
      for (let [a, b, c] of THREE.ShapeUtils.triangulateShape(plan, [])) {
        const [pa, pb, pc] = [plan[a], plan[b], plan[c]];
        if ((pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) > 0) [b, c] = [c, b];
        idx.push(base + a, base + b, base + c);
        idxU.push(base + a, base + c, base + b);
      }
    }
    const mesh = (positions, indices, mat, uvs) => {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      if (uvs) bg.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      bg.setIndex(indices);
      bg.computeVertexNormals();
      const m = new THREE.Mesh(bg, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.roof = true;
      group.add(m);
      this._occluders.push(m);
      this._roofMeshes.push(m);
      return m;
    };
    mesh(pos, idx, top, uv);
    mesh(posU, idxU, under);
    // Fascia / barge boards along the roof's outer edges
    const fp = [];
    const fi = [];
    for (const [a, b] of geo.edges) {
      const k = fp.length / 3;
      fp.push(a[0], wallTop + a[2], a[1], b[0], wallTop + b[2], b[1], b[0], wallTop + b[2] - THICK - 0.04, b[1], a[0], wallTop + a[2] - THICK - 0.04, a[1]);
      fi.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    mesh(fp, fi, Object.assign(fascia, { side: THREE.DoubleSide }));
    // Gable and shed walls, in the wall finish
    const wp = [];
    const wi = [];
    const lift = 0.16 * slope + 0.02;
    for (const poly of geo.walls) {
      const k = wp.length / 3;
      for (const [x, y, z] of poly) wp.push(x, wallTop + z - (z <= 0 ? lift : 0), y);
      for (let j = 1; j < poly.length - 1; j++) wi.push(k, k + j, k + j + 1);
    }
    if (wp.length) mesh(wp, wi, Object.assign(wallMat.clone(), { side: THREE.DoubleSide }));
    this._applyRoofOpacity();
  }

  /** See-through roofs: faded, casting no shadows, not hiding (or blocking taps on) what's below. */
  _applyRoofOpacity() {
    const op = this.roofOpacity ?? 1;
    const solid = op >= 0.999;
    let shadowsChanged = false;
    for (const m of this._roofMeshes || []) {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (mat.transparent !== !solid) mat.needsUpdate = true;
        mat.transparent = !solid;
        mat.opacity = op;
        mat.depthWrite = solid;
      }
      m.visible = op > 0.001 && this.showRoofs !== false; // (garden structures' roofs: hidden with "Roofs" off too)
      if (m.castShadow !== solid) shadowsChanged = true;
      m.castShadow = solid;
    }
    if (shadowsChanged) this._invalidateShadows();
    this.requestRender();
  }

  _addLamp(group, marker, { top, angle, beam = true, bulb: withBulb = true, walls = [], up = false, aim = null, soft = false, lens = 0 }) {
    const y = group.position.y; // floor elevation; pooled lights live in world space
    // aim: [plan x, plan y, up] direction; otherwise straight down, or up for uplighters
    const dir = aim ? new THREE.Vector3(aim[0], aim[2], aim[1]).normalize().multiplyScalar(5) : new THREE.Vector3(0, up ? 5 : -top, 0);
    const light = {
      pos: new THREE.Vector3(marker.x, y + top, marker.y),
      target: new THREE.Vector3(marker.x, y + top, marker.y).add(dir),
      // (a frosted face fades out over its whole cone, so it has no visible edge)
      color: new THREE.Color(0xffffff), distance: Math.max(top, 1) * 4, angle, penumbra: soft ? 1 : beam ? 0.65 : 0.9,
      near: lampShadowNear(marker.x, marker.y, walls),
    };

    let cone = null;
    let coneMat = null;
    if (beam) {
      // Beam: open cone from the lamp to the floor (along its aim, for a tilted spot). A spot's
      // beam fills its lens: the cone's tip lies inside the spot, as far behind the lens as
      // makes it exactly the lens wide there (the opaque body hides that part)
      const unit = aim ? dir.clone().normalize() : new THREE.Vector3(0, -1, 0);
      const down = Math.max(0.15, -unit.y);
      const len = Math.min(top / down, light.distance);
      const back = lens > 0 ? lens / Math.tan(angle * 0.8) : 0;
      const radius = Math.tan(angle * 0.8) * (len + back);
      const coneGeo = new THREE.ConeGeometry(radius, len + back, 40, 1, true);
      coneGeo.translate(0, -(len + back) / 2, 0); // apex at the tip
      coneMat = beamMaterial();
      coneMat.clippingPlanes = this._wallClipPlanes(marker, walls, radius + len * Math.sqrt(Math.max(0, 1 - down * down)));
      cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(marker.x - unit.x * back, top - unit.y * back, marker.y - unit.z * back);
      if (aim) cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), unit);
      cone.renderOrder = 10;
      group.add(cone);
    }

    let bulbMat = null;
    if (withBulb) {
      bulbMat = new THREE.MeshBasicMaterial({ color: 0x777777 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), bulbMat);
      bulb.position.set(marker.x, top - 0.02, marker.y);
      group.add(bulb);
    }

    this._dynamic.push({ kind: "lamp", marker, light, cone, coneMat, bulbMat, intensity: 0 });
  }

  /**
   * A real door: frame in the wall opening and a panelled leaf with handles on
   * its hinge. Closed unless a linked sensor reports it open; it then swings
   * (animated) to the same side as the 2D swing symbol.
   */
  _addDoor(g, o, op, wall, at, angle, w, h) {
    const shared = this._doorMats || (this._doorMats = {
      frame: new this._T.MeshStandardMaterial({ color: 0xded8cc, roughness: 0.7 }),
      leaf: new this._T.MeshStandardMaterial({ color: 0xece7de, roughness: 0.6 }),
      panel: new this._T.MeshStandardMaterial({ color: 0xe0d9cb, roughness: 0.6 }),
      metal: new this._T.MeshStandardMaterial({ color: 0xa4a9ae, roughness: 0.3, metalness: 0.7 }),
    });
    const m = this._openingLight(shared, at((op.from + op.to) / 2, (op.sill + op.top) / 2));
    const depth = wall.thickness + 0.02;
    const addBox = (parent, sx, sy, sz, x, y, z, mat, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Frame: two jambs and a head, slightly proud of both wall faces
    const frame = new THREE.Group();
    frame.position.copy(at(op.from, op.sill));
    frame.rotation.y = angle;
    addBox(frame, FRAME, h, depth, FRAME / 2, h / 2, 0, m.frame);
    addBox(frame, FRAME, h, depth, w - FRAME / 2, h / 2, 0, m.frame);
    addBox(frame, w, FRAME, depth, w / 2, h - FRAME / 2, 0, m.frame);
    g.add(frame);

    if (o.style === "sliding_double") {
      this._addSlidingDoor(g, o, op, at, angle, w, h, m, addBox);
      return;
    }

    // Leaf on its hinge, inside the frame
    const lw = Math.max(0.1, w - 2 * FRAME - 0.006);
    const lh = Math.max(0.1, h - FRAME - 0.01);
    const hinge = new THREE.Group();
    hinge.position.copy(at(o.flip_hinge ? op.to - FRAME - 0.003 : op.from + FRAME + 0.003, op.sill));
    const base = o.flip_hinge ? angle + Math.PI : angle; // leaf points from the hinge to the other jamb
    hinge.rotation.y = base;
    const style = o.style || "panel";
    if (style === "panel") {
      addBox(hinge, lw, lh, 0.04, lw / 2, lh / 2 + 0.005, 0, m.leaf);
    } else {
      // Glass: a frame of stiles and rails around the pane(s); half glass has a solid
      // lower part (with one raised panel), full glass a slim bottom rail
      const glass = this._glassMat || (this._glassMat = new this._T.MeshStandardMaterial({
        color: 0xbfe3ff, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.1 }));
      const S = Math.min(0.11, lw * 0.16); // stile / rail width
      const half = style === "half_glass" || style === "half_glass_single";
      const bottom = half ? lh * 0.45 : 0.18; // solid part below the glass
      addBox(hinge, S, lh, 0.04, S / 2, lh / 2 + 0.005, 0, m.leaf);
      addBox(hinge, S, lh, 0.04, lw - S / 2, lh / 2 + 0.005, 0, m.leaf);
      addBox(hinge, lw - 2 * S, S, 0.04, lw / 2, lh - S / 2 + 0.005, 0, m.leaf);
      addBox(hinge, lw - 2 * S, bottom, 0.04, lw / 2, bottom / 2 + 0.005, 0, m.leaf);
      const gh = lh - S - bottom;
      addBox(hinge, lw - 2 * S, gh, 0.012, lw / 2, bottom + gh / 2 + 0.005, 0, glass, false);
      if (style === "half_glass") {
        // glazing bars: one across, one up the middle
        addBox(hinge, lw - 2 * S, 0.03, 0.03, lw / 2, bottom + gh / 2 + 0.005, 0, m.leaf, false);
        addBox(hinge, 0.03, gh, 0.03, lw / 2, bottom + gh / 2 + 0.005, 0, m.leaf, false);
      }
    }
    for (const side of [-1, 1]) {
      // Raised panels on both faces (half glass: just the lower one)
      if (style === "panel") {
        addBox(hinge, lw * 0.7, lh * 0.36, 0.008, lw / 2, lh * 0.74, side * 0.024, m.panel, false);
        addBox(hinge, lw * 0.7, lh * 0.36, 0.008, lw / 2, lh * 0.27, side * 0.024, m.panel, false);
      } else if (style === "half_glass" || style === "half_glass_single") {
        addBox(hinge, lw * 0.62, lh * 0.3, 0.008, lw / 2, lh * 0.22, side * 0.024, m.panel, false);
      }
      // Lever handle + rosette at 1 m (or halfway on a low door)
      const hy = Math.min(1.0, lh * 0.48);
      const rosette = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 20), m.metal);
      rosette.rotation.x = Math.PI / 2;
      rosette.position.set(lw - 0.07, hy, side * 0.025);
      hinge.add(rosette);
      addBox(hinge, 0.12, 0.018, 0.018, lw - 0.11, hy, side * 0.05, m.metal, false);
      addBox(hinge, 0.018, 0.018, 0.03, lw - 0.07, hy, side * 0.035, m.metal, false);
    }
    g.add(hinge);
    hinge.traverse((obj) => obj.isMesh && !obj.material.transparent && this._occluders.push(obj));

    // A negative turn swings to the wall's normal side for a start hinge; each flip mirrors that
    const swing = (!!o.flip_hinge !== !!o.flip_swing ? 1 : -1) * DOOR_OPEN_ANGLE;
    this._dynamic.push({ kind: "door", opening: o, hinge, base, swing, open: 0, target: 0, placed: false });
  }

  /**
   * Double sliding door: two leaves meeting in the middle, each a timber frame around
   * a glass panel with a recessed handle. Opening (with a sensor) slides them apart,
   * into the wall on both sides like pocket doors.
   */
  _addSlidingDoor(g, o, op, at, angle, w, h, m, addBox) {
    const glass = this._glassMat || (this._glassMat = new this._T.MeshStandardMaterial({
      color: 0xbfe3ff, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.1 }));
    const inner = Math.max(0.2, w - 2 * FRAME);
    const lw = inner / 2 + 0.01; // a little overlap where they meet
    const lh = Math.max(0.1, h - FRAME - 0.01);
    const S = Math.min(0.1, lw * 0.18); // stiles and rails
    const track = new THREE.Group();
    track.position.copy(at(op.from + FRAME, op.sill));
    track.rotation.y = angle;
    g.add(track);
    const leaves = [];
    for (const dir of [-1, 1]) {
      const leaf = new THREE.Group();
      const x0 = dir < 0 ? 0 : inner - lw; // left leaf from the left jamb, right leaf from the right
      leaf.position.x = x0;
      addBox(leaf, S, lh, 0.04, S / 2, lh / 2 + 0.005, 0, m.leaf);
      addBox(leaf, S, lh, 0.04, lw - S / 2, lh / 2 + 0.005, 0, m.leaf);
      addBox(leaf, lw - 2 * S, S, 0.04, lw / 2, lh - S / 2 + 0.005, 0, m.leaf);
      addBox(leaf, lw - 2 * S, S * 1.4, 0.04, lw / 2, (S * 1.4) / 2 + 0.005, 0, m.leaf);
      addBox(leaf, lw - 2 * S, lh - S * 2.4, 0.012, lw / 2, S * 1.4 + (lh - S * 2.4) / 2 + 0.005, 0, glass, false);
      // recessed handle on the stile at the meeting edge
      const hx = dir < 0 ? lw - S / 2 : S / 2;
      for (const side of [-1, 1]) addBox(leaf, 0.025, 0.16, 0.006, hx, Math.min(1.0, lh * 0.48), side * 0.021, m.metal, false);
      track.add(leaf);
      leaf.traverse((obj) => obj.isMesh && !obj.material.transparent && this._occluders.push(obj));
      leaves.push({ leaf, x0, dir });
    }
    this._dynamic.push({ kind: "door", opening: o, sliding: true, leaves, travel: lw * 0.92, open: 0, target: 0, placed: false });
  }

  /** Pose a door for `t` (0 closed .. 1 open): a swing about its hinge, or leaves sliding apart. */
  _poseDoor(d, t) {
    if (d.sliding) for (const l of d.leaves) l.leaf.position.x = l.x0 + l.dir * d.travel * t;
    else d.hinge.rotation.y = d.base + d.swing * t;
  }

  /**
   * A real window: frame, sill and one or two casement sashes with glass and a
   * handle. Closed unless a linked sensor reports it open; the sashes then swing
   * (animated) to the side chosen with "Flip opening".
   */
  _addWindow(g, o, op, wall, at, angle, w, h) {
    const shared = this._windowMats || (this._windowMats = {
      frame: new this._T.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.5 }),
      glass: new this._T.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1 }),
      metal: new this._T.MeshStandardMaterial({ color: 0xb4b9be, roughness: 0.3, metalness: 0.7 }),
    });
    const m = this._openingLight(shared, at((op.from + op.to) / 2, (op.sill + op.top) / 2));
    const addBox = (parent, sx, sy, sz, x, y, z, mat, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const F = Math.min(WINDOW_FRAME, w / 4, h / 4);
    const depth = Math.min(wall.thickness, 0.09) + 0.01;

    const frame = new THREE.Group();
    frame.position.copy(at(op.from, op.sill));
    frame.rotation.y = angle;
    addBox(frame, F, h, depth, F / 2, h / 2, 0, m.frame);
    addBox(frame, F, h, depth, w - F / 2, h / 2, 0, m.frame);
    addBox(frame, w, F, depth, w / 2, F / 2, 0, m.frame);
    addBox(frame, w, F, depth, w / 2, h - F / 2, 0, m.frame);
    // Sill sticking out on both sides of the wall
    addBox(frame, w + 0.08, 0.025, wall.thickness + 0.08, w / 2, -0.0125, 0, m.frame);
    g.add(frame);

    const iw = w - 2 * F;
    const ih = h - 2 * F;
    if (iw <= 0.1 || ih <= 0.1) return;
    // One sash on the hinge side, or two opening from the middle on wide windows
    const sashes = iw > DOUBLE_SASH_FROM
      ? [{ right: false }, { right: true }]
      : [{ right: !!o.flip_hinge }];
    const sw = iw / sashes.length;
    for (const { right } of sashes) {
      const hinge = new THREE.Group();
      hinge.position.set(right ? w - F : F, F, 0);
      hinge.rotation.y = right ? Math.PI : 0; // sash points from its hinge into the opening
      const s = Math.min(SASH, sw / 4, ih / 4);
      addBox(hinge, s, ih, 0.06, s / 2, ih / 2, 0, m.frame);
      addBox(hinge, s, ih, 0.06, sw - s / 2, ih / 2, 0, m.frame);
      addBox(hinge, sw, s, 0.06, sw / 2, s / 2, 0, m.frame);
      addBox(hinge, sw, s, 0.06, sw / 2, ih - s / 2, 0, m.frame);
      addBox(hinge, sw - 2 * s, ih - 2 * s, 0.012, sw / 2, ih / 2, 0, m.glass, false);
      for (const side of [-1, 1]) addBox(hinge, 0.02, 0.11, 0.02, sw - s / 2, ih / 2, side * 0.04, m.metal, false);
      frame.add(hinge);
      // Same rule as doors: a sash hinged at the opening start swings to the wall's
      // normal side with a negative turn; a right-hand hinge and "Flip opening" mirror it
      const swing = (right !== !!o.flip_swing ? 1 : -1) * WINDOW_OPEN_ANGLE;
      this._dynamic.push({ kind: "door", opening: o, hinge, base: hinge.rotation.y, swing, open: 0, target: 0, placed: false });
    }
  }

  /** Soft bluish light shining out of a big screen (TV, projector screen) while it's on. */
  /**
   * Light profile: a door's or window's own copy of the shared materials, lit by the lamps
   * around `pos` (bakedlight.js); otherwise the shared ones.
   */
  _openingLight(mats, pos) {
    if (!this._surface) return mats;
    const uniform = { value: new THREE.Color(0, 0, 0) };
    const own = Object.fromEntries(Object.entries(mats).map(([k, mat]) => [k, mat.clone()]));
    Object.values(own).forEach((mat) => addLampLight(mat, uniform));
    this._surface.addProbe([pos.x, pos.y, pos.z], uniform, null);
    return own;
  }

  _addScreenLight(g, f, sl, base) {
    const [x, y] = toWorld(f, [0, (sl.y - 0.5) * f.d]);
    const [tx, ty] = toWorld(f, [0, f.d / 2 + 3]); // 3 m in front of the screen
    const height = base + sl.z * f.h;
    const e = g.position.y;
    const light = {
      pos: new THREE.Vector3(x, e + height, y),
      target: new THREE.Vector3(tx, e + Math.max(0.3, height - 0.6), ty),
      color: new THREE.Color(0xb8d4ff), distance: 7, angle: 1.25, penumbra: 1,
      near: 0.15, // shadows start in front of the screen itself
    };
    // Shares the lamps' light pool; intensity is set in _applyStates
    this._dynamic.push({ kind: "screenlight", f, light, intensity: 0 });
  }

  /**
   * One light slot per lamp, up to MAX_LIGHTS; handed out by _assignLights(). A slot is
   * a SpotLight with a PointLight partner (spot.userData.point): lamps that shine in a
   * narrow cone use the spot, wide ones (ceiling lights, pendants) the point light. A
   * single spot shadow map can't cover a very wide cone evenly (its edges come out as
   * stripes and staircases); a point light's six 90° shadow maps can.
   */
  _buildLightPool() {
    if (this._q?.baked) {
      this._lightPool = []; // lamps light through bakedlight.js
      return;
    }
    const count = Math.min(this._q?.maxLights ?? MAX_LIGHTS, this._dynamic.filter(isLightRecord).length);
    this._lightPool = [];
    for (let i = 0; i < count; i++) {
      const spot = new THREE.SpotLight(0xffffff, 0, 1, 1, 0.5, 1.6);
      // Shadows are switched on per light by _assignShadows() (limited GPU slots)
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0005;
      // Small: furniture often stands against a wall (a headboard 1-2 cm off it); a bigger
      // offset samples the shadow from inside it, and light shows along its top edge
      spot.shadow.normalBias = 0.008;
      spot.shadow.autoUpdate = false;
      const point = new THREE.PointLight(0xffffff, 0, 1, 1.6);
      point.visible = false;
      point.shadow.mapSize.set(512, 512); // per side of its six-sided shadow map
      // Slightly positive: no hairline of light where walls meet (normalBias keeps lit walls clean)
      point.shadow.bias = 0.003;
      // (point lights keep 2 cm: their coarser maps speckle thin edges such as door frames
      // at less, and ceiling lights shine on headboards from above anyway)
      point.shadow.normalBias = 0.02;
      point.shadow.autoUpdate = false;
      spot.userData.point = point;
      this._group.add(spot, spot.target, point);
      this._lightPool.push(spot);
    }
  }

  /**
   * Give the pooled lights to the lamps that are on. With more lamps on than
   * lights, the closest lamps share one light (at their brightness-weighted
   * centre, with their summed intensity), so every lamp still lights the room.
   */
  _assignLights() {
    if (this._q?.baked) return; // no real lights (see _updateBaked)
    const pool = this._lightPool || [];
    let groups = this._dynamic.filter((d) => isLightRecord(d) && d.intensity > 0)
      .map((d) => ({ kind: d.kind, members: [d], intensity: d.intensity, pos: d.light.pos.clone(),
        dir: d.light.target.clone().sub(d.light.pos).normalize() }));
    // More lamps on than lights: merge pairs. Lamps far from what's being looked at go
    // first (a garden full of spots while looking at a bedroom), so the lamps in view
    // keep a light of their own; a merged light sits between its lamps, which for two
    // bedside lamps is inside the bed.
    const target = this._controls?.target;
    const away = (g) => (target ? g.pos.distanceTo(target) : 0);
    const cost = (a, b) => {
      let c = a.pos.distanceTo(b.pos) / (1 + (Math.min(away(a), away(b)) / 4) ** 2);
      if (a.kind !== b.kind) c += 1000; // screens (light sideways) only merge with screens
      if (a.dir.dot(b.dir) < 0.5) c += 100; // nor up-lights with lamps shining down
      return c;
    };
    while (groups.length > pool.length) {
      let best = null;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const c = cost(groups[i], groups[j]);
          if (!best || c < best.c) best = { i, j, c };
        }
      }
      const a = groups[best.i];
      const b = groups[best.j];
      const total = a.intensity + b.intensity;
      a.pos.multiplyScalar(a.intensity / total).addScaledVector(b.pos, b.intensity / total);
      a.members.push(...b.members);
      a.intensity = total;
      groups.splice(best.j, 1);
    }
    pool.forEach((spot, i) => {
      const g = groups[i];
      if (!g) {
        spot.intensity = 0; // stays a number (never removing the light) so shaders don't recompile
        spot.userData.point.intensity = 0;
        return;
      }
      const lead = g.members.reduce((m, d) => (d.intensity > m.intensity ? d : m));
      const l = lead.light;
      // Lamps far apart (two bedside lamps): their middle may be inside furniture, where
      // the light would be shut in; shine from the brightest one instead
      if (g.members.some((d) => d.light.pos.distanceTo(g.pos) > 1)) g.pos.copy(l.pos);
      spot.position.copy(g.pos);
      spot.target.position.copy(l.target).add(g.pos).sub(l.pos); // same direction as the lead lamp
      // A shared light spreads wider and further, covering all its lamps
      const spread = Math.min(1, Math.max(...g.members.map((d) => d.light.pos.distanceTo(g.pos))));
      Object.assign(spot, {
        intensity: g.intensity,
        distance: l.distance + spread,
        angle: Math.min(1.45, Math.max(...g.members.map((d) => d.light.angle)) + Math.atan2(spread, Math.max(l.pos.y - l.target.y, 0.5))),
        penumbra: l.penumbra,
      });
      spot.color.setRGB(0, 0, 0);
      g.members.forEach((d) => spot.color.add(d.light.color.clone().multiplyScalar(d.intensity / g.intensity)));
      // (a shared light starts its shadow map before the nearest wall of any of its lamps)
      const near = Math.min(...g.members.map((d) => d.light.near));
      // (three.js only refreshes a shadow camera when its angle or range changes)
      const setNear = (cam) => {
        if (cam.near === near) return;
        cam.near = near;
        cam.updateProjectionMatrix();
        this._invalidateShadows();
      };
      setNear(spot.shadow.camera);
      spot.userData.indoor = g.members.some((d) => d.indoor);
      spot.updateMatrixWorld();
      spot.target.updateMatrixWorld();
      // Wide lamps light the room as a point light (screens keep their sideways cone)
      const point = spot.userData.point;
      // (lamps shining upwards stay spots: a point light would also light the floor beside them,
      // unless they glow all round, like a Hue Go: catalog `light.all`)
      const up = l.target.y > l.pos.y;
      const all = !!(lead.marker?.type && catalogItem(lead.marker.type).light?.all);
      const wide = g.kind !== "screenlight" && (all || (!up && spot.angle >= WIDE_LAMP));
      if (point.visible !== wide) this._invalidateShadows();
      point.visible = wide;
      spot.visible = !wide;
      if (wide) {
        point.position.copy(g.pos);
        // Same light output as the lamp's soft cone gave (a point light shines fully everywhere)
        Object.assign(point, { intensity: g.intensity * coneShare(spot.angle, spot.penumbra), distance: spot.distance, decay: spot.decay });
        point.color.copy(spot.color);
        setNear(point.shadow.camera);
        point.updateMatrixWorld();
      }
    });
  }


  /**
   * Sound waves on the floor around a speaker: two rings growing outwards, drawn by a
   * shader on the area the sound reaches (cut off at walls, like on the plan).
   */
  _addPulse(floorGroup, f, pieceGroup, floor) {
    const r0 = Math.max(f.w, f.d) / 2 + 0.06;
    const grow = 1.3;
    const area = soundArea([f.x, f.y], r0 * (1 + grow), floor);
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(area.map(([x, y]) => new THREE.Vector2(x, y)))),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uCenter: { value: new THREE.Vector2(f.x, f.y) }, uR0: { value: r0 }, uGrow: { value: grow },
          uPhase: { value: new THREE.Vector2(0, 0.5) }, uColor: { value: new THREE.Color(0xffb300) }, uAlpha: { value: 1 } },
        vertexShader: `varying vec2 vPlan;
          void main() { vPlan = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec2 uCenter; uniform float uR0; uniform float uGrow; uniform vec2 uPhase; uniform vec3 uColor; uniform float uAlpha;
          varying vec2 vPlan;
          float ring(float d, float phase) {
            float r = uR0 * (1.0 + phase * uGrow);
            return (d > r * 0.93 && d < r) ? 0.8 * (1.0 - phase) : 0.0;
          }
          void main() {
            float d = distance(vPlan, uCenter);
            float a = max(ring(d, uPhase.x), ring(d, uPhase.y));
            if (a <= 0.0) discard;
            gl_FragColor = vec4(uColor, a * uAlpha);
          }`,
      })
    );
    mesh.rotation.x = Math.PI / 2; // plan (x, y) -> world (x, z)
    mesh.position.y = pieceGroup.position.y + 0.012;
    mesh.visible = false;
    floorGroup.add(mesh);
    this._pulses.push({ f, def: catalogItem(f.type), pieces: this._pulsePieces, group: pieceGroup, mesh, active: false });
  }

  /** Robot vacuums at their current spot (driving lanes while cleaning, see robot.js). */
  _poseRobots() {
    for (const r of this._robots || []) {
      const pose = robotPose(this._hass, r.f, r.rooms);
      r.group.position.x = pose.x;
      r.group.position.z = pose.y;
      r.group.rotation.y = (-pose.rotation * Math.PI) / 180;
    }
  }

  /**
   * Washing machines and dryers that run: the drum tumbles one way, rests, then turns
   * back (about 50 rpm, like a real wash), the laundry carried a little way up its side
   * before it falls back. The final spin of a wash is fast: the laundry pressed against
   * the drum goes round with it and the machine shakes.
   */
  _animateLaundry(dt, t) {
    const TURN = 0.85; // revolutions per second while tumbling
    for (const l of this._laundry) {
      if (!l.state.running) continue;
      let target;
      if (l.state.spinning) {
        target = 4.5;
      } else {
        // 9 s cycle: 3.5 s one way, a pause, 3.5 s back, a pause
        const c = (t + l.f.x * 3) % 9;
        const ramp = (u) => Math.min(1, u / 0.5, (3.5 - u) / 0.5); // speed up and slow down over 0.5 s
        target = c < 3.5 ? TURN * ramp(c) : c >= 4.5 && c < 8 ? -TURN * ramp(c - 4.5) : 0;
      }
      // Speed follows the target smoothly (the motor needs a moment, especially for the spin)
      l.speed += (target - l.speed) * Math.min(1, dt * (l.state.spinning ? 0.8 : 6));
      l.angle = (l.angle + dt * l.speed * Math.PI * 2) % (Math.PI * 2);
      const spin = Math.abs(l.speed) > 2;
      // Tumbling: the load is lifted towards the side the drum turns to (up to ~40°) and wobbles
      const sway = spin ? l.angle : (0.7 * l.speed) / TURN + 0.06 * Math.sin(t * 7);
      const shake = spin ? Math.min(1, (Math.abs(l.speed) - 2) / 2) * 0.0025 : 0;
      this._poseLaundry(l, l.angle, sway, shake ? [Math.sin(t * 157) * shake, Math.abs(Math.sin(t * 131)) * shake * 0.6, Math.cos(t * 173) * shake] : null);
    }
  }

  _poseLaundry(l, angle, sway, shake) {
    l.drum.rotation.z = angle;
    if (l.load) l.load.rotation.z = sway;
    l.group.position.copy(l.base);
    if (shake) l.group.position.add(new THREE.Vector3(...shake));
    if (!l.state.running) [l.angle, l.speed] = [0, 0];
  }

  /** Runs only while something is playing, so idle dashboards don't keep rendering. */
  _startPulseLoop() {
    const doorsMoving = () => this._dynamic?.some((d) => d.kind === "door" && d.open !== d.target);
    const moving = () => this._pulses?.some((p) => p.active) || this._spinners?.some((s) => s.active) || doorsMoving()
      || this._laundry?.some((l) => l.state.running)
      || this._robots?.some((r) => robotBusy(this._hass, r.f));
    // Ambilight colours drift slowly and TV programmes are tiny: a few redraws a second are plenty
    const ambis = () => (this._dynamic || []).filter((d) => d.ambilight?.uniforms.uStrength.value > 0 && !d.ambilight.uniforms.uMode.value);
    const tvOn = () => (this._dynamic || []).some((d) => d.playing);
    const still = reducedMotion();
    const slow = (now) => {
      ambis().forEach((d) => (d.ambilight.uniforms.uTime.value = now / 1000));
      for (const d of this._dynamic) if (d.playing) d.tv.draw(now / 1000);
    };
    const busy = () => moving() || (!still && (ambis().length > 0 || tvOn()));
    if (this._pulseRaf || !this._renderer || !busy()) return;
    let last = performance.now();
    let lastAmbi = 0;
    const frame = 1000 / (this._q?.fps || 60) - 2; // the profile's animation frame rate
    let drawn = 0;
    const tick = () => {
      this._pulseRaf = null;
      if (!busy() || !this.isConnected) return;
      const now = performance.now();
      if (now - drawn < frame) {
        this._pulseRaf = requestAnimationFrame(tick);
        return;
      }
      drawn = now;
      if (!moving()) {
        if (now - lastAmbi > 80) {
          lastAmbi = now;
          slow(now);
          this.requestRender();
        }
        last = now;
        this._pulseRaf = requestAnimationFrame(tick);
        return;
      }
      if (!still) slow(now);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Doors swing towards their target; shadows are redrawn when they settle
      for (const d of this._dynamic) {
        if (d.kind !== "door" || d.open === d.target) continue;
        const step = dt / DOOR_SWING_TIME;
        d.open = d.target > d.open ? Math.min(d.target, d.open + step) : Math.max(d.target, d.open - step);
        this._poseDoor(d, easeInOut(d.open));
        if (d.open === d.target) this._invalidateShadows();
      }
      this._poseRobots();
      // Fans linked to a fan entity spin while on, faster at higher speed settings
      if (!still) for (const s of this._spinners) if (s.active) s.spinner.rotation.y -= dt * s.speed * Math.PI * 2;
      if (!still) this._animateLaundry(dt, now / 1000);
      const active = this._pulses.filter((p) => p.active);
      const t = now / PULSE_PERIOD;
      for (const p of active) {
        p.mesh.material.uniforms.uPhase.value.set(still ? 0.35 : t % 1, still ? 0.85 : (t + 0.5) % 1);
        // Speakers beat gently; screens (TVs) don't move
        if (!p.def.screen && !still) p.group.scale.setScalar(1 + 0.04 * Math.max(0, Math.sin(t * 2 * Math.PI)));
      }
      this.requestRender();
      if (!still) this._pulseRaf = requestAnimationFrame(tick);
    };
    this._pulseRaf = requestAnimationFrame(tick);
  }

  /**
   * Planes at the inner face of every wall the lamp faces within reach, so the
   * beam cone is cut off there instead of poking through to the outside.
   */
  _wallClipPlanes(lamp, walls, reach) {
    const planes = [];
    for (const w of walls) {
      const c = projectOnSegment([lamp.x, lamp.y], w.a, w.b);
      if (c.t <= 0 || c.t >= 1 || c.d < 1e-3 || c.d > reach + w.thickness) continue;
      const n = [(lamp.x - c.point[0]) / c.d, (lamp.y - c.point[1]) / c.d]; // towards the lamp
      const face = [c.point[0] + (n[0] * w.thickness) / 2, c.point[1] + (n[1] * w.thickness) / 2];
      planes.push(new THREE.Plane(new THREE.Vector3(n[0], 0, n[1]), -(n[0] * face[0] + n[1] * face[1])));
    }
    // Nearest walls matter most; keep the shader cheap
    return planes.sort((a, b) => Math.abs(a.distanceToPoint(new THREE.Vector3(lamp.x, 0, lamp.y))) -
      Math.abs(b.distanceToPoint(new THREE.Vector3(lamp.x, 0, lamp.y)))).slice(0, 8);
  }

  /**
   * Give shadows to the lights that are on (those near what's being looked at first),
   * up to the GPU budget. Lights that are off emit nothing, so they need no shadow.
   */
  _assignShadows() {
    // Only so many lights can cast shadows, and a light without one shines through
    // walls. What matters is the leak you'd see: lights near what's being looked at
    // come first, also dim ones (a Hue Go at 40% leaking into the next rooms shows more
    // than a bright garden spot far away), then lights in the house over outdoor ones.
    // Brightness only counts a little.
    const target = this._controls?.target;
    const score = (l) => Math.sqrt(l.intensity) * (l.userData.indoor ? 4 : 1)
      / (1 + (target ? l.position.distanceTo(target) / 4 : 0) ** 2);
    const lights = [...(this._lightPool || [])].sort((a, b) => score(b) - score(a));
    let changed = false;
    lights.forEach((spot, i) => {
      const want = spot.intensity > 0 && i < this._shadowBudget;
      // The slot's light in use casts the shadow (a wide lamp's point light, else the spot)
      const point = spot.userData.point;
      for (const [light, on] of [[spot, want && !point.visible], [point, want && point.visible]]) {
        if (light.castShadow !== on) {
          light.castShadow = on;
          changed = true;
        }
      }
      // The most prominent lamps get sharper shadow edges
      const sharp = want && i < (this._q?.sharpShadows ?? SHARP_SHADOWS);
      for (const [light, size] of [[spot, sharp ? 2048 : 1024], [point, sharp ? 1024 : 512]]) {
        if (light.shadow.mapSize.x !== size) {
          light.shadow.mapSize.set(size, size);
          light.shadow.map?.dispose();
          light.shadow.map = null;
          changed = true;
        }
      }
    });
    if (changed) this._invalidateShadows();
  }

  _invalidateShadows() {
    this._shadowsDirty = true;
  }

  /**
   * Redraw shadow maps. With "Low walls" the lamps' shadows are drawn with the
   * hidden full-height walls present (so light can't spill over the lowered
   * walls), the sun's without them (so it casts no shadows of invisible walls).
   */
  _renderShadows() {
    this._shadowsDirty = false;
    const r = this._renderer;
    const lamps = (this._lightPool || []).flatMap((s) => [s, s.userData.point]).filter((l) => l?.castShadow).map((l) => l.shadow);
    const casters = this._shadowCasters || [];
    if (casters.length && lamps.length) {
      casters.forEach((c) => (c.visible = true));
      lamps.forEach((s) => (s.needsUpdate = true));
      this._sun.shadow.needsUpdate = false;
      r.shadowMap.needsUpdate = true;
      r.render(this._scene, this._camera); // shadow pass for lamps; the image is redrawn right after
      casters.forEach((c) => (c.visible = false));
      lamps.forEach((s) => (s.needsUpdate = false));
    } else {
      lamps.forEach((s) => (s.needsUpdate = true));
    }
    this._sun.shadow.needsUpdate = true;
    r.shadowMap.needsUpdate = true;
  }

  _texture(url) {
    let t = this._textures.get(url);
    if (!t) {
      t = new THREE.TextureLoader().load(url, () => this.requestRender());
      t.colorSpace = THREE.SRGBColorSpace;
      this._textures.set(url, t);
    }
    // Clone so disposing the material does not drop the cached image
    const c = t.clone();
    c.needsUpdate = true;
    return c;
  }

  /** First solid thing under a screen point (of `objects`): { point, object } or null. */
  _pick(clientX, clientY, objects = this._group.children, all = false) {
    const rect = this._renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this._camera);
    const visible = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    // The ground around the house counts as empty space
    // See-through things don't catch taps: glass, light beams, and roofs below full opacity
    // (also roof parts with several materials, e.g. tiles on top and boards underneath)
    const seeThrough = (o) => (o.userData.roof && (this.roofOpacity ?? 1) < 0.999)
      || (Array.isArray(o.material) ? o.material.every((m) => !m || m.transparent) : o.material?.transparent || o.material?.isShaderMaterial);
    const hits = ray.intersectObjects(objects, true).filter((h) => h.object.isMesh && visible(h.object) && h.object.material !== this._groundMat
      && !seeThrough(h.object));
    return all ? hits : hits[0] || null;
  }

  /**
   * What a tap lands on: the first piece with an entity, or a room. Pieces without an
   * entity (a kapschuur's beams, a sofa, a fence) let the tap through to what's behind.
   */
  _pickTap(clientX, clientY) {
    for (const hit of this._pick(clientX, clientY, this._tapMeshes || [], true)) {
      const t = this._tapTarget(hit);
      if (t.piece?.entity_id || t.room) return t;
    }
    return { piece: null, room: null };
  }

  /** The piece or room a pick landed on. */
  _tapTarget(hit) {
    let piece = null;
    let room = null;
    for (let o = hit?.object; o && !piece && !room; o = o.parent) {
      piece = o.userData.furniture || null;
      room = o.userData.room || null;
    }
    return { piece, room };
  }

  /** Fly the camera towards a point, closer in, keeping the viewing direction. */
  focusOn(point) {
    const offset = this._camera.position.clone().sub(this._controls.target);
    const dist = Math.max(2.5, offset.length() * 0.45);
    const target = point.clone();
    this._flyTo(target, target.clone().add(offset.setLength(dist)));
  }

  _flyTo(target, position) {
    cancelAnimationFrame(this._flight);
    if (reducedMotion()) {
      this._controls.target.copy(target);
      this._camera.position.copy(position);
      this._controls.update();
      return;
    }
    const t0 = this._controls.target.clone();
    const p0 = this._camera.position.clone();
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / FLY_MS);
      const e = 1 - Math.pow(1 - k, 3); // ease out
      this._controls.target.lerpVectors(t0, target, e);
      this._camera.position.lerpVectors(p0, position, e);
      this._controls.update();
      if (k < 1) this._flight = requestAnimationFrame(step);
    };
    this._flight = requestAnimationFrame(step);
  }

  resetCamera(top = false, animate = false) {
    if (!this._camera) return;
    if (animate) {
      // Work out the overview pose, then fly there from where we are
      const [t, p] = [this._controls.target.clone(), this._camera.position.clone()];
      this.resetCamera(top);
      const [t1, p1] = [this._controls.target.clone(), this._camera.position.clone()];
      this._controls.target.copy(t);
      this._camera.position.copy(p);
      this._controls.update();
      this._flyTo(t1, p1);
      return;
    }
    const box = this._bounds;
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(10, 3, 10);
    const radius = Math.max(size.x, size.z, 4);
    const d = radius * 1.3 + 2;
    if (top) {
      this._camera.position.set(center.x, center.y + d * 1.4, center.z + 0.01);
    } else {
      this._camera.position.set(center.x + d * 0.6, center.y + d * 0.75, center.z + d * 0.9);
    }
    this._controls.target.copy(center);
    this._controls.update();
    this._cameraPlaced = !!box && this.clientWidth > 0;
    this.requestRender();
  }

  // ---------- entity state ----------

  _applyStates() {
    if (!this._renderer || !this._hass) return;
    const states = this._hass.states;
    const dim = this.dimLights ? 0.3 : 1; // while editing
    for (const d of this._dynamic) {
      if (d.kind === "room") {
        const { active, stateObj: st } = roomHighlight(this._hass, d.room);
        // A chosen floor finish keeps its own colour; plain floors use a pale room colour
        const base = d.finishColor ? d.finishColor.clone()
          : new THREE.Color(d.room.color || "#8ab4f8").lerp(new THREE.Color(0xf2f1ed), 0.65);
        if (active && d.hasLamp) {
          // Real light does the work; just warm the floor slightly
          d.mat.color.copy(base.clone().lerp(new THREE.Color(activeColor(st, d.room.color)), 0.25));
          d.mat.emissive.setRGB(0, 0, 0);
        } else if (active && d.finishColor) {
          // A floor finish (grass, planks, tiles) stays itself: its area's lights only add a glow
          const c = new THREE.Color(activeColor(st, d.room.color));
          d.mat.color.copy(base.clone().lerp(c, 0.2));
          d.mat.emissive.copy(c);
          d.mat.emissiveIntensity = 0.12 * brightness(st);
        } else if (active) {
          const c = new THREE.Color(activeColor(st, d.room.color));
          d.mat.color.copy(c);
          d.mat.emissive.copy(c);
          d.mat.emissiveIntensity = 0.35 * brightness(st);
        } else {
          d.mat.color.copy(base);
          d.mat.emissive.setRGB(0, 0, 0);
        }
      } else if (d.kind === "screenlight") {
        const on = isScreenOn(states[d.f.entity_id]);
        // A bit brighter at night, when a TV is what you notice in a dark room
        d.intensity = on ? (9 + 6 * (1 - (this.sun?.daylight ?? 1))) * dim : 0;
      } else if (d.kind === "door") {
        // Closed without a sensor; otherwise follow it (animated, see _startPulseLoop)
        d.target = d.opening.entity_id && isActive(states[d.opening.entity_id]) ? 1 : 0;
        if (!d.placed || reducedMotion()) {
          d.open = d.target; // first build (or reduced motion): no animation
          d.placed = true;
          this._poseDoor(d, d.open);
        }
      } else if (d.kind === "lamp") {
        const light = d.lightOf ? d.lightOf() : activeLight(this._hass, d.marker.entity_id);
        const color = new THREE.Color(light ? light.color : "#000");
        // Small lamps (a Hue Go) give less light than a ceiling or floor lamp: catalog `light.power`
        // ... and the lamp's own strength setting (Light strength slider)
        const power = (d.marker.type ? catalogItem(d.marker.type).light?.power ?? 1 : 1) * (d.marker.light_strength ?? 1);
        d.intensity = light ? (d.lightOf ? 70 : 40) * power * light.level * dim : 0;
        if (light) d.light.color.copy(color);
        if (d.cone) {
          d.cone.visible = !!light;
          d.coneMat.uniforms.uColor.value.copy(color);
          // Beams read better (and look more like real light) at night
          const boost = 1 + 0.7 * (1 - (this.sun?.daylight ?? 1));
          d.coneMat.uniforms.uStrength.value = light ? (0.35 + 0.65 * light.level) * boost * dim : 0;
        }
        d.bulbMat?.color.copy(light ? color.clone().lerp(new THREE.Color(1, 1, 1), 0.5) : new THREE.Color(0x777777));
      } else if (d.kind === "furniture") {
        const st = states[d.f.entity_id];
        const on = d.def.fov ? cameraAlerts(this._hass, d.f.entity_id).length > 0
          : !!d.f.entity_id && (d.def.screen ? isScreenOn(st) : d.def.heater ? isHeating(st) : isActive(st));
        const light = activeLight(this._hass, d.f.entity_id);
        for (const m of d.mats.shade) {
          // A lit shade glows in the light's colour
          m.emissive.set(light ? light.color : "#000");
          m.emissiveIntensity = light ? 0.7 + 0.6 * light.level : 0;
        }
        // The Frame shows art whenever it isn't showing TV (Art Mode), dimmed in daylight's glare
        const watching = on && !(d.art && /art/i.test(st?.attributes?.source || ""));
        const artMode = !!d.art && !watching && st?.state !== "unavailable";
        if (d.display && watching) d.display.update(st);
        for (const m of d.mats.screen) {
          if (d.display) {
            m.emissive.set(watching ? "#ffffff" : "#000");
            m.emissiveIntensity = watching ? 1.1 : 0;
            continue;
          }
          if (d.art) m.emissiveMap = artMode ? d.art : d.tv?.texture || null;
          m.emissive.set(artMode ? "#ffffff" : watching && d.def.screen ? (d.tv ? "#ffffff" : "#9cc9ff") : "#000");
          m.emissiveIntensity = artMode ? 0.75 : watching && d.def.screen ? (d.tv ? 1.8 : 0.9) : 0;
        }
        // Fed through its input (an Apple TV, or a receiver like the NAD): show what's playing
        const source = d.tv && watching && d.def.av === "display" ? tvSource(this._hass, d.f, d.pieces) : null;
        d.tv?.setSource(source);
        // The programme runs while the TV is on, and holds its picture when paused
        d.playing = !!d.tv && watching && st?.state !== "paused" && !source?.paused && !source?.picture;
        if (d.ambilight) {
          // Linked to a light (e.g. a TV's Ambilight entity): its colour; otherwise drifting colours
          const u = d.ambilight.uniforms;
          u.uStrength.value = on ? (0.55 + 0.6 * (1 - (this.sun?.daylight ?? 1))) * dim : 0;
          u.uMode.value = light ? 1 : 0;
          if (light) u.uColor.value.set(light.color);
          if (!u.uTime.value) u.uTime.value = performance.now() / 1000;
        }
        // Media players show sound rings instead; a tint would muddy black speakers (and robots
        // show they're at work by driving)
        const tint = on && !d.def.screen && !d.def.light && !d.def.robot && !light && domainOf(d.f.entity_id) !== "media_player";
        // A heating radiator warms up to orange-red, more so the harder it heats (e.g. Tado's
        // heating power %); a glow alone would wash out to white on a white radiator
        const heat = tint && d.def.heater ? heatLevel(st) : 0;
        for (const m of d.mats.main) {
          if (m.userData.baseColor) m.color.copy(m.userData.baseColor).lerp(HOT, heat ? 0.45 + 0.35 * heat : 0);
          m.emissive.set(tint ? (d.def.heater ? "#ff3a10" : d.def.fov ? "#ff3b30" : activeColor(st, "#ffb300")) : "#000");
          m.emissiveIntensity = tint ? (d.def.heater ? 0.25 + 0.25 * heat : 0.25) : 0;
        }
      }
    }
    for (const l of this._laundry || []) {
      l.state = laundryState(this._hass, l.f.entity_id, { washer: l.def.laundry === "washer" });
      if (!l.state.running) this._poseLaundry(l, 0, 0, null);
    }
    for (const s of this._spinners || []) {
      const st = states[s.f.entity_id];
      s.active = domainOf(s.f.entity_id) === "fan" && isActive(st);
      s.speed = 0.6 + 1.6 * ((st?.attributes?.percentage ?? 60) / 100); // revolutions per second
    }
    for (const p of this._pulses || []) {
      const st = states[p.f.entity_id];
      p.active = pieceSounding(this._hass, p.f, p.pieces || []);
      p.mesh.visible = p.active;
      p.mesh.material.uniforms.uColor.value.set(activeColor(st, "#ffb300"));
      // Sonos surrounds playing music: ambient level, softer rings
      p.mesh.material.uniforms.uAlpha.value = p.f.surround && p.def.surround && surroundLevel(this._hass, p.f.entity_id) < 1 ? 0.45 : 1;
      if (!p.active) p.group.scale.setScalar(1);
    }
    this._assignLights();
    this._assignShadows();
    this._updateBaked();
    this._poseRobots();
    this._startPulseLoop();
    this._updateOverlayContent();
    // Shadow maps only depend on where the lights are and which cast shadows (not on their
    // colour or brightness): redrawing them for every state change is costly on slow devices
    const lights = this._lightSignature();
    if (lights !== this._lastLightSignature) {
      this._lastLightSignature = lights;
      this._invalidateShadows();
    }
    this.requestRender();
  }

  /**
   * Light profile: colour the floors' light grids and the furniture for the lamps that are
   * on (bakedlight.js). Each lamp is described once (where it shines, how wide); how far its
   * light gets is worked out the first time it's on and kept.
   */
  _updateBaked() {
    if (!this._q?.baked || !this._baked?.length) return;
    // About how bright sky and sun make a surface: lamps add less to a bright room
    const ambient = Math.min(1, (this._hemi.intensity * 0.5 + this._sun.intensity * 0.25) / Math.PI);
    for (const { surface, elevation, records } of this._baked) {
      const lamps = records.filter((d) => d.intensity > 0).map((d) => {
        if (!d.bake) {
          const l = d.light;
          const dir = l.target.clone().sub(l.pos).normalize();
          const all = !!(d.marker?.type && catalogItem(d.marker.type).light?.all);
          const wide = d.kind !== "screenlight" && (all || (dir.y <= 0 && l.angle >= WIDE_LAMP));
          d.bake = {
            key: d, id: d.marker?.id ?? d.f?.id,
            pos: [l.pos.x, l.pos.y - elevation, l.pos.z], dir: [dir.x, dir.y, dir.z], distance: l.distance,
            // (wide lamps light all round with the share of light their cone gives, as in _assignLights)
            cosOuter: wide ? null : Math.cos(l.angle), cosInner: Math.cos(l.angle * (1 - l.penumbra)),
            power: wide ? coneShare(l.angle, l.penumbra) : 1,
          };
        }
        return { ...d.bake, color: [d.light.color.r * d.intensity, d.light.color.g * d.intensity, d.light.color.b * d.intensity] };
      });
      surface.update(lamps, ambient);
    }
  }

  /** Where the light slots are and which cast shadows (see _applyStates). */
  _lightSignature() {
    const v = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
    return (this._lightPool || []).map((spot) => {
      const point = spot.userData.point;
      const on = spot.intensity > 0 || point.intensity > 0;
      return on ? `${v(spot.position)}>${v(spot.target.position)}|${point.visible ? "p" : "s"}|${spot.castShadow || point.castShadow}|${spot.angle.toFixed(3)}` : "-";
    }).join(";");
  }

  // ---------- HTML overlay ----------

  _syncOverlayElements() {
    const keep = new Set();
    for (const item of this._overlayItems) {
      if (item.kind === "badge") {
        keep.add(`b:${item.furniture.id}`);
        let el = this._badgeEls.get(item.furniture.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "badge";
          this._overlay.appendChild(el);
          this._badgeEls.set(item.furniture.id, el);
        }
        item.el = el;
      } else if (item.kind === "label") {
        keep.add(`l:${item.room.id}`);
        let el = this._labelEls.get(item.room.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "label";
          this._overlay.appendChild(el);
          this._labelEls.set(item.room.id, el);
        }
        item.el = el;
      } else {
        keep.add(`m:${item.marker.id}`);
        let el = this._markerEls.get(item.marker.id);
        const key = `${item.marker.entity_id}|${item.marker.icon || ""}`;
        if (!el || el._key !== key) {
          el?.remove();
          el = document.createElement("div");
          el.className = "marker";
          el._key = key;
          el.innerHTML = `<div class="bubble"></div><div class="state" hidden></div>`;
          el._icon = createStateIcon(this._hass, this._hass?.states[item.marker.entity_id], item.marker.icon);
          el.querySelector(".bubble").appendChild(el._icon);
          el.addEventListener("click", (e) => {
            const m = el._marker;
            this._taps.tap(`m:${m.id}`, e.clientX, e.clientY, () => runTapAction(this, this._hass, m.entity_id, m.tap_action),
              doubleTapHandler(this, this._hass, m, () => this.focusOn(el._pos)));
          });
          this._overlay.appendChild(el);
          this._markerEls.set(item.marker.id, el);
        }
        el._marker = item.marker;
        el._pos = item.pos;
        item.el = el;
      }
    }
    for (const [id, el] of this._badgeEls) {
      if (!keep.has(`b:${id}`)) {
        el.remove();
        this._badgeEls.delete(id);
      }
    }
    for (const [id, el] of this._labelEls) {
      if (!keep.has(`l:${id}`)) {
        el.remove();
        this._labelEls.delete(id);
      }
    }
    for (const [id, el] of this._markerEls) {
      if (!keep.has(`m:${id}`)) {
        el.remove();
        this._markerEls.delete(id);
      }
    }
  }

  _updateOverlayContent() {
    const hass = this._hass;
    if (!hass) return;
    for (const item of this._overlayItems) {
      if (!item.el) continue;
      if (item.kind === "badge") {
        item.el.textContent = formatState(hass, hass.states[item.furniture.entity_id]);
      } else if (item.kind === "label") {
        const r = item.room;
        const labelEntity = roomLabelEntity(hass, r);
        const v = labelEntity ? formatState(hass, hass.states[labelEntity]) : "";
        const html = `<div class="name">${escapeHtml(r.name)}</div>${v ? `<div>${escapeHtml(v)}</div>` : ""}`;
        if (item.el._html !== html) {
          item.el.innerHTML = html;
          item.el._html = html;
        }
      } else {
        const m = item.marker;
        const st = hass.states[m.entity_id];
        const el = item.el;
        if (el._icon.tagName === "HA-STATE-ICON") {
          el._icon.hass = hass;
          el._icon.stateObj = st;
        }
        const on = isActive(st);
        el.classList.toggle("active", on);
        el.classList.toggle("playing", isPlaying(st));
        el.classList.toggle("unavailable", isUnavailable(st));
        el.style.setProperty("--fps-marker-active", on ? activeColor(st, "var(--fps-active)") : "");
        el.title = st?.attributes?.friendly_name || m.entity_id;
        const s = el.querySelector(".state");
        s.hidden = !m.show_state || !st;
        if (m.show_state && st) s.textContent = formatState(hass, st);
      }
    }
  }

  _positionOverlay() {
    const w = this.clientWidth;
    const h = this.clientHeight;
    const v = new THREE.Vector3();
    const camDist = this._camera.position.distanceTo(this._controls.target);
    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3();
    this._group.updateMatrixWorld();
    for (const item of this._overlayItems) {
      if (!item.el) continue;
      v.copy(item.pos).project(this._camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      // Room labels get noisy when zoomed far out
      let hide = !visible || (item.kind === "label" && camDist > 60);
      if (!hide) {
        // Hide items that are behind walls or under another floor
        dir.subVectors(item.pos, this._camera.position);
        const d = dir.length();
        ray.set(this._camera.position, dir.normalize());
        ray.far = d - 0.25;
        hide = ray.intersectObjects(this._occluders, false).some((h) => !(h.object.userData.roof && (this.roofOpacity ?? 1) < 0.999));
      }
      item.el.style.display = hide ? "none" : "";
      if (hide) continue;
      item.el.style.left = `${((v.x + 1) / 2) * w}px`;
      item.el.style.top = `${((1 - v.y) / 2) * h}px`;
    }
  }
}

// A newer version loaded into a page that still runs the old one (HA restarted
// while the panel was open): keep the old one and tell it a reload is needed
if (!customElements.get("fps-view-3d")) customElements.define("fps-view-3d", FpsView3D);
else window.dispatchEvent(new CustomEvent("fps-update-available"));
