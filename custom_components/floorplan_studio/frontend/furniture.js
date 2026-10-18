// Furniture catalog. Each piece is a list of parts shared by the 2D symbol and
// the 3D model, so both stay consistent when a piece is resized.
//
// Part: [shape, x0, y0, x1, y1, z0, z1, colour]
//   shape   "box" | "cyl" | "sphere"
//   x0..x1  fraction of the width (left -> right)
//   y0..y1  fraction of the depth (back -> front; the front faces +y on the plan)
//   z0..z1  fraction of the height (may exceed 1, e.g. a headboard)
//   colour  key from COLORS, or "main" / "main2" / "main3" (the piece's own colour,
//           lighter / slightly darker).
//           "screen" (dark) and "canvas" (white) light up when the linked entity is
//           on/playing, for pieces marked `screen: true`.
//
// Optional 9th part element: "spin" (rotates while a linked fan is on), "solid" (a
// closed lamp shade, e.g. a flush ceiling light; shades are open by default) or, for
// cylinders, "front" (lying with its face forward: a knob, a dial). "drum" and "load"
// (cylinders and spheres facing forward too): a washing machine's drum and the laundry
// in it, turning around the catalog item's `drum: { x, z }` point while it runs.
//
// `screenLight: { y, z }`: a big screen that lights up the room when on (light
// source at that point of the piece, shining forward).
//
// `art: true` (Samsung The Frame): the screen shows a painting whenever it isn't
// showing TV (Art Mode).
//
// `display: "NAD"` (AV receivers): while on, the screen shows the linked media
// player's input and volume, like the front-panel display.
//
// `av`: how a piece is wired, by its HDMI ports. Connections are stored on the device
// whose output they are: `connected_to` (entity it plugs into) and, for a receiver,
// `connected_input` (the receiver's input).
//   "source"   (Apple TV, console): one output, into a receiver input or a TV
//   "receiver" (AV receiver): inputs (its source list) and one output to a TV
//   "display"  (TV, projector): one input; its screen shows what comes in
//
// `laundry: "washer" | "dryer"`: linked to its status sensor (Home Connect: "run"), the
// drum turns behind the door glass while a programme runs, tumbling back and forth; a
// washing machine's final spin is fast and shakes the machine. The plan shows a turning
// drum with the programme's progress around it.
//
// `tilt: { pivot }` (directional spots): the parts below `pivot` (share of the height) tilt
// forward by the piece's `tilt` (degrees from straight down), and so does its light; the
// piece's rotation turns it to where it points.
//
// `robot: true` (robot vacuum): linked to a vacuum entity, it drives lanes through the
// room being cleaned and goes back to its place on the plan (the dock) afterwards.
// `robot: "mower"` (robot lawn mower): linked to a lawn mower entity, it mows the outdoor
// area its place on the plan (the charging station) is in, in random straight lines that
// turn at the edge, as Gardena's mowers do, and drives back home afterwards.
//
// `speaker: true` (Sonos speakers, soundbars): makes sound itself; shows sound waves
// while its media player plays. Only speakers (these and `passive` ones) show waves.
//
// `homeTheater: true` (Sonos soundbars) and `surround: true` (speakers Sonos can bond to
// one as rear surrounds): a surround piece with `surround` set is linked to the
// soundbar's player (bonded surrounds have no entity of their own) and shows sound waves
// while the soundbar plays and surround is on; softer ones for music (ambient level).
//
// `passive: true` (wired speakers): linked to the amplifier or receiver they're
// connected to; they show sound waves while it plays, or while an amplifier that
// only reports on/off is on and not muted.
//
// `ambilight: true`: coloured light on the wall behind the piece while it's on
// (cycling colours, or the colour of a linked light entity).
//
// `floodlight: { angle, range }`: the camera has a floodlight (a light or switch of
// the same device); while it's on, the plan shows its beam and the 3D view lights
// the ground in front. A person it detects pops up its live view.
//
// `fov: { angle, range }`: a camera; the plan shows its field of view (degrees,
// metres) in front of the piece, and the piece lights up red while a motion or
// person sensor of the same device is on.
//
// `hole: true`: not a piece but an opening in the floor (stairwell, vide); the
// 3D view cuts it out of the floor slabs, the plan draws the usual crossed box.
//
// Catalog options: `ceiling: true` hangs the piece from the floor's ceiling (its
// height is the drop length); `light: { z, x?, y?, angle, beam?, up?, power? }` places the
// light source (fractions of the piece) and shapes its spotlight (`power`: light output
// compared to a typical lamp, e.g. 0.35 for a small one; `all`: glows all round, like a
// frosted globe, instead of shining in one direction; `aim: [y, z]`: the direction it
// shines in, along the piece's depth (-1 = out of its back) and up, so it turns with the
// piece; `soft`: a frosted face, brightest straight ahead and fading out all the way to
// the sides, instead of a lamp's cone with an edge; keep its `angle` at about 1.25 or
// less: in a wider shadow map, shadows near its edge come and go with small moves); `z`
// is the default height of
// the surface a piece stands on. `lens`: radius of a spot's lens (share of its width): its beam comes
// out of the whole lens, from inside the spot.
//
// Items that stand on a desk or TV unit start their parts part-way up (e.g. a
// monitor's parts begin at 0.75 m), so they sit at the right height when placed
// on top of that furniture.
import { clone, consolePlaying, domainOf, foregroundApp, friendlyName, isPlaying, isScreenOn, isSounding, safeColor, subLevel, surroundLevel, uid } from "./model.js";
import { t } from "./i18n.js";

const SONOS_BLACK = "#232325";
/** Rounded rectangle outline for a `profile` part (shares of its depth and height, radius in metres). */
const roundRect = (u0, v0, u1, v1, r) => [[u0, v0, r], [u1, v0, r], [u1, v1, r], [u0, v1, r]];
const HUE_WHITE = "#f4f4f1";
const TOGO = "#9c6b45"; // cognac leather
const HUE_BLACK = "#2a2b2d";
const FENCE_WOOD = "#8b6b4a";

export const COLORS = {
  wood: "#a77b52",
  darkwood: "#6e4d32",
  dark: "#3d3f44",
  gloss: "#0e0f11", // glossy black plastic (end caps)
  chrome: "#d3d6da", // polished metal trim (washing machine door ring, program knob)
  smoke: "#24272c", // smoked glass (washing machine door), see-through in 3D
  drum: "#aeb4ba", // stainless steel washing machine drum
  laundry_blue: "#3c64a8",
  laundry_red: "#b8453c",
  laundry_white: "#e6e1d6",
  led: "#3d8bff", // blue indicator light
  gardena: "#14a5ab", // Gardena turquoise
  stop: "#ff6a12", // a robot mower's orange STOP button
  rubber: "#26282a", // tyres
  fabric: "#1c1d20", // black speaker cloth
  grille: "#36383c", // perforated speaker grille (drawn with a hole pattern in 3D)
  metal: "#9aa0a6",
  brass: "#c9a24a",
  white: "#f1f1ee",
  light: "#dedad2",
  shade: "#efe2c4",
  plant: "#5f9a52",
  glass: "#a9d4f5",
  screen: "#1f2226",
  canvas: "#f4f4f2",
  terracotta: "#c96f4a",
  concrete: "#b9b6ae",
  marble: "#e9e6e0",
  graphite: "#3a3c3f",
  woofer: "#7a4a2e",
  flag_red: "#ae1c28",
  flag_white: "#f4f4f4",
  flag_blue: "#21468b",
  leaf: "#4f8a3c",
  leaf_dark: "#36652b",
  leaf_grey: "#7d8e66",
  leaf_grey_dark: "#5f7050",
  palm_leaf: "#5b8f3a",
  rose_red: "#c0283f",
  rose_pink: "#e98aa8",
  rose_red_light: "#e2485e",
  rose_pink_light: "#f6b9cc",
  lavender: "#8e7cc3",
  soil: "#4b3828",
  trunk: "#7a5a3c",
  planter: "#55595e",
};

const box = (x0, y0, x1, y1, z0, z1, c, flag) => ["box", x0, y0, x1, y1, z0, z1, c, flag];
const cyl = (x0, y0, x1, y1, z0, z1, c, flag) => ["cyl", x0, y0, x1, y1, z0, z1, c, flag];
const ball = (x0, y0, x1, y1, z0, z1, c) => ["sphere", x0, y0, x1, y1, z0, z1, c];
// Round shade turned from a profile: [[r, z], ...] with r a share of the radius and z of
// the part's height (0 = bottom, 1 = top). Open at the ends, visible from both sides.
const lathe = (x0, y0, x1, y1, z0, z1, c, profile) => ["lathe", x0, y0, x1, y1, z0, z1, c, profile];
// Smooth tube along a curve through `points` ([x, z] as shares of the piece's width and
// height, in its middle plane), `radius` in metres: an arc lamp's arm, a railing…
const tube = (c, points, radius = 0.015) => ["tube", 0, 0.5, 1, 0.5, 0, 1, c, { points, radius }];
// Long part with a shaped cross-section, pushed out along the piece's width (a soundbar's
// body): `points` outline it as [y, z] shares of the part's depth and height (0 = back,
// bottom), with an optional third value rounding that corner by so many metres. `bevel`
// (metres) rounds the edges of its ends.
const profile = (x0, y0, x1, y1, z0, z1, c, points, bevel = 0) => ["profile", x0, y0, x1, y1, z0, z1, c, { points, bevel }];
// Part with a shaped footprint, raised from z0 to z1 (a rounded speaker, a triangular one):
// `points` outline it as [x, y] shares of the part's width and depth (0 = left, back), with an
// optional third value rounding that corner by so many metres; `bevel` (metres) rounds its top
// and bottom edges, `holes` are outlines cut out of it.
const plan = (x0, y0, x1, y1, z0, z1, c, points, { bevel = 0, holes = [] } = {}) => ["plan", x0, y0, x1, y1, z0, z1, c, { points, bevel, holes }];
// The same with the outline seen from the front ([x, z] shares of width and height), pushed
// from back to front: a subwoofer with a tunnel through it.
const front = (x0, y0, x1, y1, z0, z1, c, points, { bevel = 0, holes = [] } = {}) => ["front", x0, y0, x1, y1, z0, z1, c, { points, bevel, holes }];
// Outlines for `plan`: a slice of a circle beyond a chord (`side` -1 left, 1 right; `from`
// the chord's distance from the centre as a share of the radius), and an hourglass (pinched
// in the middle by `pinch`, its ends rounded).
const circleSlice = (side, from, n = 18) => {
  const a = Math.acos(from);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = -a + (2 * a * i) / n;
    return [0.5 + 0.5 * side * Math.cos(t), 0.5 + 0.5 * Math.sin(t)];
  });
};
const hourglass = (pinch, n = 24) => {
  const half = (u) => 0.5 * (1 - pinch * Math.sin(Math.PI * u) ** 2) * (1 - Math.abs(2 * u - 1) ** 5) ** 0.2;
  const us = Array.from({ length: n + 1 }, (_, i) => 0.5 - 0.5 * Math.cos((Math.PI * i) / n)); // denser at the ends
  return [...us.map((u) => [u, 0.5 + half(u)]), ...us.slice(1, -1).reverse().map((u) => [u, 0.5 - half(u)])];
};

/**
 * Robot lawn mower: a rounded shell, narrower at the nose (+y), over a dark chassis, big drive
 * wheels at the back and small castor wheels at the front, a control lid on top with the
 * orange STOP button. `accent`: a stripe round the shell (Gardena's turquoise).
 */
function robotMower({ accent = "main3" } = {}) {
  const shell = [[0.08, 0, 0.06], [0.92, 0, 0.06], [1, 0.55, 0.12], [0.82, 1, 0.1], [0.18, 1, 0.1], [0, 0.55, 0.12]];
  return [
    plan(0.06, 0.04, 0.94, 0.96, 0.08, 0.45, "main3", shell, { bevel: 0.01 }),
    plan(0.03, 0.01, 0.97, 0.99, 0.38, 0.46, accent, shell, { bevel: 0.006 }),
    plan(0.04, 0.02, 0.96, 0.98, 0.42, 0.97, "main", shell, { bevel: 0.05 }),
    cyl(-0.02, 0.1, 0.1, 0.42, 0, 0.62, "rubber", "side"), cyl(0.9, 0.1, 1.02, 0.42, 0, 0.62, "rubber", "side"),
    cyl(0.2, 0.8, 0.27, 0.92, 0, 0.3, "rubber", "side"), cyl(0.73, 0.8, 0.8, 0.92, 0, 0.3, "rubber", "side"),
    plan(0.3, 0.36, 0.7, 0.66, 0.95, 1, "dark", roundRect(0, 0, 1, 1, 0.03), { bevel: 0.006 }),
    cyl(0.44, 0.7, 0.56, 0.78, 0.96, 1.04, "stop"),
  ];
}

/** Arc floor lamp: marble base, a steel arch curving over, and a shade at its end. */
function arcLamp(globe) {
  const arch = [[0.12, 0.03], [0.12, 0.42], [0.16, 0.74], [0.29, 0.93], [0.48, 1.0], [0.68, 0.97], [0.82, 0.9], [0.86, 0.86]];
  const shade = globe
    ? [cyl(0.845, 0.47, 0.875, 0.53, 0.83, 0.87, "main"), ball(0.76, 0.1, 0.96, 0.9, 0.68, 0.84, "shade")]
    : [cyl(0.855, 0.485, 0.865, 0.515, 0.8, 0.87, "dark"),
      lathe(0.74, 0.05, 0.98, 0.95, 0.69, 0.81, "main", [[1, 0], [0.96, 0.25], [0.82, 0.55], [0.55, 0.82], [0.22, 0.97], [0.06, 1]]),
      lathe(0.745, 0.07, 0.975, 0.93, 0.69, 0.8, "shade", [[0.95, 0], [0.9, 0.25], [0.76, 0.55], [0.5, 0.82], [0.2, 0.97], [0.05, 1]])];
  return [box(0.02, 0.15, 0.22, 0.85, 0, 0.035, "marble"), tube("main", arch, 0.014), ...shade];
}

/**
 * A pendant: canopy at the ceiling, a cord down to the shade, and a shade turned from
 * `profile` (z from `shade` up). Outside in the piece's colour, the inside glows.
 */
function pendantShade(profile, shade = 0.35) {
  const inner = profile.map(([r, z]) => [r * 0.95, Math.max(0, z - 0.02)]);
  return [
    cyl(0.4, 0.4, 0.6, 0.6, 0.975, 1, "main"), // canopy
    cyl(0.495, 0.495, 0.505, 0.505, shade * 0.95, 0.975, "dark"), // cord
    lathe(0, 0, 1, 1, 0, shade, "main", profile),
    lathe(0, 0, 1, 1, 0, shade, "shade", inner),
  ];
}
/**
 * A closed globe shade with a round opening at the bottom (`opening`: its radius as a
 * fraction of the globe's), on a cord; `shade` is the globe's height (fraction of the
 * piece). The outside is the piece's colour; only the inside lights up.
 */
function metalGlobe(shade, opening) {
  const start = Math.asin(opening);
  const top = Math.PI; // closed at the top (the cord goes into the metal)
  const profile = [];
  for (let i = 0; i <= 16; i++) {
    const phi = start + ((top - start) * i) / 16;
    profile.push([Math.sin(phi), (1 - Math.cos(phi)) / 2]);
  }
  // The lit inside stays within the globe (stopping short of the cord hole at the top)
  const inner = profile.filter((_, i) => i <= 13).map(([r, z]) => [r * 0.94, z]);
  return [
    // The lit inside first: on the plan (seen from above) the metal outside covers it
    lathe(0, 0, 1, 1, 0, shade, "shade", inner),
    lathe(0, 0, 1, 1, 0, shade, "main", profile),
    cyl(0.495, 0.495, 0.505, 0.505, shade * 0.98, 0.975, "dark"), // cord
    cyl(0.4, 0.4, 0.6, 0.6, 0.975, 1, "main"), // canopy
  ];
}

/**
 * Hue Play light bar: a pill-shaped black housing with a frosted face inside a thin rim.
 * Lying flat the face is on top; standing, the bar rises from a round foot with its face
 * at the back (y = 0 side) and the bracket behind it.
 */
function hueBar(standing) {
  if (!standing) {
    // 0.254 x 0.036 x 0.043 m: round ends (d / w = 0.142 of the length), face on top
    const e = 0.142;
    return [
      box(e / 2, 0, 1 - e / 2, 1, 0, 0.9, "main"), cyl(0, 0, e, 1, 0, 0.9, "main"), cyl(1 - e, 0, 1, 1, 0, 0.9, "main"),
      box(e / 2, 0.06, 1 - e / 2, 0.94, 0.86, 1, "shade", "solid"),
      cyl(0.008, 0.06, e - 0.008, 0.94, 0.86, 1, "shade", "solid"), cyl(1 - e + 0.008, 0.06, 0.992, 0.94, 0.86, 1, "shade", "solid"),
    ];
  }
  // 0.079 x 0.079 x 0.3 m: foot, bracket, and the bar (0.036 wide, 0.043 deep, 0.254 tall)
  const [x0, x1, y0, y1, z0, z1] = [0.272, 0.728, 0.228, 0.772, 0.1, 0.947];
  const cap = 0.12; // the bar's round ends (its width, as a share of the height)
  return [
    cyl(0, 0, 1, 1, 0, 0.04, "main"), // round foot
    box(0.4, 0.62, 0.6, 0.9, 0.04, 0.2, "main"), // bracket behind the bar
    box(x0, y0 + 0.06, x1, y1, z0 + cap / 2, z1 - cap / 2, "main"),
    cyl(x0, y0 + 0.06, x1, y1, z0, z0 + cap, "main", "front"), cyl(x0, y0 + 0.06, x1, y1, z1 - cap, z1, "main", "front"),
    // frosted face towards the wall
    box(x0 + 0.03, y0, x1 - 0.03, y0 + 0.07, z0 + cap / 2, z1 - cap / 2, "shade", "solid"),
    cyl(x0 + 0.03, y0, x1 - 0.03, y0 + 0.07, z0 + 0.012, z0 + cap - 0.012, "shade", "front"),
    cyl(x0 + 0.03, y0, x1 - 0.03, y0 + 0.07, z1 - cap + 0.012, z1 - 0.012, "shade", "front"),
  ];
}

/**
 * Front-loading washing machine or dryer in the Siemens iQ500 style (60 x 63 x 85 cm):
 * a top panel with a drawer on the left (detergent; the dryer's water tank), a chrome
 * program knob with a blue LED ring and a black display on the right, a black strip of
 * touch keys below it, and a round door with a chrome ring and smoked glass. The washing
 * machine has a round service flap at the bottom right, the dryer a ventilation flap.
 */
function laundryFront(dryer) {
  // Circle on the front: centre (cx, cz) as shares of width/height, diameter in metres
  const W = 0.598, H = 0.848, D = 0.632;
  const disc = (cx, cz, dia, y0, y1, key, flag = "front") => {
    const [rx, rz] = [dia / W / 2, dia / H / 2];
    return cyl(cx - rx, y0, cx + rx, y1, cz - rz, cz + rz, key, flag);
  };
  const out = (m) => 1 + m / D; // depth share for m metres in front of the face
  const doorZ = dryer ? 0.55 : 0.53;
  const doorD = dryer ? 0.46 : 0.49;
  const parts = [
    box(0, 0, 1, 1, 0.012, 1, "main"),
    // feet
    ...[[0.03, 0.03], [0.93, 0.03], [0.03, 0.9], [0.93, 0.9]].map(([x, y]) => box(x, y, x + 0.04, y + 0.06, 0, 0.012, "dark")),
    // top panel: drawer with its grip, knob with LED ring, display, strip of touch keys
    box(0.06, 0.99, dryer ? 0.42 : 0.37, out(0.006), 0.875, 0.965, "main"),
    box(0.1, 0.995, dryer ? 0.38 : 0.33, out(0.007), 0.875, 0.888, "light"),
    disc(0.5, 0.925, 0.072, 0.99, out(0.006), "led"),
    disc(0.5, 0.925, 0.062, 0.99, out(0.028), "chrome"),
    box(0.72, 0.99, 0.95, out(0.004), 0.87, 0.975, "screen"),
    box(0.03, 0.99, 0.97, out(0.003), 0.84, 0.856, "gloss"),
    // door: chrome ring, black frame, smoked glass bulging out
    disc(0.5, doorZ, doorD, 0.98, out(0.03), "chrome"),
    disc(0.5, doorZ, doorD - 0.024, 0.98, out(0.038), "gloss"),
    disc(0.5, doorZ, doorD - 0.13, 0.98, out(0.05), "smoke"),
    // seen through the glass: the drum with its three lifters, and the laundry in it
    disc(0.5, doorZ, doorD - 0.15, out(0.038), out(0.04), "drum", "drum"),
    ...[90, 210, 330].map((deg) => {
      const [x, z] = [0.5 + (Math.cos((deg * Math.PI) / 180) * 0.12) / W, doorZ + (Math.sin((deg * Math.PI) / 180) * 0.12) / H];
      return disc(x, z, 0.035, out(0.04), out(0.044), "light", "drum");
    }),
    ...[[-0.05, -0.08, 0.13, "laundry_blue"], [0.06, -0.07, 0.12, "laundry_white"], [0, -0.03, 0.1, "laundry_red"]]
      .map(([dx, dz, dia, key]) => ["sphere", 0.5 + dx / W - dia / W / 2, out(0.04), 0.5 + dx / W + dia / W / 2, out(0.047),
        doorZ + dz / H - dia / H / 2, doorZ + dz / H + dia / H / 2, key, "load"]),
  ];
  if (dryer) {
    // ventilation flap: two rows of long, narrow slots
    parts.push(box(0.06, 0.99, 0.94, out(0.004), 0.03, 0.16, "light"));
    for (const z of [0.07, 0.11]) parts.push(box(0.12, 0.995, 0.88, out(0.005), z, z + 0.012, "dark"));
  } else {
    parts.push(disc(0.83, 0.11, 0.145, 0.99, out(0.003), "light")); // service flap
  }
  return parts;
}

/**
 * Ligne Roset Togo (Michel Ducaroy, 1973): no frame or legs, only pleated foam. Seen from
 * the side it is a stack of soft rolls: a low seat (38 cm) with a rounded nose, and a
 * backrest that narrows as it rises to 70 cm. `arms`: lower rolls at both ends (the
 * sofa); `corner`: a second backrest along the left side; `ottoman`: just the seat.
 */
function togo(w, { arms = false, corner = false, ottoman = false } = {}) {
  const [D, H] = ottoman ? [0.8, 0.34] : [1.02, 0.7];
  // One roll: x and y ranges and height in metres; fully rounded, ends too, so the
  // rolls meet in deep creases like the pleats
  const roll = (x0, x1, y0, y1, z0, z1) => {
    const r = (z1 - z0) / 2 - 0.004;
    return profile(x0 / w, 0, x1 / w, 1, 0, 1, "main", roundRect(y0 / D, z0 / H, y1 / D, z1 / H, r), r * 0.8);
  };
  if (ottoman) {
    return [roll(0.02, w - 0.02, 0.03, 0.77, 0, 0.12), roll(0, w, 0, 0.8, 0.1, 0.23), roll(0.01, w - 0.01, 0.01, 0.79, 0.21, 0.34)];
  }
  // backrest: rolls stepping back as they rise, the top one curling over
  const back = [[0, 0.56, 0.27, 0.43], [0.02, 0.47, 0.41, 0.54], [0.04, 0.38, 0.52, 0.63], [0.07, 0.3, 0.61, 0.7]];
  const [sx0, sx1] = [corner ? 0.3 : arms ? 0.16 : 0, arms ? w - 0.16 : w];
  const parts = [
    roll(0, w, 0, 0.5, 0, 0.29), // base under the backrest
    // seat: the top roll bulges out over the lower ones into a round nose
    ...[[0.3, 0.95, 0, 0.12], [0.32, 0.99, 0.1, 0.23], [0.36, 1.02, 0.21, 0.38]]
      .map(([y0, y1, z0, z1]) => roll(sx0, sx1, y0, y1, z0, z1)),
    ...back.map(([y0, y1, z0, z1]) => roll(corner ? y0 : 0.01, w - 0.01, y0, y1, z0, z1)),
  ];
  if (corner) {
    // the backrest turns the corner: the same rolls, running front to back along the left
    parts.push(roll(0, 0.5, 0, 0.97, 0, 0.29));
    for (const [x0, x1, z0, z1] of back) parts.push(roll(x0, x1, x0, 0.99 - x0 / 2, z0, z1));
  }
  if (arms) {
    for (const [x0, x1] of [[0, 0.2], [w - 0.2, w]]) {
      parts.push(roll(x0 + 0.01, x1 - 0.01, 0.02, 0.97, 0, 0.17), roll(x0, x1, 0.02, 1, 0.15, 0.33),
        roll(x0 + 0.01, x1 - 0.01, 0.04, 0.97, 0.31, 0.48));
    }
  }
  return parts;
}

// Curved band (annular sector) of the ellipse fitted in x0..y1, which may extend
// beyond the piece. opts: { inner, outer } as fractions of the radius, and
// { start, end } angles in degrees (0 = right, 90 = front, 180 = left, 270 = back).
const arc = (x0, y0, x1, y1, z0, z1, c, opts) => ["arc", x0, y0, x1, y1, z0, z1, c, opts];

/** Four slim round legs, inset from the corners (fractions of the piece). */
const roundLegs = (i, s, z1, c) => [
  cyl(i, i, i + s, i + s, 0, z1, c), cyl(1 - i - s, i, 1 - i, i + s, 0, z1, c),
  cyl(i, 1 - i - s, i + s, 1 - i, 0, z1, c), cyl(1 - i - s, 1 - i - s, 1 - i, 1 - i, 0, z1, c),
];

/** Wall-mounted TV: slim panel on a bracket; its back goes against the wall. */
const wallTv = (extra) => ({ icon: "mdi:television", cat: "Multimedia", av: "display", w: 1.45, d: 0.07, h: 0.84, z: 1.0, color: COLORS.dark, screen: true,
  screenLight: { y: 1, z: 0.5 }, ...extra, parts: [
    box(0.3, 0, 0.7, 0.45, 0.3, 0.7, "dark"), box(0, 0.4, 1, 0.85, 0, 1, "main"), box(0.008, 0.85, 0.992, 1, 0.014, 0.986, "screen")] });

/** L-shaped lounge sofa; the chaise (lounge part) is on the right, or mirrored on the left. */
function cornerSofa(chaiseLeft) {
  const b = (x0, y0, x1, y1, z0, z1, c) => (chaiseLeft ? box(1 - x1, y0, 1 - x0, y1, z0, z1, c) : box(x0, y0, x1, y1, z0, z1, c));
  // 2.9 x 1.75 m: seat 0.9 m deep along the back, chaise 0.95 m wide down one side
  const seatY = 0.6; // front of the straight part (fraction of the depth)
  const cx = 0.66; // where the chaise starts
  return { label: `L-shaped lounge sofa (chaise ${chaiseLeft ? "left" : "right"})`, icon: "mdi:sofa-outline", cat: "Living",
    w: 2.9, d: 1.75, h: 0.85, color: "#7d8a9c", parts: [
      b(0, 0, 1, 0.14, 0, 1, "main"), // back
      b(0, 0.14, cx, seatY, 0, 0.5, "main"), b(cx, 0.14, 1, 1, 0, 0.5, "main"), // seat bases
      b(0, 0.14, 0.07, seatY, 0, 0.7, "main"), b(0.96, 0.14, 1, 1, 0, 0.7, "main"), // arms (the chaise end stays open)
      b(0.075, 0.15, 0.95, 0.27, 0.5, 0.9, "main2"), // back cushions
      b(0.075, 0.27, 0.365, seatY - 0.01, 0.5, 0.62, "main2"), b(0.37, 0.27, cx - 0.005, seatY - 0.01, 0.5, 0.62, "main2"),
      b(cx, 0.27, 0.955, 0.99, 0.5, 0.62, "main2")] }; // seat cushions + chaise
}

// Staircases reach the next floor: wall height (2.6 m) + floor spacing (0.2 m)
const STAIR_H = 2.8;

/** Straight staircase: solid steps rising towards the back; you start at the front. */
function straightStairs(n = 15) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const [y0, y1, top] = [1 - (i + 1) / n, 1 - i / n, (i + 1) / n];
    parts.push(box(0, y0, 1, y1, 0, top - 0.012, "main"), box(0, y0, 1, y1 + 0.01, top - 0.012, top, "main2"));
  }
  return parts;
}

/**
 * Quarter-turn staircase: up along the right side from the front, a landing in
 * the back-right corner, then up to the left along the back.
 */
function quarterTurnStairs(n = 15) {
  const parts = [];
  const step = (x0, y0, x1, y1, i) => {
    const top = i / n;
    parts.push(box(x0, y0, x1, y1, 0, top - 0.012, "main"), box(x0, y0, x1, y1, top - 0.012, top, "main2"));
  };
  const [split, lx, ly] = [7, 0.53, 0.375]; // steps before the landing; flight width as fractions
  for (let i = 1; i <= split; i++) step(lx, 1 - (i * (1 - ly)) / split, 1, 1 - ((i - 1) * (1 - ly)) / split, i);
  step(lx, 0, 1, ly, split + 1); // landing
  const rest = n - split - 1;
  for (let i = 1; i <= rest; i++) step(lx - (i * lx) / rest, 0, lx - ((i - 1) * lx) / rest, ly, split + 1 + i);
  return parts;
}

/** Spiral staircase: wedge-shaped treads around a central pole, turning 330°. */
function spiralStairs(n = 15) {
  const sweep = 330 / n;
  const parts = [cyl(0.44, 0.44, 0.56, 0.56, 0, 1, "metal")];
  for (let i = 0; i < n; i++) {
    const top = (i + 1) / n;
    parts.push(arc(0, 0, 1, 1, top - 0.015, top, "main", { inner: 0.1, start: 90 + i * sweep, end: 90 + (i + 1) * sweep + 2 }));
  }
  return parts;
}

/** Upholstered dining chairs with a bit more luxury (seat faces the front, +y). */
// Radiators (`heater: true`): glow warm while the linked climate entity is heating,
// or while a linked switch / valve is on.
/** Flat double-panel radiator with vertical channels, top grille and valve. */
function panelRadiator() {
  const ribs = [];
  for (let i = 1; i < 20; i++) ribs.push(box(i / 20 - 0.004, 1, i / 20 + 0.004, 1.03, 0.04, 0.96, "main3"));
  return [box(0, 0.05, 1, 0.45, 0, 1, "main"), box(0, 0.55, 1, 1, 0, 1, "main"), box(0.01, 0.06, 0.99, 0.99, 0.97, 1, "main3"), ...ribs,
    cyl(0.95, 0.35, 0.99, 0.65, -0.22, 0, "metal"), cyl(0.94, 0.2, 1, 0.8, -0.4, -0.22, "main2")];
}
/** Classic cast-iron style: a row of round columns joined top and bottom, on feet. */
function columnRadiator(n) {
  const cols = [];
  for (let i = 0; i < n; i++) {
    const x0 = i / n + 0.12 / n;
    const x1 = (i + 1) / n - 0.12 / n;
    cols.push(cyl(x0, 0, x1, 0.45, 0.05, 0.95, "main"), cyl(x0, 0.55, x1, 1, 0.05, 0.95, "main"));
  }
  return [...cols, box(0, 0.2, 1, 0.8, 0.86, 0.94, "main"), box(0, 0.2, 1, 0.8, 0.06, 0.14, "main"),
    box(0.03, 0.3, 0.08, 0.7, -0.2, 0.06, "main"), box(0.92, 0.3, 0.97, 0.7, -0.2, 0.06, "main"),
    cyl(1, 0.35, 1.04, 0.65, 0.03, 0.12, "metal")];
}
/** Tall designer radiator: vertical flat tubes between two headers. */
function verticalRadiator(n) {
  const tubes = [];
  for (let i = 0; i < n; i++) tubes.push(box(i / n + 0.02, 0.2, (i + 1) / n - 0.02, 1, 0.02, 0.98, "main"));
  return [...tubes, box(0, 0, 1, 0.8, 0, 0.03, "main"), box(0, 0, 1, 0.8, 0.97, 1, "main"),
    cyl(0.08, 0.3, 0.18, 0.7, -0.08, 0, "metal")];
}
/** Bathroom ladder: two side rails with round bars, in groups so towels fit between. */
function towelRadiator(n) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const z = 0.05 + (i + Math.floor(i / 3) * 0.6) * (0.9 / (n - 1 + Math.floor((n - 1) / 3) * 0.6));
    bars.push(box(0.08, 0.3, 0.92, 0.8, z, z + 0.025, "main"));
  }
  return [box(0, 0, 0.08, 1, 0, 1, "main"), box(0.92, 0, 1, 1, 0, 1, "main"), ...bars,
    cyl(0.02, 0.3, 0.06, 0.7, -0.12, 0, "metal"), cyl(0.94, 0.3, 0.98, 0.7, -0.12, 0, "metal")];
}
/** Convector set into the floor: a slotted grille flush with the floor. */
function trenchConvector(n) {
  const slats = [];
  for (let i = 0; i < n; i++) slats.push(box(0.02 + (i + 0.25) * (0.96 / n), 0.12, 0.02 + (i + 0.75) * (0.96 / n), 0.88, 0, 1, "main2"));
  return [box(0, 0, 1, 1, 0, 0.5, "dark"), box(0, 0, 1, 0.1, 0, 1, "main"), box(0, 0.9, 1, 1, 0, 1, "main"), ...slats];
}

/** Fence panel of vertical boards with two rails at the back; `base` (m-fraction of
 * the height) leaves room for a concrete base board underneath. */
function boardFence(n, base = 0) {
  const boards = [];
  for (let i = 0; i < n; i++) boards.push(box(i / n + 0.003, 0.3, (i + 1) / n - 0.003, 1, base + 0.01, 1, i % 3 === 1 ? "main2" : "main"));
  return [...boards, box(0, 0, 1, 0.3, base + 0.12, base + 0.17, "main3"), box(0, 0, 1, 0.3, 0.82, 0.87, "main3")];
}
/** Modern fence of horizontal slats with small gaps, framed by end battens. */
function slatFence(n) {
  const slats = [];
  for (let i = 0; i < n; i++) slats.push(box(0.01, 0.2, 0.99, 0.8, i / n + 0.006, (i + 1) / n - 0.006, i % 4 === 2 ? "main2" : "main"));
  return [...slats, box(0, 0.1, 0.012, 0.9, 0, 1, "main3"), box(0.988, 0.1, 1, 0.9, 0, 1, "main3")];
}

/**
 * Flagpole with a flag. `w` is the piece width in metres (the pole stands at its
 * left). The flag is one smooth "cloth" part (see clothPoint): flying, it streams
 * out to the right and ripples; limp, it hangs down along the pole in soft folds.
 * Stripes top to bottom (Dutch flag by default).
 */
function flagpole(w, limp, stripes = ["flag_red", "flag_white", "flag_blue"]) {
  const p = 0.065 / w; // pole width as a fraction of the piece
  return [
    box(0, 0.3, p * 2.2, 0.7, 0, 0.012, "concrete"), // ground sleeve
    cyl(0.003, 0.4, p, 0.6, 0, 0.985, "main"),
    ball(0, 0.36, p * 1.1, 0.64, 0.98, 1, "brass"), // finial
    limp
      ? ["cloth", p, 0, 1, 1, 1 - 2.4 / 6, 0.975, null, { limp: true, stripes, pieceW: w, pieceD: 0.3, pieceH: 6 }]
      : ["cloth", p, 0, 1, 1, 0.8, 0.97, null, { limp: false, stripes }],
  ];
}

/**
 * A point on a cloth part, as fractions of the piece: s runs from the pole (0) to
 * the free edge (1), t from the top (0) down (1). Flying: a travelling ripple that
 * grows towards the free end, which also sags a little. Limp: hanging folds that
 * deepen towards the bottom, the free edge hanging lowest.
 */
export function clothPoint(part, s, t) {
  const [, x0, y0, x1, y1, z0, z1, , opts] = part;
  const yc = (y0 + y1) / 2;
  const half = (y1 - y0) / 2;
  if (opts?.limp) {
    // Hanging from its hoist, which is tied along the pole (s: from the pole to the
    // free end, t: from the top stripe down). Each strip of cloth leaves the pole
    // slanting down and soon hangs straight, so the stripes start out diagonal and
    // turn vertical; soft folds run along the drape and deepen towards the free end.
    const { pieceW = 0.4, pieceD = 0.3, pieceH = 6, length = 1.5, hoist = 1.0 } = opts;
    let dx = 0;
    let dz = 0;
    const n = 12;
    for (let k = 0; k < n; k++) {
      const along = ((k + 0.5) / n) * s;
      const angle = 0.8 + (Math.PI / 2 - 0.8) * Math.min(1, along / 0.45); // from ~45° down to vertical
      dx += (Math.cos(angle) * length * s) / n;
      dz += (Math.sin(angle) * length * s) / n;
    }
    // Lower down the cloth turns: its width (the stripes) swings from along the pole
    // to across, so the stripes hang side by side instead of edge-on
    // (smoothly, and with the stripes layered front to back while it turns, so the
    // cloth folds over itself instead of passing through itself)
    const k = Math.min(1, Math.max(0, (s - 0.08) / 0.7));
    const turn = 0.85 * k * k * (3 - 2 * k);
    const hoistZ = t * hoist * 0.9 * (1 - turn); // the hoist bunches up a little on the pole
    const across = t * 0.4 * turn;
    const layer = (t - 0.5) * 0.14 * turn; // red edge in front, blue behind
    const fold = Math.sin(t * Math.PI * 2 + s * 1.8) * (0.008 + 0.035 * s) * (1 - 0.7 * turn);
    return [x0 + (dx + across) / pieceW, yc + (layer + fold) / pieceD, z1 - (hoistZ + dz) / pieceH];
  }
  const wave = Math.sin(s * Math.PI * 2.4 - 0.6) * s * 0.85 + Math.sin(s * Math.PI * 5 + t * 1.5) * 0.12 * s;
  const sag = 0.25 * s * s; // as a share of the flag's height
  return [x0 + (x1 - x0) * s * (1 - 0.04 * Math.abs(wave)), yc + half * wave, z1 - (z1 - z0) * (t + sag * (0.6 + 0.4 * t))];
}

/**
 * Smooth round pot (tapering towards the foot, with a rim and soil) filling the
 * given box. opts: { taper } (foot radius as a share of the top).
 */
const pot = (x0, y0, x1, y1, z0, z1, c, opts = {}) => ["pot", x0, y0, x1, y1, z0, z1, c, opts];
/**
 * Palm fronds growing from a crown at (centre, z0) out to the box edge, up to z1.
 * opts: { n, kind: "feather" | "fan", droop }.
 */
const fronds = (x0, y0, x1, y1, z0, z1, c, opts = {}) => ["fronds", x0, y0, x1, y1, z0, z1, c, opts];

/**
 * A shrub (rose, olive crown…) from z0 to z1: many small round clusters of leaves,
 * with optional flowers (each a bloom with a lighter heart).
 */
function shrub(z0, z1, leaf, flower, { blooms = 0, seed = 1, width = 1, clumps = 16 } = {}) {
  let a = seed;
  const rnd = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
  const parts = [];
  const span = width;
  const H = z1 - z0;
  const dark = COLORS[`${leaf}_dark`] ? `${leaf}_dark` : leaf;
  // Spread evenly over a dome (golden-angle spiral, a little jitter): wider low
  // down, narrower at the top; blooms sit on its surface
  const GOLDEN = 2.39996;
  const radius = (up) => span * 0.36 * Math.sqrt(Math.max(0.08, 1 - up * up * 0.85));
  const height = (up) => z0 + H * (0.24 + 0.6 * up);
  for (let i = 0; i < clumps; i++) {
    const up = (i + 0.5) / clumps;
    const ang = i * GOLDEN + rnd() * 0.5;
    const rr = radius(up) * (0.45 + 0.4 * rnd());
    const cx = 0.5 + Math.cos(ang) * rr;
    const cy = 0.5 + Math.sin(ang) * rr;
    const r = span * (0.13 + rnd() * 0.06);
    const zc = height(up) + H * (rnd() - 0.5) * 0.08;
    const rz = H * (0.14 + rnd() * 0.05);
    parts.push(ball(cx - r, cy - r, cx + r, cy + r, zc - rz, zc + rz, i % 3 ? leaf : dark));
  }
  for (let i = 0; i < blooms; i++) {
    const up = 0.3 + (0.7 * (i + 0.5)) / blooms;
    const ang = i * GOLDEN + 1.1 + rnd() * 0.4;
    const rr = radius(up) * 0.98 + span * 0.04;
    const cx = 0.5 + Math.cos(ang) * rr;
    const cy = 0.5 + Math.sin(ang) * rr;
    const zc = height(up) + H * 0.1;
    const r = span * 0.06;
    const rz = H * 0.055;
    parts.push(ball(cx - r, cy - r, cx + r, cy + r, zc - rz, zc + rz, flower));
    const k = r * 0.55; // lighter heart, just on top
    parts.push(ball(cx - k, cy - k, cx + k, cy + k, zc + rz * 0.15, zc + rz * 1.05, `${flower}_light`));
  }
  return parts;
}

/** Ringed palm trunk from the centre, z0 to z1, `r` the radius as a share of the piece. */
function palmTrunk(z0, z1, r, c = "trunk") {
  const parts = [];
  const rings = 8;
  for (let i = 0; i < rings; i++) {
    const k = r * (i % 2 ? 0.88 : 1) * (1 - 0.25 * (i / rings));
    parts.push(cyl(0.5 - k, 0.5 - k, 0.5 + k, 0.5 + k, z0 + ((z1 - z0) * i) / rings, z0 + ((z1 - z0) * (i + 1)) / rings + 0.002, c));
  }
  return parts;
}

/**
 * DALI Opticon 2 bookshelf speaker within [x0..x1] x [y0..y1] (shares of the piece) and
 * heights z0..z1: cabinet in the piece's colour, hybrid tweeter (soft dome with a ribbon
 * above) and a 6.5" wood-fibre woofer.
 */
function opticon2(x0 = 0, x1 = 1, y0 = 0, y1 = 1, z0 = 0, z1 = 1) {
  const X = (f) => x0 + (x1 - x0) * f;
  const Y = (f) => y0 + (y1 - y0) * f;
  const Z = (f) => z0 + (z1 - z0) * f;
  const front = (a, b, za, zb, c, flag) => cyl(X(a), Y(0.97), X(b), Y(1.01), Z(za), Z(zb), c, flag);
  return [
    box(X(0), Y(0), X(1), Y(0.975), Z(0), Z(1), "main"), // cabinet
    box(X(0.02), Y(0.97), X(0.98), Y(0.985), Z(0.01), Z(0.99), "main"), // front baffle
    front(0.075, 0.925, 0.15, 0.62, "dark", "front"), // woofer surround
    cyl(X(0.14), Y(0.98), X(0.86), Y(1.012), Z(0.19), Z(0.58), "woofer", "front"), // wood-fibre cone
    cyl(X(0.4), Y(0.99), X(0.6), Y(1.02), Z(0.33), Z(0.44), "dark", "front"), // dust cap
    box(X(0.29), Y(0.975), X(0.71), Y(0.99), Z(0.67), Z(0.95), "dark"), // tweeter module
    cyl(X(0.4), Y(0.985), X(0.6), Y(1.008), Z(0.69), Z(0.8), "metal", "front"), // soft dome
    box(X(0.44), Y(0.985), X(0.56), Y(1.002), Z(0.83), Z(0.93), "metal"), // ribbon
    box(X(0.4), Y(0.98), X(0.6), Y(0.99), Z(0.04), Z(0.07), "metal"), // DALI logo
  ];
}

/**
 * Samsung The Frame: a slim panel hung flat on the wall with a picture-frame bezel
 * (the piece's colour: black, white, teak…) around the screen. Shows art when not
 * showing TV.
 */
function theFrame() {
  const b = 0.035; // bezel width as a share of the width
  const bh = b * 1.75; // …of the height (16:9)
  return [
    box(0, 0, 1, 0.55, 0.01, 0.99, "dark"), // panel body against the wall
    box(0, 0.5, 1, 1, 0, bh, "main"), box(0, 0.5, 1, 1, 1 - bh, 1, "main"), // bezel bottom / top
    box(0, 0.5, b, 1, 0, 1, "main"), box(1 - b, 0.5, 1, 1, 0, 1, "main"), // bezel sides
    box(b, 0.7, 1 - b, 0.98, bh, 1 - bh, "screen"),
  ];
}

/**
 * DALI Opticon 6 MK2 floorstander: cabinet in the piece's colour on a black plinth with
 * spikes, the hybrid tweeter (dome + ribbon) at the top, two 6.5" wood-fibre woofers below.
 */
function opticon6() {
  const P = 0.04; // plinth height share
  const Z = (f) => P + (1 - P) * f;
  const woofer = (zc) => {
    const r = 0.083 / 0.96; // 6.5" woofer radius as a share of the cabinet height (1 m)
    return [
      cyl(0.075, 0.97, 0.925, 1.01, Z(zc - r), Z(zc + r), "dark", "front"),
      cyl(0.14, 0.98, 0.86, 1.012, Z(zc - r * 0.82), Z(zc + r * 0.82), "woofer", "front"),
      cyl(0.4, 0.99, 0.6, 1.02, Z(zc - r * 0.24), Z(zc + r * 0.24), "dark", "front"),
    ];
  };
  return [
    box(-0.16, 0.04, 1.16, 0.96, 0.006, P * 0.7, "dark"), // plinth
    ...[[-0.12, 0.1], [1.12, 0.1], [-0.12, 0.9], [1.12, 0.9]].map(([x, y]) => cyl(x - 0.04, y - 0.025, x + 0.04, y + 0.025, 0, 0.012, "metal")),
    box(0, 0, 1, 0.975, P, 1, "main"), // cabinet
    box(0.02, 0.97, 0.98, 0.985, Z(0.005), Z(0.995), "main"),
    box(0.29, 0.975, 0.71, 0.99, Z(0.86), Z(0.965), "dark"), // tweeter module
    cyl(0.4, 0.985, 0.6, 1.008, Z(0.87), Z(0.91), "metal", "front"), // soft dome
    box(0.44, 0.985, 0.56, 1.002, Z(0.92), Z(0.955), "metal"), // ribbon
    ...woofer(0.75), ...woofer(0.56),
    box(0.4, 0.98, 0.6, 0.99, Z(0.02), Z(0.032), "metal"), // DALI logo
  ];
}

function luxuryChairs() {
  // seat height 0.47 m; z fractions below are relative to each chair's height
  const seat = (h, c = "main") => [
    box(0.02, 0.1, 0.98, 1, 0.42 / h, 0.47 / h, c),
    box(0.04, 0.12, 0.96, 0.98, 0.47 / h, 0.51 / h, "main2"),
  ];
  return {
    velvet_chair: { label: "Velvet dining chair", icon: "mdi:seat", cat: "Dining", w: 0.48, d: 0.58, h: 1.0, color: "#3f5a4b", parts: [
      ...roundLegs(0.06, 0.07, 0.43, "brass"), ...seat(1.0),
      box(0.03, 0, 0.97, 0.14, 0.47, 0.98, "main"), box(0.06, 0.13, 0.94, 0.16, 0.52, 0.94, "main2"),
      box(0.03, 0, 0.97, 0.14, 0.98, 1, "brass")] },
    wingback_chair: { label: "Wingback dining chair", icon: "mdi:sofa-single", cat: "Dining", w: 0.58, d: 0.62, h: 1.1, color: "#5b4a6b", parts: [
      ...roundLegs(0.06, 0.07, 0.4, "darkwood"), ...seat(1.1),
      box(0.02, 0, 0.98, 0.14, 0.43, 1, "main"),
      box(0, 0.06, 0.1, 0.45, 0.5, 0.92, "main"), box(0.9, 0.06, 1, 0.45, 0.5, 0.92, "main"),
      box(0.12, 0.13, 0.88, 0.16, 0.5, 0.95, "main2")] },
    tub_chair: { label: "Tub dining chair", icon: "mdi:sofa-single-outline", cat: "Dining", w: 0.58, d: 0.58, h: 0.8, color: "#b69a7a", parts: [
      ...roundLegs(0.12, 0.07, 0.5, "brass"),
      cyl(0.06, 0.06, 0.94, 0.94, 0.5, 0.58, "main"), cyl(0.1, 0.1, 0.9, 0.9, 0.58, 0.64, "main2"),
      // curved back wrapping around the back and sides
      arc(0, 0, 1, 1, 0.5, 1, "main", { inner: 0.78, start: 145, end: 395 })] },
    channel_chair: { label: "Channel-back dining chair", icon: "mdi:seat-outline", cat: "Dining", w: 0.5, d: 0.58, h: 1.0, color: "#2f3b55", parts: [
      ...roundLegs(0.06, 0.07, 0.43, "brass"), ...seat(1.0),
      // vertical channels, alternating shades for the tufted look
      ...[0, 1, 2, 3, 4].map((i) => box(0.03 + i * 0.188, 0, 0.03 + (i + 1) * 0.188 - 0.008, 0.14, 0.47, 0.99, i % 2 ? "main2" : "main"))] },
    carver_chair: { label: "Dining armchair (carver)", icon: "mdi:seat-legroom-normal", cat: "Dining", w: 0.6, d: 0.6, h: 0.95, color: "#8a7b6a", parts: [
      ...roundLegs(0.05, 0.07, 0.44, "darkwood"), ...seat(0.95),
      box(0.06, 0, 0.94, 0.13, 0.46, 1, "main"), box(0.09, 0.12, 0.91, 0.15, 0.52, 0.96, "main2"),
      // wooden armrests on supports
      box(0, 0.06, 0.08, 0.86, 0.7, 0.74, "darkwood"), box(0.92, 0.06, 1, 0.86, 0.7, 0.74, "darkwood"),
      box(0.01, 0.74, 0.07, 0.8, 0.49, 0.7, "darkwood"), box(0.93, 0.74, 0.99, 0.8, 0.49, 0.7, "darkwood")] },
  };
}

/** Point on an arc part's ellipse, in piece-local metres. */
function arcPoint(f, x0, y0, x1, y1, factor, deg) {
  const cx = ((x0 + x1) / 2 - 0.5) * f.w;
  const cy = ((y0 + y1) / 2 - 0.5) * f.d;
  const a = (deg * Math.PI) / 180;
  return [cx + ((x1 - x0) / 2) * f.w * factor * Math.cos(a), cy + ((y1 - y0) / 2) * f.d * factor * Math.sin(a)];
}
const legs = (i, s, z1, c) => [
  box(i, i, i + s, i + s, 0, z1, c), box(1 - i - s, i, 1 - i, i + s, 0, z1, c),
  box(i, 1 - i - s, i + s, 1 - i, 0, z1, c), box(1 - i - s, 1 - i - s, 1 - i, 1 - i, 0, z1, c),
];

export const CATALOG = {
  sofa: { label: "Sofa", icon: "mdi:sofa", cat: "Living", w: 2.0, d: 0.9, h: 0.85, color: "#7d8a9c", parts: [
    box(0, 0.25, 1, 1, 0, 0.5, "main"), box(0, 0, 1, 0.25, 0, 1, "main"),
    box(0, 0.25, 0.09, 1, 0, 0.7, "main"), box(0.91, 0.25, 1, 1, 0, 0.7, "main"),
    box(0.1, 0.27, 0.495, 0.97, 0.5, 0.62, "main2"), box(0.505, 0.27, 0.9, 0.97, 0.5, 0.62, "main2")] },
  armchair: { label: "Armchair", icon: "mdi:sofa-single", cat: "Living", w: 0.85, d: 0.85, h: 0.85, color: "#7d8a9c", parts: [
    box(0, 0.25, 1, 1, 0, 0.5, "main"), box(0, 0, 1, 0.25, 0, 1, "main"),
    box(0, 0.25, 0.16, 1, 0, 0.7, "main"), box(0.84, 0.25, 1, 1, 0, 0.7, "main"),
    box(0.17, 0.27, 0.83, 0.97, 0.5, 0.62, "main2")] },
  coffee_table: { label: "Coffee table", icon: "mdi:table-furniture", cat: "Living", w: 1.1, d: 0.6, h: 0.45, color: COLORS.wood, parts: [
    ...legs(0.04, 0.07, 0.9, "darkwood"), box(0, 0, 1, 1, 0.9, 1, "main")] },
  round_coffee_table: { label: "Round coffee table", icon: "mdi:circle-outline", cat: "Living", w: 0.8, d: 0.8, h: 0.42, color: COLORS.wood, parts: [
    // three legs, a lower shelf and the round top
    cyl(0.465, 0.09, 0.535, 0.16, 0, 0.9, "darkwood"), cyl(0.15, 0.66, 0.22, 0.73, 0, 0.9, "darkwood"),
    cyl(0.78, 0.66, 0.85, 0.73, 0, 0.9, "darkwood"),
    cyl(0.14, 0.14, 0.86, 0.86, 0.16, 0.2, "main"), cyl(0, 0, 1, 1, 0.9, 1, "main")] },
  tv: { label: "TV", icon: "mdi:television", cat: "Multimedia", av: "display", w: 1.25, d: 0.25, h: 1.2, color: COLORS.dark, screen: true,
    screenLight: { y: 0.66, z: 0.7 }, parts: [
    box(0.35, 0.1, 0.65, 0.9, 0, 0.03, "main"), box(0.47, 0.45, 0.53, 0.6, 0.03, 0.4, "main"),
    box(0, 0.4, 1, 0.62, 0.4, 1, "main"), box(0.02, 0.62, 0.98, 0.66, 0.42, 0.98, "screen")] },
  tv_wall: wallTv({ label: "Wall-mounted TV" }),
  tv_wall_ambilight: wallTv({ label: "Wall-mounted TV with Ambilight", ambilight: true }),
  tv_unit: { label: "TV unit", icon: "mdi:dresser-outline", cat: "Multimedia", w: 1.8, d: 0.45, h: 0.5, color: COLORS.wood, parts: [
    box(0, 0, 1, 1, 0.08, 1, "main"), ...legs(0.02, 0.04, 0.08, "dark"), box(0.497, 0.98, 0.503, 1, 0.15, 0.95, "darkwood")] },
  bookcase: { label: "Bookcase", icon: "mdi:bookshelf", cat: "Living", w: 0.9, d: 0.35, h: 2.0, color: COLORS.wood, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.05, 0.1, 0.95, 1, 0.04, 0.96, "darkwood")] },
  floor_lamp: { label: "Floor lamp", icon: "mdi:floor-lamp", cat: "Lighting", w: 0.42, d: 0.42, h: 1.6, color: COLORS.metal,
    light: { z: 0.84, angle: 1.35 }, parts: [
      cyl(0.2, 0.2, 0.8, 0.8, 0, 0.02, "main"), cyl(0.46, 0.46, 0.54, 0.54, 0.02, 0.8, "main"),
      cyl(0, 0, 1, 1, 0.78, 1, "shade")] },
  plant: { label: "Plant", icon: "mdi:flower", cat: "Living", w: 0.55, d: 0.55, h: 1.1, color: COLORS.terracotta, parts: [
    cyl(0.22, 0.22, 0.78, 0.78, 0, 0.3, "main"), ball(0, 0, 1, 1, 0.28, 1, "plant")] },
  rug: { label: "Rug", icon: "mdi:rug", cat: "Living", w: 2.0, d: 1.4, h: 0.01, color: "#b5a58c", parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.05, 0.07, 0.95, 0.93, 1, 1.2, "main2")] },
  speaker: { label: "Speaker", icon: "mdi:speaker", cat: "Multimedia", passive: true, w: 0.25, d: 0.28, h: 1.0, color: COLORS.dark, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), cyl(0.2, 0.95, 0.8, 1.0, 0.55, 0.85, "metal")] },

  bed_double: { label: "Double bed", icon: "mdi:bed-king-outline", cat: "Bedroom", w: 1.6, d: 2.1, h: 0.5, color: COLORS.wood, parts: [
    box(0, 0.04, 1, 1, 0, 0.6, "main"), box(0, 0, 1, 0.05, 0, 2.0, "main"),
    box(0.03, 0.06, 0.97, 0.98, 0.6, 1, "white"),
    box(0.08, 0.08, 0.47, 0.22, 1, 1.18, "light"), box(0.53, 0.08, 0.92, 0.22, 1, 1.18, "light"),
    box(0.03, 0.42, 0.97, 0.98, 1, 1.06, "main2")] },
  bed_single: { label: "Single bed", icon: "mdi:bed-single-outline", cat: "Bedroom", w: 0.95, d: 2.05, h: 0.5, color: COLORS.wood, parts: [
    box(0, 0.04, 1, 1, 0, 0.6, "main"), box(0, 0, 1, 0.05, 0, 2.0, "main"),
    box(0.04, 0.06, 0.96, 0.98, 0.6, 1, "white"), box(0.12, 0.08, 0.88, 0.22, 1, 1.18, "light"),
    box(0.04, 0.42, 0.96, 0.98, 1, 1.06, "main2")] },
  nightstand_lamp: { label: "Bedside lamp", icon: "mdi:lamp", cat: "Bedroom", w: 0.45, d: 0.4, h: 0.95, color: COLORS.wood,
    light: { z: 0.88, angle: 1.4 }, parts: [
      box(0, 0, 1, 1, 0, 0.55, "main"), box(0.48, 0.98, 0.52, 1, 0.3, 0.45, "darkwood"),
      cyl(0.36, 0.33, 0.64, 0.64, 0.55, 0.78, "metal"), cyl(0.18, 0.14, 0.82, 0.86, 0.76, 1, "shade")] },
  wardrobe: { label: "Wardrobe", icon: "mdi:wardrobe-outline", cat: "Bedroom", w: 1.5, d: 0.6, h: 2.1, color: COLORS.light, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.497, 0.98, 0.503, 1, 0.02, 0.98, "dark"),
    box(0.44, 1, 0.46, 1.03, 0.45, 0.55, "metal"), box(0.54, 1, 0.56, 1.03, 0.45, 0.55, "metal")] },
  desk: { label: "Desk", icon: "mdi:desk", cat: "Office", w: 1.4, d: 0.7, h: 0.75, color: COLORS.white, parts: [
    box(0, 0.05, 0.04, 0.95, 0, 0.96, "metal"), box(0.96, 0.05, 1, 0.95, 0, 0.96, "metal"), box(0, 0, 1, 1, 0.96, 1, "main")] },
  chair: { label: "Office chair", icon: "mdi:chair-rolling", cat: "Office", w: 0.48, d: 0.5, h: 0.9, color: COLORS.dark, parts: [
    ...legs(0.05, 0.08, 0.5, "metal"), box(0, 0.12, 1, 1, 0.5, 0.56, "main"), box(0.04, 0, 0.96, 0.12, 0.5, 1, "main")] },

  dining_table: { label: "Dining table", icon: "mdi:table-chair", cat: "Dining", w: 1.6, d: 0.9, h: 0.75, color: COLORS.wood, parts: [
    ...legs(0.03, 0.05, 0.95, "darkwood"), box(0, 0, 1, 1, 0.95, 1, "main")] },
  // ----- Dining -----
  round_dining_table: { label: "Round dining table", icon: "mdi:table-picnic", cat: "Dining", w: 1.1, d: 1.1, h: 0.75, color: COLORS.wood, parts: [
    cyl(0.28, 0.28, 0.72, 0.72, 0, 0.06, "darkwood"), cyl(0.45, 0.45, 0.55, 0.55, 0.06, 0.95, "darkwood"),
    cyl(0, 0, 1, 1, 0.95, 1, "main")] },
  ...luxuryChairs(),
  dining_chair: { label: "Dining chair", icon: "mdi:chair-school", cat: "Dining", w: 0.45, d: 0.5, h: 0.9, color: COLORS.wood, parts: [
    // seat faces the front (+y); the backrest is at the back edge
    ...legs(0.05, 0.09, 0.5, "main"),
    box(0, 0.04, 1, 1, 0.5, 0.56, "main2"),
    box(0.05, 0.04, 0.14, 0.13, 0.56, 1, "main"), box(0.86, 0.04, 0.95, 0.13, 0.56, 1, "main"),
    box(0.14, 0.05, 0.86, 0.12, 0.84, 0.97, "main"), box(0.14, 0.06, 0.86, 0.11, 0.66, 0.72, "main")] },

  counter: { label: "Kitchen counter", icon: "mdi:countertop-outline", cat: "Kitchen", w: 2.4, d: 0.62, h: 0.92, color: COLORS.white, parts: [
    box(0, 0.04, 1, 1, 0, 0.95, "main"), box(0, 0, 1, 1, 0.95, 1, "dark")] },
  stove: { label: "Stove", icon: "mdi:stove", cat: "Appliances", w: 0.6, d: 0.62, h: 0.92, color: COLORS.white, parts: [
    box(0, 0.04, 1, 1, 0, 0.95, "main"), box(0, 0, 1, 1, 0.95, 1, "screen"),
    cyl(0.1, 0.1, 0.42, 0.42, 1, 1.01, "dark"), cyl(0.58, 0.1, 0.9, 0.42, 1, 1.01, "dark"),
    cyl(0.1, 0.55, 0.42, 0.87, 1, 1.01, "dark"), cyl(0.58, 0.55, 0.9, 0.87, 1, 1.01, "dark")] },
  fridge: { label: "Fridge", icon: "mdi:fridge-outline", cat: "Appliances", w: 0.7, d: 0.7, h: 1.85, color: COLORS.white, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.03, 1, 0.97, 1.01, 0.62, 0.63, "light"), box(0.85, 1, 0.9, 1.04, 0.45, 0.8, "metal")] },
  sink: { label: "Sink", icon: "mdi:countertop", cat: "Bathroom", w: 0.6, d: 0.48, h: 0.85, color: COLORS.white, parts: [
    box(0, 0.02, 1, 1, 0, 0.92, "light"), box(0, 0, 1, 1, 0.92, 1, "main"), cyl(0.2, 0.2, 0.8, 0.85, 1, 1.01, "glass"),
    cyl(0.47, 0.04, 0.53, 0.14, 1, 1.18, "metal")] },
  bathtub: { label: "Bathtub", icon: "mdi:bathtub-outline", cat: "Bathroom", w: 1.7, d: 0.75, h: 0.58, color: COLORS.white, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.05, 0.1, 0.95, 0.9, 1, 1.01, "glass")] },
  shower: { label: "Shower", icon: "mdi:shower", cat: "Bathroom", w: 0.9, d: 0.9, h: 2.0, color: COLORS.white, parts: [
    box(0, 0, 1, 1, 0, 0.03, "main"), box(0, 0.98, 1, 1, 0.03, 1, "glass"), box(0.98, 0, 1, 0.98, 0.03, 1, "glass"),
    cyl(0.45, 0.45, 0.55, 0.55, 0.03, 0.035, "metal")] },
  toilet: { label: "Toilet", icon: "mdi:toilet", cat: "Bathroom", w: 0.4, d: 0.68, h: 0.8, color: COLORS.white, parts: [
    box(0.05, 0, 0.95, 0.24, 0, 1, "main"), cyl(0.1, 0.2, 0.9, 1, 0, 0.52, "main")] },
  washer: { label: "Washing machine", icon: "mdi:washing-machine", cat: "Appliances", w: 0.598, d: 0.632, h: 0.848, color: COLORS.white,
    screen: true, laundry: "washer", drum: { x: 0.5, z: 0.53 }, parts: laundryFront(false) },

  // ----- Office -----
  standing_desk: { label: "Standing desk", icon: "mdi:desk", cat: "Office", w: 1.6, d: 0.8, h: 1.05, color: COLORS.white, parts: [
    box(0.08, 0.1, 0.14, 0.9, 0, 0.02, "dark"), box(0.86, 0.1, 0.92, 0.9, 0, 0.02, "dark"),
    box(0.09, 0.45, 0.13, 0.55, 0.02, 0.97, "metal"), box(0.87, 0.45, 0.91, 0.55, 0.02, 0.97, "metal"),
    box(0.1, 0.47, 0.9, 0.53, 0.85, 0.9, "metal"), box(0, 0, 1, 1, 0.97, 1, "main")] },
  l_desk: { label: "Corner desk", icon: "mdi:desk", cat: "Office", w: 1.6, d: 1.4, h: 0.75, color: COLORS.white, parts: [
    box(0, 0, 0.03, 0.45, 0, 0.96, "metal"), box(0.97, 0, 1, 0.45, 0, 0.96, "metal"), box(0, 0.97, 0.43, 1, 0, 0.96, "metal"),
    box(0, 0, 1, 0.45, 0.96, 1, "main"), box(0, 0.45, 0.43, 1, 0.96, 1, "main")] },
  meeting_table: { label: "Meeting table", icon: "mdi:table-large", cat: "Office", w: 2.4, d: 1.1, h: 0.75, color: COLORS.wood, parts: [
    box(0.15, 0.3, 0.2, 0.7, 0, 0.95, "dark"), box(0.8, 0.3, 0.85, 0.7, 0, 0.95, "dark"), box(0, 0, 1, 1, 0.95, 1, "main")] },
  filing_cabinet: { label: "Filing cabinet", icon: "mdi:file-cabinet", cat: "Office", w: 0.45, d: 0.6, h: 1.3, color: COLORS.metal, parts: [
    box(0, 0, 1, 1, 0, 1, "main"),
    box(0.04, 1, 0.96, 1.01, 0.26, 0.27, "dark"), box(0.04, 1, 0.96, 1.01, 0.51, 0.52, "dark"), box(0.04, 1, 0.96, 1.01, 0.76, 0.77, "dark"),
    box(0.4, 1, 0.6, 1.04, 0.86, 0.88, "dark"), box(0.4, 1, 0.6, 1.04, 0.61, 0.63, "dark"),
    box(0.4, 1, 0.6, 1.04, 0.36, 0.38, "dark"), box(0.4, 1, 0.6, 1.04, 0.11, 0.13, "dark")] },
  whiteboard: { label: "Whiteboard", icon: "mdi:presentation", cat: "Office", w: 1.8, d: 0.06, h: 2.0, color: COLORS.metal, parts: [
    box(0, 0, 1, 0.7, 0.45, 1, "main"), box(0.01, 0.7, 0.99, 1, 0.46, 0.99, "canvas"), box(0.05, 0.7, 0.4, 1.6, 0.43, 0.45, "main")] },
  monitor: { label: "Monitor (on desk)", icon: "mdi:monitor", cat: "Office", w: 0.62, d: 0.22, h: 1.25, color: COLORS.dark, screen: true, parts: [
    box(0.32, 0.3, 0.68, 0.85, 0.6, 0.615, "main"), box(0.47, 0.42, 0.53, 0.55, 0.615, 0.74, "main"),
    box(0, 0.38, 1, 0.55, 0.72, 1, "main"), box(0.02, 0.55, 0.98, 0.6, 0.735, 0.99, "screen")] },
  dual_monitor: { label: "Dual monitors (on desk)", icon: "mdi:monitor-multiple", cat: "Office", w: 1.2, d: 0.3, h: 1.25, color: COLORS.dark, screen: true, parts: [
    box(0.42, 0.35, 0.58, 0.85, 0.6, 0.615, "main"), box(0.48, 0.45, 0.52, 0.58, 0.615, 0.95, "main"),
    box(0, 0.3, 0.495, 0.45, 0.72, 1, "main"), box(0.01, 0.45, 0.485, 0.5, 0.735, 0.99, "screen"),
    box(0.505, 0.3, 1, 0.45, 0.72, 1, "main"), box(0.515, 0.45, 0.99, 0.5, 0.735, 0.99, "screen")] },
  laptop: { label: "Laptop (on desk)", icon: "mdi:laptop", cat: "Office", w: 0.34, d: 0.26, h: 0.98, color: COLORS.metal, screen: true, parts: [
    box(0, 0.25, 1, 1, 0.765, 0.785, "main"), box(0.08, 0.5, 0.92, 0.85, 0.785, 0.787, "dark"),
    box(0, 0.18, 1, 0.25, 0.785, 1, "main"), box(0.04, 0.25, 0.96, 0.27, 0.8, 0.985, "screen")] },
  pc_tower: { label: "PC tower", icon: "mdi:desktop-tower", cat: "Office", w: 0.21, d: 0.46, h: 0.46, color: COLORS.dark, screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.3, 1, 0.7, 1.01, 0.88, 0.92, "screen")] },
  printer: { label: "Printer", icon: "mdi:printer", cat: "Office", w: 0.45, d: 0.4, h: 0.25, color: COLORS.white, parts: [
    box(0, 0, 1, 1, 0, 0.85, "main"), box(0.05, 0.05, 0.95, 0.75, 0.85, 1, "dark"), box(0.15, 0.85, 0.85, 1.15, 0.3, 0.34, "light")] },
  desk_lamp: { label: "Desk lamp (on desk)", icon: "mdi:desk-lamp", cat: "Office", w: 0.26, d: 0.26, h: 1.2, color: COLORS.metal,
    light: { z: 0.92, angle: 1.2 }, parts: [
      cyl(0.25, 0.25, 0.75, 0.75, 0.625, 0.64, "main"), cyl(0.46, 0.46, 0.54, 0.54, 0.64, 0.9, "main"),
      cyl(0.12, 0.12, 0.88, 0.88, 0.88, 1, "shade")] },

  // ----- Multimedia -----
  soundbar: { label: "Soundbar (on TV unit)", icon: "mdi:soundbar", cat: "Multimedia", speaker: true, w: 0.95, d: 0.12, h: 0.58, color: COLORS.dark, parts: [
    box(0, 0, 1, 1, 0.862, 1, "main"), box(0.02, 0.92, 0.98, 1.01, 0.88, 0.98, "metal")] },
  subwoofer: { label: "Subwoofer", icon: "mdi:speaker", cat: "Multimedia", passive: true, w: 0.36, d: 0.36, h: 0.4, color: COLORS.dark, parts: [
    box(0, 0, 1, 1, 0.04, 1, "main"), ...legs(0.08, 0.1, 0.04, "metal"), cyl(0.15, 0.15, 0.85, 0.85, 1, 1.01, "metal")] },
  av_receiver: { label: "AV receiver (on TV unit)", icon: "mdi:audio-video", cat: "Multimedia", av: "receiver", w: 0.43, d: 0.38, h: 0.67, color: COLORS.dark, screen: true, parts: [
    box(0, 0, 1, 1, 0.75, 1, "main"), box(0.3, 1, 0.7, 1.01, 0.86, 0.92, "screen"),
    cyl(0.05, 1, 0.17, 1.04, 0.82, 0.96, "metal"), cyl(0.83, 1, 0.95, 1.04, 0.82, 0.96, "metal")] },
  // Samsung The Frame (LS03A): 65" 1453 x 832 x 25 mm, 55" 1231 x 703 x 25 mm, hung flat on the wall
  the_frame_65: { label: "The Frame 65\" (on the wall)", icon: "mdi:television-classic", cat: "Samsung", av: "display", w: 1.453, d: 0.05, h: 0.832,
    z: 1.0, color: "#2a2b2d", screen: true, art: true, screenLight: { y: 1, z: 0.5 }, parts: theFrame() },
  the_frame_55: { label: "The Frame 55\" (on the wall)", icon: "mdi:television-classic", cat: "Samsung", av: "display", w: 1.231, d: 0.05, h: 0.703,
    z: 1.05, color: "#2a2b2d", screen: true, art: true, screenLight: { y: 1, z: 0.5 }, parts: theFrame() },
  // DALI Opticon 6 MK2: 195 x 330 x 1000 mm floorstander (plinth wider)
  dali_opticon6: { label: "Opticon 6 MK2 (floorstanding)", icon: "mdi:speaker", cat: "DALI", passive: true, w: 0.195, d: 0.33, h: 1.0,
    color: "#222120", parts: opticon6() },
  // DALI Opticon 2: 195 x 293 x 350 mm (w x d x h, with grille)
  dali_opticon2: { label: "Opticon 2 (bookshelf speaker)", icon: "mdi:speaker", cat: "DALI", passive: true, w: 0.195, d: 0.293, h: 0.35, z: 0.6,
    color: "#222120", parts: opticon2() },
  dali_opticon2_stand: { label: "Opticon 2 on a stand", icon: "mdi:speaker", cat: "DALI", passive: true, w: 0.26, d: 0.32, h: 0.95, color: "#222120",
    parts: [
      box(0, 0, 1, 1, 0, 0.022, "dark"), // stand base plate
      box(0.4, 0.38, 0.6, 0.62, 0.022, 0.61, "dark"), // column
      box(0.1, 0.08, 0.9, 0.92, 0.61, 0.63, "dark"), // top plate
      ...opticon2(0.125, 0.875, 0.04, 0.96, 0.63, 1)] },
  // NAD T 778 (435 x 133 x 406 mm, graphite): 5" colour touchscreen, volume knob on the right
  // Apple TV 4K (93 x 93 x 31 mm, black): rounded box on a recessed foot, logo on top
  apple_tv: { label: "Apple TV 4K (on TV unit)", icon: "mdi:apple", cat: "Apple", av: "source", w: 0.093, d: 0.093, h: 0.031, z: 0.5,
    color: "#1c1c1e", parts: [
    box(0.08, 0.08, 0.92, 0.92, 0, 0.12, "dark"), // recessed foot
    box(0.02, 0.02, 0.98, 0.98, 0.12, 1, "main"),
    box(0, 0.04, 1, 0.96, 0.22, 0.9, "main"), // rounded sides
    box(0.04, 0, 0.96, 1, 0.22, 0.9, "main"),
    cyl(0.42, 0.4, 0.58, 0.58, 1, 1.03, "graphite"), // logo
    box(0.47, 1, 0.53, 1.01, 0.45, 0.6, "white")] }, // status light
  nad_t778: { label: "T 778 AV receiver (on TV unit)", icon: "mdi:audio-video", cat: "NAD", av: "receiver", w: 0.435, d: 0.406, h: 0.133, z: 0.5,
    color: "#2a2b2d", screen: true, display: "NAD", parts: [
    ...[[0.06, 0.08], [0.94, 0.08], [0.06, 0.88], [0.94, 0.88]].map(([x, y]) => cyl(x - 0.04, y - 0.04, x + 0.04, y + 0.04, 0, 0.1, "dark")),
    box(0, 0, 1, 0.94, 0.1, 1, "main"), // chassis
    box(0, 0.94, 1, 0.975, 0.1, 1, "graphite"), // front panel
    ...[0.2, 0.35, 0.5, 0.65, 0.8].map((y) => box(0.15, y, 0.85, y + 0.06, 1, 1.006, "dark")), // vents on top
    box(0.24, 0.975, 0.62, 0.985, 0.36, 0.88, "screen"), // touchscreen
    cyl(0.75, 0.96, 0.89, 1.02, 0.34, 0.84, "graphite", "front"), // volume knob
    cyl(0.79, 1.0, 0.85, 1.025, 0.53, 0.65, "dark", "front"),
    cyl(0.06, 0.975, 0.1, 0.99, 0.22, 0.34, "metal", "front"), // power button
    cyl(0.14, 0.975, 0.17, 0.99, 0.22, 0.31, "dark", "front"), // headphone socket
    box(0.04, 0.975, 0.16, 0.982, 0.75, 0.82, "metal")] }, // NAD logo plate
  // PlayStation 5 (390 x 104 x 260 mm): black core between two white wings, blue light along the seams
  playstation_5: { label: "PlayStation 5 (standing)", icon: "mdi:sony-playstation", cat: "Sony", av: "source", w: 0.104, d: 0.26, h: 0.4,
    color: COLORS.white, screen: true, parts: [
    box(0.2, 0.25, 0.8, 0.75, 0, 0.025, "dark"), // stand
    box(0.2, 0.03, 0.8, 0.97, 0.03, 0.97, "dark"), // core
    box(0, 0, 0.2, 1, 0.025, 1, "main"), box(0.8, 0, 1, 1, 0.025, 1, "main"), // wings
    box(0.19, 0.99, 0.23, 1.005, 0.06, 0.94, "screen"), box(0.77, 0.99, 0.81, 1.005, 0.06, 0.94, "screen"), // light
    box(0.35, 0.995, 0.65, 1.003, 0.6, 0.62, "metal")] }, // disc slot
  playstation_5_flat: { label: "PlayStation 5 (lying, on TV unit)", icon: "mdi:sony-playstation", cat: "Sony", av: "source", w: 0.39, d: 0.26, h: 0.104, z: 0.5,
    color: COLORS.white, screen: true, parts: [
    box(0.03, 0.03, 0.97, 0.97, 0.18, 0.82, "dark"), // core
    box(0, 0, 1, 1, 0, 0.18, "main"), box(0, 0, 1, 1, 0.82, 1, "main"), // wings
    box(0.06, 0.99, 0.94, 1.005, 0.17, 0.21, "screen"), box(0.06, 0.99, 0.94, 1.005, 0.79, 0.83, "screen"), // light
    box(0.55, 0.995, 0.8, 1.003, 0.4, 0.6, "metal")] }, // disc slot
  game_console: { label: "Game console (on TV unit)", icon: "mdi:gamepad-variant", cat: "Multimedia", av: "source", w: 0.3, d: 0.26, h: 0.58, color: COLORS.white, screen: true, parts: [
    box(0, 0, 1, 1, 0.862, 1, "main"), box(0.1, 1, 0.5, 1.01, 0.93, 0.95, "screen")] },
  projector: { label: "Projector (ceiling)", icon: "mdi:projector", cat: "Multimedia", av: "display", w: 0.36, d: 0.32, h: 2.5, color: COLORS.white, screen: true, parts: [
    cyl(0.44, 0.44, 0.56, 0.56, 0.93, 1, "metal"), box(0, 0, 1, 1, 0.87, 0.93, "main"), cyl(0.58, 0.9, 0.86, 1.06, 0.875, 0.925, "screen")] },
  projector_screen: { label: "Projector screen", icon: "mdi:projector-screen", cat: "Multimedia", w: 2.2, d: 0.08, h: 2.4, color: COLORS.dark, screen: true,
    screenLight: { y: 0.7, z: 0.65 }, parts: [
    box(0, 0, 1, 1, 0.95, 1, "main"), box(0.02, 0.3, 0.98, 0.7, 0.35, 0.95, "canvas"), box(0.02, 0.3, 0.98, 0.7, 0.33, 0.35, "main")] },
  nas: { label: "NAS / router", icon: "mdi:nas", cat: "Multimedia", w: 0.22, d: 0.25, h: 0.24, color: COLORS.dark, screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.1, 1, 0.9, 1.01, 0.8, 0.84, "screen")] },
  smart_display: { label: "Smart display (on table)", icon: "mdi:tablet", cat: "Multimedia", w: 0.26, d: 0.14, h: 0.95, color: COLORS.white, screen: true, parts: [
    box(0.1, 0.3, 0.9, 1, 0.79, 0.84, "main"), box(0, 0.25, 1, 0.45, 0.82, 1, "main"), box(0.03, 0.45, 0.97, 0.5, 0.83, 0.99, "screen")] },

  // ----- Sonos (real dimensions; `z` = default height of the surface it stands on) -----
  sonos_era100: { label: "Era 100", icon: "mdi:speaker", cat: "Sonos", speaker: true, surround: true, w: 0.12, d: 0.13, h: 0.183, z: 0.75, color: SONOS_BLACK, media: true, parts: [
    // Softly rounded column, the grille all round; on top a groove (the volume slider) with
    // play/pause behind it, the status light at the front
    plan(0.06, 0.06, 0.94, 0.94, 0, 0.03, "main3", roundRect(0, 0, 1, 1, 0.04)),
    plan(0, 0, 1, 1, 0.02, 0.965, "main_grille", roundRect(0, 0, 1, 1, 0.048), { bevel: 0.006 }),
    plan(0.01, 0.01, 0.99, 0.99, 0.95, 1, "main", roundRect(0, 0, 1, 1, 0.047), { bevel: 0.004 }),
    box(0.22, 0.56, 0.78, 0.63, 1, 1.004, "main3"), cyl(0.46, 0.38, 0.54, 0.46, 1, 1.008, "main3"),
    cyl(0.49, 0.8, 0.51, 0.82, 1, 1.008, "light")] },
  sonos_era300: { label: "Era 300", icon: "mdi:speaker", cat: "Sonos", speaker: true, surround: true, w: 0.26, d: 0.185, h: 0.16, z: 0.75, color: SONOS_BLACK, media: true, parts: [
    // From the front an hourglass (taller at its ends than in the middle), the grille wrapping
    // it, its front and back edges strongly rounded; the controls on top in the middle
    front(0, 0, 1, 1, 0, 1, "main_grille", hourglass(0.24), { bevel: 0.022 }),
    box(0.42, 0.3, 0.58, 0.36, 0.868, 0.884, "main3"), cyl(0.485, 0.62, 0.515, 0.66, 0.868, 0.886, "light")] },
  sonos_one: { label: "One / One SL", icon: "mdi:speaker", cat: "Sonos", speaker: true, surround: true, w: 0.12, d: 0.12, h: 0.161, z: 0.75, color: SONOS_BLACK, media: true, parts: [
    // A rounded square column: the grille wraps it, a flat top with touch controls
    // (volume down, play/pause, volume up) and the status light at the front
    plan(0.05, 0.05, 0.95, 0.95, 0, 0.04, "main3", roundRect(0, 0, 1, 1, 0.024)),
    plan(0, 0, 1, 1, 0.03, 0.965, "main_grille", roundRect(0, 0, 1, 1, 0.03), { bevel: 0.004 }),
    plan(0.01, 0.01, 0.99, 0.99, 0.95, 1, "main", roundRect(0, 0, 1, 1, 0.029), { bevel: 0.003 }),
    cyl(0.45, 0.45, 0.55, 0.55, 1, 1.01, "main3"), cyl(0.22, 0.48, 0.26, 0.52, 1, 1.008, "main3"), cyl(0.74, 0.48, 0.78, 0.52, 1, 1.008, "main3"),
    cyl(0.485, 0.77, 0.515, 0.8, 1, 1.008, "light")] },
  sonos_five: { label: "Five", icon: "mdi:speaker", cat: "Sonos", speaker: true, surround: true, w: 0.364, d: 0.154, h: 0.203, z: 0.75, color: SONOS_BLACK, media: true, parts: [
    // Wide, softly rounded body; the grille covers the front and wraps round its corners,
    // touch controls on top
    plan(0, 0, 1, 0.92, 0, 1, "main", roundRect(0, 0, 1, 1, 0.03), { bevel: 0.006 }),
    plan(0.004, 0.8, 0.996, 1, 0.03, 0.97, "main_grille", [[0, 0], [1, 0], [1, 1, 0.03], [0, 1, 0.03]], { bevel: 0.004 }),
    cyl(0.48, 0.42, 0.52, 0.52, 1, 1.008, "main3"), cyl(0.43, 0.45, 0.45, 0.49, 1, 1.006, "main3"), cyl(0.55, 0.45, 0.57, 0.49, 1, 1.006, "main3"),
    cyl(0.495, 0.66, 0.505, 0.69, 1, 1.006, "light")] },
  sonos_arc: { label: "Arc / Arc Ultra", icon: "mdi:soundbar", cat: "Sonos", speaker: true, homeTheater: true, w: 1.14, d: 0.116, h: 0.087, z: 0.5, color: SONOS_BLACK, media: true, parts: [
    // Seen from the side a flat-bottomed ellipse, the grille wrapping it from the back over
    // the top to the front; rounded ends. Touch controls and the status light on top.
    profile(0, 0, 1, 1, 0, 1, "main_grille", [[0.03, 0, 0.012], [0.97, 0, 0.012], [1, 0.3, 0.03], [0.8, 0.85, 0.035], [0.45, 1, 0.04], [0.08, 0.82, 0.035], [0, 0.35, 0.03]], 0.011),
    box(0.04, 0.12, 0.96, 0.88, -0.01, 0.01, "main3"),
    box(0.485, 0.5, 0.515, 0.56, 0.99, 1.012, "main3"), box(0.497, 0.62, 0.503, 0.66, 0.97, 0.995, "light")] },
  sonos_beam: { label: "Beam", icon: "mdi:soundbar", cat: "Sonos", speaker: true, homeTheater: true, w: 0.651, d: 0.1, h: 0.069, z: 0.5, color: SONOS_BLACK, media: true, parts: [
    // Rounded bar, the grille wrapping front, back and ends; a smooth panel on top with the
    // touch controls and the status light
    profile(0, 0, 1, 1, 0, 1, "main_grille", roundRect(0, 0, 1, 1, 0.022), 0.012),
    profile(0.03, 0.12, 0.97, 0.88, 0.97, 1.012, "main", roundRect(0, 0, 1, 1, 0.006), 0.004),
    box(0.47, 0.42, 0.53, 0.52, 1.012, 1.02, "main3"), box(0.497, 0.62, 0.503, 0.66, 1.012, 1.02, "light")] },
  sonos_playbar: { label: "Playbar", icon: "mdi:soundbar", cat: "Sonos", speaker: true, homeTheater: true, w: 0.9, d: 0.14, h: 0.085, z: 0.5, color: "#8e9196", media: true, parts: [
    // Seen from the side a rectangle with four rounded corners, wrapped in black speaker
    // cloth. Two extruded aluminium edges run along diagonally opposite corners (the wider
    // one, bottom front, is the heat sink with the IR receiver); black mesh end caps, each
    // with an inset aluminium band.
    profile(0.02, 0, 0.98, 1, 0, 1, "fabric", roundRect(0, 0, 1, 1, 0.018)),
    profile(0.02, 0, 0.98, 1, 0, 1, "main_metal", [[0.55, -0.006], [1.004, -0.006, 0.0185], [1.004, 0.42], [0.8, 0.42], [0.55, 0.1]]),
    profile(0.02, 0, 0.98, 1, 0, 1, "main_metal", [[0.32, 1.006], [-0.004, 1.006, 0.0185], [-0.004, 0.7], [0.15, 0.7], [0.32, 0.9]]),
    profile(0.017, 0, 0.024, 1, 0, 1, "main_metal", roundRect(0.012, 0.02, 0.988, 0.98, 0.016)),
    profile(0.976, 0, 0.983, 1, 0, 1, "main_metal", roundRect(0.012, 0.02, 0.988, 0.98, 0.016)),
    profile(0, 0, 0.018, 1, 0, 1, "grille", roundRect(0, 0, 1, 1, 0.018), 0.004),
    profile(0.982, 0, 1, 1, 0, 1, "grille", roundRect(0, 0, 1, 1, 0.018), 0.004)] },
  sonos_ray: { label: "Ray", icon: "mdi:soundbar", cat: "Sonos", speaker: true, homeTheater: true, w: 0.559, d: 0.095, h: 0.071, z: 0.5, color: SONOS_BLACK, media: true, parts: [
    // Seen from the side: a flat top that overhangs the grille, which slopes back towards the
    // bottom; touch controls and the status light along the top front
    profile(0, 0, 1, 1, 0, 1, "main", [[0, 0, 0.006], [0.78, 0, 0.004], [0.9, 0.72], [1, 0.74, 0.004], [1, 1, 0.008], [0, 1, 0.008]], 0.005),
    profile(0.02, 0, 0.98, 1, 0, 1, "main_grille", [[0.785, 0.03], [0.81, 0.03], [0.925, 0.7], [0.9, 0.7]]),
    box(0.47, 0.72, 0.53, 0.84, 1, 1.012, "main3"), box(0.497, 0.995, 0.503, 1.003, 0.8, 0.9, "light")] },
  sonos_sub: { label: "Sub", icon: "mdi:surround-sound", cat: "Sonos", speaker: true, sub: true, w: 0.402, d: 0.158, h: 0.389, color: SONOS_BLACK, media: true, parts: [
    // Glossy rounded block with the tunnel straight through; its two woofers face each other
    // across the tunnel (top and bottom). Low feet.
    front(0, 0, 1, 1, 0.02, 1, "main", roundRect(0, 0, 1, 1, 0.04), { bevel: 0.01, holes: [roundRect(0.22, 0.28, 0.78, 0.72, 0.05)] }),
    box(0.3, 0.12, 0.7, 0.88, 0.279, 0.285, "main3"), box(0.3, 0.12, 0.7, 0.88, 0.715, 0.721, "main3"),
    box(0.06, 0.15, 0.2, 0.85, 0, 0.02, "main3"), box(0.8, 0.15, 0.94, 0.85, 0, 0.02, "main3")] },
  sonos_sub_mini: { label: "Sub Mini", icon: "mdi:surround-sound", cat: "Sonos", speaker: true, sub: true, w: 0.23, d: 0.23, h: 0.305, color: SONOS_BLACK, media: true, parts: [
    // A column with a slot right through the middle (front to back); the woofers face each
    // other across it
    cyl(0, 0, 1, 1, 0, 0.4, "main"), cyl(0, 0, 1, 1, 0.6, 1, "main"),
    plan(0, 0, 1, 1, 0.4, 0.6, "main", circleSlice(-1, 0.45)), plan(0, 0, 1, 1, 0.4, 0.6, "main", circleSlice(1, 0.45)),
    cyl(0.25, 0.25, 0.75, 0.75, 0.4, 0.404, "main3"), cyl(0.25, 0.25, 0.75, 0.75, 0.596, 0.6, "main3"),
    cyl(0.485, 0.47, 0.515, 0.53, 1, 1.006, "light")] },
  sonos_move: { label: "Move 2", icon: "mdi:speaker-bluetooth", cat: "Sonos", speaker: true, w: 0.16, d: 0.127, h: 0.241, color: SONOS_BLACK, media: true, parts: [
    // Oval column narrowing a little to the top, the grille all round; a flat top with the
    // touch controls, and the handle recessed into the back at the top
    lathe(0, 0, 1, 1, 0.02, 0.96, "main_grille", [[0.95, 0], [1, 0.05], [1, 0.7], [0.95, 1]]),
    cyl(0.03, 0.03, 0.97, 0.97, 0, 0.025, "main3"), cyl(0.025, 0.025, 0.975, 0.975, 0.955, 1, "main"),
    box(0.3, 0, 0.7, 0.12, 0.8, 0.94, "main3"),
    cyl(0.46, 0.45, 0.54, 0.55, 1, 1.008, "main3"), cyl(0.49, 0.74, 0.51, 0.77, 1, 1.008, "light")] },
  sonos_roam: { label: "Roam 2", icon: "mdi:speaker-bluetooth", cat: "Sonos", speaker: true, w: 0.062, d: 0.06, h: 0.168, z: 0.75, color: SONOS_BLACK, media: true, parts: [
    // Upright triangular prism with rounded corners, a flat face to the front and the grille
    // round it; the buttons on the top end
    plan(0, 0, 1, 1, 0, 0.035, "main", [[0, 1, 0.012], [0.5, 0, 0.014], [1, 1, 0.012]], { bevel: 0.003 }),
    plan(0, 0, 1, 1, 0.025, 0.975, "main_grille", [[0, 1, 0.012], [0.5, 0, 0.014], [1, 1, 0.012]], { bevel: 0.002 }),
    plan(0, 0, 1, 1, 0.965, 1, "main", [[0, 1, 0.012], [0.5, 0, 0.014], [1, 1, 0.012]], { bevel: 0.003 }),
    cyl(0.42, 0.5, 0.58, 0.66, 1, 1.006, "main3"), cyl(0.47, 0.76, 0.53, 0.82, 1, 1.006, "light")] },
  sonos_amp: { label: "Amp", icon: "mdi:amplifier", cat: "Sonos", w: 0.217, d: 0.217, h: 0.064, z: 0.5, color: SONOS_BLACK, media: true, parts: [
    // Low square block with rounded corners; on top an inset panel with the touch controls,
    // the status light at the front
    plan(0, 0, 1, 1, 0, 1, "main", roundRect(0, 0, 1, 1, 0.024), { bevel: 0.004 }),
    plan(0.08, 0.08, 0.92, 0.92, 0.99, 1.004, "main3", roundRect(0, 0, 1, 1, 0.016)),
    cyl(0.47, 0.47, 0.53, 0.53, 1.004, 1.012, "main"), cyl(0.38, 0.48, 0.42, 0.52, 1.004, 1.01, "main"), cyl(0.58, 0.48, 0.62, 0.52, 1.004, 1.01, "main"),
    cyl(0.49, 0.8, 0.51, 0.82, 1.004, 1.01, "light")] },
  sonos_port: { label: "Port", icon: "mdi:cast-audio", cat: "Sonos", w: 0.136, d: 0.136, h: 0.042, z: 0.5, color: SONOS_BLACK, media: true, parts: [
    // Small flat square with rounded corners, the status light at the front
    plan(0, 0, 1, 1, 0, 1, "main", roundRect(0, 0, 1, 1, 0.016), { bevel: 0.003 }),
    plan(0.1, 0.1, 0.9, 0.9, 0.99, 1.004, "main3", roundRect(0, 0, 1, 1, 0.01)),
    box(0.47, 0.995, 0.53, 1.003, 0.4, 0.6, "light")] },

  // ----- Lighting -----
  pendant: { label: "Pendant, drum", icon: "mdi:ceiling-light", cat: "Lighting", ceiling: true, w: 0.45, d: 0.45, h: 0.9, color: COLORS.dark,
    light: { z: 0.1, angle: 1.0, beam: true }, parts: [
      cyl(0.38, 0.38, 0.62, 0.62, 0.97, 1, "main"), cyl(0.485, 0.485, 0.515, 0.515, 0.28, 0.97, "dark"),
      cyl(0, 0, 1, 1, 0, 0.28, "shade")] },
  pendant_trio: { label: "Pendant ×3", icon: "mdi:ceiling-light-multiple", cat: "Lighting", ceiling: true, w: 1.3, d: 0.3, h: 0.9, color: COLORS.dark,
    light: { z: 0.1, angle: 1.3, beam: true }, parts: [
      box(0, 0.3, 1, 0.7, 0.96, 1, "main"),
      cyl(0.11, 0.48, 0.12, 0.52, 0.3, 0.96, "dark"), cyl(0.495, 0.48, 0.505, 0.52, 0.3, 0.96, "dark"), cyl(0.88, 0.48, 0.89, 0.52, 0.3, 0.96, "dark"),
      cyl(0.02, 0.1, 0.21, 0.9, 0, 0.3, "shade"), cyl(0.405, 0.1, 0.595, 0.9, 0, 0.3, "shade"), cyl(0.79, 0.1, 0.98, 0.9, 0, 0.3, "shade")] },
  pendant_dome: { label: "Pendant, dome", icon: "mdi:ceiling-light", cat: "Lighting", ceiling: true, w: 0.42, d: 0.42, h: 0.9, color: COLORS.dark,
    light: { z: 0.08, angle: 1.0, beam: true },
    parts: pendantShade([[1, 0], [0.97, 0.22], [0.86, 0.5], [0.62, 0.78], [0.3, 0.95], [0.08, 1]], 0.38) },
  pendant_cone: { label: "Pendant, cone", icon: "mdi:ceiling-light", cat: "Lighting", ceiling: true, w: 0.3, d: 0.3, h: 0.9, color: COLORS.white,
    light: { z: 0.08, angle: 0.9, beam: true },
    parts: pendantShade([[1, 0], [0.97, 0.05], [0.16, 0.94], [0.08, 1]], 0.42) },
  pendant_bell: { label: "Pendant, bell", icon: "mdi:ceiling-light", cat: "Lighting", ceiling: true, w: 0.38, d: 0.38, h: 0.9, color: "#3f5b4f",
    light: { z: 0.08, angle: 1.0, beam: true },
    parts: pendantShade([[1, 0], [0.93, 0.07], [0.66, 0.28], [0.53, 0.52], [0.47, 0.78], [0.3, 0.95], [0.08, 1]], 0.42) },
  pendant_saucer: { label: "Pendant, saucer", icon: "mdi:ceiling-light", cat: "Lighting", ceiling: true, w: 0.55, d: 0.55, h: 0.8, color: COLORS.white,
    light: { z: 0.05, angle: 1.2, beam: true },
    parts: pendantShade([[1, 0], [0.99, 0.25], [0.8, 0.6], [0.4, 0.9], [0.08, 1]], 0.18) },
  pendant_globe: { label: "Pendant, opal globe", icon: "mdi:ceiling-light", cat: "Lighting", ceiling: true, w: 0.3, d: 0.3, h: 0.85, color: COLORS.brass,
    light: { z: 0.18, angle: 1.45 }, parts: [
    cyl(0.38, 0.38, 0.62, 0.62, 0.975, 1, "main"), cyl(0.495, 0.495, 0.505, 0.505, 0.36, 0.975, "dark"),
    cyl(0.42, 0.42, 0.58, 0.58, 0.34, 0.38, "main"), ball(0, 0, 1, 1, 0, 0.36, "shade")] },
  // Metal globe, closed except for a small opening underneath: light only shines down out of it
  pendant_globe_metal: { label: "Pendant, metal globe (opening underneath)", icon: "mdi:ceiling-light", cat: "Lighting", ceiling: true, w: 0.3, d: 0.3, h: 0.9,
    color: COLORS.metal, light: { z: 0.05, angle: 0.7, beam: true }, parts: metalGlobe(0.33, 0.5) },
  pendant_bulb: { label: "Pendant, bare bulb", icon: "mdi:lightbulb-outline", cat: "Lighting", ceiling: true, w: 0.14, d: 0.14, h: 0.9, color: COLORS.brass,
    light: { z: 0.1, angle: 1.45 }, parts: [
    cyl(0.3, 0.3, 0.7, 0.7, 0.975, 1, "main"), cyl(0.48, 0.48, 0.52, 0.52, 0.2, 0.975, "dark"),
    cyl(0.36, 0.36, 0.64, 0.64, 0.16, 0.21, "main"), ball(0.12, 0.12, 0.88, 0.88, 0, 0.17, "shade")] },
  pendant_linear: { label: "Pendant, linear bar (over a table)", icon: "mdi:ceiling-light-multiple", cat: "Lighting", ceiling: true, w: 1.2, d: 0.08, h: 0.8,
    color: COLORS.dark, light: { z: 0, angle: 1.3, beam: true }, parts: [
    box(0.08, 0.3, 0.14, 0.7, 0.98, 1, "main"), box(0.86, 0.3, 0.92, 0.7, 0.98, 1, "main"),
    cyl(0.106, 0.45, 0.114, 0.55, 0.06, 0.98, "dark"), cyl(0.886, 0.45, 0.894, 0.55, 0.06, 0.98, "dark"),
    box(0, 0, 1, 1, 0.012, 0.075, "main"), box(0.01, 0.1, 0.99, 0.9, 0, 0.014, "shade", "solid")] },
  pendant_ring: { label: "Pendant, LED ring", icon: "mdi:circle-outline", cat: "Lighting", ceiling: true, w: 0.8, d: 0.8, h: 0.8, color: COLORS.dark,
    light: { z: 0.02, angle: 1.4 }, parts: [
    cyl(0.44, 0.44, 0.56, 0.56, 0.98, 1, "main"),
    cyl(0.04, 0.495, 0.05, 0.505, 0.04, 0.98, "dark"), cyl(0.95, 0.495, 0.96, 0.505, 0.04, 0.98, "dark"),
    arc(0, 0, 1, 1, 0.02, 0.06, "main", { inner: 0.9 }), arc(0, 0, 1, 1, 0, 0.02, "shade", { inner: 0.91, outer: 0.99 })] },
  pendant_cluster: { label: "Pendant, globe cluster (5)", icon: "mdi:ceiling-light-multiple", cat: "Lighting", ceiling: true, w: 0.7, d: 0.7, h: 1.1,
    color: COLORS.brass, light: { z: 0.2, angle: 1.45 }, parts: [
    cyl(0.35, 0.35, 0.65, 0.65, 0.975, 1, "main"),
    ...[[0.5, 0.5, 0.0], [0.22, 0.3, 0.14], [0.78, 0.32, 0.22], [0.3, 0.76, 0.3], [0.74, 0.74, 0.08]].flatMap(([cx, cy, z]) => [
      cyl(cx - 0.006, cy - 0.006, cx + 0.006, cy + 0.006, z + 0.2, 0.975, "dark"),
      ball(cx - 0.15, cy - 0.15, cx + 0.15, cy + 0.15, z, z + 0.22, "shade")])] },
  spot: { label: "Recessed spot", icon: "mdi:light-recessed", cat: "Lighting", ceiling: true, w: 0.09, d: 0.09, h: 0.02, color: COLORS.white,
    light: { z: 0, angle: 0.55, beam: true, lens: 0.35 }, parts: [cyl(0, 0, 1, 1, 0.5, 1, "main"), cyl(0.15, 0.15, 0.85, 0.85, 0, 0.5, "shade", "solid")] },
  // Directional: the body tilts on its ceiling plate (the piece's `tilt`), turned by its rotation
  spot_surface: { label: "Surface spot", icon: "mdi:spotlight-beam", cat: "Lighting", ceiling: true, w: 0.09, d: 0.09, h: 0.16, color: COLORS.white,
    light: { z: 0, angle: 0.6, beam: true, lens: 0.38 }, tilt: { pivot: 0.85 }, parts: [
      cyl(-0.15, -0.15, 1.15, 1.15, 0.94, 1, "main"), // ceiling plate
      cyl(0.38, 0.38, 0.62, 0.62, 0.85, 0.94, "main"), // joint
      cyl(0, 0, 1, 1, 0.08, 0.85, "main"), cyl(0.12, 0.12, 0.88, 0.88, 0, 0.08, "shade", "solid")] },
  track: { label: "Track light", icon: "mdi:track-light", cat: "Lighting", ceiling: true, w: 1.5, d: 0.1, h: 0.25, color: COLORS.dark,
    light: { z: 0, angle: 1.0, beam: true }, parts: [
      box(0, 0.3, 1, 0.7, 0.88, 1, "main"),
      cyl(0.12, 0.1, 0.18, 0.9, 0.1, 0.88, "main"), cyl(0.47, 0.1, 0.53, 0.9, 0.1, 0.88, "main"), cyl(0.82, 0.1, 0.88, 0.9, 0.1, 0.88, "main"),
      cyl(0.125, 0.15, 0.175, 0.85, 0, 0.1, "shade", "solid"), cyl(0.475, 0.15, 0.525, 0.85, 0, 0.1, "shade", "solid"),
      cyl(0.825, 0.15, 0.875, 0.85, 0, 0.1, "shade", "solid")] },
  ceiling_light: { label: "Ceiling light", icon: "mdi:ceiling-light-outline", cat: "Lighting", ceiling: true, w: 0.45, d: 0.45, h: 0.1, color: COLORS.white,
    light: { z: 0, angle: 1.45 }, parts: [cyl(0, 0, 1, 1, 0.6, 1, "main"), cyl(0.04, 0.04, 0.96, 0.96, 0, 0.6, "shade", "solid")] },
  chandelier: { label: "Chandelier", icon: "mdi:chandelier", cat: "Lighting", ceiling: true, w: 0.75, d: 0.75, h: 1.0, color: "#b8a26b",
    light: { z: 0.42, angle: 1.45 }, parts: [
      cyl(0.47, 0.47, 0.53, 0.53, 0.55, 1, "main"), ball(0.38, 0.38, 0.62, 0.62, 0.3, 0.58, "main"),
      box(0.07, 0.48, 0.93, 0.52, 0.34, 0.37, "main"), box(0.48, 0.07, 0.52, 0.93, 0.34, 0.37, "main"),
      cyl(0, 0.41, 0.17, 0.59, 0.37, 0.52, "shade"), cyl(0.83, 0.41, 1, 0.59, 0.37, 0.52, "shade"),
      cyl(0.41, 0, 0.59, 0.17, 0.37, 0.52, "shade"), cyl(0.41, 0.83, 0.59, 1, 0.37, 0.52, "shade")] },
  ceiling_fan: { label: "Ceiling fan + light", icon: "mdi:ceiling-fan-light", cat: "Lighting", ceiling: true, w: 1.3, d: 1.3, h: 0.45, color: COLORS.wood,
    light: { z: 0.1, angle: 1.4 }, parts: [
      cyl(0.48, 0.48, 0.52, 0.52, 0.55, 1, "metal"), cyl(0.41, 0.41, 0.59, 0.59, 0.25, 0.55, "metal"),
      box(0, 0.46, 1, 0.54, 0.33, 0.37, "main", "spin"), box(0.46, 0, 0.54, 1, 0.33, 0.37, "main", "spin"),
      cyl(0.43, 0.43, 0.57, 0.57, 0.05, 0.25, "shade", "solid")] },
  arc_lamp: { label: "Arc floor lamp, dome shade", icon: "mdi:floor-lamp-torchiere-variant", cat: "Lighting", w: 1.6, d: 0.4, h: 2.0, color: COLORS.metal,
    light: { x: 0.86, z: 0.7, angle: 1.0, beam: true }, parts: arcLamp(false) },
  arc_lamp_globe: { label: "Arc floor lamp, globe", icon: "mdi:floor-lamp-torchiere-variant", cat: "Lighting", w: 1.6, d: 0.4, h: 2.0, color: COLORS.brass,
    light: { x: 0.86, z: 0.74, angle: 1.45 }, parts: arcLamp(true) },
  uplighter: { label: "Floor uplighter", icon: "mdi:floor-lamp-torchiere", cat: "Lighting", w: 0.35, d: 0.35, h: 1.8, color: COLORS.metal,
    light: { z: 0.97, angle: 1.3, up: true }, parts: [
      cyl(0.2, 0.2, 0.8, 0.8, 0, 0.02, "main"), cyl(0.47, 0.47, 0.53, 0.53, 0.02, 0.9, "main"), cyl(0, 0, 1, 1, 0.9, 1, "shade", "solid")] },
  table_lamp: { label: "Table lamp", icon: "mdi:lamp-outline", cat: "Lighting", w: 0.32, d: 0.32, h: 0.55, z: 0.75, color: "#c9b79c",
    light: { z: 0.72, angle: 1.4 }, parts: [cyl(0.3, 0.3, 0.7, 0.7, 0, 0.5, "main"), cyl(0.04, 0.04, 0.96, 0.96, 0.5, 1, "shade")] },
  wall_light: { label: "Wall light", icon: "mdi:wall-sconce-round", cat: "Lighting", w: 0.22, d: 0.18, h: 0.3, z: 1.7, color: COLORS.dark,
    light: { y: 0.65, z: 0.6, angle: 1.4 }, parts: [
      box(0.25, 0, 0.75, 0.1, 0.1, 0.9, "main"), box(0.45, 0.1, 0.55, 0.45, 0.45, 0.55, "main"), cyl(0.1, 0.3, 0.9, 1, 0.5, 1, "shade")] },
  led_strip: { label: "LED strip", icon: "mdi:led-strip-variant", cat: "Lighting", w: 2.0, d: 0.03, h: 0.02, color: COLORS.white,
    light: { z: 0.5, angle: 1.5 }, parts: [box(0, 0, 1, 1, 0, 1, "shade", "solid")] },

  // ----- Philips Hue (sizes from the product sheets, rounded; resize as needed) -----
  hue_motion: { label: "Motion sensor", icon: "mdi:motion-sensor", cat: "Philips Hue", w: 0.055, d: 0.035, h: 0.055, z: 2.2, color: HUE_WHITE,
    fov: { angle: 100, range: 5 }, parts: [
    box(0.05, 0, 0.95, 0.3, 0.05, 0.95, "main"), box(0, 0.3, 1, 1, 0, 1, "main"),
    cyl(0.3, 0.97, 0.7, 1.03, 0.3, 0.7, "light"), cyl(0.45, 0.98, 0.55, 1.04, 0.78, 0.88, "dark")] },
  hue_motion_outdoor: { label: "Outdoor motion sensor", icon: "mdi:motion-sensor", cat: "Philips Hue", w: 0.05, d: 0.07, h: 0.1, z: 2.2, color: HUE_BLACK,
    fov: { angle: 160, range: 12 }, parts: [
    box(0.1, 0, 0.9, 0.2, 0.1, 0.9, "main"), box(0.35, 0.2, 0.65, 0.45, 0.4, 0.6, "main"),
    box(0, 0.4, 1, 1, 0, 1, "main"), box(0.2, 0.98, 0.8, 1.02, 0.35, 0.75, "dark")] },
  hue_dimmer: { label: "Dimmer switch", icon: "mdi:light-switch", cat: "Philips Hue", w: 0.07, d: 0.025, h: 0.115, z: 1.05, color: HUE_WHITE, parts: [
    box(0, 0, 1, 0.45, 0, 1, "main"), box(0.25, 0.45, 0.75, 1, 0.1, 0.9, "main"),
    ...[0, 1, 2, 3].map((i) => box(0.3, 0.98, 0.7, 1.02, 0.7 - i * 0.17, 0.82 - i * 0.17, "light"))] },
  hue_tap_dial: { label: "Tap dial switch", icon: "mdi:knob", cat: "Philips Hue", w: 0.08, d: 0.03, h: 0.08, z: 1.05, color: HUE_WHITE, parts: [
    box(0, 0, 1, 0.4, 0, 1, "main"), box(0.1, 0.4, 0.9, 1, 0.1, 0.9, "main"), box(0.2, 0.98, 0.8, 1.03, 0.2, 0.8, "light"),
    ...[0, 1, 2, 3].map((i) => box(0.12 + (i % 2) * 0.68, 1, 0.2 + (i % 2) * 0.68, 1.03, i < 2 ? 0.75 : 0.17, i < 2 ? 0.83 : 0.25, "dark"))] },
  hue_smart_button: { label: "Smart button", icon: "mdi:gesture-tap-button", cat: "Philips Hue", w: 0.045, d: 0.02, h: 0.045, z: 1.05, color: HUE_WHITE, parts: [
    box(0, 0, 1, 0.35, 0, 1, "main"), box(0.15, 0.35, 0.85, 1, 0.15, 0.85, "main"), box(0.35, 0.98, 0.65, 1.04, 0.35, 0.65, "light")] },
  hue_bridge: { label: "Bridge", icon: "mdi:bridge", cat: "Philips Hue", w: 0.09, d: 0.09, h: 0.026, z: 0.75, color: HUE_WHITE, parts: [
    box(0.02, 0.02, 0.98, 0.98, 0, 0.9, "main"), cyl(0.2, 0.2, 0.8, 0.8, 0.9, 1, "main2"),
    ...[0, 1, 2].map((i) => box(0.3 + i * 0.15, 0.98, 0.38 + i * 0.15, 1, 0.4, 0.6, "metal"))] },
  hue_smart_plug: { label: "Smart plug", icon: "mdi:power-socket-eu", cat: "Philips Hue", w: 0.06, d: 0.07, h: 0.06, z: 0.3, color: HUE_WHITE, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), cyl(0.15, 0.97, 0.85, 1.02, 0.15, 0.85, "main2"), box(0.75, 1, 0.85, 1.03, 0.8, 0.88, "light")] },
  hue_contact: { label: "Door / window contact", icon: "mdi:door-closed", cat: "Philips Hue", w: 0.05, d: 0.02, h: 0.035, z: 1.1, color: HUE_WHITE, parts: [
    box(0, 0, 0.62, 1, 0, 1, "main"), box(0.68, 0, 1, 1, 0.1, 0.9, "main")] },
  hue_sync_box: { label: "Hue Play HDMI sync box (on TV unit)", icon: "mdi:hdmi-port", cat: "Philips Hue", w: 0.18, d: 0.1, h: 0.024, z: 0.5, color: HUE_BLACK,
    screen: true, parts: [box(0, 0, 1, 1, 0, 1, "main"), box(0.44, 0.99, 0.56, 1.01, 0.4, 0.6, "screen")] },
  // Hue Play light bar: a pill-shaped bar (25.4 x 3.6 cm, 4.3 cm deep) in a black housing,
  // one long side a frosted face that glows; ~500 lm. Standing: on its round foot
  // (7.9 cm), the face turned towards the wall behind it, washing that wall.
  hue_play: { label: "Hue Play light bar (standing)", icon: "mdi:lightbulb-on-outline", cat: "Philips Hue", w: 0.079, d: 0.079, h: 0.3, z: 0.5, color: HUE_BLACK,
    light: { y: 0.21, z: 0.52, angle: 1.25, soft: true, aim: [-1, 0.1], power: 0.4 }, parts: hueBar(true) },
  // Lying down: the frosted face on top, lighting up (and the wall when it's against one)
  hue_play_flat: { label: "Hue Play light bar (lying flat)", icon: "mdi:lightbulb-on-outline", cat: "Philips Hue", w: 0.254, d: 0.036, h: 0.043, z: 0.5,
    color: HUE_BLACK, light: { z: 1, angle: 1.25, soft: true, up: true, power: 0.4 }, parts: hueBar(false) },
  hue_play_gradient: { label: "Hue Play gradient lightstrip (behind TV)", icon: "mdi:television-ambient-light", cat: "Philips Hue", w: 1.45, d: 0.02, h: 0.84, z: 1.0,
    color: HUE_BLACK, ambilight: true, parts: [
    box(0, 0, 1, 1, 0, 0.02, "shade", "solid"), box(0, 0, 1, 1, 0.98, 1, "shade", "solid"),
    box(0, 0, 0.01, 1, 0, 1, "shade", "solid"), box(0.99, 0, 1, 1, 0, 1, "shade", "solid")] },
  hue_go: { label: "Go (portable)", icon: "mdi:lamp", cat: "Philips Hue", w: 0.16, d: 0.16, h: 0.15, z: 0.75, color: HUE_WHITE,
    light: { z: 0.6, angle: 1.45, up: true, all: true, power: 0.35 }, parts: [ // ~300 lm, frosted all round
    cyl(0.15, 0.15, 0.85, 0.85, 0, 0.1, "main"), ball(0, 0, 1, 1, 0.05, 1, "shade")] },
  hue_iris: { label: "Iris (table)", icon: "mdi:lamp", cat: "Philips Hue", w: 0.15, d: 0.11, h: 0.19, z: 0.75, color: HUE_WHITE,
    light: { y: 0.6, z: 0.6, angle: 1.45, up: true }, parts: [
    box(0.3, 0, 0.7, 0.45, 0, 0.12, "main"), cyl(0, 0.15, 1, 1, 0.05, 1, "shade", "solid")] },
  hue_bloom: { label: "Bloom (table)", icon: "mdi:lamp", cat: "Philips Hue", w: 0.1, d: 0.1, h: 0.13, z: 0.75, color: HUE_WHITE,
    light: { z: 0.7, angle: 1.4, up: true }, parts: [
    cyl(0.25, 0.25, 0.75, 0.75, 0, 0.2, "main"), ball(0, 0, 1, 1, 0.15, 1, "shade")] },
  hue_signe_floor: { label: "Signe gradient (floor)", icon: "mdi:floor-lamp", cat: "Philips Hue", w: 0.25, d: 0.25, h: 1.45, color: HUE_BLACK,
    light: { z: 0.8, angle: 1.35, up: true }, parts: [
    cyl(0, 0, 1, 1, 0, 0.012, "main"), box(0.44, 0.44, 0.56, 0.56, 0.012, 1, "main"), box(0.45, 0.56, 0.55, 0.6, 0.05, 1, "shade", "solid")] },
  hue_signe_table: { label: "Signe gradient (table)", icon: "mdi:lamp", cat: "Philips Hue", w: 0.14, d: 0.14, h: 0.55, z: 0.75, color: HUE_BLACK,
    light: { z: 0.8, angle: 1.35, up: true }, parts: [
    cyl(0, 0, 1, 1, 0, 0.03, "main"), box(0.42, 0.42, 0.58, 0.58, 0.03, 1, "main"), box(0.43, 0.58, 0.57, 0.64, 0.06, 1, "shade", "solid")] },
  hue_gradient_tube: { label: "Gradient light tube (on TV unit)", icon: "mdi:led-strip", cat: "Philips Hue", w: 0.75, d: 0.04, h: 0.04, z: 0.5, color: HUE_BLACK,
    light: { z: 1, angle: 1.4, up: true }, parts: [box(0, 0.3, 1, 1, 0, 1, "main"), box(0.01, 0, 0.99, 0.3, 0.1, 0.9, "shade", "solid")] },
  hue_lightstrip: { label: "Lightstrip Plus", icon: "mdi:led-strip-variant", cat: "Philips Hue", w: 2.0, d: 0.016, h: 0.004, color: HUE_WHITE,
    light: { z: 0.5, angle: 1.5 }, parts: [box(0, 0, 1, 1, 0, 1, "shade", "solid")] },
  hue_ceiling_square: { label: "Ceiling light, square (Being / Aurelle)", icon: "mdi:ceiling-light", cat: "Philips Hue", ceiling: true, w: 0.3, d: 0.3, h: 0.05,
    color: HUE_WHITE, light: { z: 0, angle: 1.45 }, parts: [box(0, 0, 1, 1, 0.5, 1, "main"), box(0.04, 0.04, 0.96, 0.96, 0, 0.5, "shade", "solid")] },
  hue_ceiling_round: { label: "Ceiling light, round (Enrave / Infuse)", icon: "mdi:ceiling-light", cat: "Philips Hue", ceiling: true, w: 0.38, d: 0.38, h: 0.07,
    color: HUE_WHITE, light: { z: 0, angle: 1.45 }, parts: [cyl(0, 0, 1, 1, 0.5, 1, "main"), cyl(0.05, 0.05, 0.95, 0.95, 0, 0.5, "shade", "solid")] },
  hue_spot: { label: "Centura recessed spot", icon: "mdi:light-recessed", cat: "Philips Hue", ceiling: true, w: 0.09, d: 0.09, h: 0.02, color: HUE_WHITE,
    light: { z: 0, angle: 0.7, beam: true }, parts: [cyl(0, 0, 1, 1, 0.5, 1, "main"), cyl(0.2, 0.2, 0.8, 0.8, 0, 0.5, "shade", "solid")] },
  hue_lily: { label: "Lily outdoor spot", icon: "mdi:spotlight", cat: "Philips Hue", w: 0.08, d: 0.12, h: 0.3, color: HUE_BLACK,
    light: { y: 0.8, z: 0.85, angle: 0.5, up: true, beam: true }, parts: [
    cyl(0.4, 0.3, 0.6, 0.5, 0, 0.55, "main"), box(0.1, 0.25, 0.9, 1, 0.55, 1, "main"), cyl(0.2, 0.92, 0.8, 1.01, 0.62, 0.95, "shade", "solid")] },
  hue_calla: { label: "Calla outdoor bollard", icon: "mdi:outdoor-lamp", cat: "Philips Hue", w: 0.15, d: 0.15, h: 0.25, color: HUE_BLACK,
    light: { z: 0.9, angle: 1.45 }, parts: [
    cyl(0, 0, 1, 1, 0, 0.75, "main"), cyl(0.05, 0.05, 0.95, 0.95, 0.75, 0.95, "shade", "solid"), cyl(0, 0, 1, 1, 0.95, 1, "main")] },
  hue_econic_wall: { label: "Econic outdoor wall light", icon: "mdi:coach-lamp", cat: "Philips Hue", w: 0.12, d: 0.15, h: 0.3, z: 1.8, color: HUE_BLACK,
    light: { y: 0.6, z: 0.5, angle: 1.4 }, parts: [
    box(0.2, 0, 0.8, 0.12, 0.1, 0.9, "main"), box(0.42, 0.12, 0.58, 0.3, 0.45, 0.55, "main"),
    cyl(0, 0.25, 1, 1, 0.15, 0.85, "shade", "solid"), cyl(0, 0.25, 1, 1, 0.85, 1, "main")] },

  // ----- Garden -----
  fence_panel: { label: "Fence panel, vertical boards (2 m)", icon: "mdi:fence", cat: "Garden", w: 1.8, d: 0.045, h: 2.0, color: FENCE_WOOD,
    parts: boardFence(14) },
  fence_panel_slats: { label: "Fence panel, horizontal slats (2 m)", icon: "mdi:fence", cat: "Garden", w: 1.8, d: 0.04, h: 2.0, color: FENCE_WOOD,
    parts: slatFence(14) },
  fence_panel_concrete: { label: "Fence panel on concrete base (2 m)", icon: "mdi:fence", cat: "Garden", w: 1.8, d: 0.05, h: 2.0, color: FENCE_WOOD,
    parts: [...boardFence(14, 0.13), box(0, 0.1, 1, 0.9, 0, 0.13, "concrete")] },
  fence_gate: { label: "Garden gate (2 m)", icon: "mdi:gate", cat: "Garden", w: 1.0, d: 0.05, h: 2.0, color: FENCE_WOOD, parts: [
    ...boardFence(8),
    box(0.04, 0, 0.96, 0.3, 0.45, 0.5, "main3"), box(0.84, 1, 0.9, 1.15, 0.5, 0.53, "metal"), box(0.02, 0, 0.06, 0.3, 0.2, 0.24, "metal"),
    box(0.02, 0, 0.06, 0.3, 0.76, 0.8, "metal")] },
  flagpole: { label: "Flagpole with flag (6 m)", icon: "mdi:flag-variant", cat: "Garden", w: 0.7, d: 0.3, h: 6.0, color: COLORS.white,
    parts: flagpole(0.7, true) },
  flagpole_flying: { label: "Flagpole, flag flying (6 m)", icon: "mdi:flag-variant", cat: "Garden", w: 1.6, d: 0.3, h: 6.0, color: COLORS.white,
    parts: flagpole(1.6, false) },
  rose_bush: { label: "Rose bush", icon: "mdi:flower-tulip", cat: "Garden", w: 0.7, d: 0.7, h: 0.8, color: COLORS.leaf,
    parts: shrub(0, 1, "leaf", "rose_red", { blooms: 16, seed: 3, clumps: 20 }) },
  rose_bush_pink: { label: "Rose bush, pink", icon: "mdi:flower-tulip", cat: "Garden", w: 0.7, d: 0.7, h: 0.8, color: COLORS.leaf,
    parts: shrub(0, 1, "leaf", "rose_pink", { blooms: 16, seed: 11, clumps: 20 }) },
  rose_pot: { label: "Rose in pot", icon: "mdi:flower-tulip-outline", cat: "Garden", w: 0.45, d: 0.45, h: 0.9, color: COLORS.terracotta, parts: [
    pot(0.12, 0.12, 0.88, 0.88, 0, 0.4, "main", { taper: 0.75 }), ...shrub(0.38, 1, "leaf", "rose_red", { blooms: 10, seed: 7, clumps: 14 })] },
  palm_fan: { label: "Small palm (fan palm)", icon: "mdi:palm-tree", cat: "Garden", w: 1.8, d: 1.8, h: 2.4, color: COLORS.trunk, parts: [
    ...palmTrunk(0, 0.66, 0.05), fronds(0, 0, 1, 1, 0.64, 1, "palm_leaf", { n: 14, kind: "fan" })] },
  palm_pot: { label: "Small palm in pot", icon: "mdi:palm-tree", cat: "Garden", w: 1.3, d: 1.3, h: 1.6, color: COLORS.planter, parts: [
    pot(0.32, 0.32, 0.68, 0.68, 0, 0.3, "main", { taper: 0.8 }), ...palmTrunk(0.29, 0.5, 0.045, "trunk"),
    fronds(0, 0, 1, 1, 0.48, 1, "palm_leaf", { n: 12, kind: "feather" })] },
  palm_feather: { label: "Small palm (feather palm)", icon: "mdi:palm-tree", cat: "Garden", w: 2.2, d: 2.2, h: 2.6, color: COLORS.trunk, parts: [
    ...palmTrunk(0, 0.6, 0.045), fronds(0, 0, 1, 1, 0.58, 1, "palm_leaf", { n: 13, kind: "feather" })] },
  boxwood_pot: { label: "Boxwood ball in pot", icon: "mdi:circle", cat: "Garden", w: 0.5, d: 0.5, h: 0.95, color: COLORS.planter, parts: [
    pot(0.1, 0.1, 0.9, 0.9, 0, 0.42, "main", { taper: 0.85 }), ball(0.04, 0.04, 0.96, 0.96, 0.4, 1, "leaf_dark")] },
  olive_pot: { label: "Olive tree in pot", icon: "mdi:tree", cat: "Garden", w: 1.0, d: 1.0, h: 2.0, color: COLORS.terracotta, parts: [
    pot(0.27, 0.27, 0.73, 0.73, 0, 0.24, "main", { taper: 0.75 }), cyl(0.47, 0.47, 0.53, 0.53, 0.22, 0.62, "trunk"),
    ...shrub(0.5, 1, "leaf_grey", "leaf_grey", { seed: 5, clumps: 26 })] },
  lavender: { label: "Lavender", icon: "mdi:flower", cat: "Garden", w: 0.6, d: 0.6, h: 0.5, color: COLORS.leaf_grey, parts: [
    ball(0.05, 0.05, 0.95, 0.95, 0, 0.62, "leaf_grey"),
    ...Array.from({ length: 16 }, (_, i) => {
      const a = (i * 2.4) % (Math.PI * 2);
      const r = 0.12 + ((i * 7) % 5) * 0.06;
      const [cx, cy] = [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r];
      return ball(cx - 0.035, cy - 0.035, cx + 0.035, cy + 0.035, 0.6, 0.95 + ((i * 3) % 4) * 0.012, "lavender");
    })] },
  pot_terracotta: { label: "Terracotta pot", icon: "mdi:pot-outline", cat: "Garden", w: 0.5, d: 0.5, h: 0.45, color: COLORS.terracotta, parts: [
    pot(0, 0, 1, 1, 0, 1, "main", { taper: 0.72 })] },
  pot_tall: { label: "Tall planter, round", icon: "mdi:pot-outline", cat: "Garden", w: 0.45, d: 0.45, h: 0.8, color: COLORS.planter, parts: [
    pot(0, 0, 1, 1, 0, 1, "main", { taper: 0.82 })] },
  planter_square: { label: "Square planter", icon: "mdi:square-outline", cat: "Garden", w: 0.5, d: 0.5, h: 0.5, color: COLORS.planter, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.06, 0.06, 0.94, 0.94, 1, 1.004, "soil")] },
  kapschuur: { label: "Kapschuur (open timber shed)", icon: "mdi:home-roof", cat: "Garden", w: 5.0, d: 3.6, h: 3.4, color: "#b8773f",
    parts: [["timber", 0, 0, 1, 1, 0, 1, "main", { eave: 2.3, overhang: 0.35 }]] },
  kapschuur_closed_left: { label: "Kapschuur, black cladding (closed left)", icon: "mdi:home-roof", cat: "Garden", w: 6.0, d: 3.6, h: 3.5,
    color: "#c99a62", parts: [["timber", 0, 0, 1, 1, 0, 1, "main", { eave: 2.35, overhang: 0.4, roof: "tiles", clad: ["back", "left"], gutter: true, ridgeShift: 0.4 }]] },
  kapschuur_biesse: { label: "Kapschuur Biesse (6 × 3 m, open ends)", icon: "mdi:home-roof", cat: "Garden", w: 6.0, d: 3.0, h: 3.4,
    color: "#dcc092", parts: [["timber", 0, 0, 1, 1, 0, 1, "main", { eave: 2.2, overhang: 0.35, endOverhang: 0.45, roof: "tiles",
      clad: ["back"], cladColor: "#a59d90", gablePost: true }]] },
  // After a Tuinhuisfabriek drawing: 600 x 350, 15x15 posts, front 2.20 m, kapuitslag down to 1.25 m at the back,
  // ridge beam at 3.30 m, 38° roof
  kapschuur_kapuitslag: { label: "Kapschuur with kapuitslag (600 × 350)", icon: "mdi:home-roof", cat: "Garden", w: 6.45, d: 4.0, h: 3.45,
    color: "#dcc092", parts: [["timber", 0, 0, 1, 1, 0, 1, "main", { eave: 2.2, eaveBack: 1.25, overhang: 0.32, endOverhang: 0.3,
      post: 0.15, roof: "tiles", gutter: true, clad: ["back", "left", "right"], cladColor: "#26282b" }]] },
  timber_flat: { label: "Timber shelter, flat roof (3 posts front, 2 back)", icon: "mdi:home-roof", cat: "Garden", w: 4.0, d: 4.0, h: 2.7,
    color: "#c99a62", parts: [["timberflat", 0, 0, 1, 1, 0, 1, "main", { overhang: 0.3, front: 3, back: 2 }]] },
  kapschuur_closed_right: { label: "Kapschuur, black cladding (closed right)", icon: "mdi:home-roof", cat: "Garden", w: 6.0, d: 3.6, h: 3.5,
    color: "#c99a62", parts: [["timber", 0, 0, 1, 1, 0, 1, "main", { eave: 2.35, overhang: 0.4, roof: "tiles", clad: ["back", "right"], gutter: true, ridgeShift: 0.4 }]] },
  fence_post: { label: "Fence post", icon: "mdi:post-outline", cat: "Garden", w: 0.09, d: 0.09, h: 2.1, color: FENCE_WOOD, parts: [
    box(0, 0, 1, 1, 0, 0.98, "main"), box(-0.1, -0.1, 1.1, 1.1, 0.98, 1, "main3")] },
  fence_post_concrete: { label: "Concrete fence post", icon: "mdi:post-outline", cat: "Garden", w: 0.1, d: 0.1, h: 2.1, color: "#b9b6ae", parts: [
    box(0, 0, 1, 1, 0, 1, "main")] },

  // ----- Appliances -----
  fridge_xl: { label: "Side-by-side fridge", icon: "mdi:fridge-industrial-outline", cat: "Appliances", w: 0.91, d: 0.75, h: 1.8, color: "#c7cacd", screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.497, 1, 0.503, 1.01, 0.02, 0.98, "dark"),
    box(0.44, 1, 0.46, 1.05, 0.4, 0.75, "metal"), box(0.54, 1, 0.56, 1.05, 0.4, 0.75, "metal"), box(0.15, 1, 0.35, 1.01, 0.6, 0.68, "screen")] },
  freezer: { label: "Freezer", icon: "mdi:fridge-outline", cat: "Appliances", w: 0.6, d: 0.65, h: 1.55, color: COLORS.white, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.82, 1, 0.87, 1.05, 0.55, 0.85, "metal")] },
  dishwasher: { label: "Dishwasher", icon: "mdi:dishwasher", cat: "Appliances", w: 0.6, d: 0.6, h: 0.85, color: "#c7cacd", screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0, 0.98, 1, 1.01, 0.88, 0.98, "screen"), box(0.2, 1, 0.8, 1.04, 0.84, 0.86, "metal")] },
  oven_column: { label: "Oven column", icon: "mdi:stove", cat: "Appliances", w: 0.6, d: 0.6, h: 2.1, color: COLORS.white, screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.08, 1, 0.92, 1.01, 0.34, 0.58, "screen"), box(0.08, 1, 0.92, 1.01, 0.62, 0.78, "screen"),
    box(0.15, 1, 0.85, 1.04, 0.59, 0.6, "metal")] },
  microwave: { label: "Microwave", icon: "mdi:microwave", cat: "Appliances", w: 0.5, d: 0.38, h: 0.3, z: 0.92, color: "#c7cacd", screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.05, 1, 0.7, 1.01, 0.12, 0.88, "screen"), box(0.75, 1, 0.95, 1.01, 0.15, 0.85, "dark")] },
  range_hood: { label: "Range hood", icon: "mdi:fan-chevron-up", cat: "Appliances", w: 0.6, d: 0.5, h: 0.75, z: 1.5, color: "#c7cacd", parts: [
    box(0, 0, 1, 1, 0, 0.3, "main"), box(0.3, 0, 0.7, 0.5, 0.3, 1, "main"), box(0.05, 0.1, 0.95, 0.95, 0, 0.02, "dark")] },
  coffee_machine: { label: "Coffee machine", icon: "mdi:coffee-maker-outline", cat: "Appliances", w: 0.25, d: 0.4, h: 0.38, z: 0.92, color: COLORS.dark, screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.2, 0.6, 0.8, 1.02, 0, 0.05, "metal"), box(0.4, 0.75, 0.6, 0.92, 0.55, 0.65, "metal"),
    box(0.25, 1, 0.75, 1.01, 0.75, 0.9, "screen")] },
  kettle: { label: "Kettle", icon: "mdi:kettle-outline", cat: "Appliances", w: 0.22, d: 0.22, h: 0.26, z: 0.92, color: "#c7cacd", parts: [
    cyl(0, 0, 1, 1, 0, 0.07, "dark"), cyl(0.08, 0.08, 0.92, 0.92, 0.07, 0.9, "main"), box(0.44, 0.88, 0.56, 1, 0.3, 0.85, "dark")] },
  dryer: { label: "Dryer", icon: "mdi:tumble-dryer", cat: "Appliances", w: 0.598, d: 0.632, h: 0.842, color: COLORS.white, screen: true,
    laundry: "dryer", drum: { x: 0.5, z: 0.55 }, parts: laundryFront(true) },
  robot_vacuum: { label: "Robot vacuum", icon: "mdi:robot-vacuum", cat: "Appliances", robot: true, w: 0.35, d: 0.35, h: 0.1, color: COLORS.dark, parts: [
    cyl(0, 0, 1, 1, 0, 1, "main"), cyl(0.38, 0.12, 0.62, 0.36, 1, 1.08, "metal")] },
  vacuum_dock: { label: "Vacuum dock", icon: "mdi:home-import-outline", cat: "Appliances", w: 0.32, d: 0.16, h: 0.12, color: COLORS.dark, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.1, 0.9, 0.9, 1.4, 0, 0.08, "dark")] },
  robot_mower: { label: "Robot lawn mower", icon: "mdi:robot-mower", cat: "Garden", robot: "mower", w: 0.42, d: 0.6, h: 0.25, color: "#5b6a5d", parts: robotMower() },
  gardena_sileno_city: { label: "SILENO city", icon: "mdi:robot-mower", cat: "Gardena", robot: "mower", w: 0.39, d: 0.56, h: 0.24, color: "#5d666b", parts: robotMower({ accent: "gardena" }) },
  gardena_sileno_life: { label: "SILENO life", icon: "mdi:robot-mower", cat: "Gardena", robot: "mower", w: 0.41, d: 0.63, h: 0.25, color: "#5d666b", parts: robotMower({ accent: "gardena" }) },
  gardena_sileno_minimo: { label: "SILENO minimo", icon: "mdi:robot-mower", cat: "Gardena", robot: "mower", w: 0.37, d: 0.52, h: 0.22, color: "#6b7479", parts: robotMower({ accent: "gardena" }) },
  gardena_station: { label: "Charging station", icon: "mdi:home-lightning-bolt-outline", cat: "Gardena", w: 0.42, d: 0.55, h: 0.17, color: "#5d666b", parts: [
    // A low ramp the mower drives onto, the charging hood with its contacts at the back
    plan(0, 0, 1, 1, 0, 0.12, "dark", [[0.06, 0, 0.04], [0.94, 0, 0.04], [1, 0.7, 0.06], [0.85, 1, 0.05], [0.15, 1, 0.05], [0, 0.7, 0.06]], { bevel: 0.006 }),
    plan(0.12, 0, 0.88, 0.32, 0.1, 1, "main", [[0, 0, 0.04], [1, 0, 0.04], [1, 0.75, 0.05], [0, 0.75, 0.05]], { bevel: 0.02 }),
    plan(0.12, 0.02, 0.88, 0.32, 0.86, 0.92, "gardena", [[0, 0, 0.04], [1, 0, 0.04], [1, 0.75, 0.05], [0, 0.75, 0.05]]),
    box(0.4, 0.24, 0.6, 0.27, 0.35, 0.55, "metal"), cyl(0.48, 0.12, 0.52, 0.16, 1, 1.03, "led")] },
  air_purifier: { label: "Air purifier", icon: "mdi:air-purifier", cat: "Appliances", w: 0.3, d: 0.3, h: 0.6, color: COLORS.white, parts: [
    cyl(0, 0, 1, 1, 0, 1, "main"), cyl(0.12, 0.12, 0.88, 0.88, 1, 1.02, "dark")] },
  dehumidifier: { label: "Dehumidifier", icon: "mdi:air-humidifier", cat: "Appliances", w: 0.35, d: 0.25, h: 0.55, color: COLORS.white, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.1, 0.1, 0.9, 0.9, 1, 1.02, "dark")] },
  pedestal_fan: { label: "Pedestal fan", icon: "mdi:fan", cat: "Appliances", w: 0.45, d: 0.35, h: 1.25, color: COLORS.white, parts: [
    cyl(0.15, 0.1, 0.85, 0.9, 0, 0.03, "main"), cyl(0.47, 0.45, 0.53, 0.55, 0.03, 0.7, "main"),
    box(0.45, 0.4, 0.55, 0.62, 0.66, 0.74, "main"), box(0, 0.6, 1, 0.66, 0.5, 0.95, "metal")] },
  radiator: { label: "Panel radiator", icon: "mdi:radiator", cat: "Climate", heater: true, w: 1.0, d: 0.1, h: 0.6, z: 0.15, color: COLORS.white,
    parts: panelRadiator() },
  radiator_column: { label: "Column radiator", icon: "mdi:radiator", cat: "Climate", heater: true, w: 0.8, d: 0.12, h: 0.6, z: 0.12, color: COLORS.white,
    parts: columnRadiator(12) },
  radiator_vertical: { label: "Vertical radiator", icon: "mdi:radiator", cat: "Climate", heater: true, w: 0.45, d: 0.08, h: 1.8, z: 0.15, color: COLORS.dark,
    parts: verticalRadiator(6) },
  towel_radiator: { label: "Towel radiator", icon: "mdi:radiator", cat: "Climate", heater: true, w: 0.5, d: 0.06, h: 1.2, z: 0.3, color: COLORS.white,
    parts: towelRadiator(9) },
  convector: { label: "Trench convector (in floor)", icon: "mdi:radiator-disabled", cat: "Climate", heater: true, w: 1.5, d: 0.26, h: 0.02, color: COLORS.metal,
    parts: trenchConvector(24) },
  air_conditioner: { label: "Air conditioner", icon: "mdi:air-conditioner", cat: "Climate", w: 0.9, d: 0.25, h: 0.3, z: 2.0, color: COLORS.white, screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.05, 0.9, 0.95, 1.01, 0.05, 0.25, "dark"), box(0.75, 1, 0.9, 1.01, 0.6, 0.75, "screen")] },
  boiler: { label: "Boiler", icon: "mdi:water-boiler", cat: "Climate", w: 0.45, d: 0.35, h: 0.75, z: 1.2, color: COLORS.white, screen: true, parts: [
    box(0, 0, 1, 1, 0, 1, "main"), box(0.3, 1, 0.7, 1.01, 0.12, 0.22, "screen"), cyl(0.3, 0.3, 0.4, 0.4, -0.25, 0, "metal"), cyl(0.6, 0.3, 0.7, 0.4, -0.25, 0, "metal")] },

  half_round_sofa: { label: "Half-round sofa", icon: "mdi:sofa", cat: "Living", w: 2.6, d: 1.3, h: 0.85, color: "#7d8a9c", parts: [
    // a semicircle around the front-centre point: you sit facing inwards
    arc(0, 0, 1, 2, 0, 0.5, "main", { inner: 0.45, start: 180, end: 360 }),
    arc(0, 0, 1, 2, 0.5, 1, "main", { inner: 0.83, start: 180, end: 360 }),
    arc(0, 0, 1, 2, 0.5, 0.62, "main2", { inner: 0.48, outer: 0.82, start: 182, end: 270 }),
    arc(0, 0, 1, 2, 0.5, 0.62, "main2", { inner: 0.48, outer: 0.82, start: 270, end: 358 }),
    box(0, 0.93, 0.275, 1, 0, 0.7, "main"), box(0.725, 0.93, 1, 1, 0, 0.7, "main")] },

  corner_sofa: cornerSofa(false),
  corner_sofa_left: cornerSofa(true),

  // Ligne Roset Togo: 70 cm high, seat at 38 cm, 102 cm deep (the ottoman 87 x 80 x 34 cm)
  togo_chair: { label: "Togo fireside chair", icon: "mdi:sofa-single", cat: "Ligne Roset", w: 0.87, d: 1.02, h: 0.7,
    color: TOGO, parts: togo(0.87) },
  togo_loveseat: { label: "Togo loveseat, 2-seat", icon: "mdi:sofa-outline", cat: "Ligne Roset", w: 1.31, d: 1.02, h: 0.7,
    color: TOGO, parts: togo(1.31) },
  togo_sofa: { label: "Togo sofa, 3-seat", icon: "mdi:sofa", cat: "Ligne Roset", w: 1.74, d: 1.02, h: 0.7,
    color: TOGO, parts: togo(1.74, { arms: true }) },
  togo_corner: { label: "Togo corner", icon: "mdi:sofa-single-outline", cat: "Ligne Roset", w: 1.02, d: 1.02, h: 0.7,
    color: TOGO, parts: togo(1.02, { corner: true }) },
  togo_ottoman: { label: "Togo ottoman", icon: "mdi:square-rounded-outline", cat: "Ligne Roset", w: 0.87, d: 0.8, h: 0.34,
    color: TOGO, parts: togo(0.87, { ottoman: true }) },

  security_camera: { label: "Security camera (wall)", icon: "mdi:cctv", cat: "Eufy", w: 0.1, d: 0.2, h: 0.12, z: 2.4, color: COLORS.white,
    fov: { angle: 110, range: 5 }, parts: [
    box(0.12, 0, 0.88, 0.08, 0.05, 0.95, "main"), cyl(0.35, 0.08, 0.65, 0.35, 0.35, 0.65, "main"),
    box(0.05, 0.3, 0.95, 0.94, 0.12, 0.95, "main"), cyl(0.2, 0.92, 0.8, 1, 0.25, 0.85, "dark")] },
  floodlight_camera: { label: "Floodlight camera", icon: "mdi:cctv", cat: "Eufy", w: 0.3, d: 0.18, h: 0.2, z: 2.4, color: COLORS.white,
    fov: { angle: 130, range: 6 }, floodlight: { angle: 110, range: 8 }, parts: [
    box(0.3, 0, 0.7, 0.12, 0.2, 0.9, "main"), box(0, 0.12, 0.45, 0.6, 0.55, 1, "main"), box(0.55, 0.12, 1, 0.6, 0.55, 1, "main"),
    box(0.02, 0.6, 0.43, 0.66, 0.6, 0.95, "canvas"), box(0.57, 0.6, 0.98, 0.66, 0.6, 0.95, "canvas"),
    box(0.35, 0.3, 0.65, 0.95, 0, 0.45, "main"), cyl(0.42, 0.92, 0.58, 1, 0.1, 0.35, "dark")] },
  indoor_camera: { label: "Indoor camera", icon: "mdi:webcam", cat: "Eufy", w: 0.08, d: 0.08, h: 0.12, z: 0.75, color: COLORS.white,
    fov: { angle: 125, range: 4 }, parts: [
    cyl(0, 0, 1, 1, 0, 0.35, "main"), ball(0.05, 0.05, 0.95, 0.95, 0.3, 1, "main"), cyl(0.3, 0.85, 0.7, 1, 0.5, 0.8, "dark")] },
  homebase: { label: "HomeBase / hub", icon: "mdi:router-wireless", cat: "Eufy", w: 0.2, d: 0.2, h: 0.08, z: 0.75, color: COLORS.white, parts: [
    box(0, 0, 1, 1, 0, 0.9, "main"), box(0.1, 0.1, 0.9, 0.9, 0.9, 1, "main2"), box(0.45, 0.98, 0.55, 1.01, 0.4, 0.6, "dark")] },
  stairs: { label: "Staircase", icon: "mdi:stairs", cat: "Structure", w: 0.9, d: 3.6, h: STAIR_H, color: COLORS.wood,
    parts: straightStairs() },
  stairs_quarter: { label: "Staircase, quarter turn", icon: "mdi:stairs-up", cat: "Structure", w: 1.9, d: 2.4, h: STAIR_H, color: COLORS.wood,
    parts: quarterTurnStairs() },
  stairs_spiral: { label: "Spiral staircase", icon: "mdi:rotate-right", cat: "Structure", w: 1.6, d: 1.6, h: STAIR_H, color: "#6d7178",
    parts: spiralStairs() },
  floor_hole: { label: "Floor opening (stairwell / vide)", icon: "mdi:select-group", cat: "Structure", hole: true,
    w: 1.0, d: 2.6, h: 0.01, color: "#000000", parts: [] },
  box: { label: "Box", icon: "mdi:cube-outline", cat: "Other", w: 0.6, d: 0.6, h: 0.6, color: "#b0b4ba", parts: [
    box(0, 0, 1, 1, 0, 1, "main")] },
};

export const CATEGORIES = ["Living", "Dining", "Bedroom", "Lighting", "Office", "Multimedia", "Sonos", "Philips Hue", "Samsung", "DALI", "Apple", "NAD", "Sony", "Ligne Roset", "Eufy", "Gardena", "Kitchen", "Appliances", "Climate", "Security", "Bathroom", "Garden", "Structure", "Other"];

/** Categories shown inside another one in the catalog (a brand's range under its kind of thing). */
export const SUBCATEGORIES = {
  Sonos: "Multimedia", Samsung: "Multimedia", DALI: "Multimedia", Apple: "Multimedia", NAD: "Multimedia", Sony: "Multimedia",
  "Philips Hue": "Lighting",
  "Ligne Roset": "Living",
  Eufy: "Security",
  Gardena: "Garden",
};

export const catalogItem = (type) => CATALOG[type] || CATALOG.box;

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The media player on the amplifier's selected input: a piece connected to the
 * amplifier on that input (`connected_to` / `connected_input`), or else a piece named after
 * that input (its own name, catalog name or entity name), e.g. input "Apple TV" ->
 * the "Apple TV 4K" piece linked to media_player.living_room_apple_tv.
 */
export function sourcePlayer(hass, ampId, pieces) {
  const source = squash(hass?.states?.[ampId]?.attributes?.source);
  if (source.length < 2) return null;
  // Pieces connected to this amplifier on a known input come first
  const wired = pieces.find((p) => p.entity_id && p.connected_to === ampId && squash(p.connected_input) === source);
  if (wired) return wired.entity_id;
  for (const p of pieces) {
    if (!p.entity_id || p.entity_id === ampId || domainOf(p.entity_id) !== "media_player" || catalogItem(p.type).passive) continue;
    const names = [p.name, catalogItem(p.type).label.split(" (")[0], friendlyName(hass, p.entity_id)].map(squash).filter((n) => n.length >= 2);
    if (names.some((n) => n.includes(source) || source.includes(n))) return p.entity_id;
  }
  return null;
}

/** The device whose output goes into this TV (`connected_to` on the feeding device). */
export function displayFeed(tv, pieces) {
  if (!tv.entity_id) return null;
  return pieces.find((p) => p !== tv && p.entity_id && p.connected_to === tv.entity_id) || null;
}

/**
 * TVs have no output: older plans stored a TV's connection on the TV itself (the
 * receiver feeding it, or by mistake the player it's fed by). Move a receiver link onto
 * the receiver's output and drop the rest. Returns whether anything changed.
 */
export function tidyAvWiring(doc) {
  let changed = false;
  for (const floor of doc?.floors || []) {
    const pieces = floor.furniture || [];
    for (const tv of pieces) {
      if (catalogItem(tv.type).av !== "display" || (!tv.connected_to && !tv.connected_input)) continue;
      const target = pieces.find((p) => p !== tv && p.entity_id && p.entity_id === tv.connected_to);
      if (target && tv.entity_id && catalogItem(target.type).av === "receiver" && !target.connected_to && !displayFeed(tv, pieces)) {
        target.connected_to = tv.entity_id;
      }
      tv.connected_to = null;
      tv.connected_input = null;
      changed = true;
    }
  }
  return changed;
}

/** Caption for a player: title, show/app and where it comes from. */
function describePlayer(hass, playerId, via) {
  const player = hass.states[playerId];
  if (!player || !isScreenOn(player)) return null;
  if (domainOf(playerId) !== "media_player") {
    // A game console known by its online status: the game being played and its cover
    const game = consolePlaying(hass, playerId);
    return { title: game?.title || friendlyName(hass, playerId), subtitle: via ? t("via {name}", { name: via }) : "", app: "PlayStation",
      picture: game?.picture || null, paused: false };
  }
  const a = player.attributes || {};
  // An app in front that the player's Now Playing info doesn't belong to (Odido TV
  // while the Apple TV still reports a paused Plex episode): show just that app
  const focus = foregroundApp(hass, playerId);
  if (focus && focus.bundle !== a.app_id) {
    return { title: focus.name, subtitle: via ? t("via {name}", { name: via }) : "", app: focus.name, picture: null, paused: false };
  }
  const show = a.media_series_title || a.media_artist;
  return {
    title: a.media_title || a.app_name || friendlyName(hass, playerId),
    subtitle: [show, a.media_title ? a.app_name : null, via ? t("via {name}", { name: via }) : null].filter(Boolean).join(" · "),
    app: a.app_name || "",
    picture: a.entity_picture || null,
    paused: player.state === "paused",
  };
}

/**
 * What a TV shows from the device plugged into its input: through a receiver, the
 * player on the receiver's selected input (or just that input's name, e.g. "Phono");
 * straight from a player (an Apple TV), that player. Null while the feed is off.
 */
export function tvSource(hass, tv, pieces) {
  const feed = displayFeed(tv, pieces);
  const st = feed && hass?.states?.[feed.entity_id];
  if (!st || !isScreenOn(st)) return null;
  if (catalogItem(feed.type).av !== "receiver") {
    return describePlayer(hass, feed.entity_id, feed.name || catalogItem(feed.type).label.split(" (")[0]);
  }
  const input = st.attributes?.source || "";
  const playerId = sourcePlayer(hass, feed.entity_id, pieces);
  const shown = playerId && describePlayer(hass, playerId, input);
  if (shown) return shown;
  return input ? { title: input, subtitle: friendlyName(hass, feed.entity_id), app: "", picture: null, paused: false } : null;
}

/**
 * Is a piece making sound (only speakers do)? Wired speakers follow their amplifier: while it's on and
 * not muted, the player on its input decides (playing or not); without one, an
 * amplifier that's on counts as playing.
 */
export function pieceSounding(hass, piece, pieces) {
  const st = hass?.states?.[piece.entity_id];
  const def = catalogItem(piece.type);
  if (def.speaker && piece.surround && def.surround) return surroundLevel(hass, piece.entity_id) > 0;
  if (def.speaker && piece.surround && def.sub) return subLevel(hass, piece.entity_id) > 0;
  if (def.speaker) return isPlaying(st);
  if (!def.passive) return false; // players, TVs, receivers: the speakers show the sound
  if (!isSounding(st, true)) return false;
  if (isPlaying(st)) return true;
  const player = sourcePlayer(hass, piece.entity_id, pieces);
  if (!player) return true;
  // Players say whether they're playing; a console that's online counts as making sound
  return domainOf(player) === "media_player" ? isPlaying(hass.states[player]) : isScreenOn(hass.states[player]);
}

/** Smallest sizes the server stores (metres); thinner catalog pieces start at these. */
export const MIN_SIZE = 0.05;
export const MIN_HEIGHT = 0.01;

export function newFurniture(type, x, y) {
  const def = catalogItem(type);
  return {
    id: uid(), type, name: null, x, y, w: Math.max(MIN_SIZE, def.w), d: Math.max(MIN_SIZE, def.d), h: Math.max(MIN_HEIGHT, def.h),
    z: def.z || 0, rotation: 0,
    color: null, entity_id: null, tap_action: "more-info", show_state: false,
  };
}

export const duplicateFurniture = (f) => ({ ...clone(f), id: uid(), x: f.x + 0.3, y: f.y + 0.3 });

/** Hex colour, `amount` (0..1) of the way to white. */
const HOT = "#ff5a2c";

/** Mix two colours ("#rrggbb" or "rgb(r,g,b)"); t = 0 gives a, 1 gives b. */
export function mixColor(a, b, t) {
  const parse = (c) => {
    const m = String(c).match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) return m.slice(1, 4).map(Number);
    const n = parseInt(String(c).replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [x, y] = [parse(a), parse(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

export function darken(hex, amount) {
  const n = parseInt(String(hex).replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  if (Number.isNaN(n)) return hex;
  const ch = (s) => Math.round(((n >> s) & 255) * (1 - amount));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function lighten(hex, amount) {
  const n = parseInt(String(hex).replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  if (Number.isNaN(n)) return hex;
  const ch = (s) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * amount);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function partColor(key, item) {
  const main = safeColor(item.color) || catalogItem(item.type).color;
  if (key === "main") return main;
  if (key === "main2") return lighten(main, 0.25);
  if (key === "main3") return darken(main, 0.14);
  return COLORS[key] || main;
}

/** Plan point -> piece-local coordinates (origin at its centre, unrotated). */
export function toLocal(f, p) {
  const a = (-(f.rotation || 0) * Math.PI) / 180;
  const dx = p[0] - f.x;
  const dy = p[1] - f.y;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Piece-local coordinates -> plan point. */
export function toWorld(f, l) {
  const a = ((f.rotation || 0) * Math.PI) / 180;
  return [f.x + l[0] * Math.cos(a) - l[1] * Math.sin(a), f.y + l[0] * Math.sin(a) + l[1] * Math.cos(a)];
}

export const containsPoint = (f, p, pad = 0) => {
  const [lx, ly] = toLocal(f, p);
  return Math.abs(lx) <= f.w / 2 + pad && Math.abs(ly) <= f.d / 2 + pad;
};

/**
 * Height of the bottom of a piece. Ceiling pieces hang from the floor's ceiling
 * (their height is the drop length); others stand at `z` (0 = on the floor).
 */
export function baseHeight(f, ceiling = 2.6) {
  return catalogItem(f.type).ceiling ? Math.max(0, ceiling - f.h) : f.z || 0;
}

/** Where a lamp's light sits: [x, y, height] in plan coordinates. */
/**
 * A lamp's spotlight half-angle in radians: its own beam angle (full width, in
 * degrees) if set, else the catalog default. `null` for pieces without a light.
 */
export function beamHalfAngle(f) {
  const l = catalogItem(f.type).light;
  if (!l) return null;
  if (f.beam_angle) return (Math.min(170, Math.max(5, f.beam_angle)) / 2) * (Math.PI / 180);
  return l.angle ?? 1.3;
}

/** A directional spot's tilt in radians (0 = straight down); 0 for other pieces. */
export const tiltOf = (f) => (catalogItem(f.type).tilt ? (Math.min(85, Math.max(0, f.tilt || 0)) * Math.PI) / 180 : 0);

/**
 * Where a lamp shines: [plan x, plan y, up] (unit vector), or null when it shines straight
 * down (or as its catalog says). Directional spots point forward by their tilt.
 */
export function lightDirection(f) {
  const a = tiltOf(f);
  if (!a) return null;
  return [...toWorld({ ...f, x: 0, y: 0 }, [0, Math.sin(a)]), -Math.cos(a)];
}

/** Default full beam angle of a catalog piece, in whole degrees (for the inspector). */
export const defaultBeamAngle = (type) => Math.round((((catalogItem(type).light?.angle ?? 1.3) * 2) * 180) / Math.PI);

export function lightAnchor(f, ceiling) {
  const def = catalogItem(f.type);
  const l = def.light || {};
  const dir = lightDirection(f);
  if (dir) {
    // A tilted spot: its lens swings out with the body, around the joint
    const pivot = baseHeight(f, ceiling) + def.tilt.pivot * f.h;
    const reach = (def.tilt.pivot - (l.z ?? 0)) * f.h;
    return [f.x + dir[0] * reach, f.y + dir[1] * reach, pivot + dir[2] * reach];
  }
  const [x, y] = toWorld(f, [((l.x ?? 0.5) - 0.5) * f.w, ((l.y ?? 0.5) - 0.5) * f.d]);
  return [x, y, baseHeight(f, ceiling) + (l.z ?? 1) * f.h];
}

const sortedParts = (def) => [...def.parts].sort((a, b) => a[6] - b[6]);

/** Top-down SVG for a piece in local coordinates (centre at 0,0). */
export function furnitureSvg(f, { activeScreen = false, glowColor = null, tvPlaying = false, heat = 0, lampLit = false } = {}) {
  const def = catalogItem(f.type);
  if (def.hole) {
    // Opening in the floor: shaded box with a cross, as on architectural drawings
    const [x, y] = [-f.w / 2, -f.d / 2];
    return `<rect class="hole" x="${x}" y="${y}" width="${f.w}" height="${f.d}"/>
      <path class="hole-x" d="M${x},${y} L${-x},${-y} M${-x},${y} L${x},${-y}"/>`;
  }
  return sortedParts(def)
    .map((part) => {
      const [shape, x0, y0, x1, y1, , , key, opts] = part;
      const lx = (x0 - 0.5) * f.w;
      const ly = (y0 - 0.5) * f.d;
      const w = (x1 - x0) * f.w;
      const h = (y1 - y0) * f.d;
      let fill = partColor(key, f);
      let cls = "";
      if (key === "screen" && activeScreen) fill = "#cfe7ff";
      if (key === "canvas" && activeScreen) fill = "#eaf3ff";
      if (key === "canvas" && lampLit) fill = "#fff4c8";
      // Shimmers (plan CSS); the phase follows the clock so redraws don't restart it
      if ((key === "screen" || key === "canvas") && tvPlaying) {
        // ...offset per piece, so several TVs don't change colour in step
        const offset = [...String(f.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 7000, 0) / 1000;
        cls = ` class="tv-on" style="animation-delay:${(-((Date.now() / 1000 + offset) % 7)).toFixed(2)}s"`;
      }
      if (key === "shade" && glowColor) fill = glowColor;
      // A heating radiator warms up to orange-red
      if (heat > 0 && key.startsWith("main")) fill = mixColor(fill, HOT, 0.35 + 0.4 * heat);
      if (shape === "tube") {
        const pts = (opts?.points || []).map(([x]) => `${((x - 0.5) * f.w).toFixed(3)},0`);
        return pts.length ? `<polyline points="${pts.join(" ")}" fill="none" stroke="${fill}" stroke-width="${Math.max(0.02, (opts.radius || 0.015) * 2)}"/>` : "";
      }
      if (shape === "timberflat") {
        // From above: the roof, with the posts underneath (dashed)
        const posts = flatShelterPosts(f, opts || {}).map(([x, y]) =>
          `<rect x="${x - 0.07}" y="${y - 0.07}" width="0.14" height="0.14" fill="none" stroke-dasharray="0.04 0.03"/>`).join("");
        return `<rect x="${-f.w / 2}" y="${-f.d / 2}" width="${f.w}" height="${f.d}" fill="#2e3033" fill-opacity=".35"/>
          <rect x="${-f.w / 2 + 0.03}" y="${-f.d / 2 + 0.03}" width="${f.w - 0.06}" height="${f.d - 0.06}" fill="none" stroke="${fill}" stroke-width="0.06"/>${posts}`;
      }
      if (shape === "timber") {
        // From above: the roof, its ridge, and the posts underneath (dashed)
        const L = timberLayout(f, opts || {});
        const posts = [...L.posts, ...L.gablePosts].map(([x, y]) => `<rect x="${x - 0.07}" y="${y - 0.07}" width="0.14" height="0.14" fill="none" stroke-dasharray="0.04 0.03"/>`).join("");
        const clad = (opts?.clad || []).map((side) => {
          const [x0, x1] = [L.xs[0], L.xs[L.xs.length - 1]];
          const [a, b] = side === "back" ? [[x0, -L.hd], [x1, -L.hd]] : side === "left" ? [[x0, -L.hd], [x0, L.hd]] : [[x1, -L.hd], [x1, L.hd]];
          return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${opts.cladColor || "#26282b"}" stroke-width="0.09"/>`;
        }).join("");
        const roofFill = opts?.roof === "tiles" ? opts.roofColor || "#34373b" : fill;
        return `<rect x="${-f.w / 2}" y="${-f.d / 2}" width="${f.w}" height="${f.d}" fill="${roofFill}" fill-opacity=".45"/>
          <line x1="${-f.w / 2}" y1="${(opts?.ridgeShift || 0) * L.hd}" x2="${f.w / 2}" y2="${(opts?.ridgeShift || 0) * L.hd}" stroke="rgba(0,0,0,.45)" stroke-width="0.03"/>${clad}${posts}`;
      }
      if (shape === "pot") {
        const [cx, cy, rx, ry] = [lx + w / 2, ly + h / 2, w / 2, h / 2];
        return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>
          <ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.86}" ry="${ry * 0.86}" fill="${partColor("soil", f)}" stroke="none"/>`;
      }
      if (shape === "fronds") {
        // Seen from above: a star of leaves around the crown
        const n = opts?.n ?? 10;
        const [cx, cy] = [lx + w / 2, ly + h / 2];
        const leaves = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + (i % 2) * 0.25;
          const r = (Math.min(w, h) / 2) * (0.75 + 0.25 * (((i * 7) % n) / n));
          const [dx, dy] = [Math.cos(a), Math.sin(a)];
          const side = r * (opts?.kind === "fan" ? 0.3 : 0.13);
          const [tx, ty] = [cx + dx * r, cy + dy * r];
          const [mx, my] = [cx + dx * r * 0.55, cy + dy * r * 0.55];
          leaves.push(`M${cx},${cy} Q${mx - dy * side},${my + dx * side} ${tx},${ty} Q${mx + dy * side},${my - dx * side} ${cx},${cy} Z`);
        }
        return `<path d="${leaves.join(" ")}" fill="${fill}" fill-opacity=".9"/>`;
      }
      if (shape === "cloth") {
        // Seen from above: the cloth's top edge, as a soft ribbon in its first colour
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const [x, y] = clothPoint(part, i / 24, 0.5);
          pts.push(`${((x - 0.5) * f.w).toFixed(3)},${((y - 0.5) * f.d).toFixed(3)}`);
        }
        return `<polyline points="${pts.join(" ")}" fill="none" stroke="${partColor((opts?.stripes || ["main"])[0], f)}"
          stroke-width="0.04" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      if (shape === "arc") {
        const { inner = 0, outer = 1, start = 0, end = 360 } = opts || {};
        const rx = ((x1 - x0) / 2) * f.w;
        const ry = ((y1 - y0) / 2) * f.d;
        const large = end - start > 180 ? 1 : 0;
        const [ox0, oy0] = arcPoint(f, x0, y0, x1, y1, outer, start);
        const [ox1, oy1] = arcPoint(f, x0, y0, x1, y1, outer, end);
        const [ix1, iy1] = arcPoint(f, x0, y0, x1, y1, inner, end);
        const [ix0, iy0] = arcPoint(f, x0, y0, x1, y1, inner, start);
        return `<path fill="${fill}" d="M${ox0},${oy0} A${rx * outer},${ry * outer} 0 ${large} 1 ${ox1},${oy1}
          L${ix1},${iy1} A${rx * inner},${ry * inner} 0 ${large} 0 ${ix0},${iy0} Z"/>`;
      }
      if (shape === "plan") {
        // Seen from above: its outline (holes left open)
        const at = ([u, v, r = 0]) => [(x0 + u * (x1 - x0) - 0.5) * f.w, (y0 + v * (y1 - y0) - 0.5) * f.d, r];
        const d = [opts?.points || [], ...(opts?.holes || [])].filter((o) => o.length).map((o) => svgOutline(o.map(at))).join(" ");
        return `<path${cls} d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
      }
      if (shape === "front") return `<rect${cls} x="${lx}" y="${ly}" width="${w}" height="${h}" rx="${opts?.bevel || 0}" fill="${fill}"/>`;
      if (shape === "profile") {
        // Seen from above: its footprint, with the ends' rounding
        const us = (opts?.points || [[0], [1]]).map(([u]) => y0 + u * (y1 - y0));
        const [a, b] = [Math.min(...us), Math.max(...us)];
        return `<rect x="${lx}" y="${(a - 0.5) * f.d}" width="${w}" height="${(b - a) * f.d}" rx="${opts?.bevel || 0}" fill="${fill}"/>`;
      }
      return shape === "box" || (shape === "cyl" && opts === "side")
        ? `<rect${cls} x="${lx}" y="${ly}" width="${w}" height="${h}" fill="${fill}"/>`
        : `<ellipse cx="${lx + w / 2}" cy="${ly + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"/>`;
    })
    .join("");
}

/**
 * Build a 3D model. Returns the group plus materials whose look depends on
 * entity state.
 */
export function buildFurniture3D(THREE, f, { ceiling } = {}) {
  const def = catalogItem(f.type);
  const group = new THREE.Group();
  // Parts marked "spin" (fan blades) turn around the piece's vertical centre line; "drum"
  // and "load" (a washing machine's drum and laundry) around the door's centre
  let spinner = null;
  let drum = null;
  let load = null;
  let tilter = null;
  const mats = { screen: [], shade: [], main: [] };
  const cache = new Map();
  const material = (key) => {
    if (cache.has(key)) return cache.get(key);
    const color = new THREE.Color(partColor(key, f));
    let m;
    if (key === "fabric") {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    } else if (key === "glass") {
      m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.4, roughness: 0.1 });
    } else if (key === "smoke") {
      // tinted, but the drum shows through
      m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false });
    } else if (key === "screen" || key === "canvas") {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.2 });
      mats.screen.push(m);
    } else if (key === "shade") {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
      mats.shade.push(m);
    } else {
      // "…_metal" parts are the piece's own colour as brushed metal (e.g. "main_metal")
      const metallic = key === "metal" || key === "brass" || key === "chrome";
      // Anodised aluminium: only a little metallic, as there are no reflections to show
      const anodised = key.endsWith("_metal");
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: key === "brass" || key === "chrome" ? 0.3 : key === "gloss" || key === "smoke" ? 0.15 : anodised ? 0.45 : metallic ? 0.4 : 0.8,
        metalness: key === "brass" ? 0.8 : metallic ? 0.5 : anodised ? 0.2 : 0,
      });
      if (key === "grille" || key.endsWith("_grille")) {
        m.map = grilleTexture(THREE);
        m.roughness = 0.7;
      }
      if (key.startsWith("main")) {
        m.userData.baseColor = color.clone(); // so a heating radiator can warm up and cool down again
        mats.main.push(m);
      }
    }
    cache.set(key, m);
    return m;
  };
  for (const [shape, x0, y0, x1, y1, z0, z1, key, flag] of def.parts) {
    const sx = Math.max((x1 - x0) * f.w, 0.005);
    const sz = Math.max((y1 - y0) * f.d, 0.005);
    const sy = Math.max((z1 - z0) * f.h, 0.005);
    if (shape === "arc") {
      const { inner = 0, outer = 1, start = 0, end = 360 } = flag || {};
      const p = (factor, deg) => arcPoint(f, x0, y0, x1, y1, factor, deg);
      const steps = Math.max(8, Math.ceil(((end - start) / 360) * 64));
      const pts = [];
      for (let i = 0; i <= steps; i++) pts.push(p(outer, start + ((end - start) * i) / steps));
      for (let i = steps; i >= 0; i--) pts.push(p(inner, start + ((end - start) * i) / steps));
      const shape2d = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const depth = Math.max((z1 - z0) * f.h, 0.005);
      const geo2 = new THREE.ExtrudeGeometry(shape2d, { depth, bevelEnabled: false, curveSegments: 1 });
      geo2.rotateX(Math.PI / 2); // shape y -> piece depth (z), extrusion -> downwards
      geo2.translate(0, z1 * f.h, 0);
      const arcMesh = new THREE.Mesh(geo2, material(key));
      arcMesh.castShadow = true;
      arcMesh.receiveShadow = true;
      arcMesh.userData.furniture = f;
      group.add(arcMesh);
      continue;
    }
    if (shape === "cloth") {
      group.add(clothMesh(THREE, f, [shape, x0, y0, x1, y1, z0, z1, key, flag]));
      continue;
    }
    if (shape === "profile") {
      group.add(profileMesh(THREE, f, [shape, x0, y0, x1, y1, z0, z1, key, flag], material(key)));
      continue;
    }
    if (shape === "plan" || shape === "front") {
      group.add(outlineMesh(THREE, f, [shape, x0, y0, x1, y1, z0, z1, key, flag], material(key)));
      continue;
    }
    if (shape === "tube") {
      const { points = [], radius = 0.015 } = flag || {};
      const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3((x - 0.5) * f.w, z * f.h, 0)));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, radius, 12, false), material(key));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.furniture = f;
      group.add(mesh);
      continue;
    }
    if (shape === "lathe") {
      const pts = (flag || [[1, 0], [1, 1]]).map(([r, z]) => new THREE.Vector2(Math.max(0.001, r) * 0.5, z - 0.5));
      const mat = material(key);
      if (mat.side !== THREE.DoubleSide) mat.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(((x0 + x1) / 2 - 0.5) * f.w, ((z0 + z1) / 2) * f.h, ((y0 + y1) / 2 - 0.5) * f.d);
      mesh.castShadow = key !== "shade";
      mesh.receiveShadow = true;
      mesh.userData.furniture = f;
      group.add(mesh);
      continue;
    }
    if (shape === "timber") {
      group.add(timberShedMesh(THREE, f, flag || {}, material(key)));
      continue;
    }
    if (shape === "timberflat") {
      group.add(flatShelterMesh(THREE, f, flag || {}, material(key)));
      continue;
    }
    if (shape === "pot") {
      group.add(potMesh(THREE, f, [shape, x0, y0, x1, y1, z0, z1, key, flag], material(key), material("soil")));
      continue;
    }
    if (shape === "fronds") {
      group.add(frondsMesh(THREE, f, [shape, x0, y0, x1, y1, z0, z1, key, flag], partColor(key, f)));
      continue;
    }
    let geo;
    if (shape === "box") geo = new THREE.BoxGeometry(1, 1, 1);
    else if (shape === "cyl" && flag === "side") geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32).rotateZ(Math.PI / 2); // a wheel on its axle
    else if (shape === "cyl" && (flag === "front" || flag === "drum" || flag === "load")) geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32).rotateX(Math.PI / 2); // a knob facing forward
    else if (shape === "cyl") geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1, key === "shade" && flag !== "solid");
    else geo = new THREE.SphereGeometry(0.5, 24, 16);
    const mesh = new THREE.Mesh(geo, material(key));
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(((x0 + x1) / 2 - 0.5) * f.w, ((z0 + z1) / 2) * f.h, ((y0 + y1) / 2 - 0.5) * f.d);
    mesh.castShadow = key !== "shade" && key !== "glass";
    mesh.receiveShadow = true;
    mesh.userData.furniture = f;
    if (flag === "spin") {
      if (!spinner) {
        spinner = new THREE.Group();
        group.add(spinner);
      }
      spinner.add(mesh);
    } else if (flag === "drum" || flag === "load") {
      // Turns around the drum's centre (the door's): the group sits there, its parts around it
      const pivot = [((def.drum?.x ?? 0.5) - 0.5) * f.w, (def.drum?.z ?? 0.5) * f.h];
      const holder = flag === "drum" ? (drum ||= new THREE.Group()) : (load ||= new THREE.Group());
      if (!holder.parent) {
        holder.position.set(pivot[0], pivot[1], 0);
        group.add(holder);
      }
      mesh.position.x -= pivot[0];
      mesh.position.y -= pivot[1];
      mesh.castShadow = false;
      holder.add(mesh);
    } else if (def.tilt && z1 <= def.tilt.pivot + 1e-6) {
      // A directional spot's body: tilts forward around its joint
      if (!tilter) {
        tilter = new THREE.Group();
        tilter.position.set(0, def.tilt.pivot * f.h, 0);
        tilter.rotation.x = -tiltOf(f);
        group.add(tilter);
      }
      mesh.position.y -= def.tilt.pivot * f.h;
      tilter.add(mesh);
    } else {
      group.add(mesh);
    }
  }
  let ambilight = null;
  if (def.ambilight) {
    ambilight = ambilightMaterial(THREE, f);
    const { uSpread } = ambilight.uniforms;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(f.w + 2 * uSpread.value, f.h + 2 * uSpread.value), ambilight);
    glow.position.set(0, f.h / 2, -f.d / 2 + 0.004); // on the wall, just in front of it
    glow.renderOrder = 9;
    glow.raycast = () => {}; // the glow isn't part of the piece for taps
    group.add(glow);
  }
  group.position.set(f.x, baseHeight(f, ceiling), f.y);
  group.rotation.y = (-(f.rotation || 0) * Math.PI) / 180; // plan rotation is clockwise
  mergeParts(THREE, group, f);
  return { group, mats, spinner, ambilight, drum, load };
}

/**
 * Fewer draw calls: a piece is drawn from many parts (legs, cushions, a frame), each its
 * own mesh and draw call, again for every shadow map. The fixed parts that share a
 * material and shadow settings become one mesh, which looks the same. Moving parts (in
 * their own groups: fan blades, a drum, a tilting spot), and meshes with a role of their
 * own (a roof, a glow), stay as they are. A plan with a hundred pieces drops from
 * thousands of draw calls to hundreds, which slower GPUs need.
 */
function mergeParts(THREE, group, f) {
  const buckets = new Map();
  for (const m of group.children) {
    if (!m.isMesh || m.children.length || m.renderOrder || Array.isArray(m.material)) continue;
    if (m.raycast !== THREE.Mesh.prototype.raycast || Object.keys(m.userData).some((k) => k !== "furniture")) continue;
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geometry = mergeGeometries(THREE, meshes);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, meshes[0].material);
    mesh.castShadow = meshes[0].castShadow;
    mesh.receiveShadow = meshes[0].receiveShadow;
    mesh.userData.furniture = f;
    for (const m of meshes) {
      group.remove(m);
      m.geometry.dispose();
    }
    group.add(mesh);
  }
}

/** One geometry from several meshes (each in its place in the group); null if they don't fit together. */
export function mergeGeometries(THREE, meshes) {
  return mergeSlices(THREE, meshes.map((m) => {
    m.updateMatrix();
    return { geometry: m.geometry, matrix: m.matrix };
  }));
}

/**
 * One geometry from slices of others: { geometry, matrix, start?, count? }, where start
 * and count pick a range of a multi-material geometry's triangles (one of its groups;
 * the whole geometry when left out). Null if they don't fit together.
 */
export function mergeSlices(THREE, slices) {
  const parts = slices.map(({ geometry, matrix, start = 0, count }) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry; // group ranges stay valid
    const n = count ?? flat.attributes.position.count - start;
    const g = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "uv"]) {
      const attr = flat.attributes[name];
      if (!attr || attr.isInterleavedBufferAttribute) continue;
      g.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(start * attr.itemSize, (start + n) * attr.itemSize), attr.itemSize));
    }
    if (flat !== geometry) flat.dispose();
    g.applyMatrix4(matrix);
    return g;
  });
  if (parts.some((g) => g.attributes.position?.itemSize !== 3 || g.attributes.normal?.itemSize !== 3)) return null;
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const merged = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["normal", 3], ["uv", 2]]) {
    const out = new Float32Array(total * size);
    let at = 0;
    for (const g of parts) {
      const attr = g.attributes[name];
      if (attr?.itemSize === size) out.set(attr.array, at); // a part without uv keeps zeros
      at += g.attributes.position.count * size;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** Perforated metal: a hole every 3 mm (for parts with world-sized UVs, like `profile`). */
let grilleTex = null;
function grilleTexture(THREE) {
  if (grilleTex) return grilleTex;
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; // tinted by the material's colour
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = "#3a3a3a";
  g.beginPath();
  g.arc(8, 8, 4.2, 0, Math.PI * 2);
  g.fill();
  grilleTex = new THREE.CanvasTexture(c);
  grilleTex.wrapS = grilleTex.wrapT = THREE.RepeatWrapping;
  grilleTex.repeat.set(1 / 0.003, 1 / 0.003);
  grilleTex.colorSpace = THREE.SRGBColorSpace;
  grilleTex.anisotropy = 8;
  return grilleTex;
}

/** A `profile` part: its outline (rounded where asked) pushed out along the width. */
function profileMesh(THREE, f, [, x0, y0, x1, y1, z0, z1, , { points = [], bevel = 0 } = {}], mat) {
  // Outline in the piece's depth (shape x, front = +) and height (shape y)
  const pts = points.map(([u, v, r = 0]) => [(y0 + u * (y1 - y0) - 0.5) * f.d, (z0 + v * (z1 - z0)) * f.h, r]);
  const outline = roundedOutline(new THREE.Shape(), pts);
  const length = Math.max((x1 - x0) * f.w, 0.002);
  const bt = Math.max(0, Math.min(bevel, length / 2 - 0.0005));
  const geo = new THREE.ExtrudeGeometry(outline, {
    depth: Math.max(length - 2 * bt, 0.0005), curveSegments: 8,
    bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 4,
  });
  geo.rotateY(-Math.PI / 2); // shape x -> the piece's depth, extrusion -> along its width
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(((x0 + x1) / 2 - 0.5) * f.w - (bb.min.x + bb.max.x) / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.furniture = f;
  return mesh;
}

/** Trace an outline ([x, y, corner radius]) into a THREE.Shape or Path, rounding the corners. */
function roundedOutline(path, pts) {
  const toward = (p, q, d) => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const k = Math.min(d, len / 2) / len;
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  };
  pts.forEach(([x, y, r], i) => {
    const first = i === 0;
    if (!r) {
      if (first) path.moveTo(x, y);
      else path.lineTo(x, y);
      return;
    }
    // Round the corner: cut it back along both edges and curve through it
    const a = toward([x, y], pts[(i + pts.length - 1) % pts.length], r);
    const b = toward([x, y], pts[(i + 1) % pts.length], r);
    if (first) path.moveTo(a[0], a[1]);
    else path.lineTo(a[0], a[1]);
    path.quadraticCurveTo(x, y, b[0], b[1]);
  });
  path.closePath();
  return path;
}

/**
 * A `plan` part (footprint outline raised from z0 to z1) or a `front` part (outline seen
 * from the front, pushed from y0 to y1), with rounded edges at both ends and holes.
 */
function outlineMesh(THREE, f, [shape, x0, y0, x1, y1, z0, z1, , { points = [], bevel = 0, holes = [] } = {}], mat) {
  const up = shape === "plan";
  // (plan: the shape's y runs to the back, so that after turning it upright the front faces +z)
  const at = ([u, v, r = 0]) => up
    ? [(x0 + u * (x1 - x0) - 0.5) * f.w, -(y0 + v * (y1 - y0) - 0.5) * f.d, r]
    : [(x0 + u * (x1 - x0) - 0.5) * f.w, (z0 + v * (z1 - z0)) * f.h, r];
  const outline = roundedOutline(new THREE.Shape(), points.map(at));
  for (const hole of holes) outline.holes.push(roundedOutline(new THREE.Path(), hole.map(at)));
  const length = Math.max(up ? (z1 - z0) * f.h : (y1 - y0) * f.d, 0.001);
  const bt = Math.max(0, Math.min(bevel, length / 2 - 0.0003));
  const geo = new THREE.ExtrudeGeometry(outline, {
    depth: Math.max(length - 2 * bt, 0.0003), curveSegments: 10,
    bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 4,
  });
  if (up) {
    geo.rotateX(-Math.PI / 2); // extrusion -> up
    geo.translate(0, z0 * f.h + bt, 0);
  } else {
    geo.translate(0, 0, (y0 - 0.5) * f.d + bt);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.furniture = f;
  return mesh;
}

/** SVG path of an outline ([x, y, corner radius], plan coordinates), corners rounded as in 3D. */
function svgOutline(pts) {
  const toward = (p, q, d) => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const k = Math.min(d, len / 2) / len;
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  };
  const n = (v) => v.toFixed(4);
  return pts.map(([x, y, r], i) => {
    const cmd = i === 0 ? "M" : "L";
    if (!r) return `${cmd}${n(x)},${n(y)}`;
    const a = toward([x, y], pts[(i + pts.length - 1) % pts.length], r);
    const b = toward([x, y], pts[(i + 1) % pts.length], r);
    return `${cmd}${n(a[0])},${n(a[1])} Q${n(x)},${n(y)} ${n(b[0])},${n(b[1])}`;
  }).join(" ") + " Z";
}

/**
 * Where a kapschuur's posts go (centred piece coordinates, metres): inset from the
 * roof edge by the overhang, along both long sides, at most ~2.5 m apart.
 */
export function timberLayout(f, opts = {}) {
  const o = opts.overhang ?? 0.35; // past the posts at the eaves
  const oe = opts.endOverhang ?? 0.55; // past the end trusses at the gables
  const [hw, hd] = [f.w / 2 - oe, f.d / 2 - o];
  const bays = Math.max(1, Math.ceil((2 * hw) / 2.5));
  const xs = Array.from({ length: bays + 1 }, (_, i) => -hw + (2 * hw * i) / bays);
  const zr = (opts.ridgeShift || 0) * hd;
  const gablePosts = opts.gablePost ? [[xs[0], zr], [xs[xs.length - 1], zr]] : [];
  return { xs, hw, hd, o, oe, zr, gablePosts, posts: xs.flatMap((x) => [[x, -hd], [x, hd]]) };
}

/**
 * Open timber shed (kapschuur): posts, head beams with knee braces, end trusses
 * (tie beam, king post, struts), ridge beam, rafters, and a boarded gable roof.
 * The ridge runs along the piece's width; f.h is the ridge height.
 */
function timberShedMesh(THREE, f, opts, wood) {
  const g = new THREE.Group();
  const L = timberLayout(f, opts);
  const eave = Math.min(opts.eave ?? 2.3, f.h - 0.4);
  const ridge = f.h;
  // Kapuitslag: the back (-z) eave can be lower; the roof then sweeps down further
  // at the back, both slopes at the same pitch
  const eaveB = Math.min(opts.eaveBack ?? eave, eave);
  const eaveOf = (side) => (side < 0 ? eaveB : eave);
  // The ridge may sit off-centre (towards the front, +z, for ridgeShift > 0): the two
  // slopes then differ in length and pitch. Each rests on the outer edges of the beams.
  let zr = (opts.ridgeShift || 0) * L.hd;
  if (eaveB < eave) {
    // Equal pitches: the ridge sits where both slopes, resting on their beams, meet
    const [yF, yB, zF, zB] = [eave + 0.27, eaveB + 0.27, L.hd + 0.2, -(L.hd + 0.2)];
    const t = (2 * ridge - yF - yB) / (zF - zB);
    zr = zF - (ridge - yF) / t;
  }
  const pitchOf = (side) => Math.atan2(ridge - (eaveOf(side) + 0.27), Math.abs(side * (L.hd + 0.2) - zr));
  const runOf = (side) => Math.abs(side * (L.hd + L.o) - zr); // from the ridge out to the roof edge
  const dropOf = (side) => Math.tan(pitchOf(side)) * runOf(side);
  const dark = wood.clone();
  dark.color = wood.color.clone().multiplyScalar(0.9);
  const add = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.furniture = f;
    g.add(mesh);
    return mesh;
  };
  // Axis-aligned timber; x along the ridge, y up, z across
  const box = (cx, cy, cz, sx, sy, sz, mat = wood) => {
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat));
    m.position.set(cx, cy, cz);
    return m;
  };
  // A timber running from a to b ([x, up, z]), w x h in section
  const beam = (a, b, w, h, mat = wood) => {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(A.distanceTo(B), h, w), mat));
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), B.clone().sub(A).normalize());
    return m;
  };
  const P = opts.post ?? 0.14; // post section
  // Posts, with knee braces up to the head beams (none on very low posts)
  for (const [x, y] of L.posts) {
    const h = eaveOf(Math.sign(y));
    box(x, h / 2, y, P, h, P);
    if (h < 1.6) continue;
    for (const dir of [-1, 1]) {
      const nx = x + dir * 0.6;
      if (nx < -L.hw - 0.01 || nx > L.hw + 0.01) continue;
      beam([x, h - 0.65, y], [nx, h - 0.02, y], 0.09, 0.09, dark);
    }
  }
  // Head beams along both sides
  for (const y of [-L.hd, L.hd]) box(0, eaveOf(Math.sign(y)) + 0.1, y, 2 * L.hw + 0.3, 0.2, 0.16);
  // End trusses: tie beam, king post, struts; braces from the end posts
  const kingTop = ridge - 0.12;
  for (const x of [L.xs[0], L.xs[L.xs.length - 1]]) {
    if (opts.gablePost) {
      // Open gable: a centre post from the ground up to the ridge, with a Y of struts
      // out to the roof edges (rafters) and no tie beam across
      box(x, kingTop / 2, zr, P, kingTop, P);
      const roofY = (z) => ridge - 0.16 - Math.tan(pitchOf(Math.sign(z - zr) || 1)) * Math.abs(z - zr);
      for (const side of [-1, 1]) {
        const zt = zr + (side * L.hd - zr) * 0.6;
        beam([x, eave - 0.05, zr], [x, roofY(zt), zt], 0.09, 0.11, dark);
        beam([x, eave - 0.6, side * L.hd], [x, eave - 0.02, side * (L.hd - 0.6)], 0.09, 0.09, dark);
      }
      continue;
    }
    if (eaveB < eave) {
      // Kapuitslag truss: tie beam from the front posts back to where it meets the long
      // back slope, carried there by an inner post; king post up to the ridge
      const tB = Math.tan(pitchOf(-1));
      const zEnd = Math.max(-L.hd, zr - (ridge - 0.1 - (eave + 0.32)) / tB);
      box(x, eave + 0.1, (L.hd + 0.08 + zEnd) / 2, 0.16, 0.2, L.hd + 0.08 - zEnd, dark);
      box(x, eave / 2, zEnd + P / 2, P, eave, P); // inner post
      box(x, (eave + 0.2 + kingTop) / 2, zr, 0.14, kingTop - eave - 0.2, 0.14);
      beam([x, eave + 0.2, zr + (L.hd - zr) * 0.55], [x, eave + 0.2 + (kingTop - eave - 0.2) * 0.55, zr], 0.09, 0.1, dark);
      beam([x, eave - 0.6, L.hd], [x, eave - 0.02, L.hd - 0.6], 0.09, 0.09, dark);
      continue;
    }
    box(x, eave + 0.1, 0, 0.16, 0.2, 2 * L.hd + 0.3, dark);
    box(x, (eave + 0.2 + kingTop) / 2, zr, 0.14, kingTop - eave - 0.2, 0.14);
    for (const side of [-1, 1]) {
      beam([x, eave + 0.2, zr + (side * L.hd - zr) * 0.55], [x, eave + 0.2 + (kingTop - eave - 0.2) * 0.55, zr], 0.09, 0.1, dark);
      beam([x, eave - 0.6, side * L.hd], [x, eave - 0.02, side * (L.hd - 0.6)], 0.09, 0.09, dark);
    }
  }
  // Ridge beam and rafters
  const len = f.w;
  box(0, ridge - 0.12, zr, len, 0.2, 0.12);
  for (let x = -len / 2 + 0.06; x <= len / 2 - 0.05; x += 0.6) {
    for (const side of [-1, 1]) beam([x, ridge - 0.1, zr], [x, ridge - 0.1 - dropOf(side), zr + side * runOf(side)], 0.06, 0.14, dark);
  }
  // Roof: boards running down the slope (or black metal roof-tile panels on top),
  // a ridge cap, fascia along the eaves and wide barge boards on the gables
  const stripes = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const boardTex = stripes(256, 16, (ctx) => {
    for (let i = 0; i < 8; i++) {
      const v = 232 + ((i * 53) % 20);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(i * 32, 0, 32, 16);
      ctx.fillStyle = "rgba(0,0,0,0.12)"; // fine joint between boards
      ctx.fillRect(i * 32, 0, 1, 16);
    }
  });
  boardTex.repeat.set(len / 1.2, 1); // 15 cm boards
  const boards = new THREE.MeshStandardMaterial({ color: wood.color, map: boardTex, roughness: 0.8 });
  const under = new THREE.MeshStandardMaterial({ color: wood.color.clone().multiplyScalar(0.95), map: boardTex, roughness: 0.85 });
  let top = boards;
  if (opts.roof === "tiles") {
    // Metal roof-tile panels: rounded profile every 18 cm, a step every 35 cm
    const tileTex = stripes(192, 64, (ctx) => {
      for (let i = 0; i < 6; i++) {
        const gr = ctx.createLinearGradient(i * 32, 0, i * 32 + 32, 0);
        gr.addColorStop(0, "#7a7a7a");
        gr.addColorStop(0.45, "#e6e6e6");
        gr.addColorStop(1, "#6a6a6a");
        ctx.fillStyle = gr;
        ctx.fillRect(i * 32, 0, 32, 64);
      }
      ctx.fillStyle = "rgba(0,0,0,0.55)"; // the step's shadow
      ctx.fillRect(0, 58, 192, 6);
    });
    tileTex.repeat.set(len / 1.08, Math.hypot(runOf(1), dropOf(1)) / 0.35);
    top = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.roofColor || "#34373b"), map: tileTex, roughness: 0.45, metalness: 0.3 });
  }
  for (const side of [-1, 1]) {
    const [run, drop, pitch] = [runOf(side), dropOf(side), pitchOf(side)];
    const slopeLen = Math.hypot(run, drop);
    const slab = add(new THREE.Mesh(new THREE.BoxGeometry(len, opts.roof === "tiles" ? 0.05 : 0.03, slopeLen), [wood, wood, top, under, wood, wood]));
    slab.position.set(0, ridge - drop / 2 + 0.01, zr + (side * run) / 2);
    slab.rotation.x = side * pitch;
    roofPart(slab);
    roofPart(box(0, ridge - drop - 0.06, zr + side * run, len + 0.05, 0.18, 0.03)); // fascia along the eave
    for (const x of [-len / 2, len / 2]) roofPart(beam([x, ridge + 0.04, zr], [x, ridge - drop - 0.03, zr + side * (run + 0.01)], 0.03, 0.24)); // barge boards
    if (opts.roof === "tiles") {
      // dark verge trim along the top of the barge boards
      for (const x of [-len / 2 - 0.02, len / 2 + 0.02]) roofPart(beam([x, ridge + 0.1, zr], [x, ridge - drop + 0.03, zr + side * (run + 0.01)], 0.035, 0.07, top));
    }
    if (opts.gutter) {
      const gutter = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 16, 1, false, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })));
      gutter.rotation.z = Math.PI / 2;
      gutter.rotation.x = Math.PI / 2 * -side;
      gutter.position.set(0, ridge - drop - 0.1, zr + side * (run + 0.06));
      roofPart(gutter);
    }
  }
  roofPart(box(0, ridge + 0.05, zr, len + 0.05, 0.05, 0.26, opts.roof === "tiles" ? top : wood)); // ridge cap

  // Closed sides: black horizontal cladding (overlapping boards), up to the roof
  if (opts.clad?.length) {
    const cladTex = stripes(16, 64, (ctx) => {
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(0, 0, 16, 64);
      const gr = ctx.createLinearGradient(0, 52, 0, 64);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, "rgba(0,0,0,0.55)"); // shadow under each overlapping board
      ctx.fillStyle = gr;
      ctx.fillRect(0, 52, 16, 12);
    });
    const clad = (w, h) => {
      const t = cladTex.clone();
      t.needsUpdate = true;
      t.repeat.set(1, h / 0.2); // 20 cm boards
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.cladColor || "#26282b"), map: t, roughness: 0.85, side: THREE.DoubleSide });
    };
    const roofAt = (z) => ridge - 0.04 - Math.tan(pitchOf(Math.sign(z - zr) || 1)) * Math.abs(z - zr); // underside of the roof
    if (opts.clad.includes("back")) {
      const z = -L.hd - 0.09;
      const w = 2 * L.hw + 0.14;
      const h = eaveB + 0.2;
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), clad(w, h)));
      m.position.set(0, h / 2, z);
    }
    for (const end of ["left", "right"]) {
      if (!opts.clad.includes(end)) continue;
      const x = end === "left" ? L.xs[0] - 0.09 : L.xs[L.xs.length - 1] + 0.09;
      const zw = L.hd + 0.09;
      // Pentagon: up the corners to the roof's underside, and up to the ridge
      // (shape x runs along -z once the wall is turned into place)
      const shape = new THREE.Shape([
        new THREE.Vector2(zw, 0), new THREE.Vector2(-zw, 0), new THREE.Vector2(-zw, roofAt(zw)),
        new THREE.Vector2(-zr, roofAt(zr)), new THREE.Vector2(zw, roofAt(-zw)),
      ]);
      const geo = new THREE.ShapeGeometry(shape);
      const uvs = geo.attributes.uv;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i), uvs.getY(i) / 0.2); // 20 cm boards
      const mat = clad(1, 1);
      mat.map.repeat.set(1, 1);
      const m = add(new THREE.Mesh(geo, mat));
      m.rotation.y = Math.PI / 2;
      m.position.set(x, 0, 0);
    }
  }
  return g;
}

/**
 * Mark a mesh as part of a roof, so the 3D view's roof opacity applies to it. It
 * gets its own materials, since posts and beams share them and must stay solid.
 */
function roofPart(mesh) {
  mesh.userData.roof = true;
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  return mesh;
}

/** Post positions of a flat-roofed shelter: `front` posts along +y, `back` along -y. */
export function flatShelterPosts(f, opts = {}) {
  const o = opts.overhang ?? 0.3;
  const [hw, hd] = [f.w / 2 - o, f.d / 2 - o];
  const row = (n, y) => Array.from({ length: Math.max(2, n) }, (_, i) => [-hw + (2 * hw * i) / (Math.max(2, n) - 1), y]);
  return [...row(opts.front ?? 3, hd), ...row(opts.back ?? 2, -hd)];
}

/**
 * Open timber shelter with a flat roof: posts (front and back rows), beams on the
 * posts all round with knee braces, joists across, a dark EPDM roof falling slightly
 * to the back, edge boards (boeiboord) all round and a gutter at the back. The
 * timber takes the piece's colour.
 */
function flatShelterMesh(THREE, f, opts, wood) {
  const g = new THREE.Group();
  const o = opts.overhang ?? 0.3;
  const [hw, hd] = [f.w / 2 - o, f.d / 2 - o];
  const P = 0.14;
  const top = f.h; // top of the edge boards
  const beamTop = top - 0.24;
  const postH = beamTop - 0.2;
  const dark = wood.clone();
  dark.color = wood.color.clone().multiplyScalar(0.9);
  const add = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.furniture = f;
    g.add(mesh);
    return mesh;
  };
  const box = (cx, cy, cz, sx, sy, sz, mat = wood) => {
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat));
    m.position.set(cx, cy, cz);
    return m;
  };
  const beam = (a, b, w, h, mat = dark) => {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(A.distanceTo(B), h, w), mat));
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), B.clone().sub(A).normalize());
    return m;
  };
  // Posts, with knee braces along the beams they carry
  for (const [x, z] of flatShelterPosts(f, opts)) {
    box(x, postH / 2, z, P, postH, P);
    const kb = 0.55;
    for (const dir of [-1, 1]) {
      if (x + dir * kb >= -hw - 0.01 && x + dir * kb <= hw + 0.01) beam([x, postH - kb, z], [x + dir * kb, postH - 0.02, z], 0.09, 0.09);
    }
    if (Math.abs(Math.abs(x) - hw) < 0.01) {
      const dz = -Math.sign(z) * kb; // corner posts: also a brace along the side beam
      beam([x, postH - kb, z], [x, postH - 0.02, z + dz], 0.09, 0.09);
    }
  }
  // Beams all round on the posts
  for (const z of [-hd, hd]) box(0, postH + 0.1, z, 2 * hw + 0.3, 0.2, 0.16);
  for (const x of [-hw, hw]) box(x, postH + 0.1, 0, 0.16, 0.2, 2 * hd + 0.3);
  // Joists across, front to back, out to the roof edge
  for (let x = -f.w / 2 + 0.06; x <= f.w / 2 - 0.05; x += 0.5) box(x, beamTop + 0.07, 0, 0.06, 0.14, f.d - 0.05, dark);
  // Roof deck with EPDM on top, falling ~1.5% to the back
  const fall = Math.atan(0.015);
  const deck = add(new THREE.Mesh(new THREE.BoxGeometry(f.w - 0.05, 0.04, f.d - 0.05), [
    new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.95 }), wood, wood, wood]));
  deck.position.set(0, beamTop + 0.16, 0);
  deck.rotation.x = fall;
  roofPart(deck);
  // Edge boards (boeiboord) all round, in the timber colour
  roofPart(box(0, top - 0.11, f.d / 2 - 0.0125, f.w, 0.22, 0.025));
  roofPart(box(0, top - 0.11 - 0.06, -f.d / 2 + 0.0125, f.w, 0.22, 0.025));
  for (const x of [-f.w / 2 + 0.0125, f.w / 2 - 0.0125]) roofPart(box(x, top - 0.14, 0, 0.025, 0.22, f.d));
  // Gutter along the back
  const gutter = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, f.w, 16, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })));
  gutter.rotation.z = Math.PI / 2;
  gutter.rotation.x = Math.PI / 2;
  gutter.position.set(0, top - 0.3, -f.d / 2 - 0.06);
  roofPart(gutter);
  return g;
}

/** Round pot: tapered wall (open top), a rim and a soil surface just below it. */
function potMesh(THREE, f, part, wallMat, soilMat) {
  const [, x0, y0, x1, y1, z0, z1, , opts] = part;
  const taper = opts?.taper ?? 0.75;
  const g = new THREE.Group();
  const [sx, sz, sy] = [(x1 - x0) * f.w, (y1 - y0) * f.d, (z1 - z0) * f.h];
  const add = (geo, mat, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.furniture = f;
    g.add(m);
  };
  const wall = new THREE.CylinderGeometry(0.5, 0.5 * taper, 0.93, 40, 1, true);
  add(wall, Object.assign(wallMat.clone(), { side: THREE.DoubleSide }), 0.465 * sy);
  add(new THREE.CylinderGeometry(0.53, 0.5, 0.07, 40), wallMat, (0.93 + 0.035) * sy); // rim
  const soil = new THREE.CircleGeometry(0.47, 32);
  soil.rotateX(-Math.PI / 2);
  add(soil, soilMat, 0.9 * sy);
  add(new THREE.CircleGeometry(0.5 * taper, 32).rotateX(Math.PI / 2), wallMat, 0.001); // foot
  g.position.set(((x0 + x1) / 2 - 0.5) * f.w, z0 * f.h, ((y0 + y1) / 2 - 0.5) * f.d);
  return g;
}

/**
 * Palm fronds from a crown. Feather fronds: arching ribbons folded along the
 * midrib, tapering to a point. Fan fronds: a pleated fan on a stalk.
 */
function frondsMesh(THREE, f, part, color) {
  const [, x0, y0, x1, y1, z0, z1, , opts] = part;
  const n = opts?.n ?? 10;
  const kind = opts?.kind || "feather";
  const reach = (Math.min(x1 - x0, 1) * f.w + Math.min(y1 - y0, 1) * f.d) / 4; // radius in metres
  const rise = (z1 - z0) * f.h;
  const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.75 });
  const darker = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.78), side: THREE.DoubleSide, roughness: 0.75 });
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + (i % 2) * 0.25;
    const lift = 0.35 + 0.65 * (((i * 7) % n) / n); // younger fronds stand more upright
    const pos = [];
    const idx = [];
    const segs = 22;
    if (kind === "fan") {
      // stalk, then a pleated fan at its end
      const stalk = reach * 0.45;
      const sAng = 0.25 + 0.75 * lift;
      const end = [Math.cos(sAng) * stalk, Math.sin(sAng) * stalk * 0.9];
      const stalkGeo = new THREE.CylinderGeometry(0.008, 0.012, stalk, 6);
      stalkGeo.translate(0, stalk / 2, 0);
      stalkGeo.rotateZ(-(Math.PI / 2 - sAng));
      const sm = new THREE.Mesh(stalkGeo, darker);
      sm.rotation.y = yaw;
      g.add(sm);
      const R = reach * 0.55;
      const spokes = 26;
      pos.push(end[0], end[1], 0);
      for (let k = 0; k <= spokes; k++) {
        const a = -1.6 + (3.2 * k) / spokes; // ~180° fan, facing outward
        const r = R * (0.92 + 0.08 * (k % 2));
        const pleat = (k % 2 ? 1 : -1) * R * 0.05;
        const droop = Math.abs(Math.sin(a)) * R * 0.25;
        pos.push(end[0] + Math.cos(a * 0.5) * r * Math.cos(sAng * 0.6), end[1] + Math.sin(sAng * 0.6) * r * 0.6 - droop + pleat * 0.3,
          Math.sin(a) * r * 0.75 + pleat);
      }
      for (let k = 1; k <= spokes; k++) idx.push(0, k, k + 1);
    } else {
      // arching ribbon along the frond, folded slightly along its midrib
      const len = reach * (0.85 + 0.15 * lift);
      const up = rise * (0.55 + 0.45 * lift);
      for (let k = 0; k <= segs; k++) {
        const u = k / segs;
        const x = len * u;
        const y = up * Math.sin(u * Math.PI * 0.62) - rise * 0.55 * u * u * (1.1 - lift);
        const w = len * 0.13 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.7;
        pos.push(x, y - w * 0.25, -w, x, y, 0, x, y - w * 0.25, w);
      }
      for (let k = 0; k < segs; k++) {
        const a = k * 3;
        const b = a + 3;
        idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, i % 3 ? mat : darker);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.furniture = f;
    g.add(m);
  }
  g.position.set(((x0 + x1) / 2 - 0.5) * f.w, z0 * f.h, ((y0 + y1) / 2 - 0.5) * f.d);
  return g;
}

/** A smooth cloth (a flag): a finely divided sheet shaped by clothPoint, striped by texture. */
function clothMesh(THREE, f, part) {
  const opts = part[8] || {};
  const [cols, rows] = [36, 18];
  const pos = [];
  const uv = [];
  const index = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const [x, y, z] = clothPoint(part, i / cols, j / rows);
      pos.push((x - 0.5) * f.w, z * f.h, (y - 0.5) * f.d);
      uv.push(i / cols, 1 - j / rows); // stripes run along the flag, top to bottom
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      index.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Stripes painted top to bottom
  const stripes = opts.stripes || ["main"];
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  stripes.forEach((c, k) => {
    ctx.fillStyle = partColor(c, f);
    ctx.fillRect(0, (k * 96) / stripes.length, 4, 96 / stripes.length);
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter; // crisp stripe edges
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.85 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.furniture = f;
  return mesh;
}

/**
 * Ambilight halo around a screen: brightest at its edges, fading out over
 * `uSpread` metres. Colours drift around the edge (uTime), unless uMode is 1:
 * then it's one colour (uColor), e.g. from a linked light.
 */
function ambilightMaterial(THREE, f) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uHalf: { value: new THREE.Vector2(f.w / 2, f.h / 2) },
      uSpread: { value: 0.5 },
      uStrength: { value: 0 },
      uTime: { value: 0 },
      uMode: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: `varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vP;
      uniform vec2 uHalf; uniform float uSpread, uStrength, uTime, uMode; uniform vec3 uColor;
      void main() {
        float d = length(max(abs(vP) - uHalf + 0.04, 0.0)); // distance from the screen's edge
        float a = exp(-d * 6.0 / uSpread) * (1.0 - smoothstep(0.6 * uSpread, uSpread, d));
        float ang = atan(vP.y / uHalf.y, vP.x / uHalf.x);
        vec3 hue = 0.55 + 0.45 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + ang / 6.2832 + uTime * 0.05));
        vec3 c = mix(hue, uColor, uMode);
        gl_FragColor = vec4(c * a * uStrength, 1.0);
      }`,
  });
}

/** Height of a piece's highest point (ceiling and on-desk items sit above others). */
export const topHeight = (f) =>
  catalogItem(f.type).hole ? -1 : catalogItem(f.type).ceiling ? 100 : (f.z || 0) + Math.max(...catalogItem(f.type).parts.map((p) => p[6])) * f.h;

/** Pieces in drawing order for the top-down view: lowest first, highest on top. */
export const byHeight = (list) => [...list].sort((a, b) => topHeight(a) - topHeight(b));
