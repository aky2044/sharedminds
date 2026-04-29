// ─────────────────────────────────────────────────────────────────────────────
//  The Icon and the Ghost — prototype
//
//  Two players share one world but see it through incompatible interfaces.
//   · Player A (left)  — a 2D desktop. Icons are "files to optimize".
//   · Player B (right) — a 3D mossy sanctuary in a void, lit by a false sun.
//
//  Every entity exists twice: as a desktop icon for A, and as a physical
//  object (stone / tree / bush / fern / mushroom) for B. The two views are
//  kept in sync:
//    · A double-clicks an icon  →  optimize it    (B sees a lightning strike,
//                                                   the object dissolves)
//    · B drags an object       →  A's icon jitters, moves on its own, and a
//                                  "System process running…" popup appears.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "https://cdn.skypack.dev/three@0.150.0";

// ═════════════════════════════════════════════════════════════════════════════
//  SHARED STATE — both scenes read from this
// ═════════════════════════════════════════════════════════════════════════════

const ENTITY_DEFS = [
  { id: "e1", name: "memory_cache.log",     type: "stone",    world: [-1.6, 0.0,  0.8] },
  { id: "e2", name: "cache_fragment.tmp",   type: "stone",    world: [ 1.9, 0.0, -0.3] },
  { id: "e3", name: "system_node.dat",      type: "tree",     world: [-2.6, 0.0, -1.4] },
  { id: "e4", name: "autosave_process.bin", type: "tree",     world: [ 2.4, 0.0,  1.3] },
  { id: "e5", name: "render_queue.bak",     type: "bush",     world: [ 0.2, 0.0,  1.8] },
  { id: "e6", name: "log_archive.tar",      type: "bush",     world: [-0.6, 0.0, -1.8] },
  { id: "e7", name: "indexer_thread.tmp",   type: "fern",     world: [ 3.3, 0.0,  0.2] },
  { id: "e8", name: "swap_residue.bin",     type: "fern",     world: [-3.1, 0.0,  0.4] },
  { id: "e9", name: "legacy_kernel.pkg",    type: "mushroom", world: [ 1.0, 0.0, -1.5] },
];

const state = {
  entities: new Map(),   // id -> entity
  totalMB: 0,            // for the optimizer widget
  cleanedMB: 0,
};

for (const def of ENTITY_DEFS) {
  const size = 40 + Math.floor(Math.random() * 180);
  state.totalMB += size;
  state.entities.set(def.id, {
    ...def,
    alive: true,
    sizeMB: size,
    dom: null,
    mesh: null,
    // last-known desktop (icon) position (in px, relative to #desktop)
    iconHome: null,
  });
}

// Event bus — lets sides talk without tight coupling
const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
const on   = (type, fn)     => bus.addEventListener(type, fn);

// ═════════════════════════════════════════════════════════════════════════════
//  PLAYER A — DESKTOP INTERFACE (DOM)
// ═════════════════════════════════════════════════════════════════════════════

const viewportA = document.getElementById("playerA-viewport");
const desktopEl = document.getElementById("desktop");
const cursorEl  = document.getElementById("cursor-a");
const clockEl   = document.getElementById("clock");

const optCountEl = document.getElementById("opt-count");
const optSavedEl = document.getElementById("opt-saved");
const optFillEl  = document.getElementById("opt-fill");

const popupEl   = document.getElementById("process-popup");
const ppFillEl  = document.getElementById("pp-fill");
const ppTitleEl = document.getElementById("pp-title");
const ppMsgEl   = document.getElementById("pp-msg");

const ICON_TYPE_GLYPHS = {
  stone:    "▨",
  tree:     "⌬",
  bush:     "❋",
  fern:     "⸙",
  mushroom: "◉",
};

// Arrange icons in a soft grid on the left side of the desktop
function layoutIcons() {
  const pad = 34;
  const cellW = 98;
  const cellH = 96;
  const cols = 3;
  let i = 0;
  for (const e of state.entities.values()) {
    if (!e.alive) continue;
    const col = i % cols;
    const row = Math.floor(i / cols);
    // little organic wobble so it feels lived-in
    const jx = (Math.sin(i * 4.1) * 8) | 0;
    const jy = (Math.cos(i * 2.7) * 6) | 0;
    const x = pad + col * cellW + jx;
    const y = pad + row * cellH + jy;
    e.iconHome = { x, y };
    if (e.dom) {
      e.dom.style.left = `${x}px`;
      e.dom.style.top  = `${y}px`;
    }
    i++;
  }
}

function buildIcons() {
  for (const e of state.entities.values()) {
    const el = document.createElement("div");
    el.className = "dicon";
    el.dataset.id = e.id;

    const tile = document.createElement("div");
    tile.className = `dicon-tile type-${e.type}`;
    tile.textContent = ICON_TYPE_GLYPHS[e.type] || "□";

    const label = document.createElement("div");
    label.className = "dicon-label";
    label.textContent = e.name;

    el.appendChild(tile);
    el.appendChild(label);
    desktopEl.appendChild(el);
    e.dom = el;

    // interactions
    el.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      selectIcon(e.id);
    });
    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      requestOptimize(e.id);
    });
  }
  layoutIcons();
}

let selectedId = null;
function selectIcon(id) {
  selectedId = id;
  for (const e of state.entities.values()) {
    if (!e.dom) continue;
    e.dom.classList.toggle("selected", e.id === id);
  }
}
desktopEl.addEventListener("mousedown", () => selectIcon(null));

// ── Optimize (delete) an entity ─────────────────────────────────────────────
function requestOptimize(id) {
  const e = state.entities.get(id);
  if (!e || !e.alive || e.optimizing) return;
  e.optimizing = true;

  e.dom?.classList.add("optimizing");
  emit("A:optimize", { id });          // notify B to play the "divine" effect

  setTimeout(() => {
    e.alive = false;
    e.dom?.remove();
    e.dom = null;
    state.cleanedMB += e.sizeMB;
    updateOptimizerWidget();
    emit("A:optimize:commit", { id });
  }, 850);
}

function updateOptimizerWidget() {
  const aliveCount = [...state.entities.values()].filter(e => e.alive).length;
  optCountEl.textContent = `${aliveCount}`;
  optSavedEl.textContent = `${state.cleanedMB} MB`;
  const pct = Math.min(100, (state.cleanedMB / Math.max(1, state.totalMB)) * 100);
  optFillEl.style.width = `${pct}%`;
}

// ── Custom cursor that follows the real mouse over Player A viewport ────────
viewportA.addEventListener("mousemove", (ev) => {
  const r = viewportA.getBoundingClientRect();
  cursorEl.style.left = `${ev.clientX - r.left}px`;
  cursorEl.style.top  = `${ev.clientY - r.top - 26 /* menubar */}px`;
});
viewportA.addEventListener("mousedown", () => {
  cursorEl.classList.remove("click");
  void cursorEl.offsetWidth;
  cursorEl.classList.add("click");
});

// ── Receive "interference" events from Player B ─────────────────────────────
let popupTimer = null;
function showProcessPopup(label, msg) {
  ppTitleEl.textContent = label;
  ppMsgEl.textContent   = msg;
  popupEl.classList.remove("hidden");

  // animate the progress bar up over ~1.2s, then hide
  ppFillEl.style.width = "0%";
  let p = 0;
  clearInterval(popupTimer);
  popupTimer = setInterval(() => {
    p += 2 + Math.random() * 5;
    if (p >= 100) { p = 100; clearInterval(popupTimer); }
    ppFillEl.style.width = `${p}%`;
  }, 60);

  setTimeout(() => popupEl.classList.add("hidden"), 2200);
}

function startInterferenceFlicker(durationMs = 1000) {
  viewportA.classList.add("interference");
  setTimeout(() => viewportA.classList.remove("interference"), durationMs);
}

on("B:drag:start", (ev) => {
  const { id } = ev.detail;
  const e = state.entities.get(id);
  if (!e || !e.dom) return;
  e.dom.classList.add("glitch");
  startInterferenceFlicker(1600);
  showProcessPopup(
    "System process running…",
    `background optimization · ${e.name}`
  );
});

on("B:drag:move", (ev) => {
  // Map B's XZ world position into A's desktop coordinates so the icon
  // appears to drift on its own as the ghost drags it.
  const { id, wx, wz } = ev.detail;
  const e = state.entities.get(id);
  if (!e || !e.dom || !e.iconHome) return;

  const dx = (wx - e.world[0]) * 34;
  const dy = (wz - e.world[2]) * 34;
  e.dom.style.left = `${e.iconHome.x + dx}px`;
  e.dom.style.top  = `${e.iconHome.y + dy}px`;
});

on("B:drag:end", (ev) => {
  const { id } = ev.detail;
  const e = state.entities.get(id);
  if (!e || !e.dom) return;
  e.dom.classList.remove("glitch");
});

// ── Clock ───────────────────────────────────────────────────────────────────
function tickClock() {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  clockEl.textContent = `${h}:${m} ${ampm}`;
}
tickClock();
setInterval(tickClock, 1000 * 15);

// Boot Player A
buildIcons();
updateOptimizerWidget();

// ═════════════════════════════════════════════════════════════════════════════
//  PLAYER B — 3D MOSSY SANCTUARY IN A VOID
// ═════════════════════════════════════════════════════════════════════════════

const viewportB = document.getElementById("playerB-viewport");

const rendererB = new THREE.WebGLRenderer({ antialias: true, alpha: false });
rendererB.setPixelRatio(Math.min(window.devicePixelRatio, 2));
rendererB.setClearColor(0x000000, 1);
rendererB.toneMapping = THREE.ACESFilmicToneMapping;
rendererB.toneMappingExposure = 1.05;
viewportB.appendChild(rendererB.domElement);

const sceneB = new THREE.Scene();
sceneB.fog = new THREE.FogExp2(0x000000, 0.055);

const cameraB = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
cameraB.position.set(0, 2.6, 9.5);
cameraB.lookAt(0, 1.2, 0);

// ── Lighting ────────────────────────────────────────────────────────────────
sceneB.add(new THREE.AmbientLight(0x0a1a14, 0.6));

// The "false sun" — big green forest screen behind the stage
const FALSE_SUN_POS = new THREE.Vector3(0, 3.2, -6.0);
const falseSunLight = new THREE.DirectionalLight(0xc8f5d8, 1.2);
falseSunLight.position.copy(FALSE_SUN_POS).add(new THREE.Vector3(0, 1, 0.1));
falseSunLight.target.position.set(0, 0, 0);
sceneB.add(falseSunLight, falseSunLight.target);

const rimFill = new THREE.HemisphereLight(0x1a3a26, 0x050704, 0.35);
sceneB.add(rimFill);

// ── The false sun: procedural forest screen ────────────────────────────────
function makeForestScreenTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 288;
  const g = c.getContext("2d");

  // sky gradient (top: lighter green, bottom: forest floor)
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0.0, "#b2e3b4");
  sky.addColorStop(0.35, "#6fb575");
  sky.addColorStop(0.75, "#2d5b34");
  sky.addColorStop(1.0, "#122a16");
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);

  // vertical tree trunks — lots of slender dark shapes
  for (let i = 0; i < 34; i++) {
    const x = Math.random() * c.width;
    const w = 2 + Math.random() * 8;
    const h = c.height * (0.55 + Math.random() * 0.4);
    const y = c.height - h;
    const hue = 120 + Math.random() * 20;
    const l = 12 + Math.random() * 18;
    g.fillStyle = `hsl(${hue}, 40%, ${l}%)`;
    g.fillRect(x, y, w, h);
  }

  // canopy flecks (bright highlights)
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height * 0.72;
    const r = 0.7 + Math.random() * 2.2;
    const a = 0.06 + Math.random() * 0.18;
    g.fillStyle = `hsla(${90 + Math.random() * 40}, 70%, ${60 + Math.random() * 20}%, ${a})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // atmospheric haze band in the middle
  const haze = g.createLinearGradient(0, c.height * 0.35, 0, c.height * 0.7);
  haze.addColorStop(0, "rgba(230,255,230,0)");
  haze.addColorStop(0.5, "rgba(230,255,230,0.22)");
  haze.addColorStop(1, "rgba(230,255,230,0)");
  g.fillStyle = haze;
  g.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const forestTex = makeForestScreenTexture();
const falseSun = new THREE.Mesh(
  new THREE.PlaneGeometry(6.6, 3.7),
  new THREE.MeshBasicMaterial({ map: forestTex, toneMapped: false })
);
falseSun.position.copy(FALSE_SUN_POS);
sceneB.add(falseSun);

// soft rectangular glow halo behind the screen
{
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x6fd48c, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), haloMat);
  halo.position.copy(FALSE_SUN_POS).z -= 0.05;
  sceneB.add(halo);
}

// screen frame (thin black border)
{
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const fw = 6.75, fh = 3.85, t = 0.08;
  const top    = new THREE.Mesh(new THREE.PlaneGeometry(fw, t),   frameMat);
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(fw, t),   frameMat);
  const left   = new THREE.Mesh(new THREE.PlaneGeometry(t,  fh),  frameMat);
  const right  = new THREE.Mesh(new THREE.PlaneGeometry(t,  fh),  frameMat);
  top.position.set(0,     fh/2,  0.01).add(FALSE_SUN_POS);
  bottom.position.set(0, -fh/2,  0.01).add(FALSE_SUN_POS);
  left.position.set(-fw/2, 0,    0.01).add(FALSE_SUN_POS);
  right.position.set( fw/2, 0,   0.01).add(FALSE_SUN_POS);
  sceneB.add(top, bottom, left, right);
}

// ── The sanctuary platform — a small mossy stage ────────────────────────────
function makeMossTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#0d2014"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const l = 6 + Math.random() * 26;
    g.fillStyle = `hsl(${90 + Math.random() * 30}, ${25 + Math.random() * 40}%, ${l}%)`;
    g.fillRect(x, y, 1, 1);
  }
  // scattered lighter tufts
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 1 + Math.random() * 3;
    g.fillStyle = `hsla(${100 + Math.random() * 20}, 55%, ${30 + Math.random() * 20}%, 0.8)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const mossTex = makeMossTexture();

// Irregular platform: rounded box with a wider grass fringe
const PLATFORM_RADIUS_X = 4.4;
const PLATFORM_RADIUS_Z = 3.0;
const PLATFORM_HEIGHT   = 0.55;

const platform = new THREE.Mesh(
  new THREE.BoxGeometry(PLATFORM_RADIUS_X * 2, PLATFORM_HEIGHT, PLATFORM_RADIUS_Z * 2),
  new THREE.MeshStandardMaterial({
    map: mossTex,
    color: 0xbcd9a4,
    roughness: 0.95,
    metalness: 0.0,
    emissive: 0x0a1a10,
    emissiveIntensity: 0.35,
  })
);
platform.position.y = -PLATFORM_HEIGHT / 2;
sceneB.add(platform);

// Platform under-glow (soft green rim)
{
  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATFORM_RADIUS_X * 2.6, PLATFORM_RADIUS_Z * 2.6),
    new THREE.MeshBasicMaterial({
      color: 0x6fd48c, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -PLATFORM_HEIGHT - 0.01;
  sceneB.add(rim);
}

// Grass blades sprinkled on top of the platform
function addGrassBlades(count = 380) {
  const bladeGeo = new THREE.PlaneGeometry(0.06, 0.32);
  bladeGeo.translate(0, 0.16, 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x3a7c42,
    emissive: 0x0e2612,
    emissiveIntensity: 0.5,
    roughness: 1,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.1,
  });
  const mesh = new THREE.InstancedMesh(bladeGeo, bladeMat, count);
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * (PLATFORM_RADIUS_X * 2 - 0.4);
    const z = (Math.random() - 0.5) * (PLATFORM_RADIUS_Z * 2 - 0.4);
    d.position.set(x, 0, z);
    d.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
    const s = 0.7 + Math.random() * 0.9;
    d.scale.set(s, s, s);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
  sceneB.add(mesh);
}
addGrassBlades();

// ── Entity meshes ───────────────────────────────────────────────────────────
function makeStoneMesh(seed = 1) {
  const g = new THREE.IcosahedronGeometry(0.38, 1);
  const pos = g.attributes.position;
  const rand = mulberry32(seed * 1337);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const f = 1 + (rand() - 0.5) * 0.35;
    pos.setXYZ(i, x * f, y * 0.85 * f, z * f);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: 0x6e7a70,
    roughness: 0.88,
    metalness: 0.04,
    emissive: 0x1a2018,
    emissiveIntensity: 0.25,
  }));
  // moss patch on top
  const moss = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
    new THREE.MeshStandardMaterial({
      color: 0x4aa05a, roughness: 0.95, emissive: 0x0a2614, emissiveIntensity: 0.4,
    })
  );
  moss.position.y = 0.05;
  m.add(moss);
  m.userData.dragHeight = 0.38;
  return m;
}

function makeTreeMesh(seed = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 1.1, 8),
    new THREE.MeshStandardMaterial({
      color: 0x3b2a1c, roughness: 0.95, emissive: 0x120a06, emissiveIntensity: 0.2,
    })
  );
  trunk.position.y = 0.55;
  g.add(trunk);
  const foliage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 1),
    new THREE.MeshStandardMaterial({
      color: 0x3d7d48, roughness: 0.9, emissive: 0x0e2814, emissiveIntensity: 0.55,
    })
  );
  foliage.position.y = 1.2;
  foliage.scale.set(1, 1.15, 1);
  g.add(foliage);
  // a second smaller puff
  const puff = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 1),
    foliage.material.clone()
  );
  puff.position.set(0.18, 1.05, 0.08);
  g.add(puff);
  g.userData.dragHeight = 1.5;
  return g;
}

function makeBushMesh(seed = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a9650, roughness: 0.9, emissive: 0x0e2614, emissiveIntensity: 0.5,
  });
  for (let i = 0; i < 4; i++) {
    const s = 0.18 + Math.random() * 0.16;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
    b.position.set((Math.random() - 0.5) * 0.4, s * 0.8, (Math.random() - 0.5) * 0.4);
    g.add(b);
  }
  g.userData.dragHeight = 0.5;
  return g;
}

function makeFernMesh(seed = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x76b85a, roughness: 0.9, emissive: 0x204018, emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.55), mat);
    leaf.geometry.translate(0, 0.28, 0);
    const ang = (i / 7) * Math.PI * 2;
    leaf.rotation.set(0.5 + Math.random() * 0.2, ang, (Math.random() - 0.5) * 0.3);
    g.add(leaf);
  }
  g.userData.dragHeight = 0.6;
  return g;
}

function makeMushroomMesh(seed = 1) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.22, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8d7b4, roughness: 0.85 })
  );
  stem.position.y = 0.11;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshStandardMaterial({
      color: 0xb0453c, roughness: 0.7,
      emissive: 0x4a0e0a, emissiveIntensity: 0.55,
    })
  );
  cap.position.y = 0.22;
  g.add(stem, cap);
  g.userData.dragHeight = 0.3;
  return g;
}

function buildEntityMesh(e) {
  let mesh;
  const seed = hashId(e.id);
  switch (e.type) {
    case "stone":    mesh = makeStoneMesh(seed);    break;
    case "tree":     mesh = makeTreeMesh(seed);     break;
    case "bush":     mesh = makeBushMesh(seed);     break;
    case "fern":     mesh = makeFernMesh(seed);     break;
    case "mushroom": mesh = makeMushroomMesh(seed); break;
    default:         mesh = makeStoneMesh(seed);
  }
  mesh.position.set(e.world[0], e.world[1], e.world[2]);
  mesh.userData.entityId = e.id;
  // store all descendants so raycasting an interior mesh still finds the root
  mesh.traverse((o) => { o.userData.entityId = e.id; });
  sceneB.add(mesh);
  e.mesh = mesh;
  return mesh;
}

for (const e of state.entities.values()) {
  buildEntityMesh(e);
}

// ── Drag logic (the "presence" moves stones / brush) ────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y=0 plane
const dragPoint = new THREE.Vector3();
let dragTarget = null;
let dragOffset = new THREE.Vector3();

function getPointerNDC(ev) {
  const r = rendererB.domElement.getBoundingClientRect();
  ndc.x =  ((ev.clientX - r.left) / r.width)  * 2 - 1;
  ndc.y = -((ev.clientY - r.top)  / r.height) * 2 + 1;
}

function entityAtPointer(ev) {
  getPointerNDC(ev);
  raycaster.setFromCamera(ndc, cameraB);
  const draggables = [];
  for (const e of state.entities.values()) {
    if (e.alive && e.mesh) draggables.push(e.mesh);
  }
  const hits = raycaster.intersectObjects(draggables, true);
  if (!hits.length) return null;
  const id = hits[0].object.userData.entityId;
  return state.entities.get(id);
}

rendererB.domElement.addEventListener("pointerdown", (ev) => {
  const e = entityAtPointer(ev);
  if (!e) return;
  dragTarget = e;
  // compute initial offset so object doesn't jump
  raycaster.ray.intersectPlane(dragPlane, dragPoint);
  dragOffset.copy(e.mesh.position).sub(dragPoint);
  dragOffset.y = 0;
  rendererB.domElement.setPointerCapture(ev.pointerId);
  emit("B:drag:start", { id: e.id });
});

rendererB.domElement.addEventListener("pointermove", (ev) => {
  if (!dragTarget) return;
  getPointerNDC(ev);
  raycaster.setFromCamera(ndc, cameraB);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  const nx = dragPoint.x + dragOffset.x;
  const nz = dragPoint.z + dragOffset.z;
  // keep on the platform
  const cx = Math.max(-PLATFORM_RADIUS_X + 0.25, Math.min(PLATFORM_RADIUS_X - 0.25, nx));
  const cz = Math.max(-PLATFORM_RADIUS_Z + 0.25, Math.min(PLATFORM_RADIUS_Z - 0.25, nz));
  dragTarget.mesh.position.x = cx;
  dragTarget.mesh.position.z = cz;
  emit("B:drag:move", { id: dragTarget.id, wx: cx, wz: cz });
});

function endDrag(ev) {
  if (!dragTarget) return;
  emit("B:drag:end", { id: dragTarget.id });
  try { rendererB.domElement.releasePointerCapture(ev.pointerId); } catch (_) {}
  dragTarget = null;
}
rendererB.domElement.addEventListener("pointerup", endDrag);
rendererB.domElement.addEventListener("pointercancel", endDrag);
rendererB.domElement.addEventListener("pointerleave", endDrag);

// ── Supernatural events when Player A optimizes an entity ──────────────────
const lightningFlashes = [];

function spawnLightning(mesh) {
  // A tall, bright plane that pulses white, plus a brief scene-wide flash
  const w = 0.22, h = 6.0;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h * 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const bolt = new THREE.Mesh(geo, mat);
  bolt.position.copy(mesh.position);
  sceneB.add(bolt);
  lightningFlashes.push({
    bolt,
    start: performance.now(),
    life: 900,
    scenePulse: true,
  });
  // a brief burst light at the strike point
  const flash = new THREE.PointLight(0xffffff, 16, 8);
  flash.position.copy(mesh.position).y += 1.5;
  sceneB.add(flash);
  lightningFlashes.push({
    bolt: flash, isLight: true,
    start: performance.now(), life: 900,
  });
}

const dissolving = [];
function startDissolve(mesh) {
  // collect all meshes inside
  const meshes = [];
  mesh.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    if (!m.material.transparent) {
      m.material = m.material.clone();
      m.material.transparent = true;
    }
  }
  dissolving.push({ group: mesh, meshes, start: performance.now(), life: 850 });
}

on("A:optimize", (ev) => {
  const { id } = ev.detail;
  const e = state.entities.get(id);
  if (!e || !e.mesh) return;
  spawnLightning(e.mesh);
  startDissolve(e.mesh);
});

on("A:optimize:commit", (ev) => {
  const { id } = ev.detail;
  const e = state.entities.get(id);
  if (!e) return;
  if (e.mesh) {
    sceneB.remove(e.mesh);
    e.mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    e.mesh = null;
  }
});

// ── Drifting fireflies / motes ─────────────────────────────────────────────
const MOTE_COUNT = 55;
const moteGeo = new THREE.BufferGeometry();
const motePos = new Float32Array(MOTE_COUNT * 3);
const motePhase = new Float32Array(MOTE_COUNT);
for (let i = 0; i < MOTE_COUNT; i++) {
  motePos[i * 3 + 0] = (Math.random() - 0.5) * 10;
  motePos[i * 3 + 1] = 0.4 + Math.random() * 2.4;
  motePos[i * 3 + 2] = (Math.random() - 0.5) * 6;
  motePhase[i] = Math.random() * Math.PI * 2;
}
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
const moteMat = new THREE.PointsMaterial({
  color: 0xaaf5c4, size: 0.06, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const motes = new THREE.Points(moteGeo, moteMat);
sceneB.add(motes);

// ── Resize handling ─────────────────────────────────────────────────────────
function syncSizes() {
  const wB = viewportB.clientWidth;
  const hB = viewportB.clientHeight;
  rendererB.setSize(wB, hB);
  cameraB.aspect = wB / Math.max(1, hB);
  cameraB.updateProjectionMatrix();
}
window.addEventListener("resize", syncSizes);
syncSizes();

// Icons re-layout if the left viewport resizes
const roA = new ResizeObserver(layoutIcons);
roA.observe(viewportA);

// ── Animation loop ──────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let sceneFlash = 0;

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = clock.getDelta();

  // False sun shimmer
  falseSun.material.opacity = 1;
  falseSun.position.x = Math.sin(t * 0.08) * 0.02;

  // Camera slow drift
  cameraB.position.x = Math.sin(t * 0.08) * 0.35;
  cameraB.position.y = 2.6 + Math.sin(t * 0.15) * 0.08;
  cameraB.lookAt(0, 1.2, 0);

  // Motes float
  const mp = moteGeo.attributes.position.array;
  for (let i = 0; i < MOTE_COUNT; i++) {
    mp[i * 3 + 0] += Math.sin(t * 0.6 + motePhase[i]) * 0.002;
    mp[i * 3 + 1] += Math.cos(t * 0.8 + motePhase[i]) * 0.0015;
    mp[i * 3 + 2] += Math.sin(t * 0.7 + motePhase[i] * 1.4) * 0.002;
  }
  moteGeo.attributes.position.needsUpdate = true;

  // Lightning / flash updates
  const now = performance.now();
  for (let i = lightningFlashes.length - 1; i >= 0; i--) {
    const f = lightningFlashes[i];
    const age = (now - f.start) / f.life;
    if (age >= 1) {
      sceneB.remove(f.bolt);
      if (f.bolt.material) f.bolt.material.dispose?.();
      if (f.bolt.geometry) f.bolt.geometry.dispose?.();
      lightningFlashes.splice(i, 1);
      continue;
    }
    if (f.isLight) {
      f.bolt.intensity = 18 * (1 - age);
    } else {
      const flicker = 0.4 + Math.random() * 0.6;
      f.bolt.material.opacity = (1 - age) * flicker;
      f.bolt.scale.x = 0.7 + Math.random() * 0.9;
      if (f.scenePulse) sceneFlash = Math.max(sceneFlash, 0.6 * (1 - age));
    }
  }

  // Dissolve updates
  for (let i = dissolving.length - 1; i >= 0; i--) {
    const d = dissolving[i];
    const age = (now - d.start) / d.life;
    if (age >= 1) {
      dissolving.splice(i, 1);
      continue;
    }
    const k = 1 - age;
    for (const m of d.meshes) {
      m.material.opacity = k;
    }
    d.group.position.y += 0.003;     // gently lifts as it fades
    d.group.scale.setScalar(1 + age * 0.35);
  }

  // Scene flash (briefly boost exposure on lightning)
  rendererB.toneMappingExposure = 1.05 + sceneFlash;
  sceneFlash *= 0.88;

  rendererB.render(sceneB, cameraB);
}
animate();

// ═════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═════════════════════════════════════════════════════════════════════════════

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
