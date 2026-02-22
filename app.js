import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// ============================================================
//  Firebase
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCw4g-CFOogIk9YgI865ZWhHwgvjDyXxwc",
  authDomain: "classtest-2dac4.firebaseapp.com",
  projectId: "classtest-2dac4",
  storageBucket: "classtest-2dac4.firebasestorage.app",
  messagingSenderId: "667876187515",
  appId: "1:667876187515:web:b3ce8203371108bef0f1de",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const creaturesCol = collection(db, "creatures");

// ============================================================
//  DOM
// ============================================================

const nameScreen = document.getElementById("nameScreen");
const nameInput = document.getElementById("nameInput");
const nameBtn = document.getElementById("nameBtn");

const drawScreen = document.getElementById("drawScreen");
const drawCanvas = document.getElementById("drawCanvas");
const drawCtx = drawCanvas.getContext("2d");
const brushSizeInput = document.getElementById("brushSize");
const clearDrawBtn = document.getElementById("clearDrawBtn");
const undoBtn = document.getElementById("undoBtn");
const eraseBtn = document.getElementById("eraseBtn");
const doneBtn = document.getElementById("doneBtn");

const oceanCanvas = document.getElementById("oceanCanvas");
const oceanCtx = oceanCanvas.getContext("2d");
const newCreatureBtn = document.getElementById("newCreatureBtn");

// ============================================================
//  State
// ============================================================

let userName = "";
let drawing = false;
let erasing = false;
let currentStroke = null;
let currentStrokes = [];

let bakedCanvas, bakedCtx;

const creatures = [];
const particles = [];

const MAX_PARALLAX = 50;
let parallaxX = 0;
let parallaxY = 0;
let parallaxTargetX = 0;
let parallaxTargetY = 0;
let depthCounter = 0;

let draggedCreature = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

// ============================================================
//  Glow brush helpers
// ============================================================

const GLOW_LAYERS = [
  { blur: 40, alpha: 0.08, extra: 22 },
  { blur: 28, alpha: 0.15, extra: 14 },
  { blur: 16, alpha: 0.3, extra: 8 },
  { blur: 8, alpha: 0.55, extra: 4 },
  { blur: 3, alpha: 1.0, extra: 0 },
];

function tracePath(ctx, pts) {
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

function drawGlowStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";

  for (const layer of GLOW_LAYERS) {
    ctx.globalAlpha = layer.alpha;
    ctx.shadowBlur = layer.blur;
    ctx.shadowColor = stroke.color;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width + layer.extra;
    tracePath(ctx, pts);
  }

  ctx.restore();
}

function drawPlainStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = stroke.width;
  tracePath(ctx, pts);
  ctx.restore();
}

// ============================================================
//  Creature offscreen canvas factory
// ============================================================

function buildCreatureCanvas(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const pad = 70;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.translate(-minX, -minY);

  const OCEAN_COLOR = "#00dfff";
  for (const s of strokes) {
    drawGlowStroke(ctx, { ...s, color: OCEAN_COLOR });
  }

  return { canvas: c, width: w, height: h };
}

// ============================================================
//  Screen management
// ============================================================

function showPhase(phase) {
  nameScreen.classList.toggle("hidden", phase !== "name");
  drawScreen.classList.toggle("hidden", phase !== "draw");
  newCreatureBtn.classList.toggle("hidden", phase !== "ocean");
  if (phase === "draw") initDrawCanvas();
}

// ============================================================
//  Phase 1 — Name
// ============================================================

function submitName() {
  const name = nameInput.value.trim();
  if (!name) return;
  userName = name;
  showPhase("draw");
}

nameBtn.addEventListener("click", submitName);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitName();
});

// ============================================================
//  Phase 2 — Draw creature
// ============================================================

function initDrawCanvas() {
  const size = Math.min(400, window.innerWidth - 48, window.innerHeight - 260);
  drawCanvas.width = size;
  drawCanvas.height = size;
  drawCanvas.style.width = size + "px";
  drawCanvas.style.height = size + "px";

  bakedCanvas = document.createElement("canvas");
  bakedCanvas.width = size;
  bakedCanvas.height = size;
  bakedCtx = bakedCanvas.getContext("2d");

  currentStrokes = [];
  currentStroke = null;
  drawing = false;
  erasing = false;
  eraseBtn.classList.remove("active");
  drawCanvas.style.cursor = "crosshair";
  drawCtx.clearRect(0, 0, size, size);
}

function drawPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: Math.round(cx - rect.left), y: Math.round(cy - rect.top) };
}

function rebakeStrokes() {
  if (!bakedCtx) return;
  bakedCtx.clearRect(0, 0, bakedCanvas.width, bakedCanvas.height);
  for (const s of currentStrokes) drawPlainStroke(bakedCtx, s);
}

function refreshDrawCanvas() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCtx.drawImage(bakedCanvas, 0, 0);
  if (currentStroke && currentStroke.points.length > 0) {
    drawPlainStroke(drawCtx, currentStroke);
  }
}

function hitTestStroke(stroke, pos, radius) {
  for (const p of stroke.points) {
    if ((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 < radius * radius) return true;
  }
  return false;
}

function onDrawStart(e) {
  e.preventDefault();
  drawing = true;
  if (erasing) return;
  currentStroke = {
    points: [drawPos(e)],
    color: "#ffffff",
    width: parseInt(brushSizeInput.value, 10),
  };
}

function onDrawMove(e) {
  if (!drawing) return;
  e.preventDefault();
  const pos = drawPos(e);

  if (erasing) {
    const eraseRadius = parseInt(brushSizeInput.value, 10) + 8;
    const before = currentStrokes.length;
    currentStrokes = currentStrokes.filter((s) => !hitTestStroke(s, pos, eraseRadius));
    if (currentStrokes.length !== before) {
      rebakeStrokes();
      refreshDrawCanvas();
    }
    return;
  }

  if (!currentStroke) return;
  const last = currentStroke.points[currentStroke.points.length - 1];
  if ((pos.x - last.x) ** 2 + (pos.y - last.y) ** 2 < 4) return;
  currentStroke.points.push(pos);
  refreshDrawCanvas();
}

function onDrawEnd(e) {
  if (!drawing) return;
  e.preventDefault();
  drawing = false;
  if (erasing) return;
  if (currentStroke && currentStroke.points.length >= 1) {
    drawPlainStroke(bakedCtx, currentStroke);
    currentStrokes.push(currentStroke);
  }
  currentStroke = null;
  refreshDrawCanvas();
}

drawCanvas.addEventListener("mousedown", onDrawStart);
drawCanvas.addEventListener("mousemove", onDrawMove);
drawCanvas.addEventListener("mouseup", onDrawEnd);
drawCanvas.addEventListener("mouseleave", onDrawEnd);
drawCanvas.addEventListener("touchstart", onDrawStart, { passive: false });
drawCanvas.addEventListener("touchmove", onDrawMove, { passive: false });
drawCanvas.addEventListener("touchend", onDrawEnd, { passive: false });
drawCanvas.addEventListener("touchcancel", onDrawEnd, { passive: false });

function undoLastStroke() {
  if (currentStrokes.length === 0) return;
  currentStrokes.pop();
  rebakeStrokes();
  refreshDrawCanvas();
}

undoBtn.addEventListener("click", undoLastStroke);

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    if (drawScreen.classList.contains("hidden")) return;
    e.preventDefault();
    undoLastStroke();
  }
});

eraseBtn.addEventListener("click", () => {
  erasing = !erasing;
  eraseBtn.classList.toggle("active", erasing);
  drawCanvas.style.cursor = erasing ? "cell" : "crosshair";
});

clearDrawBtn.addEventListener("click", () => {
  currentStrokes = [];
  currentStroke = null;
  if (bakedCtx) bakedCtx.clearRect(0, 0, bakedCanvas.width, bakedCanvas.height);
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
});

doneBtn.addEventListener("click", () => {
  if (currentStrokes.length === 0) return;

  const creatureData = {
    name: userName,
    strokes: JSON.parse(JSON.stringify(currentStrokes)),
    oceanX: 0.12 + Math.random() * 0.76,
    oceanY: 0.12 + Math.random() * 0.58,
    timestamp: Date.now(),
  };

  showPhase("ocean");

  addDoc(creaturesCol, creatureData)
    .then(() => console.log("Saved successfully!"))
    .catch((err) => console.error("Save failed:", err));
});

// ============================================================
//  Phase 3 — Ocean
// ============================================================

document.addEventListener("mousemove", (e) => {
  parallaxTargetX = (e.clientX / window.innerWidth - 0.5) * 2;
  parallaxTargetY = (e.clientY / window.innerHeight - 0.5) * 2;
});

function resizeOcean() {
  oceanCanvas.width = window.innerWidth;
  oceanCanvas.height = window.innerHeight;
  seedParticles();
}

function seedParticles() {
  particles.length = 0;
  const count = Math.floor((oceanCanvas.width * oceanCanvas.height) / 11000);
  for (let i = 0; i < count; i++) {
    const d = Math.random();
    particles.push({
      x: Math.random() * oceanCanvas.width,
      y: Math.random() * oceanCanvas.height,
      r: 0.3 + d * 1.6,
      speed: 0.04 + d * 0.28,
      alpha: 0.015 + d * 0.1,
      depth: d,
    });
  }
}

function animate() {
  const w = oceanCanvas.width;
  const h = oceanCanvas.height;
  const t = Date.now() / 1000;

  parallaxX += (parallaxTargetX - parallaxX) * 0.035;
  parallaxY += (parallaxTargetY - parallaxY) * 0.035;

  oceanCtx.clearRect(0, 0, w, h);

  // --- Particles (depth-layered) ---
  for (const p of particles) {
    p.y -= p.speed;
    if (p.y < -4) {
      p.y = h + 4;
      p.x = Math.random() * w;
    }
    const px = p.x + parallaxX * p.depth * MAX_PARALLAX;
    const py = p.y + parallaxY * p.depth * MAX_PARALLAX * 0.5;
    oceanCtx.globalAlpha = p.alpha;
    oceanCtx.fillStyle = "#5588aa";
    oceanCtx.beginPath();
    oceanCtx.arc(px, py, p.r, 0, Math.PI * 2);
    oceanCtx.fill();
  }

  // --- Creatures (sorted back-to-front by depth) ---
  const baseDim = Math.min(220, Math.min(w, h) * 0.24);

  for (const c of creatures) {
    if (c !== draggedCreature) {
      c.oceanX += c.vx / w;
      c.oceanY += c.vy / h;

      // Wrap around edges with padding
      if (c.oceanX < -0.05) c.oceanX = 1.05;
      else if (c.oceanX > 1.05) c.oceanX = -0.05;
      if (c.oceanY < -0.05) c.oceanY = 1.05;
      else if (c.oceanY > 1.05) c.oceanY = -0.05;

      // Gently change direction over time
      c.vx += (Math.random() - 0.5) * 0.02;
      c.vy += (Math.random() - 0.5) * 0.02;
      const spd = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
      const maxSpd = 0.45;
      const minSpd = 0.1;
      if (spd > maxSpd) { c.vx *= maxSpd / spd; c.vy *= maxSpd / spd; }
      if (spd < minSpd) { c.vx *= minSpd / spd; c.vy *= minSpd / spd; }
    }

    const depthScale = 0.55 + c.depth * 0.45;
    const depthAlpha = 0.6 + c.depth * 0.4;
    const bobMul = 0.35 + c.depth * 0.65;

    const pxOff = parallaxX * c.depth * MAX_PARALLAX;
    const pyOff = parallaxY * c.depth * MAX_PARALLAX * 0.5;

    const x = c.oceanX * w + pxOff;
    const baseY = c.oceanY * h + pyOff;
    const oy =
      (Math.sin(t * 0.45 + c.phase) * 10 +
        Math.sin(t * 0.21 + c.phase * 1.7) * 5 +
        Math.sin(t * 0.87 + c.phase * 0.5) * 3) *
      bobMul;
    const y = baseY + oy;

    const maxDim = baseDim * depthScale;
    const scale = Math.min(maxDim / c.w, maxDim / c.h, 1);
    const dw = c.w * scale;
    const dh = c.h * scale;

    c.screenX = x;
    c.screenY = y;
    c.screenW = dw;
    c.screenH = dh;

    oceanCtx.globalAlpha = depthAlpha;
    oceanCtx.drawImage(c.canvas, x - dw / 2, y - dh / 2, dw, dh);

    oceanCtx.globalAlpha = 0.5 * depthAlpha;
    oceanCtx.fillStyle = "#fff";
    oceanCtx.font = `${Math.round(10 + c.depth * 3)}px system-ui`;
    oceanCtx.textAlign = "center";
    oceanCtx.shadowBlur = 0;
    oceanCtx.fillText(c.name, x, y + dh / 2 + 14);
  }

  oceanCtx.globalAlpha = 1;
  requestAnimationFrame(animate);
}

// ============================================================
//  Firebase listener — populate ocean
// ============================================================

const loadedIds = new Set();

function addCreature(id, data) {
  if (loadedIds.has(id)) return;
  loadedIds.add(id);
  if (!data || !data.strokes || !Array.isArray(data.strokes)) return;

  const { canvas, width, height } = buildCreatureCanvas(data.strokes);
  const depth = depthCounter / (depthCounter + 6);
  depthCounter++;

  const angle = Math.random() * Math.PI * 2;
  const speed = 0.15 + Math.random() * 0.25;

  creatures.push({
    canvas,
    w: width,
    h: height,
    name: data.name || "???",
    oceanX: data.oceanX ?? Math.random(),
    oceanY: data.oceanY ?? Math.random(),
    phase: Math.random() * Math.PI * 2,
    depth,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  });

  creatures.sort((a, b) => a.depth - b.depth);
}

const creaturesQuery = query(creaturesCol, orderBy("timestamp", "asc"));

onSnapshot(creaturesQuery, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === "added") {
      addCreature(change.doc.id, change.doc.data());
    }
  });
}, (err) => console.error("Firestore listener error:", err));

// ============================================================
//  New creature button
// ============================================================

newCreatureBtn.addEventListener("click", () => showPhase("draw"));

// ============================================================
//  Drag creatures on ocean
// ============================================================

function hitCreature(mx, my) {
  for (let i = creatures.length - 1; i >= 0; i--) {
    const c = creatures[i];
    if (c.screenX === undefined) continue;
    const hw = c.screenW / 2;
    const hh = c.screenH / 2;
    if (mx > c.screenX - hw && mx < c.screenX + hw &&
        my > c.screenY - hh && my < c.screenY + hh) {
      return c;
    }
  }
  return null;
}

function oceanPointerPos(e) {
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: cx, y: cy };
}

function onOceanDown(e) {
  if (newCreatureBtn.classList.contains("hidden")) return;
  const pos = oceanPointerPos(e);
  const hit = hitCreature(pos.x, pos.y);
  if (hit) {
    e.preventDefault();
    draggedCreature = hit;
    dragOffsetX = pos.x - hit.screenX;
    dragOffsetY = pos.y - hit.screenY;
    oceanCanvas.style.cursor = "grabbing";
  }
}

function onOceanMove(e) {
  if (!draggedCreature) return;
  e.preventDefault();
  const pos = oceanPointerPos(e);
  const w = oceanCanvas.width;
  const h = oceanCanvas.height;
  draggedCreature.oceanX = (pos.x - dragOffsetX) / w;
  draggedCreature.oceanY = (pos.y - dragOffsetY) / h;
}

function onOceanUp() {
  if (draggedCreature) {
    draggedCreature = null;
    oceanCanvas.style.cursor = "default";
  }
}

oceanCanvas.addEventListener("mousedown", onOceanDown);
oceanCanvas.addEventListener("mousemove", onOceanMove);
oceanCanvas.addEventListener("mouseup", onOceanUp);
oceanCanvas.addEventListener("mouseleave", onOceanUp);
oceanCanvas.addEventListener("touchstart", onOceanDown, { passive: false });
oceanCanvas.addEventListener("touchmove", onOceanMove, { passive: false });
oceanCanvas.addEventListener("touchend", onOceanUp, { passive: false });
oceanCanvas.addEventListener("touchcancel", onOceanUp, { passive: false });

// ============================================================
//  Init
// ============================================================

window.addEventListener("resize", resizeOcean);
resizeOcean();
animate();
showPhase("name");
