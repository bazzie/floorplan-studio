// Rendering quality for this device. Wall tablets and phones often have a weak GPU and
// little memory: there the views use a lighter profile (fewer pixels, simpler shadows,
// fewer lights, slower animation, no blur). "Automatic" decides per device, in order:
//   1. a measurement made earlier on this device (see view3d.js: the first time the 3D
//      view opens on a GPU we don't know, and when it stays slow while in use),
//   2. the GPU's model, which Chromium-based browsers report (Chrome, Edge, and the
//      Android WebView of the Home Assistant app and kiosk browsers); Safari and the iOS
//      app only say "Apple GPU", Firefox only a rough class,
//   3. memory, CPU cores and touch screen.
// The choice can be overridden per browser in the side panel.
import { readPref, writePref } from "./model.js";

export const QUALITY_MODES = ["auto", "high", "low"];

const PROFILES = {
  high: {
    pixelRatio: 2, // most a high-DPI screen gets (devicePixelRatio is capped at this)
    antialias: true,
    softShadows: true,
    sunShadow: 2048,
    lampShadows: Infinity, // as many as the GPU's texture slots allow
    sharpShadows: 3, // lamps with the sharpest shadow maps
    maxLights: 16,
    fps: 60, // animation (sound waves, a turning drum, a driving robot)
    blur: true, // blurred glows in 2D (ambilight, radiator heat)
  },
  low: {
    pixelRatio: 1,
    antialias: false,
    softShadows: false,
    sunShadow: 1024,
    lampShadows: 4,
    sharpShadows: 0,
    // As many lights as shadows: a light without a shadow shines through walls (more
    // lamps that are on share these, see _assignLights)
    maxLights: 4,
    fps: 30,
    blur: false,
  },
};

// ---------- the GPU ----------

let gpu; // cached: { renderer, name } or null

/** The GPU as the browser reports it: { renderer (full string), name (short) }, or null. */
export function gpuInfo() {
  if (gpu !== undefined) return gpu;
  gpu = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      if (renderer) gpu = { renderer, name: gpuName(renderer) };
    }
  } catch (_e) {
    /* no WebGL: the 3D view says so itself */
  }
  return gpu;
}

/**
 * A short GPU name from the renderer string, without the ANGLE wrapper and driver:
 * "ANGLE (Qualcomm, Adreno (TM) 610, OpenGL ES 3.2)" -> "Adreno 610".
 */
export function gpuName(renderer) {
  let s = String(renderer);
  const angle = s.match(/^ANGLE \((.*)\)$/);
  if (angle) {
    const parts = angle[1].split(", ");
    s = parts.length > 1 ? parts[1] : parts[0];
  }
  return s
    .replace(/ANGLE Metal Renderer: /, "")
    .replace(/\(TM\)|\(R\)|™|®/g, "")
    .replace(/\s*\(0x[0-9a-f]+\)/i, "")
    .replace(/\s+(Direct3D|OpenGL|Vulkan|vs_|ps_|D3D).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Renderer strings of GPUs too slow for the full profile, and of fast ones. Anything else
// (or "Apple GPU", which hides the model) is unknown and gets measured.
const SLOW_GPUS = [
  /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i, // no GPU: software rendering
  /mali-(4\d\d|t\d{3}|g31|g51|g52|g57|g68)\b/i, // ARM Mali, older and entry level
  /adreno[^0-9]*(\d{3})/i, // Qualcomm Adreno: below 630 (see below)
  /powervr|ge8\d{3}|img bxm/i, // Imagination, budget tablets
  /videocore|v3d/i, // Raspberry Pi
  /vivante|gc\d{4}/i,
  /intel.*hd graphics( \d{3,4})?\b(?!.*(iris|xe|arc))/i, // Intel HD (older integrated)
  /intel.*uhd graphics 6(00|05)\b/i, // Celeron / Atom
  /tegra( [234])?\b/i,
];
const FAST_GPUS = [
  /nvidia|geforce|rtx|quadro/i,
  /radeon|amd/i,
  /apple m\d|apple a1[4-9]/i, // Apple silicon (Chrome on a Mac names the chip)
  /iris|intel.*xe|intel.*arc|intel.*uhd graphics (6[1-9]\d|7\d\d)/i,
  /mali-(g7\d|g6[1-9]0|g7[1-9]0)|immortalis/i,
  /adreno[^0-9]*(6[3-9]\d|7\d\d|8\d\d)/i,
];

/** "low", "high" or null (unknown) for a GPU renderer string. */
export function classifyGpu(renderer) {
  if (!renderer) return null;
  if (FAST_GPUS.some((rx) => rx.test(renderer))) return "high";
  for (const rx of SLOW_GPUS) {
    const m = renderer.match(rx);
    if (!m) continue;
    if (/adreno/i.test(rx.source)) return Number(m[1]) < 630 ? "low" : "high";
    return "low";
  }
  return null;
}

// ---------- memory, cores, touch ----------

/** Does this device look like it needs the light profile? (memory, cores, touch screen) */
export function slowDevice() {
  const memory = navigator.deviceMemory; // GB, rounded; Chromium only
  const cores = navigator.hardwareConcurrency;
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return (memory !== undefined && memory <= 4) || (cores !== undefined && cores <= 4) || (touch && (memory ?? 8) <= 6);
}

// ---------- measurement ----------

const MEASURED = "quality_measured"; // "low" | "high" (pref, per browser)

/** The result of an earlier measurement on this device, or null. */
export const measuredQuality = () => {
  const m = readPref(MEASURED, "");
  return m === "low" || m === "high" ? m : null;
};

export const setMeasuredQuality = (name) => writePref(MEASURED, name);

/** Should the 3D view measure this device? (automatic, nothing known about its GPU, not measured yet) */
export const needsMeasurement = () => qualityMode() === "auto" && !measuredQuality() && !classifyGpu(gpuInfo()?.renderer);

// ---------- the profile ----------

/** The chosen mode: "auto", "high" or "low". */
export const qualityMode = () => {
  const m = readPref("quality", "auto");
  return QUALITY_MODES.includes(m) ? m : "auto";
};

export const setQualityMode = (mode) => writePref("quality", QUALITY_MODES.includes(mode) ? mode : "auto");

/**
 * What "Automatic" picks on this device and why: { name: "high" | "low", reason }, where
 * reason is "measured", "gpu" (with gpu: its short name) or "hardware".
 */
export function autoQuality() {
  const measured = measuredQuality();
  if (measured) return { name: measured, reason: "measured" };
  const info = gpuInfo();
  const byGpu = classifyGpu(info?.renderer);
  if (byGpu) return { name: byGpu, reason: "gpu", gpu: info.name };
  return { name: slowDevice() ? "low" : "high", reason: "hardware" };
}

/** The profile in use: { name: "high" | "low", ...settings }. */
export function quality() {
  const mode = qualityMode();
  const name = mode === "auto" ? autoQuality().name : mode;
  return { name, ...PROFILES[name] };
}
