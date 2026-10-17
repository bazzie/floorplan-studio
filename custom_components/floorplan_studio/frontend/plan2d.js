// 2D floorplan view + editor (SVG world layer with an HTML overlay for icons).
import { currentLanguage, t } from "./i18n.js";
import { quality } from "./quality.js";
import {
  COMPASS_STYLE,
  PLAYING_STYLE,
  OPENING_DEFAULTS,
  activeColor,
  activeLight,
  brightness,
  clone,
  compassSvg,
  createStateIcon,
  dist,
  escapeHtml,
  floorBounds,
  formatState,
  isActive,
  isPlaying,
  surroundLevel,
  TapSorter,
  soundArea,
  wallPieces,
  cameraAlerts,
  doubleTapHandler,
  cameraFloodlight,
  heatLevel,
  isHeating,
  isScreenOn,
  hassChanged,
  laundryState,
  isUnavailable,
  normalizeAngle,
  pointInPolygon,
  labelPoint,
  polygonArea,
  polygonCenter,
  GRID_SIZES,
  projectOnSegment,
  readPref,
  roomHighlight,
  roomLabelEntity,
  roomTapEntity,
  roundPt,
  round,
  runTapAction,
  shiftFloor,
  snapAngle,
  snapToGrid,
  uid,
  writePref,
} from "./model.js";
import {
  byHeight,
  catalogItem,
  containsPoint as furnitureContains,
  furnitureSvg,
  beamHalfAngle,
  lightAnchor,
  tiltOf,
  toLocal,
  toWorld,
  pieceSounding,
} from "./furniture.js";
import { robotBusy, robotPose } from "./robot.js";
import { floorFinish, floorPattern, isOutdoor } from "./materials.js";

/** A Sonos speaker bonded to a soundbar as a rear surround (linked to the soundbar's player). */
const isSurround = (f) => !!f.surround && !!f.entity_id && !!catalogItem(f.type).surround;
import { roofGeometry } from "./roof.js";

const SNAP_PX = 12;
const HIT_PX = 8;
const MIN_ZOOM = 4;
const MAX_ZOOM = 600;

/**
 * A camera's view / a floodlight's beam as an SVG path in the piece's local frame:
 * a fan from the front of the piece, cut off by walls (openings let it through).
 * Rays are cast across the fan and to every wall end inside it, so edges stay sharp.
 */
function fanPath(f, angleDeg, range, floor) {
  const half = (Math.min(angleDeg, 170) / 2) * (Math.PI / 180);
  const apex = [0, f.d / 2];
  // Solid wall spans near the piece, in its local frame
  const segs = [];
  for (const w of floor?.walls || []) {
    const { pieces, length } = wallPieces(w, floor.openings || [], 100);
    if (!length) continue;
    const u = [(w.b[0] - w.a[0]) / length, (w.b[1] - w.a[1]) / length];
    for (const pc of pieces) {
      if (pc.bottom > 0 || pc.top < 100) continue; // only full-height spans: doors and windows let it through
      const p = toLocal(f, [w.a[0] + u[0] * pc.from, w.a[1] + u[1] * pc.from]);
      const q = toLocal(f, [w.a[0] + u[0] * pc.to, w.a[1] + u[1] * pc.to]);
      if (Math.min(Math.hypot(p[0], p[1] - apex[1]), Math.hypot(q[0], q[1] - apex[1])) > range + length) continue;
      segs.push([p, q]);
    }
  }
  const angleOf = (pt) => Math.atan2(pt[0], pt[1] - apex[1]); // 0 = straight ahead (+y)
  const angles = [];
  const steps = 72;
  for (let i = 0; i <= steps; i++) angles.push(-half + (2 * half * i) / steps);
  for (const [p, q] of segs) {
    for (const e of [p, q]) {
      const a = angleOf(e);
      if (Math.abs(a) < half) angles.push(a - 1e-4, a + 1e-4);
    }
  }
  angles.sort((a, b) => a - b);
  // Ignore hits right at the apex: the wall the piece is mounted on
  const MIN = 0.12;
  const pts = angles.map((a) => {
    const d = [Math.sin(a), Math.cos(a)];
    let t = range;
    for (const [p, q] of segs) {
      const e = [q[0] - p[0], q[1] - p[1]];
      const den = d[0] * e[1] - d[1] * e[0];
      if (Math.abs(den) < 1e-9) continue;
      const w = [p[0] - apex[0], p[1] - apex[1]];
      const tt = (w[0] * e[1] - w[1] * e[0]) / den;
      const s = (w[0] * d[1] - w[1] * d[0]) / den;
      if (s >= 0 && s <= 1 && tt > MIN && tt < t) t = tt;
    }
    return `${(apex[0] + d[0] * t).toFixed(3)},${(apex[1] + d[1] * t).toFixed(3)}`;
  });
  return `M${apex[0]},${apex[1]} L${pts.join(" L")} Z`;
}

const STYLE = `
[hidden] { display:none !important; }
${COMPASS_STYLE}
:host(.drop-hint) { box-shadow:inset 0 0 0 3px var(--primary-color); }
.marker.removing { opacity:.35; }
.glows, .night, .floor-pattern { pointer-events:none; }
.roof { pointer-events:none; }
.roof .roof-eave { fill:rgba(164,85,58,.08); stroke:#a4553a; }
.roof .roof-wall { fill:none; stroke:#a4553a; stroke-opacity:.45; }
.roof line { stroke:#a4553a; stroke-opacity:.8; }
.roof.sel .roof-eave { fill:rgba(164,85,58,.16); stroke:var(--primary-color); }
.roof.sel line { stroke:var(--primary-color); }
.glows.dim, .ambi.dim { opacity:.3; }
.fov.dim { opacity:.5; }
.flood.dim { opacity:.3; }
.furniture .fov.alert { --heat:1; animation:fps-heat 0.8s ease-in-out infinite alternate; }
.furniture .heat { opacity:var(--heat, 1); animation:fps-heat 3s ease-in-out infinite alternate; }
@keyframes fps-heat { from { opacity:calc(var(--heat, 1) * .6); } to { opacity:var(--heat, 1); } }
/* Another floor's walls, faintly, to line this floor up with */
.underlay { pointer-events:none; }
.underlay line { stroke:var(--secondary-text-color,#777); opacity:.35; }
.underlay polygon { fill:none; stroke:var(--secondary-text-color,#777); opacity:.5; }
:host(.move-floor) svg.plan { cursor:move; }
.furniture .tv-on { animation:fps-tv 7s linear infinite; }
@keyframes fps-tv { 0%, 100% { fill:#9fd0ff; } 25% { fill:#ffc9a3; } 50% { fill:#b9a7ff; } 75% { fill:#a8f0d0; } }
@media (prefers-reduced-motion: reduce) { .furniture .tv-on, .furniture .heat, .furniture .fov.alert { animation:none; } }
/* Washing machine running: the drum tumbles back and forth, or spins */
.drum-turn { animation:fps-tumble 9s ease-in-out infinite; }
.drum-turn.spin { animation:fps-spin .45s linear infinite; }
@keyframes fps-tumble { 0% { transform:rotate(0); } 39% { transform:rotate(1080deg); } 50% { transform:rotate(1080deg); }
  89% { transform:rotate(0); } 100% { transform:rotate(0); } }
@keyframes fps-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .drum-turn, .drum-turn.spin { animation:none; } }
.furniture rect, .furniture ellipse, .furniture path { stroke:rgba(0,0,0,.35); }
.furniture rect.hole { fill:rgba(0,0,0,.14); stroke:var(--primary-text-color,#333); stroke-dasharray:.08 .05; }
.furniture .hole-x { fill:none; stroke:var(--primary-text-color,#333); opacity:.45; }
.furniture .outline { fill:none; stroke:none; }
.furniture.active .outline { stroke:var(--fps-active); }
.furniture.sel .outline { stroke:var(--primary-color); }
.furniture.unavailable { opacity:.5; }
.furniture.overhead > :not(.outline) { opacity:.55; }
.furniture.overhead .outline { stroke:var(--secondary-text-color, #888); }
.furniture.overhead.sel .outline { stroke:var(--primary-color); }
.waves { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
/* Sound waves live above the drawing (not in it), so the browser animates them without repainting the plan */
.wave-area { position:absolute; transform:translate(-50%, -50%); }
.wave-area.soft { opacity:.45; } /* surrounds playing music: ambient level */
.wave { position:absolute; left:50%; top:50%; border-radius:50%; border:2.5px solid var(--fps-active); opacity:0; box-sizing:border-box;
  transform:translate(-50%, -50%) scale(1); will-change:transform, opacity; animation:fps-wave 1.6s ease-out infinite; }
@keyframes fps-wave { 0% { transform:translate(-50%, -50%) scale(1); opacity:.9; } 100% { transform:translate(-50%, -50%) scale(var(--s)); opacity:0; } }
@media (prefers-reduced-motion: reduce) { .wave { animation:none; opacity:.5; } }
.rot-line { stroke:var(--primary-color); }
.badge { position:absolute; transform:translate(-50%,-50%); pointer-events:none; font-size:11px; padding:1px 6px;
  border-radius:8px; background:var(--card-background-color,#fff); color:var(--primary-text-color);
  box-shadow:0 1px 3px rgba(0,0,0,.3); white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis; }
:host { display:block; position:relative; overflow:hidden; touch-action:none;
  user-select:none; -webkit-user-select:none; background:var(--fps-bg); }
svg.plan { position:absolute; inset:0; width:100%; height:100%; display:block; }
.overlay { position:absolute; inset:0; pointer-events:none; }
.grid-minor { stroke:var(--fps-grid); }
.grid-major { stroke:var(--fps-grid-major); }
.room { stroke:var(--fps-room-stroke); }
.room.sel, .wall.sel { stroke:var(--primary-color) !important; }
.wall { stroke:var(--fps-wall); }
.gap { stroke:var(--fps-gap, var(--fps-bg)); }
.door-swing { fill:none; stroke:var(--fps-wall); opacity:.6; }
.door-swing.active { stroke:var(--fps-active); opacity:1; }
.door-swing.hint { opacity:.35; }
.door-leaf { stroke:var(--fps-wall); stroke-linecap:butt; }
.window-sash { stroke:var(--fps-active); stroke-linecap:round; }
.opening.sel .window-sash { stroke:var(--primary-color); }
.opening.sel .door-leaf { stroke:var(--primary-color); }
.window-line { stroke:var(--fps-wall); }
.opening.sel .door-swing, .opening.sel .window-line { stroke:var(--primary-color); opacity:1; }
.handle { fill:var(--card-background-color,#fff); stroke:var(--primary-color); }
.draft { fill:none; stroke:var(--primary-color); stroke-dasharray:4 3; }
.draft-fill { fill:var(--primary-color); fill-opacity:.12; stroke:none; }
.snap { fill:none; stroke:var(--accent-color, #ff9800); }
.marker { position:absolute; transform:translate(-50%,-50%); pointer-events:auto;
  display:flex; flex-direction:column; align-items:center; cursor:pointer; }
.marker .bubble { width:34px; height:34px; border-radius:50%; display:flex;
  align-items:center; justify-content:center; background:var(--card-background-color,#fff);
  box-shadow:0 1px 4px rgba(0,0,0,.35); color:var(--fps-icon-off);
  border:2px solid transparent; transition:background .2s,color .2s; }
.marker.active .bubble { color:#fff; background:var(--fps-marker-active, var(--fps-active)); }
.marker.unavailable .bubble { opacity:.45; }
${PLAYING_STYLE}
.marker.sel .bubble { border-color:var(--primary-color); }
.marker.missing .bubble { color:var(--error-color,#db4437); }
.marker .state { margin-top:2px; font-size:11px; padding:0 4px; border-radius:6px; max-width:140px; overflow:hidden; text-overflow:ellipsis;
  background:var(--card-background-color,#fff); color:var(--primary-text-color);
  white-space:nowrap; box-shadow:0 1px 2px rgba(0,0,0,.25); }
.marker ha-state-icon, .marker ha-icon { --mdc-icon-size:20px; }
.label { position:absolute; transform:translate(-50%,-50%); text-align:center;
  color:var(--primary-text-color); font-size:12px; line-height:1.25; white-space:nowrap;
  text-shadow:0 0 3px var(--fps-bg),0 0 3px var(--fps-bg); }
.label .name { font-weight:500; }
.label .value { opacity:.8; }
.hud { position:absolute; left:8px; bottom:8px; display:flex; gap:6px; align-items:center; }
.hud button { width:32px; height:32px; border-radius:8px; border:1px solid var(--divider-color);
  background:var(--card-background-color,#fff); color:var(--primary-text-color); cursor:pointer;
  font-size:18px; line-height:1; display:flex; align-items:center; justify-content:center; }
.hud .status { font-size:12px; padding:4px 8px; border-radius:6px;
  background:var(--card-background-color,#fff); color:var(--primary-text-color);
  border:1px solid var(--divider-color); }
.hud .status:empty { display:none; }
.hud .grid-ctl { display:flex; gap:6px; align-items:center; height:32px; padding:0 4px 0 10px; border-radius:8px;
  border:1px solid var(--divider-color); background:var(--card-background-color,#fff);
  color:var(--primary-text-color); font-size:12px; }
.hud .grid-ctl select { font:inherit; border:0; background:transparent; color:inherit; padding:4px 2px; cursor:pointer; }
.hud .grid-ctl button { width:auto; height:24px; padding:0 8px; font-size:12px; border-radius:6px; }
.hud .grid-ctl button[aria-pressed="true"] { background:var(--primary-color); color:var(--text-primary-color,#fff);
  border-color:var(--primary-color); }
.empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  color:var(--secondary-text-color); pointer-events:none; text-align:center; padding:16px; }
`;

/** Distance along a ray (origin, unit direction) to segment ab, or null when it misses. */
export function rayHitsSegment(o, d, a, b) {
  const e = [b[0] - a[0], b[1] - a[1]];
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = [a[0] - o[0], a[1] - o[1]];
  const t = (w[0] * e[1] - w[1] * e[0]) / den; // along the ray
  const u = (w[0] * d[1] - w[1] * d[0]) / den; // along the segment
  return t > 0 && u >= 0 && u <= 1 ? t : null;
}

export class FpsPlan2D extends HTMLElement {
  constructor() {
    super();
    this._taps = new TapSorter();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <svg class="plan"><g class="world"></g></svg>
      <div class="overlay"></div>
      <div class="compass"></div>
      <div class="empty" hidden></div>
      <div class="hud">
        <button data-zoom="in">+</button>
        <button data-zoom="out">−</button>
        <button data-zoom="fit">⤢</button>
        <span class="grid-ctl" hidden>
          <span data-text="Grid"></span>
          <select>${GRID_SIZES.map((g) => `<option value="${g}">${g < 1 ? `${Math.round(g * 100)} cm` : `${g} m`}</option>`).join("")}</select>
          <button data-snap></button>
        </span>
        <span class="status"></span>
      </div>`;
    this._svg = this.shadowRoot.querySelector("svg.plan");
    this._world = this.shadowRoot.querySelector(".world");
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._waveLayer = document.createElement("div");
    this._waveLayer.className = "waves";
    this._overlay.prepend(this._waveLayer); // under room labels and markers
    this._waveEls = new Map();
    this._status = this.shadowRoot.querySelector(".status");
    this._empty = this.shadowRoot.querySelector(".empty");
    this._compass = this.shadowRoot.querySelector(".compass");
    this.north = 0;
    this._setupCompass();

    this.zoom = 40; // px per metre
    this.ox = 0;
    this.oy = 0;
    this.editing = false;
    this.tool = "select";
    this.selection = null;
    this.blueprintUrl = null;
    this.blueprintAspect = null;
    const g = parseFloat(readPref("grid", "0.25"));
    this.gridSize = GRID_SIZES.includes(g) ? g : 0.25;
    this.snapGrid = readPref("snap", "1") === "1";

    this._pointers = new Map();
    this._action = null;
    this._draft = null;
    this._cursor = null;
    this._snapHit = null;
    this._markerEls = new Map();
    this._labelEls = new Map();
    this._badgeEls = new Map();
    this._fittedFloorId = null;

    this._gridCtl = this.shadowRoot.querySelector(".grid-ctl");
    this._gridSelect = this._gridCtl.querySelector("select");
    this._snapBtn = this._gridCtl.querySelector("button[data-snap]");
    this._localizeHud();
    this._gridSelect.addEventListener("change", () => {
      this.gridSize = parseFloat(this._gridSelect.value);
      writePref("grid", String(this.gridSize));
      this.requestRender();
    });
    this._snapBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.snapGrid = !this.snapGrid;
      writePref("snap", this.snapGrid ? "1" : "0");
      this.requestRender();
    });
    this.shadowRoot.querySelector(".hud").addEventListener("click", (e) => {
      const z = e.target.closest("button")?.dataset.zoom;
      if (z === "fit") this.fit();
      else if (z) this._zoomAt(this._size()[0] / 2, this._size()[1] / 2, z === "in" ? 1.3 : 1 / 1.3);
    });
    this._svg.addEventListener("pointerdown", (e) => this._onDown(e));
    this._svg.addEventListener("pointermove", (e) => this._onMove(e));
    this._svg.addEventListener("pointerup", (e) => this._onUp(e));
    this._svg.addEventListener("pointercancel", (e) => this._onUp(e, true));
    this._svg.addEventListener("pointerleave", () => {
      if (!this._pointers.size) {
        this._cursor = null;
        this.requestRender();
      }
    });
    this._svg.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if (["wall", "room", "area", "roof"].includes(this.tool)) this.finishDraft();
    });
    this._svg.addEventListener("contextmenu", (e) => {
      if (this._draft) {
        e.preventDefault();
        this.finishDraft();
      }
    });
    this._svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = this._svg.getBoundingClientRect();
      this._zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    this._ro = new ResizeObserver(() => {
      if (this.floor && this._fittedFloorId !== this.floor.id) this.fit();
      this.requestRender();
    });
  }

  connectedCallback() {
    this._ro.observe(this);
  }

  /** Is a viewport point over the plan? */
  containsPoint(clientX, clientY) {
    const r = this.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /** Viewport point -> snapped plan coordinates (for entities dropped from the panel). */
  clientToWorld(clientX, clientY, e) {
    const r = this._svg.getBoundingClientRect();
    return this._snap(this._toWorld(clientX - r.left, clientY - r.top), e);
  }

  /** Outline the plan while something can be dropped on it. */
  setDropHint(on) {
    this.classList.toggle("drop-hint", !!on);
  }

  /** While editing, drag the compass to set north; double-click resets it. */
  _setupCompass() {
    const angleAt = (e) => {
      const r = this._compass.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const step = e.altKey ? 1 : 5;
      return normalizeAngle(Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI) / step) * step);
    };
    let dragging = false;
    this._compass.addEventListener("pointerdown", (e) => {
      if (!this.editing || e.button !== 0) return;
      e.stopPropagation();
      this._compass.setPointerCapture(e.pointerId);
      dragging = true;
      this._emit("fps-before-change");
      this._emit("fps-north", { angle: angleAt(e) });
    });
    this._compass.addEventListener("pointermove", (e) => {
      if (dragging) this._emit("fps-north", { angle: angleAt(e) });
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this._emit("fps-north", { angle: this.north, final: true });
    };
    this._compass.addEventListener("pointerup", end);
    this._compass.addEventListener("pointercancel", end);
    this._compass.addEventListener("dblclick", (e) => {
      if (!this.editing) return;
      e.stopPropagation();
      this._emit("fps-before-change");
      this._emit("fps-north", { angle: 0, final: true });
    });
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
    set('[data-zoom="in"]', "Zoom in");
    set('[data-zoom="out"]', "Zoom out");
    set('[data-zoom="fit"]', "Fit to screen");
    set('.grid-ctl [data-text="Grid"]', null, "Grid");
    set(".grid-ctl select", "Grid size");
    set("[data-snap]", "Snap to grid (hold Alt to disable temporarily)", "Snap");
  }

  _renderCompass() {
    this._localizeHud();
    const key = `${this.north}|${this.editing}|${currentLanguage()}`;
    if (this._compassKey === key) return;
    this._compassKey = key;
    this._compass.innerHTML = compassSvg(this.north);
    this._compass.classList.toggle("interactive", this.editing);
    this._compass.title = this.editing
      ? t("North: {deg}°. Drag to rotate (Alt for 1° steps), double-click to reset.", { deg: Math.round(this.north) })
      : t("North: {deg}°", { deg: Math.round(this.north) });
  }

  disconnectedCallback() {
    this._ro.disconnect();
  }

  /** This device's rendering quality (quality.js); read again when the setting changes. */
  _quality() {
    return (this._q ||= quality());
  }

  /** The quality setting changed: use the new profile. */
  applyQuality() {
    this._q = null;
    this.requestRender();
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    // Only redraw for changes the plan shows (`relevant`: set by the panel, see planEntities)
    if (hassChanged(prev, hass, this.relevant)) this.requestRender();
  }

  get hass() {
    return this._hass;
  }

  /** Called by the panel whenever floor, mode, tool or selection change. */
  update(props) {
    const floorChanged = props.floor && props.floor.id !== this.floor?.id;
    Object.assign(this, props);
    if (props.tool !== undefined || props.editing !== undefined || floorChanged) {
      if (this._draft && (this.tool !== this._draft.tool || !this.editing || floorChanged)) {
        this._draft = null;
      }
    }
    if (floorChanged || this._fittedFloorId === null) this.fit();
    this.requestRender();
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._render();
    });
  }

  // ---------- coordinates ----------

  _size() {
    return [this.clientWidth || 1, this.clientHeight || 1];
  }

  _toWorld(sx, sy) {
    return [(sx - this.ox) / this.zoom, (sy - this.oy) / this.zoom];
  }

  _toScreen(p) {
    return [p[0] * this.zoom + this.ox, p[1] * this.zoom + this.oy];
  }

  _eventWorld(e) {
    const r = this._svg.getBoundingClientRect();
    return this._toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  _zoomAt(sx, sy, factor) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const w = this._toWorld(sx, sy);
    this.zoom = z;
    this.ox = sx - w[0] * z;
    this.oy = sy - w[1] * z;
    this.requestRender();
  }

  fit() {
    if (!this.floor) return;
    const [w, h] = this._size();
    if (w < 10 || h < 10) return;
    this._fittedFloorId = this.floor.id;
    const b = floorBounds(this.floor, this.blueprintAspect);
    if (!b) {
      this.zoom = 40;
      this.ox = w / 2;
      this.oy = h / 2;
    } else {
      const bw = Math.max(b.maxX - b.minX, 1);
      const bh = Math.max(b.maxY - b.minY, 1);
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - 80) / bw, (h - 80) / bh)));
      this.ox = w / 2 - ((b.minX + b.maxX) / 2) * this.zoom;
      this.oy = h / 2 - ((b.minY + b.maxY) / 2) * this.zoom;
    }
    this.requestRender();
  }

  // ---------- snapping & hit testing ----------

  _snap(p, e, anchor) {
    const tol = SNAP_PX / this.zoom;
    this._snapHit = null;
    if (!e?.altKey) {
      let best = null;
      let bestD = tol;
      const consider = (q) => {
        const d = dist(p, q);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      };
      this.floor.walls.forEach((w) => {
        consider(w.a);
        consider(w.b);
      });
      this.floor.rooms.forEach((r) => r.points.forEach(consider));
      this._draft?.points.forEach(consider);
      this.underlay?.walls.forEach((w) => {
        consider(w.a);
        consider(w.b);
      });
      if (best) {
        this._snapHit = best;
        return [...best];
      }
    }
    const useGrid = this.snapGrid && !e?.altKey;
    if (anchor && e?.shiftKey) {
      // Keep the 45° direction and snap the length to whole grid steps instead
      p = snapAngle(anchor, p);
      if (useGrid) {
        const len = dist(anchor, p);
        const k = len ? (Math.round(len / this.gridSize) * this.gridSize) / len : 0;
        p = [anchor[0] + (p[0] - anchor[0]) * k, anchor[1] + (p[1] - anchor[1]) * k];
      }
      return roundPt(p);
    }
    return roundPt(useGrid ? snapToGrid(p, this.gridSize) : p);
  }

  /** Grid snap used when dragging whole items (walls, rooms). */
  _gridSnap(p) {
    return this.snapGrid ? snapToGrid(p, this.gridSize) : p;
  }

  _hitHandle(p) {
    const sel = this.selection;
    if (!sel || !this.editing) return null;
    const tol = HIT_PX / this.zoom;
    if (sel.kind === "wall") {
      const w = this.floor.walls.find((x) => x.id === sel.id);
      if (!w) return null;
      if (dist(p, w.a) < tol) return { kind: "wall-end", wall: w, end: "a" };
      if (dist(p, w.b) < tol) return { kind: "wall-end", wall: w, end: "b" };
    }
    if (sel.kind === "roof") {
      const r = (this.floor.roofs || []).find((x) => x.id === sel.id);
      const i = r ? r.points.findIndex((q) => dist(p, q) < tol) : -1;
      if (i >= 0) return { kind: "room-vertex", room: r, index: i };
    }
    if (sel.kind === "room") {
      const r = this.floor.rooms.find((x) => x.id === sel.id);
      const i = r ? r.points.findIndex((q) => dist(p, q) < tol) : -1;
      if (i >= 0) return { kind: "room-vertex", room: r, index: i };
    }
    if (sel.kind === "furniture") {
      const f = this._furniture.find((x) => x.id === sel.id);
      if (!f) return null;
      if (dist(p, this._rotateKnob(f)) < tol) return { kind: "furniture-rotate", furniture: f };
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        if (dist(p, toWorld(f, [(sx * f.w) / 2, (sy * f.d) / 2])) < tol) return { kind: "furniture-corner", furniture: f, sx, sy };
      }
    }
    return null;
  }

  /** A roof whose dashed eave line or ridge / hip lines pass near the point. */
  _hitRoofLine(p) {
    const tol = HIT_PX / this.zoom;
    for (const r of this.floor?.roofs || []) {
      const g = roofGeometry(r);
      const segs = [...g.outline.map((a, i) => [a, g.outline[(i + 1) % g.outline.length]]), ...g.lines];
      if (segs.some(([a, b]) => projectOnSegment(p, a, b).d < tol)) return r;
    }
    return null;
  }

  /** The smallest roof whose outline (with its overhang) contains the point. */
  _hitRoof(p) {
    let best = null;
    for (const r of this.floor?.roofs || []) {
      if (!pointInPolygon(p, roofGeometry(r).outline)) continue;
      if (!best || polygonArea(r.points) < polygonArea(best.points)) best = r;
    }
    return best;
  }

  get _furniture() {
    return this.floor?.furniture || [];
  }

  /** Rotation handle: just behind the piece's back edge. */
  _rotateKnob(f) {
    return toWorld(f, [0, -f.d / 2 - 22 / this.zoom]);
  }

  _hitFurniture(p, linkedOnly = false) {
    const pad = 2 / this.zoom;
    // Highest piece wins, matching the drawing order (a monitor over its desk)
    const pieces = byHeight(this._furniture);
    for (let i = pieces.length - 1; i >= 0; i--) {
      const f = pieces[i];
      if (linkedOnly && !f.entity_id) continue;
      if (furnitureContains(f, p, pad)) return f;
    }
    return null;
  }

  /** Furniture under a viewport point (for entities dropped from the panel). */
  furnitureAt(clientX, clientY) {
    if (!this.containsPoint(clientX, clientY)) return null;
    const r = this._svg.getBoundingClientRect();
    return this._hitFurniture(this._toWorld(clientX - r.left, clientY - r.top));
  }

  _hitOpening(p) {
    const tol = HIT_PX / this.zoom;
    for (const o of this.floor.openings) {
      const w = this.floor.walls.find((x) => x.id === o.wall_id);
      if (!w) continue;
      const len = dist(w.a, w.b);
      const c = projectOnSegment(p, w.a, w.b);
      if (c.d < w.thickness / 2 + tol && Math.abs((c.t - o.t) * len) < o.width / 2) return o;
      if (o.type === "door" && len > 1e-6 && this._inDoorSwing(p, o, w, len)) return o;
    }
    return null;
  }

  /** Is p inside the quarter circle a door sweeps (its swing arc on the plan)? */
  _inDoorSwing(p, o, w, len) {
    const u = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const n = [-u[1], u[0]];
    const half = Math.min(o.width / 2, len / 2);
    const c = [w.a[0] + u[0] * o.t * len, w.a[1] + u[1] * o.t * len];
    const s = [c[0] - u[0] * half, c[1] - u[1] * half];
    const e = [c[0] + u[0] * half, c[1] + u[1] * half];
    const hinge = o.flip_hinge ? e : s;
    const free = o.flip_hinge ? s : e;
    const side = o.flip_swing ? -1 : 1;
    const v = [p[0] - hinge[0], p[1] - hinge[1]];
    return Math.hypot(v[0], v[1]) <= half * 2 &&
      v[0] * n[0] * side + v[1] * n[1] * side >= 0 &&
      v[0] * (free[0] - hinge[0]) + v[1] * (free[1] - hinge[1]) >= 0;
  }

  _hitWall(p) {
    const tol = HIT_PX / this.zoom;
    let best = null;
    let bestD = Infinity;
    for (const w of this.floor.walls) {
      const c = projectOnSegment(p, w.a, w.b);
      if (c.d < w.thickness / 2 + tol && c.d < bestD) {
        bestD = c.d;
        best = { wall: w, t: c.t };
      }
    }
    return best;
  }

  _hitRoom(p) {
    // Smallest room containing the point wins (rooms may be nested)
    let best = null;
    let bestArea = Infinity;
    for (const r of this.floor.rooms) {
      if (!pointInPolygon(p, r.points)) continue;
      const xs = r.points.map((q) => q[0]);
      const ys = r.points.map((q) => q[1]);
      const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (area < bestArea) {
        bestArea = area;
        best = r;
      }
    }
    return best;
  }

  // ---------- events to the panel ----------

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  _beforeChange() {
    this._emit("fps-before-change");
  }

  _changed() {
    this._emit("fps-changed");
    this.requestRender();
  }

  _select(sel) {
    this.selection = sel;
    this._emit("fps-select", sel);
    this.requestRender();
  }

  // ---------- pointer handling ----------

  _onDown(e) {
    if (!this.floor) return;
    this._svg.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, [e.clientX, e.clientY]);

    if (this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      this._action = {
        type: "pinch",
        d: Math.hypot(a[0] - b[0], a[1] - b[1]),
        c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      };
      return;
    }
    if (this._pointers.size > 2) return;

    const start = { x: e.clientX, y: e.clientY, moved: false };
    if (e.button === 1 || e.button === 2) {
      if (e.button === 1 || !this._draft) {
        this._action = { type: "pan", ...start };
      }
      return;
    }

    const p = this._eventWorld(e);
    if (!this.editing) {
      this._action = { type: "pan", ...start, tapFurniture: this._hitFurniture(p, true), tapRoom: this._hitRoom(p) };
      return;
    }

    switch (this.tool) {
      case "select":
        this._startSelectDrag(p, start);
        break;
      case "wall":
      case "room":
      case "area":
        this._action = { type: "draw", ...start };
        break;
      case "roof": {
        // Not drawing yet: a selected roof's corners and the roofs themselves can be dragged
        if (!this._draft) {
          const h = this._hitHandle(p);
          if (h?.kind === "room-vertex") {
            this._action = { type: "drag-vertex", ...start, room: h.room, index: h.index };
            break;
          }
          const roof = this._hitRoof(p);
          if (roof) {
            this._select({ kind: "roof", id: roof.id });
            this._action = { type: "drag-room", ...start, origin: p, room: roof, orig: roof.points.map((q) => [...q]) };
            break;
          }
        }
        this._action = { type: "draw", ...start };
        break;
      }
      case "door":
      case "window": {
        // Clicking a door or window that's already there picks it up instead of adding another
        const existing = this._hitOpening(p);
        if (existing) {
          this._select({ kind: "opening", id: existing.id });
          this._action = { type: "drag-opening", ...start, opening: existing,
            wall: this.floor.walls.find((w) => w.id === existing.wall_id) };
          break;
        }
        const hit = this._hitWall(p);
        if (hit) {
          this._beforeChange();
          const o = { id: uid(), wall_id: hit.wall.id, type: this.tool, t: round(hit.t, 4),
            ...OPENING_DEFAULTS[this.tool], entity_id: null };
          this.floor.openings.push(o);
          this._changed();
          this._select({ kind: "opening", id: o.id });
          this._action = { type: "drag-opening", ...start, opening: o, wall: hit.wall, noUndo: true };
        } else {
          this._action = { type: "pan", ...start };
        }
        break;
      }
      case "calibrate":
        this._action = { type: "draw", ...start };
        break;
      case "move-floor":
        this._action = { type: "drag-floor", ...start, origin: p, orig: clone(this.floor) };
        break;
      default:
        this._action = { type: "pan", ...start };
    }
  }

  _startSelectDrag(p, start) {
    const h = this._hitHandle(p);
    if (h?.kind === "wall-end") {
      const orig = [...h.wall[h.end]];
      this._action = { type: "drag-points", ...start, origin: p,
        refs: this._jointRefs([orig]), orig: [orig] };
      return;
    }
    if (h?.kind === "room-vertex") {
      this._action = { type: "drag-vertex", ...start, room: h.room, index: h.index };
      return;
    }
    if (h?.kind === "furniture-corner") {
      const f = h.furniture;
      this._action = { type: "resize-furniture", ...start, furniture: f, sx: h.sx, sy: h.sy,
        orig: { x: f.x, y: f.y, w: f.w, d: f.d, rotation: f.rotation } };
      return;
    }
    if (h?.kind === "furniture-rotate") {
      this._action = { type: "rotate-furniture", ...start, furniture: h.furniture };
      return;
    }
    const o = this._hitOpening(p);
    if (o) {
      this._select({ kind: "opening", id: o.id });
      this._action = { type: "drag-opening", ...start, opening: o,
        wall: this.floor.walls.find((w) => w.id === o.wall_id) };
      return;
    }
    const roofLine = this._hitRoofLine(p);
    if (roofLine) {
      this._select({ kind: "roof", id: roofLine.id });
      this._action = { type: "drag-room", ...start, origin: p, room: roofLine, orig: roofLine.points.map((q) => [...q]) };
      return;
    }
    const w = this._hitWall(p);
    if (w) {
      this._select({ kind: "wall", id: w.wall.id });
      const orig = [[...w.wall.a], [...w.wall.b]];
      this._action = { type: "drag-points", ...start, origin: p, refs: this._jointRefs(orig), orig };
      return;
    }
    const f = this._hitFurniture(p);
    if (f) {
      this._select({ kind: "furniture", id: f.id });
      this._action = { type: "drag-furniture", ...start, origin: p, furniture: f, orig: [f.x, f.y] };
      return;
    }
    const r = this._hitRoom(p);
    if (r) {
      this._select({ kind: "room", id: r.id });
      this._action = { type: "drag-room", ...start, origin: p, room: r,
        orig: r.points.map((q) => [...q]) };
      return;
    }
    // Nothing else there (e.g. a roof's overhang): the roof
    const roof = this._hitRoof(p);
    if (roof) {
      this._select({ kind: "roof", id: roof.id });
      this._action = { type: "drag-room", ...start, origin: p, room: roof, orig: roof.points.map((q) => [...q]) };
      return;
    }
    if (this.selection) this._select(null);
    this._action = { type: "pan", ...start };
  }

  /** All wall endpoints coinciding with any of the given points (joined walls move together). */
  _jointRefs(points) {
    const refs = [];
    for (const w of this.floor.walls) {
      for (const end of ["a", "b"]) {
        const i = points.findIndex((q) => dist(q, w[end]) < 1e-6);
        if (i >= 0) refs.push({ wall: w, end, i });
      }
    }
    return refs;
  }

  _onMove(e) {
    if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const a = this._action;

    if (a?.type === "pinch" && this._pointers.size === 2) {
      const [p1, p2] = [...this._pointers.values()];
      const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
      const c = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const r = this._svg.getBoundingClientRect();
      this.ox += c[0] - a.c[0];
      this.oy += c[1] - a.c[1];
      this._zoomAt(c[0] - r.left, c[1] - r.top, d / (a.d || d));
      a.d = d;
      a.c = c;
      return;
    }

    const p = this._eventWorld(e);
    if (this.editing && ["wall", "room", "area", "roof", "calibrate"].includes(this.tool)) {
      const anchor = this._draft?.points.at(-1);
      this._cursor = this._snap(p, e, anchor);
      this._updateStatus(anchor);
      this.requestRender();
    }
    if (!a) return;

    if (!a.moved && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 4) {
      a.moved = true;
      if (a.type.startsWith("drag") && !a.noUndo) this._beforeChange();
    }
    if (!a.moved) return;

    switch (a.type) {
      case "pan":
        this.ox += e.clientX - a.x;
        this.oy += e.clientY - a.y;
        a.x = e.clientX;
        a.y = e.clientY;
        this.requestRender();
        break;
      case "drag-points": {
        const single = a.orig.length === 1;
        let delta;
        if (single) {
          const q = this._snapExcluding(p, e, a.refs);
          delta = [q[0] - a.orig[0][0], q[1] - a.orig[0][1]];
        } else {
          const q = this._gridSnap(p);
          const o = this._gridSnap(a.origin);
          delta = [q[0] - o[0], q[1] - o[1]];
        }
        for (const r of a.refs) {
          r.wall[r.end] = roundPt([a.orig[r.i][0] + delta[0], a.orig[r.i][1] + delta[1]]);
        }
        this._changed();
        break;
      }
      case "drag-vertex":
        a.room.points[a.index] = this._snap(p, e);
        this._changed();
        break;
      case "drag-room": {
        const q = this._gridSnap(p);
        const o = this._gridSnap(a.origin);
        a.room.points = a.orig.map((pt) => roundPt([pt[0] + q[0] - o[0], pt[1] + q[1] - o[1]]));
        this._changed();
        break;
      }
      case "drag-opening":
        if (a.wall) {
          a.opening.t = round(projectOnSegment(p, a.wall.a, a.wall.b).t, 4);
          this._changed();
        }
        break;
      case "drag-marker":
      case "drag-furniture": {
        const item = a.marker || a.furniture;
        const kind = a.marker ? "marker" : "furniture";
        a.outside = !this.containsPoint(e.clientX, e.clientY);
        this._markerEls.get(item.id)?.classList.toggle("removing", a.outside);
        this._emit("fps-item-drag", { kind, item, clientX: e.clientX, clientY: e.clientY, outside: a.outside });
        if (a.outside) {
          // Hovering the remove zone: show it back at its starting spot
          if (item.x !== a.orig[0] || item.y !== a.orig[1]) {
            [item.x, item.y] = a.orig;
            this._changed();
          }
          break;
        }
        if (a.marker) {
          [item.x, item.y] = this._snap(p, e);
        } else {
          const q = this._gridSnap(p);
          const o = this._gridSnap(a.origin);
          [item.x, item.y] = roundPt([a.orig[0] + q[0] - o[0], a.orig[1] + q[1] - o[1]]);
        }
        this._changed();
        break;
      }
      case "resize-furniture": {
        // Opposite corner stays put; sizes snap to 5 cm unless Alt is held
        const o = a.orig;
        const pl = toLocal(o, p);
        const step = e.altKey ? 0.01 : 0.05;
        const snap = (v) => Math.max(0.1, Math.round(v / step) * step);
        const ox = (-a.sx * o.w) / 2;
        const oy = (-a.sy * o.d) / 2;
        const w = snap(a.sx * (pl[0] - ox));
        const d = snap(a.sy * (pl[1] - oy));
        const c = toWorld(o, [ox + (a.sx * w) / 2, oy + (a.sy * d) / 2]);
        Object.assign(a.furniture, { w: round(w), d: round(d), x: round(c[0]), y: round(c[1]) });
        this._changed();
        break;
      }
      case "drag-floor": {
        const [dx, dy] = this._floorDelta(a, p, e);
        shiftFloor(this.floor, dx, dy, a.orig);
        this._status.textContent = t("Moved {dx}, {dy} m", { dx: dx.toFixed(2), dy: dy.toFixed(2) });
        this._changed();
        break;
      }
      case "rotate-furniture": {
        const f = a.furniture;
        const step = e.altKey ? 1 : 15;
        const deg = (Math.atan2(p[0] - f.x, -(p[1] - f.y)) * 180) / Math.PI;
        f.rotation = normalizeAngle(Math.round(deg / step) * step);
        this._changed();
        break;
      }
      default:
    }
  }

  /**
   * How far a floor drag moves the floor: in grid steps, and pulled onto the
   * outline floor when one of the walls' corners comes close to one of its corners.
   */
  _floorDelta(a, p, e) {
    let dx = p[0] - a.origin[0];
    let dy = p[1] - a.origin[1];
    if (e.altKey) return [round(dx), round(dy)];
    if (this.snapGrid) [dx, dy] = snapToGrid([dx, dy], this.gridSize);
    const targets = (this.underlay?.walls || []).flatMap((w) => [w.a, w.b]);
    let best = null;
    let bestD = SNAP_PX / this.zoom;
    for (const w of a.orig.walls) {
      for (const q of [w.a, w.b]) {
        const m = [q[0] + p[0] - a.origin[0], q[1] + p[1] - a.origin[1]]; // unsnapped position
        for (const t of targets) {
          const d = dist(m, t);
          if (d < bestD) {
            bestD = d;
            best = [t[0] - q[0], t[1] - q[1]];
          }
        }
      }
    }
    return roundPt(best || [dx, dy]);
  }

  /** Snap while ignoring the endpoints that are being dragged. */
  _snapExcluding(p, e, refs) {
    const saved = refs.map((r) => r.wall[r.end]);
    refs.forEach((r) => (r.wall[r.end] = [NaN, NaN]));
    const q = this._snap(p, e);
    refs.forEach((r, i) => (r.wall[r.end] = saved[i]));
    return q;
  }

  _onUp(e, cancelled = false) {
    this._pointers.delete(e.pointerId);
    const a = this._action;
    if (a?.type === "pinch") {
      if (this._pointers.size === 0) this._action = null;
      return;
    }
    this._action = null;
    if ((a?.type === "drag-marker" || a?.type === "drag-furniture") && a.moved) {
      const item = a.marker || a.furniture;
      this._markerEls.get(item.id)?.classList.remove("removing");
      // Dropped off the plan (onto the side panel): remove it
      this._emit("fps-item-drop", { kind: a.marker ? "marker" : "furniture", item, remove: !!a.outside && !cancelled });
      return;
    }
    if (!a || cancelled || a.moved) return;

    if (a.type === "pan" && !this.editing) {
      // Tap / double-tap: a piece runs its actions; elsewhere double-tap zooms in there
      const [x, y] = [e.clientX, e.clientY];
      const zoom = () => this._zoomIn(x, y);
      const f = a.tapFurniture;
      if (f) {
        this._taps.tap(`f:${f.id}`, x, y, () => runTapAction(this, this._hass, f.entity_id, f.tap_action),
          doubleTapHandler(this, this._hass, f, zoom));
        return;
      }
      const r = a.tapRoom;
      const entity = r && roomTapEntity(this._hass, r);
      this._taps.tap(r ? `r:${r.id}` : "plan", x, y, entity ? () => runTapAction(this, this._hass, entity, "more-info") : null, zoom);
      return;
    }
    if (a.type === "draw") this._addDraftPoint(this._snap(this._eventWorld(e), e, this._draft?.points.at(-1)));
  }

  // ---------- drawing ----------

  _addDraftPoint(p) {
    // Outdoor areas and roofs are drawn like a room (an outline of corners)
    const tool = this.tool === "area" || this.tool === "roof" ? "room" : this.tool;
    if (!this._draft) {
      this._draft = { tool, points: [p], outdoor: this.tool === "area", roof: this.tool === "roof" };
      this.requestRender();
      return;
    }
    const pts = this._draft.points;
    const last = pts.at(-1);
    if (dist(p, last) < 1e-6) return;

    if (tool === "calibrate") {
      this._draft = null;
      this._emit("fps-calibrate", { a: last, b: p });
      this.requestRender();
      return;
    }
    if (tool === "wall") {
      this._beforeChange();
      this.floor.walls.push({ id: uid(), a: last, b: p, thickness: this.wallThickness || 0.15 });
      pts.push(p);
      this._changed();
      // Clicking back on the chain's start closes the loop
      if (pts.length > 2 && dist(p, pts[0]) < 1e-6) this._draft = null;
      return;
    }
    if (tool === "room") {
      if (pts.length >= 3 && dist(p, pts[0]) < SNAP_PX / this.zoom) {
        this.finishDraft();
        return;
      }
      pts.push(p);
      this.requestRender();
    }
  }

  finishDraft() {
    const d = this._draft;
    this._draft = null;
    this._status.textContent = "";
    if (d?.roof && d.points.length >= 3) {
      this._beforeChange();
      const roof = { id: uid(), name: "", points: d.points, type: "gable", pitch: 35, overhang: 0.3, ridge_turned: false };
      (this.floor.roofs ||= []).push(roof);
      this._changed();
      this._select({ kind: "roof", id: roof.id });
    } else if (d?.tool === "room" && d.points.length >= 3) {
      this._beforeChange();
      const r = d.outdoor
        ? { id: uid(), name: t("Garden {n}", { n: this.floor.rooms.filter(isOutdoor).length + 1 }), points: d.points,
          color: "#7fae5a", floor_material: "grass", area_id: null, entity_id: null, sensor_entity_id: null }
        : { id: uid(), name: t("Room {n}", { n: this.floor.rooms.length + 1 }), points: d.points,
          color: "#8ab4f8", area_id: null, entity_id: null, sensor_entity_id: null };
      this.floor.rooms.push(r);
      this._changed();
      this._select({ kind: "room", id: r.id });
    }
    this.requestRender();
  }

  cancelDraft() {
    this._draft = null;
    this._status.textContent = "";
    this.requestRender();
  }

  get drafting() {
    return !!this._draft;
  }

  _updateStatus(anchor) {
    if (anchor && this._cursor) {
      const len = dist(anchor, this._cursor);
      this._status.textContent = `${len.toFixed(2)} m`;
    } else if (this.editing && this.tool !== "select") {
      this._status.textContent = `${this._cursor[0].toFixed(2)}, ${this._cursor[1].toFixed(2)}`;
    }
  }

  // ---------- rendering ----------

  _render() {
    const floor = this.floor;
    if (!floor) return;
    const z = this.zoom;
    const px = (n) => n / z; // screen pixels -> world units
    const [w, h] = this._size();
    const hass = this._hass;
    const states = hass?.states || {};
    const sel = this.selection;
    const parts = [];

    const view = `translate(${this.ox} ${this.oy}) scale(${z})`;
    if (this._world.getAttribute("transform") !== view) this._world.setAttribute("transform", view);

    // Blueprint
    const bp = floor.blueprint;
    if (bp && this.blueprintUrl && this.blueprintAspect && (this.editing || bp.show_in_view)) {
      parts.push(`<image href="${this.blueprintUrl}" x="${bp.x}" y="${bp.y}" width="${bp.width}"
        height="${bp.width * this.blueprintAspect}" opacity="${bp.opacity}" preserveAspectRatio="none"/>`);
    }

    // Grid (edit mode only). Lines follow the snap grid; when zoomed out too far
    // to show every step, only every 2nd/5th/10th line is drawn.
    this._gridCtl.hidden = !this.editing;
    if (this.editing) {
      this._gridSelect.value = String(this.gridSize);
      this._snapBtn.setAttribute("aria-pressed", String(this.snapGrid));
      const [x0, y0] = this._toWorld(0, 0);
      const [x1, y1] = this._toWorld(w, h);
      let step = this.gridSize;
      for (const k of [2, 2.5, 2, 2, 2.5, 2, 2, 2.5, 2]) {
        if (step * z >= 8) break;
        step *= k;
      }
      // Major lines every metre (or every 5 steps once steps reach a metre)
      let major = Math.max(1, step * 5 >= 5 ? step * 5 : 1);
      while (major * z < 40) major *= 5;
      const isMajor = (v) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const lines = [];
      for (let i = Math.floor(x0 / step); i * step <= x1; i++) {
        const x = round(i * step, 4);
        lines.push(`<line class="${isMajor(x) ? "grid-major" : "grid-minor"}" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke-width="${px(1)}"/>`);
      }
      for (let i = Math.floor(y0 / step); i * step <= y1; i++) {
        const y = round(i * step, 4);
        lines.push(`<line class="${isMajor(y) ? "grid-major" : "grid-minor"}" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke-width="${px(1)}"/>`);
      }
      parts.push(lines.join(""));
    }

    // Light pools: a soft radial glow per light that is on, clipped to its room
    const glows = [];
    const litRooms = new Set();
    const lamps = [
      ...floor.markers,
      ...this._furniture.filter((f) => catalogItem(f.type).light || f.entity_id?.startsWith("light.")),
    ];
    // Screens that are on cast a soft bluish glow (mostly noticeable at night)
    const dark = 1 - (this.daylight ?? 1);
    // Screens that are on cast a bluish glow in front of them: faint by day,
    // stronger at night. Big screens (TV, projector screen) light up further.
    const screenGlow = (f) => {
      const def = catalogItem(f.type);
      if (!def.screen || !f.entity_id || !isScreenOn(states[f.entity_id])) return null;
      const big = !!def.screenLight;
      if (!big && dark <= 0.05) return null;
      return { color: "rgb(150,190,255)", level: (big ? 0.14 : 0) + 0.35 * dark,
        radius: (big ? 1.2 : 0.6) + Math.max(f.w, f.d) * 0.9, screen: true };
    };
    for (const f of this._furniture) if (screenGlow(f) && !lamps.includes(f)) lamps.push(f);
    for (const m of lamps) {
      const light = activeLight(hass, m.entity_id) || screenGlow(m);
      if (!light) continue;
      let radius = light.radius ?? 1.2 + 2.3 * light.level;
      // Small lamps and the Light strength setting: a smaller or larger pool of light
      if (m.type && !light.screen) {
        const k = (catalogItem(m.type).light?.power ?? 1) * (m.light_strength ?? 1);
        radius = Math.min(6, Math.max(0.25, radius * Math.sqrt(k)));
      }
      // A spot with its own beam angle: a wider or tighter pool than the default
      if (m.type && m.beam_angle && !light.screen) {
        const def = catalogItem(m.type).light?.angle ?? 1.3;
        const k = Math.tan(Math.min(1.45, beamHalfAngle(m))) / Math.tan(Math.min(1.45, def));
        radius = Math.min(4, Math.max(0.25, radius * k));
      }
      // Furniture lamps glow from their bulb (e.g. the end of an arc lamp's arm); a tilted
      // spot's pool lies where it points, as far out as its height and tilt make it
      let [gx, gy] = m.type && !light.screen ? lightAnchor(m, this.floor.wall_height) : [m.x, m.y];
      const tilt = m.type && !light.screen ? tiltOf(m) : 0;
      if (tilt) {
        const a = ((m.rotation || 0) * Math.PI) / 180;
        const dir = [-Math.sin(a), Math.cos(a)];
        // ...but no further than the first wall it shines at
        let reach = Math.min(4, lightAnchor(m, this.floor.wall_height)[2] * Math.tan(tilt));
        for (const w of this.floor.walls) {
          const hit = rayHitsSegment([gx, gy], dir, w.a, w.b);
          if (hit !== null) reach = Math.min(reach, Math.max(0, hit - w.thickness / 2 - 0.05));
        }
        [gx, gy] = [gx + dir[0] * reach, gy + dir[1] * reach];
      }
      const room = this._hitRoom([gx, gy]);
      if (room && !light.screen) litRooms.add(room.id);
      const gid = `glow-${m.id}`;
      let clip = "";
      if (room) {
        glows.push(`<clipPath id="clip-${m.id}"><polygon points="${room.points.map((q) => q.join(",")).join(" ")}"/></clipPath>`);
        clip = `clip-path="url(#clip-${m.id})"`;
      }
      const a = (light.screen ? light.level * 1.6 : 0.55 + 0.35 * light.level).toFixed(2);
      glows.push(`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${gx}" cy="${gy}" r="${radius}">
          <stop offset="0" stop-color="${light.color}" stop-opacity="${a}"/>
          <stop offset="0.25" stop-color="${light.color}" stop-opacity="${(a * 0.6).toFixed(2)}"/>
          <stop offset="0.6" stop-color="${light.color}" stop-opacity="${(a * 0.2).toFixed(2)}"/>
          <stop offset="1" stop-color="${light.color}" stop-opacity="0"/>
        </radialGradient>
        <circle class="glow" cx="${gx}" cy="${gy}" r="${radius}" fill="url(#${gid})" ${clip}/>`);
    }

    // Rooms; outdoor areas first, so a garden around the house lies underneath it. Rooms
    // are see-through tints, so over a garden they get a solid backing first.
    const hasOutdoor = floor.rooms.some(isOutdoor);
    for (const r of [...floor.rooms.filter(isOutdoor), ...floor.rooms.filter((x) => !isOutdoor(x))]) {
      if (hasOutdoor && !isOutdoor(r)) {
        parts.push(`<polygon points="${r.points.map((q) => q.join(",")).join(" ")}" fill="var(--fps-bg)" stroke="none"/>`);
      }
      const { active: on, stateObj: st } = roomHighlight(hass, r);
      // A floor finish shows in its own colour with its pattern (planks, tiles…)
      const finish = floorFinish(r);
      const finished = finish.material !== "plain";
      const fill = on ? activeColor(st, r.color) : finished ? finish.color : r.color;
      // Rooms lit by a placed light get only a tint; the light's own glow does the rest
      const op = on ? (litRooms.has(r.id) ? 0.22 : 0.35 + 0.4 * brightness(st)) : finished ? 0.55 : 0.18;
      const pts = r.points.map((q) => q.join(",")).join(" ");
      const isSel = sel?.kind === "room" && sel.id === r.id;
      if (finished && on && litRooms.has(r.id)) {
        // Lit by its own lamp: keep the floor visible underneath the tint
        parts.push(`<polygon points="${pts}" fill="${escapeHtml(finish.color)}" fill-opacity="0.45" stroke="none"/>`);
      }
      parts.push(`<polygon class="room${isSel ? " sel" : ""}" points="${pts}" fill="${escapeHtml(fill)}"
        fill-opacity="${op}" stroke-width="${px(isSel ? 2 : 1)}"/>`);
      const pattern = finished ? floorPattern(`floor-${r.id}`, finish, px, r.floor_rotation || 0) : "";
      if (pattern) {
        parts.push(`<defs>${pattern}</defs><polygon class="floor-pattern" points="${pts}" fill="url(#floor-${r.id})" stroke="none"/>`);
      }
    }

    // While editing: a cable from each wired speaker and AV source to the amplifier it's connected to
    if (this.editing) {
      for (const f of this._furniture) {
        const def = catalogItem(f.type);
        const ampId = def.passive ? f.entity_id : def.av === "display" ? null : f.connected_to;
        if (!ampId) continue;
        const amp = this._furniture.find((a) => a !== f && a.entity_id === ampId && !catalogItem(a.type).passive);
        if (!amp) continue;
        parts.push(`<line class="speaker-cable" x1="${f.x}" y1="${f.y}" x2="${amp.x}" y2="${amp.y}" stroke="#7c8fa6"
          stroke-width="${px(1.5)}" stroke-dasharray="${px(6)} ${px(4)}" stroke-linecap="round" style="pointer-events:none"/>`);
      }
      // Sonos surrounds: a dotted (wireless) link to their soundbar
      for (const f of this._furniture) {
        if (!isSurround(f)) continue;
        const bar = this._furniture.find((b) => b !== f && b.entity_id === f.entity_id && catalogItem(b.type).homeTheater);
        if (!bar) continue;
        parts.push(`<line class="surround-link" x1="${f.x}" y1="${f.y}" x2="${bar.x}" y2="${bar.y}" stroke="#7c8fa6"
          stroke-width="${px(1.5)}" stroke-dasharray="${px(1)} ${px(5)}" stroke-linecap="round" style="pointer-events:none"/>`);
      }
    }

    // Furniture (below walls, under the light glows so lamps light it up)
    const waveSpots = [];
    for (const f of byHeight(this._furniture)) {
      const st = states[f.entity_id];
      const def = catalogItem(f.type);
      const light = activeLight(hass, f.entity_id);
      const alert = !!def.fov && cameraAlerts(this._hass, f.entity_id).length > 0;
      const on = def.fov ? alert : !!f.entity_id && (def.screen ? isScreenOn(st) : def.heater ? isHeating(st) : isActive(st));
      const cls = ["furniture"];
      if (sel?.kind === "furniture" && sel.id === f.id) cls.push("sel");
      if (on && !def.screen && !def.light) cls.push("active");
      if (f.entity_id && isUnavailable(st)) cls.push("unavailable");
      if (def.ceiling) cls.push("overhead"); // hangs from the ceiling: see-through, dashed
      // Playing media: sound waves pulsing out of the piece, drawn in the overlay (see _renderWaves)
      // (not while editing: moving rings get in the way of placing and selecting)
      if (!this.editing && pieceSounding(hass, f, this._furniture)) waveSpots.push(f);
      // Ambilight: a soft coloured band on the wall side, in the linked light's colour or a colour wash
      let ambi = "";
      if (def.ambilight && on) {
        const cols = light ? [light.color, light.color, light.color] : ["#8a5cff", "#3fa9ff", "#ff8a3d"];
        const blur = Math.min(f.w, 0.6) * 0.25;
        ambi = `<g class="ambi${this.dimLights ? " dim" : ""}"><defs><linearGradient id="ambi-${f.id}">${cols.map((c, i) => `<stop offset="${i / 2}" stop-color="${c}"/>`).join("")}</linearGradient>
            <filter id="ambi-blur-${f.id}" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="${blur.toFixed(3)}"/></filter></defs>
          <rect x="${-f.w / 2 - 0.1}" y="${-f.d / 2}" width="${f.w + 0.2}" height="${f.d + 0.12}" fill="url(#ambi-${f.id})"
            opacity="${(0.55 + 0.35 * (1 - (this.daylight ?? 1))).toFixed(2)}" ${this._quality().blur ? `filter="url(#ambi-blur-${f.id})"` : ""} style="pointer-events:none;stroke:none"/></g>`;
      }
      // Floodlight on: a warm beam in front of the camera
      const flood = def.floodlight ? cameraFloodlight(this._hass, f.entity_id) : null;
      if (flood) {
        const half = (def.floodlight.angle / 2) * (Math.PI / 180);
        const r = def.floodlight.range;
        const [sx, sy] = [Math.sin(half) * r, Math.cos(half) * r];
        // Saturated enough to stand out on a light plan in daylight; brighter at night
        const strength = Math.min(1, (0.75 + 0.25 * (1 - (this.daylight ?? 1))) * flood.level);
        const beam = fanPath(f, def.floodlight.angle, r, this.floor);
        ambi += `<g class="flood${this.dimLights ? " dim" : ""}"><defs><radialGradient id="flood-${f.id}" cx="0" cy="${f.d / 2}" r="${r}" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#ffd84a" stop-opacity="${strength.toFixed(2)}"/><stop offset=".5" stop-color="#ffc93c" stop-opacity="${(strength * 0.55).toFixed(2)}"/>
            <stop offset="1" stop-color="#ffb627" stop-opacity="0"/></radialGradient>
            <clipPath id="flood-clip-${f.id}"><path d="${beam}"/></clipPath></defs>
          <path d="${beam}" fill="url(#flood-${f.id})" style="pointer-events:none;stroke:none"/>
          <path d="M${-sx * 0.55},${f.d / 2 + sy * 0.55} L0,${f.d / 2} L${sx * 0.55},${f.d / 2 + sy * 0.55}" fill="none" clip-path="url(#flood-clip-${f.id})"
            stroke="#f5a700" stroke-opacity="${(strength * 0.7).toFixed(2)}" stroke-width="${px(1.5)}" stroke-dasharray="${px(5)} ${px(4)}"
            style="pointer-events:none"/></g>`;
      }
      // Camera: its field of view as a soft wedge, red while it detects motion
      // (hidden under a lit floodlight, where blue on yellow would just look grey, unless it's alerting)
      if (def.fov && (!flood || alert)) {
        const half = (Math.min(def.fov.angle, 170) / 2) * (Math.PI / 180);
        const r = def.fov.range;
        const [sx, sy] = [Math.sin(half) * r, Math.cos(half) * r];
        const col = alert ? "#ff3b30" : "#4a90d9";
        ambi += `<g class="fov${alert ? " alert" : ""}${this.dimLights ? " dim" : ""}"><defs><radialGradient id="fov-${f.id}" cx="0" cy="${f.d / 2}" r="${r}" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="${col}" stop-opacity="${alert ? 0.6 : 0.22}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient></defs>
          <path d="${fanPath(f, def.fov.angle, r, this.floor)}" fill="url(#fov-${f.id})"
            style="pointer-events:none;stroke:none"/></g>`;
      }
      // Heating radiator: warm air rising off its front
      if (def.heater && on) {
        const blur = Math.min(f.w, 0.5) * 0.25;
        const level = 0.45 + 0.55 * heatLevel(st);
        ambi += `<g class="heat" style="--heat:${level.toFixed(2)}"><defs><linearGradient id="heat-${f.id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ff4a12" stop-opacity="1"/><stop offset=".45" stop-color="#ff7a2e" stop-opacity=".55"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></linearGradient>
            <filter id="heat-blur-${f.id}" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="${blur.toFixed(3)}"/></filter></defs>
          <rect x="${-f.w / 2 - 0.1}" y="${-f.d / 2}" width="${f.w + 0.2}" height="${f.d + 0.7}" fill="url(#heat-${f.id})"
            ${this._quality().blur ? `filter="url(#heat-blur-${f.id})"` : ""} style="pointer-events:none;stroke:none"/></g>`;
      }
      // Washing machine or dryer running: its drum turning, with the programme's progress around it
      const drum = def.laundry && f.entity_id && !this.editing ? this._laundrySvg(f, def) : "";
      // A tilted spot: an arrow to where it points (longer the more it's tilted)
      const aim = def.tilt && tiltOf(f) ? (() => {
        const r = Math.max(f.w, f.d) / 2;
        const len = r + px(8) + px(14) * Math.sin(tiltOf(f));
        const hw = px(4);
        return `<path class="spot-aim" d="M0,${r} L0,${len - hw} M${-hw},${len - 2 * hw} L0,${len} L${hw},${len - 2 * hw}"
          fill="none" stroke="#f0a020" stroke-width="${px(2)}" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"/>`;
      })() : "";
      parts.push(`<g class="${cls.join(" ")}" transform="translate(${f.x} ${f.y}) rotate(${f.rotation || 0})" stroke-width="${px(1)}"${def.robot && f.entity_id ? ` data-robot="${f.id}"` : ""}>
        ${ambi}${furnitureSvg(f, { activeScreen: on && def.screen, glowColor: light && def.light ? light.color : null,
          tvPlaying: on && !!def.screenLight && st?.state !== "paused", heat: def.heater && on ? heatLevel(st) || 1 : 0, lampLit: !!flood })}${drum}${aim}
        <rect class="outline" x="${-f.w / 2}" y="${-f.d / 2}" width="${f.w}" height="${f.d}" stroke-width="${px(def.ceiling ? 1.2 : 2)}"
          ${def.ceiling ? `stroke-dasharray="${px(4)} ${px(3)}"` : ""}/>
      </g>`);
    }

    // Night: dim the whole plan; the light glows drawn next shine through it
    const night = 1 - (this.daylight ?? 1);
    // Door/window openings use the background colour; darken them along with the plan
    this._world.style.setProperty("--fps-gap", night > 0.02
      ? `color-mix(in srgb, var(--fps-bg) ${Math.round(100 - 62 * night)}%, #070b1e)` : "");
    if (night > 0.02) {
      const [nx0, ny0] = this._toWorld(0, 0);
      const [nx1, ny1] = this._toWorld(w, h);
      parts.push(`<rect class="night" x="${nx0}" y="${ny0}" width="${nx1 - nx0}" height="${ny1 - ny0}"
        fill="#070b1e" fill-opacity="${(0.62 * night).toFixed(3)}"/>`);
    }

    if (glows.length) parts.push(`<g class="glows${this.dimLights ? " dim" : ""}">${glows.join("")}</g>`);

    // Outline of another floor (editing), to line this one up with
    if (this.editing && this.underlay) {
      const u = this.underlay;
      parts.push(`<g class="underlay">
        ${u.rooms.map((r) => `<polygon points="${r.points.map((q) => q.join(",")).join(" ")}"
          stroke-width="${px(1)}" stroke-dasharray="${px(5)} ${px(4)}"/>`).join("")}
        ${u.walls.map((wl) => `<line x1="${wl.a[0]}" y1="${wl.a[1]}" x2="${wl.b[0]}" y2="${wl.b[1]}"
          stroke-width="${wl.thickness}" stroke-linecap="square"/>`).join("")}
      </g>`);
    }
    this.classList.toggle("move-floor", this.editing && this.tool === "move-floor");

    // Walls
    for (const wall of floor.walls) {
      const isSel = sel?.kind === "wall" && sel.id === wall.id;
      parts.push(`<line class="wall${isSel ? " sel" : ""}" x1="${wall.a[0]}" y1="${wall.a[1]}"
        x2="${wall.b[0]}" y2="${wall.b[1]}" stroke-width="${wall.thickness}" stroke-linecap="square"/>`);
    }

    // Openings
    for (const o of floor.openings) {
      const wall = floor.walls.find((x) => x.id === o.wall_id);
      if (!wall) continue;
      const len = dist(wall.a, wall.b);
      if (len < 1e-6) continue;
      const u = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len];
      const n = [-u[1], u[0]];
      const half = Math.min(o.width / 2, len / 2);
      const c = [wall.a[0] + u[0] * o.t * len, wall.a[1] + u[1] * o.t * len];
      const s = [c[0] - u[0] * half, c[1] - u[1] * half];
      const e = [c[0] + u[0] * half, c[1] + u[1] * half];
      const isSel = sel?.kind === "opening" && sel.id === o.id;
      const on = o.entity_id && isActive(states[o.entity_id]);
      let g = `<line class="gap" x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke-width="${wall.thickness + px(1)}"/>`;
      if (o.type === "door" && o.style === "sliding_double") {
        // Two sliding leaves meeting in the middle (slightly apart, like on a drawing),
        // with arrows to where they slide; open: pushed aside into the wall
        const lw = Math.min(wall.thickness * 0.35, px(4));
        const off = wall.thickness * 0.12;
        const pt = (a, b, f, k) => [a[0] + (b[0] - a[0]) * f + n[0] * k, a[1] + (b[1] - a[1]) * f + n[1] * k];
        const leaf = (f0, f1, k, glassy = true) => {
          const p0 = pt(s, e, f0, k);
          const p1 = pt(s, e, f1, k);
          const g0 = pt(s, e, f0 + (f1 - f0) * 0.2, k);
          const g1 = pt(s, e, f0 + (f1 - f0) * 0.8, k);
          return `<line class="door-leaf" x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke-width="${lw}"/>` +
            (glassy ? `<line x1="${g0[0]}" y1="${g0[1]}" x2="${g1[0]}" y2="${g1[1]}" stroke="#8fcaf0" stroke-width="${lw * 0.45}" style="pointer-events:none"/>` : "");
        };
        if (on) {
          g += leaf(-0.48, 0.02, -off) + leaf(0.98, 1.48, off);
        } else {
          g += leaf(0, 0.52, -off) + leaf(0.48, 1, off);
          const arrow = (f0, f1) => {
            const a = pt(s, e, f0, 0);
            const b = pt(s, e, f1, 0);
            return `<path class="door-swing hint" stroke-width="${px(1)}" d="M${a[0]},${a[1]} L${b[0]},${b[1]}"/>`;
          };
          g += arrow(0.4, 0.15) + arrow(0.6, 0.85);
        }
      } else if (o.type === "door") {
        const wd = half * 2;
        // Hinge at the opening's start (or end when flipped); the leaf swings to
        // the wall's normal side (or the other side when flipped)
        const hinge = o.flip_hinge ? e : s;
        const free = o.flip_hinge ? s : e;
        const side = o.flip_swing ? -1 : 1;
        const tip = [hinge[0] + n[0] * wd * side, hinge[1] + n[1] * wd * side];
        // Arc from the open leaf back to the closed position; direction depends on the flips
        const cross = (tip[0] - hinge[0]) * (free[1] - hinge[1]) - (tip[1] - hinge[1]) * (free[0] - hinge[0]);
        const arc = `A${wd},${wd} 0 0 ${cross > 0 ? 1 : 0} ${free[0]},${free[1]}`;
        if (on) {
          // Open (sensor says so): leaf swung out, with its swing arc
          g += `<path class="door-swing active" stroke-width="${px(1.5)}"
            d="M${hinge[0]},${hinge[1]} L${tip[0]},${tip[1]} ${arc}"/>`;
        } else {
          // Closed: leaf shut in the opening, the swing arc only as a faint hint
          g += `<path class="door-swing hint" stroke-width="${px(1)}" stroke-dasharray="${px(4)} ${px(3)}"
            d="M${tip[0]},${tip[1]} ${arc}"/>
            <line class="door-leaf" x1="${hinge[0]}" y1="${hinge[1]}" x2="${free[0]}" y2="${free[1]}"
              stroke-width="${Math.min(wall.thickness * 0.45, px(5))}"/>${["half_glass", "half_glass_single", "glass"].includes(o.style)
              ? `<line x1="${hinge[0] + (free[0] - hinge[0]) * 0.18}" y1="${hinge[1] + (free[1] - hinge[1]) * 0.18}"
                x2="${hinge[0] + (free[0] - hinge[0]) * 0.82}" y2="${hinge[1] + (free[1] - hinge[1]) * 0.82}"
                stroke="#8fcaf0" stroke-width="${Math.min(wall.thickness * 0.2, px(2.2))}" style="pointer-events:none"/>` : ""}`;
        }
      } else {
        const off = wall.thickness / 4;
        for (const k of [-1, 1]) {
          g += `<line class="window-line" x1="${s[0] + n[0] * off * k}" y1="${s[1] + n[1] * off * k}"
            x2="${e[0] + n[0] * off * k}" y2="${e[1] + n[1] * off * k}" stroke-width="${px(1.5)}"/>`;
        }
        if (on) {
          // Open: sash(es) swung out ~40°, one per side on wide windows (same rule as 3D)
          const a = (40 * Math.PI) / 180;
          const side = o.flip_swing ? -1 : 1;
          const double = half * 2 - 0.12 > 1.2;
          const sashes = double
            ? [[s, u, half], [e, [-u[0], -u[1]], half]]
            : o.flip_hinge ? [[e, [-u[0], -u[1]], half * 2]] : [[s, u, half * 2]];
          for (const [hp, dir, len] of sashes) {
            const tx = hp[0] + (dir[0] * Math.cos(a) + n[0] * side * Math.sin(a)) * len;
            const ty = hp[1] + (dir[1] * Math.cos(a) + n[1] * side * Math.sin(a)) * len;
            g += `<line class="window-sash" x1="${hp[0]}" y1="${hp[1]}" x2="${tx}" y2="${ty}" stroke-width="${px(2.5)}"/>`;
          }
        } else {
          g += `<line class="window-line" x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke-width="${px(1)}"/>`;
        }
      }
      parts.push(`<g class="opening${isSel ? " sel" : ""}">${g}</g>`);
    }

    // Roofs (edit mode): the outline with its overhang, and the ridge and hip lines
    if (this.editing) {
      for (const roof of floor.roofs || []) {
        const g = roofGeometry(roof);
        const isSel = sel?.kind === "roof" && sel.id === roof.id;
        const pts = (list) => list.map((q) => q.join(",")).join(" ");
        parts.push(`<g class="roof${isSel ? " sel" : ""}">
          <polygon class="roof-eave" points="${pts(g.outline)}" stroke-width="${px(isSel ? 2 : 1.5)}" stroke-dasharray="${px(7)} ${px(4)}"/>
          <polygon class="roof-wall" points="${pts(roof.points)}" stroke-width="${px(1)}"/>
          ${g.lines.map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-width="${px(isSel ? 2 : 1.2)}"/>`).join("")}
        </g>`);
      }
    }

    // Selection handles
    if (this.editing && sel) {
      const handle = (q) => `<circle class="handle" cx="${q[0]}" cy="${q[1]}" r="${px(5)}" stroke-width="${px(2)}"/>`;
      if (sel.kind === "wall") {
        const wall = floor.walls.find((x) => x.id === sel.id);
        if (wall) parts.push(handle(wall.a) + handle(wall.b));
      } else if (sel.kind === "room") {
        const r = floor.rooms.find((x) => x.id === sel.id);
        if (r) parts.push(r.points.map(handle).join(""));
      } else if (sel.kind === "roof") {
        const r = (floor.roofs || []).find((x) => x.id === sel.id);
        if (r) parts.push(r.points.map(handle).join(""));
      } else if (sel.kind === "furniture") {
        const f = this._furniture.find((x) => x.id === sel.id);
        if (f) {
          const back = toWorld(f, [0, -f.d / 2]);
          const knob = this._rotateKnob(f);
          parts.push(`<line class="rot-line" x1="${back[0]}" y1="${back[1]}" x2="${knob[0]}" y2="${knob[1]}" stroke-width="${px(1.5)}"/>`);
          parts.push([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => handle(toWorld(f, [(sx * f.w) / 2, (sy * f.d) / 2]))).join(""));
          parts.push(`<circle class="handle" cx="${knob[0]}" cy="${knob[1]}" r="${px(6)}" stroke-width="${px(2)}"/>`);
        }
      }
    }

    // Draft
    if (this.editing && (this._draft || this._cursor)) {
      const pts = [...(this._draft?.points || [])];
      if (this._cursor && this.tool !== "select" && this.tool !== "marker") pts.push(this._cursor);
      if (this._draft?.tool === "room" && pts.length >= 3) {
        parts.push(`<polygon class="draft-fill" points="${pts.map((q) => q.join(",")).join(" ")}"/>`);
      }
      if (pts.length >= 2) {
        parts.push(`<polyline class="draft" points="${pts.map((q) => q.join(",")).join(" ")}"
          stroke-width="${px(2)}" stroke-dasharray="${px(6)} ${px(4)}"/>`);
      }
      pts.forEach((q) => parts.push(`<circle class="handle" cx="${q[0]}" cy="${q[1]}" r="${px(3)}" stroke-width="${px(1.5)}"/>`));
      if (this._snapHit) {
        parts.push(`<circle class="snap" cx="${this._snapHit[0]}" cy="${this._snapHit[1]}" r="${px(9)}" stroke-width="${px(2)}"/>`);
      }
    }

    // State updates arrive many times a second (from the whole house); only redraw when
    // the plan actually looks different, so animations (sound waves, TVs) don't restart
    const html = parts.join("");
    if (html !== this._lastHtml) {
      this._lastHtml = html;
      this._world.innerHTML = html;
    }
    this._renderWaves(waveSpots);
    this._moveRobots();
    this._renderCompass();

    const empty = !floor.walls.length && !floor.rooms.length && !floor.markers.length && !this._furniture.length && !bp;
    this._empty.hidden = !empty || this.editing;
    const emptyText = t("This floor is empty. Click Edit to start drawing.");
    if (this._empty.textContent !== emptyText) this._empty.textContent = emptyText;

    this._renderOverlay(states);
  }

  /** Robot vacuums drive around the room they're cleaning (not while editing: they stay at their place). */
  _moveRobots() {
    const els = this._world.querySelectorAll("[data-robot]");
    let busy = false;
    for (const el of els) {
      const f = this._furniture.find((x) => x.id === el.dataset.robot);
      if (!f) continue;
      const pose = this.editing ? { x: f.x, y: f.y, rotation: f.rotation || 0 } : robotPose(this._hass, f, this.floor.rooms);
      el.setAttribute("transform", `translate(${pose.x.toFixed(3)} ${pose.y.toFixed(3)}) rotate(${pose.rotation.toFixed(1)})`);
      if (!this.editing && robotBusy(this._hass, f)) busy = true;
    }
    if (busy && !this._robotRaf) {
      this._robotRaf = requestAnimationFrame(() => {
        this._robotRaf = null;
        if (this.isConnected) this._moveRobots();
      });
    }
  }

  /**
   * A running washing machine or dryer: its drum, tumbling back and forth (or spinning
   * fast at the end of a wash), with the programme's progress as a ring around it.
   */
  _laundrySvg(f, def) {
    const ls = laundryState(this._hass, f.entity_id, { washer: def.laundry === "washer" });
    if (!ls.running) return "";
    const px = (n) => n / this.zoom;
    const r = Math.min(f.w, f.d) * 0.3;
    const ring = r * 1.22;
    const around = 2 * Math.PI * ring;
    // The plan is redrawn on state changes: start each redraw where the turning had got to
    const period = ls.spinning ? 0.45 : 9;
    const delay = -((performance.now() / 1000) % period);
    const lifter = (deg) => {
      const a = (deg * Math.PI) / 180;
      return `<circle cx="${(Math.cos(a) * r * 0.72).toFixed(4)}" cy="${(Math.sin(a) * r * 0.72).toFixed(4)}" r="${(r * 0.13).toFixed(4)}" fill="#dedad2"/>`;
    };
    return `<g class="laundry" style="pointer-events:none">
        <circle r="${r}" fill="#24272c" stroke="#d3d6da" stroke-width="${px(1.5)}"/>
        <g class="drum-turn${ls.spinning ? " spin" : ""}" style="animation-delay:${delay.toFixed(2)}s">
          ${[90, 210, 330].map(lifter).join("")}
          <circle cx="${-r * 0.25}" cy="${r * 0.3}" r="${r * 0.28}" fill="#3c64a8"/>
          <circle cx="${r * 0.28}" cy="${r * 0.22}" r="${r * 0.24}" fill="#e6e1d6"/>
        </g>
        ${ls.progress === null ? "" : `<circle r="${ring}" fill="none" stroke="#3d8bff" stroke-opacity=".25" stroke-width="${px(3)}"/>
        <circle r="${ring}" fill="none" stroke="#3d8bff" stroke-width="${px(3)}" stroke-linecap="round" transform="rotate(-90)"
          stroke-dasharray="${(ls.progress * around).toFixed(4)} ${around.toFixed(4)}"/>`}
      </g>`;
  }

  /**
   * Sound waves around playing speakers: two rings each, clipped to where the sound
   * reaches (walls stop it). Kept, not recreated, so they keep pulsing smoothly.
   */
  _renderWaves(pieces) {
    const seen = new Set();
    for (const f of pieces) {
      seen.add(f.id);
      const r0 = Math.max(f.w, f.d) / 2 + 0.05;
      const range = r0 + 0.7;
      let el = this._waveEls.get(f.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "wave-area";
        [0, 0.8].forEach((off) => {
          const ring = document.createElement("div");
          ring.className = "wave";
          // In step with the clock, so rings of different pieces pulse together
          ring.style.animationDelay = `${(-((Date.now() / 1000 + off) % 1.6)).toFixed(3)}s`;
          el.appendChild(ring);
        });
        this._waveLayer.appendChild(el);
        this._waveEls.set(f.id, el);
      }
      el.classList.toggle("soft", isSurround(f) && surroundLevel(this._hass, f.entity_id) < 1);
      const z = this.zoom;
      const [sx, sy] = this._toScreen([f.x, f.y]);
      const box = 2 * range * z;
      el.style.left = `${sx.toFixed(1)}px`;
      el.style.top = `${sy.toFixed(1)}px`;
      el.style.width = el.style.height = `${box.toFixed(1)}px`;
      const key = `${f.x},${f.y},${f.w},${f.d},${z},${this._wallsKey()}`;
      if (el._key !== key) {
        el._key = key;
        const pts = soundArea([f.x, f.y], range, this.floor);
        el.style.clipPath = `polygon(${pts.map(([x, y]) => `${((x - f.x + range) * z).toFixed(1)}px ${((y - f.y + range) * z).toFixed(1)}px`).join(",")})`;
        for (const ring of el.children) {
          ring.style.width = ring.style.height = `${(2 * r0 * z).toFixed(1)}px`;
          ring.style.setProperty("--s", (range / r0).toFixed(3));
        }
      }
    }
    for (const [id, el] of this._waveEls) {
      if (!seen.has(id)) {
        el.remove();
        this._waveEls.delete(id);
      }
    }
  }

  /** Changes whenever walls or openings change (for cached wall-dependent shapes). */
  _wallsKey() {
    const f = this.floor;
    if (this._wallsKeyFor !== f.walls || this._wallsKeyOpenings !== JSON.stringify(f.openings) || this._wallsKeyWalls !== JSON.stringify(f.walls)) {
      this._wallsKeyFor = f.walls;
      this._wallsKeyWalls = JSON.stringify(f.walls);
      this._wallsKeyOpenings = JSON.stringify(f.openings);
      this._wallsKeyN = (this._wallsKeyN || 0) + 1;
    }
    return this._wallsKeyN;
  }

  _renderOverlay(states) {
    const floor = this.floor;
    const hass = this._hass;
    const sel = this.selection;
    const seen = new Set();

    // Room labels
    for (const r of floor.rooms) {
      seen.add(`room:${r.id}`);
      let el = this._labelEls.get(r.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "label";
        this._overlay.appendChild(el);
        this._labelEls.set(r.id, el);
      }
      const [sx, sy] = this._toScreen(isOutdoor(r) ? labelPoint(r, floor.rooms.filter((x) => !isOutdoor(x) || polygonArea(x.points) < polygonArea(r.points))) : polygonCenter(r.points));
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      const labelEntity = roomLabelEntity(hass, r);
      const value = labelEntity ? formatState(hass, states[labelEntity]) : "";
      const html = `<div class="name">${escapeHtml(r.name)}</div>${value ? `<div class="value">${escapeHtml(value)}</div>` : ""}`;
      if (el._html !== html) {
        el.innerHTML = html;
        el._html = html;
      }
      el.hidden = this.zoom < 12;
    }
    for (const [id, el] of this._labelEls) {
      if (!seen.has(`room:${id}`)) {
        el.remove();
        this._labelEls.delete(id);
      }
    }

    // Markers
    for (const m of floor.markers) {
      seen.add(`marker:${m.id}`);
      const st = states[m.entity_id];
      let el = this._markerEls.get(m.id);
      const iconKey = `${m.icon || ""}|${!!st}`;
      if (!el || el._iconKey !== iconKey) {
        el?.remove();
        el = document.createElement("div");
        el.className = "marker";
        el.innerHTML = `<div class="bubble"></div><div class="state" hidden></div>`;
        el._icon = createStateIcon(hass, st, m.icon || (st ? undefined : "mdi:help"));
        el.querySelector(".bubble").appendChild(el._icon);
        el._iconKey = iconKey;
        el.addEventListener("pointerdown", (e) => this._onMarkerDown(e, el._marker));
        el.addEventListener("click", (e) => this._onMarkerClick(e, el._marker));
        this._overlay.appendChild(el);
        this._markerEls.set(m.id, el);
      }
      el._marker = m;
      if (el._icon.tagName === "HA-STATE-ICON") {
        el._icon.hass = hass;
        el._icon.stateObj = st;
      }
      const [sx, sy] = this._toScreen([m.x, m.y]);
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      const on = isActive(st);
      el.classList.toggle("active", on);
      el.classList.toggle("playing", !this.editing && isPlaying(st));
      el.classList.toggle("unavailable", !!st && isUnavailable(st));
      el.classList.toggle("missing", !st);
      el.classList.toggle("sel", sel?.kind === "marker" && sel.id === m.id);
      el.style.setProperty("--fps-marker-active", on ? activeColor(st, "var(--fps-active)") : "");
      el.title = st?.attributes?.friendly_name || m.entity_id || t("No entity selected");
      const stateEl = el.querySelector(".state");
      stateEl.hidden = !m.show_state || !st;
      if (m.show_state && st) stateEl.textContent = formatState(hass, st);
    }
    for (const [id, el] of this._markerEls) {
      if (!seen.has(`marker:${id}`)) {
        el.remove();
        this._markerEls.delete(id);
      }
    }

    // Status badges on furniture (e.g. a plant's soil moisture)
    for (const f of this._furniture) {
      if (!f.show_state || !f.entity_id) continue;
      seen.add(`badge:${f.id}`);
      let el = this._badgeEls.get(f.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "badge";
        this._overlay.appendChild(el);
        this._badgeEls.set(f.id, el);
      }
      const [sx, sy] = this._toScreen([f.x, f.y]);
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.textContent = formatState(hass, states[f.entity_id]);
    }
    for (const [id, el] of this._badgeEls) {
      if (!seen.has(`badge:${id}`)) {
        el.remove();
        this._badgeEls.delete(id);
      }
    }
  }

  _onMarkerDown(e, m) {
    if (!this.editing || e.button !== 0) return;
    e.stopPropagation();
    this._select({ kind: "marker", id: m.id });
    // Route the drag through the SVG so move/up events share one code path
    this._svg.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, [e.clientX, e.clientY]);
    this._action = { type: "drag-marker", x: e.clientX, y: e.clientY, moved: false, marker: m, orig: [m.x, m.y] };
  }

  _onMarkerClick(e, m) {
    e.stopPropagation();
    if (this.editing) return;
    const [x, y] = [e.clientX, e.clientY];
    this._taps.tap(`m:${m.id}`, x, y, () => runTapAction(this, this._hass, m.entity_id, m.tap_action),
      doubleTapHandler(this, this._hass, m, () => this._zoomIn(x, y)));
  }

  /** Double-tap zoom: twice as close, centred on the tapped point. */
  _zoomIn(clientX, clientY) {
    const r = this._svg.getBoundingClientRect();
    this._zoomAt(clientX - r.left, clientY - r.top, 2);
  }
}

// A newer version loaded into a page that still runs the old one (HA restarted
// while the panel was open): keep the old one and tell it a reload is needed
if (!customElements.get("fps-plan-2d")) customElements.define("fps-plan-2d", FpsPlan2D);
else window.dispatchEvent(new CustomEvent("fps-update-available"));
