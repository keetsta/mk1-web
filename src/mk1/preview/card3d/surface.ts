import * as THREE from "three";
import { BOARD } from "../geometry";
import cuSvg from "../layers/f-cu.svg?raw";
import drillSvg from "../layers/f-drill.svg?raw";
import maskSvg from "../layers/f-mask.svg?raw";
import pasteSvg from "../layers/f-paste.svg?raw";
import silkSvg from "../layers/f-silk.svg?raw";

/** The front face of the board, printed from its own layers (tools/card_geometry.py plots them with
 *  kicad-cli): white solder mask over laminate and over copper, tented vias, the pads' solder, the ink.
 *  Two maps: what the eye sees, and a packed one read by three as bump (R), roughness (G), metalness (B)
 *  and specular intensity (A). */
const ORDER = [
  ["cu", cuSvg],
  ["drill", drillSvg],
  ["mask", maskSvg],
  ["paste", pasteSvg],
  ["silk", silkSvg],
] as const;
type Layer = (typeof ORDER)[number][0];

const ALBEDO: Record<"base" | Layer, string> = {
  base: "#f3f2ee", // white mask over bare laminate
  cu: "#ece8dd", // the same mask over copper: a shade warmer
  drill: "#d9d5cb", // a tented via's dimple
  mask: "#c3c5c7", // copper left bare by the mask: on this face every such pad is soldered, the USB-C's legs too
  paste: "#c9cbcd", // reflowed solder
  silk: "#100f0d",
};
// height (relief under the mask, solder standing proud), roughness, metalness: 0..255
const PACKED: Record<"base" | Layer, readonly [number, number, number]> = {
  base: [96, 96, 0],
  cu: [160, 88, 0],
  drill: [20, 125, 0],
  mask: [150, 56, 255],
  paste: [205, 46, 255],
  silk: [184, 232, 0],
};

const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

function sheet(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function stencil(svg: string, w: number, h: number) {
  // sized in pixels, so the browser rasterises the vectors at the size they're drawn
  const sized = svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = sheet(w, h);
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function print(stencils: Record<Layer, HTMLCanvasElement>, colour: (l: "base" | Layer) => string, w: number, h: number) {
  const out = sheet(w, h);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  const ink = sheet(w, h);
  const ictx = ink.getContext("2d")!;
  ctx.fillStyle = colour("base");
  ctx.fillRect(0, 0, w, h);
  for (const [layer] of ORDER) {
    ictx.globalCompositeOperation = "copy";
    ictx.drawImage(stencils[layer], 0, 0);
    ictx.globalCompositeOperation = "source-in";
    ictx.fillStyle = colour(layer);
    ictx.fillRect(0, 0, w, h);
    ctx.drawImage(ink, 0, 0);
  }
  return out;
}

export type Surface = { albedo: THREE.CanvasTexture; packed: THREE.CanvasTexture };

/** `width` px across the board; the work is spread over frames so the page keeps scrolling */
export async function printSurface(width: number, anisotropy: number): Promise<Surface> {
  const w = Math.round(width);
  const h = Math.round((width * BOARD.h) / BOARD.w);
  const stencils = {} as Record<Layer, HTMLCanvasElement>;
  for (const [layer, svg] of ORDER) {
    stencils[layer] = await stencil(svg, w, h);
    await frame();
  }
  const albedo = print(stencils, (l) => ALBEDO[l], w, h);
  await frame();
  const packed = print(stencils, (l) => `rgb(${PACKED[l].join(",")})`, w, h);
  await frame();

  // the relief is soft: copper under the mask is a gentle swell, not a step
  const soft = sheet(w, h);
  const sctx = soft.getContext("2d", { willReadFrequently: true })!;
  sctx.filter = `blur(${Math.max(1, w / 1400).toFixed(2)}px)`;
  sctx.drawImage(packed, 0, 0);
  const pctx = packed.getContext("2d", { willReadFrequently: true })!;
  const sharp = pctx.getImageData(0, 0, w, h);
  const blurred = sctx.getImageData(0, 0, w, h).data;
  const ink = stencils.silk.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const px = sharp.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = blurred[i];
    px[i + 3] = 255 - Math.round(ink[i + 3] * 0.75);
  }
  pctx.putImageData(sharp, 0, 0);

  const tex = (c: HTMLCanvasElement, space: THREE.ColorSpace) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = space;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };
  return { albedo: tex(albedo, THREE.SRGBColorSpace), packed: tex(packed, THREE.NoColorSpace) };
}
