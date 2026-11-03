import * as THREE from "three";
import { BOARD, BUTTON, LEDS, SENSOR, USB } from "../geometry";

/* The front's parts, modelled from their datasheets in millimetres. The board's face is z = 0, x to the
   right and y up, its centre at the origin (geometry.ts has y down from the top-left corner). */

export const toWorld = (x: number, y: number) => new THREE.Vector3(x - BOARD.w / 2, BOARD.h / 2 - y, 0);

const box = (w: number, d: number, h: number, x = 0, y = 0, z = h / 2) => {
  const g = new THREE.BoxGeometry(w, d, h);
  g.translate(x, y, z);
  return g;
};

/** a stadium (a rectangle with round ends) of width w and height h, centred on (0, cy) */
function stadium(w: number, h: number, cy: number, path: THREE.Path = new THREE.Path()) {
  const r = h / 2;
  const a = w / 2 - r;
  path.moveTo(-a, cy - r);
  path.lineTo(a, cy - r);
  path.absarc(a, cy, r, -Math.PI / 2, Math.PI / 2, false);
  path.lineTo(-a, cy + r);
  path.absarc(-a, cy, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return path;
}

export type Materials = ReturnType<typeof materials>;

export function materials() {
  return {
    solder: new THREE.MeshStandardMaterial({ color: 0xe6e7e8, metalness: 0.8, roughness: 0.46 }),
    tin: new THREE.MeshStandardMaterial({ color: 0xc4c6c7, metalness: 1, roughness: 0.36 }),
    // stainless, nickel-plated: silver with the room in it, not a white slab
    steel: new THREE.MeshStandardMaterial({ color: 0x84878b, metalness: 1, roughness: 0.36 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a65c, metalness: 1, roughness: 0.28 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1e1d1b, roughness: 0.55 }),
    cavity: new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.7, metalness: 0.4, side: THREE.BackSide }),
    slot: new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.6, metalness: 0.3 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xf1ead9, roughness: 0.6 }),
    die: new THREE.MeshStandardMaterial({ color: 0x4a3a33, roughness: 0.35, metalness: 0.45 }),
    cathode: new THREE.MeshStandardMaterial({ color: 0x6b9f78, roughness: 0.6 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.5, metalness: 0.2 }),
    sensorDie: new THREE.MeshStandardMaterial({ color: 0xa89270, roughness: 0.3, metalness: 0.6 }),
    // TEMT6200FX01: green-tinted clear epoxy, its near-infrared filter
    green: new THREE.MeshPhysicalMaterial({
      color: 0x3e9f5d,
      transparent: true,
      opacity: 0.8,
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  };
}

/** KT-0603R: 1.6 × 0.8 × 0.6, a flat clear lens over a white substrate, the die in the middle, a green
 *  cathode mark in a corner, solder at both ends. Lit, the lens is the LED's colour, flat: no glow. */
export function leds(m: Materials) {
  const n = LEDS.length;
  const group = new THREE.Group();
  const place = LEDS.map(([x, y, rot]) => {
    const p = toWorld(x, y);
    return new THREE.Matrix4().makeRotationZ((-rot * Math.PI) / 180).setPosition(p);
  });
  const many = (geo: THREE.BufferGeometry, mat: THREE.Material, each: THREE.Matrix4[] = [new THREE.Matrix4()]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, n * each.length);
    const t = new THREE.Matrix4();
    for (let i = 0; i < n; i++) for (let k = 0; k < each.length; k++) mesh.setMatrixAt(i * each.length + k, t.multiplyMatrices(place[i], each[k]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const ends = [new THREE.Matrix4().makeTranslation(-0.72, 0, 0), new THREE.Matrix4().makeTranslation(0.72, 0, 0)];
  // turned, not mirrored: an instanced mesh has one winding for all its instances
  const turn = new THREE.Matrix4().makeRotationZ(Math.PI);
  many(box(1.3, 0.8, 0.28), m.ceramic);
  many(box(0.16, 0.8, 0.285), m.solder, ends);
  many(box(0.14, 0.16, 0.012, -0.56, 0.26, 0.285), m.cathode);
  many(box(0.22, 0.22, 0.08, 0, 0, 0.32), m.die);
  // the fillets: solder from the substrate's ends down onto the pads
  const fillet = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.27, 0), new THREE.Vector2(0, 0.22)]);
  const filletGeo = new THREE.ExtrudeGeometry(fillet, { depth: 0.78, bevelEnabled: false });
  filletGeo.rotateX(Math.PI / 2);
  filletGeo.translate(0.8, 0.39, 0);
  many(filletGeo, m.solder, [new THREE.Matrix4(), turn]);

  const lit = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const lensGeo = box(1.6, 0.8, 0.32, 0, 0, 0.44);
  lensGeo.setAttribute("lit", lit);
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.16,
    roughness: 0.08,
    clearcoat: 0.5,
    clearcoatRoughness: 0.06,
    ior: 1.5,
  });
  // lit, the lens takes the LED's colour (sRGB, past tone mapping), a touch warmer in its middle
  lens.onBeforeCompile = (sh) => {
    sh.uniforms.uEdge = { value: new THREE.Vector3(1.0, 0.231, 0.078) };
    sh.uniforms.uCore = { value: new THREE.Vector3(1.0, 0.43, 0.2) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float lit;\nvarying float vLit;\nvarying vec2 vLitUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLit = lit;\nvLitUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uEdge;\nuniform vec3 uCore;\nvarying float vLit;\nvarying vec2 vLitUv;")
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        vec2 q = (vLitUv - 0.5) * vec2(1.0, 2.0);
        vec3 led = mix(uEdge, uCore, smoothstep(0.42, 0.0, length(q)));
        gl_FragColor = vec4(mix(gl_FragColor.rgb, led, vLit), mix(gl_FragColor.a, 1.0, vLit));`,
      );
  };
  lens.customProgramCacheKey = () => "mk1-led-lens";
  const lensMesh = many(lensGeo, lens);
  lensMesh.castShadow = false;
  lensMesh.renderOrder = 2;
  return { group, lit };
}

const placeBody = (b: { x: number; y: number; rot: number }, obj: THREE.Object3D) => {
  obj.position.copy(toWorld(b.x, b.y));
  obj.rotation.z = (-b.rot * Math.PI) / 180;
  return obj;
};

const shadowed = (o: THREE.Object3D) => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
};

/** TS-1187A-B-A-B: 5.1 × 5.1, 1.5 high. A black LCP base, a stainless cover with its corners cut, a brass
 *  keystake Ø2 that travels 0.2. Returns the keystake to press and its material. */
export function button(m: Materials) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(box(4.9, 4.9, 0.9), m.plastic));
  const c = 0.85;
  const s = 2.55;
  const oct = new THREE.Shape([
    new THREE.Vector2(-s + c, -s), new THREE.Vector2(s - c, -s), new THREE.Vector2(s, -s + c), new THREE.Vector2(s, s - c),
    new THREE.Vector2(s - c, s), new THREE.Vector2(-s + c, s), new THREE.Vector2(-s, s - c), new THREE.Vector2(-s, -s + c),
  ]);
  oct.holes.push(new THREE.Path().absarc(0, 0, 1.08, 0, Math.PI * 2, true));
  const cover = new THREE.ExtrudeGeometry(oct, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 1, curveSegments: 32 });
  cover.translate(0, 0, 0.9);
  g.add(new THREE.Mesh(cover, m.steel));
  const ring = new THREE.Shape().absarc(0, 0, 1.62, 0, Math.PI * 2, false);
  ring.holes.push(new THREE.Path().absarc(0, 0, 1.08, 0, Math.PI * 2, true));
  const ringGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelOffset: -0.04, bevelSegments: 2, curveSegments: 40 });
  ringGeo.translate(0, 0, 1.1);
  g.add(new THREE.Mesh(ringGeo, m.steel));
  // the cover's tabs, folded down over the base's sides
  for (const [x, y, w, d] of [[0, -2.53, 1.3, 0.1], [0, 2.53, 1.3, 0.1], [-2.53, 0, 0.1, 1.3], [2.53, 0, 0.1, 1.3]]) {
    g.add(new THREE.Mesh(box(w, d, 0.55, x, y, 0.62), m.steel));
  }
  // terminals: out of the base's sides onto the four pads
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(new THREE.Mesh(box(0.85, 0.5, 0.12, sx * 2.85, sy * 1.85, 0.06), m.tin));
  const stem = new THREE.Group();
  const cap = new THREE.CylinderGeometry(1.0, 1.0, 0.6, 48, 1);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0, 1.2);
  // its own brass: pressed, the keystake darkens
  const brass = m.brass.clone();
  stem.add(new THREE.Mesh(cap, brass));
  g.add(stem);
  return { group: shadowed(placeBody(BUTTON, g)), stem, brass };
}

/** TEMT6200FX01: 2.0 × 1.25 × 0.85, green epoxy on a copper-brown substrate, the die seen through it */
export function sensor(m: Materials) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(box(1.4, 1.25, 0.2), m.copper));
  g.add(new THREE.Mesh(box(0.3, 1.25, 0.21, -0.85), m.solder));
  g.add(new THREE.Mesh(box(0.3, 1.25, 0.21, 0.85), m.solder));
  g.add(new THREE.Mesh(box(0.5, 0.5, 0.08, 0.15, 0, 0.24), m.sensorDie));
  const epoxy = new THREE.Mesh(box(2.0, 1.25, 0.65, 0, 0, 0.525), m.green);
  epoxy.renderOrder = 2;
  g.add(epoxy);
  return shadowed(placeBody(SENSOR, g));
}

/** HRO TYPE-C-31-M-12: a stainless shell 8.94 × 3.2, 7.35 deep, its mouth past the board's edge, the
 *  tongue inside, the contacts' tails behind it */
export function usb(m: Materials) {
  const g = new THREE.Group();
  const depth = USB.h;
  const outer = new THREE.Shape();
  stadium(USB.w, 3.2, 1.6, outer);
  outer.holes.push(stadium(8.34, 2.56, 1.6));
  const shellGeo = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 24 });
  // the shape's plane is (y, z), it is pushed along x; the mouth faces -x
  const toX = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  shellGeo.applyMatrix4(toX);
  shellGeo.translate(-depth / 2, 0, 0);
  g.add(new THREE.Mesh(shellGeo, m.steel));
  const back = new THREE.ShapeGeometry(stadium(USB.w, 3.2, 1.6, new THREE.Shape()) as THREE.Shape, 24);
  back.applyMatrix4(toX);
  back.translate(depth / 2, 0, 0);
  g.add(new THREE.Mesh(back, m.steel));
  // looking in at the mouth: a dark cavity, not the shell's polished inside
  const cav = new THREE.ExtrudeGeometry(stadium(8.3, 2.52, 1.6, new THREE.Shape()) as THREE.Shape, { depth: depth - 0.15, bevelEnabled: false, curveSegments: 24 });
  cav.applyMatrix4(toX);
  cav.translate(-depth / 2 + 0.05, 0, 0);
  g.add(new THREE.Mesh(cav, m.cavity));
  g.add(new THREE.Mesh(box(4.3, 6.6, 0.7, -depth / 2 + 1.25 + 2.15, 0, 1.25), m.plastic));
  // the latch springs' windows in the shell's top, toward the back
  for (const y of [-1.95, 1.95]) g.add(new THREE.Mesh(box(1.2, 0.75, 0.02, depth / 2 - 1.5, y, 3.2), m.slot));
  // the contacts' tails, onto their pads behind the shell
  for (let i = 0; i < 12; i++) g.add(new THREE.Mesh(box(0.55, 0.3, 0.1, depth / 2 + 0.25, -2.75 + i * 0.5, 0.05), m.tin));
  // the board's x is the connector's depth here: no turn
  g.position.copy(toWorld(USB.x, USB.y));
  return shadowed(g);
}
