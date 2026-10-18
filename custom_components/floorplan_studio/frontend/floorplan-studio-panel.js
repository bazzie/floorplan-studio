// Floorplan Studio sidebar panel.
import "./plan2d.js";
import "./view3d.js";
import {
  areaEntities,
  areaOfEntity,
  canToggle,
  clone,
  countDuplicateOpenings,
  createStateIcon,
  dist,
  escapeHtml,
  formatState,
  friendlyName,
  isPlaceable,
  listAreas,
  newFloor,
  DOUBLE_TAP_ACTIONS,
  cameraEventImage,
  cameraPersons,
  cameraStreaming,
  doubleTapAction,
  floodlightEntity,
  domainOf,
  runTapAction,
  newMarker,
  normalizeAngle,
  normalizeDoc,
  planEntities,
  readPref,
  removeDuplicateOpenings,
  round,
  shiftFloor,
  sortEntities,
  writePref,
} from "./model.js";

import { CATALOG, CATEGORIES, SUBCATEGORIES, MIN_HEIGHT, MIN_SIZE, catalogItem, defaultBeamAngle, displayFeed, duplicateFurniture, newFurniture, tidyAvWiring } from "./furniture.js";
import { FLOOR_MATERIALS, ROOF_MATERIALS, WALL_MATERIALS, floorFinish, isOutdoor, roofFinish, wallFinish } from "./materials.js";
import { ROOF_TYPES, roofHeight } from "./roof.js";
import { cleaningRoom, currentRoomSensor, vacuumRooms } from "./robot.js";
import { autoQuality, needsMeasurement, qualityMode, setMeasuredQuality, setQualityMode } from "./quality.js";

// For places where `t` is a local variable (an event target)
const translate = (text, vars) => t(text, vars);
import { parseObj, scanToFloor } from "./scan.js";
import { setLanguage, t } from "./i18n.js";

const PALETTE_LIMIT = 150;

// Day/night: "auto" follows sun.sun; the choice is remembered per device
const DAY_MODES = {
  auto: { icon: "mdi:sun-clock", label: "Auto (follows the sun)" },
  day: { icon: "mdi:weather-sunny", label: "Day" },
  night: { icon: "mdi:weather-night", label: "Night" },
};
const smoothstep = (a, b, v) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const DOMAIN = "floorplan_studio";
const IMAGE_URL = "/api/floorplan_studio/image";
const MAX_UNDO = 100;
const AUTOSAVE_DELAY = 1000; // ms after the last change

const TOOLS = [
  { id: "select", key: "v", label: "Select", icon: "mdi:cursor-default-outline",
    help: "Click to select. Drag items, wall ends or room corners to move them. Drag empty space to pan." },
  { id: "wall", key: "w", label: "Wall", icon: "mdi:wall",
    help: "Click to place wall points. Double-click, right-click, Enter or Esc to finish. Shift locks to 45°, Alt disables snapping." },
  { id: "room", key: "r", label: "Room", icon: "mdi:vector-polygon",
    help: "Click the room corners, then click the first point (or press Enter) to close the room." },
  { id: "area", key: "g", label: "Outdoor area", icon: "mdi:grass",
    help: "Draw a garden, lawn, terrace or pond like a room: click the corners, then the first point (or Enter). Pick grass, paving, gravel, decking, soil or water as its floor." },
  { id: "roof", key: "o", label: "Roof", icon: "mdi:home-roof",
    help: "Draw a roof on the floor whose walls carry it: click its corners along the outside of the walls, then the first point (or Enter). Click a roof to select it (drag to move, drag its corners to reshape); set its type, pitch and covering on the right. Use separate roofs for an L-shaped house." },
  { id: "door", key: "d", label: "Door", icon: "mdi:door",
    help: "Click on a wall to add a door. Drag it along the wall to move it." },
  { id: "window", key: "n", label: "Window", icon: "mdi:window-closed-variant",
    help: "Click on a wall to add a window. Drag it along the wall to move it." },
  { id: "marker", key: "m", label: "Entity", icon: "mdi:map-marker-plus-outline",
    help: "Search for an entity on the right and drag it onto the plan. Drag a marker onto the side panel to remove it." },
  { id: "furniture", key: "f", label: "Furniture", icon: "mdi:sofa-outline",
    help: "Drag a piece from the catalog onto the plan. Drag its corners to resize and the round handle to rotate (Alt for fine steps). Drag an entity onto a piece to link it." },
  { id: "calibrate", key: "c", label: "Scale", icon: "mdi:ruler",
    help: "Click two points on the blueprint whose real distance you know to set its scale." },
  // Started from the Floor section, not the toolbar
  { id: "move-floor", hidden: true, label: "Move floor", icon: "mdi:cursor-move",
    help: "Drag anywhere to move this whole floor. It snaps to the grid and to the corners of the outlined floor (Alt: no snapping). Esc when done." },
];

const STYLE = `
[hidden] { display:none !important; }
/* HA's panel container has no definite height, so size to the viewport */
:host { display:block; height:100vh; height:100dvh; background:var(--primary-background-color);
  color:var(--primary-text-color); font-family:var(--paper-font-body1_-_font-family, Roboto, sans-serif);
  --fps-bg:var(--primary-background-color, #fafafa);
  --fps-wall:var(--primary-text-color, #212121);
  --fps-grid:rgba(127,127,127,.15);
  --fps-grid-major:rgba(127,127,127,.32);
  --fps-room-stroke:rgba(127,127,127,.55);
  --fps-active:var(--state-light-active-color, #ffb300);
  --fps-icon-off:var(--state-icon-color, #44739e);
  --fps-wall-3d:#efeee9; --fps-slab-3d:#b3b0a8; --fps-ground-3d:#d9dad3; }
* { box-sizing:border-box; }
.app { display:flex; flex-direction:column; height:100%; position:relative; }
.ents { display:flex; flex-direction:column; gap:2px; margin:0 -6px 8px; }
.ent { display:flex; align-items:center; gap:10px; padding:6px; border-radius:8px; cursor:grab;
  touch-action:pan-y; user-select:none; -webkit-user-select:none; }
.ent:hover { background:var(--secondary-background-color); }
.ent .ico { width:24px; display:flex; justify-content:center; color:var(--state-icon-color, #44739e); flex:none; }
.ent .txt { flex:1; min-width:0; display:flex; flex-direction:column; }
.ent .nm { font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ent .st { font-size:12px; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ent .mark { color:var(--secondary-text-color); --mdc-icon-size:18px; flex:none; }
.ent.placed .mark { color:var(--success-color, #43a047); }
.ent.dragging { opacity:.4; }
.search { margin-bottom:8px; }
.catalog { display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:10px; }
details.cat { border-bottom:1px solid var(--divider-color); }
details.cat summary { display:flex; align-items:center; gap:6px; padding:9px 2px; cursor:pointer; list-style:none;
  font-weight:500; user-select:none; -webkit-user-select:none; }
details.cat summary::-webkit-details-marker { display:none; }
details.cat summary ha-icon { --mdc-icon-size:20px; color:var(--secondary-text-color); transition:transform .15s; }
details.cat[open] > summary ha-icon { transform:rotate(90deg); }
details.cat summary .count { margin-left:auto; font-size:12px; font-weight:400; color:var(--secondary-text-color); }
details.cat .catalog { margin-top:2px; }
details.cat.sub { margin-left:14px; border-bottom:none; border-top:1px solid var(--divider-color); }
details.cat.sub summary { padding:7px 2px; font-size:13px; }
@media (prefers-reduced-motion: reduce) { details.cat summary ha-icon { transition:none; } }
.tile { display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 4px; border-radius:10px;
  border:1px solid var(--divider-color); background:var(--card-background-color); cursor:grab; text-align:center;
  font-size:12px; line-height:1.2; touch-action:pan-y; user-select:none; -webkit-user-select:none; }
.tile:hover { border-color:var(--primary-color); }
.tile ha-icon { --mdc-icon-size:26px; color:var(--state-icon-color, #44739e); }
.tile.dragging { opacity:.4; }
.ghost { position:absolute; z-index:20; pointer-events:none; transform:translate(-50%,-50%);
  display:flex; align-items:center; gap:6px; padding:6px 10px 6px 6px; border-radius:18px;
  background:var(--card-background-color,#fff); color:var(--primary-text-color); font-size:13px;
  box-shadow:0 4px 14px rgba(0,0,0,.3); white-space:nowrap; }
.ghost .ico { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  background:var(--primary-color); color:var(--text-primary-color,#fff); --mdc-icon-size:16px; }
.ghost.removing .ico { background:var(--error-color,#db4437); }
.trash { position:absolute; z-index:15; display:flex; flex-direction:column; gap:6px; align-items:center;
  justify-content:center; pointer-events:none; font-size:15px; font-weight:500;
  color:var(--error-color,#db4437); background:color-mix(in srgb, var(--card-background-color,#fff) 88%, transparent);
  border:2px dashed currentColor; border-radius:12px; }
.trash ha-icon { --mdc-icon-size:36px; }
.trash.over { background:color-mix(in srgb, var(--error-color,#db4437) 14%, var(--card-background-color,#fff)); }
header { display:flex; align-items:center; gap:8px; min-height:56px; padding:4px 12px;
  background:var(--app-header-background-color, var(--primary-color));
  color:var(--app-header-text-color, #fff); flex-wrap:wrap; }
header .title { font-size:20px; margin-right:8px; }
.spacer { flex:1; }
.tabs { display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
/* Header controls derive from the header text colour, so they work on both
   coloured headers and the light header of newer HA versions */
.tab { border:0; padding:6px 12px; border-radius:16px; cursor:pointer; font:inherit; font-size:14px;
  background:color-mix(in srgb, currentColor 10%, transparent); color:inherit; }
.tab.on { background:color-mix(in srgb, currentColor 26%, transparent); font-weight:600; }
.seg { display:flex; border-radius:16px; overflow:hidden; border:1px solid color-mix(in srgb, currentColor 45%, transparent); }
.seg button { border:0; background:transparent; color:inherit; padding:6px 14px; cursor:pointer; font:inherit; font-size:14px; }
.seg button.on { background:color-mix(in srgb, currentColor 22%, transparent); font-weight:600; }
.hbtn { border:1px solid color-mix(in srgb, currentColor 45%, transparent); background:transparent; color:inherit; cursor:pointer;
  padding:6px 12px; border-radius:16px; font:inherit; font-size:14px; display:inline-flex; gap:4px; align-items:center; }
.hbtn.primary { background:color-mix(in srgb, currentColor 22%, transparent); font-weight:600; }
.hbtn:disabled { opacity:.45; cursor:default; }
.hbtn ha-icon { --mdc-icon-size:18px; }
.save-status { font-size:12px; opacity:.85; display:inline-flex; gap:4px; align-items:center; white-space:nowrap; }
.save-status ha-icon { --mdc-icon-size:16px; }
.save-status.error { opacity:1; color:#fff; background:var(--error-color, #db4437); font-weight:500;
  padding:3px 8px; border-radius:10px; }
.body { flex:1; display:flex; min-height:0; position:relative; }
.tools { display:flex; flex-direction:column; gap:4px; padding:8px 6px; border-right:1px solid var(--divider-color);
  background:var(--card-background-color); overflow-y:auto; }
.tool { width:56px; padding:6px 0; border:0; border-radius:10px; background:transparent; cursor:pointer;
  color:var(--primary-text-color); display:flex; flex-direction:column; align-items:center; gap:2px; font:inherit; font-size:11px; }
.tool:hover { background:var(--secondary-background-color); }
.tool.on { background:var(--primary-color); color:var(--text-primary-color, #fff); }
.tool:disabled { opacity:.35; cursor:default; }
.stage { flex:1; position:relative; min-width:0; }
.stage > * { position:absolute; inset:0; }
aside { width:300px; border-left:1px solid var(--divider-color); background:var(--card-background-color);
  overflow-y:auto; padding:12px 14px; font-size:14px; }
aside h3 { margin:4px 0 10px; font-size:16px; font-weight:500; display:flex; align-items:center; gap:6px; }
aside h4 { margin:16px 0 8px; font-size:13px; font-weight:500; text-transform:uppercase;
  letter-spacing:.04em; color:var(--secondary-text-color); }
.field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
.field label, .row label { font-size:12px; color:var(--secondary-text-color); }
.row { display:flex; gap:8px; }
.row .field { flex:1; min-width:0; }
.check { display:flex; gap:8px; align-items:center; margin-bottom:10px; font-size:14px; }
input, select { font:inherit; font-size:14px; padding:7px 8px; border-radius:6px; width:100%;
  border:1px solid var(--divider-color); background:var(--secondary-background-color, transparent);
  color:var(--primary-text-color); }
input[type=checkbox] { width:auto; }
input[type=color] { padding:2px; height:36px; }
input[type=range] { padding:0; }
.btn { font:inherit; font-size:14px; padding:7px 12px; border-radius:6px; cursor:pointer;
  border:1px solid var(--divider-color); background:var(--secondary-background-color);
  color:var(--primary-text-color); display:inline-flex; gap:6px; align-items:center; }
.btn.danger { color:var(--error-color, #db4437); border-color:currentColor; background:transparent; }
.btn.primary { background:var(--primary-color); color:var(--text-primary-color,#fff); border-color:var(--primary-color); }
.btn ha-icon { --mdc-icon-size:18px; }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
.help { font-size:13px; color:var(--secondary-text-color); background:var(--secondary-background-color);
  padding:8px 10px; border-radius:8px; line-height:1.4; margin-bottom:12px; }
.muted { color:var(--secondary-text-color); font-size:12px; }
.warn { color:var(--warning-color, #ff9800); font-size:12px; }
.campops { position:absolute; top:12px; right:12px; z-index:6; display:flex; flex-direction:column; gap:10px;
  width:min(380px, calc(100% - 24px)); pointer-events:none; }
.campop { pointer-events:auto; background:var(--card-background-color,#fff); color:var(--primary-text-color);
  border-radius:12px; overflow:hidden; box-shadow:0 6px 24px rgba(0,0,0,.35); border:2px solid var(--error-color,#db4437);
  animation:fps-pop .25s ease-out; }
.campop.clear { border-color:var(--divider-color,#ccc); }
.campop .hd { display:flex; align-items:center; gap:8px; padding:8px 10px; }
.campop .dot { width:10px; height:10px; border-radius:50%; background:var(--error-color,#db4437); flex:none;
  animation:fps-blink 1s ease-in-out infinite alternate; }
.campop.clear .dot { background:var(--secondary-text-color); animation:none; }
.campop .t { flex:1; min-width:0; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.campop .t small { display:block; font-weight:400; color:var(--secondary-text-color); font-size:12px; }
.campop button { border:0; background:none; color:inherit; cursor:pointer; font:inherit; padding:4px 6px; border-radius:6px; }
.campop button:hover { background:var(--secondary-background-color); }
.campop button.on { background:#ffe08a; color:#3a2a00; }
.campop .view { background:#000; aspect-ratio:16/9; display:flex; align-items:center; justify-content:center; }
.campop .view > * { width:100%; }
.campop .view img { display:block; width:100%; height:100%; object-fit:contain; }
.campop .event-pic { position:relative; height:100%; display:flex; align-items:center; justify-content:center; }
.campop .event-pic .when { position:absolute; left:8px; bottom:6px; padding:2px 6px; border-radius:4px; font-size:12px;
  background:rgba(0,0,0,.55); color:#fff; }
.campop .event-pic .when:empty { display:none; }
.campop .event-pic.old img { opacity:.6; }
.campop .event-pic .wait { color:#ddd; font-size:13px; }
@keyframes fps-pop { from { transform:translateY(-12px); opacity:0; } to { transform:none; opacity:1; } }
@keyframes fps-blink { to { opacity:.25; } }
@media (prefers-reduced-motion: reduce) { .campop, .campop .dot { animation:none; } }
.toast { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); z-index:5;
  background:var(--primary-text-color); color:var(--primary-background-color); padding:10px 16px;
  border-radius:8px; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,.3); max-width:90%; }
.loading { display:flex; align-items:center; justify-content:center; height:100%; color:var(--secondary-text-color); }
@media (max-width: 760px) {
  aside { position:absolute; right:0; bottom:0; top:auto; width:100%; max-height:45%; border-left:0;
    border-top:1px solid var(--divider-color); z-index:3; box-shadow:0 -2px 8px rgba(0,0,0,.15); }
  .tool { width:44px; font-size:0; }
  header .title { display:none; }
}
`;


class FloorplanStudioPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._doc = null; // what is displayed (working copy while editing)
    this._saved = null; // last document from the server
    this._docVersion = 0;
    this._editing = false;
    this._dirty = false; // local changes not yet sent to the server
    this._saving = null; // promise of the in-flight save
    this._saveError = null;
    this._saveTimer = null;
    this._queuedRemote = null; // update received while our own save was in flight
    this._undo = [];
    this._redo = [];
    this._tool = "select";
    this._selection = null;
    this._view = readPref("view", "2d");
    this._floorId = readPref("floor", null);
    this._dayMode = DAY_MODES[readPref("daynight", "auto")] ? readPref("daynight", "auto") : "auto";
    this._images = new Map(); // image_id -> {url, aspect} | "loading"
    this._wallThickness = 0.15;
    this._onKey = this._onKey.bind(this);
    this._onUpdate = () => this._showUpdateNotice();
    this._onHide = () => {
      if (document.visibilityState === "hidden") this._saveNow();
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    // The panel's own text follows the user's Home Assistant language
    if (setLanguage(hass.language || hass.locale?.language) && !first && this._root) {
      this._docVersion++; // so the 2D and 3D views redraw their text too
      this._refreshAll();
    }
    if (first) this._load();
    // The views skip updates that change nothing on the plan (see planEntities)
    const relevant = this._relevantEntities();
    if (this._plan) {
      this._plan.relevant = relevant;
      this._plan.hass = hass;
    }
    if (this._view3d) {
      this._view3d.relevant = relevant;
      this._view3d.hass = hass;
    }
    // sun.sun moves slowly; only push lighting changes when they're visible
    const sun = this._sunInfo();
    if (this._root && JSON.stringify(sun) !== JSON.stringify(this._lastSun)) {
      this._lastSun = sun;
      this._refreshViews();
      this._renderHeader();
    }
    if (this._menuButton) this._menuButton.hass = hass;
    if (this._editing) this._syncEntityList();
    this._watchCameras();
    // The side panel shows some live data (a vacuum's rooms, a receiver's inputs): redraw it when that changes
    const key = this._inspectorLiveKey();
    if (key !== this._inspectorKey) {
      const was = this._inspectorKey;
      this._inspectorKey = key;
      if (was !== undefined && this._aside && !this._aside.contains(this.shadowRoot.activeElement)) this._renderInspector();
    }
  }

  /** "Automatic (light, Mali-G52)": what Automatic picks on this device, and why. */
  _autoQualityLabel() {
    const auto = autoQuality();
    const profile = auto.name === "low" ? t("light") : t("full");
    const reason = auto.reason === "gpu" ? auto.gpu : auto.reason === "measured" ? t("measured") : t("memory and cores");
    return t("Automatic ({profile}, {reason})", { profile, reason });
  }

  /** Entities the views redraw for (planEntities); worked out again when the plan or the registries change. */
  _relevantEntities() {
    const h = this._hass;
    const key = [this._doc, this._docVersion, h?.entities, h?.devices, h?.areas];
    const cache = this._relevantCache;
    if (cache && cache.key.every((v, i) => v === key[i])) return cache.ids;
    const ids = this._doc ? planEntities(h, this._doc) : null;
    this._relevantCache = { key, ids };
    return ids;
  }

  /** Live data the selected piece's settings depend on (empty for most pieces). */
  _inspectorLiveKey() {
    if (this._selection?.kind !== "furniture" || !this._editing) return "";
    const item = this._findSelected();
    const def = item && catalogItem(item.type);
    if (!item?.entity_id || !(def.robot || def.av)) return "";
    if (def.robot) return `${item.id}|${vacuumRooms(this._hass, item.entity_id).map((r) => `${r.id}:${r.name}`).join(",")}|${currentRoomSensor(this._hass, item.entity_id) || ""}`;
    const ids = [item.entity_id, item.connected_to].filter(Boolean);
    return `${item.id}|${ids.map((id) => (this._hass.states[id]?.attributes?.source_list || []).join(",")).join("|")}`;
  }

  get hass() {
    return this._hass;
  }

  set narrow(v) {
    this._narrow = v;
    if (this._menuButton) this._menuButton.narrow = v;
  }

  set panel(_v) {}
  set route(_v) {}

  connectedCallback() {
    // Properties set before the element was upgraded shadow our setters
    for (const prop of ["narrow", "hass"]) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const v = this[prop];
        delete this[prop];
        this[prop] = v;
      }
    }
    window.addEventListener("keydown", this._onKey);
    window.addEventListener("fps-update-available", this._onUpdate);
    document.addEventListener("visibilitychange", this._onHide);
    window.addEventListener("pagehide", this._onHide);
    if (this._hass && !this._unsub) this._subscribe();
  }

  disconnectedCallback() {
    // Navigating to another HA panel: send pending changes right away
    this._saveNow();
    window.removeEventListener("keydown", this._onKey);
    window.removeEventListener("fps-update-available", this._onUpdate);
    document.removeEventListener("visibilitychange", this._onHide);
    window.removeEventListener("pagehide", this._onHide);
    this._unsub?.then((u) => u()).catch(() => {});
    this._unsub = null;
  }

  // ---------- data ----------

  async _load() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="loading">${t("Loading floorplan…")}</div>`;
    try {
      const res = await this._hass.callWS({ type: `${DOMAIN}/get` });
      this._setSaved(res.data);
    } catch (err) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="loading">${t("Failed to load floorplan: {error}", { error: escapeHtml(err.message || err) })}</div>`;
      return;
    }
    this._build();
    this._subscribe();
  }

  _subscribe() {
    if (!this._hass?.connection || this._unsub) return;
    this._unsub = this._hass.connection.subscribeMessage(
      (msg) => this._onRemote(msg),
      { type: `${DOMAIN}/subscribe` }
    );
    this._unsub.catch(() => (this._unsub = null));
  }

  _onRemote(msg) {
    // The echo of our own save arrives before its result; hold updates until
    // the result tells us which revision was ours.
    if (this._saving) {
      if (!this._queuedRemote || msg.revision > this._queuedRemote.revision) this._queuedRemote = msg;
      return;
    }
    this._applyRemote(msg.data);
  }

  /** A save from another browser or device. */
  _applyRemote(data) {
    if (!this._editing) {
      this._setSaved(data);
      if (this._root) this._refreshAll();
      return;
    }
    this._saved = data;
    if (this._dirty) {
      // Our pending auto-save will be written over theirs
      if (!this._warnedConcurrent || Date.now() - this._warnedConcurrent > 30000) {
        this._warnedConcurrent = Date.now();
        this._toast(t("Someone else is editing this floorplan too. The last change saved wins."));
      }
      return;
    }
    // Nothing pending here: follow their version, keeping our place
    tidyAvWiring(this._saved);
    this._doc = normalizeDoc(clone(data));
    tidyAvWiring(this._doc);
    this._docVersion++;
    if (!this._floor) this._floorId = this._doc.floors[0]?.id;
    if (this._selection && !this._findSelected()) this._selection = null;
    this._loadImages();
    this._refreshAll();
  }

  _setSaved(data) {
    this._saved = normalizeDoc(data);
    tidyAvWiring(this._saved); // older wiring, saved with the next change
    this._doc = clone(data);
    tidyAvWiring(this._doc);
    this._docVersion++;
    if (!this._doc.floors.find((f) => f.id === this._floorId)) {
      const sorted = [...this._doc.floors].sort((a, b) => a.level - b.level);
      this._floorId = (sorted.find((f) => f.level === 0) || sorted[0])?.id || null;
    }
    this._loadImages();
  }

  get _floor() {
    return this._doc?.floors.find((f) => f.id === this._floorId);
  }

  // ---------- auto-save ----------

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveNow(), AUTOSAVE_DELAY);
  }

  /**
   * Send pending changes now. Saves never overlap: a change made while a save
   * is in flight is sent once that save has finished. Resolves to true when
   * everything is saved.
   */
  async _saveNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    while (this._saving) await this._saving;
    if (!this._dirty || !this._editing || !this._hass) return !this._saveError;

    // Markers without an entity are placeholders until one is picked; they
    // stay in the editor but are not stored.
    const doc = clone(this._doc);
    doc.floors.forEach((f) => (f.markers = f.markers.filter((m) => m.entity_id)));
    // Very thin pieces (a Hue Play bar, a light strip) are rounded up to the smallest
    // size the server stores: 5 cm across, 1 cm high
    doc.floors.forEach((f) => (f.furniture || []).forEach((p) => {
      p.w = Math.max(MIN_SIZE, p.w);
      p.d = Math.max(MIN_SIZE, p.d);
      p.h = Math.max(MIN_HEIGHT, p.h);
    }));
    this._dirty = false;
    this._saveError = null;

    this._saving = this._hass
      .callWS({ type: `${DOMAIN}/save`, data: doc })
      .then((res) => {
        this._saved = res.data;
        const queued = this._queuedRemote;
        this._queuedRemote = null;
        this._saving = null;
        // Anything newer than our own revision came from someone else
        if (queued && queued.revision > res.revision) this._applyRemote(queued.data);
        return true;
      })
      .catch((err) => {
        this._dirty = true;
        this._saveError = err.message || String(err);
        this._queuedRemote = null;
        this._saving = null;
        return false;
      })
      .finally(() => this._renderHeader());
    this._renderHeader();
    return this._saving;
  }

  /** Wait until every change, including ones made during a save, is stored. */
  async _saveAll() {
    let ok = await this._saveNow();
    while (ok && (this._dirty || this._saving)) ok = await this._saveNow();
    return ok && !this._dirty;
  }

  // ---------- blueprint images ----------

  async _fetch(path, init) {
    if (this._hass.fetchWithAuth) return this._hass.fetchWithAuth(path, init);
    const token = this._hass.auth?.data?.access_token;
    return fetch(path, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` } });
  }

  _loadImages() {
    for (const f of this._doc.floors) {
      const id = f.blueprint?.image_id;
      if (!id || this._images.has(id)) continue;
      this._images.set(id, "loading");
      this._fetch(`${IMAGE_URL}/${id}`)
        .then((r) => {
          if (!r.ok) throw new Error(r.status);
          return r.blob();
        })
        .then((blob) => this._registerImage(id, blob))
        .catch(() => this._images.delete(id));
    }
  }

  /** Decode an image file; rejects when this browser can't show it (e.g. AVIF on an old device). */
  _decodeImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ url, aspect: img.naturalHeight / img.naturalWidth });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(t("this browser can't display that image")));
      };
      img.src = url;
    });
  }

  async _registerImage(id, blob) {
    this._images.set(id, await this._decodeImage(blob));
    this._refreshViews();
  }

  async _uploadBlueprint(file) {
    // Check it shows here before storing it
    try {
      URL.revokeObjectURL((await this._decodeImage(file)).url);
    } catch (err) {
      this._toast(t("Can't use this image: {error}", { error: err.message }));
      return;
    }
    const form = new FormData();
    form.append("file", file);
    this._toast(t("Uploading…"));
    try {
      const r = await this._fetch(IMAGE_URL, { method: "POST", body: form });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || r.status);
      await this._registerImage(body.image_id, file);
      this._change(() => {
        this._floor.blueprint = { image_id: body.image_id, x: 0, y: 0, width: 15, opacity: 0.5, show_in_view: false };
      });
      this._plan.fit();
      this._setTool("calibrate");
      this._toast(t("Blueprint added. Now click two points with a known distance to set the scale."));
    } catch (err) {
      this._toast(t("Upload failed: {error}", { error: err.message || err }));
    }
  }

  _calibrate({ a, b }) {
    const bp = this._floor?.blueprint;
    this._setTool("select");
    if (!bp) {
      this._toast(t("Upload a blueprint first to calibrate its scale."));
      return;
    }
    const measured = dist(a, b);
    const answer = window.prompt(
      t("Measured {m} m on the blueprint. What is the real distance in metres?", { m: measured.toFixed(2) }),
      measured.toFixed(2)
    );
    const real = parseFloat(String(answer).replace(",", "."));
    if (!real || real <= 0) return;
    const k = real / measured;
    this._change(() => {
      // Scale around point a so it stays where it is
      bp.width = round(bp.width * k);
      bp.x = round(a[0] + (bp.x - a[0]) * k);
      bp.y = round(a[1] + (bp.y - a[1]) * k);
    });
    this._plan.fit();
    this._toast(t("Blueprint scaled ×{k}", { k: k.toFixed(3) }));
  }

  // ---------- edit state ----------

  _snapshot() {
    this._undo.push(JSON.stringify(this._doc));
    if (this._undo.length > MAX_UNDO) this._undo.shift();
    this._redo = [];
  }

  /** Apply a mutation to the working document with undo support. */
  _change(fn, { snapshot = true, inspector = true } = {}) {
    if (snapshot) this._snapshot();
    fn();
    this._afterChange(inspector);
  }

  _afterChange(inspector = true) {
    this._dirty = true;
    this._scheduleSave();
    this._docVersion++;
    this._refreshViews();
    this._renderHeader();
    if (inspector) this._renderInspector();
  }

  _restore(json) {
    this._doc = JSON.parse(json);
    if (!this._floor) this._floorId = this._doc.floors[0]?.id;
    if (this._selection && !this._findSelected()) this._selection = null;
    this._afterChange();
  }

  _undoAction() {
    if (!this._undo.length) return;
    this._redo.push(JSON.stringify(this._doc));
    this._restore(this._undo.pop());
  }

  _redoAction() {
    if (!this._redo.length) return;
    this._undo.push(JSON.stringify(this._doc));
    this._restore(this._redo.pop());
  }

  _startEditing() {
    this._editing = true;
    this._doc = clone(this._saved);
    this._docVersion++;
    this._dirty = false;
    this._saveError = null;
    this._undo = [];
    this._redo = [];
    this._selection = null;
    this._tool = "select";
    if (this._view !== "2d") this._view = "2d";
    this._syncEntityList(true);
    this._refreshAll();
  }

  async _finishEditing() {
    if (!(await this._saveAll())) {
      this._toast(t("Could not save: {error}. Your changes are kept; try again.", { error: this._saveError || t("unknown error") }));
      return;
    }
    const placeholders = this._doc.floors.reduce((n, f) => n + f.markers.filter((m) => !m.entity_id).length, 0);
    if (placeholders) {
      this._toast(placeholders === 1 ? t("1 marker without an entity was removed.")
        : t("{n} markers without an entity were removed.", { n: placeholders }));
    }
    this._setSaved(this._saved);
    this._editing = false;
    this._dirty = false;
    this._selection = null;
    this._plan?.cancelDraft();
    this._refreshAll();
  }

  _setTool(tool) {
    this._tool = tool;
    this._keepCatalog = null; // see _placed
    // These tools show their palette in the side panel, which a selected
    // item's details would otherwise replace
    if (tool === "furniture" || tool === "marker" || tool === "move-floor") this._selection = null;
    this._plan?.cancelDraft();
    this._renderTools();
    this._renderInspector();
    this._refreshViews();
  }

  _findSelected() {
    const s = this._selection;
    const f = this._floor;
    if (!s || !f) return null;
    const list = { wall: f.walls, room: f.rooms, opening: f.openings, marker: f.markers, furniture: f.furniture, roof: f.roofs || [] }[s.kind];
    return list?.find((x) => x.id === s.id) || null;
  }

  _duplicateSelected() {
    if (this._selection?.kind !== "furniture") return;
    const copy = duplicateFurniture(this._findSelected());
    this._change(() => {
      this._floor.furniture.push(copy);
      this._selection = { kind: "furniture", id: copy.id };
    });
  }

  _deleteSelected() {
    const s = this._selection;
    const f = this._floor;
    if (!s || !f) return;
    this._change(() => {
      if (s.kind === "wall") {
        f.walls = f.walls.filter((w) => w.id !== s.id);
        f.openings = f.openings.filter((o) => o.wall_id !== s.id);
      } else {
        const key = { room: "rooms", opening: "openings", marker: "markers", furniture: "furniture", roof: "roofs" }[s.kind];
        f[key] = f[key].filter((x) => x.id !== s.id);
      }
      this._selection = null;
    });
  }

  _addFloor() {
    const levels = this._doc.floors.map((f) => f.level);
    const level = levels.length ? Math.max(...levels) + 1 : 0;
    const floor = newFloor(level, level === 0 ? t("Ground floor") : t("Floor {n}", { n: level }));
    this._change(() => {
      this._doc.floors.push(floor);
      this._floorId = floor.id;
      this._selection = null;
    });
    this._renderHeader();
  }

  /** A LiDAR scan (RoomPlan OBJ) becomes a new floor on top of the others. */
  async _importScan(file) {
    this._toast(t("Reading the scan…"));
    let result;
    try {
      const levels = this._doc.floors.map((f) => f.level);
      const level = levels.length ? Math.max(...levels) + 1 : 0;
      result = scanToFloor(parseObj(await file.text()), { name: file.name.replace(/\.obj$/i, "") || t("Scan"), level });
    } catch (err) {
      this._toast(t("Import failed: {error}", { error: err.message || err }));
      return;
    }
    const { floor, counts } = result;
    this._change(() => {
      this._doc.floors.push(floor);
      this._floorId = floor.id;
      this._selection = null;
    });
    this._renderHeader();
    this._plan.fit();
    const n = (k, one, many) => (counts[k] === 1 ? t(one) : t(many, { n: counts[k] }));
    this._toast(t("Imported {walls}, {rooms}, {doors}, {windows} and {furniture}", {
      walls: n("walls", "1 wall", "{n} walls"), rooms: n("rooms", "1 room", "{n} rooms"), doors: n("doors", "1 door", "{n} doors"),
      windows: n("windows", "1 window", "{n} windows"), furniture: n("furniture", "1 object", "{n} objects") }));
  }

  _deleteFloor() {
    if (this._doc.floors.length <= 1) return;
    if (!window.confirm(t("Delete \"{name}\" and everything on it?", { name: this._floor.name }))) return;
    this._change(() => {
      this._doc.floors = this._doc.floors.filter((f) => f.id !== this._floorId);
      this._floorId = this._doc.floors[0].id;
      this._selection = null;
    });
  }

  // ---------- keyboard ----------

  _onKey(e) {
    if (!this._editing || !this.isConnected) return;
    const target = e.composedPath()[0];
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this._redoAction();
      else this._undoAction();
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      this._duplicateSelected();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this._redoAction();
      return;
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault(); // saving is automatic; just don't open the browser's save dialog
      this._saveNow();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === "Escape" || e.key === "Enter") {
      if (this._plan?.drafting) this._plan.finishDraft();
      else if (e.key === "Escape" && this._selection) this._select(null);
      else if (e.key === "Escape" && this._tool !== "select") this._setTool("select");
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this._selection) {
      e.preventDefault();
      this._deleteSelected();
      return;
    }
    const tool = TOOLS.find((x) => x.key === e.key.toLowerCase());
    if (tool && this._view === "2d") this._setTool(tool.id);
  }

  _select(sel) {
    this._selection = sel;
    this._renderInspector();
    this._refreshViews();
  }

  // ---------- DOM ----------

  _build() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <div class="app">
        <header></header>
        <div class="body">
          <nav class="tools"></nav>
          <div class="stage"></div>
          <aside></aside>
          <datalist id="entities"></datalist>
        </div>
      </div>`;
    this._root = this.shadowRoot.querySelector(".app");
    this._header = this.shadowRoot.querySelector("header");
    this._tools = this.shadowRoot.querySelector(".tools");
    this._stage = this.shadowRoot.querySelector(".stage");
    this._aside = this.shadowRoot.querySelector("aside");
    this._body = this.shadowRoot.querySelector(".body");

    if (customElements.get("ha-menu-button")) {
      this._menuButton = document.createElement("ha-menu-button");
      this._menuButton.hass = this._hass;
      this._menuButton.narrow = this._narrow;
    }

    this._plan = document.createElement("fps-plan-2d");
    this._plan.hass = this._hass;
    this._plan.addEventListener("fps-before-change", () => this._snapshot());
    this._plan.addEventListener("fps-changed", () => {
      const focusInAside = this._aside.contains(this.shadowRoot.activeElement);
      this._afterChange(!focusInAside);
    });
    this._plan.addEventListener("fps-select", (e) => {
      // Picking anything but the piece just placed (or empty space) ends the catalog view
      if (this._keepCatalog && (e.detail?.kind !== "furniture" || e.detail.id !== this._keepCatalog)) this._keepCatalog = null;
      this._selection = e.detail;
      this._renderInspector();
    });
    this._plan.addEventListener("fps-calibrate", (e) => this._calibrate(e.detail));
    this._plan.addEventListener("fps-item-drag", (e) => this._onItemDrag(e.detail));
    this._plan.addEventListener("fps-item-drop", (e) => this._onItemDrop(e.detail));
    this._plan.addEventListener("fps-north", (e) => {
      // Undo snapshot comes from the plan's fps-before-change at drag start
      this._doc.north = normalizeAngle(e.detail.angle);
      this._afterChange(!!e.detail.final);
    });

    this._header.addEventListener("click", (e) => this._onHeaderClick(e));
    this._tools.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tool]");
      if (b && !b.disabled) this._setTool(b.dataset.tool);
    });
    this._aside.addEventListener("change", (e) => this._onField(e));
    this._aside.addEventListener("toggle", (e) => {
      const cat = e.target.dataset?.cat;
      if (!cat || (this._furnitureQuery || "").trim()) return; // unfolded by a search: don't remember
      const open = openCategories();
      if (e.target.open) open.add(cat);
      else open.delete(cat);
      writePref("openCategories", JSON.stringify([...open]));
    }, true);
    this._aside.addEventListener("input", (e) => {
      if (e.target.type !== "range") return;
      const out = this._aside.querySelector(`output[data-out="${e.target.dataset.field}"]`);
      if (out) out.textContent = `${e.target.value}${e.target.dataset.unit ?? "°"}`;
      this._onField(e, true);
    });
    this._aside.addEventListener("click", (e) => this._onAsideClick(e));
    this._aside.addEventListener("pointerdown", (e) => this._onPaletteDown(e));
    this._aside.addEventListener("input", (e) => {
      if (e.target.dataset.furnitureSearch === undefined) return;
      this._furnitureQuery = e.target.value;
      const pos = e.target.selectionStart;
      this._renderInspector();
      const input = this._aside.querySelector("[data-furniture-search]");
      input?.focus();
      input?.setSelectionRange(pos, pos);
    });
    this._aside.addEventListener("input", (e) => {
      if (e.target.dataset.entitySearch === undefined) return;
      this._entityQuery = e.target.value;
      this._fillEntityList(this._aside.querySelector(".ents[data-list=all]"), this._searchEntities());
    });

    this._refreshAll();
  }

  _refreshAll() {
    if (!this._root) return;
    this._renderHeader();
    this._renderTools();
    this._renderInspector();
    this._mountView();
    this._refreshViews();
  }

  _mountView() {
    const want = this._view === "3d" ? "3d" : "2d";
    if (want === "3d" && !this._view3d) {
      this._view3d = document.createElement("fps-view-3d");
      this._view3d.hass = this._hass;
      // The 3D view measured this device, or found it too slow in use: it switched profile
      this._view3d.addEventListener("fps-quality", (e) => {
        this._plan?.applyQuality();
        this._renderInspector();
        if (e.detail?.name === "low") this._toast(t("Switched to light quality: this device was too slow for full 3D"));
      });
    }
    const el = want === "3d" ? this._view3d : this._plan;
    if (this._stage.firstElementChild !== el) this._stage.replaceChildren(el);
  }

  _refreshViews() {
    if (!this._root) return;
    const blueprintUrls = {};
    for (const [id, v] of this._images) if (v !== "loading") blueprintUrls[id] = v;
    // While editing: daylight and dimmed lights, so the plan itself stays easy to see
    const sun = this._editing ? { ...this._sunInfo(), daylight: 1, azimuth: 170, elevation: 40 } : this._sunInfo();
    if (this._view === "3d") {
      this._view3d?.update({ doc: this._doc, docVersion: this._docVersion, floorId: this._floorId, blueprintUrls,
        north: this._doc.north || 0, sun, dimLights: this._editing });
      return;
    }
    const floor = this._floor;
    const img = floor?.blueprint && blueprintUrls[floor.blueprint.image_id];
    this._plan.update({
      floor,
      editing: this._editing,
      tool: this._tool,
      selection: this._selection,
      blueprintUrl: img?.url || null,
      blueprintAspect: img?.aspect || null,
      wallThickness: this._wallThickness,
      north: this._doc.north || 0,
      daylight: sun.daylight,
      dimLights: this._editing,
      underlay: this._editing ? this._outlineFloor() : null,
    });
  }

  /**
   * Daylight 0 (night) .. 1 (day) plus the sun's position (degrees). Auto uses
   * sun.sun with a soft dusk/dawn transition; without it, the local clock.
   */
  _sunInfo() {
    const sun = this._hass?.states["sun.sun"];
    const el = Number(sun?.attributes?.elevation);
    const az = Number(sun?.attributes?.azimuth);
    const known = Number.isFinite(el) && Number.isFinite(az);
    let daylight;
    if (this._dayMode === "day") daylight = 1;
    else if (this._dayMode === "night") daylight = 0;
    else if (known) daylight = smoothstep(-6, 3, el);
    else daylight = new Date().getHours() >= 7 && new Date().getHours() < 19 ? 1 : 0;
    // Forced day while the real sun is low or unknown: use a pleasant midday sun
    const realSun = known && !(this._dayMode === "day" && el < 12);
    return {
      daylight: Math.round(daylight * 50) / 50,
      azimuth: realSun ? Math.round(az) : 170,
      elevation: realSun ? Math.round(el) : 40,
    };
  }

  /**
   * The floor shown as a faint outline while editing: the one below, or the
   * one above for the lowest floor. Off when the user unticked it.
   */
  _outlineFloor() {
    const cur = this._floor;
    if (!cur || readPref("underlay", "1") !== "1") return null;
    const others = this._doc.floors.filter((f) => f.id !== cur.id);
    const below = others.filter((f) => f.level < cur.level).sort((a, b) => b.level - a.level)[0];
    return below || others.filter((f) => f.level >= cur.level).sort((a, b) => a.level - b.level)[0] || null;
  }

  _renderHeader() {
    if (!this._header) return;
    const floors = [...this._doc.floors].sort((a, b) => b.level - a.level);
    const icon = (i) => `<ha-icon icon="${i}"></ha-icon>`;
    let status;
    if (this._saveError) {
      status = `<span class="save-status error" title="${escapeHtml(this._saveError)}">${icon("mdi:alert-circle-outline")}${t("Save failed")}</span>
        <button class="hbtn" data-act="retry">${t("Retry")}</button>`;
    } else if (this._dirty || this._saving) {
      status = `<span class="save-status">${icon("mdi:cloud-upload-outline")}${t("Saving…")}</span>`;
    } else {
      status = `<span class="save-status">${icon("mdi:cloud-check-outline")}${t("All changes saved")}</span>`;
    }
    const editBtns = this._editing
      ? `${status}
         <button class="hbtn" data-act="undo" title="${t("Undo (Ctrl+Z)")}" ${this._undo.length ? "" : "disabled"}>${icon("mdi:undo")}</button>
         <button class="hbtn" data-act="redo" title="${t("Redo (Ctrl+Shift+Z)")}" ${this._redo.length ? "" : "disabled"}>${icon("mdi:redo")}</button>
         <button class="hbtn primary" data-act="done">${t("Done")}</button>`
      : `<button class="hbtn primary" data-act="edit">${icon("mdi:pencil")} ${t("Edit")}</button>`;
    this._header.innerHTML = `
      <span class="menu"></span>
      <div class="title">${t("Floorplan")}</div>
      <div class="tabs">
        ${floors.map((f) => `<button class="tab ${f.id === this._floorId ? "on" : ""}" data-floor="${f.id}">${escapeHtml(f.name)}</button>`).join("")}
        ${this._editing ? `<button class="tab" data-act="add-floor" title="${t("Add floor")}">+</button>` : ""}
      </div>
      <div class="spacer"></div>
      <button class="hbtn" data-act="daynight" title="${this._dayMode === "auto"
        ? t(this._sunInfo().daylight > 0.5 ? "Day/night: {mode} (day now). Click to change." : "Day/night: {mode} (night now). Click to change.", { mode: t(DAY_MODES.auto.label) })
        : t("Day/night: {mode}. Click to change.", { mode: t(DAY_MODES[this._dayMode].label) })}">
        <ha-icon icon="${this._dayMode === "auto" ? ("mdi:sun-clock") : DAY_MODES[this._dayMode].icon}"></ha-icon>
      </button>
      <div class="seg">
        <button data-view="2d" class="${this._view === "2d" ? "on" : ""}">2D</button>
        <button data-view="3d" class="${this._view === "3d" ? "on" : ""}">3D</button>
      </div>
      ${editBtns}`;
    if (this._menuButton) this._header.querySelector(".menu").appendChild(this._menuButton);
  }

  _onHeaderClick(e) {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.floor) {
      this._floorId = b.dataset.floor;
      writePref("floor", this._floorId);
      this._selection = null;
      this._plan.cancelDraft();
      this._refreshAll();
      return;
    }
    if (b.dataset.act === "daynight") {
      const order = ["auto", "day", "night"];
      this._dayMode = order[(order.indexOf(this._dayMode) + 1) % order.length];
      writePref("daynight", this._dayMode);
      this._toast(t("Day/night: {mode}", { mode: t(DAY_MODES[this._dayMode].label) }));
      this._refreshViews();
      this._renderHeader();
      return;
    }
    if (b.dataset.view) {
      this._view = b.dataset.view;
      writePref("view", this._view);
      this._plan.cancelDraft();
      this._refreshAll();
      return;
    }
    switch (b.dataset.act) {
      case "edit":
        this._startEditing();
        break;
      case "done":
        this._finishEditing();
        break;
      case "retry":
        this._saveNow();
        break;
      case "undo":
        this._undoAction();
        break;
      case "redo":
        this._redoAction();
        break;
      case "add-floor":
        this._addFloor();
        break;
      default:
    }
  }

  _renderTools() {
    const show = this._editing;
    this._tools.hidden = !show;
    if (!show) return;
    const is3d = this._view === "3d";
    this._tools.innerHTML = TOOLS.filter((x) => !x.hidden).map((x) => `
      <button class="tool ${x.id === this._tool ? "on" : ""}" data-tool="${x.id}"
        title="${t(x.label)} (${x.key.toUpperCase()})" ${is3d ? "disabled" : ""}>
        <ha-icon icon="${x.icon}"></ha-icon>${t(x.label)}
      </button>`).join("");
  }

  _syncEntityList(force = false) {
    const list = this.shadowRoot.getElementById("entities");
    if (!list || !this._hass) return;
    const ids = Object.keys(this._hass.states);
    if (!force && list.childElementCount === ids.length) return;
    list.innerHTML = ids
      .sort()
      .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(this._hass.states[id].attributes.friendly_name || "")}</option>`)
      .join("");
  }

  // ---------- inspector ----------

  _renderInspector() {
    if (!this._aside) return;
    this._aside.hidden = !this._editing;
    if (!this._editing) return;
    const floor = this._floor;
    // Just placed a piece: the catalog stays, not the piece's details (see _placed)
    const catalog = this._tool === "furniture" || (!!this._keepCatalog && this._selection?.id === this._keepCatalog);
    const placed = catalog && this._tool !== "furniture" ? this._findSelected() : null;
    const item = catalog ? null : this._findSelected();
    const tool = TOOLS.find((x) => x.id === this._tool);
    const num = (field, label, value, step = 0.05, min = 0) => `
      <div class="field"><label>${label}</label>
        <input type="number" data-field="${field}" value="${value ?? ""}" step="${step}" min="${min}"></div>`;
    const entity = (field, label, value, hint = "", placeholder = "light.living_room") => `
      <div class="field"><label>${label}</label>
        <input list="entities" data-field="${field}" value="${escapeHtml(value || "")}" placeholder="${t("e.g. {example}", { example: placeholder })}" autocomplete="off">
        ${hint ? `<span class="muted">${hint}</span>` : ""}
        ${value && !this._hass.states[value] ? `<span class="warn">${t("Entity not found")}</span>` : ""}</div>`;
    const del = `<div class="actions"><button class="btn danger" data-act="delete"><ha-icon icon="mdi:delete"></ha-icon>${t("Delete")}</button></div>`;
    let html = "";

    if (this._view === "3d") {
      html += `<div class="help">${t("You're looking at your changes in 3D. Switch to 2D to keep drawing; settings below still work here.")}</div>`;
    } else if (tool) {
      html += `<div class="help"><b>${t(tool.label)}:</b> ${t(tool.help)}</div>`;
    }

    if (item && this._selection.kind === "wall") {
      html += `<h3><ha-icon icon="mdi:wall"></ha-icon>${t("Wall")}</h3>
        <div class="row">${num("thickness", t("Thickness (m)"), item.thickness, 0.01, 0.01)}
        ${num("length", t("Length (m)"), round(dist(item.a, item.b), 2), 0.05, 0.05)}</div>${del}`;
    } else if (item && this._selection.kind === "roof") {
      const finish = roofFinish(item);
      const sloped = item.type !== "flat";
      html += `<h3><ha-icon icon="mdi:home-roof"></ha-icon>${t("Roof")}</h3>
        <div class="field"><label>${t("Name (optional)")}</label><input data-field="name" value="${escapeHtml(item.name || "")}"></div>
        <div class="field"><label>${t("Type")}</label><select data-field="type">
          ${Object.entries(ROOF_TYPES).map(([k, label]) => `<option value="${k}" ${(item.type || "gable") === k ? "selected" : ""}>${t(label)}</option>`).join("")}
        </select></div>
        ${sloped ? `<div class="field"><label>${t("Pitch")} <output data-out="pitch">${Math.round(item.pitch ?? 35)}°</output></label>
          <input type="range" min="5" max="60" step="1" data-field="pitch" value="${Math.round(item.pitch ?? 35)}"></div>` : ""}
        <div class="row">${num("overhang", t("Overhang (m)"), item.overhang ?? 0.3, 0.05, 0)}
          ${["gable", "shed"].includes(item.type || "gable") ? `<div class="field"><label>&nbsp;</label>
            <button class="btn" data-act="turn-ridge" title="${t("Run the ridge the other way")}"><ha-icon icon="mdi:rotate-right"></ha-icon>${t("Turn ridge")}</button></div>` : ""}</div>
        ${item.type === "shed" ? `<div class="actions"><button class="btn" data-act="flip-roof" title="${t("Put the high side on the other edge")}">
          <ha-icon icon="mdi:swap-vertical"></ha-icon>${t("Flip slope")}</button></div>` : ""}
        <div class="field"><label>${t("Covering")}</label><select data-field="material">
          ${Object.entries(ROOF_MATERIALS).map(([k, d]) => `<option value="${k}" ${finish.material === k ? "selected" : ""}>${t(d.label)}</option>`).join("")}
        </select></div>
        <div class="field"><label>${t("Colour")}</label><div class="row">
          <input type="color" data-field="color" value="${escapeHtml(finish.color)}">
          ${item.color ? `<button class="btn" data-act="reset-color" title="${t("Back to the covering's colour")}">${t("Reset")}</button>` : ""}</div></div>
        <p class="muted">${t("Rests on this floor's walls.")} ${sloped ? t("Ridge {h} m above the wall tops.", { h: roofHeight(item).toFixed(2) }) : ""}
          ${t("Hide roofs in 3D with the “Roofs” button to look inside.")}</p>
        ${del}`;
    } else if (item && this._selection.kind === "room") {
      html += isOutdoor(item) ? `<h3><ha-icon icon="mdi:grass"></ha-icon>${t("Outdoor area")}</h3>` : `<h3><ha-icon icon="mdi:vector-polygon"></ha-icon>${t("Room")}</h3>`;
      html += `
        <div class="field"><label>${t("Name")}</label><input data-field="name" value="${escapeHtml(item.name)}"></div>
        <div class="field"><label>${t("Colour")}</label><input type="color" data-field="color" value="${escapeHtml(item.color)}"></div>
        ${this._areaField(item)}
        ${entity("entity_id", t("Highlight entity"), item.entity_id, item.area_id
          ? t("Optional. Without one, the room lights up when any light in the area is on.")
          : t("Room lights up when this is on (e.g. a light or motion sensor). Tap the room to open it."))}
        ${entity("sensor_entity_id", t("Label sensor"), item.sensor_entity_id, item.area_id
          ? t("Optional. Defaults to the area's temperature sensor.")
          : t("Value shown under the room name (e.g. temperature)."), "sensor.living_room_temperature")}
        ${this._finishFields(item)}
        ${del}
        ${this._areaEntitySection(item)}`;
    } else if (item && this._selection.kind === "opening") {
      html += `<h3><ha-icon icon="${item.type === "door" ? "mdi:door" : "mdi:window-closed-variant"}"></ha-icon>${item.type === "door" ? t("Door") : t("Window")}</h3>
        <div class="field"><label>${t("Type")}</label><select data-field="type">
          <option value="door" ${item.type === "door" ? "selected" : ""}>${t("Door")}</option>
          <option value="window" ${item.type === "window" ? "selected" : ""}>${t("Window")}</option></select></div>
        <div class="row">${num("width", t("Width (m)"), item.width, 0.05, 0.1)}${num("height", t("Height (m)"), item.height, 0.05, 0.1)}</div>
        ${num("sill", t("Sill height (m)"), item.sill, 0.05, 0)}
        ${item.type === "door" ? `<div class="field"><label>${t("Style")}</label><select data-field="style">
          ${[["panel", "Panelled"], ["half_glass", "Half glass, 4 panes"], ["half_glass_single", "Half glass, one pane"], ["glass", "Full glass"], ["sliding_double", "Double sliding, glass"]]
            .map(([v, label]) => `<option value="${v}" ${(item.style || "panel") === v ? "selected" : ""}>${t(label)}</option>`).join("")}
        </select></div>` : ""}
        ${item.type === "door" || item.type === "window" ? `<div class="actions" style="margin:0 0 12px">
          <button class="btn" data-act="flip-hinge" title="${t("Move the hinge to the other side of the opening")}"><ha-icon icon="mdi:swap-horizontal"></ha-icon>${t("Flip hinge")}</button>
          <button class="btn" data-act="flip-swing" title="${t("Swing into the room on the other side of the wall")}"><ha-icon icon="mdi:swap-vertical"></ha-icon>${t("Flip opening")}</button>
        </div>` : ""}
        ${entity("entity_id", t("Open/closed sensor"), item.entity_id, t("Optional. Shows the door/window as open when this entity is on/open."), "binary_sensor.front_door")}
        ${del}`;
    } else if (item && this._selection.kind === "marker") {
      html += `<h3><ha-icon icon="mdi:map-marker"></ha-icon>${t("Entity marker")}</h3>
        ${entity("entity_id", t("Entity"), item.entity_id)}
        ${!item.entity_id ? `<div class="warn" style="margin:-4px 0 10px">${t("Pick an entity, or this marker will be dropped when saving.")}</div>` : ""}
        <div class="field"><label>${t("Icon (optional)")}</label><input data-field="icon" value="${escapeHtml(item.icon || "")}" placeholder="mdi:lightbulb"></div>
        <div class="field"><label>${t("Tap action")}</label><select data-field="tap_action">
          ${tapOptions(this._hass, item, item.tap_action)}
        </select></div>
        ${doubleTapField(item, this._hass)}
        <label class="check"><input type="checkbox" data-field="show_state" ${item.show_state ? "checked" : ""}> ${t("Show state below icon")}</label>
        ${del}`;
    } else if (item && this._selection.kind === "furniture") {
      const def = catalogItem(item.type);
      const color = item.color || def.color;
      html += `<h3><ha-icon icon="${def.icon}"></ha-icon>${escapeHtml(item.name || t(def.label))}</h3>
        <div class="field"><label>${t("Name (optional)")}</label><input data-field="name" value="${escapeHtml(item.name || "")}" placeholder="${escapeHtml(t(def.label))}"></div>
        <div class="field"><label>${t("Type")}</label><select data-field="type">
          ${sortedCategories(true).filter((c) => Object.values(CATALOG).some((d) => d.cat === c)).map((c) => `<optgroup label="${escapeHtml(SUBCATEGORIES[c] ? `${t(SUBCATEGORIES[c])} › ${t(c)}` : t(c))}">${Object.entries(CATALOG).filter(([, d]) => d.cat === c)
            .sort(([, a], [, b]) => t(a.label).localeCompare(t(b.label)))
            .map(([k, d]) => `<option value="${k}" ${k === item.type ? "selected" : ""}>${escapeHtml(t(d.label))}</option>`).join("")}</optgroup>`).join("")}
        </select></div>
        <div class="row">${num("w", t("Width (m)"), item.w, 0.05, 0.05)}${num("d", t("Depth (m)"), item.d, 0.05, 0.05)}${def.hole ? "" : num("h", def.ceiling ? t("Drop (m)") : t("Height (m)"), item.h, 0.05, 0.01)}</div>
        ${def.hole
          ? `<p class="muted">${t("An opening in this floor, e.g. for the stairs or a vide. The 3D view shows the floor below through it.")}</p>`
          : def.ceiling
          ? `<p class="muted">${t("Hangs from the ceiling of this floor. Drop is how far it hangs down.")}</p>`
          : num("z", t("Raised (m) — height of the surface it stands on"), item.z || 0, 0.05, 0)}
        <div class="field"><label>${t("Rotation")} <output data-out="rotation">${Math.round(normalizeAngle(item.rotation || 0))}°</output></label>
          <div class="row" style="align-items:center"><input type="range" min="0" max="359" step="1" data-field="rotation" value="${Math.round(normalizeAngle(item.rotation || 0))}" style="flex:1">
          <button class="btn" data-act="rotate90" title="${t("Turn 90° clockwise")}"><ha-icon icon="mdi:rotate-right"></ha-icon>90°</button></div></div>
        ${def.hole ? "" : `<div class="field"><label>${t("Colour")}</label>
          <div class="row"><input type="color" data-field="color" value="${/^#[0-9a-f]{6}$/i.test(color) ? color : "#b0b4ba"}">
          ${item.color ? `<button class="btn" data-act="reset-color" title="${t("Back to the default colour")}">${t("Reset")}</button>` : ""}</div></div>
        ${def.tilt ? (() => {
          const tilt = Math.round(item.tilt || 0);
          return `<div class="field"><label>${t("Tilt")} <output data-out="tilt">${tilt}°</output></label>
            <input type="range" min="0" max="85" step="1" data-field="tilt" value="${tilt}">
            <span class="muted">${t("0° shines straight down. Rotation turns the spot to where it points (the arrow on the plan).")}</span></div>`;
        })() : ""}
        ${def.light?.beam ? (() => {
          const angle = Math.round(item.beam_angle || defaultBeamAngle(item.type));
          return `<div class="field"><label>${t("Beam angle")} <output data-out="beam_angle">${angle}°</output></label>
            <div class="row"><input type="range" min="10" max="120" step="1" data-field="beam_angle" value="${angle}" style="flex:1">
            ${item.beam_angle ? `<button class="btn" data-act="reset-beam" title="${t("Back to this light's default ({angle}°)", { angle: defaultBeamAngle(item.type) })}">${t("Reset")}</button>` : ""}</div>
            <span class="muted">${t("How wide the light spreads: narrow for an accent spot, wide to light a whole area.")}</span></div>`;
        })() : ""}
        ${def.light || domainOf(item.entity_id) === "light" ? (() => {
          const pct = Math.round((item.light_strength ?? 1) * 100);
          return `<div class="field"><label>${t("Light strength")} <output data-out="light_strength">${pct}%</output></label>
            <div class="row"><input type="range" min="10" max="300" step="5" data-field="light_strength" data-unit="%" value="${pct}" style="flex:1">
            ${item.light_strength ? `<button class="btn" data-act="reset-strength" title="${t("Back to 100%")}">${t("Reset")}</button>` : ""}</div>
            <span class="muted">${t("How much light this lamp casts in the 3D view and on the plan, if it looks too bright or too dim. The lamp itself isn't changed.")}</span></div>`;
        })() : ""}
        <h4>${def.passive ? t("Connected to") : t("Linked entity")}</h4>
        ${def.passive ? (() => {
          // Wired speakers: one tap to connect them to an amplifier, receiver or TV on this floor
          const amps = [...new Set(this._floor.furniture
            .filter((a) => a !== item && !catalogItem(a.type).passive && domainOf(a.entity_id) === "media_player")
            .sort((a, b) => dist([a.x, a.y], [item.x, item.y]) - dist([b.x, b.y], [item.x, item.y]))
            .map((a) => a.entity_id))];
          return `${entity("entity_id", t("Amplifier / receiver"), item.entity_id,
            t("The media player driving this speaker. It shows sound waves while that plays. For an amplifier that only reports on/off, the speaker follows the player on its selected input: a piece named after the input (e.g. \"Apple TV\"), or plays whenever the amplifier is on and not muted."),
            "media_player.living_room_receiver")}
            ${amps.length ? `<div class="actions" style="margin:-4px 0 12px;flex-wrap:wrap">${amps.map((id) => `
              <button class="btn${id === item.entity_id ? " primary" : ""}" data-act="connect-speaker" data-entity="${escapeHtml(id)}">
                <ha-icon icon="mdi:cable-data"></ha-icon>${escapeHtml(friendlyName(this._hass, id))}</button>`).join("")}</div>` : ""}`;
        })() : entity("entity_id", t("Entity"), item.entity_id, def.light
          ? t("A light makes this lamp glow and shine. Tip: drag an entity from a room's list onto the piece.")
          : def.screen ? t("The screen lights up when this is on or playing.") : t("Tip: drag an entity from a room's list onto the piece."))}
        ${def.av ? this._avSection(item, def) : ""}
        ${def.surround || def.sub ? this._surroundSection(item, def) : ""}
        ${def.homeTheater && domainOf(item.entity_id) === "media_player" ? this._bondedSection(item) : ""}
        ${def.robot && item.entity_id ? this._vacuumSection(item) : ""}
        ${item.entity_id ? `<div class="field"><label>${t("Tap action")}</label><select data-field="tap_action">
            ${tapOptions(this._hass, item, item.tap_action)}
          </select></div>
          ${doubleTapField(item, this._hass)}
          <label class="check"><input type="checkbox" data-field="show_state" ${item.show_state ? "checked" : ""}> ${t("Show state badge")}</label>` : ""}`}
        <div class="actions">
          <button class="btn" data-act="duplicate" title="Ctrl+D"><ha-icon icon="mdi:content-copy"></ha-icon>${t("Duplicate")}</button>
          <button class="btn danger" data-act="delete"><ha-icon icon="mdi:delete"></ha-icon>${t("Delete")}</button>
        </div>`;
    } else if (floor && catalog) {
      html += `<h3><ha-icon icon="mdi:sofa-outline"></ha-icon>${t("Furniture")}</h3>
        ${placed ? `<div class="actions"><button class="btn" data-act="edit-placed"><ha-icon icon="mdi:pencil"></ha-icon>${t("{name}: details", { name: escapeHtml(placed.name || t(catalogItem(placed.type).label)) })}</button></div>` : ""}
        <p class="muted">${t("Drag a piece onto the plan.")}</p>
        <input class="search" type="search" data-furniture-search placeholder="${t("Search furniture…")}" value="${escapeHtml(this._furnitureQuery || "")}" autocomplete="off">
        ${(() => {
          // While searching: only matching pieces (name or category, in English or translated), their categories unfolded
          const q = (this._furnitureQuery || "").trim().toLowerCase();
          const open = openCategories();
          const category = (c) => {
            // (every word of the search somewhere: "samsung frame" finds The Frame in Samsung)
            const words = q.split(/\s+/).filter(Boolean);
            const items = Object.entries(CATALOG).filter(([k, d]) => d.cat === c && (() => {
              const haystack = `${d.label} ${t(d.label)} ${d.cat} ${t(d.cat)} ${SUBCATEGORIES[d.cat] ? `${SUBCATEGORIES[d.cat]} ${t(SUBCATEGORIES[d.cat])}` : ""} ${k.replace(/_/g, " ")}`.toLowerCase();
              return words.every((w) => haystack.includes(w));
            })())
              .sort(([, a], [, b]) => t(a.label).localeCompare(t(b.label)));
            // A subcategory (Sonos under Multimedia) folds open inside its parent, after the parent's own pieces
            const subs = subcategories(c).map(category).filter((x) => x.count);
            const count = items.length + subs.reduce((n, x) => n + x.count, 0);
            const html = `<details class="cat${SUBCATEGORIES[c] ? " sub" : ""}" data-cat="${c}" ${q || open.has(c) ? "open" : ""}>
              <summary><ha-icon icon="mdi:chevron-right"></ha-icon>${escapeHtml(t(c))}<span class="count">${count}</span></summary>
              ${items.length ? `<div class="catalog">${items.map(([k, d]) => `
                <div class="tile" data-drag-furniture="${k}" title="${t("Drag onto the plan")}"><ha-icon icon="${d.icon}"></ha-icon>${escapeHtml(t(d.label))}</div>`).join("")}
              </div>` : ""}${subs.map((x) => x.html).join("")}</details>`;
            return { html, count };
          };
          return sortedCategories().map(category).filter((x) => !q || x.count).map((x) => x.html).join("");
        })()}`;
    } else if (floor && this._tool === "marker") {
      html += `<h3><ha-icon icon="mdi:map-marker-plus-outline"></ha-icon>${t("Entities")}</h3>
        <input class="search" type="search" data-entity-search placeholder="${t("Search entities…")}" value="${escapeHtml(this._entityQuery || "")}" autocomplete="off">
        <div class="ents" data-list="all"></div>`;
    } else if (floor) {
      const bp = floor.blueprint;
      html += `<h3><ha-icon icon="mdi:compass-outline"></ha-icon>${t("House")}</h3>
        <div class="field"><label>${t("North (° clockwise from the top of the plan)")}</label>
          <input type="number" min="0" max="359" step="1" data-doc-field="north" value="${Math.round(this._doc.north || 0)}">
          <span class="muted">${t("Or drag the compass in the top-right corner. Double-click it to reset.")}</span></div>
        ${this._finishPicker(t("Exterior walls"), "data-doc-field", "exterior_material", "exterior_color", WALL_MATERIALS,
          this._doc.exterior_material, this._doc.exterior_color, t("Default"),
          this._doc.exterior_material || this._doc.exterior_color ? wallFinish(this._doc.exterior_material, this._doc.exterior_color).color : null)}
        <h3><ha-icon icon="mdi:layers-outline"></ha-icon>${t("Floor")}</h3>
        <div class="field"><label>${t("Name")}</label><input data-floor-field="name" value="${escapeHtml(floor.name)}"></div>
        <div class="row">
          <div class="field"><label>${t("Level")}</label><input type="number" step="1" data-floor-field="level" value="${floor.level}"></div>
          <div class="field"><label>${t("Wall height (m)")}</label><input type="number" step="0.05" min="0.5" data-floor-field="wall_height" value="${floor.wall_height}"></div>
        </div>
        <div class="field"><label>${t("New wall thickness (m)")}</label><input type="number" step="0.01" min="0.01" data-pref="wall_thickness" value="${this._wallThickness}"></div>
        <p class="muted">${t("{walls} walls · {rooms} rooms · {openings} doors/windows · {markers} markers", {
          walls: floor.walls.length, rooms: floor.rooms.length, openings: floor.openings.length, markers: floor.markers.length })}</p>
        ${(() => {
          const dups = countDuplicateOpenings(floor);
          return dups ? `<p class="muted"><ha-icon icon="mdi:alert-outline"></ha-icon> ${dups === 1 ? t("1 door/window sits on top of another one.")
            : t("{n} doors/windows sit on top of another one.", { n: dups })}</p>
            <div class="actions"><button class="btn" data-act="remove-duplicate-openings"><ha-icon icon="mdi:door-closed-cancel"></ha-icon>${t("Remove duplicates")}</button></div>` : "";
        })()}
        ${(floor.roofs || []).length ? `<h4>${t("Roofs")}</h4><div class="roof-list">
          ${floor.roofs.map((r, i) => `<div class="row" style="align-items:center">
            <button class="btn" style="flex:1;justify-content:flex-start" data-act="select-roof" data-id="${r.id}">
              <ha-icon icon="mdi:home-roof"></ha-icon>${escapeHtml(r.name || t("Roof {n}", { n: i + 1 }))} · ${escapeHtml(t(ROOF_TYPES[r.type || "gable"]).split(" (")[0])}</button>
            <button class="btn danger" data-act="delete-roof" data-id="${r.id}" title="${t("Delete this roof")}" aria-label="${t("Delete this roof")}"><ha-icon icon="mdi:delete"></ha-icon></button>
          </div>`).join("")}</div>` : ""}
        ${this._doc.floors.length > 1 ? this._alignSection() : ""}
        <h4>${t("Blueprint")}</h4>
        ${bp ? `
          <div class="row">${this._bpNum("width", t("Width (m)"), bp.width)}${this._bpNum("x", t("X (m)"), bp.x)}${this._bpNum("y", t("Y (m)"), bp.y)}</div>
          <div class="field"><label>${t("Opacity")}</label><input type="range" min="0" max="1" step="0.05" data-bp-field="opacity" value="${bp.opacity}"></div>
          <label class="check"><input type="checkbox" data-bp-field="show_in_view" ${bp.show_in_view ? "checked" : ""}> ${t("Show outside of edit mode")}</label>
          <div class="actions">
            <button class="btn" data-act="calibrate"><ha-icon icon="mdi:ruler"></ha-icon>${t("Calibrate scale")}</button>
            <button class="btn" data-act="upload"><ha-icon icon="mdi:image-refresh"></ha-icon>${t("Replace")}</button>
            <button class="btn danger" data-act="remove-blueprint">${t("Remove")}</button>
          </div>`
        : `<p class="muted">${t("Upload a picture of your floorplan to trace over. PNG, JPG, WebP, AVIF or GIF up to 15 MB.")}</p>
           <div class="actions"><button class="btn primary" data-act="upload"><ha-icon icon="mdi:image-plus"></ha-icon>${t("Upload image")}</button></div>`}
        <input type="file" data-file="blueprint" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif" hidden>
        <h4>${t("3D scan")}</h4>
        <p class="muted">${t("Start from a LiDAR room scan: an OBJ file from an iPhone or iPad scanning app (Apple RoomPlan, e.g. 3D Snap). It becomes a new floor with the walls, doors, windows, rooms and furniture as blocks, to check and tidy up.")}</p>
        <div class="actions"><button class="btn" data-act="import-scan"><ha-icon icon="mdi:cube-scan"></ha-icon>${t("Import scan")}</button></div>
        <input type="file" data-file="scan" accept=".obj" hidden>
        <h4>${t("This device")}</h4>
        <div class="field"><label>${t("Quality")}</label><select data-pref="quality">
          ${[["auto", this._autoQualityLabel()], ["high", t("Full")], ["low", t("Light, for slower devices")]]
            .map(([v, label]) => `<option value="${v}" ${qualityMode() === v ? "selected" : ""}>${label}</option>`).join("")}
        </select><span class="muted">${t("Light uses fewer pixels, simpler shadows, fewer lights and slower animation in 3D, and no blur in 2D, for wall tablets and phones. Applies to this browser only.")}</span></div>
        ${this._doc.floors.length > 1 ? `<h4>${t("Danger zone")}</h4><div class="actions"><button class="btn danger" data-act="delete-floor">${t("Delete this floor")}</button></div>` : ""}`;
    }
    this._aside.innerHTML = html;
    this._fillEntityList(this._aside.querySelector(".ents[data-list=area]"), this._roomEntities(item));
    this._fillEntityList(this._aside.querySelector(".ents[data-list=all]"), this._searchEntities());
    const file = this._aside.querySelector("input[data-file=blueprint]");
    file?.addEventListener("change", () => {
      if (file.files[0]) this._uploadBlueprint(file.files[0]);
    });
    const scan = this._aside.querySelector("input[data-file=scan]");
    scan?.addEventListener("change", () => {
      if (scan.files[0]) this._importScan(scan.files[0]);
    });
  }

  // ---------- entity palette (drag onto the plan) ----------

  _roomEntities(room) {
    if (!room?.area_id || this._selection?.kind !== "room") return null;
    return sortEntities(this._hass, areaEntities(this._hass, room.area_id).filter((id) => isPlaceable(this._hass, id)));
  }

  _searchEntities() {
    if (this._tool !== "marker" || this._selection) return null;
    const q = (this._entityQuery || "").trim().toLowerCase();
    const ids = Object.keys(this._hass.states).filter((id) => {
      if (!isPlaceable(this._hass, id)) return false;
      if (!q) return true;
      const area = this._hass.areas?.[areaOfEntity(this._hass, id)]?.name || "";
      return `${id} ${friendlyName(this._hass, id)} ${area}`.toLowerCase().includes(q);
    });
    return sortEntities(this._hass, ids);
  }

  _areaEntitySection(room) {
    const hint = `<p class="muted">${t("Drag an entity onto the plan to place it. Drag a marker back onto this panel to remove it.")}</p>`;
    if (!room.area_id) {
      return `<h4>${t("Entities")}</h4><p class="muted">${t("Link an HA area above to list its entities here.")}</p>`;
    }
    const area = this._hass.areas?.[room.area_id];
    const n = this._roomEntities(room)?.length || 0;
    return `<h4>${t("Entities in {area} ({n})", { area: escapeHtml(area?.name || room.area_id), n })}</h4>
      ${n ? hint : `<p class="muted">${t("No entities in this area.")}</p>`}
      <div class="ents" data-list="area"></div>`;
  }

  /** Render entity rows; icons need real elements so they follow state. */
  _fillEntityList(container, ids) {
    if (!container || !ids) return;
    const placed = new Set([...(this._floor?.markers || []), ...(this._floor?.furniture || [])].map((m) => m.entity_id));
    const shown = ids.slice(0, PALETTE_LIMIT);
    container.innerHTML = shown.length
      ? shown
          .map((id) => {
            const st = this._hass.states[id];
            const area = container.dataset.list === "all" ? this._hass.areas?.[areaOfEntity(this._hass, id)]?.name : "";
            const sub = [formatState(this._hass, st), area].filter(Boolean).join(" · ");
            return `<div class="ent ${placed.has(id) ? "placed" : ""}" data-drag-entity="${escapeHtml(id)}"
                title="${placed.has(id) ? t("On the plan. Click to select it, or drag to place it again.") : t("Drag onto the plan")}">
              <span class="ico"></span>
              <span class="txt"><span class="nm">${escapeHtml(friendlyName(this._hass, id))}</span><span class="st">${escapeHtml(sub)}</span></span>
              <ha-icon class="mark" icon="${placed.has(id) ? "mdi:check-circle" : "mdi:drag"}"></ha-icon>
            </div>`;
          })
          .join("") +
        (ids.length > shown.length ? `<p class="muted">${t("{n} more. Refine your search.", { n: ids.length - shown.length })}</p>` : "")
      : `<p class="muted">${t("No matching entities.")}</p>`;
    container.querySelectorAll(".ent").forEach((row) => {
      const id = row.dataset.dragEntity;
      row.querySelector(".ico").appendChild(createStateIcon(this._hass, this._hass.states[id]));
    });
  }

  /**
   * Floating preview under the pointer while dragging.
   * what: { entityId } or { icon, label }.
   */
  _ghost(what, clientX, clientY, { removing = false, label = null } = {}) {
    if (!this._ghostEl) {
      this._ghostEl = document.createElement("div");
      this._ghostEl.className = "ghost";
      this._ghostEl.innerHTML = `<span class="ico"></span><span class="nm"></span>`;
      this._root.appendChild(this._ghostEl);
    }
    const g = this._ghostEl;
    const key = what.entityId || what.icon;
    if (g._key !== key) {
      g._key = key;
      let icon;
      if (what.entityId) {
        icon = createStateIcon(this._hass, this._hass.states[what.entityId]);
      } else {
        icon = document.createElement("ha-icon");
        icon.icon = what.icon;
      }
      g.querySelector(".ico").replaceChildren(icon);
    }
    g.querySelector(".nm").textContent = label || what.label || friendlyName(this._hass, what.entityId);
    const r = this._root.getBoundingClientRect();
    g.style.left = `${clientX - r.left}px`;
    g.style.top = `${clientY - r.top}px`;
    g.classList.toggle("removing", removing);
  }

  _clearGhost() {
    this._ghostEl?.remove();
    this._ghostEl = null;
  }

  /** Red "drop here to remove" zone over the side panel while an item is dragged. */
  _showTrash(over) {
    if (!this._trashEl) {
      this._trashEl = document.createElement("div");
      this._trashEl.className = "trash";
      this._trashEl.innerHTML = `<ha-icon icon="mdi:delete-outline"></ha-icon>${t("Drop here to remove")}`;
      this._root.appendChild(this._trashEl);
    }
    const a = this._aside.getBoundingClientRect();
    const r = this._root.getBoundingClientRect();
    Object.assign(this._trashEl.style, {
      left: `${a.left - r.left + 6}px`, top: `${a.top - r.top + 6}px`,
      width: `${a.width - 12}px`, height: `${a.height - 12}px`,
    });
    this._trashEl.classList.toggle("over", over);
  }

  _hideTrash() {
    this._trashEl?.remove();
    this._trashEl = null;
  }

  _itemGhost(kind, item) {
    if (kind === "marker") return { entityId: item.entity_id };
    const def = catalogItem(item.type);
    return { icon: def.icon, label: item.name || t(def.label) };
  }

  _onItemDrag({ kind, item, clientX, clientY, outside }) {
    this._showTrash(outside);
    if (outside) this._ghost(this._itemGhost(kind, item), clientX, clientY, { removing: true });
    else this._clearGhost();
  }

  _onItemDrop({ kind, item, remove }) {
    this._hideTrash();
    this._clearGhost();
    if (!remove) return;
    const floor = this._floor;
    const key = kind === "marker" ? "markers" : "furniture";
    // The undo snapshot was taken when the drag started
    floor[key] = floor[key].filter((x) => x.id !== item.id);
    if (this._selection?.kind === kind && this._selection.id === item.id) this._selection = null;
    this._afterChange();
    const g = this._itemGhost(kind, item);
    this._toast(t("Removed {name} from the plan", { name: g.label || friendlyName(this._hass, g.entityId) }));
  }

  /** Drag from the side panel: an entity (marker / link to furniture) or a catalog piece. */
  _onPaletteDown(e) {
    const row = e.target.closest("[data-drag-entity], [data-drag-furniture]");
    if (!row || e.button > 0) return;
    const entityId = row.dataset.dragEntity;
    const type = row.dataset.dragFurniture;
    const what = entityId ? { entityId } : { icon: catalogItem(type).icon, label: t(catalogItem(type).label) };
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const canDrop = () => this._view === "2d";
    // Entities dropped on a piece of furniture link to it instead of becoming a marker
    const target = (ev) => (entityId && canDrop() ? this._plan.furnitureAt(ev.clientX, ev.clientY) : null);

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        dragging = true;
        row.classList.add("dragging");
        try {
          row.setPointerCapture(e.pointerId);
        } catch (_err) {
          /* pointer already released */
        }
      }
      ev.preventDefault();
      const f = target(ev);
      const label = f ? t("Link to {name}", { name: f.name || t(catalogItem(f.type).label) }) : null;
      this._ghost(what, ev.clientX, ev.clientY, { label });
      this._plan.setDropHint(canDrop() && this._plan.containsPoint(ev.clientX, ev.clientY));
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      row.classList.remove("dragging");
      this._clearGhost();
      this._plan.setDropHint(false);
      if (!dragging) {
        if (ev.type === "pointerup" && entityId) this._onPaletteClick(entityId);
        return;
      }
      if (ev.type !== "pointerup" || !canDrop() || !this._plan.containsPoint(ev.clientX, ev.clientY)) return;
      const f = target(ev);
      if (f) {
        this._change(() => {
          f.entity_id = entityId;
          f.tap_action = canToggle(entityId) || floodlightEntity(this._hass, entityId) ? "toggle" : "more-info";
        });
        this._toast(t("{entity} linked to {name}", { entity: friendlyName(this._hass, entityId), name: f.name || t(catalogItem(f.type).label) }));
        return;
      }
      const [x, y] = this._plan.clientToWorld(ev.clientX, ev.clientY, ev);
      if (type) {
        const piece = newFurniture(type, x, y);
        this._change(() => {
          this._floor.furniture.push(piece);
          this._selection = { kind: "furniture", id: piece.id };
        }, { inspector: false });
        this._placed(piece);
      } else if (domainOf(entityId) === "camera") {
        // A camera becomes a camera piece (with its field of view), opening the live view on tap
        const flood = floodlightEntity(this._hass, entityId);
        const piece = { ...newFurniture(flood ? "floodlight_camera" : "security_camera", x, y), entity_id: entityId,
          tap_action: flood ? "toggle" : "more-info" };
        this._change(() => {
          this._floor.furniture.push(piece);
          this._selection = { kind: "furniture", id: piece.id };
        });
      } else {
        this._change(() => this._floor.markers.push(newMarker(entityId, x, y)));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /**
   * A catalog piece was dropped on the plan: switch to Select with the piece selected, so
   * it can be moved and turned right away, and keep the catalog (with its open
   * categories) in the side panel for the next piece. Its details are a click away.
   */
  _placed(piece) {
    this._setTool("select");
    this._selection = { kind: "furniture", id: piece.id };
    this._keepCatalog = piece.id;
    this._renderInspector();
    this._refreshViews();
  }

  _onPaletteClick(entityId) {
    const m = this._floor?.markers.find((x) => x.entity_id === entityId);
    const f = this._floor?.furniture.find((x) => x.entity_id === entityId);
    if (m) this._select({ kind: "marker", id: m.id });
    else if (f) this._select({ kind: "furniture", id: f.id });
    else this._toast(t("Drag it onto the plan to place it, or onto furniture to link it."));
  }

  /** Material dropdown + colour for a surface finish. */
  _finishPicker(title, attr, matField, colorField, defs, material, color, noneLabel, effectiveColor) {
    const options = [
      noneLabel ? `<option value="" ${!material ? "selected" : ""}>${noneLabel}</option>` : "",
      ...Object.entries(defs).map(([k, d]) => `<option value="${k}" ${k === material ? "selected" : ""}>${t(d.label)}</option>`),
    ].join("");
    const showColor = !!effectiveColor;
    return `<h4>${title}</h4>
      <div class="row">
        <div class="field"><label>${t("Material")}</label><select ${attr}="${matField}">${options}</select></div>
        ${showColor ? `<div class="field" style="max-width:110px"><label>${t("Colour")}</label>
          <input type="color" ${attr}="${colorField}" value="${escapeHtml(effectiveColor)}"></div>` : ""}
      </div>
      ${color ? `<div class="actions" style="margin:-4px 0 8px"><button class="btn" data-act="reset-finish" data-attr="${attr}" data-key="${colorField}">${t("Default colour")}</button></div>` : ""}`;
  }

  _finishFields(room) {
    const floor = floorFinish(room);
    const walls = room.wall_material || room.wall_color ? wallFinish(room.wall_material, room.wall_color) : null;
    return this._finishPicker(t("Floor surface"), "data-field", "floor_material", "floor_color", FLOOR_MATERIALS,
      room.floor_material && room.floor_material !== "plain" ? room.floor_material : "plain", room.floor_color, null,
      floor.material !== "plain" ? floor.color : null) +
      (floor.material !== "plain" ? `<div class="actions" style="margin:-4px 0 8px">
        <button class="btn" data-act="rotate-floor" title="${t("Turn the floor pattern 45°")}"><ha-icon icon="mdi:rotate-right"></ha-icon>
          ${t("Rotate pattern ({angle}°)", { angle: Math.round(room.floor_rotation || 0) })}</button></div>` : "") +
      this._finishPicker(t("Walls (this room's side)"), "data-field", "wall_material", "wall_color", WALL_MATERIALS,
        room.wall_material, room.wall_color, t("Default"), walls?.color || null);
  }

  _areaField(room) {
    const areas = listAreas(this._hass);
    const missing = room.area_id && !this._hass.areas?.[room.area_id];
    const lights = room.area_id ? areaEntities(this._hass, room.area_id, "light").length : 0;
    return `<div class="field"><label>${t("HA area")}</label>
      <select data-field="area_id">
        <option value="">${t("— None —")}</option>
        ${areas.map((a) => `<option value="${escapeHtml(a.area_id)}" ${a.area_id === room.area_id ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
        ${missing ? `<option value="${escapeHtml(room.area_id)}" selected>${t("{area} (deleted)", { area: escapeHtml(room.area_id) })}</option>` : ""}
      </select>
      ${missing ? `<span class="warn">${t("This area no longer exists in Home Assistant")}</span>` : ""}
      ${room.area_id && !missing ? `<span class="muted">${lights === 1 ? t("1 light in this area") : t("{n} lights in this area", { n: lights })}</span>` : ""}
      ${!areas.length ? `<span class="muted">${t("No areas yet. Create them under Settings → Areas.")}</span>` : ""}
    </div>`;
  }

  _bpNum(field, label, value) {
    return `<div class="field"><label>${label}</label><input type="number" step="0.05" data-bp-field="${field}" value="${value}"></div>`;
  }

  _onAsideClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    switch (b.dataset.act) {
      case "delete":
        this._deleteSelected();
        break;
      case "delete-floor":
        this._deleteFloor();
        break;
      case "edit-placed":
        this._keepCatalog = null;
        this._renderInspector();
        break;
      case "upload":
        this._aside.querySelector("input[data-file=blueprint]").click();
        break;
      case "import-scan":
        this._aside.querySelector("input[data-file=scan]").click();
        break;
      case "calibrate":
        this._setTool("calibrate");
        break;
      case "move-floor":
        this._setTool(this._tool === "move-floor" ? "select" : "move-floor");
        break;
      case "shift-floor": {
        const v = (k) => parseFloat(this._aside.querySelector(`[data-move=${k}]`)?.value) || 0;
        const [dx, dy] = [v("x"), v("y")];
        if (dx || dy) this._change(() => shiftFloor(this._floor, dx, dy));
        break;
      }
      case "flip-hinge":
      case "flip-swing": {
        const key = b.dataset.act === "flip-hinge" ? "flip_hinge" : "flip_swing";
        this._change(() => {
          const door = this._findSelected();
          door[key] = !door[key];
        });
        break;
      }
      case "rotate90":
        this._change(() => {
          const it = this._findSelected();
          it.rotation = normalizeAngle((it.rotation || 0) + 90);
        });
        break;
      case "duplicate":
        this._duplicateSelected();
        break;
      case "reset-color":
        this._change(() => (this._findSelected().color = null));
        break;
      case "flip-roof":
        this._change(() => {
          const roof = this._findSelected();
          roof.flipped = !roof.flipped;
        });
        break;
      case "bond-speaker":
        // A soundbar's surrounds and Sub: bond or release one (it follows the soundbar's player)
        this._change(() => {
          const bar = this._findSelected();
          const piece = this._floor.furniture.find((f) => f.id === b.dataset.piece);
          if (!bar || !piece) return;
          if (piece.surround && piece.entity_id === bar.entity_id) {
            piece.surround = null;
            piece.entity_id = null;
          } else {
            piece.surround = true;
            piece.entity_id = bar.entity_id;
          }
        });
        break;
      case "connect-speaker":
        this._change(() => {
          const piece = this._findSelected();
          piece.entity_id = piece.entity_id === b.dataset.entity ? null : b.dataset.entity;
        });
        break;
      case "remove-duplicate-openings":
        this._change(() => {
          removeDuplicateOpenings(this._floor);
          if (this._selection?.kind === "opening" && !this._floor.openings.some((o) => o.id === this._selection.id)) this._selection = null;
        });
        break;
      case "select-roof":
        this._select({ kind: "roof", id: b.dataset.id });
        break;
      case "delete-roof":
        this._change(() => {
          this._floor.roofs = (this._floor.roofs || []).filter((r) => r.id !== b.dataset.id);
          if (this._selection?.kind === "roof" && this._selection.id === b.dataset.id) this._selection = null;
        });
        break;
      case "rotate-floor":
        this._change(() => {
          const room = this._findSelected();
          room.floor_rotation = ((room.floor_rotation || 0) + 45) % 180;
        });
        break;
      case "turn-ridge":
        this._change(() => {
          const roof = this._findSelected();
          roof.ridge_turned = !roof.ridge_turned;
        });
        break;
      case "reset-beam":
        this._change(() => delete this._findSelected().beam_angle);
        break;
      case "reset-strength":
        this._change(() => delete this._findSelected().light_strength);
        break;
      case "reset-finish": {
        const target = b.dataset.attr === "data-doc-field" ? this._doc : this._findSelected();
        this._change(() => (target[b.dataset.key] = null));
        break;
      }
      case "remove-blueprint":
        this._change(() => (this._floor.blueprint = null));
        break;
      default:
    }
  }

  /** Floor section: outline of another floor + moving the whole floor. */
  _alignSection() {
    const ref = this._outlineFloor();
    const others = this._doc.floors.filter((f) => f.id !== this._floor.id);
    const name = escapeHtml((ref || others.find((f) => f.level < this._floor.level) || others[0]).name);
    const moving = this._tool === "move-floor";
    return `<h4>${t("Line up with other floors")}</h4>
      <label class="check"><input type="checkbox" data-pref="underlay" ${ref ? "checked" : ""}> ${t("Show the outline of {floor}", { floor: name })}</label>
      <div class="actions">
        <button class="btn ${moving ? "primary" : ""}" data-act="move-floor"><ha-icon icon="mdi:cursor-move"></ha-icon>${moving ? t("Done moving") : t("Drag to move floor")}</button>
      </div>
      <div class="row">
        <div class="field"><label>${t("Move X (m)")}</label><input type="number" step="0.05" value="0" data-move="x"></div>
        <div class="field"><label>${t("Move Y (m)")}</label><input type="number" step="0.05" value="0" data-move="y"></div>
        <div class="field"><label>&nbsp;</label><button class="btn" data-act="shift-floor">${t("Move")}</button></div>
      </div>
      <span class="muted">${t("Moves walls, rooms, doors, windows, markers, furniture and the blueprint together.")}</span>`;
  }

  _onField(e, live = false) {
    const t = e.target;
    if (t.dataset.avInput !== undefined || t.dataset.avFrom !== undefined) {
      this._onAvField(t);
      return;
    }
    if (t.dataset.vacRoom !== undefined) {
      const item = this._findSelected();
      if (!item) return;
      this._change(() => {
        const map = { ...(item.vacuum_rooms || {}) };
        if (t.value) map[t.dataset.vacRoom] = t.value;
        else delete map[t.dataset.vacRoom];
        item.vacuum_rooms = Object.keys(map).length ? map : null;
      }, { inspector: true });
      return;
    }
    const floor = this._floor;
    if (!floor) return;
    const value = t.type === "checkbox" ? t.checked : t.type === "number" || t.type === "range" ? parseFloat(t.value) : t.value.trim();
    if ((t.type === "number" || t.type === "range") && !Number.isFinite(value)) return;

    if (t.dataset.move) return; // read when "Move" is clicked
    if (t.dataset.pref === "underlay") {
      writePref("underlay", value ? "1" : "0");
      this._renderInspector();
      this._refreshViews();
      return;
    }
    if (t.dataset.pref === "quality") {
      setQualityMode(t.value);
      if (t.value === "auto") {
        // Back to automatic: decide afresh (a GPU we can't name is measured again)
        setMeasuredQuality("");
        if (this._view3d) this._view3d._measure = needsMeasurement();
      }
      this._plan?.applyQuality();
      this._view3d?.applyQuality();
      this._toast(t.value === "auto" ? translate("Quality: automatic") : translate("Quality set for this device"));
      return;
    }
    if (t.dataset.pref === "wall_thickness") {
      this._wallThickness = Math.max(0.01, value);
      this._refreshViews();
      return;
    }
    // A slider drag fires many input events and a final change: one undo step
    let snapshot = true;
    if (t.type === "range") {
      snapshot = !this._sliding;
      this._sliding = live;
    }
    // Don't re-render the inspector for plain inputs, it would steal focus while tabbing
    // (a slider re-renders once it's let go, e.g. to show its Reset button)
    const opts = { snapshot, inspector: t.tagName === "SELECT" || t.type === "checkbox" || (t.type === "range" && !live) };

    if (t.dataset.docField === "north") {
      this._change(() => (this._doc.north = normalizeAngle(value)), opts);
      return;
    }
    if (t.dataset.docField === "exterior_material" || t.dataset.docField === "exterior_color") {
      const key = t.dataset.docField;
      this._change(() => (this._doc[key] = value || null), { ...opts, inspector: key === "exterior_material" });
      return;
    }
    if (t.dataset.floorField) {
      this._change(() => (floor[t.dataset.floorField] = t.dataset.floorField === "level" ? Math.round(value) : value), opts);
      this._renderHeader();
      return;
    }
    if (t.dataset.bpField && floor.blueprint) {
      this._change(() => (floor.blueprint[t.dataset.bpField] = value), opts);
      return;
    }
    const item = this._findSelected();
    const field = t.dataset.field;
    if (!item || !field) return;
    this._change(() => {
      if (field === "length" && this._selection.kind === "wall") {
        const len = dist(item.a, item.b) || 1;
        const k = Math.max(0.05, value) / len;
        item.b = [round(item.a[0] + (item.b[0] - item.a[0]) * k), round(item.a[1] + (item.b[1] - item.a[1]) * k)];
      } else if (field === "area_id") {
        item.area_id = value || null;
        // Adopt the area's name while the room still has its default name
        const area = this._hass.areas?.[value];
        const defaultName = (n) => /^Room \d+$/.test(n) || new RegExp(`^${t("Room {n}").replace("{n}", "\\d+")}$`).test(n);
        if (area && (!item.name || defaultName(item.name))) item.name = area.name;
      } else if (["floor_material", "floor_color", "wall_material", "wall_color"].includes(field)) {
        // "" = default; a new material starts from its own default colour
        item[field] = value || null;
        if (field === "floor_material") item.floor_color = null;
        if (field === "wall_material") item.wall_color = null;
      } else if (field === "tilt") {
        // Directional spot: degrees from straight down (unset when straight down)
        const tilt = Math.round(Math.min(85, Math.max(0, value)));
        if (tilt) item.tilt = tilt;
        else delete item.tilt;
      } else if (field === "light_strength") {
        // Slider in %, stored as a factor (unset at 100%)
        const k = Math.min(5, Math.max(0.05, value / 100));
        if (Math.abs(k - 1) < 1e-6) delete item.light_strength;
        else item.light_strength = Math.round(k * 100) / 100;
      } else if (field === "connected_to" || field === "connected_input") {
        item[field] = value || null;
        // Another amplifier has other inputs
        if (field === "connected_to") item.connected_input = null;
      } else if (field === "surround") {
        item.surround = value || null;
        // Link it to the nearest soundbar, unless it already follows one
        const bars = this._soundbars(item);
        if (value && bars.length && !bars.includes(item.entity_id)) item.entity_id = bars[0];
      } else if (field === "entity_id" || field === "sensor_entity_id" || field === "icon") {
        item[field] = value || (field === "entity_id" && this._selection.kind === "marker" ? "" : null);
      } else {
        item[field] = value;
      }
      if (field === "rotation") item.rotation = normalizeAngle(value);
      if (this._selection.kind === "furniture" && ["w", "d", "h"].includes(field)) {
        item[field] = Math.min(field === "h" ? 10 : 20, Math.max(field === "h" ? 0.01 : 0.05, value));
      }
      if (this._selection.kind === "furniture" && field === "z") item.z = Math.min(10, Math.max(0, value));
      if (this._selection.kind === "roof") {
        if (field === "pitch") item.pitch = Math.min(75, Math.max(0, value));
        if (field === "overhang") item.overhang = Math.min(3, Math.max(0, value));
        if (field === "material") item.color = null; // a new covering starts in its own colour
      }
      if (field === "type" && this._selection.kind === "furniture") {
        // New piece type: take its standard size
        const def = catalogItem(value);
        Object.assign(item, { w: Math.max(MIN_SIZE, def.w), d: Math.max(MIN_SIZE, def.d), h: Math.max(MIN_HEIGHT, def.h), z: def.z || 0 });
      }
      if (field === "type" && this._selection.kind === "opening") {
        // Switching type: adopt sensible defaults for sill/height
        item.sill = value === "window" ? 0.9 : 0;
        item.height = value === "window" ? 1.2 : 2.1;
      }
    }, { ...opts, inspector: opts.inspector && t.type === "range"
      || ["type", "area_id", "entity_id", "surround", "sensor_entity_id", "connected_to", "show_state", "floor_material", "wall_material", "material", "overhang"].includes(field) });
  }

  // ---------- Sonos surrounds ----------

  /** Soundbars on this floor, nearest to the piece first (their players' entity ids). */
  _soundbars(item) {
    return [...new Set(this._floor.furniture
      .filter((b) => b !== item && catalogItem(b.type).homeTheater && domainOf(b.entity_id) === "media_player")
      .sort((a, b) => dist([a.x, a.y], [item.x, item.y]) - dist([b.x, b.y], [item.x, item.y]))
      .map((b) => b.entity_id))];
  }

  /** A Sonos speaker bonded to a soundbar as a rear surround or its Sub: it follows the soundbar. */
  _surroundSection(item, def) {
    const bars = this._soundbars(item);
    return `<label class="check"><input type="checkbox" data-field="surround" ${item.surround ? "checked" : ""}> ${def.sub ? t("Sub of a soundbar") : t("Surround speaker of a soundbar")}</label>
      ${item.surround ? `
        ${bars.length ? `<div class="actions" style="margin:4px 0 4px;flex-wrap:wrap">${bars.map((id) => `
          <button class="btn${id === item.entity_id ? " primary" : ""}" data-act="connect-speaker" data-entity="${escapeHtml(id)}">
            <ha-icon icon="mdi:surround-sound"></ha-icon>${escapeHtml(friendlyName(this._hass, id))}</button>`).join("")}</div>`
          : `<p class="muted">${t("Place the soundbar on this floor and link it to its media player first.")}</p>`}
        <p class="muted" style="margin:4px 0 12px">${def.sub
          ? t("A bonded Sub has no entity of its own: this one is linked to the soundbar's player. It shows sound waves while the soundbar plays, unless the sub is switched off in the Sonos app.")
          : t("Bonded surrounds have no entity of their own: this one is linked to the soundbar's player. It shows sound waves while the soundbar plays and surround is on (softer for music, which the surrounds play at the ambient level unless \"Surround music full volume\" is on).")}</p>` : ""}`;
  }

  /** Sonos speakers on this floor that can be bonded to a soundbar (surrounds, a Sub), nearest first. */
  _bondable(bar) {
    return this._floor.furniture
      .filter((f) => f !== bar && (catalogItem(f.type).surround || catalogItem(f.type).sub))
      .sort((a, b) => dist([a.x, a.y], [bar.x, bar.y]) - dist([b.x, b.y], [bar.x, bar.y]));
  }

  /**
   * On a soundbar: the speakers bonded to it in the Sonos app. They have no entity of their
   * own in Home Assistant, so they're set here (or on the speaker itself) and follow it.
   */
  _bondedSection(bar) {
    const speakers = this._bondable(bar);
    const bonded = (f) => f.surround && f.entity_id === bar.entity_id;
    return `<h4>${t("Surround speakers")}</h4>
      ${speakers.length ? `<div class="actions" style="margin:4px 0 4px;flex-wrap:wrap">${speakers.map((f) => `
        <button class="btn${bonded(f) ? " primary" : ""}" data-act="bond-speaker" data-piece="${escapeHtml(f.id)}" aria-pressed="${bonded(f)}">
          <ha-icon icon="${catalogItem(f.type).sub ? "mdi:surround-sound" : "mdi:speaker"}"></ha-icon>${escapeHtml(f.name || t(catalogItem(f.type).label))}${
            // (linked to something else: say what, so two unnamed Ones can be told apart)
            f.entity_id && !bonded(f) ? ` · ${escapeHtml(friendlyName(this._hass, f.entity_id))}` : ""}</button>`).join("")}</div>`
        : `<p class="muted">${t("Place the surround speakers (and a Sub) on this floor first.")}</p>`}
      <p class="muted" style="margin:4px 0 12px">${t("Tap the speakers bonded to this soundbar in the Sonos app (rear surrounds, a Sub). Bonded speakers have no entity of their own in Home Assistant: they follow this soundbar.")}</p>`;
  }

  // ---------- AV wiring ----------

  /** Inputs and outputs of an AV piece: a source's output, a receiver's inputs and output, a TV's input. */
  _avSection(item, def) {
    const pieces = this._floor.furniture;
    const role = (p) => catalogItem(p.type).av;
    // "Eetkamer (Apple TV 4K)": the entity's name alone often reads like a room
    const name = (p) => {
      const kind = t(catalogItem(p.type).label).split(" (")[0];
      const own = p.name || (this._hass.states[p.entity_id] ? friendlyName(this._hass, p.entity_id) : "");
      return own && !own.toLowerCase().includes(kind.toLowerCase()) ? `${own} (${kind})` : own || kind;
    };
    const devices = (roles) => pieces.filter((p) => p !== item && p.entity_id && p.entity_id !== item.entity_id && roles.includes(role(p)));
    const options = (list, selected, none) => `<option value="">${none}</option>${list.map((p) => `
      <option value="${escapeHtml(p.entity_id)}" ${p.entity_id === selected ? "selected" : ""}>${escapeHtml(name(p))}</option>`).join("")}`;
    const needEntity = `<p class="muted">${t("Link this piece to its entity first, so it can be wired up.")}</p>`;
    const output = (targets) => {
      const target = pieces.find((p) => p !== item && p.entity_id === item.connected_to);
      const inputs = target && role(target) === "receiver" ? this._hass.states[target.entity_id]?.attributes?.source_list || [] : [];
      return `<h4>${t("Output")}</h4>
        <div class="field"><label>${t("Plugged into")}</label><select data-field="connected_to">${options(devices(targets), item.connected_to, t("Not connected"))}
          ${item.connected_to && !target ? `<option value="${escapeHtml(item.connected_to)}" selected>${escapeHtml(item.connected_to)}</option>` : ""}</select></div>
        ${target && role(target) === "receiver" ? `<div class="field"><label>${t("On input")}</label><select data-field="connected_input">
          <option value="">${inputs.length ? t("Choose the input…") : t("Inputs unknown")}</option>
          ${[...new Set([...inputs, ...(item.connected_input ? [item.connected_input] : [])])].map((n) => `
            <option value="${escapeHtml(n)}" ${n === item.connected_input ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
        </select></div>` : ""}`;
    };
    if (def.av === "source") return item.entity_id ? output(["receiver", "display"]) : `<h4>${t("Output")}</h4>${needEntity}`;
    if (def.av === "receiver") {
      if (!item.entity_id) return `<h4>${t("Inputs")}</h4>${needEntity}`;
      const inputs = this._hass.states[item.entity_id]?.attributes?.source_list || [];
      const sources = devices(["source"]);
      const on = (n) => pieces.find((p) => p.connected_to === item.entity_id && p.connected_input === n)?.entity_id;
      return `<h4>${t("Inputs")}</h4>
        ${inputs.length ? inputs.map((n) => `<div class="field"><label>${escapeHtml(n)}</label>
          <select data-av-input="${escapeHtml(n)}">${options(sources, on(n), "—")}</select></div>`).join("")
          : `<p class="muted">${t("This receiver doesn't list its inputs.")}</p>`}
        ${output(["display"])}`;
    }
    // Display: one input
    if (!item.entity_id) return `<h4>${t("Input")}</h4>${needEntity}`;
    const feed = displayFeed(item, pieces);
    return `<h4>${t("Input")}</h4>
      <div class="field"><label>${t("Comes from")}</label><select data-av-from>${options(devices(["receiver", "source"]), feed?.entity_id, t("Nothing connected"))}</select>
      <span class="muted">${t("The screen shows what's playing on this device (through a receiver: on its selected input).")}</span></div>`;
  }

  /** A robot vacuum's rooms, each matched to a room of this floor (where it drives while cleaning that room). */
  _vacuumSection(item) {
    const rooms = vacuumRooms(this._hass, item.entity_id);
    const sensor = currentRoomSensor(this._hass, item.entity_id);
    const planRooms = this._floor.rooms;
    const label = (r) => r.name || this._hass.areas?.[r.area_id]?.name || r.area_id || t("Unnamed room");
    if (!rooms.length || !sensor) {
      return `<h4>${t("Rooms")}</h4><p class="muted">${t("This vacuum doesn't report its rooms or the room it's in, so it can't be shown cleaning a room.")}</p>`;
    }
    return `<h4>${t("Rooms")}</h4>
      <p class="muted">${t("While cleaning, the robot drives through the room it's in (from {sensor}). Match the vacuum's rooms to the plan.", { sensor: escapeHtml(friendlyName(this._hass, sensor)) })}</p>
      ${rooms.map((vr) => {
        const mapped = item.vacuum_rooms?.[vr.id];
        // What it would pick by name when not set
        const auto = !mapped && cleaningRoom({ ...this._hass, states: { ...this._hass.states,
          [sensor]: { state: vr.name, attributes: { room_id: vr.id, room_name: vr.name } } } }, { ...item, vacuum_rooms: {} }, planRooms);
        return `<div class="field"><label>${escapeHtml(vr.name)}</label><select data-vac-room="${escapeHtml(vr.id)}">
          <option value="">${auto ? t("Automatic: {room}", { room: escapeHtml(label(auto)) }) : t("Not on this floor")}</option>
          ${[...planRooms].filter((r) => !isOutdoor(r)).sort((a, b) => label(a).localeCompare(label(b))).map((r) => `
            <option value="${r.id}" ${r.id === mapped ? "selected" : ""}>${escapeHtml(label(r))}</option>`).join("")}
        </select></div>`;
      }).join("")}`;
  }

  /** Rewire from a receiver's input list or a TV's input (the connection lives on the feeding device). */
  _onAvField(t) {
    const item = this._findSelected();
    if (!item?.entity_id) return;
    const pieces = this._floor.furniture;
    const unplug = (p) => { p.connected_to = null; p.connected_input = null; };
    this._change(() => {
      if (t.dataset.avInput !== undefined) {
        const input = t.dataset.avInput;
        pieces.filter((p) => p.connected_to === item.entity_id && p.connected_input === input).forEach(unplug);
        const src = t.value && pieces.find((p) => p.entity_id === t.value);
        if (src) Object.assign(src, { connected_to: item.entity_id, connected_input: input });
      } else {
        pieces.filter((p) => p !== item && p.connected_to === item.entity_id).forEach(unplug);
        unplug(item); // older plans stored the receiver on the TV
        const feed = t.value && pieces.find((p) => p.entity_id === t.value);
        if (feed) Object.assign(feed, { connected_to: item.entity_id, connected_input: null });
      }
    }, { inspector: true });
  }

  // ---------- misc ----------

  // ---------- camera pop-ups ----------

  /**
   * A floodlight camera on the plan that starts detecting a person pops up its
   * live view; the pop-up closes itself a while after the person is gone.
   */
  _watchCameras() {
    if (!this._doc || !this._hass) return;
    const seen = this._cameraSeen || (this._cameraSeen = new Map());
    const primed = this._camerasPrimed; // nothing pops up for detections already going on at load
    this._camerasPrimed = true;
    for (const floor of this._doc.floors) {
      for (const f of floor.furniture || []) {
        if (!catalogItem(f.type).floodlight || domainOf(f.entity_id) !== "camera") continue;
        const now = cameraPersons(this._hass, f.entity_id).length > 0;
        const was = seen.get(f.entity_id) || false;
        seen.set(f.entity_id, now);
        if (now && !was && primed && !this._editing) this._openCameraPopup(f);
        this._cameraPopups?.get(f.entity_id)?.update(now);
      }
    }
    for (const p of this._cameraPopups?.values() || []) p.setHass(this._hass);
  }

  _openCameraPopup(f) {
    const popups = this._cameraPopups || (this._cameraPopups = new Map());
    const entityId = f.entity_id;
    if (popups.has(entityId)) return popups.get(entityId).update(true);
    let wrap = this.shadowRoot.querySelector(".campops");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "campops";
      (this._body || this.shadowRoot).appendChild(wrap);
    }
    const name = f.name || friendlyName(this._hass, entityId);
    const since = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const el = document.createElement("div");
    el.className = "campop";
    el.innerHTML = `<div class="hd"><span class="dot"></span>
        <span class="t"></span>
        <button data-act="light" title="${t("Floodlight on/off")}" hidden>${t("Light")}</button>
        <button data-act="live" title="${t("Show the live view")}" hidden>${t("Live")}</button>
        <button data-act="open" title="${t("Open camera")}">${t("Open")}</button>
        <button data-act="close" title="${t("Close")}" aria-label="${t("Close")}">✕</button></div>
      <div class="view"></div>`;
    const title = el.querySelector(".t");
    title.textContent = name;
    const sub = document.createElement("small");
    sub.textContent = t("Person detected · {time}", { time: since });
    title.appendChild(sub);
    const view = el.querySelector(".view");
    const openedAt = Date.now();
    let card = null;
    let picture = null; // event picture view, while the camera isn't streaming
    let closeTimer = null;
    const close = () => {
      clearTimeout(closeTimer);
      el.remove();
      popups.delete(entityId);
    };
    el.addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "close") close();
      if (act === "light") runTapAction(this, this._hass, entityId, "toggle");
      if (act === "live") showLive();
      if (act === "open") {
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
        close();
      }
    });
    // HA's own picture-entity card in live mode streams like the dashboards do
    // (HLS / WebRTC); outside HA, fall back to the MJPEG proxy
    const showLive = () => {
      picture = null;
      el.querySelector('[data-act="live"]').hidden = true;
      view.replaceChildren();
      const helpers = window.loadCardHelpers?.();
      if (!helpers) return view.appendChild(this._cameraImage(entityId));
      helpers.then((h) => {
        if (!el.isConnected || picture) return;
        card = h.createCardElement({ type: "picture-entity", entity: entityId, camera_view: "live", show_name: false, show_state: false });
        card.hass = this._hass;
        view.appendChild(card);
      }).catch(() => view.appendChild(this._cameraImage(entityId)));
    };
    // A camera that isn't streaming (Eufy and other battery cameras) only has an old
    // still image; show the picture it takes of the detection instead, once it arrives
    const eventImage = cameraEventImage(this._hass, entityId);
    if (eventImage && !cameraStreaming(this._hass.states[entityId])) {
      picture = this._cameraEventPicture(eventImage, openedAt);
      view.appendChild(picture.el);
      el.querySelector('[data-act="live"]').hidden = false;
    } else {
      showLive();
    }
    // Floodlight button: shown when the camera has one, highlighted while it's on
    const lightBtn = el.querySelector('[data-act="light"]');
    const syncLight = (hass) => {
      const flood = floodlightEntity(hass, entityId);
      lightBtn.hidden = !flood;
      const on = flood && hass.states[flood]?.state === "on";
      lightBtn.classList.toggle("on", !!on);
      lightBtn.textContent = on ? t("Light off") : t("Light on");
    };
    syncLight(this._hass);
    wrap.prepend(el);
    popups.set(entityId, {
      update: (detecting) => {
        el.classList.toggle("clear", !detecting);
        sub.textContent = detecting ? t("Person detected · {time}", { time: since }) : t("Person seen at {time}", { time: since });
        clearTimeout(closeTimer);
        if (!detecting) closeTimer = setTimeout(close, 30000);
      },
      setHass: (hass) => {
        if (card) card.hass = hass;
        if (picture && cameraStreaming(hass.states[entityId])) showLive(); // live video after all
        picture?.setHass(hass);
        syncLight(hass);
      },
    });
  }

  /**
   * A camera's event picture (an image entity) for a detection that started at
   * `since` (ms): waits for the picture of this detection rather than showing the
   * previous one, then follows each new picture. { el, setHass }.
   */
  _cameraEventPicture(imageId, since) {
    const el = document.createElement("div");
    el.className = "event-pic";
    el.innerHTML = `<img alt="" hidden><span class="when"></span><span class="wait">${t("Waiting for the camera's picture…")}</span>`;
    const img = el.querySelector("img");
    const when = el.querySelector(".when");
    const wait = el.querySelector(".wait");
    let shown = null;
    let gaveUp = false;
    const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const show = (hass) => {
      const st = hass.states[imageId];
      const taken = Date.parse(st?.state);
      const url = st?.attributes?.entity_picture;
      if (!url || Number.isNaN(taken)) return;
      // The picture of this detection, or (after waiting a while) the latest there is
      const fresh = taken >= since - 5000;
      if (!fresh && !gaveUp) return;
      if (shown === st.state) return;
      shown = st.state;
      img.src = `${url}${url.includes("?") ? "&" : "?"}t=${taken}`;
      img.hidden = false;
      img.alt = friendlyName(hass, imageId);
      wait.hidden = true;
      when.textContent = fresh ? t("Picture {time}", { time: time(taken) }) : t("Last picture {time} (no new one yet)", { time: time(taken) });
      el.classList.toggle("old", !fresh);
    };
    // No picture of this detection after 20 s: show the latest one, clearly marked
    setTimeout(() => {
      gaveUp = true;
      if (shown === null && this._hass) show(this._hass);
    }, 20000);
    show(this._hass);
    return { el, setHass: show };
  }

  _cameraImage(entityId) {
    const img = document.createElement("img");
    const token = this._hass.states[entityId]?.attributes?.access_token;
    img.src = `/api/camera_proxy_stream/${entityId}${token ? `?token=${token}` : ""}`;
    img.alt = friendlyName(this._hass, entityId);
    return img;
  }

  /** A new version of the panel was installed while this one is open. */
  _showUpdateNotice() {
    if (this.shadowRoot.querySelector(".update-notice")) return;
    const el = document.createElement("div");
    el.className = "toast update-notice";
    el.innerHTML = `${t("Floorplan Studio was updated.")} <button class="btn primary" style="margin-left:10px">${t("Reload")}</button>`;
    el.querySelector("button").addEventListener("click", async () => {
      await this._saveNow?.();
      location.reload();
    });
    (this._body || this.shadowRoot).appendChild(el);
  }

  _toast(msg) {
    this._toastEl?.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    (this._body || this.shadowRoot).appendChild(el);
    this._toastEl = el;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.remove(), 4000);
  }
}

/**
 * Furniture categories A–Z (by their name in the user's language), with the catch-all "Other"
 * last. Subcategories (Sonos under Multimedia) are left out, or with `subs` follow their parent.
 */
const sortedCategories = (subs = false) =>
  CATEGORIES.filter((c) => !SUBCATEGORIES[c])
    .sort((a, b) => (a === "Other") - (b === "Other") || t(a).localeCompare(t(b)))
    .flatMap((c) => (subs ? [c, ...subcategories(c)] : [c]));

/** The subcategories of a category, A–Z. */
const subcategories = (parent) =>
  CATEGORIES.filter((c) => SUBCATEGORIES[c] === parent).sort((a, b) => t(a).localeCompare(t(b)));

/** Catalog categories the user has unfolded (remembered per browser). */
function openCategories() {
  try {
    return new Set(JSON.parse(readPref("openCategories", "[]")));
  } catch (_e) {
    return new Set();
  }
}

/** Labels for an item's actions; on a camera with a floodlight, "toggle" switches the light. */
function actionLabel(hass, item, action) {
  if (action === "toggle" && floodlightEntity(hass, item.entity_id)) return t("Toggle floodlight");
  if (action === "more-info" && domainOf(item.entity_id) === "camera") return t("Open live view");
  return t({ ...DOUBLE_TAP_ACTIONS, "more-info": "Open more-info" }[action]);
}

function tapOptions(hass, item, current) {
  return ["more-info", "toggle", "none"]
    .map((a) => `<option value="${a}" ${current === a ? "selected" : ""}>${actionLabel(hass, item, a)}</option>`).join("");
}

/** Inspector dropdown for what a double-tap on a piece or marker does. */
function doubleTapField(item, hass) {
  const current = doubleTapAction(item);
  return `<div class="field"><label>${t("Double-tap action")}</label><select data-field="double_tap_action">
    ${Object.keys(DOUBLE_TAP_ACTIONS).map((a) => `<option value="${a}" ${current === a ? "selected" : ""}>${actionLabel(hass, item, a)}</option>`).join("")}
  </select></div>`;
}

// A newer version loaded into a page that still runs the old one (HA restarted
// while the panel was open): keep the old one and tell it a reload is needed
if (!customElements.get("floorplan-studio-panel")) customElements.define("floorplan-studio-panel", FloorplanStudioPanel);
else window.dispatchEvent(new CustomEvent("fps-update-available"));
