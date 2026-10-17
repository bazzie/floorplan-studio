// A small looping "programme" for TVs and projector screens that are on: a
// landscape drifting by, cutting to a new scene (time of day) every few seconds.
// Each screen gets its own tiny canvas texture and its own variation (scene
// order, timing, direction), picked from a seed so it stays the same on reload.

const W = 160;
const H = 90;

// sky top, sky bottom, sun, three hill layers (far -> near)
const SCENES = [
  ["#3d7bd9", "#a9d8ff", "#fff3b0", "#7fa8c9", "#4f9a5a", "#2f6e3a"], // day
  ["#ff7a59", "#ffd39a", "#fff0c2", "#b0627a", "#6e3f63", "#3c2645"], // sunset
  ["#0d1b3d", "#2f4f8a", "#eef2ff", "#2a3d66", "#1c2b4b", "#0f1a30"], // night
  ["#58c4c9", "#d8f6ee", "#ffffff", "#7cc3a6", "#3e9a7b", "#1f6b55"], // coast
];

/** Small deterministic random generator (mulberry32) seeded from a string. */
function seededRandom(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createTvScreen(THREE, seed = "") {
  const rnd = seededRandom(seed);
  const order = SCENES.map((s) => [rnd(), s]).sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  const sceneTime = 6 + rnd() * 4; // seconds per scene
  const offset = rnd() * 1000; // so screens don't cut at the same moment
  const speed = (0.75 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1); // pan left or right
  const sunX = 0.2 + rnd() * 0.6;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2; // double resolution, so a caption stays legible
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let source = null; // what's on via a connected receiver: { title, subtitle, app, picture, paused }
  let image = null;
  let lastTime = 0;

  const hills = (y, amp, freq, speed, t, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
      const u = (x + t * speed) / W;
      ctx.lineTo(x, y - amp * (Math.sin(u * freq * 6.283) * 0.6 + Math.sin(u * freq * 2.7 * 6.283 + 1.3) * 0.4));
    }
    ctx.lineTo(W, H);
    ctx.fill();
  };

  /** Draw the frame for time t (seconds). */
  const draw = (time) => {
    lastTime = time;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    if (image?.complete && image.naturalWidth) {
      // Artwork of what's playing, filling the screen
      const k = Math.max(W / image.naturalWidth, H / image.naturalHeight);
      const [iw, ih] = [image.naturalWidth * k, image.naturalHeight * k];
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(image, (W - iw) / 2, (H - ih) / 2, iw, ih);
    } else {
      programme(time);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (source) caption();
    texture.needsUpdate = true;
  };

  /** A caption bar along the bottom: app colour, title, where it comes from, paused. */
  const caption = () => {
    const [cw, ch] = [canvas.width, canvas.height];
    const bar = 46;
    const grad = ctx.createLinearGradient(0, ch - bar - 24, 0, ch);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.35, "rgba(0,0,0,.72)");
    grad.addColorStop(1, "rgba(0,0,0,.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, ch - bar - 24, cw, bar + 24);
    ctx.fillStyle = appColor(source.app || source.title);
    ctx.fillRect(12, ch - bar + 4, 5, bar - 16);
    let x = 25;
    if (source.paused) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, ch - bar + 8, 4, 16);
      ctx.fillRect(x + 7, ch - bar + 8, 4, 16);
      x += 18;
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = "700 19px sans-serif";
    ctx.fillText(clip(source.title, cw - x - 12), x, ch - bar + 23);
    if (source.subtitle) {
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = "500 12px sans-serif";
      ctx.fillText(clip(source.subtitle, cw - 37), 25, ch - 8);
    }
  };
  const clip = (text, max) => {
    let s = String(text);
    while (s.length > 1 && ctx.measureText(s).width > max) s = s.slice(0, -2) + "…";
    return s;
  };

  /**
   * Show what's playing through a connected receiver (null: the TV's own programme).
   * Redraws right away, so a paused screen updates too.
   */
  const setSource = (next) => {
    const key = (o) => JSON.stringify(o);
    if (key(next) === key(source)) return;
    const picture = next?.picture || null;
    if (picture !== (image?.dataset.src || null)) {
      image = null;
      if (picture) {
        image = new Image();
        image.dataset.src = picture;
        image.onload = () => draw(lastTime);
        image.src = picture;
      }
    }
    source = next;
    draw(lastTime);
  };

  const programme = (time) => {
    const t = time + offset;
    const n = Math.floor(t / sceneTime);
    const [top, bottom, sun, h1, h2, h3] = order[n % order.length];
    const local = t - n * sceneTime;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, top);
    sky.addColorStop(1, bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // The sun (or moon) rises slowly through each scene
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(W * sunX, H * 0.42 - local * 1.6, 9, 0, 6.283);
    ctx.fill();
    hills(H * 0.62, 7, 1.5, 6 * speed, t, h1);
    hills(H * 0.76, 6, 2.2, 14 * speed, t, h2);
    hills(H * 0.92, 5, 3.1, 30 * speed, t, h3);
    // Short fade at each cut
    const fade = Math.max(0, 1 - local / 0.35);
    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${(fade * 0.8).toFixed(2)})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  draw(0);
  return { texture, draw, setSource };
}

// Brand colours of common streaming apps, for the caption's accent
const APP_COLORS = [
  [/netflix/i, "#e50914"], [/youtube/i, "#ff0033"], [/disney/i, "#1f6cff"], [/spotify/i, "#1ed760"],
  [/plex/i, "#e5a00d"], [/prime|amazon/i, "#00a8e1"], [/hbo|max\b/i, "#7b2bff"], [/videoland/i, "#e4002b"],
  [/npo/i, "#ff6d00"], [/apple tv|^tv$/i, "#d9d9de"], [/music/i, "#fa2d48"], [/sky/i, "#7a3cff"], [/playstation/i, "#0070d1"],
];
const appColor = (name) => (APP_COLORS.find(([re]) => re.test(name || "")) || [null, "#3fa9f5"])[1];

/**
 * Art Mode (Samsung The Frame): a painting on a white mat, picked from a seed so each
 * TV keeps its own. A calm landscape in oils: sky, hills, a lake and a few trees.
 */
export function createArtwork(THREE, seed = "") {
  const rnd = seededRandom(`art${seed}`);
  const [w, h] = [320, 180];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const palettes = [
    ["#9fb7c9", "#e8d9b8", "#7d8f5a", "#5b6b3c", "#c9a86a"],
    ["#d9b58c", "#f2e2c4", "#a46c4a", "#6e4a3a", "#e0a96d"],
    ["#7e9bb5", "#cfd9df", "#55705e", "#3a5247", "#9db6a4"],
  ];
  const [sky, glow, far, near, accent] = palettes[Math.floor(rnd() * palettes.length)];
  // white mat around the picture
  ctx.fillStyle = "#f4f2ee";
  ctx.fillRect(0, 0, w, h);
  const [x0, y0, pw, ph] = [w * 0.16, h * 0.14, w * 0.68, h * 0.72];
  const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
  g.addColorStop(0, sky);
  g.addColorStop(0.55, glow);
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, pw, ph);
  const hill = (base, amp, color, f) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + ph);
    for (let x = 0; x <= pw; x += 4) ctx.lineTo(x0 + x, y0 + ph * base - amp * Math.sin((x / pw) * Math.PI * f + rnd() * 0.15));
    ctx.lineTo(x0 + pw, y0 + ph);
    ctx.fill();
  };
  hill(0.62, ph * 0.1, far, 1.3);
  ctx.fillStyle = sky; // a lake reflecting the sky
  ctx.fillRect(x0, y0 + ph * 0.7, pw, ph * 0.08);
  hill(0.86, ph * 0.08, near, 2.1);
  for (let i = 0; i < 4; i++) {
    // trees
    const tx = x0 + pw * (0.15 + rnd() * 0.7);
    const ty = y0 + ph * (0.66 + rnd() * 0.1);
    ctx.fillStyle = near;
    ctx.beginPath();
    ctx.ellipse(tx, ty - ph * 0.08, pw * 0.025, ph * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = accent; // a low sun
  ctx.beginPath();
  ctx.arc(x0 + pw * (0.2 + rnd() * 0.6), y0 + ph * 0.38, ph * 0.06, 0, Math.PI * 2);
  ctx.fill();
  // brush texture
  for (let i = 0; i < 1600; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},0.05)`;
    ctx.fillRect(x0 + rnd() * pw, y0 + rnd() * ph, 2 + rnd() * 4, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The front-panel display of an AV receiver (NAD T 778 style): the selected input in
 * large type and a volume bar, white on black. `update(stateObj)` redraws it when
 * the input, volume or mute changes.
 */
export function createDeviceDisplay(THREE, brand = "NAD") {
  const [w, h] = [256, 144];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let last = null;
  const fit = (text, max, size, weight = 600) => {
    for (; size > 10; size -= 2) {
      ctx.font = `${weight} ${size}px sans-serif`;
      if (ctx.measureText(text).width <= max) break;
    }
  };
  const update = (st) => {
    const a = st?.attributes || {};
    // BluOS reports an analogue/HDMI input as title "External Source", artist "<input name>"
    const external = /^external source$/i.test(a.media_title || "");
    const source = String(a.source || (external ? a.media_artist : a.media_title) || "").trim() || "Ready";
    const volume = typeof a.volume_level === "number" ? Math.max(0, Math.min(1, a.volume_level)) : null;
    const muted = !!a.is_volume_muted;
    const key = `${source}|${volume}|${muted}`;
    if (key === last) return;
    last = key;
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "800 18px sans-serif";
    ctx.fillText(brand, 14, 12);
    ctx.fillStyle = "#8fa3b8";
    ctx.font = "500 13px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("MAIN", w - 14, 15);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    fit(source, w - 28, 40);
    ctx.fillText(source, w / 2, 66);
    ctx.textAlign = "left";
    if (volume !== null || muted) {
      const [x, y, bw, bh] = [14, 110, w - 28 - 52, 10];
      ctx.fillStyle = "#1d2733";
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = muted ? "#5b6670" : "#3fa9f5";
      ctx.fillRect(x, y, bw * (volume ?? 0), bh);
      ctx.fillStyle = muted ? "#ff6b5b" : "#ffffff";
      ctx.font = "700 15px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(muted ? "MUTE" : `${Math.round((volume ?? 0) * 100)}`, w - 14, y + bh / 2 + 1);
    }
    texture.needsUpdate = true;
  };
  return { texture, update };
}
