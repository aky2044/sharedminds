import * as THREE from 'three';

// ─── Scene ──────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x222222, 0.002);

// ─── Camera ─────────────────────────────────────────────────
// Scroll        → depth  (forward / back along Z)
// Arrow Up/Down → height (floor / ocean / surface)
let camZ = 42;
const CAM_Z_MIN = -30;
const CAM_Z_MAX = 80;

let camY = 8;
const CAM_Y_MIN = -10;
const CAM_Y_MAX = 24;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, camY, camZ);

const keysDown = new Set();
window.addEventListener('keydown', (e) => keysDown.add(e.key));
window.addEventListener('keyup',   (e) => keysDown.delete(e.key));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('scene-container').appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
dirLight.position.set(5, 20, 15);
scene.add(dirLight);

window.addEventListener('wheel', (e) => {
  e.preventDefault();
  camZ -= e.deltaY * 0.035;
  camZ = Math.max(CAM_Z_MIN, Math.min(CAM_Z_MAX, camZ));
}, { passive: false });

// ─── Terrain — static ocean floor with rocky features ───────
// Baked once. Uses abs(sin) for sharp jutting peaks and
// max(0,…) for plateau-with-outcrop shapes — not just gentle
// sine rolls but craggy, rock-like terrain.
const DEG = Math.PI / 180;
const SURFACE_Y = 16;

const FLOOR_CFG = [
  { py: -14, rx: 0,          rz: 0,        w: 500, d: 440, sW: 65, sD: 58, op: 0.16 },
  { py: -20, rx: 0,           rz: 0,        w: 540, d: 480, sW: 50, sD: 44, op: 0.07 },
  { py: -28, rx: 0,           rz: 0,        w: 580, d: 520, sW: 38, sD: 32, op: 0.03 },
];

function bakeFloorHeight(x, z) {
  let y = 0;
  y += Math.sin(x * 0.022 + z * 0.012) * 2.2;
  y += Math.cos(z * 0.028 + x * 0.008) * 1.0;
  y += Math.sin(x * 0.055 + z * 0.04) * 0.8;
  y += Math.sin(x * 0.11 + z * 0.09) * 0.35;
  return y;
}

for (const F of FLOOR_CFG) {
  const geo = new THREE.PlaneGeometry(F.w, F.d, F.sW, F.sD);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++)
    pos.setY(i, bakeFloorHeight(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Solid black fill — same geometry, same position
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  const fillMesh = new THREE.Mesh(geo, fillMat);
  fillMesh.position.set(0, F.py, 5);
  fillMesh.rotation.x = F.rx;
  fillMesh.rotation.z = F.rz;
  scene.add(fillMesh);

  // Wireframe grid on top (polygonOffset to prevent z-fighting)
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, wireframe: true, transparent: true, opacity: F.op,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const wireMesh = new THREE.Mesh(geo, wireMat);
  wireMesh.position.set(0, F.py, 5);
  wireMesh.rotation.x = F.rx;
  wireMesh.rotation.z = F.rz;
  scene.add(wireMesh);
}

// ─── Rocks — small cube clusters scattered on the ocean floor ─
function createRock(rx, ry, rz) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const s = 0.3 + Math.random() * 0.7;
    const geo = new THREE.BoxGeometry(s, s * (0.5 + Math.random() * 0.6), s);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true,
      opacity: 0.12 + Math.random() * 0.08,
    });
    const cube = new THREE.Mesh(geo, mat);
    cube.position.set(
      (Math.random() - 0.5) * 1.4,
      s * 0.25,
      (Math.random() - 0.5) * 1.4
    );
    cube.rotation.y = Math.random() * Math.PI;
    g.add(cube);
  }
  g.position.set(rx, ry, rz);
  return g;
}

for (let i = 0; i < 40; i++) {
  const x = (Math.random() - 0.5) * 100;
  const z = (Math.random() - 0.5) * 140 + 5;
  const y = -14 + bakeFloorHeight(x, z);
  scene.add(createRock(x, y, z));
}

// ─── Large boulders — big cube clusters on the ocean floor ───
function createBoulder(bx, by, bz) {
  const g = new THREE.Group();
  const n = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const sx = 1.5 + Math.random() * 3;
    const sy = 1.0 + Math.random() * 2.5;
    const sz = 1.2 + Math.random() * 2.8;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true,
      opacity: 0.10 + Math.random() * 0.08,
    });
    const cube = new THREE.Mesh(geo, mat);
    cube.position.set(
      (Math.random() - 0.5) * 3,
      sy * 0.4 + Math.random() * 0.5,
      (Math.random() - 0.5) * 3
    );
    cube.rotation.set(
      (Math.random() - 0.5) * 0.3,
      Math.random() * Math.PI,
      (Math.random() - 0.5) * 0.2
    );
    g.add(cube);
  }
  g.position.set(bx, by, bz);
  return g;
}

for (let i = 0; i < 18; i++) {
  const x = (Math.random() - 0.5) * 100;
  const z = (Math.random() - 0.5) * 140 + 5;
  const y = -14 + bakeFloorHeight(x, z);
  scene.add(createBoulder(x, y, z));
}

// ─── Huge rocks — wide formations with black fill ─────────────
const hugeRocks = [];
function createHugeRock(hx, hy, hz) {
  const g = new THREE.Group();
  const n = 6 + Math.floor(Math.random() * 5);
  const totalH = 6 + Math.random() * 6;

  for (let i = 0; i < n; i++) {
    const sx = 3.5 + Math.random() * 5;
    const sy = 0.8 + Math.random() * (totalH / n * 1.2);
    const sz = 3.0 + Math.random() * 4.5;
    const geo = new THREE.BoxGeometry(sx, sy, sz);

    const fillMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const fill = new THREE.Mesh(geo, fillMat);
    const px = (Math.random() - 0.5) * 5;
    const py = i * (totalH / n) + sy * 0.3;
    const pz = (Math.random() - 0.5) * 5;
    const rr = [
      (Math.random() - 0.5) * 0.2,
      Math.random() * Math.PI,
      (Math.random() - 0.5) * 0.15,
    ];
    fill.position.set(px, py, pz);
    fill.rotation.set(rr[0], rr[1], rr[2]);
    g.add(fill);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true,
      opacity: 0.08 + Math.random() * 0.06,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const wire = new THREE.Mesh(geo, wireMat);
    wire.position.set(px, py, pz);
    wire.rotation.set(rr[0], rr[1], rr[2]);
    g.add(wire);
  }
  g.position.set(hx, hy, hz);
  return g;
}

const HUGE_ROCK_DATA = [
  { x: -12, z: 15 }, { x: 15, z: -5 }, { x: -8, z: -25 },
  { x: 20, z: 30 },  { x: -18, z: -10 }, { x: 8, z: -40 },
];
for (const hr of HUGE_ROCK_DATA) {
  const y = -14 + bakeFloorHeight(hr.x, hr.z);
  scene.add(createHugeRock(hr.x, y, hr.z));
  hugeRocks.push({ x: hr.x, z: hr.z, radius: 7 });
}

// ─── Ocean plants — tall thin stacked cubes like kelp ─────────
const plantGroups = [];
function createPlant(px, py, pz) {
  const g = new THREE.Group();
  const segs = 3 + Math.floor(Math.random() * 5);
  const baseW = 0.12 + Math.random() * 0.18;
  for (let i = 0; i < segs; i++) {
    const h = 0.4 + Math.random() * 0.7;
    const w = Math.max(0.06, baseW * (1 - i * 0.12));
    const geo = new THREE.BoxGeometry(w, h, w);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true,
      opacity: 0.10 + Math.random() * 0.06,
    });
    const cube = new THREE.Mesh(geo, mat);
    const ox = (Math.random() - 0.5) * 0.25;
    cube.position.set(ox, i * 0.55 + h * 0.5, (Math.random() - 0.5) * 0.25);
    cube.userData.ox = ox;
    g.add(cube);
  }
  g.position.set(px, py, pz);
  g.userData.segs = segs;
  return g;
}

for (let i = 0; i < 65; i++) {
  const x = (Math.random() - 0.5) * 120;
  const z = (Math.random() - 0.5) * 160 + 5;
  const y = -14 + bakeFloorHeight(x, z);
  const p = createPlant(x, y, z);
  plantGroups.push(p);
  scene.add(p);
}

// ─── Tall seaweed — taller stacked cubes swaying in the current ─
function createSeaweed(sx, sy, sz) {
  const g = new THREE.Group();
  const segs = 7 + Math.floor(Math.random() * 7);
  const baseW = 0.10 + Math.random() * 0.14;
  for (let i = 0; i < segs; i++) {
    const h = 0.5 + Math.random() * 0.8;
    const w = Math.max(0.04, baseW * (1 - i * 0.06));
    const geo = new THREE.BoxGeometry(w, h, w);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true,
      opacity: 0.08 + Math.random() * 0.05,
    });
    const cube = new THREE.Mesh(geo, mat);
    const ox = (Math.random() - 0.5) * 0.3;
    cube.position.set(ox, i * 0.6 + h * 0.5, (Math.random() - 0.5) * 0.3);
    cube.userData.ox = ox;
    g.add(cube);
  }
  g.position.set(sx, sy, sz);
  return g;
}

for (let i = 0; i < 30; i++) {
  const x = (Math.random() - 0.5) * 120;
  const z = (Math.random() - 0.5) * 160 + 5;
  const y = -14 + bakeFloorHeight(x, z);
  const sw = createSeaweed(x, y, z);
  plantGroups.push(sw);
  scene.add(sw);
}

// ─── Sky — white backdrop, only above the surface ───────────
// The bottom edge sits exactly at SURFACE_Y so sky is never
// visible underwater.  fog: false keeps it bright at any depth.
const skyGeo = new THREE.PlaneGeometry(700, 280);
const skyMat = new THREE.MeshBasicMaterial({
  color: 0xdddddd, fog: false, depthWrite: false, side: THREE.DoubleSide,
});
const skyMesh = new THREE.Mesh(skyGeo, skyMat);
skyMesh.renderOrder = -2;
scene.add(skyMesh);

// ─── Clouds — pixelated cube clusters above the surface ─────
function createCloud(cx, cy, cz) {
  const g = new THREE.Group();
  const n = 4 + Math.floor(Math.random() * 8);
  for (let i = 0; i < n; i++) {
    const s = 1.5 + Math.random() * 4;
    const geo = new THREE.BoxGeometry(s, s * 0.3, s * 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, fog: false });
    const cube = new THREE.Mesh(geo, mat);
    cube.position.set(
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 4
    );
    g.add(cube);
  }
  g.position.set(cx, cy, cz);
  return g;
}

const cloudGroups = [];
for (let i = 0; i < 22; i++) {
  const cloud = createCloud(
    (Math.random() - 0.5) * 180,
    SURFACE_Y + 14 + Math.random() * 22,
    (Math.random() - 0.5) * 260 + 5
  );
  scene.add(cloud);
  cloudGroups.push(cloud);
}

// ─── Sun — glowing white sphere ─────────────────────────────
const sunGroup = new THREE.Group();
const sunCore = new THREE.Mesh(
  new THREE.SphereGeometry(3, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })
);
sunGroup.add(sunCore);
// Outer glow layers
for (let i = 1; i <= 3; i++) {
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(3 + i * 2, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15 / i,
      fog: false,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  sunGroup.add(glow);
}
sunGroup.position.set(30, SURFACE_Y + 28, -60);
scene.add(sunGroup);

// ─── Underwater sky glow — bright area visible from below ────
// Multiple layers for a soft, bright glow overhead when underwater
const ugLayers = [
  { w: 600, d: 500, color: 0x99ccee, op: 0.22, dy: 0.2 },
  { w: 400, d: 320, color: 0xbbddee, op: 0.16, dy: 0.4 },
  { w: 220, d: 180, color: 0xddeeff, op: 0.12, dy: 0.6 },
];
for (const ug of ugLayers) {
  const geo = new THREE.PlaneGeometry(ug.w, ug.d);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: ug.color, transparent: true, opacity: ug.op,
    side: THREE.BackSide, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, SURFACE_Y + ug.dy, 5);
  scene.add(mesh);
}

// ─── Light rays — full-height sunlight shafts, surface to seafloor
const BEAM_H = SURFACE_Y + 14;
const lightRays = [];
for (let i = 0; i < 14; i++) {
  const topR = 2.0 + Math.random() * 3.0;
  const botR = topR * (0.35 + Math.random() * 0.25);
  const phase = Math.random() * Math.PI * 2;
  const rx = (Math.random() - 0.5) * 70;
  const rz = (Math.random() - 0.5) * 90 + 5;
  const tilt = (Math.random() - 0.5) * 0.1;

  const outerGeo = new THREE.CylinderGeometry(botR, topR, BEAM_H, 8, 1, true);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xccddff, transparent: true, opacity: 0.03 + Math.random() * 0.02,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.position.set(rx, SURFACE_Y - BEAM_H * 0.5, rz);
  outer.rotation.z = tilt;
  scene.add(outer);

  const coreGeo = new THREE.CylinderGeometry(botR * 0.3, topR * 0.35, BEAM_H, 6, 1, true);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xeef4ff, transparent: true, opacity: 0.06 + Math.random() * 0.04,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(rx, SURFACE_Y - BEAM_H * 0.5, rz);
  core.rotation.z = tilt;
  scene.add(core);

  const poolGeo = new THREE.PlaneGeometry(botR * 3.5, botR * 3.5);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xbbddff, transparent: true, opacity: 0.06,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  const floorY = -14 + bakeFloorHeight(rx, rz);
  pool.position.set(rx, floorY + 0.15, rz);
  scene.add(pool);

  lightRays.push({ outer, core, pool, baseX: rx, baseZ: rz, phase,
    outerBaseOp: outerMat.opacity, coreBaseOp: coreMat.opacity });
}

// ─── Ocean surface — solid animated plane with depth gradient ─
const surfGeo = new THREE.PlaneGeometry(600, 550, 80, 70);
surfGeo.rotateX(-Math.PI / 2);

const surfVCount = surfGeo.attributes.position.count;
const surfColors = new Float32Array(surfVCount * 3);
const surfPos = surfGeo.attributes.position;
for (let i = 0; i < surfVCount; i++) {
  const z = surfPos.getZ(i);
  const t01 = THREE.MathUtils.clamp((z + 275) / 550, 0, 1);
  const gray = 0.04 + t01 * 0.28;
  surfColors[i * 3] = gray;
  surfColors[i * 3 + 1] = gray;
  surfColors[i * 3 + 2] = gray;
}
surfGeo.setAttribute('color', new THREE.BufferAttribute(surfColors, 3));

const surfMat = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const surfMesh = new THREE.Mesh(surfGeo, surfMat);
surfMesh.position.set(0, SURFACE_Y, 5);
scene.add(surfMesh);

// Bright glow on the surface from above — sun hitting the water
const surfGlowGeo = new THREE.PlaneGeometry(350, 300);
surfGlowGeo.rotateX(-Math.PI / 2);
const surfGlowMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.10,
  side: THREE.FrontSide, depthWrite: false, fog: false,
  blending: THREE.AdditiveBlending,
});
const surfGlowMesh = new THREE.Mesh(surfGlowGeo, surfGlowMat);
surfGlowMesh.position.set(15, SURFACE_Y + 0.8, -10);
scene.add(surfGlowMesh);

function animateSurface(t) {
  const pos = surfGeo.attributes.position;
  const col = surfGeo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const front = THREE.MathUtils.clamp(1.0 - (z + 275) / 550, 0, 1);
    const amp = 0.6 + front * 1.2;
    const y =
      amp * (
        Math.sin(x * 0.05 + t * 2.4) * 1.0 +
        Math.cos(z * 0.04 + t * 1.8) * 0.7 +
        Math.sin((x + z) * 0.035 + t * 1.4) * 0.45
      ) +
      Math.sin(x * 0.09 + z * 0.07 + t * 3.2) * 0.5 * amp +
      Math.cos(x * 0.14 - z * 0.1 + t * 4.0) * 0.3 * amp +
      Math.sin(x * 0.22 + t * 5.0) * 0.18 * amp;
    pos.setY(i, y);

    const t01 = THREE.MathUtils.clamp((z + 275) / 550, 0, 1);
    const baseGray = 0.04 + t01 * 0.28;
    const peakBright = Math.max(0, y / (amp * 2.2));
    const sparkle = peakBright * peakBright * 0.6;
    const g = Math.min(1, baseGray + sparkle);
    col.setXYZ(i, g, g, g);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// ─── Water depth planes — solid layers (dark front, light back)
// Vertical planes perpendicular to the camera view at different
// Z depths.  They span from the floor up to the surface only,
// so they never tint the sky.  Front = darker, back = lighter,
// matching real underwater depth perspective.
const waterPlanes = [];
const WATER_CFG = [
  { dz: -6,  gray: 0.02, op: 0.25 },
  { dz: -16, gray: 0.05, op: 0.20 },
  { dz: -28, gray: 0.09, op: 0.16 },
  { dz: -42, gray: 0.14, op: 0.12 },
  { dz: -58, gray: 0.20, op: 0.09 },
  { dz: -76, gray: 0.28, op: 0.06 },
  { dz: -96, gray: 0.35, op: 0.04 },
];

const waterH = SURFACE_Y + 35;
for (const W of WATER_CFG) {
  const geo = new THREE.PlaneGeometry(400, waterH);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(W.gray, W.gray, W.gray),
    transparent: true,
    opacity: W.op,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = (SURFACE_Y - 30) / 2;
  scene.add(mesh);
  waterPlanes.push({ mesh, dz: W.dz });
}

// ─── Particles — bright glowing squares, ocean only ─────────
const P_N = 900;
const pArr = new Float32Array(P_N * 3);
const pVel = [];

function resetParticle(i) {
  pArr[i * 3]     = (Math.random() - 0.5) * 160;
  pArr[i * 3 + 1] = -10 + Math.random() * (SURFACE_Y + 8);
  if (pArr[i * 3 + 1] > SURFACE_Y - 0.5)
    pArr[i * 3 + 1] = SURFACE_Y - 1 - Math.random() * 3;
  pArr[i * 3 + 2] = (Math.random() - 0.5) * 180 + 5;
}

for (let i = 0; i < P_N; i++) {
  resetParticle(i);
  pVel.push({
    x: (Math.random() - 0.5) * 0.005,
    y: 0.001 + Math.random() * 0.006,
    z: (Math.random() - 0.5) * 0.005,
  });
}

const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
  color: 0xaaddff,
  size: 0.28,
  transparent: true,
  opacity: 0.75,
  sizeAttenuation: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})));

function animateParticles() {
  for (let i = 0; i < P_N; i++) {
    pArr[i * 3]     += pVel[i].x;
    pArr[i * 3 + 1] += pVel[i].y;
    pArr[i * 3 + 2] += pVel[i].z;
    if (pArr[i * 3 + 1] > SURFACE_Y - 0.5 ||
        Math.abs(pArr[i * 3]) > 90 ||
        Math.abs(pArr[i * 3 + 2] - 5) > 100) {
      resetParticle(i);
      pArr[i * 3 + 1] = -10 + Math.random() * 4;
    }
  }
  pGeo.attributes.position.needsUpdate = true;
}

// ─── 2D Drawing canvas ─────────────────────────────────────
const drawCanvas = document.getElementById('draw-canvas');
const drawCtx = drawCanvas.getContext('2d');
const DW = 240;
drawCanvas.width = DW;
drawCanvas.height = DW;

let isDrawing = false;
let strokes = [];
let curStroke = [];

function drawPos(e) {
  const r = drawCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - r.left) * (DW / r.width), y: (cy - r.top) * (DW / r.height) };
}
function onDown(e) { e.preventDefault(); isDrawing = true; curStroke = [drawPos(e)]; }
function onMove(e) {
  if (!isDrawing) return;
  e.preventDefault();
  curStroke.push(drawPos(e));
  repaint();
}
function onUp(e) {
  if (!isDrawing) return;
  if (e) e.preventDefault();
  isDrawing = false;
  if (curStroke.length > 1) strokes.push([...curStroke]);
  curStroke = [];
}

drawCanvas.addEventListener('mousedown', onDown);
drawCanvas.addEventListener('mousemove', onMove);
drawCanvas.addEventListener('mouseup', onUp);
drawCanvas.addEventListener('mouseleave', onUp);
drawCanvas.addEventListener('touchstart', onDown, { passive: false });
drawCanvas.addEventListener('touchmove', onMove, { passive: false });
drawCanvas.addEventListener('touchend', onUp, { passive: false });

function traceStroke(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function repaint() {
  drawCtx.clearRect(0, 0, DW, DW);
  drawCtx.strokeStyle = '#fff';
  drawCtx.lineWidth = 3;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  const all = [...strokes];
  if (curStroke.length > 1) all.push(curStroke);
  for (const s of all) traceStroke(drawCtx, s);
}
repaint();

document.getElementById('clear-btn').addEventListener('click', () => {
  strokes = []; curStroke = []; repaint();
});
document.getElementById('generate-btn').addEventListener('click', () => {
  if (strokes.length === 0) return;
  spawnCreature(document.getElementById('type-select').value);
  strokes = []; curStroke = []; repaint();
});

// ─── Capture with glow + tight crop ────────────────────────
function captureAndCrop() {
  const cap = document.createElement('canvas');
  cap.width = DW; cap.height = DW;
  const ctx = cap.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.shadowBlur = 14;
  ctx.shadowColor = 'rgba(255,255,255,0.4)';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 7;
  for (const s of strokes) traceStroke(ctx, s);

  ctx.shadowBlur = 3;
  ctx.shadowColor = 'rgba(255,255,255,0.3)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  for (const s of strokes) traceStroke(ctx, s);

  const data = ctx.getImageData(0, 0, DW, DW).data;
  let x0 = DW, y0 = DW, x1 = 0, y1 = 0;
  for (let py = 0; py < DW; py++)
    for (let px = 0; px < DW; px++)
      if (data[(py * DW + px) * 4 + 3] > 5) {
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }

  const pad = 20;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(DW, x1 + pad); y1 = Math.min(DW, y1 + pad);
  const cw = x1 - x0, ch = y1 - y0;
  if (cw < 5 || ch < 5) return null;

  const cropped = document.createElement('canvas');
  cropped.width = cw; cropped.height = ch;
  cropped.getContext('2d').drawImage(cap, x0, y0, cw, ch, 0, 0, cw, ch);
  return cropped;
}

// ─── Creature creation ──────────────────────────────────────
// Spawn Z is relative to current camera position so fish are
// always in the foreground, jellyfish always in the back.
const creatures = [];
const BASE_H = 4;

function getSpawnZ() {
  return camZ - 15 - Math.random() * 45;
}

function spawnCreature(type) {
  const cropped = captureAndCrop();
  if (!cropped) return;

  const tex = new THREE.CanvasTexture(cropped);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const aspect = cropped.width / cropped.height;
  const h = BASE_H;
  const w = h * aspect;

  const geo = new THREE.PlaneGeometry(w, h, 24, 24);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.01,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const basePos = new Float32Array(geo.attributes.position.array);

  const spawnZ = getSpawnZ(type);
  const spawnY = 2 + Math.random() * 5;
  mesh.position.set((Math.random() - 0.5) * 22, spawnY, spawnZ);

  const dir = Math.random() * Math.PI * 2;

  scene.add(mesh);

  creatures.push({
    mesh, geo, basePos, type, w, h,
    speed: type === 'fish'      ? 0.035 + Math.random() * 0.020
         : type === 'eel'       ? 0.012 + Math.random() * 0.014
         :                        0.003 + Math.random() * 0.004,
    dir,
    targetDir: dir,
    turnTimer: 0,
    nextTurn: 3 + Math.random() * 5,
    phase: Math.random() * Math.PI * 2,
    baseY: spawnY,
    facing: 1,
    dartTimer: Math.random() * 5,
    dartCooldown: 4 + Math.random() * 8,
    isDarting: false,
    dartTimeLeft: 0,
  });
  updateCounter();
}

function updateCounter() {
  const el = document.getElementById('creature-count');
  if (el) el.textContent = creatures.length + (creatures.length === 1 ? ' creature' : ' creatures');
}

// ─── Jellyfish propulsion helper ────────────────────────────
// Long cycle — propels only ~10 % of the time, drifts the rest.
// Propulsion pushes tentacles (→ forward thrust), no vertical jump.
function jellyPropulse(t, phase) {
  const period = 6.5;
  const cyc = ((t * 0.45 + phase * period) % period) / period;
  if (cyc > 0.05 && cyc < 0.16)
    return Math.pow(Math.sin((cyc - 0.05) / 0.11 * Math.PI), 2);
  return 0;
}

// ─── Vertex animation ───────────────────────────────────────
function animateVerts(c, t) {
  const pos = c.geo.attributes.position;
  const base = c.basePos;
  const w = c.w, h = c.h, ph = c.phase;

  for (let i = 0; i < pos.count; i++) {
    const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
    const u = bx / w + 0.5;
    const v = by / h + 0.5;
    let dx = 0, dy = 0, dz = 0;

    if (c.type === 'fish') {
      const tail = 1 - u;
      const wave = Math.sin(t * 4.5 + tail * 5 + ph);
      dx = wave * tail * tail * w * 0.13;
      dz = wave * tail * 0.38;
    }

    else if (c.type === 'jellyfish') {
      const prop = jellyPropulse(t, ph);

      // Bell — gentle ambient sway, narrows slightly during push
      const bell = Math.max(0, v - 0.35);
      dx += bx * Math.sin(t * 0.55 + ph) * 0.055 * bell;
      dx += bx * (-prop * 0.14 * bell);

      // Multiple tentacle waves at independent frequencies
      const tent = Math.max(0, 0.45 - v);
      dx += Math.sin(t * 2.0 + u * 8  + ph)       * tent * w * 0.10;
      dx += Math.sin(t * 2.7 + u * 13 + ph * 1.3) * tent * w * 0.06;
      dx += Math.sin(t * 1.5 + u * 6  + ph * 0.7) * tent * w * 0.04;
      dz += Math.sin(t * 1.8 + v * 5  + ph)       * tent * 0.24;
      dz += Math.sin(t * 2.3 + v * 7  + ph * 1.5) * tent * 0.15;

      // Propulsion: tentacles contract inward & upward (push stroke)
      dy += tent * prop * h * 0.22;
      dx += bx * (-prop * 0.22 * tent);
    }

    else if (c.type === 'eel') {
      const wave = Math.sin(t * 3 + u * 8 + ph);
      dx = wave * w * 0.08;
      dz = wave * 0.3;
      dy = Math.sin(t * 2 + u * 6 + ph) * 0.08;
    }

    pos.setXYZ(i, bx + dx, by + dy, bz + dz);
  }
  pos.needsUpdate = true;
}

// ─── Movement — free 3D wander, schooling, dart, billboard ──
function moveCreatures(t) {
  const halfFov = camera.fov * 0.5 * Math.PI / 180;
  const dt = 1 / 60;

  for (let ci = 0; ci < creatures.length; ci++) {
    const c = creatures[ci];

    // ── periodic direction change — fully random angle ──────
    c.turnTimer += dt;
    if (c.turnTimer > c.nextTurn) {
      c.turnTimer = 0;
      c.nextTurn = 2.5 + Math.random() * 4;
      c.targetDir += (Math.random() - 0.5) * Math.PI * 1.4;
    }

    // ── fish schooling / non-fish scare ─────────────────────
    if (!c.isDarting) {
      const SCHOOL_R2 = 100;
      const SCARE_R2 = 9;
      let schoolDirX = 0, schoolDirZ = 0, schoolSpeed = 0, schoolCount = 0;

      for (let oi = 0; oi < creatures.length; oi++) {
        if (oi === ci) continue;
        const o = creatures[oi];
        const ddx = c.mesh.position.x - o.mesh.position.x;
        const ddz = c.mesh.position.z - o.mesh.position.z;
        const ddy = c.mesh.position.y - o.mesh.position.y;
        const dist2 = ddx * ddx + ddz * ddz + ddy * ddy;

        if (c.type === 'fish' && o.type === 'fish' && dist2 < SCHOOL_R2) {
          schoolDirX += Math.sin(o.dir);
          schoolDirZ += Math.cos(o.dir);
          schoolSpeed += o.speed;
          schoolCount++;
        }

        if (dist2 < SCARE_R2 && !(c.type === 'fish' && o.type === 'fish')) {
          c.isDarting = true;
          c.dartTimeLeft = 0.25 + Math.random() * 0.3;
          c.dartTimer = 0;
          c.dartCooldown = 3 + Math.random() * 6;
          const away = Math.atan2(ddx, ddz);
          c.targetDir = away;
          c.dir = away;
          break;
        }
      }

      if (c.type === 'fish' && schoolCount > 0 && !c.isDarting) {
        const avgDir = Math.atan2(schoolDirX / schoolCount, schoolDirZ / schoolCount);
        let sd = avgDir - c.targetDir;
        while (sd > Math.PI) sd -= Math.PI * 2;
        while (sd < -Math.PI) sd += Math.PI * 2;
        c.targetDir += sd * 0.12;
        c.dir += sd * 0.06;
        c.speed += ((schoolSpeed / schoolCount) - c.speed) * 0.02;
        c.nextTurn = Math.max(c.nextTurn, 4);
      }
    }

    // ── huge rock avoidance ─────────────────────────────────
    for (const hr of hugeRocks) {
      const rdx = c.mesh.position.x - hr.x;
      const rdz = c.mesh.position.z - hr.z;
      const rDist = Math.sqrt(rdx * rdx + rdz * rdz);
      if (rDist < hr.radius) {
        const away = Math.atan2(rdx, rdz);
        c.targetDir = away;
        c.dir += (away - c.dir) * 0.15;
      }
    }

    // ── bounds steering (keep on screen, away from camera) ──
    const depth = camZ - c.mesh.position.z;
    const visBX = Math.max(8, depth * Math.tan(halfFov) * camera.aspect * 0.65);
    const cx = c.mesh.position.x;

    if (depth < 8) {
      c.targetDir = Math.PI + (Math.random() - 0.5) * 1.2;
    } else if (c.mesh.position.z < -55) {
      c.targetDir = (Math.random() - 0.5) * 1.2;
    }

    if (Math.abs(cx) > visBX * 0.72) {
      c.targetDir = Math.atan2(-cx, -5);
    }

    if (c.baseY < 1.5) c.baseY += 0.015;
    if (c.baseY > 13)  c.baseY -= 0.015;

    // ── smooth rotation ─────────────────────────────────────
    let diff = c.targetDir - c.dir;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.dir += diff * 0.035;

    // ── facing from screen-space movement direction ─────────
    const screenMoveX = Math.sin(c.dir);
    if (screenMoveX > 0.05)       c.facing = 1;
    else if (screenMoveX < -0.05) c.facing = -1;

    // ── advance ─────────────────────────────────────────────
    let speed = c.speed;

    if (c.type === 'fish' || c.type === 'eel') {
      c.dartTimer += dt;
      if (!c.isDarting && c.dartTimer > c.dartCooldown) {
        c.isDarting = true;
        c.dartTimeLeft = 0.15 + Math.random() * 0.25;
        c.dartTimer = 0;
        c.dartCooldown = 4 + Math.random() * 8;
        c.targetDir = Math.random() * Math.PI * 2;
        c.dir = c.targetDir;
      }
      if (c.isDarting) {
        c.dartTimeLeft -= dt;
        speed *= 6.5;
        if (c.dartTimeLeft <= 0) c.isDarting = false;
      }
    }

    if (c.type === 'fish') {
      c.mesh.position.y = c.baseY + Math.sin(t * 0.7 + c.phase) * 0.2;
    } else if (c.type === 'jellyfish') {
      const prop = jellyPropulse(t, c.phase);
      speed += prop * 0.016;
      c.mesh.position.y = c.baseY + Math.sin(t * 0.18 + c.phase) * 0.55;
    } else {
      c.mesh.position.y = c.baseY + Math.sin(t * 0.5 + c.phase) * 0.25;
    }

    c.mesh.position.x += Math.sin(c.dir) * speed;
    c.mesh.position.z += Math.cos(c.dir) * speed;

    // ── billboard: face camera (Y-axis only) ────────────────
    const toCamX = camera.position.x - c.mesh.position.x;
    const toCamZ = camera.position.z - c.mesh.position.z;
    c.mesh.rotation.y = Math.atan2(toCamX, toCamZ);

    // ── scale flip — negated because drawings face LEFT ─────
    c.mesh.scale.x = -c.facing;
    c.mesh.rotation.z = Math.sin(t * 0.4 + c.phase) * 0.03;
  }
}

// ─── Resize ─────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ─── Main loop ──────────────────────────────────────────────
function tick() {
  requestAnimationFrame(tick);
  const t = performance.now() * 0.001;

  if (keysDown.has('ArrowUp')   || keysDown.has('w') || keysDown.has('W'))
    camY = Math.min(CAM_Y_MAX, camY + 0.09);
  if (keysDown.has('ArrowDown') || keysDown.has('s') || keysDown.has('S'))
    camY = Math.max(CAM_Y_MIN, camY - 0.09);

  // Sky backdrop: follows camera Z, bottom edge at SURFACE_Y
  skyMesh.position.set(0, SURFACE_Y + 140, camZ - 170);

  // Sun tracks camera Z so it stays visible in the sky
  sunGroup.position.z = camZ - 80;

  // Water depth planes track camera Z
  for (const wp of waterPlanes)
    wp.mesh.position.z = camZ + wp.dz;

  animateSurface(t);
  animateParticles();
  for (const c of creatures) animateVerts(c, t);
  moveCreatures(t);

  for (const lr of lightRays) {
    const sx = Math.sin(t * 0.2 + lr.phase) * 1.8;
    const pulse = 0.7 + 0.3 * Math.sin(t * 0.35 + lr.phase);
    lr.outer.position.x = lr.baseX + sx;
    lr.core.position.x = lr.baseX + sx;
    lr.outer.rotation.z = Math.sin(t * 0.12 + lr.phase) * 0.05;
    lr.core.rotation.z = lr.outer.rotation.z;
    lr.outer.material.opacity = lr.outerBaseOp * pulse;
    lr.core.material.opacity = lr.coreBaseOp * pulse;
    lr.pool.material.opacity = 0.04 + 0.03 * Math.sin(t * 0.35 + lr.phase);
  }

  for (const pg of plantGroups) {
    for (let i = 0; i < pg.children.length; i++) {
      const cube = pg.children[i];
      const sway = Math.sin(t * 0.8 + pg.position.x * 0.3 + i * 0.5) * 0.04 * (i + 1);
      cube.position.x = cube.userData.ox + sway;
    }
  }

  camera.position.set(0, camY, camZ);
  camera.lookAt(0, camY, camZ - 100);

  renderer.render(scene, camera);
}
tick();
