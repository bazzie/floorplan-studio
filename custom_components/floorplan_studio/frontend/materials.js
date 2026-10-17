// Floor and wall finishes: definitions plus procedurally drawn textures.
//
// Textures are drawn in light greys so a finish's colour can tint them (the
// colour multiplies the texture). `tile` is the real-world size (metres) one
// texture covers, so planks and bricks keep their true size on any surface.

// Herringbone geometry: plank width (m) and length in plank widths
const HB_W = 0.1;
const HB_K = 5;
const HB_TILE = HB_K * Math.SQRT2 * HB_W;

export const FLOOR_MATERIALS = {
  plain: { label: "Plain", color: null },
  wood: { label: "Wood planks", color: "#b9865a", tile: 1.2, roughness: 0.6 },
  // Herringbone: 50 x 10 cm planks at 45°; the pattern repeats every 5·√2·10 cm
  herringbone: { label: "Herringbone wood", color: "#b9865a", tile: HB_TILE, roughness: 0.6 },
  tiles: { label: "Tiles (30 cm)", color: "#d9d6cf", tile: 0.6, roughness: 0.35 },
  large_tiles: { label: "Large tiles (60 cm)", color: "#cdc8bd", tile: 1.2, roughness: 0.35 },
  tiles_40x25: { label: "Tiles (40 × 25 cm)", color: "#d6d1c7", tile: [0.8, 0.5], roughness: 0.35 },
  carpet: { label: "Carpet", color: "#8b909a", tile: 1.0, roughness: 1 },
  concrete: { label: "Concrete", color: "#aeaca6", tile: 2.0, roughness: 0.85 },
  marble: { label: "Marble", color: "#ebe8e2", tile: 1.6, roughness: 0.2 },
  // Outdoor surfaces (gardens, terraces): on the ground floor they lie at ground level
  grass: { label: "Grass (outdoor)", color: "#7fae5a", tile: 2.0, roughness: 1, outdoor: true },
  gravel: { label: "Gravel (outdoor)", color: "#c9c2b4", tile: 1.0, roughness: 1, outdoor: true },
  paving: { label: "Paving 50 cm (outdoor)", color: "#b5afa4", tile: 1.0, roughness: 0.9, outdoor: true },
  decking: { label: "Decking (outdoor)", color: "#9c7650", tile: [1.44, 0.72], roughness: 0.8, outdoor: true },
  soil: { label: "Soil / flower bed (outdoor)", color: "#6f5641", tile: 1.0, roughness: 1, outdoor: true },
  water: { label: "Water / pond (outdoor)", color: "#5d97b8", tile: 2.0, roughness: 0.1, outdoor: true },
};

/** Whether a room is an outdoor area (garden, terrace…): its floor is an outdoor surface. */
export const isOutdoor = (room) => !!FLOOR_MATERIALS[room?.floor_material]?.outdoor;

// Roof coverings; the texture runs along the eave (u) and up the slope (v)
export const ROOF_MATERIALS = {
  tiles: { label: "Roof tiles", color: "#a4553a", tile: [0.6, 0.66], roughness: 0.8 },
  tiles_dark: { label: "Roof tiles, anthracite", color: "#45484c", tile: [0.6, 0.66], roughness: 0.7, draw: "tiles" },
  slate: { label: "Slate", color: "#5b6168", tile: [0.6, 0.5], roughness: 0.6 },
  metal: { label: "Metal (standing seam)", color: "#6b7177", tile: [1.0, 1.0], roughness: 0.45 },
  thatch: { label: "Thatch (riet)", color: "#a08a5a", tile: [1.0, 1.0], roughness: 1 },
  flat: { label: "Flat roof (bitumen)", color: "#3e4044", tile: [2.0, 2.0], roughness: 0.95 },
};

export function roofFinish(roof) {
  const material = ROOF_MATERIALS[roof?.material] ? roof.material : roof?.type === "flat" ? "flat" : "tiles";
  return { material, color: roof?.color || ROOF_MATERIALS[material].color };
}

export const WALL_MATERIALS = {
  paint: { label: "Paint", color: "#efeee9", roughness: 0.9 },
  brick: { label: "Brick", color: "#a85d44", tile: 0.88, roughness: 0.95 },
  wallpaper: { label: "Wallpaper (stripes)", color: "#e6dccb", tile: 0.5, roughness: 0.85 },
  wood_panel: { label: "Wood panelling", color: "#a07650", tile: 0.6, roughness: 0.6 },
  tiles: { label: "Tiles", color: "#e8ecee", tile: 0.6, roughness: 0.3 },
  concrete: { label: "Concrete", color: "#b6b5af", tile: 2.0, roughness: 0.85 },
};

/** Texture size in metres as [width, height]. */
const tileSize = (def) => (Array.isArray(def.tile) ? def.tile : [def.tile, def.tile]);

/** Effective finish of a surface: { material, color } with defaults filled in. */
export function floorFinish(room) {
  const material = FLOOR_MATERIALS[room?.floor_material] ? room.floor_material : "plain";
  return { material, color: room?.floor_color || FLOOR_MATERIALS[material].color };
}

export function wallFinish(material, color) {
  const m = WALL_MATERIALS[material] ? material : "paint";
  return { material: m, color: color || WALL_MATERIALS[m].color };
}

// ---------- textures (3D) ----------

/** Small deterministic random generator so textures look the same every time. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const grey = (v) => `rgb(${v},${v},${v})`;

function noise(ctx, size, rand, amount, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = 150 + Math.floor(rand() * 105);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    const r = 1 + rand() * 3;
    ctx.fillRect(rand() * size, rand() * size, r, r);
  }
}

const DRAW = {
  roof_tiles(ctx, n, rand, h = n) {
    // Pantiles: 6 rows of 11 cm courses, 3 across 20 cm, each with a rounded roll
    const rows = 6;
    const cols = 3;
    const rh = h / rows;
    const cw = n / cols;
    ctx.fillStyle = grey(205);
    ctx.fillRect(0, 0, n, h);
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? cw / 2 : 0;
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + off;
        const g = ctx.createLinearGradient(x, 0, x + cw, 0);
        const v = 215 + Math.floor(rand() * 30);
        g.addColorStop(0, grey(v - 50));
        g.addColorStop(0.35, grey(v + 15));
        g.addColorStop(0.7, grey(v - 10));
        g.addColorStop(1, grey(v - 60));
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, r * rh, cw - 2, rh - 1);
      }
      ctx.fillStyle = "rgba(40,40,40,0.55)"; // shadow line under each course
      ctx.fillRect(0, (r + 1) * rh - 4, n, 4);
    }
  },
  roof_slate(ctx, n, rand, h = n) {
    const rows = 8;
    const cols = 4;
    const rh = h / rows;
    const cw = n / cols;
    ctx.fillStyle = grey(150);
    ctx.fillRect(0, 0, n, h);
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? cw / 2 : 0;
      for (let c = -1; c <= cols; c++) {
        ctx.fillStyle = grey(200 + Math.floor(rand() * 45));
        ctx.fillRect(c * cw + off + 2, r * rh + 1, cw - 4, rh - 3);
      }
    }
    noise(ctx, n, rand, 2500, 0.08);
  },
  roof_metal(ctx, n, rand) {
    ctx.fillStyle = grey(225);
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 2; i++) {
      // a raised seam every 50 cm
      const x = (i * n) / 2;
      ctx.fillStyle = grey(250);
      ctx.fillRect(x, 0, 6, n);
      ctx.fillStyle = grey(150);
      ctx.fillRect(x + 6, 0, 5, n);
    }
  },
  roof_thatch(ctx, n, rand) {
    ctx.fillStyle = grey(200);
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 7000; i++) {
      const v = 150 + Math.floor(rand() * 100);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.4)`;
      const x = rand() * n;
      const y = rand() * n;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 3, y + 8 + rand() * 14);
      ctx.stroke();
    }
  },
  roof_flat(ctx, n, rand) {
    ctx.fillStyle = grey(220);
    ctx.fillRect(0, 0, n, n);
    noise(ctx, n, rand, 9000, 0.2);
    ctx.fillStyle = "rgba(90,90,90,0.35)"; // seams of the roofing sheets
    ctx.fillRect(0, n / 2, n, 3);
  },
  grass(ctx, n, rand) {
    ctx.fillStyle = grey(222);
    ctx.fillRect(0, 0, n, n);
    // soft mowing stripes plus lots of short blades
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(255,255,255,${i % 2 ? 0.06 : 0})`;
      ctx.fillRect(0, (i * n) / 4, n, n / 4);
    }
    for (let i = 0; i < 9000; i++) {
      const v = 150 + Math.floor(rand() * 105);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.lineWidth = 1;
      const x = rand() * n;
      const y = rand() * n;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
      ctx.stroke();
    }
  },
  gravel(ctx, n, rand) {
    ctx.fillStyle = grey(200);
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 5000; i++) {
      const v = 170 + Math.floor(rand() * 85);
      ctx.fillStyle = grey(v);
      ctx.beginPath();
      ctx.ellipse(rand() * n, rand() * n, 1.5 + rand() * 3, 1 + rand() * 2.5, rand() * 3.14, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  paving(ctx, n, rand) {
    DRAW.tiles(ctx, n, rand, 2);
    noise(ctx, n, rand, 2500, 0.12);
  },
  decking(ctx, n, rand, h = n) {
    // 12 cm boards with 6 mm gaps, ends staggered (tile 1.44 x 0.72 m)
    const rows = 6;
    const ph = h / rows;
    ctx.fillStyle = grey(70);
    ctx.fillRect(0, 0, n, h);
    for (let r = 0; r < rows; r++) {
      const off = Math.floor(rand() * n);
      ctx.fillStyle = grey(205 + Math.floor(rand() * 45));
      ctx.fillRect(0, r * ph + 2, n, ph - 4);
      ctx.fillStyle = "rgba(60,60,60,0.6)";
      ctx.fillRect(off, r * ph, 3, ph);
      for (let g = 0; g < 3; g++) {
        ctx.fillStyle = `rgba(110,110,110,${0.1 + rand() * 0.1})`;
        ctx.fillRect(0, r * ph + 4 + rand() * (ph - 8), n, 1);
      }
    }
  },
  soil(ctx, n, rand) {
    ctx.fillStyle = grey(205);
    ctx.fillRect(0, 0, n, n);
    noise(ctx, n, rand, 9000, 0.35);
  },
  water(ctx, n, rand) {
    ctx.fillStyle = grey(225);
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + rand() * 0.25})`;
      ctx.lineWidth = 1 + rand() * 2;
      ctx.beginPath();
      const x = rand() * n;
      const y = rand() * n;
      ctx.ellipse(x, y, 10 + rand() * 30, 3 + rand() * 6, 0, 0, Math.PI);
      ctx.stroke();
    }
  },
  wood(ctx, n, rand) {
    // 6 rows of 20 cm planks across 1.2 m; each row has two 60 cm planks with
    // its joints at its own offset (wrapping around so the texture tiles)
    const rows = 6;
    const ph = n / rows;
    ctx.fillStyle = grey(225);
    ctx.fillRect(0, 0, n, n);
    for (let r = 0; r < rows; r++) {
      const off = Math.floor(rand() * n);
      for (let k = 0; k < 2; k++) {
        ctx.fillStyle = grey(212 + Math.floor(rand() * 40));
        const x0 = (off + (k * n) / 2) % n;
        ctx.fillRect(x0, r * ph, n / 2, ph);
        if (x0 + n / 2 > n) ctx.fillRect(x0 - n, r * ph, n / 2, ph); // wrap
      }
      // grain
      for (let g = 0; g < 7; g++) {
        ctx.strokeStyle = `rgba(120,120,120,${0.06 + rand() * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const y = r * ph + rand() * ph;
        ctx.moveTo(0, y);
        for (let x = 0; x <= n; x += n / 8) ctx.lineTo(x, y + (rand() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(90,90,90,0.55)";
      ctx.fillRect(0, r * ph, n, 2);
      ctx.fillRect(off % n, r * ph, 2, ph);
      ctx.fillRect((off + n / 2) % n, r * ph, 2, ph);
    }
  },
  tiles(ctx, n, rand, count = 2) {
    const t = n / count;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        ctx.fillStyle = grey(236 + Math.floor(rand() * 18));
        ctx.fillRect(i * t, j * t, t, t);
      }
    }
    noise(ctx, n, rand, 600, 0.05);
    ctx.fillStyle = grey(165);
    for (let i = 0; i <= count; i++) {
      ctx.fillRect(i * t - 2, 0, 4, n);
      ctx.fillRect(0, i * t - 2, n, 4);
    }
  },
  large_tiles(ctx, n, rand) {
    DRAW.tiles(ctx, n, rand, 2);
  },
  carpet(ctx, n, rand) {
    ctx.fillStyle = grey(225);
    ctx.fillRect(0, 0, n, n);
    noise(ctx, n, rand, 9000, 0.22);
  },
  concrete(ctx, n, rand) {
    ctx.fillStyle = grey(228);
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 60; i++) {
      const v = 200 + Math.floor(rand() * 55);
      ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
      ctx.beginPath();
      ctx.arc(rand() * n, rand() * n, 10 + rand() * 60, 0, Math.PI * 2);
      ctx.fill();
    }
    noise(ctx, n, rand, 3000, 0.1);
  },
  marble(ctx, n, rand) {
    ctx.fillStyle = grey(246);
    ctx.fillRect(0, 0, n, n);
    for (let v = 0; v < 9; v++) {
      ctx.strokeStyle = `rgba(110,110,110,${0.12 + rand() * 0.25})`;
      ctx.lineWidth = 0.6 + rand() * 2;
      ctx.beginPath();
      let x = rand() * n;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < n) {
        x += (rand() - 0.5) * 60;
        y += 20 + rand() * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  brick(ctx, n, rand) {
    // 4 bricks (22 cm) across, 12 courses (7.3 cm) down 0.88 m; half-brick bond
    const bw = n / 4;
    const bh = n / 12;
    ctx.fillStyle = grey(200); // mortar
    ctx.fillRect(0, 0, n, n);
    for (let r = 0; r < 12; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let i = -1; i < 5; i++) {
        ctx.fillStyle = grey(205 + Math.floor(rand() * 50));
        ctx.fillRect(i * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
    noise(ctx, n, rand, 2500, 0.08);
  },
  wallpaper(ctx, n, rand) {
    ctx.fillStyle = grey(244);
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = "rgba(150,150,150,0.16)";
      ctx.fillRect((i * n) / 4, 0, n / 10, n);
      ctx.fillStyle = "rgba(150,150,150,0.08)";
      ctx.fillRect((i * n) / 4 + n / 7, 0, n / 40, n);
    }
  },
  wood_panel(ctx, n, rand) {
    // vertical boards, 4 across 0.6 m
    const bw = n / 4;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = grey(212 + Math.floor(rand() * 40));
      ctx.fillRect(i * bw, 0, bw, n);
      for (let g = 0; g < 5; g++) {
        ctx.strokeStyle = `rgba(120,120,120,${0.06 + rand() * 0.1})`;
        ctx.beginPath();
        const x = i * bw + rand() * bw;
        ctx.moveTo(x, 0);
        for (let y = 0; y <= n; y += n / 8) ctx.lineTo(x + (rand() - 0.5) * 4, y);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(80,80,80,0.5)";
      ctx.fillRect(i * bw, 0, 2, n);
    }
  },
};
/**
 * Herringbone, drawn per pixel. In a grid of plank-width cells, plank rows form
 * staircases: horizontal plank H_y covers cells x = y..y+k-1 of row y, vertical
 * plank V_m covers column m from row m+1 down k cells; staircases repeat every 2k
 * cells. Rotated 45° that is classic herringbone, repeating on a square of k·√2
 * plank widths, so the texture tiles seamlessly.
 */
DRAW.herringbone = (ctx, n, rand) => {
  const k = HB_K;
  const img = ctx.createImageData(n, n);
  const shade = new Map();
  const plankShade = (id) => {
    if (!shade.has(id)) shade.set(id, 205 + Math.floor(rand() * 45));
    return shade.get(id);
  };
  const T = k * Math.SQRT2; // tile size in plank widths
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      // Rotated texture coordinates -> plank grid coordinates
      const xr = (px / n) * T;
      const yr = (py / n) * T;
      const x = (xr - yr) / Math.SQRT2;
      const y = (xr + yr) / Math.SQRT2;
      const X = Math.floor(x);
      const Y = Math.floor(y);
      const c = Math.floor((X - Y + k) / (2 * k));
      const xl = x - 2 * k * c; // position within this staircase
      const d = Math.floor(xl) - Y;
      let id;
      let along;
      let across;
      if (d >= 0) {
        // horizontal plank of row Y
        id = `h${((Y % k) + k) % k}`;
        along = xl - Y;
        across = y - Y;
      } else {
        const m = Math.floor(xl);
        id = `v${((m % k) + k) % k}`;
        along = y - (m + 1);
        across = xl - m;
      }
      // Shade per plank position within the repeating pattern, so the texture tiles seamlessly
      let v = plankShade(id);
      v += Math.sin(across * 37 + along * 1.3 + v) * 4; // grain
      const e = 0.05;
      if (across < e || across > 1 - e || along < e || along > k - e) v = 120; // joints
      const i = (py * n + px) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
};

/** 40 x 25 cm tiles, straight grid; the texture holds 2 x 2 tiles (0.8 x 0.5 m). */
DRAW.tiles_40x25 = (ctx, n, rand, h) => {
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = grey(234 + Math.floor(rand() * 18));
      ctx.fillRect((i * n) / 2, (j * h) / 2, n / 2, h / 2);
    }
  }
  noise(ctx, n, rand, 600, 0.05);
  ctx.fillStyle = grey(165);
  for (let i = 0; i <= 2; i++) {
    ctx.fillRect((i * n) / 2 - 2, 0, 4, h);
    ctx.fillRect(0, (i * h) / 2 - 2, n, 4);
  }
};

DRAW.wall_tiles = (ctx, n, rand) => DRAW.tiles(ctx, n, rand, 4);
DRAW.wall_concrete = DRAW.concrete;

const textureCache = new Map();

/**
 * Canvas texture for a finish; cached per material. Returns null for plain
 * surfaces. `kind` is "floor" or "wall" (wall tiles are smaller).
 */
export function finishTexture(THREE, kind, material) {
  const key = kind === "roof" ? `roof_${ROOF_MATERIALS[material]?.draw || material}`
    : kind === "wall" && (material === "tiles" || material === "concrete") ? `wall_${material}` : material;
  if (!DRAW[key]) return null;
  if (textureCache.has(key)) return textureCache.get(key);
  // Canvas keeps the texture's real-world aspect ratio (e.g. 0.8 x 0.5 m)
  const def = (kind === "roof" ? ROOF_MATERIALS : kind === "wall" ? WALL_MATERIALS : FLOOR_MATERIALS)[material] || {};
  const [tw, th] = def.tile ? tileSize(def) : [1, 1];
  const n = 512;
  const h = Math.round((n * th) / tw);
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  DRAW[key](ctx, n, rng(key.length * 7919 + key.charCodeAt(0)), h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

/** MeshStandardMaterial for a finish (texture scaled to real-world size). */
export function finishMaterial(THREE, kind, finish, rotation = 0) {
  const defs = kind === "roof" ? ROOF_MATERIALS : kind === "wall" ? WALL_MATERIALS : FLOOR_MATERIALS;
  const def = defs[finish.material] || {};
  const map = finishTexture(THREE, kind, finish.material);
  let tex = null;
  if (map && def.tile) {
    tex = map.clone();
    tex.needsUpdate = true;
    const [tw, th] = tileSize(def);
    tex.repeat.set(1 / tw, 1 / th);
    tex.rotation = (-rotation * Math.PI) / 180; // pattern direction (degrees, clockwise on the plan)
  }
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(finish.color || "#efeee9"),
    map: tex,
    roughness: def.roughness ?? 0.9,
  });
}

// ---------- patterns (2D) ----------

/**
 * Herringbone pattern tile for 2D: the same plank layout as the texture,
 * outlines only. Planks overlapping the tile are drawn whole; the pattern clips.
 */
function herringbonePattern(id, s, px) {
  const k = HB_K;
  const W = HB_W;
  const T = HB_TILE;
  // plank-grid (cell) coordinates -> rotated metres
  const rot = (x, y) => [((x + y) / Math.SQRT2) * W, ((y - x) / Math.SQRT2) * W];
  const polys = [];
  const rect = (x0, y0, x1, y1) => {
    const pts = [rot(x0, y0), rot(x1, y0), rot(x1, y1), rot(x0, y1)];
    if (pts.every(([a, b]) => a < -0.01 || a > T + 0.01) || pts.every(([, b]) => b < -T - 0.01 || b > T + 0.01)) return;
    polys.push(`<polygon points="${pts.map(([a, b]) => `${s(a)},${s(b)}`).join(" ")}"/>`);
  };
  for (let c = -2; c <= 2; c++) {
    for (let r = -2 * k; r <= 2 * k; r++) {
      rect(r + 2 * k * c, r, r + 2 * k * c + k, r + 1); // horizontal plank
      rect(r + 2 * k * c, r + 1, r + 2 * k * c + 1, r + 1 + k); // vertical plank
    }
  }
  // The rotated lattice is rectangular with period T in both directions
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s(T)}" height="${s(T)}">
    <g fill="none" stroke="rgba(0,0,0,.28)" stroke-width="${s(px(1))}">${polys.join("")}</g></pattern>`;
}

/** SVG <pattern> for a floor finish (world units = metres), or "" for plain. */
/** The 2D pattern for a floor finish, turned by `rotation` degrees. */
export function floorPattern(id, finish, px, rotation = 0) {
  const svg = floorPatternBase(id, finish, px);
  return rotation ? svg.replace("<pattern ", `<pattern patternTransform="rotate(${+rotation})" `) : svg;
}

function floorPatternBase(id, finish, px) {
  const s = (v) => +v.toFixed(4);
  const line = (x1, y1, x2, y2, w = px(1)) =>
    `<line x1="${s(x1)}" y1="${s(y1)}" x2="${s(x2)}" y2="${s(y2)}" stroke="rgba(0,0,0,.28)" stroke-width="${s(w)}"/>`;
  switch (finish.material) {
    case "wood":
      // 20 cm planks, joints every 1.2 m staggered by 0.6 m
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="1.2" height="0.4">
        ${line(0, 0, 1.2, 0)}${line(0, 0.2, 1.2, 0.2)}${line(0.3, 0, 0.3, 0.2)}${line(0.9, 0.2, 0.9, 0.4)}</pattern>`;
    case "tiles":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.3" height="0.3">${line(0, 0, 0.3, 0)}${line(0, 0, 0, 0.3)}</pattern>`;
    case "tiles_40x25":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.4" height="0.25">${line(0, 0, 0.4, 0)}${line(0, 0, 0, 0.25)}</pattern>`;
    case "herringbone":
      return herringbonePattern(id, s, px);
    case "large_tiles":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.6" height="0.6">${line(0, 0, 0.6, 0)}${line(0, 0, 0, 0.6)}</pattern>`;
    case "carpet":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.08" height="0.08">
        <circle cx="0.02" cy="0.02" r="${s(px(0.8))}" fill="rgba(0,0,0,.18)"/><circle cx="0.06" cy="0.06" r="${s(px(0.8))}" fill="rgba(0,0,0,.12)"/></pattern>`;
    case "marble":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="1.6" height="1.6">
        <path d="M0.2,0 C0.4,0.5 0.1,0.9 0.5,1.6 M1.1,0 C0.9,0.6 1.4,1.0 1.2,1.6" fill="none" stroke="rgba(0,0,0,.14)" stroke-width="${s(px(1))}"/></pattern>`;
    case "concrete":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.5" height="0.5">
        <circle cx="0.12" cy="0.3" r="${s(px(1))}" fill="rgba(0,0,0,.12)"/><circle cx="0.38" cy="0.1" r="${s(px(1))}" fill="rgba(0,0,0,.1)"/></pattern>`;
    case "grass":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.3" height="0.3">
        <path d="M0.05,0.12 l0.01,-0.04 l0.01,0.04 M0.2,0.27 l0.01,-0.04 l0.01,0.04 M0.17,0.06 l0.01,-0.04 l0.01,0.04" fill="none"
          stroke="rgba(30,80,20,.35)" stroke-width="${s(px(1))}"/></pattern>`;
    case "gravel":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.12" height="0.12">
        <circle cx="0.03" cy="0.04" r="${s(px(1.3))}" fill="rgba(0,0,0,.18)"/><circle cx="0.09" cy="0.02" r="${s(px(1))}" fill="rgba(0,0,0,.12)"/>
        <circle cx="0.07" cy="0.09" r="${s(px(1.2))}" fill="rgba(0,0,0,.15)"/></pattern>`;
    case "paving":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.5" height="0.5">${line(0, 0, 0.5, 0)}${line(0, 0, 0, 0.5)}</pattern>`;
    case "decking":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="1.44" height="0.24">
        ${line(0, 0, 1.44, 0, px(1.5))}${line(0, 0.12, 1.44, 0.12, px(1.5))}${line(0.5, 0, 0.5, 0.12)}${line(1.2, 0.12, 1.2, 0.24)}</pattern>`;
    case "soil":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.1" height="0.1">
        <circle cx="0.03" cy="0.03" r="${s(px(1))}" fill="rgba(0,0,0,.25)"/><circle cx="0.08" cy="0.07" r="${s(px(1))}" fill="rgba(0,0,0,.2)"/></pattern>`;
    case "water":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="0.8" height="0.4">
        <path d="M0.05,0.1 q0.1,-0.06 0.2,0 M0.45,0.3 q0.1,-0.06 0.2,0" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="${s(px(1.2))}"/></pattern>`;
    default:
      return "";
  }
}
