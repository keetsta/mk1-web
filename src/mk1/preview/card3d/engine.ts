import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BOARD, LEDS } from "../geometry";
import { button, leds, materials, sensor, usb } from "./parts";
import { printSurface } from "./surface";

/* The card as a thing on the page: the board and its front parts in millimetres, lit the way the site's
   shop lights its stage (keetsta-website, popup/engine.ts), lying on the page and lifting off it. */

/** one warm lamp high and in front a little to the left, and three's RoomEnvironment for what things
 *  reflect: the shop's LIGHT, with the shadow the page takes */
const LIGHT = {
  toLamp: [-0.3, 0.62, 0.72],
  blur: 0.04,
  light: { lamp: 0xfff4e6, power: 2.3, room: 0.85, shadow: 0x2a2112, opacity: 0.17, blob: 0.16, exposure: 1 },
  // at night the white board is lamp-lit, not a slab of light on the dark desk; the lit LEDs (drawn past
  // tone mapping) stay as bright as they are
  dark: { lamp: 0xffe2bd, power: 1.9, room: 0.7, shadow: 0x000000, opacity: 0.42, blob: 0.45, exposure: 0.84 },
} as const;

const THICK = 1.0;
/** the page under the card: lying on it, the card's back touches it */
const PAGE = -THICK - 0.02;
const FOV = 20;
/** at rest the card is tipped back a little, turned a little and lifted off the page (mm); never so far
 *  that a corner would reach the page */
const REST = { rx: -0.05, ry: 0.035, lift: 4 };
/** with reduced motion it never moves: it lies flat, as the drawing before it did */
const STILL = { rx: 0, ry: 0, lift: 2 };
/** the keystake's brass up and pressed (parts.ts brass is the first) */
const BRASS = { up: new THREE.Color(0xc9a65c), down: new THREE.Color(0x8a6f3a) };
/** the LEDs' ramps, 1/s: on fast, off a little slower, never a hard blink */
const LED_ON = 1 / 0.035;
const LED_OFF = 1 / 0.07;

/** a damped spring after a target (the shop's) */
class Spring {
  x = 0;
  v = 0;
  target = 0;
  w: number;
  z: number;
  constructor(w: number, z: number) {
    this.w = w;
    this.z = z;
  }
  step(dt: number) {
    this.v += (-2 * this.z * this.w * this.v - this.w * this.w * (this.x - this.target)) * dt;
    this.x += this.v * dt;
  }
  set(x: number) {
    this.x = this.target = x;
    this.v = 0;
  }
  get moving() {
    return Math.abs(this.x - this.target) > 1e-4 || Math.abs(this.v) > 1e-4;
  }
}

/** The room the card reflects, prefiltered. Generated straight away it holds the main thread while the
 *  filters' shaders compile, so they're compiled first, in the background, the way the generator draws
 *  them (the shop's roomLight: its private fields; a later three only loses the head start). */
async function roomLight(renderer: THREE.WebGLRenderer, pmrem: THREE.PMREMGenerator) {
  const room = new RoomEnvironment();
  const inner = pmrem as unknown as {
    _setSize?(size: number): void;
    _allocateTargets?(): THREE.WebGLRenderTarget;
    _blurMaterial?: THREE.Material | null;
    _ggxMaterial?: THREE.Material | null;
  };
  const filters = new THREE.Scene();
  const plane = new THREE.BufferGeometry();
  plane.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  let early: THREE.WebGLRenderTarget | undefined;
  try {
    inner._setSize?.(256);
    early = inner._allocateTargets?.();
    for (const m of [inner._blurMaterial, inner._ggxMaterial]) if (m) filters.add(new THREE.Mesh(plane, m));
  } catch {
    // a later three: no head start
  }
  const backdrop = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false }),
  );
  const target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  const compiling = Promise.all([
    renderer.compileAsync(room, new THREE.PerspectiveCamera()),
    renderer.compileAsync(backdrop, new THREE.PerspectiveCamera()),
    renderer.compileAsync(filters, new THREE.OrthographicCamera()),
  ]);
  renderer.setRenderTarget(was);
  await compiling;
  early?.dispose();
  target.dispose();
  const light = pmrem.fromScene(room, LIGHT.blur).texture;
  plane.dispose();
  backdrop.geometry.dispose();
  backdrop.material.dispose();
  room.dispose();
  return light;
}

function outline() {
  const w = BOARD.w / 2;
  const h = BOARD.h / 2;
  const r = BOARD.r;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w, h - r);
  s.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w + r, h);
  s.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w, -h + r);
  s.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** the board: 1 mm of FR-4, its edges eased a little, the face at z = 0. Materials: back, edge, face. */
function boardGeometry() {
  const bev = 0.08;
  const g = new THREE.ExtrudeGeometry(outline(), {
    depth: THICK - 2 * bev,
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: -bev,
    bevelSegments: 2,
    curveSegments: 20,
  });
  g.translate(0, 0, -(THICK - bev));
  // the lids come first in one group, the back's then the face's: give the face its own
  const lids = g.groups.find((x) => x.materialIndex === 0)!;
  const half = lids.count / 2;
  g.groups = g.groups.filter((x) => x !== lids);
  g.addGroup(lids.start, half, 0);
  g.addGroup(lids.start + half, half, 2);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / BOARD.w + 0.5, pos.getY(i) / BOARD.h + 0.5);
  return g;
}

/** a soft rounded shadow for right under the card, grey on black: an alpha map reads the green */
const BLOB = { w: 256, h: 176, cw: 176, ch: 112 };
function blobTexture() {
  const c = document.createElement("canvas");
  c.width = BLOB.w;
  c.height = BLOB.h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, BLOB.w, BLOB.h);
  // blurred by its own shadow, drawn off the canvas so only the shadow lands: older Safari ignores ctx.filter
  ctx.shadowColor = "#fff";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetX = BLOB.w * 2;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect((BLOB.w - BLOB.cw) / 2 - BLOB.w * 2, (BLOB.h - BLOB.ch) / 2, BLOB.cw, BLOB.ch, 8);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export type Rect = { x: number; y: number; w: number; h: number };

export type CardOptions = {
  dark: boolean;
  /** reduced motion: the card lies still */
  still: boolean;
  /** after a frame that moved the card: its button, in canvas px */
  onPose?(button: Rect): void;
  /** the card has come to rest after its intro */
  onSettle?(): void;
  /** WebGL went away: show the drawing again */
  onLost?(): void;
};

export type Card3D = {
  /** the surface printed, the light made, the shaders compiled */
  ready: Promise<void>;
  /** the canvas's size in css px and where the card's box sits in it */
  layout(w: number, h: number, card: Rect): void;
  rows(rows: Uint16Array): void;
  press(down: boolean): void;
  theme(dark: boolean): void;
  visible(on: boolean): void;
  /** lift off the page */
  intro(): void;
  dispose(): void;
};

export function startCard(canvas: HTMLCanvasElement, opt: CardOptions): Card3D | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.debug.checkShaderErrors = import.meta.env.DEV;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 1000);
  const pmrem = new THREE.PMREMGenerator(renderer);

  // the lamp is a wide spot rather than the sun: its light falls off a little toward the card's far corner,
  // as a desk lamp's does, instead of lying flat over all of it
  const toLamp = new THREE.Vector3(...LIGHT.toLamp).normalize();
  const key = new THREE.SpotLight(0xffffff, LIGHT.light.power, 0, 0.34, 1, 0);
  key.position.copy(toLamp).multiplyScalar(300);
  key.target.position.set(-12, 9, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 200;
  key.shadow.camera.far = 420;
  key.shadow.radius = 7;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);

  // the page: it only takes the card's shadows; what shows there is the DOM's own paper
  const pageShadow = new THREE.ShadowMaterial({ depthWrite: false });
  const page = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), pageShadow);
  page.position.z = PAGE;
  page.receiveShadow = true;
  scene.add(page);
  const blobMat = new THREE.MeshBasicMaterial({ alphaMap: blobTexture(), transparent: true, depthWrite: false });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry((BOARD.w * BLOB.w) / BLOB.cw, (BOARD.h * BLOB.h) / BLOB.ch), blobMat);
  blob.scale.setScalar(0.9);
  blob.position.z = PAGE + 0.01;
  blob.renderOrder = -1;
  scene.add(blob);

  // ── the card ──
  const card = new THREE.Group();
  scene.add(card);
  const face = new THREE.MeshPhysicalMaterial({ color: 0xf2f0e9, roughness: 0.4, metalness: 0 });
  const board = new THREE.Mesh(boardGeometry(), [
    new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xe4d9bb, roughness: 0.72 }),
    face,
  ]);
  board.castShadow = true;
  board.receiveShadow = true;
  card.add(board);
  const mats = materials();
  const matrix = leds(mats);
  card.add(matrix.group);
  const sw = button(mats);
  card.add(sw.group, sensor(mats), usb(mats));

  // ── motion ──
  const still = opt.still;
  const rest = still ? STILL : REST;
  const rx = new Spring(8.5, 0.82);
  const ry = new Spring(8.5, 0.82);
  const lift = new Spring(8.5, 0.86);
  const push = new Spring(42, 0.9);
  rx.set(0);
  ry.set(0);
  lift.set(still ? STILL.lift : 0);
  // up off the page it stays at rest: the card doesn't follow the pointer
  let up = false;
  let settled = false;

  const n = LEDS.length;
  const want = new Float32Array(n);
  const led = matrix.lit.array as Float32Array;

  let dark = opt.dark;
  const paint = () => {
    const l = LIGHT[dark ? "dark" : "light"];
    key.color.set(l.lamp);
    key.intensity = l.power;
    scene.environmentIntensity = l.room;
    renderer.toneMappingExposure = l.exposure;
    pageShadow.color.set(l.shadow);
    pageShadow.opacity = l.opacity;
    blobMat.color.set(l.shadow);
  };
  paint();

  // ── the frame ──
  let W = 1;
  let H = 1;
  let shown = true;
  let raf = 0;
  let last = 0;
  let poseDirty = true;
  const corner = new THREE.Vector3();
  const buttonRect = (): Rect => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    sw.group.updateWorldMatrix(true, false);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      corner.set(sx * 2.55, sy * 2.55, 1.2).applyMatrix4(sw.group.matrixWorld).project(camera);
      const x = ((corner.x + 1) / 2) * W;
      const y = ((1 - corner.y) / 2) * H;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  const step = (dt: number) => {
    let moving = false;
    for (const s of [rx, ry, lift, push]) {
      if (!s.moving) continue;
      s.step(dt);
      moving = true;
    }
    if (moving) poseDirty = true;
    let lighting = false;
    for (let i = 0; i < n; i++) {
      const t = want[i];
      const v = led[i];
      if (v === t) continue;
      const k = 1 - Math.exp(-(t > v ? LED_ON : LED_OFF) * dt);
      led[i] = Math.abs(t - v) < 0.004 ? t : v + (t - v) * k;
      lighting = true;
    }
    if (lighting) matrix.lit.needsUpdate = true;
    return moving || lighting;
  };

  const render = () => {
    card.rotation.set(rx.x, ry.x, 0);
    card.position.z = lift.x;
    // pressed, only the keystake moves and the card stays put. its 0.2 of travel can't be seen from the
    // front, so it also darkens, as the drawing's does
    sw.stem.position.z = -0.2 * push.x;
    sw.brass.color.lerpColors(BRASS.up, BRASS.down, push.x);
    const l = LIGHT[dark ? "dark" : "light"];
    const k = Math.max(0, lift.x) / REST.lift;
    blob.scale.setScalar(0.9 + 0.08 * k);
    blobMat.opacity = l.blob * (1 - 0.4 * k);
    if (poseDirty) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    if (poseDirty) opt.onPose?.(buttonRect());
    poseDirty = false;
  };

  const tick = (t: number) => {
    raf = 0;
    // real time, so a slow device (or a software GL) sees the same motion in fewer frames; the springs
    // in short steps, which keeps them stable
    let dt = Math.min(0.25, Math.max(0, (t - last) / 1000));
    last = t;
    let moving = false;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 120);
      moving = step(h) || moving;
      dt -= h;
    }
    render();
    if (moving && shown) raf = requestAnimationFrame(tick);
    else if (up && !settled) {
      settled = true;
      opt.onSettle?.();
    }
  };
  // nothing is drawn before the shaders are compiled in the background: a draw would compile them on the
  // main thread and hold the page
  let armed = false;
  const wake = () => {
    if (raf || !shown || disposed || !armed) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  let disposed = false;
  const lost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
    opt.onLost?.();
  };
  canvas.addEventListener("webglcontextlost", lost);

  const ready = (async () => {
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const width = Math.min(renderer.capabilities.maxTextureSize, innerWidth < 700 ? 1536 : 2048);
    const [env, surface] = await Promise.all([roomLight(renderer, pmrem), printSurface(width, aniso)]);
    if (disposed) return;
    scene.environment = env;
    face.map = surface.albedo;
    face.roughnessMap = surface.packed;
    face.metalnessMap = surface.packed;
    face.bumpMap = surface.packed;
    face.bumpScale = 1.2;
    // matte ink keeps little of the room's sheen: the name reads black, not grey
    face.specularIntensityMap = surface.packed;
    face.roughness = 1;
    face.metalness = 1;
    face.color.set(0xffffff);
    face.needsUpdate = true;
    await renderer.compileAsync(scene, camera);
    if (disposed) return;
    armed = true;
    poseDirty = true;
    render();
  })();

  return {
    ready,
    layout(w, h, box) {
      W = w;
      H = h;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      // the card's plane (z = 0) maps 1:1 onto its box, so the drawing and the card line up
      const mmPerPx = BOARD.w / box.w;
      const D = (h * mmPerPx) / 2 / Math.tan((FOV * Math.PI) / 360);
      camera.aspect = w / h;
      camera.near = D * 0.5;
      camera.far = D * 2;
      camera.position.set(0, 0, D);
      camera.lookAt(0, 0, 0);
      // a box off the canvas's centre: shift the lens, not the eye
      const dx = box.x + box.w / 2 - w / 2;
      const dy = box.y + box.h / 2 - h / 2;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) camera.setViewOffset(w, h, -dx, -dy, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      poseDirty = true;
      if (!raf && shown && armed) render();
    },
    rows(rows) {
      for (let i = 0; i < n; i++) want[i] = (rows[i >> 4] >> (15 - (i & 15))) & 1;
      wake();
    },
    press(down) {
      push.target = down ? 1 : 0;
      wake();
    },
    theme(d) {
      dark = d;
      paint();
      if (!raf && shown && armed) render();
    },
    visible(on) {
      shown = on;
      if (on) wake();
      else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    intro() {
      up = true;
      settled = false;
      if (still) {
        rx.set(rest.rx);
        ry.set(rest.ry);
        lift.set(rest.lift);
        poseDirty = true;
      }
      rx.target = rest.rx;
      ry.target = rest.ry;
      lift.target = rest.lift;
      wake();
      if (still && !raf) {
        render();
        settled = true;
        opt.onSettle?.();
      }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      canvas.removeEventListener("webglcontextlost", lost);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
