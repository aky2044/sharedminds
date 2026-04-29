// ═════════════════════════════════════════════════════════════════════════════
//  THE ICON AND THE GHOST  ·  v4
//
//  Two players share one world through incompatible interfaces.
//
//   A (left)  · a flat modern Mac desktop. Real apps, draggable windows,
//              right-click menus, modern error sheets, cascading Win-95
//              error stacks for the big crashes. Keeping order on the
//              machine quietly costs the garden.
//
//   B (right) · a bioluminescent diorama floating in pitch-black void.
//              Lit only by the white glowing TV at the back and the soft
//              glow of the plants themselves. Players prune, weed, water,
//              compost. Tending the garden quietly costs the machine.
//
//  Every cross-world reaction is delayed (1–4 s), escalates with repetition,
//  and stacks into BIG EVENTS that lock out the opposite side until resolved.
// ═════════════════════════════════════════════════════════════════════════════

import { firebaseApp } from "./firebase/init.js";
import * as THREE from "three";

window.__firebaseApp = firebaseApp;
import { OrbitControls }   from "three/addons/controls/OrbitControls.js";
import { EffectComposer }  from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass }      from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutlinePass }     from "three/addons/postprocessing/OutlinePass.js";
import { ShaderPass }      from "three/addons/postprocessing/ShaderPass.js";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const now = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (a, b) => a + Math.random() * (b - a);
const pick  = (a) => a[Math.floor(Math.random() * a.length)];

// ═════════════════════════════════════════════════════════════════════════════
//  PACING ENGINE
// ═════════════════════════════════════════════════════════════════════════════
const pacing = {
  pressureA: 0,
  pressureB: 0,
  decayA: 4.0,
  decayB: 3.0,
  bigEvent: null,
  cooldownUntil: 0,
  recentA: [],
  recentB: [],
  pendingResponses: [],
  lastTick: now(),
  suppressionMul: 1.0,
  /** Calm intro: no ambient garden/desktop nudges until first issue fires. */
  firstIssueAt: now() + 48_000 + Math.random() * 42_000,
  issuesUnlocked: false,
  firstIssueFiredAt: null,
};

function pruneRecent(arr, win = 20_000) {
  const cutoff = now() - win;
  while (arr.length && arr[0].t < cutoff) arr.shift();
}
function countRecent(arr, action, win = 12_000) {
  const cutoff = now() - win;
  let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].t < cutoff) break;
    if (!action || arr[i].action === action) n++;
  }
  return n;
}

// Cross-world action router.
// `localOnly: true` skips routing to the other side (used by dev-mode buttons).
function doAction(side, action, opts = {}) {
  const a = { action, t: now(), intensity: opts.intensity ?? 1, opts };
  const otherSide = side === "A" ? "B" : "A";
  if (side === "A") pacing.recentA.push(a); else pacing.recentB.push(a);
  pruneRecent(side === "A" ? pacing.recentA : pacing.recentB);

  if (opts.localOnly) return;

  const map = (side === "A" ? A_TO_B_MAP : B_TO_A_MAP)[action];
  if (!map) return;

  let mul = 1.0;
  if (pacing.bigEvent && pacing.bigEvent.side === otherSide) mul *= 0.25;
  if (now() < pacing.cooldownUntil) mul *= 0.45;
  mul *= pacing.suppressionMul;

  const recent = countRecent(side === "A" ? pacing.recentA : pacing.recentB, action, map.window ?? 12_000);
  let tier = "base";
  if (recent >= (map.extremeAt ?? 5)) tier = "extreme";
  else if (recent >= (map.sustainedAt ?? 3)) tier = "sustained";

  const pressure = (map.pressure ?? 6) * (tier === "extreme" ? 1.6 : tier === "sustained" ? 1.25 : 1.0) * mul;
  if (otherSide === "A") pacing.pressureA = clamp(pacing.pressureA + pressure, 0, 100);
  else                   pacing.pressureB = clamp(pacing.pressureB + pressure, 0, 100);

  const delay = (map.delayMin ?? 1000) + Math.random() * ((map.delayMax ?? 3000) - (map.delayMin ?? 1000));
  schedule(delay, () => {
    if (pacing.bigEvent && pacing.bigEvent.side === otherSide && Math.random() < 0.7) return;
    map[tier]?.(opts, recent);
  });

  maybeTriggerBigEvent();
}

function schedule(ms, fn) {
  pacing.pendingResponses.push({ fireAt: now() + ms, fn });
}

function tickPacing() {
  const t = now();
  const dt = (t - pacing.lastTick) / 1000;
  pacing.lastTick = t;

  const decayMul = (t < pacing.cooldownUntil) ? 2.0 : 1.0;
  pacing.pressureA = clamp(pacing.pressureA - pacing.decayA * decayMul * dt, 0, 100);
  pacing.pressureB = clamp(pacing.pressureB - pacing.decayB * decayMul * dt, 0, 100);

  for (let i = pacing.pendingResponses.length - 1; i >= 0; i--) {
    if (pacing.pendingResponses[i].fireAt <= t) {
      const r = pacing.pendingResponses[i];
      pacing.pendingResponses.splice(i, 1);
      try { r.fn(); } catch (e) { console.error(e); }
    }
  }

  updateHud();

  // rare leaks when pressure is high (only after intro; ramp with escalation)
  const esc = issueEscalation();
  if (
    pacing.issuesUnlocked &&
    esc > 0.2 &&
    Math.random() < 0.0007 * (0.25 + esc * 0.75) &&
    (pacing.pressureA > 55 || pacing.pressureB > 55)
  ) {
    if (Math.random() < 0.6) leakOnA(); else leakOnB();
  }
}

/** 0 during intro; after first issue, ramps ~0.15 → 1 over several minutes (snowball). */
function issueEscalation() {
  if (!pacing.issuesUnlocked) return 0;
  if (!pacing.firstIssueFiredAt) return 0.12;
  const u = (now() - pacing.firstIssueFiredAt) / (6 * 60 * 1000);
  return clamp(0.15 + u * 0.85, 0.15, 1);
}

function maybeTriggerBigEvent() {
  if (pacing.bigEvent) return;
  if (now() < pacing.cooldownUntil) return;
  if (pacing.pressureA >= 100) {
    pacing.pressureA = 0;
    triggerBigEventA(pick(["restart-needed", "low-storage", "browser-issue"]));
  } else if (pacing.pressureB >= 100) {
    pacing.pressureB = 0;
    triggerBigEventB(pick(["invasive-bloom", "root-rot", "erosion-repair"]));
  }
}

function endBigEvent(side) {
  if (!pacing.bigEvent) return;
  pacing.bigEvent = null;
  pacing.cooldownUntil = now() + (15_000 + Math.random() * 15_000);
  pacing.pressureA *= 0.35;
  pacing.pressureB *= 0.35;
  cancelHintTimer();
}

const hudA = $("#hud-a");
const hudB = $("#hud-b");
function updateHud() {
  const a = Math.round(pacing.pressureA);
  const b = Math.round(pacing.pressureB);
  hudA.textContent = `PRESSURE ${a}`;
  hudB.textContent = `PRESSURE ${b}`;
  hudA.classList.toggle("high", a > 55);
  hudA.classList.toggle("crit", a > 80);
  hudB.classList.toggle("high", b > 55);
  hudB.classList.toggle("crit", b > 80);
}

// ═════════════════════════════════════════════════════════════════════════════
//  ENTITIES (files ↔ plants)
// ═════════════════════════════════════════════════════════════════════════════

// Real entity ↔ 3D plant pairs. Each "alive" entity exists as both a
// desktop file (icon) and a plant in the garden.
//   - new generated names (not the user's actual files)
//   - fewer of them: ~10
//   - mix of folders / images / files
const ENTITY_DEFS = [
  { id: "e1", name: "moodboard.png",    kind: "img",    type: "tree",     world: [-2.4, 0, -1.5] },
  { id: "e2", name: "draft v2.txt",     kind: "txt",    type: "bush",     world: [-1.0, 0,  0.8] },
  { id: "e3", name: "trip_photos",      kind: "folder", type: "tree",     world: [ 1.2, 0, -1.6] },
  { id: "e4", name: "sketch_03.png",    kind: "img",    type: "fern",     world: [ 0.4, 0,  1.7] },
  { id: "e5", name: "research.pdf",     kind: "pdf",    type: "fern",     world: [ 2.4, 0,  1.0] },
  { id: "e6", name: "Receipts",         kind: "folder", type: "bush",     world: [-2.6, 0,  1.8] },
  { id: "e7", name: "untitled.md",      kind: "md",     type: "fern",     world: [ 0.8, 0, -0.6] },
  { id: "e8", name: "audio_clip.wav",   kind: "audio",  type: "fern",     world: [-0.6, 0, -2.0] },
  { id: "e9", name: "old_school",       kind: "folder", type: "bush",     world: [ 2.6, 0, -0.5] },
  { id: "e10", name: "screenshot.png",  kind: "shot",   type: "tree",     world: [ 3.0, 0,  2.1] },
];

// Pure-decoration desktop icons (no garden counterpart). New invented names.
// Kept small and varied so the desktop reads as lived-in but uncluttered.
const DECOR_DEFS = [
  ["Documents", "folder"],
  ["Downloads", "folder"],
];

const state = {
  entities: new Map(),
  decor: [],
  trash: [],
  cleanedCount: 0,
  diskUsedPct: 96,
  selected: new Set(),
  windowsZ: 10,

  // garden simulation
  weeds: [],
  pests: [],
  cracks: [],
  invasive: [],
  composted: 0,
  overwaterTicks: 0,

  // tool mode for B
  tool: "look",

  // misc
  isAsleep: false, isDimmed: false,
  cursorMode: "normal",

  // dev
  devMode: false,
  demoActive: false,
  /** Shown first 3 successful weed pulls — hover hint copy in garden. */
  weedPullHintsShown: 0,

  // hint system
  hintTimer: null,
  hintTarget: null,
};

for (const d of ENTITY_DEFS) {
  state.entities.set(d.id, {
    ...d, alive: true, inTrash: false,
    dom: null, mesh: null, iconHome: null,
    sizeMB: 30 + Math.floor(Math.random() * 220),
    pruneCount: 0, dead: false,
    water: 100,            // 0..100, decays over time
    isWilted: false,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  PLAYER A · DOM REFS
// ═════════════════════════════════════════════════════════════════════════════
const viewportA  = $("#playerA");
const desktopEl  = $("#desktop");
const dockEl     = $("#dock");
const cursorEl   = $("#cursor-a");
const clockEl    = $("#mb-clock");
const battEl     = $("#mb-battery");
const ctxMenuEl  = $("#context-menu");
const sleepEl    = $("#sleep-overlay");
const leaksAEl   = $("#leaks-a");
const wallEl     = $("#wallpaper");
const bigAEl     = $("#big-event-a");
const errorStack = $("#error-stack");

// ── Wallpaper ──────────────────────────────────────────────────────────────
function paintWallpaper() {
  const r = wallEl.getBoundingClientRect();
  wallEl.width  = Math.max(1, Math.floor(r.width  * (window.devicePixelRatio || 1)));
  wallEl.height = Math.max(1, Math.floor(r.height * (window.devicePixelRatio || 1)));
  const w = wallEl.width, h = wallEl.height;
  const g = wallEl.getContext("2d");
  // Flat, slightly-cool light gray — no gradient, no grain, no vignette.
  g.fillStyle = "#eceef1";
  g.fillRect(0, 0, w, h);
}

// ── Menubar clock ──────────────────────────────────────────────────────────
function tickClock() {
  const d = new Date();
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const mons = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = d.getHours() >= 12 ? "PM" : "AM";
  clockEl.textContent = `${days[d.getDay()]} ${mons[d.getMonth()]} ${d.getDate()} ${h}:${m} ${ampm}`;
}
tickClock(); setInterval(tickClock, 15_000);

let battery = 96;
setInterval(() => { battery = Math.max(8, battery - 1); battEl.textContent = `${battery}%`; }, 40_000);

// Apple menu dropdown
$(".mb-apple").addEventListener("click", (ev) => {
  ev.stopPropagation();
  bigEventStep("A", "apple-menu-open");
  showContextMenu([
    { label: "About This Mac", disabled: true },
    { sep: true },
    { label: "System Settings…", on: () => openSettings() },
    { label: "App Store…", disabled: true },
    { sep: true },
    { label: "Recent Items", disabled: true },
    { label: "Force Quit…", on: () => openActivity() },
    { sep: true },
    { label: "Sleep", on: () => sleepDisplay() },
    { label: "Restart…", on: () => { bigEventStep("A", "restart-clicked"); confirmRestart(); } },
    { label: "Shut Down…", disabled: true },
    { sep: true },
    { label: "Lock Screen", disabled: true },
    { label: "Log Out…", disabled: true },
  ], 12, 28);
});

function confirmRestart() {
  showModal({
    icon: "info",
    title: "Are you sure you want to restart your computer?",
    msg: "Open applications will be closed.",
    buttons: [
      { label: "Cancel" },
      { label: "Restart", style: "primary", on: () => doRestart() },
    ],
  });
}

function doRestart() {
  bigEventStep("A", "restart-confirmed");
  // Close all open windows
  for (const id of Object.keys(openWindows)) closeWindow(id);
  // Black screen with spinner
  sleepEl.classList.add("sleep");
  setTimeout(() => {
    sleepEl.classList.remove("sleep");
    notify("info", "Welcome back", "Your Mac restarted successfully.");
    bigEventStep("A", "restart-complete");
  }, 4500);
}

// ═════════════════════════════════════════════════════════════════════════════
//  ICON ART (inline SVG data URLs)
// ═════════════════════════════════════════════════════════════════════════════
// Inline SVG strings (rendered directly into the .dicon-tile DOM,
// not as CSS background-image data URLs — much more reliable).
const ICON_SVG = {};

ICON_SVG.folder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52" width="100%" height="100%">
  <defs>
    <linearGradient id="folderBack" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0"   stop-color="#7fbfee"/>
      <stop offset="0.5" stop-color="#5aa3df"/>
      <stop offset="1"   stop-color="#3b81bf"/>
    </linearGradient>
    <linearGradient id="folderFront" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0"   stop-color="#a4d6f5"/>
      <stop offset="1"   stop-color="#5aa1d6"/>
    </linearGradient>
  </defs>
  <path d="M3 12 Q3 8 7 8 L24 8 L30 13 L57 13 Q61 13 61 17 L61 30 L3 30 Z" fill="url(#folderBack)"/>
  <path d="M3 17 Q3 14 6 14 L58 14 Q61 14 61 17 L61 44 Q61 48 57 48 L7 48 Q3 48 3 44 Z" fill="url(#folderFront)" stroke="#2c6fa3" stroke-width="0.4"/>
  <path d="M3 17 L61 17 L61 19 L3 19 Z" fill="rgba(255,255,255,0.45)"/>
</svg>`;

function docSVG(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 64" width="100%" height="100%">
    <path d="M6 2 L38 2 L52 16 L52 60 Q52 62 50 62 L8 62 Q6 62 6 60 Z" fill="#ffffff" stroke="#bcbcbc" stroke-width="0.6"/>
    <path d="M38 2 L52 16 L40 16 Q38 16 38 14 Z" fill="#cfcfcf"/>
    <path d="M38 2 L52 16 L40 16 Q38 16 38 14 Z" fill="none" stroke="#a4a4a4" stroke-width="0.4"/>
    <line x1="12" y1="26" x2="46" y2="26" stroke="#cfcfcf" stroke-width="1"/>
    <line x1="12" y1="32" x2="46" y2="32" stroke="#cfcfcf" stroke-width="1"/>
    <line x1="12" y1="38" x2="42" y2="38" stroke="#cfcfcf" stroke-width="1"/>
    <rect x="6" y="46" width="46" height="13" fill="${color}"/>
    <text x="28" y="56" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="9" fill="#ffffff" text-anchor="middle">${label}</text>
  </svg>`;
}
ICON_SVG.txt   = docSVG("TXT",  "#2b6da6");
ICON_SVG.md    = docSVG("MD",   "#454545");
ICON_SVG.pdf   = docSVG("PDF",  "#d63b2c");
ICON_SVG.audio = docSVG("WAV",  "#7c3ea7");
ICON_SVG.zip   = docSVG("ZIP",  "#7d8a99");

ICON_SVG.img = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52" width="100%" height="100%">
  <defs>
    <linearGradient id="imgSky" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffd1a8"/>
      <stop offset="0.5" stop-color="#f4a8a8"/>
      <stop offset="1" stop-color="#5a8fbe"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="62" height="50" rx="5" fill="#ffffff" stroke="#bbbbbb" stroke-width="0.8"/>
  <rect x="4" y="4" width="56" height="44" rx="2.5" fill="url(#imgSky)"/>
  <circle cx="48" cy="14" r="5" fill="#ffe8a8"/>
  <path d="M4 44 L18 28 L26 34 L36 22 L48 36 L60 26 L60 48 L4 48 Z" fill="#3d5a3a"/>
</svg>`;

ICON_SVG.shot = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52" width="100%" height="100%">
  <rect x="1" y="1" width="62" height="50" rx="5" fill="#fafafa" stroke="#bbbbbb" stroke-width="0.8"/>
  <rect x="4" y="4" width="56" height="44" rx="2.5" fill="#dfe5ed"/>
  <rect x="4" y="4" width="56" height="6" rx="2.5" fill="#bdc6d2"/>
  <circle cx="8"  cy="7" r="1.4" fill="#ff5f57"/>
  <circle cx="13" cy="7" r="1.4" fill="#ffbd2e"/>
  <circle cx="18" cy="7" r="1.4" fill="#28c840"/>
  <line x1="8" y1="20" x2="56" y2="20" stroke="#a8b3bf" stroke-width="0.8"/>
  <line x1="8" y1="26" x2="44" y2="26" stroke="#a8b3bf" stroke-width="0.8"/>
  <line x1="8" y1="32" x2="50" y2="32" stroke="#a8b3bf" stroke-width="0.8"/>
  <line x1="8" y1="38" x2="36" y2="38" stroke="#a8b3bf" stroke-width="0.8"/>
</svg>`;

function iconSVG(kind) { return ICON_SVG[kind] || ICON_SVG.txt; }

// Corrupted file glyph — used by corruptFiles(). Replaces the icon graphic
// with a glitchy blocky placeholder so the player can see something is wrong.
ICON_SVG.corrupt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 64" width="100%" height="100%">
  <path d="M6 2 L38 2 L52 16 L52 60 Q52 62 50 62 L8 62 Q6 62 6 60 Z" fill="#1c1c1c" stroke="#3a3a3a" stroke-width="0.6"/>
  <path d="M38 2 L52 16 L40 16 Q38 16 38 14 Z" fill="#101010"/>
  <rect x="10" y="20" width="8"  height="3" fill="#ff2a8c"/>
  <rect x="22" y="20" width="20" height="3" fill="#3affff"/>
  <rect x="10" y="26" width="22" height="3" fill="#3affff"/>
  <rect x="36" y="26" width="6"  height="3" fill="#ff2a8c"/>
  <rect x="10" y="32" width="6"  height="3" fill="#ff2a8c"/>
  <rect x="20" y="32" width="22" height="3" fill="#fff200"/>
  <rect x="10" y="38" width="32" height="3" fill="#3affff"/>
  <rect x="6" y="46" width="46" height="13" fill="#7a0000"/>
  <text x="28" y="56" font-family="Courier, monospace" font-weight="700" font-size="9" fill="#fff" text-anchor="middle">!?!?!</text>
</svg>`;
ICON_SVG.corruptFolder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52" width="100%" height="100%">
  <path d="M3 12 Q3 8 7 8 L24 8 L30 13 L57 13 Q61 13 61 17 L61 30 L3 30 Z" fill="#1c1c1c"/>
  <path d="M3 17 Q3 14 6 14 L58 14 Q61 14 61 17 L61 44 Q61 48 57 48 L7 48 Q3 48 3 44 Z" fill="#222" stroke="#3a3a3a" stroke-width="0.4"/>
  <rect x="8"  y="22" width="14" height="3" fill="#ff2a8c"/>
  <rect x="26" y="22" width="22" height="3" fill="#3affff"/>
  <rect x="8"  y="29" width="22" height="3" fill="#3affff"/>
  <rect x="34" y="29" width="20" height="3" fill="#ff2a8c"/>
  <rect x="8"  y="36" width="32" height="3" fill="#fff200"/>
</svg>`;

// "Corrupt files" effect — swap the icon SVG of N random alive icons with
// the corrupted glyph and add the .corrupted class for chromatic distortion.
function corruptFiles(n = 1) {
  const candidates = [
    ...[...state.entities.values()].filter(e => e.dom && !e.dom.classList.contains("corrupted")),
    ...state.decor.filter(d => d.dom && !d.dom.classList.contains("corrupted")),
  ];
  if (!candidates.length) return;
  for (let i = 0; i < n && candidates.length; i++) {
    const idx = Math.floor(Math.random() * candidates.length);
    const ent = candidates.splice(idx, 1)[0];
    const tile = ent.dom.querySelector(".dicon-tile");
    if (!tile) continue;
    const isFolder = ent.kind === "folder";
    tile.innerHTML = isFolder ? ICON_SVG.corruptFolder : ICON_SVG.corrupt;
    ent.dom.classList.add("corrupted");
    // Glitchy filename rewrite (keeps original name in dataset for restore)
    const lab = ent.dom.querySelector(".dicon-label");
    if (lab && !lab.dataset.origName) {
      lab.dataset.origName = lab.textContent;
      const orig = lab.textContent;
      const glitched = orig.replace(/[a-zA-Z0-9]/g, c => Math.random() < 0.45 ? "▓░▒█@#"[Math.floor(Math.random() * 6)] : c);
      lab.textContent = glitched;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  DESKTOP ICONS
// ═════════════════════════════════════════════════════════════════════════════
function buildAllIcons() {
  desktopEl.innerHTML = "";
  state.decor = DECOR_DEFS.map(([name, kind], i) => ({ id: `d${i}`, name, kind, isDecor: true, dom: null }));

  // Place icons in a vertical column on the right edge of the desktop —
  // mirrors a typical clean Mac desktop layout and keeps the wallpaper visible.
  const all = [];
  for (const e of state.entities.values()) if (e.alive && !e.inTrash) all.push({ kind: "entity", ref: e });
  for (const d of state.decor) all.push({ kind: "decor", ref: d });

  const r = desktopEl.getBoundingClientRect();
  const cellW = 100, cellH = 96;
  const colsFromRight = 2;
  const startX = Math.max(140, r.width - colsFromRight * cellW - 16);
  const startY = 24;
  all.forEach((it, i) => {
    const col = Math.floor(i / 6);
    const row = i % 6;
    const x = startX + col * cellW;
    const y = startY + row * cellH;
    if (it.kind === "entity") mountEntityIcon(it.ref, x, y);
    else                      mountDecorIcon(it.ref, x, y);
  });
}

function mountEntityIcon(e, x, y) {
  const el = document.createElement("div");
  el.className = "dicon";
  el.dataset.id = e.id;
  el.dataset.entity = "1";
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  e.iconHome = { x, y };
  el.innerHTML = `<div class="dicon-tile">${iconSVG(e.kind)}</div><div class="dicon-label">${e.name}</div>`;
  attachIconHandlers(el, e);
  desktopEl.appendChild(el);
  e.dom = el;
}

function mountDecorIcon(d, x, y) {
  const el = document.createElement("div");
  el.className = "dicon decor";
  el.dataset.id = d.id;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.innerHTML = `<div class="dicon-tile">${iconSVG(d.kind)}</div><div class="dicon-label">${d.name}</div>`;
  el.addEventListener("mousedown", (ev) => { ev.stopPropagation(); if (ev.button !== 0) return; selectOnly(d.id); });
  el.addEventListener("contextmenu", (ev) => {
    ev.preventDefault(); ev.stopPropagation(); selectOnly(d.id);
    showContextMenu([
      { label: "Open", disabled: true },
      { label: "Get Info", disabled: true },
      { sep: true },
      { label: "Move to Trash", on: () => shakeIcon(el) },
    ], ev.clientX, ev.clientY);
  });
  desktopEl.appendChild(el);
  d.dom = el;
}

function attachIconHandlers(el, e) {
  el.addEventListener("mousedown", (ev) => {
    ev.stopPropagation();
    if (ev.button !== 0) return;
    if (!state.selected.has(e.id)) selectOnly(e.id);
    startIconDrag(e, ev);
  });
  el.addEventListener("contextmenu", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!state.selected.has(e.id)) selectOnly(e.id);
    showContextMenu([
      { label: "Open",          kbd: "⌘O", disabled: true },
      { label: "Get Info",      kbd: "⌘I", disabled: true },
      { sep: true },
      { label: "Move to Trash", kbd: "⌘⌫", on: () => trashSelected() },
      { sep: true },
      { label: "Clean Up by Name", on: cleanUpByName },
    ], ev.clientX, ev.clientY);
  });
}

function selectOnly(id) {
  state.selected.clear();
  if (id) state.selected.add(id);
  for (const el of $$(".dicon", desktopEl)) {
    el.classList.toggle("selected", state.selected.has(el.dataset.id));
  }
}

function shakeIcon(el) {
  el.style.transition = "transform 0.06s linear";
  let t = 0;
  const iv = setInterval(() => {
    t += 0.06;
    el.style.transform = `translate(${Math.sin(t * 40) * 3}px, 0)`;
    if (t > 0.3) { clearInterval(iv); el.style.transform = ""; }
  }, 60);
}

desktopEl.addEventListener("mousedown", (ev) => {
  if (ev.target.closest(".window") || ev.target.closest(".dicon") || ev.target.closest("#dock")) return;
  selectOnly(null);
  closeContextMenu();
});

desktopEl.addEventListener("contextmenu", (ev) => {
  if (ev.target.closest(".dicon") || ev.target.closest(".window") || ev.target.closest("#dock")) return;
  ev.preventDefault();
  showContextMenu([
    { label: "New Folder",        disabled: true },
    { label: "Clean Up",          on: cleanUpByName },
    { label: "Clean Up by Name",  on: cleanUpByName },
    { sep: true },
    { label: "Change Desktop Background", disabled: true },
  ], ev.clientX, ev.clientY);
});

// ── Drag → Trash ───────────────────────────────────────────────────────────
let trashDockEl = null;
function startIconDrag(e, ev) {
  if (!e.dom) return;
  const startX = ev.clientX, startY = ev.clientY;
  const origLeft = parseFloat(e.dom.style.left) || 0;
  const origTop  = parseFloat(e.dom.style.top)  || 0;
  let dragging = false, ghost = null;
  const onMove = (mv) => {
    const dx = mv.clientX - startX, dy = mv.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 4) {
      dragging = true;
      ghost = e.dom.cloneNode(true);
      ghost.style.opacity = "0.75";
      ghost.style.pointerEvents = "none";
      ghost.style.zIndex = "5000";
      desktopEl.appendChild(ghost);
    }
    if (!dragging) return;
    ghost.style.left = `${origLeft + dx}px`;
    ghost.style.top  = `${origTop  + dy}px`;
  };
  const onUp = (mv) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (!dragging) return;
    const t = trashDockEl?.getBoundingClientRect();
    if (t && mv.clientX >= t.left && mv.clientX <= t.right && mv.clientY >= t.top && mv.clientY <= t.bottom) {
      trashSelected();
    }
    ghost?.remove();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function trashSelected() {
  const ids = state.selected.size ? [...state.selected] : [];
  for (const id of ids) moveToTrash(id);
}

function moveToTrash(id) {
  const e = state.entities.get(id);
  if (!e || !e.alive || e.inTrash) return;
  e.inTrash = true;
  state.trash.push(id);
  if (e.dom) { e.dom.remove(); e.dom = null; }
  updateTrashBadge();
  if (openWindows.trash) renderTrashWindow();
  if (openWindows.finder) renderFinderList();
  doAction("A", "delete", { ids: [id] });
}

function cleanUpByName() {
  const live = [...state.entities.values()].filter(e => e.alive && !e.inTrash);
  const all = [];
  for (const e of live) all.push({ kind: "entity", ref: e });
  for (const d of state.decor) all.push({ kind: "decor", ref: d });
  all.sort((x, y) => x.ref.name.localeCompare(y.ref.name));
  const r = desktopEl.getBoundingClientRect();
  const cellW = 100, cellH = 96, colsFromRight = 2;
  const startX = Math.max(140, r.width - colsFromRight * cellW - 16);
  const startY = 24;
  all.forEach((it, i) => {
    const col = Math.floor(i / 6);
    const row = i % 6;
    const x = startX + col * cellW;
    const y = startY + row * cellH;
    const dom = it.ref.dom;
    if (dom) {
      dom.style.transition = "left 0.45s ease, top 0.45s ease";
      dom.style.left = `${x}px`; dom.style.top = `${y}px`;
      setTimeout(() => { if (dom) dom.style.transition = ""; }, 500);
    }
    if (it.kind === "entity") it.ref.iconHome = { x, y };
  });
  doAction("A", "cleanup", {});
}

// ═════════════════════════════════════════════════════════════════════════════
//  CONTEXT MENU
// ═════════════════════════════════════════════════════════════════════════════
function showContextMenu(items, x, y) {
  ctxMenuEl.innerHTML = "";
  for (const it of items) {
    if (it.sep) { const s = document.createElement("div"); s.className = "ctx-sep"; ctxMenuEl.appendChild(s); continue; }
    const row = document.createElement("div");
    row.className = "ctx-item" + (it.disabled ? " disabled" : "");
    row.innerHTML = `<span>${it.label}</span><span class="ctx-kbd">${it.kbd ?? ""}</span>`;
    row.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (it.disabled) return;
      closeContextMenu(); it.on?.();
    });
    ctxMenuEl.appendChild(row);
  }
  const vp = viewportA.getBoundingClientRect();
  ctxMenuEl.style.left = `${x - vp.left}px`;
  ctxMenuEl.style.top  = `${y - vp.top}px`;
  ctxMenuEl.classList.remove("hidden");
}
function closeContextMenu() { ctxMenuEl.classList.add("hidden"); }
document.addEventListener("mousedown", (ev) => { if (!ev.target.closest("#context-menu")) closeContextMenu(); });

// ═════════════════════════════════════════════════════════════════════════════
//  DOCK + APPS  (only apps with real interactions are present)
// ═════════════════════════════════════════════════════════════════════════════
// Detailed Mac-style dock icons. Each one renders a colorful 32x32 tile
// (with its own background, gradient, and content) instead of a flat glyph.
const DOCK_SVG = {
  finder: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="fbg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#67c0ff"/><stop offset="1" stop-color="#1f7be0"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7" fill="url(#fbg)"/>
    <!-- two-tone face -->
    <path d="M 16 4 A 12 12 0 0 0 4 16 L 4 28 L 16 28 Z" fill="#ffffff"/>
    <path d="M 16 4 A 12 12 0 0 1 28 16 L 28 28 L 16 28 Z" fill="#dde7f0"/>
    <ellipse cx="11" cy="13" rx="1.4" ry="3" fill="#1f1f1f"/>
    <ellipse cx="21" cy="13" rx="1.4" ry="3" fill="#1f1f1f"/>
    <path d="M 10 21 Q 16 25 22 21" stroke="#1f1f1f" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>`,
  safari: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sbg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#dfe7ec"/><stop offset="1" stop-color="#b4c2cc"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7" fill="url(#sbg)"/>
    <circle cx="16" cy="16" r="11" fill="#1d83d4" stroke="#0d5fa0" stroke-width="0.7"/>
    <circle cx="16" cy="16" r="9.5" fill="#ffffff"/>
    <g transform="rotate(35 16 16)">
      <polygon points="16,8 18.5,16 16,24 13.5,16" fill="#e23a2e"/>
      <polygon points="16,8 16,16 13.5,16" fill="#a82820"/>
      <polygon points="16,16 16,24 18.5,16" fill="#cccccc"/>
    </g>
    <circle cx="16" cy="16" r="1.2" fill="#444"/>
  </svg>`,
  mail: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="mbg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#74c4ff"/><stop offset="1" stop-color="#1881e8"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7" fill="url(#mbg)"/>
    <rect x="5" y="9" width="22" height="14" rx="1.6" fill="#ffffff"/>
    <path d="M 5 10 L 16 18 L 27 10" stroke="#1881e8" stroke-width="1.4" fill="none"/>
  </svg>`,
  messages: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="mgbg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#5cdf78"/><stop offset="1" stop-color="#1ab046"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7" fill="url(#mgbg)"/>
    <path d="M 7 9 H 25 Q 27 9 27 11 V 19 Q 27 21 25 21 H 13 L 9 25 V 21 H 7 Q 5 21 5 19 V 11 Q 5 9 7 9 Z" fill="#ffffff"/>
  </svg>`,
  calendar: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="7" fill="#ffffff" stroke="#dadada" stroke-width="0.5"/>
    <rect x="2" y="2" width="28" height="7" rx="5" fill="#e23a2e"/>
    <text x="16" y="7.5" font-family="Helvetica" font-weight="700" font-size="4.5" fill="#ffffff" text-anchor="middle">JAN</text>
    <text x="16" y="25" font-family="Helvetica" font-weight="600" font-size="14" fill="#3a3a3a" text-anchor="middle">13</text>
  </svg>`,
  notes: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="nbg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#fff4c2"/><stop offset="1" stop-color="#f6cd34"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7" fill="url(#nbg)"/>
    <rect x="6" y="3" width="20" height="3" fill="#cfa829"/>
    <line x1="9"  y1="13" x2="23" y2="13" stroke="#866d23" stroke-width="0.9"/>
    <line x1="9"  y1="17" x2="23" y2="17" stroke="#866d23" stroke-width="0.9"/>
    <line x1="9"  y1="21" x2="23" y2="21" stroke="#866d23" stroke-width="0.9"/>
    <line x1="9"  y1="25" x2="20" y2="25" stroke="#866d23" stroke-width="0.9"/>
  </svg>`,
  settings: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="stbg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#cfd1d4"/><stop offset="1" stop-color="#7e8388"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7" fill="url(#stbg)"/>
    <g transform="translate(16 16)" fill="#ffffff" stroke="#404040" stroke-width="0.4">
      <path d="M -1.6 -10 L 1.6 -10 L 2 -7.5 L 4.5 -6.5 L 6.5 -8 L 8 -6.5 L 6.5 -4.5 L 7.5 -2 L 10 -1.6 L 10 1.6 L 7.5 2 L 6.5 4.5 L 8 6.5 L 6.5 8 L 4.5 6.5 L 2 7.5 L 1.6 10 L -1.6 10 L -2 7.5 L -4.5 6.5 L -6.5 8 L -8 6.5 L -6.5 4.5 L -7.5 2 L -10 1.6 L -10 -1.6 L -7.5 -2 L -6.5 -4.5 L -8 -6.5 L -6.5 -8 L -4.5 -6.5 L -2 -7.5 Z"/>
      <circle r="3" fill="#7e8388"/>
    </g>
  </svg>`,
  activity: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="abg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#444b59"/><stop offset="1" stop-color="#1b1f29"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7" fill="url(#abg)"/>
    <polyline points="3,20 9,20 12,9 16,25 19,15 22,20 29,20" fill="none" stroke="#5dffaa" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`,
  vscode: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="7" fill="#0078d4"/>
    <path d="M 6 22 L 21 6 L 26 8 L 26 24 L 21 26 L 6 10 L 12 16 Z" fill="#ffffff" opacity="0.95"/>
    <path d="M 6 22 L 12 16 L 6 10 Z" fill="#005a9e" opacity="0.65"/>
  </svg>`,
  trash: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="7" fill="#e6e8eb" stroke="#bcc0c5" stroke-width="0.4"/>
    <path d="M 9 11 H 23 L 21 24 Q 21 26 19 26 H 13 Q 11 26 11 24 Z" fill="#b5b9bf" stroke="#5c6066" stroke-width="0.6"/>
    <line x1="7" y1="11" x2="25" y2="11" stroke="#5c6066" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M 14 9 H 18 Q 19 9 19 10 V 11 H 13 V 10 Q 13 9 14 9 Z" fill="#9aa0a6" stroke="#5c6066" stroke-width="0.4"/>
    <line x1="14" y1="14" x2="14" y2="22" stroke="#5c6066" stroke-width="0.7"/>
    <line x1="16" y1="14" x2="16" y2="22" stroke="#5c6066" stroke-width="0.7"/>
    <line x1="18" y1="14" x2="18" y2="22" stroke="#5c6066" stroke-width="0.7"/>
  </svg>`,
};
const TRASH_OPEN_SVG = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="7" fill="#e6e8eb" stroke="#bcc0c5" stroke-width="0.4"/>
  <path d="M 9 13 H 23 L 21 26 Q 21 28 19 28 H 13 Q 11 28 11 26 Z" fill="#b5b9bf" stroke="#5c6066" stroke-width="0.6"/>
  <line x1="6" y1="13" x2="26" y2="13" stroke="#5c6066" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M 13 6 L 19 6 L 19.5 11 L 12.5 11 Z" fill="#9aa0a6" stroke="#5c6066" stroke-width="0.5"/>
</svg>`;

// All apps include a `sizeGB` (used by Storage view) and a `removable` flag.
const APPS = [
  { id: "finder",   label: "Finder",          sizeGB: 0.4, removable: false },
  { id: "safari",   label: "Safari",          sizeGB: 8.2, removable: true  },
  { id: "mail",     label: "Mail",            sizeGB: 5.4, removable: true  },
  { id: "messages", label: "Messages",        sizeGB: 2.1, removable: true  },
  { id: "calendar", label: "Calendar",        sizeGB: 1.0, removable: true  },
  { id: "notes",    label: "Notes",           sizeGB: 0.6, removable: true  },
  { id: "settings", label: "System Settings", sizeGB: 0.3, removable: false },
  { id: "vscode",   label: "Visual Studio Code", sizeGB: 12.6, removable: true },
  { id: "activity", label: "Activity Monitor",sizeGB: 0.2, removable: false },
  { sep: true },
  { id: "trash",    label: "Trash",           sizeGB: 0,   removable: false },
];

// Apps that have been uninstalled (won't render in dock)
state.uninstalled = new Set();

function buildDock() {
  dockEl.innerHTML = "";
  for (const a of APPS) {
    if (a.sep) { const s = document.createElement("div"); s.className = "dock-sep"; dockEl.appendChild(s); continue; }
    if (state.uninstalled.has(a.id)) continue;
    const el = document.createElement("div");
    el.className = `dock-item app-${a.id}`;
    el.dataset.appId = a.id;
    el.innerHTML = `<span class="dock-glyph">${DOCK_SVG[a.id] || ""}</span><div class="dock-tooltip">${a.label}</div>`;
    el.addEventListener("click", () => openApp(a.id));
    el.addEventListener("contextmenu", (ev) => showDockContextMenu(ev, a));
    dockEl.appendChild(el);
    if (a.id === "trash") trashDockEl = el;
  }
  updateTrashBadge();
}

function showDockContextMenu(ev, a) {
  ev.preventDefault();
  ev.stopPropagation();
  const isOpen = !!openWindows[a.id];
  const items = [];
  if (a.id === "trash") {
    items.push({ label: "Open", on: () => openApp(a.id) });
    items.push({ label: state.trash.length ? "Empty Trash…" : "Empty Trash", disabled: !state.trash.length, on: confirmEmptyTrash });
  } else {
    items.push({ label: "Open", on: () => openApp(a.id) });
    items.push({ label: "Show Recents", disabled: true });
    items.push({ label: "Show in Finder", disabled: true });
    items.push({ sep: true });
    if (isOpen) items.push({ label: "Quit", on: () => closeWindow(a.id) });
    else        items.push({ label: "Quit", disabled: true });
    items.push({ sep: true });
    if (a.removable) {
      items.push({ label: `Uninstall…  (${a.sizeGB.toFixed(1)} GB)`, on: () => confirmUninstall(a.id) });
    } else {
      items.push({ label: "Uninstall…", disabled: true });
    }
  }
  showContextMenu(items, ev.clientX, ev.clientY);
}

function confirmUninstall(appId) {
  const a = APPS.find(x => x.id === appId);
  if (!a) return;
  showModal({
    icon: "warn",
    title: `Uninstall ${a.label}?`,
    msg: `${a.label} will be removed from this Mac. This will free ${a.sizeGB.toFixed(1)} GB of disk space.`,
    buttons: [
      { label: "Cancel" },
      { label: "Uninstall", style: "danger", on: () => uninstallApp(appId) },
    ],
  });
}

function uninstallApp(appId) {
  const a = APPS.find(x => x.id === appId);
  if (!a) return;
  state.uninstalled.add(appId);
  state.diskUsedPct = Math.max(20, state.diskUsedPct - Math.round((a.sizeGB / 500) * 100));
  closeWindow(appId);
  buildDock();
  if (openWindows.settings) {
    const main = openWindows.settings.body.querySelector("#settings-main");
    if (main && main.dataset.pane === "storage") renderSettings(main, "storage");
  }
  notify("info", "Application removed", `${a.label} has been uninstalled. ${a.sizeGB.toFixed(1)} GB freed.`);
  bigEventStep("A", "uninstalled-app", { appId, sizeGB: a.sizeGB });
}

function updateTrashBadge() {
  if (!trashDockEl) return;
  trashDockEl.querySelectorAll(".dock-badge").forEach(n => n.remove());
  if (state.trash.length === 0) return;
  const b = document.createElement("div");
  b.className = "dock-badge";
  b.textContent = state.trash.length;
  trashDockEl.appendChild(b);
}

// ═════════════════════════════════════════════════════════════════════════════
//  WINDOW MANAGER
// ═════════════════════════════════════════════════════════════════════════════
const openWindows = {};
function focusWindow(id) {
  const w = openWindows[id]; if (!w) return;
  state.windowsZ++; w.root.style.zIndex = state.windowsZ;
}
function createWindow({ id, title, width = 540, height = 360, x, y, body, onClose }) {
  if (openWindows[id]) { focusWindow(id); return openWindows[id]; }
  const root = document.createElement("div");
  root.className = "window";
  root.style.width  = `${width}px`;
  root.style.height = `${height}px`;
  const r = desktopEl.getBoundingClientRect();
  const px = typeof x === "number" ? x : Math.max(40, (r.width - width) / 2 + (Math.random() * 60 - 30));
  const py = typeof y === "number" ? y : Math.max(40, (r.height - height) / 2 - 40 + (Math.random() * 60 - 30));
  root.style.left = `${px}px`; root.style.top  = `${py}px`;
  const bar = document.createElement("div"); bar.className = "window-bar";
  bar.innerHTML = `<div class="traffic"><div class="light red"><span class="traffic-close-x" aria-hidden="true">×</span></div><div class="light yellow"></div><div class="light green"></div></div><div class="window-title">${title}</div>`;
  root.appendChild(bar);
  const bodyEl = document.createElement("div");
  bodyEl.className = "window-body";
  if (typeof body === "string") bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  root.appendChild(bodyEl);

  desktopEl.appendChild(root);
  state.windowsZ++; root.style.zIndex = state.windowsZ;

  bar.querySelector(".light.red").addEventListener("click", (ev) => { ev.stopPropagation(); closeWindow(id); });
  root.addEventListener("mousedown", () => focusWindow(id));

  let drag = null;
  bar.addEventListener("mousedown", (ev) => { if (ev.target.closest(".light")) return; drag = { sx: ev.clientX, sy: ev.clientY, ox: root.offsetLeft, oy: root.offsetTop }; });
  document.addEventListener("mousemove", (ev) => {
    if (!drag) return;
    root.style.left = `${drag.ox + (ev.clientX - drag.sx)}px`;
    root.style.top  = `${Math.max(0, drag.oy + (ev.clientY - drag.sy))}px`;
  });
  document.addEventListener("mouseup", () => drag = null);

  const win = { root, body: bodyEl, onClose };
  openWindows[id] = win;
  dockEl.querySelector(`.app-${id}`)?.classList.add("running");
  return win;
}
function closeWindow(id) {
  const w = openWindows[id]; if (!w) return;
  try { w.onClose?.(); } catch {}
  w.root.remove();
  delete openWindows[id];
  dockEl.querySelector(`.app-${id}`)?.classList.remove("running");
}
function openApp(id) {
  switch (id) {
    case "finder":   openFinder();   break;
    case "safari":   openSafari();   break;
    case "notes":    openNotes();    break;
    case "settings": openSettings(); break;
    case "trash":    openTrash();    break;
    case "activity": openActivity(); break;
    case "mail":     openMail();     break;
    case "messages": openMessages(); break;
    case "calendar": openCalendar(); break;
    case "vscode":   openVSCode();   break;
  }
}

function openMail() {
  const body = document.createElement("div");
  body.className = "split-body";
  body.innerHTML = `
    <div class="side-list">
      <div class="side-group">Mailboxes</div>
      <div class="side-item active">▣ Inbox <span style="float:right;color:#888">12</span></div>
      <div class="side-item">✦ VIP</div>
      <div class="side-item">★ Flagged</div>
      <div class="side-item">↗ Sent</div>
    </div>
    <div class="main-pane">
      <div class="main-toolbar"><span class="path">Inbox</span></div>
      <div class="list">
        ${["Quarterly review","Re: brunch?","Your subscription","Welcome back","Apple Receipt","Re: Re: Re: meeting","An update is ready","[Promo] 20% off"].map(s => `
          <div class="row" style="grid-template-columns:30px 1fr 110px;">
            <span style="font-size:10px;color:#9aa">●</span>
            <span style="font-weight:500;">${s}</span>
            <span style="color:#9aa;text-align:right;">${["10:14 AM","Yesterday","Apr 23","Apr 22","Apr 18","Apr 12","Apr 10","Apr 5"][Math.floor(Math.random()*8)]}</span>
          </div>`).join("")}
      </div>
    </div>`;
  createWindow({ id: "mail", title: "Mail — Inbox", width: 600, height: 380, body });
}

function openMessages() {
  const body = document.createElement("div");
  body.style.padding = "20px";
  body.style.color = "#5a5a5a";
  body.style.fontSize = "13px";
  body.innerHTML = `
    <div style="text-align:center;padding:30px 0;">
      <div style="font-size:30px;margin-bottom:10px;color:#1ab046;">●●●</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px;color:#1b1b1b;">No conversations</div>
      <div>Start a new message to begin a chat.</div>
    </div>`;
  createWindow({ id: "messages", title: "Messages", width: 460, height: 320, body });
}

function openCalendar() {
  const body = document.createElement("div");
  body.style.padding = "16px";
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:18px;font-weight:600;">January 2026</span>
      <span><button class="btn">‹</button> <button class="btn">›</button></span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#dde;border:1px solid #dde;font-size:11px;">
      ${["S","M","T","W","T","F","S"].map(d => `<div style="background:#f3f3f5;padding:6px 0;text-align:center;font-weight:600;color:#888;">${d}</div>`).join("")}
      ${Array.from({length:35},(_,i) => {
        const day = i - 3;
        const today = day === 13;
        return `<div style="background:#fff;padding:8px 6px;min-height:36px;font-size:11px;${today ? 'background:#fef0ef;color:#e23a2e;font-weight:600;' : ''}">${day > 0 && day <= 31 ? day : ""}</div>`;
      }).join("")}
    </div>`;
  createWindow({ id: "calendar", title: "Calendar", width: 520, height: 380, body });
}

function openVSCode() {
  const body = document.createElement("div");
  body.style.background = "#1e1e1e";
  body.style.color = "#d4d4d4";
  body.style.fontFamily = "var(--mono)";
  body.style.fontSize = "12px";
  body.style.padding = "12px";
  body.innerHTML = `
    <div style="color:#8a8a8a;margin-bottom:10px;">~/projects/garden  —  the_icon_and_the_ghost.js</div>
    <pre style="line-height:1.5;color:#d4d4d4;">
<span style="color:#c586c0">function</span> <span style="color:#dcdcaa">tend</span>(garden) {
  <span style="color:#c586c0">if</span> (garden.weeds.length > <span style="color:#b5cea8">0</span>) <span style="color:#dcdcaa">pull</span>(garden.weeds[<span style="color:#b5cea8">0</span>]);
  <span style="color:#c586c0">if</span> (garden.water < <span style="color:#b5cea8">30</span>)         <span style="color:#dcdcaa">water</span>(garden);
  <span style="color:#c586c0">return</span> garden.health;
}</pre>`;
  createWindow({ id: "vscode", title: "Visual Studio Code", width: 520, height: 320, body });
}

// ── Finder ─────────────────────────────────────────────────────────────────
function openFinder() {
  const body = document.createElement("div");
  body.className = "split-body";
  body.innerHTML = `
    <div class="side-list">
      <div class="side-group">Favorites</div>
      <div class="side-item">◎ AirDrop</div>
      <div class="side-item">◷ Recents</div>
      <div class="side-item active">▣ Desktop</div>
      <div class="side-item">▤ Documents</div>
      <div class="side-item">▽ Downloads</div>
      <div class="side-group">Locations</div>
      <div class="side-item">◇ Macintosh HD</div>
    </div>
    <div class="main-pane">
      <div class="main-toolbar">
        <button class="btn" id="fn-cleanup">Clean Up by Name</button>
        <button class="btn danger" id="fn-trash">Move to Trash</button>
        <button class="btn" id="fn-defrag">Defragment Disk…</button>
        <button class="btn" id="fn-antivirus">Run Antivirus…</button>
        <span class="path">~ / Desktop</span>
      </div>
      <div class="list" id="fn-list"></div>
    </div>`;
  createWindow({ id: "finder", title: "Desktop", width: 660, height: 420, body });
  renderFinderList();
  body.querySelector("#fn-cleanup").addEventListener("click", cleanUpByName);
  body.querySelector("#fn-trash").addEventListener("click", trashSelected);
  body.querySelector("#fn-defrag").addEventListener("click", () => doAction("A", "defrag", {}));
  body.querySelector("#fn-antivirus").addEventListener("click", () => doAction("A", "antivirus", {}));
}
function renderFinderList() {
  const win = openWindows.finder; if (!win) return;
  const list = win.body.querySelector("#fn-list");
  const live = [...state.entities.values()].filter(e => e.alive && !e.inTrash);
  list.innerHTML = `<div class="row header"><span></span><span>Name</span><span>Size</span><span>Kind</span></div>`;
  for (const e of live) {
    const row = document.createElement("div");
    row.className = "row" + (state.selected.has(e.id) ? " selected" : "");
    row.innerHTML = `
      <span class="row-icon">${iconSVG(e.kind)}</span>
      <span>${e.name}</span><span>${e.sizeMB} MB</span>
      <span>${kindLabel(e.kind)}</span>`;
    row.addEventListener("click", () => { selectOnly(e.id); renderFinderList(); });
    list.appendChild(row);
  }
}
function kindLabel(k) {
  return ({ folder:"Folder", img:"Image", txt:"Text", pdf:"PDF", md:"Markdown", audio:"Audio", shot:"Screenshot" })[k] || "File";
}

// ── Safari ─────────────────────────────────────────────────────────────────
function openSafari(opts = {}) {
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="safari-toolbar">
      <div class="safari-btn">◀</div><div class="safari-btn">▶</div><div class="safari-btn">↻</div>
      <div class="safari-url">${opts.url ?? "apple.com/mac/"}</div>
      <div class="safari-btn">⤴</div>
    </div>
    <div class="safari-page" id="safari-page">${opts.html ?? `
      <h1>Mac</h1>
      <p>Lorem ipsum about the machine on your desk. Technology has made its way around every edge of your life.</p>
      <p>Scroll. Click. Optimize. Delete. Repeat.</p>
      <p>Performance has been uneven. Consider updating your system.</p>
    `}</div>`;
  createWindow({ id: "safari", title: opts.title ?? "Safari", width: 580, height: 380, body });
  return body.querySelector("#safari-page");
}

// ── Notes ──────────────────────────────────────────────────────────────────
function openNotes() {
  const body = document.createElement("div");
  body.className = "split-body";
  body.innerHTML = `
    <div class="notes-list">
      <div class="notes-entry active"><div>Reminders</div><div class="n-date">today</div></div>
      <div class="notes-entry"><div>Grocery</div><div class="n-date">yesterday</div></div>
      <div class="notes-entry"><div>— draft —</div><div class="n-date">Apr 20</div></div>
    </div>
    <div class="notes-main">
      <h3>Reminders</h3>
      <p>Back up the Desktop.</p>
      <p>Clean out old files. Disk space is low.</p>
      <p>Something about the machine feels different lately.</p>
    </div>`;
  createWindow({ id: "notes", title: "Notes", width: 520, height: 340, body });
}

// ── System Settings ────────────────────────────────────────────────────────
function openSettings() {
  const body = document.createElement("div");
  body.className = "split-body";
  body.innerHTML = `
    <div class="side-list">
      <div class="side-item active" data-pane="update">↻ Software Update</div>
      <div class="side-item" data-pane="display">▢ Displays</div>
      <div class="side-item" data-pane="battery">◔ Battery</div>
      <div class="side-item" data-pane="storage">◉ Storage</div>
      <div class="side-item" data-pane="general">⚙ General</div>
    </div>
    <div class="settings-main main-pane" id="settings-main"></div>`;
  createWindow({ id: "settings", title: "System Settings", width: 660, height: 440, body });
  const side = body.querySelector(".side-list");
  const main = body.querySelector("#settings-main");
  renderSettings(main, "update");
  side.addEventListener("click", (ev) => {
    const it = ev.target.closest(".side-item"); if (!it) return;
    side.querySelectorAll(".side-item").forEach(x => x.classList.remove("active"));
    it.classList.add("active");
    renderSettings(main, it.dataset.pane);
  });
}
function renderSettings(main, pane) {
  main.dataset.pane = pane;
  if (pane === "update") {
    main.innerHTML = `
      <h2>Software Update</h2>
      <div class="card">
        <div class="card-title">macOS Update Available</div>
        <div class="card-desc">Version 15.2 — security &amp; performance improvements.</div>
        <button class="btn primary" id="start-update">Update Now</button>
        <button class="btn" id="scan-now" style="margin-left:6px;">Scan for Issues</button>
        <div id="upanel" style="display:none;">
          <div class="win-progress-wrap"><div class="win-progress" id="ufill"></div></div>
          <div class="win-progress-status" id="ustatus">Preparing… 0%</div>
        </div>
      </div>`;
    main.querySelector("#start-update").addEventListener("click", () => runUpdate(main, false));
    main.querySelector("#scan-now").addEventListener("click", () => runUpdate(main, true));
  } else if (pane === "display") {
    main.innerHTML = `
      <h2>Displays</h2>
      <div class="card">
        <div class="card-title">Brightness</div>
        <div class="card-desc">Dim the display to save energy.</div>
        <button class="btn" id="btn-dim">${state.isDimmed ? "Restore Brightness" : "Dim Display"}</button>
      </div>
      <div class="card">
        <div class="card-title">Sleep</div>
        <div class="card-desc">Put the display to sleep. The machine will remain on.</div>
        <button class="btn primary" id="btn-sleep">Sleep Display</button>
      </div>`;
    main.querySelector("#btn-dim").addEventListener("click", () => toggleDim(main));
    main.querySelector("#btn-sleep").addEventListener("click", sleepDisplay);
  } else if (pane === "storage") {
    const used = state.diskUsedPct;
    const usedGB = (used / 100) * 500;
    const installedApps = APPS.filter(a => a.id && !state.uninstalled.has(a.id));
    main.innerHTML = `
      <h2>Storage</h2>
      <div class="card">
        <div class="card-title">Macintosh HD — ${usedGB.toFixed(1)} GB of 500 GB used</div>
        <div class="card-desc">${used > 88 ? "You're almost out of space. Uninstall apps you don't need to free up space." : "Storage levels are normal."}</div>
        <div class="progress-track" style="margin-top:0;"><div class="progress-fill" style="width:${used}%; background:${used>90?'var(--a-red)':used>75?'#f0a500':'var(--a-blue)'};"></div></div>
      </div>
      <div class="card">
        <div class="card-title">Applications</div>
        <div class="card-desc">Click an application to remove it from this Mac.</div>
        <div id="storage-apps" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
          ${installedApps.map(a => `
            <div class="storage-row" data-app="${a.id}">
              <div class="storage-glyph">${DOCK_SVG[a.id] || ""}</div>
              <div class="storage-name">${a.label}</div>
              <div class="storage-size">${a.sizeGB.toFixed(1)} GB</div>
              ${a.removable ? `<button class="btn danger storage-rm" data-app="${a.id}">Uninstall</button>` : `<button class="btn" disabled>Required</button>`}
            </div>`).join("")}
        </div>
      </div>`;
    main.querySelectorAll(".storage-rm").forEach(b => {
      b.addEventListener("click", () => confirmUninstall(b.dataset.app));
    });
  } else if (pane === "battery") {
    main.innerHTML = `<h2>Battery</h2><div class="card"><div class="card-title">${battery}%</div><div class="card-desc">Your Mac will sleep when the battery is low.</div></div>`;
  } else {
    main.innerHTML = `<h2>General</h2><div class="card"><div class="card-desc">Settings placeholder.</div></div>`;
  }
}
function runUpdate(main, scan) {
  const panel = main.querySelector("#upanel"); panel.style.display = "block";
  const fill = main.querySelector("#ufill"), st = main.querySelector("#ustatus");
  const totalCells = 22;
  fill.innerHTML = Array.from({length: totalCells}, () => `<div class="win-progress-cell"></div>`).join("");
  const cells = fill.querySelectorAll(".win-progress-cell");
  const t0 = now(), dur = scan ? 4500 : 6500;
  const steps = scan ? ["Scanning…","Indexing…","Verifying…","Complete."]
                     : ["Preparing…","Downloading…","Installing…","Verifying…","Finalising…"];
  doAction("A", scan ? "antivirus" : "defrag", {});
  const tick = () => {
    const k = clamp((now() - t0) / dur, 0, 1);
    const filled = Math.floor(k * totalCells);
    cells.forEach((c, i) => c.classList.toggle("on", i < filled));
    const stepLabel = steps[Math.min(steps.length - 1, Math.floor(k * steps.length))];
    st.textContent = `${stepLabel}  ${Math.round(k * 100)}%`;
    if (k < 1) requestAnimationFrame(tick);
    else {
      st.textContent = scan ? "Scan complete. No threats found." : "Update complete.";
      setTimeout(() => {
        const panel = main.querySelector("#upanel");
        if (panel) panel.style.display = "none";
      }, 900);
    }
  };
  requestAnimationFrame(tick);
}
function toggleDim(main) {
  state.isDimmed = !state.isDimmed;
  sleepEl.classList.toggle("dim", state.isDimmed);
  doAction("A", "dim", { dimmed: state.isDimmed });
  renderSettings(main, "display");
}
function sleepDisplay() {
  if (state.isAsleep) return;
  state.isAsleep = true;
  sleepEl.classList.add("sleep");
  doAction("A", "sleep", { asleep: true });
  setTimeout(() => {
    const wake = () => {
      state.isAsleep = false;
      sleepEl.classList.remove("sleep");
      doAction("A", "sleep", { asleep: false });
      document.removeEventListener("mousedown", wake);
      document.removeEventListener("keydown", wake);
    };
    document.addEventListener("mousedown", wake);
    document.addEventListener("keydown", wake);
  }, 800);
}

// ── Trash ──────────────────────────────────────────────────────────────────
function openTrash() {
  const body = document.createElement("div");
  body.className = "trash-body";
  body.innerHTML = `
    <div class="trash-head">
      <h2>Trash</h2>
      <button class="btn dangerSolid" id="empty-trash">Empty</button>
    </div>
    <div class="trash-list" id="trash-list"></div>`;
  createWindow({ id: "trash", title: "Trash", width: 440, height: 320, body });
  body.querySelector("#empty-trash").addEventListener("click", confirmEmptyTrash);
  renderTrashWindow();
}
function renderTrashWindow() {
  const win = openWindows.trash; if (!win) return;
  const list = win.body.querySelector("#trash-list");
  const btn  = win.body.querySelector("#empty-trash");
  if (state.trash.length === 0) {
    list.innerHTML = `<div class="trash-empty-msg">Trash is empty.</div>`; btn.disabled = true; return;
  }
  btn.disabled = false; list.innerHTML = "";
  for (const id of state.trash) {
    const e = state.entities.get(id); if (!e) continue;
    const row = document.createElement("div"); row.className = "trash-row";
    row.innerHTML = `
      <span class="row-icon">${iconSVG(e.kind)}</span>
      <span>${e.name}</span><span style="text-align:right;color:#8a8a8a">${e.sizeMB} MB</span>`;
    list.appendChild(row);
  }
}
function confirmEmptyTrash() {
  if (state.trash.length === 0) return;
  showModal({
    icon: "err",
    title: "Empty the Trash?",
    msg: `Are you sure you want to permanently erase the ${state.trash.length} item${state.trash.length === 1 ? "" : "s"} in the Trash? You can't undo this action.`,
    buttons: [{ label: "Cancel" }, { label: "Empty Trash", style: "danger", on: emptyTrash }],
  });
}
function emptyTrash() {
  const ids = state.trash.slice();
  state.trash = []; state.cleanedCount += ids.length;
  state.diskUsedPct = Math.max(32, state.diskUsedPct - ids.length * 4);
  for (const id of ids) {
    const e = state.entities.get(id); if (e) e.alive = false;
  }
  updateTrashBadge();
  if (openWindows.trash) renderTrashWindow();
  if (openWindows.finder) renderFinderList();
  doAction("A", "emptytrash", { count: ids.length });
}

// ── Activity Monitor ───────────────────────────────────────────────────────
function openActivity(opts = {}) {
  const isRunaway = opts.runaway || false;
  const procs = [
    { name: "kernel_task",            cpu: rand(2, 8),   mem: rand(180, 240), runaway: false },
    { name: "WindowServer",           cpu: rand(3, 9),   mem: rand(110, 180), runaway: false },
    { name: "Safari",                 cpu: rand(0, 6),   mem: rand(220, 540), runaway: false },
    { name: "Finder",                 cpu: rand(0, 4),   mem: rand(60, 110),  runaway: false },
    { name: "mds_stores",             cpu: rand(0, 12),  mem: rand(50, 110),  runaway: false },
    { name: "_systemupdate_helperd",  cpu: 88 + rand(0,8), mem: rand(900, 1400), runaway: !!isRunaway },
  ];
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="am-list">
      <div class="am-row header"><span>Process</span><span>CPU %</span><span>Mem (MB)</span><span>Action</span></div>
      ${procs.map(p => `
        <div class="am-row${p.runaway ? " runaway" : ""}">
          <span class="name">${p.name}</span>
          <span class="cpu">${p.cpu.toFixed(1)}</span>
          <span class="cpu">${Math.round(p.mem)}</span>
          <span><button class="am-quit" data-name="${p.name}" ${p.runaway ? "" : "disabled"}>${p.runaway ? "Force Quit" : "—"}</button></span>
        </div>`).join("")}
    </div>`;
  createWindow({ id: "activity", title: "Activity Monitor", width: 540, height: 320, body });
  body.querySelectorAll(".am-quit").forEach(b => {
    b.addEventListener("click", () => {
      if (b.disabled) return;
      b.disabled = true; b.textContent = "Quitting…";
      bigEventStep("A", "kill-runaway", { name: b.dataset.name });
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  MODALS · NOTIFICATIONS · WIN-95 ERRORS
// ═════════════════════════════════════════════════════════════════════════════
function showModal({ icon = "warn", title, msg, buttons }) {
  closeContextMenu();
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";
  scrim.innerHTML = `
    <div class="modal">
      <div class="modal-icon ${icon}">${icon === "info" ? "ⓘ" : "⚠"}</div>
      <div class="modal-title">${title}</div>
      <div class="modal-msg">${msg}</div>
      <div class="modal-actions"></div>
    </div>`;
  const actions = scrim.querySelector(".modal-actions");
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.textContent = b.label;
    if (b.style) btn.classList.add(b.style);
    btn.addEventListener("click", () => { scrim.remove(); b.on?.(); });
    actions.appendChild(btn);
  }
  desktopEl.appendChild(scrim);
  return scrim;
}

let activeNotifs = [];
/** Delay between spawn i and i+1 in an escalating burst (starts slow, ends fast). */
function msBetweenSpawn(i) {
  return Math.max(18, Math.round(540 * Math.pow(0.64, i)));
}
/** Faster cascade for browser-issue waves (tighter than default). */
function msBetweenSpawnFast(i) {
  return Math.max(6, Math.round(130 * Math.pow(0.48, i)));
}
/** Second browser wave: 2× spacing between errors vs `msBetweenSpawnFast`. */
function msBetweenSpawnSlow(i) {
  return msBetweenSpawnFast(i) * 2;
}
/** Queue many notifications with increasing spawn rate (same curve as error cascade). */
function notifyBurstEscalating(kind, titleBase, msg, count, ttl = 4200) {
  let acc = 0;
  for (let i = 0; i < count; i++) {
    setTimeout(() => notify(kind, `${titleBase} · ${i + 1}`, msg, ttl), acc);
    if (i < count - 1) acc += msBetweenSpawn(i);
  }
}

function notify(kind, title, msg, ttl = 4200) {
  const el = document.createElement("div");
  el.className = `notif kind-${kind}`;
  el.innerHTML = `
    <div class="notif-ic">${kind === "info" ? "ⓘ" : kind === "mystery" ? "✿" : "⚠"}</div>
    <div class="notif-body"><div class="notif-title">${title}</div><div class="notif-msg">${msg}</div></div>
    <button class="notif-close">×</button>`;
  el.style.top = `${36 + activeNotifs.length * 72}px`;
  el.querySelector(".notif-close").addEventListener("click", () => removeNotif(el));
  desktopEl.appendChild(el);
  activeNotifs.push(el);
  setTimeout(() => removeNotif(el), ttl);
}
function removeNotif(el) {
  const i = activeNotifs.indexOf(el); if (i !== -1) activeNotifs.splice(i, 1);
  el.remove();
  activeNotifs.forEach((n, idx) => n.style.top = `${36 + idx * 72}px`);
}

// Garden-side toast — small pill across the top of Player B. Used for
// "water the plants" / "wilting" / "wind storm" notifications.
const activeBNotifs = [];
function notifyB(kind, title, msg, ttl = 5000) {
  const wrap = document.getElementById("b-notif-stack") || (() => {
    const w = document.createElement("div");
    w.id = "b-notif-stack";
    w.style.cssText = "position:absolute;top:60px;left:50%;transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;";
    document.getElementById("playerB").appendChild(w);
    return w;
  })();
  // De-duplicate by title (don't spam the same alert)
  if (activeBNotifs.some(n => n.dataset.title === title)) return;
  const el = document.createElement("div");
  el.dataset.title = title;
  el.style.cssText = `
    pointer-events:auto;
    display:flex;align-items:center;gap:10px;
    background:rgba(8,10,12,0.92);
    border:1px solid ${kind === "warn" ? "rgba(255,80,60,0.65)" : "rgba(255,255,255,0.18)"};
    padding:7px 14px;border-radius:999px;
    font-family:var(--mono);font-size:11px;letter-spacing:0.16em;text-transform:uppercase;
    color:${kind === "warn" ? "#ffb6b0" : "#dcdcdc"};
    box-shadow:0 8px 20px rgba(0,0,0,0.4);`;
  el.innerHTML = `
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${kind === "warn" ? "#ff3b30" : "#79e88c"};"></span>
    <strong style="font-weight:600">${title}</strong>
    <span style="opacity:0.65;text-transform:none;letter-spacing:0;font-family:var(--sans);font-size:11px">${msg}</span>
    <span style="opacity:0.5;cursor:pointer;margin-left:6px" data-bclose>×</span>`;
  wrap.appendChild(el);
  activeBNotifs.push(el);
  const dismiss = () => { el.remove(); const i = activeBNotifs.indexOf(el); if (i !== -1) activeBNotifs.splice(i, 1); };
  el.querySelector("[data-bclose]").addEventListener("click", dismiss);
  setTimeout(dismiss, ttl);
}

// ── Win-95 stacked error popups ────────────────────────────────────────────
let winErrorIndex = 0;

/** Drag Win-95 popups by title bar (single global listener — safe for cascades). */
let winDragActive = null;
(function wireWinDragGlobals() {
  if (window.__winDragGlobals) return;
  window.__winDragGlobals = true;
  window.addEventListener("mousemove", (e) => {
    if (!winDragActive) return;
    const { root, containerEl, sx, sy, baseLeft, baseTop } = winDragActive;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    root.style.left = `${baseLeft + dx}px`;
    root.style.top = `${baseTop + dy}px`;
  });
  window.addEventListener("mouseup", () => { winDragActive = null; });
})();

function attachWinDrag(root, containerEl = errorStack) {
  const handle = root.querySelector(".win-bar");
  if (!handle || root.dataset.dragBound) return;
  root.dataset.dragBound = "1";
  handle.classList.add("win-drag-handle");
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".x")) return;
    const rr = root.getBoundingClientRect();
    const cr = containerEl.getBoundingClientRect();
    winDragActive = {
      root,
      containerEl,
      sx: e.clientX,
      sy: e.clientY,
      baseLeft: rr.left - cr.left,
      baseTop: rr.top - cr.top,
    };
    root.dataset.dragged = "1";
    root.style.transform = "none";
    e.preventDefault();
  });
}

function showWinError(opts = {}) {
  const title = opts.title ?? "Internal Error";
  const msg   = opts.msg   ?? "I don't know what's wrong.";
  const i = opts.stackIndex ?? 0;
  const vx = opts.stepX ?? -14;
  const vy = opts.stepY ?? 17;
  winErrorIndex++;
  const root = document.createElement("div");
  root.className = "win-error win-error-spawn";
  const stackRect = errorStack.getBoundingClientRect();
  const r = viewportA.getBoundingClientRect();
  const baseX = opts.baseX ?? (r.left + r.width * (vx >= 0 ? 0.38 : 0.06));
  const baseY = opts.baseY ?? (r.top + r.height * 0.14);
  root.style.left = `${baseX - stackRect.left + vx * i}px`;
  root.style.top  = `${baseY - stackRect.top + vy * i}px`;
  root.innerHTML = `
    <div class="win-bar"><span>${title}</span><span class="x">×</span></div>
    <div class="win-body"><div class="win-icon"></div><div class="win-msg">${msg}</div></div>
    <div class="win-actions"><button class="win-ok">OK</button></div>`;
  errorStack.appendChild(root);
  attachWinDrag(root);
  const dismiss = () => root.remove();
  root.querySelector(".x").addEventListener("click", dismiss);
  root.querySelector(".win-ok").addEventListener("click", dismiss);
  return root;
}

/** Many errors spawn with accelerating rhythm; each cascade goes randomly LD or RD. */
function showWinErrorEscalating(count = 11, msgs = null, onComplete = null, delayFn = msBetweenSpawn) {
  const defaults = [
    "I don't know what's wrong.",
    "An unexpected condition was encountered.",
    "A required component could not be loaded.",
    "Operation could not be completed.",
    "Kernel driver reported an exception.",
    "System extension blocked.",
    "Please contact your system administrator.",
    "The application has stopped responding.",
    "Memory pressure is critically high.",
    "Could not save document changes.",
    "CoreAudio routing failed.",
    "Graphics subsystem encountered an error.",
    "Network peer disconnected unexpectedly.",
    "Disk sleep assertion timed out.",
  ];
  const rd = Math.random() < 0.5;
  const vx = rd ? 14 : -14;
  const vy = 17;
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const idx = i;
    setTimeout(() => {
      showWinError({
        msg: msgs?.[idx] ?? defaults[idx % defaults.length],
        stackIndex: idx,
        stepX: vx,
        stepY: vy,
      });
      if (idx === count - 1 && typeof onComplete === "function") {
        setTimeout(onComplete, 420);
      }
    }, acc);
    if (i < count - 1) acc += delayFn(i);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  CURSOR SYSTEM
//  - normal     : cursor follows mouse 1:1
//  - lag        : cursor follows live mouse 1:1, BUT every ~55 ms drops a
//                 ghost arrow at the live position. Ghosts stay at full
//                 size, fade over ~4.5 s, then disappear completely.
//  - rubberband : ONLY the live cursor — sinusoidal jitter, no ghost trail
//  - spin       : busy spinner. Click-block scrim disables clicks while up.
//  - rainbow    : rainbow spinner. Same click-block.
// ═════════════════════════════════════════════════════════════════════════════
const cursorBlockEl = $("#cursor-block");
let cursorTarget = { x: 0, y: 0 };
let cursorPos    = { x: 0, y: 0 };
let cursorRubber = 0;
let cursorEffectUntil = 0;
let cursorEffect = "normal";
let lastTrailDrop = 0;

viewportA.addEventListener("mousemove", (ev) => {
  const r = viewportA.getBoundingClientRect();
  cursorTarget.x = ev.clientX - r.left;
  cursorTarget.y = ev.clientY - r.top;
});

function setCursorEffect(kind, durMs) {
  cursorEffect = kind;
  cursorEl.classList.remove("lag", "spin", "rainbow");
  state.cursorMode = kind;
  if (kind === "lag")           { cursorRubber = 0; }
  else if (kind === "rubberband") { cursorRubber = 1; }
  else if (kind === "spin")    cursorEl.classList.add("spin");
  else if (kind === "rainbow") cursorEl.classList.add("rainbow");
  else if (kind === "freeze")  cursorEl.classList.add("rainbow");
  else { cursorRubber = 0; }

  // Loading wheel + rainbow wheel: block clicks on apps and notifications.
  // We do this with a transparent fullscreen scrim sitting under the cursor.
  const blocking = (kind === "spin" || kind === "rainbow" || kind === "freeze");
  cursorBlockEl.classList.toggle("hidden", !blocking);
  document.body.classList.toggle("wheel-active", blocking);

  cursorEffectUntil = now() + durMs;
}

function dropCursorTrail() {
  const ghost = document.createElement("div");
  ghost.className = "cursor-trail";
  ghost.style.left = `${cursorTarget.x}px`;
  ghost.style.top  = `${cursorTarget.y}px`;
  viewportA.appendChild(ghost);
  // remove a hair after the CSS animation duration (4.6s in styles)
  setTimeout(() => ghost.remove(), 4700);
}

function updateCursorPosition(dt) {
  // cursor itself follows live mouse 1:1 in every mode (no visual lag on it).
  cursorPos.x = cursorTarget.x;
  cursorPos.y = cursorTarget.y;
  let wx = 0, wy = 0;
  if (cursorRubber > 0 && cursorEffect === "rubberband") {
    const t = now() / 180;
    wx = Math.sin(t) * 14;
    wy = Math.cos(t * 1.13) * 8;
  }
  cursorEl.style.left = `${cursorPos.x + wx}px`;
  cursorEl.style.top  = `${cursorPos.y + wy}px`;

  // Ghost arrow stack: ONLY during lag (rubberband no longer drops trails).
  if (cursorEffect === "lag") {
    if (now() - lastTrailDrop > 55) { dropCursorTrail(); lastTrailDrop = now(); }
  }

  if (cursorEffect !== "normal" && now() > cursorEffectUntil) setCursorEffect("normal", 0);
}

// ═════════════════════════════════════════════════════════════════════════════
//  LEAK EFFECTS
// ═════════════════════════════════════════════════════════════════════════════
function leakOnA() {
  const r = Math.random();
  if (r < 0.5) {
    const layer = document.createElement("div"); layer.className = "leak-green";
    leaksAEl.appendChild(layer);
    setTimeout(() => layer.remove(), 1700);
  } else if (r < 0.8) {
    for (let i = 0; i < 4; i++) {
      const dot = document.createElement("div"); dot.className = "pollen-mote";
      const sx = Math.random() * viewportA.clientWidth;
      const sy = Math.random() * viewportA.clientHeight;
      dot.style.left = `${sx}px`; dot.style.top = `${sy}px`;
      dot.style.setProperty("--mx", `${(Math.random() - 0.5) * 200}px`);
      dot.style.setProperty("--my", `${-100 - Math.random() * 200}px`);
      leaksAEl.appendChild(dot);
      setTimeout(() => dot.remove(), 4400);
    }
  } else {
    const live = [...state.entities.values()].filter(e => e.dom);
    if (live.length) {
      const e = pick(live);
      e.dom.classList.add("leak-leaf");
      setTimeout(() => e.dom?.classList.remove("leak-leaf"), 700);
    }
  }
}

function leakOnB() {
  // brief screen scanline flicker (handled in animate loop with sceneFlash)
  sceneFlashPulse(0.18);
}

// ═════════════════════════════════════════════════════════════════════════════
//  PLAYER B  ·  THREE.JS
// ═════════════════════════════════════════════════════════════════════════════
const viewportB = $("#playerB");
const bigBEl    = $("#big-event-b");

const rendererB = new THREE.WebGLRenderer({ antialias: true, alpha: false });
rendererB.setPixelRatio(Math.min(window.devicePixelRatio, 2));
rendererB.setClearColor(0x000000, 1);
rendererB.toneMapping = THREE.ACESFilmicToneMapping;
rendererB.toneMappingExposure = 1.22;
viewportB.appendChild(rendererB.domElement);

const sceneB = new THREE.Scene();
// Pitch-black void, dense fog drops everything > a few units away to black.
// Slightly warm fog so the void reads sepia-black (refs), not pure RGB zero.
sceneB.fog = new THREE.FogExp2(0x0d0a08, 0.046);

const cameraB = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
cameraB.position.set(0, 2.6, 6.6);

const orbit = new OrbitControls(cameraB, rendererB.domElement);
orbit.target.set(0, 0.7, 0);
orbit.enablePan = false;
orbit.enableZoom = false;
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.rotateSpeed = 0.45;
orbit.minPolarAngle = Math.PI * 0.22;
orbit.maxPolarAngle = Math.PI * 0.58;
orbit.update();

// Lighting:
//   - very faint warm ambient so meshes aren't fully black at the back
//   - no green hemisphere (the previous "weird green" cast)
//   - the glowing screen behind acts as the dominant directional light
//   - small point lights baked into bioluminescent flowers via emissive
// Very low ambient — the "void" is dark.
sceneB.add(new THREE.AmbientLight(0x354842, 0.82));
const FALSE_SUN_POS = new THREE.Vector3(0, 2.8, -5.0);

// Wide spotlight from the screen, so the platform AND all the plants
// (including the back row of trees) are lit, but the cone is short so it
// doesn't reach the back wall.
const falseSunLight = new THREE.SpotLight(0xfff8f0, 17.0, 16.2, Math.PI / 2.6, 0.68, 1.0);
falseSunLight.position.copy(FALSE_SUN_POS).add(new THREE.Vector3(0, 0, 0.3));
falseSunLight.target.position.set(0, 0.4, 1.0);
sceneB.add(falseSunLight, falseSunLight.target);

// Front fill — closer, brighter — lifts the back-side of every plant
// so the canopy reads as foliage instead of a black silhouette.
const fillFront = new THREE.PointLight(0xe8fad8, 3.05, 11, 1.25);
fillFront.position.set(0, 1.55, 5.2);
sceneB.add(fillFront);
const fillUnder = new THREE.PointLight(0xa8ffc8, 1.35, 8.5, 1.35);
fillUnder.position.set(0, 0.65, 0.35);
sceneB.add(fillUnder);
// Extra lift — biased toward the garden floor/plants so foliage “radiates”
const gardenGlow = new THREE.PointLight(0x8dffaa, 0.72, 7.5, 1.5);
gardenGlow.position.set(0, 1.05, 0.8);
sceneB.add(gardenGlow);
// Soft violet side-fill — theatrical “spot” mood without washing the grass.
const accentPurple = new THREE.PointLight(0x9977dd, 0.42, 16, 2);
accentPurple.position.set(3.4, 2.35, 3.1);
sceneB.add(accentPurple);

// ── False sun = glowing white TV screen ────────────────────────────────────
function makeWhiteScreenTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 288;
  const g = c.getContext("2d");
  // Uniform fill — no radial gradient (that read as a circular “hot spot” on the mesh).
  g.fillStyle = "#cfd8e0";
  g.fillRect(0, 0, c.width, c.height);
  // very subtle horizontal scan striping only
  for (let y = 0; y < c.height; y += 2) {
    g.fillStyle = "rgba(0,0,0,0.022)";
    g.fillRect(0, y, c.width, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
const screenTex = makeWhiteScreenTexture();
const SCREEN_W = 7.2, SCREEN_H = 4.1;
const screenGroup = new THREE.Group();
screenGroup.position.copy(FALSE_SUN_POS);
sceneB.add(screenGroup);
// View-aware “glass TV”: grazing angles get a small fresnel boost (not a radial texture).
// Glow tuning (see also bloomPass below):
//   uBase     — overall screen brightness (also drives how much hits bloom)
//   uFresnel  — extra brightness at oblique viewing angles (perimeter of panel in 3D)
//   uSheen    — subtle glossy highlight at grazing angles
//   uDim      — sleep/dim multiplier (animated)
const screenMat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: screenTex },
    uDim: { value: 1.0 },
    uBase: { value: 0.90 },
    uFresnel: { value: 0.38 },
    uSheen: { value: 0.08 },
    uCamPos: { value: new THREE.Vector3() },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D map;
    uniform float uDim;
    uniform float uBase;
    uniform float uFresnel;
    uniform float uSheen;
    uniform vec3 uCamPos;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec3 n = normalize(vWorldNormal);
      vec3 v = normalize(uCamPos - vWorldPos);
      float ndv = clamp(dot(n, v), 0.001, 1.0);
      float edge = pow(1.0 - ndv, 2.05);
      vec3 tex = texture2D(map, vUv).rgb;
      vec3 base = tex * uBase * uDim;
      base *= 1.0 + edge * uFresnel;
      float sheen = pow(1.0 - ndv, 4.5) * uSheen * uDim;
      gl_FragColor = vec4(base + vec3(sheen), 1.0);
    }`,
  toneMapped: false,
});
const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMat);
screenGroup.add(screenMesh);
window.__screenMat = screenMat;
(function bezel() {
  const m = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const t = 0.10; const fw = SCREEN_W + t * 2, fh = SCREEN_H + t * 2;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(fw, t), m);
  const bot = new THREE.Mesh(new THREE.PlaneGeometry(fw, t), m);
  const lf  = new THREE.Mesh(new THREE.PlaneGeometry(t, SCREEN_H), m);
  const rt  = new THREE.Mesh(new THREE.PlaneGeometry(t, SCREEN_H), m);
  top.position.set(0,  SCREEN_H/2 + t/2, -0.01); bot.position.set(0, -SCREEN_H/2 - t/2, -0.01);
  lf.position.set(-SCREEN_W/2 - t/2, 0, -0.01); rt.position.set( SCREEN_W/2 + t/2, 0, -0.01);
  screenGroup.add(top, bot, lf, rt);
})();
(function halo() {
  // Very tight halo — only around the screen edge so the wall stays
  // pitch black even with bloom. The bloom pass then adds the soft
  // glowing fringe naturally.
  const m1 = new THREE.MeshBasicMaterial({ color: 0xe8f2fa, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const h1 = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W * 1.10, SCREEN_H * 1.12), m1); h1.position.z = -0.02;
  screenGroup.add(h1);
})();
const scanlineTex = (function () {
  const c = document.createElement("canvas"); c.width = 4; c.height = 512;
  const g = c.getContext("2d");
  for (let y = 0; y < 512; y += 2) {
    g.fillStyle = y % 4 === 0 ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.18)";
    g.fillRect(0, y, 4, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 80);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const scanlineMat = new THREE.MeshBasicMaterial({ map: scanlineTex, transparent: true, opacity: 0.18, toneMapped: false });
const scanlineMesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), scanlineMat);
scanlineMesh.position.z = 0.01;
screenGroup.add(scanlineMesh);

// Generous black backdrop + side wings so the entire frame around the
// glowing screen reads as a solid pitch-black wall.
(function backdropWall() {
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), wallMat);
  wall.position.copy(FALSE_SUN_POS);
  wall.position.z -= 0.6;       // sits behind the screen
  sceneB.add(wall);
  // a floor wing to absorb stray bloom landing near the back
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const floorBack = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), floorMat);
  floorBack.rotation.x = -Math.PI / 2;
  floorBack.position.set(0, -1.2, -8);
  sceneB.add(floorBack);
})();

// ── Platform tiles (mossy ground) ──────────────────────────────────────────
const PLATFORM_W = 9.5, PLATFORM_D = 6.5, TILE_SIZE = 0.55;
const COLS = Math.round(PLATFORM_W / TILE_SIZE);
const ROWS = Math.round(PLATFORM_D / TILE_SIZE);
function makeMossTex() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  // Brighter, more vibrant mossy base
  g.fillStyle = "#3a6f3e"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const l = 22 + Math.random() * 30;
    g.fillStyle = `hsl(${95 + Math.random() * 28}, ${35 + Math.random() * 30}%, ${l}%)`;
    g.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 1 + Math.random() * 3.2;
    g.fillStyle = `hsla(${95 + Math.random() * 24}, 58%, ${36 + Math.random() * 18}%, 0.82)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // a few brighter grass-tip flecks for highlights
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    g.fillStyle = `hsla(${85 + Math.random() * 12}, 80%, 65%, 0.5)`;
    g.fillRect(x, y, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const mossTex = makeMossTex();
const groundTiles = [];
// Two-octave noise — gentle hills so the ground undulates without
// breaking plant placement.
function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.55 + 1.3) * 0.06 +
    Math.cos(z * 0.45 - 0.8) * 0.05 +
    Math.sin(x * 1.35 + z * 0.9) * 0.025
  );
}
(function buildPlatform() {
  // Tiles overlap by a hair (1.04) so the seams between them disappear.
  const tileGeo = new THREE.BoxGeometry(TILE_SIZE * 1.04, 0.4, TILE_SIZE * 1.04);
  const tileMat = new THREE.MeshStandardMaterial({
    map: mossTex, color: 0xc8e2a8, roughness: 0.92, metalness: 0,
    emissive: 0x4a9040, emissiveIntensity: 0.98,
  });
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const m = new THREE.Mesh(tileGeo, tileMat.clone());
    const x = (c - (COLS - 1) / 2) * TILE_SIZE, z = (r - (ROWS - 1) / 2) * TILE_SIZE;
    const yBase = -0.2 + terrainHeight(x, z);
    m.position.set(x, yBase, z);
    sceneB.add(m);
    groundTiles.push({ mesh: m, col: c, row: r, alive: true, originalY: yBase });
  }
})();
function platformY(x, z) {
  return terrainHeight(x, z); // ground top relative to y=0
}

// Tapered grass blade — wider at base, narrows to a point.
function makeBladeGeo(h = 0.32) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.045, 0);
  shape.lineTo( 0.045, 0);
  shape.quadraticCurveTo(0.032, h * 0.32, 0.014, h * 0.65);
  shape.quadraticCurveTo(0.000, h, -0.014, h * 0.65);
  shape.quadraticCurveTo(-0.032, h * 0.32, -0.045, 0);
  return new THREE.ShapeGeometry(shape);
}

// Big tuft grass — taller, in concentrated clumps. Big visual impact.
function addGrass(n = 600) {
  const bladeGeo = makeBladeGeo(0.42);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8edc78, emissive: 0x5ea848, emissiveIntensity: 1.28,
    roughness: 1, side: THREE.DoubleSide, transparent: true, alphaTest: 0.1,
  });
  const mesh = new THREE.InstancedMesh(bladeGeo, mat, n);
  const d = new THREE.Object3D();
  const clumps = 60;
  let i = 0;
  for (let c = 0; c < clumps && i < n; c++) {
    const cx = (Math.random() - 0.5) * (PLATFORM_W - 0.4);
    const cz = (Math.random() - 0.5) * (PLATFORM_D - 0.4);
    const radius = 0.30 + Math.random() * 0.40;       // larger clump radius
    const blades = 8 + Math.floor(Math.random() * 10); // more blades per clump
    for (let b = 0; b < blades && i < n; b++, i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const ox = Math.cos(a) * r;
      const oz = Math.sin(a) * r;
      const px = cx + ox, pz = cz + oz;
      d.position.set(px, platformY(px, pz), pz);
      d.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
      const s = 0.7 + Math.random() * 0.8;
      d.scale.setScalar(s);
      d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
    }
  }
  while (i < n) {
    const px = (Math.random() - 0.5) * (PLATFORM_W - 0.3);
    const pz = (Math.random() - 0.5) * (PLATFORM_D - 0.3);
    d.position.set(px, platformY(px, pz), pz);
    d.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    d.scale.setScalar(0.6 + Math.random() * 0.5);
    d.updateMatrix(); mesh.setMatrixAt(i++, d.matrix);
  }
  sceneB.add(mesh);
  mesh.userData.isGardenGrass = true;
  return mesh;
}
const grassMesh = addGrass();

// GROUND COVER — a much denser layer of small blades carpeting the entire
// platform. This both fills gaps between bigger plants and visually
// blends across the tile seams (it doesn't follow tile boundaries).
function addGroundCover(n = 1400) {
  const bladeGeo = makeBladeGeo(0.18);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6bbd62, emissive: 0x366830, emissiveIntensity: 0.72,
    roughness: 1, side: THREE.DoubleSide, transparent: true, alphaTest: 0.1,
  });
  const mesh = new THREE.InstancedMesh(bladeGeo, mat, n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const px = (Math.random() - 0.5) * (PLATFORM_W - 0.05);
    const pz = (Math.random() - 0.5) * (PLATFORM_D - 0.05);
    d.position.set(px, platformY(px, pz), pz);
    d.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
    d.scale.setScalar(0.45 + Math.random() * 0.55);
    d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
  }
  sceneB.add(mesh);
  return mesh;
}
const groundCoverMesh = addGroundCover();

// Compost pile (back-right corner)
const compostPile = (function () {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c2014, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + Math.random() * 0.12, 0), mat);
    c.position.set((Math.random() - 0.5) * 0.5, Math.random() * 0.18, (Math.random() - 0.5) * 0.5);
    g.add(c);
  }
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xa28238, side: THREE.DoubleSide, transparent: true, alphaTest: 0.1 });
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.12), leafMat);
    l.position.set((Math.random() - 0.5) * 0.6, 0.18 + Math.random() * 0.12, (Math.random() - 0.5) * 0.6);
    l.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(l);
  }
  g.position.set(PLATFORM_W / 2 - 0.7, 0, -PLATFORM_D / 2 + 0.7);
  g.userData.isCompost = true;
  sceneB.add(g);
  return g;
})();

// ═════════════════════════════════════════════════════════════════════════════
//  PLANT MESHES (more variety, real flowers, bioluminescent accents)
// ═════════════════════════════════════════════════════════════════════════════
// Low-poly tree — trunk with several branch ends, foliage canopy made
// from 5–7 clustered flat-shaded ico balls (matches reference).
function makeTreeMesh(scale = 1) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x8a8a90, roughness: 0.95, flatShading: true,
    emissive: 0x3a3028, emissiveIntensity: 0.38,
  });
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07 * scale, 0.13 * scale, 1.1 * scale, 6),
    trunkMat
  );
  trunk.position.y = 0.55 * scale; g.add(trunk);
  // a couple of slanted branch stubs
  for (let i = 0; i < 2; i++) {
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035 * scale, 0.05 * scale, 0.45 * scale, 5),
      trunkMat
    );
    branch.position.set((i ? 0.15 : -0.18) * scale, 0.85 * scale, (i ? 0.10 : -0.05) * scale);
    branch.rotation.z = (i ? -0.7 : 0.7);
    branch.rotation.y = Math.random() * Math.PI;
    g.add(branch);
  }
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x8ad078, roughness: 0.85, flatShading: true,
    emissive: 0x5a5038, emissiveIntensity: 0.58,
  });
  // 6 clustered icos around the canopy crown
  const offsets = [
    [ 0.00, 1.30,  0.00, 0.55],
    [ 0.36, 1.10,  0.05, 0.40],
    [-0.34, 1.15, -0.05, 0.42],
    [ 0.10, 1.55,  0.20, 0.36],
    [-0.18, 1.45, -0.18, 0.36],
    [ 0.20, 1.25, -0.30, 0.34],
    [-0.22, 1.30,  0.30, 0.34],
  ];
  for (const [px, py, pz, r] of offsets) {
    const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 0), foliageMat);
    ico.position.set(px * scale, py * scale, pz * scale);
    ico.rotation.set(Math.random(), Math.random(), Math.random());
    ico.userData.isFoliage = true;
    g.add(ico);
  }
  return g;
}

// Big chunky bush — 7–9 clustered shapes, lit & varied.
function makeBushMesh(scale = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7fbe6c, roughness: 0.9, flatShading: true,
    emissive: 0x3e6e3a, emissiveIntensity: 0.95,
  });
  const matLight = mat.clone();
  matLight.color = new THREE.Color(0xa1d889);
  matLight.emissive = new THREE.Color(0x4a8045);
  const count = 8;
  for (let i = 0; i < count; i++) {
    const s = (0.26 + Math.random() * 0.24) * scale;
    const b = new THREE.Mesh(
      new THREE.IcosahedronGeometry(s, 0),
      i % 3 === 0 ? matLight : mat
    );
    b.position.set(
      (Math.random() - 0.5) * 0.7 * scale,
      s * 0.7 + (Math.random() - 0.5) * 0.1 * scale,
      (Math.random() - 0.5) * 0.7 * scale
    );
    b.rotation.set(Math.random(), Math.random(), Math.random());
    b.userData.isFoliage = true;
    g.add(b);
  }
  return g;
}
// Procedural curved fern frond with leaflets along its length.
function makeFrondGeo(length = 1, width = 0.16, leaflets = 7) {
  const shape = new THREE.Shape();
  // outline traces: along the spine on one side then back on the other,
  // bumping out for each leaflet to give a feathered silhouette.
  const half = leaflets;
  shape.moveTo(0, 0);
  for (let i = 1; i <= half; i++) {
    const k = i / half;
    const y = k * length;
    const w = (1 - Math.pow(k - 0.4, 2) * 1.6) * width;
    shape.quadraticCurveTo(w * 0.7, y - length / (half * 2), w, y);
  }
  shape.lineTo(0, length);
  for (let i = half; i >= 1; i--) {
    const k = i / half;
    const y = k * length;
    const w = (1 - Math.pow(k - 0.4, 2) * 1.6) * width;
    shape.quadraticCurveTo(-w * 0.7, y - length / (half * 2), -w, y);
  }
  shape.lineTo(0, 0);
  return new THREE.ShapeGeometry(shape);
}
function makeFernMesh(scale = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6abe55, roughness: 0.9, emissive: 0x2a5530, emissiveIntensity: 0.85,
    side: THREE.DoubleSide,
  });
  const outerCount = 8;
  for (let i = 0; i < outerCount; i++) {
    const leaf = new THREE.Mesh(makeFrondGeo(0.78 * scale, 0.14 * scale, 9), mat);
    const ang = (i / outerCount) * Math.PI * 2;
    leaf.rotation.set(0.55 + Math.random() * 0.15, ang, (Math.random() - 0.5) * 0.25);
    leaf.userData.isFoliage = true;
    g.add(leaf);
  }
  const innerMat = mat.clone();
  innerMat.color = new THREE.Color(0x90d278);
  innerMat.emissive = new THREE.Color(0x355f30);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(makeFrondGeo(0.45 * scale, 0.11 * scale, 7), innerMat);
    const ang = (i / 5) * Math.PI * 2 + 0.4;
    leaf.rotation.set(0.85 + Math.random() * 0.15, ang, (Math.random() - 0.5) * 0.2);
    leaf.userData.isFoliage = true;
    g.add(leaf);
  }
  return g;
}

// Broad-leaf understory plant — bigger, brighter, more leaves
function makeBroadLeafMesh(scale = 1) {
  const g = new THREE.Group();
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.22, 0.06, 0.26, 0.45, 0.00, 0.62);
  leafShape.bezierCurveTo(-0.26, 0.45, -0.22, 0.06, 0.00, 0.00);
  const leafGeo = new THREE.ShapeGeometry(leafShape);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x6cb858, side: THREE.DoubleSide, roughness: 0.85,
    emissive: 0x2c5530, emissiveIntensity: 0.7,
  });
  const innerMat = leafMat.clone();
  innerMat.color = new THREE.Color(0x90d278);
  innerMat.emissive = new THREE.Color(0x355f30);
  const numLeaves = 5;
  for (let i = 0; i < numLeaves; i++) {
    const leaf = new THREE.Mesh(leafGeo, i % 2 ? innerMat : leafMat);
    leaf.scale.setScalar(scale * (0.85 + Math.random() * 0.4));
    const ang = (i / numLeaves) * Math.PI * 2;
    leaf.rotation.set(0.25 + Math.random() * 0.2, ang, (Math.random() - 0.5) * 0.4);
    leaf.position.set(0, 0.05 * scale, 0);
    leaf.userData.isFoliage = true;
    g.add(leaf);
  }
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025 * scale, 0.04 * scale, 0.15 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x355c3a, roughness: 1, emissive: 0x1d3a22, emissiveIntensity: 0.4 })
  );
  stem.position.y = 0.075 * scale;
  g.add(stem);
  return g;
}

// ── Flower variants ────────────────────────────────────────────────────────
// Helper: tinted stem + 2 leaves
function makeStemAndLeaves(scale, stemHeight, leafColor = 0x5dad55) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022 * scale, 0.030 * scale, stemHeight * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a7a38, roughness: 0.95, emissive: 0x183a22, emissiveIntensity: 0.4 })
  );
  stem.position.y = stemHeight * 0.5 * scale;
  g.add(stem);
  const leafMat = new THREE.MeshStandardMaterial({
    color: leafColor, side: THREE.DoubleSide, roughness: 0.9,
    emissive: 0x224a25, emissiveIntensity: 0.55,
  });
  for (let i = 0; i < 2; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.20 * scale, 0.10 * scale), leafMat);
    leaf.position.set(0, (0.18 + i * 0.20) * scale, 0);
    leaf.rotation.set(0.25, i * Math.PI * 0.85, 0);
    leaf.userData.isFoliage = true;
    g.add(leaf);
  }
  return g;
}

// Wide-petal bloom (the original makeFlowerMesh, kept as a variant).
// Petal count, diameter, height all parameterizable.
function makeFlowerMesh(scale = 1, hue = 50, opts = {}) {
  const numPetals = opts.petals ?? 6;
  const stemHeight = opts.stem ?? 0.65;
  const petalLen = (opts.petalLen ?? 0.24) * scale;
  const petalWidth = (opts.petalW ?? 0.16) * scale;
  const g = makeStemAndLeaves(scale, stemHeight);
  const petalColor = new THREE.Color().setHSL(hue / 360, 0.7, 0.72);
  const petalMat = new THREE.MeshStandardMaterial({
    color: petalColor, roughness: 0.55,
    emissive: petalColor.clone().multiplyScalar(0.32),
    emissiveIntensity: 0.58,
    side: THREE.DoubleSide,
  });
  const headY = stemHeight * scale + 0.04 * scale;
  for (let i = 0; i < numPetals; i++) {
    const petal = new THREE.Mesh(new THREE.PlaneGeometry(petalWidth, petalLen), petalMat);
    petal.geometry.translate(0, petalLen * 0.5, 0);
    const ang = (i / numPetals) * Math.PI * 2;
    petal.position.set(Math.cos(ang) * 0.04 * scale, headY, Math.sin(ang) * 0.04 * scale);
    petal.rotation.set(0.4, ang, 0);
    petal.userData.isFoliage = true;
    g.add(petal);
  }
  // small yellow center
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.06 * scale, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe680, emissive: 0xffd040, emissiveIntensity: 0.62, roughness: 0.5 })
  );
  center.position.y = headY + 0.03 * scale;
  g.add(center);
  return g;
}

// Daisy — many thin petals + tall thin stem
function makeDaisyMesh(scale = 1, hue = 0 /* white */) {
  const stemH = 0.85;
  const g = makeStemAndLeaves(scale, stemH);
  const numPetals = 14;
  const petalColor = (hue === 0)
    ? new THREE.Color(0xffffff)
    : new THREE.Color().setHSL(hue / 360, 0.65, 0.85);
  const petalMat = new THREE.MeshStandardMaterial({
    color: petalColor, roughness: 0.5,
    emissive: petalColor.clone().multiplyScalar(0.26), emissiveIntensity: 0.52,
    side: THREE.DoubleSide,
  });
  const headY = stemH * scale + 0.04 * scale;
  for (let i = 0; i < numPetals; i++) {
    const petal = new THREE.Mesh(new THREE.PlaneGeometry(0.05 * scale, 0.20 * scale), petalMat);
    petal.geometry.translate(0, 0.10 * scale, 0);
    const ang = (i / numPetals) * Math.PI * 2;
    petal.position.set(Math.cos(ang) * 0.025 * scale, headY, Math.sin(ang) * 0.025 * scale);
    petal.rotation.set(0.15, ang, 0);
    petal.userData.isFoliage = true;
    g.add(petal);
  }
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.055 * scale, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffb020, emissiveIntensity: 0.62, roughness: 0.4 })
  );
  center.position.y = headY;
  g.add(center);
  return g;
}

// Tulip — closed cup of 5 curved petals
function makeTulipMesh(scale = 1, hue = 350) {
  const stemH = 0.65;
  const g = makeStemAndLeaves(scale, stemH);
  const petalColor = new THREE.Color().setHSL(hue / 360, 0.75, 0.62);
  const petalMat = new THREE.MeshStandardMaterial({
    color: petalColor, roughness: 0.5,
    emissive: petalColor.clone().multiplyScalar(0.30), emissiveIntensity: 0.58,
    side: THREE.DoubleSide,
  });
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, 0);
  petalShape.bezierCurveTo(0.10, 0.05, 0.13, 0.20, 0.00, 0.30);
  petalShape.bezierCurveTo(-0.13, 0.20, -0.10, 0.05, 0.00, 0.00);
  const petalGeo = new THREE.ShapeGeometry(petalShape);
  const headY = stemH * scale;
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.Mesh(petalGeo, petalMat);
    petal.scale.setScalar(scale);
    const ang = (i / 5) * Math.PI * 2;
    petal.position.set(Math.cos(ang) * 0.035 * scale, headY, Math.sin(ang) * 0.035 * scale);
    petal.rotation.set(-0.45, ang + Math.PI / 2, 0);  // close upward into a cup
    petal.userData.isFoliage = true;
    g.add(petal);
  }
  return g;
}

// Bell flower — 3 dangling bells along a tall stalk
function makeBellMesh(scale = 1, hue = 280) {
  const stemH = 1.05;
  const g = makeStemAndLeaves(scale, stemH);
  const bellColor = new THREE.Color().setHSL(hue / 360, 0.65, 0.72);
  const bellMat = new THREE.MeshStandardMaterial({
    color: bellColor, roughness: 0.5,
    emissive: bellColor.clone().multiplyScalar(0.34), emissiveIntensity: 0.62,
    side: THREE.DoubleSide,
  });
  // 3 small cone-like bells at heights 0.55..1.0
  for (let i = 0; i < 3; i++) {
    const y = (0.55 + i * 0.18) * scale;
    const off = (i % 2 ? 0.10 : -0.10) * scale;
    const bell = new THREE.Mesh(
      new THREE.ConeGeometry(0.08 * scale, 0.16 * scale, 8, 1, true),
      bellMat
    );
    bell.position.set(off, y, 0);
    bell.rotation.set(Math.PI, 0, off > 0 ? -0.3 : 0.3);
    bell.userData.isFoliage = true;
    g.add(bell);
  }
  return g;
}

// Wildflower cluster — small bouquet of 4–6 mini blooms on one stalk
function makeWildflowerMesh(scale = 1, hue = 320) {
  const stemH = 0.55;
  const g = makeStemAndLeaves(scale, stemH);
  const petalColor = new THREE.Color().setHSL(hue / 360, 0.7, 0.78);
  const petalMat = new THREE.MeshStandardMaterial({
    color: petalColor, roughness: 0.5,
    emissive: petalColor.clone().multiplyScalar(0.28), emissiveIntensity: 0.55,
    side: THREE.DoubleSide,
  });
  const centerMat = new THREE.MeshStandardMaterial({
    color: 0xffe680, emissive: 0xffd040, emissiveIntensity: 0.62, roughness: 0.5,
  });
  const blooms = 5;
  for (let b = 0; b < blooms; b++) {
    const a = (b / blooms) * Math.PI * 2;
    const r = 0.10 * scale;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const by = stemH * scale + (Math.random() - 0.5) * 0.06 * scale;
    // 5 tiny petals per bloom
    for (let p = 0; p < 5; p++) {
      const ang = (p / 5) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.PlaneGeometry(0.06 * scale, 0.09 * scale), petalMat);
      petal.geometry.translate(0, 0.045 * scale, 0);
      petal.position.set(bx + Math.cos(ang) * 0.018 * scale, by, bz + Math.sin(ang) * 0.018 * scale);
      petal.rotation.set(0.3, ang, 0);
      petal.userData.isFoliage = true;
      g.add(petal);
    }
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.025 * scale, 8, 6), centerMat);
    c.position.set(bx, by, bz);
    g.add(c);
  }
  return g;
}

// Pick a random flower variant — picked by `flowerType` in the placement
function makeAnyFlower(type, scale, hue) {
  switch (type) {
    case "daisy":  return makeDaisyMesh(scale, hue);
    case "tulip":  return makeTulipMesh(scale, hue);
    case "bell":   return makeBellMesh(scale, hue);
    case "wild":   return makeWildflowerMesh(scale, hue);
    default:       return makeFlowerMesh(scale, hue);
  }
}

function makeTallGrassMesh(scale = 1) {
  // Soft round tufts of grass — bigger and lit better.
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7fd878, side: THREE.DoubleSide, roughness: 1, transparent: true, alphaTest: 0.1,
    emissive: 0x4a9840, emissiveIntensity: 1.08,
  });
  const blades = 8;
  for (let i = 0; i < blades; i++) {
    const blade = new THREE.Mesh(makeBladeGeo(0.30 * scale), mat);
    blade.position.set((Math.random() - 0.5) * 0.30, 0, (Math.random() - 0.5) * 0.30);
    blade.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    blade.scale.setScalar(0.9 + Math.random() * 0.5);
    g.add(blade);
  }
  return g;
}

// Build a varied plant for an entity. Type drives base shape; size varies.
function buildEntityMesh(e) {
  const sizeJitter = 0.85 + Math.random() * 0.5;
  let mesh;
  switch (e.type) {
    case "tree": mesh = makeTreeMesh(sizeJitter); break;
    case "bush": mesh = makeBushMesh(sizeJitter); break;
    case "fern": mesh = makeFernMesh(sizeJitter); break;
    default:     mesh = makeBushMesh(sizeJitter);
  }
  const [ex, , ez] = e.world;
  mesh.position.set(ex, platformY(ex, ez), ez);
  mesh.userData.entityId = e.id;
  mesh.traverse(o => { o.userData.entityId = e.id; });
  sceneB.add(mesh);
  e.mesh = mesh;
}
for (const e of state.entities.values()) buildEntityMesh(e);

// ── Decorative flora ───────────────────────────────────────────────────────
// MANY plants, in clusters, varied flower types, varied sizes. We register
// flower CLUSTERS as PATCHES so they can be hovered/clicked to diagnose
// pests. Each patch knows its flower type (used to pick the diagnosis page).
const decorFlora = [];
state.patches = [];

function placeOne(make, x, z, opts = {}) {
  const m = make();
  m.position.set(x, platformY(x, z), z);
  m.userData.canBlow = opts.canBlow ?? false;
  sceneB.add(m);
  decorFlora.push(m);
  return m;
}
function spawnDecorativeFlora() {
  // Helper: scatter a CLUSTER of N similar items around a center.
  // If `flowerType` is given the cluster is REGISTERED as a patch (so it
  // can later host pests + be clicked open in a diagnosis page).
  function cluster(cx, cz, n, makeFn, radius = 0.45, canBlow = false, flowerType = null, label = null) {
    const plants = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const m = placeOne(makeFn, cx + Math.cos(a) * r, cz + Math.sin(a) * r, { canBlow });
      plants.push(m);
    }
    if (flowerType) {
      const id = `patch_${state.patches.length}`;
      const patch = {
        id, type: flowerType, label: label || flowerType,
        center: { x: cx, z: cz }, radius,
        plants, pests: 0, everInfected: false, needsInsecticide: false,
      };
      // tag every mesh in the patch so raycast can find its patch
      plants.forEach(p => p.traverse(o => { o.userData.patchId = id; }));
      state.patches.push(patch);
    }
    return plants;
  }
  // Big background bushes (silhouettes around the platform edges)
  cluster(-3.5, -1.2, 1, () => makeBushMesh(rand(1.2, 1.6)),  0.05);
  cluster( 3.6, -0.8, 1, () => makeBushMesh(rand(1.3, 1.7)),  0.05);
  cluster(-2.8,  2.1, 1, () => makeBushMesh(rand(1.1, 1.5)),  0.05);
  cluster( 3.2,  1.7, 1, () => makeBushMesh(rand(1.0, 1.4)),  0.05);

  // Daisy patches (white, in clusters)
  cluster(-1.2, -0.5, 5, () => makeDaisyMesh(rand(0.8, 1.2), 0),  0.40, true, "daisy", "Daisy patch");
  cluster( 1.8,  0.3, 6, () => makeDaisyMesh(rand(0.85, 1.1), 0), 0.50, true, "daisy", "Daisy patch");
  cluster( 0.4,  1.8, 4, () => makeDaisyMesh(rand(0.9, 1.2), 0),  0.35, true, "daisy", "Daisy patch");

  // Pink tulips
  cluster(-2.0,  0.2, 4, () => makeTulipMesh(rand(0.85, 1.2), 350),  0.35, true, "tulip", "Tulip bed");
  cluster( 1.0, -1.2, 5, () => makeTulipMesh(rand(0.85, 1.15), 320), 0.40, true, "tulip", "Tulip bed");

  // Yellow wildflower mat
  cluster(-0.5, -1.8, 4, () => makeWildflowerMesh(rand(0.85, 1.15), 50), 0.35, true, "wildflower", "Wildflower mat");
  cluster( 2.5,  0.8, 3, () => makeWildflowerMesh(rand(0.8, 1.1), 30),   0.30, true, "wildflower", "Wildflower mat");

  // Purple bells (taller, rises above the rest)
  cluster(-2.6, -0.4, 3, () => makeBellMesh(rand(0.95, 1.25), 280), 0.30, true, "bell", "Bell flowers");
  cluster( 2.0,  1.5, 2, () => makeBellMesh(rand(0.95, 1.20), 260), 0.30, true, "bell", "Bell flowers");

  // Magenta wide-petal flowers
  cluster(-0.8,  0.6, 3, () => makeFlowerMesh(rand(0.95, 1.3), 320, { petals: 8, petalLen: 0.28, petalW: 0.18 }), 0.30, true, "wide", "Wide-petal blooms");
  cluster( 1.4, -0.2, 3, () => makeFlowerMesh(rand(0.95, 1.3), 330, { petals: 8, petalLen: 0.30, petalW: 0.20 }), 0.30, true, "wide", "Wide-petal blooms");

  // Broad-leaf understory (5 spread out for ground depth)
  placeOne(() => makeBroadLeafMesh(rand(1.1, 1.5)), -2.2, 1.0);
  placeOne(() => makeBroadLeafMesh(rand(1.2, 1.6)),  2.4, 1.4);
  placeOne(() => makeBroadLeafMesh(rand(1.0, 1.3)), -0.4, 1.6);
  placeOne(() => makeBroadLeafMesh(rand(1.0, 1.4)),  1.3, -1.6);
  placeOne(() => makeBroadLeafMesh(rand(0.9, 1.2)), -1.8, -2.1);

  // Tall grass tufts scattered between clusters
  cluster(-1.4,  1.4, 2, () => makeTallGrassMesh(rand(1.0, 1.4)), 0.25);
  cluster( 2.8,  0.0, 2, () => makeTallGrassMesh(rand(1.0, 1.4)), 0.25);
  cluster( 1.6, -1.0, 2, () => makeTallGrassMesh(rand(1.1, 1.5)), 0.25);
  cluster(-0.2,  2.0, 2, () => makeTallGrassMesh(rand(1.1, 1.5)), 0.30);

  // EXTRA TALLER grass clusters — bigger scale, denser, spread across the
  // garden so the silhouette varies in height beyond the regular tufts.
  cluster(-3.0,  0.6, 3, () => makeTallGrassMesh(rand(1.7, 2.1)), 0.32);
  cluster( 2.2, -1.8, 3, () => makeTallGrassMesh(rand(1.6, 2.0)), 0.30);
  cluster( 0.8,  2.4, 4, () => makeTallGrassMesh(rand(1.6, 2.2)), 0.40);
  cluster(-2.4, -2.0, 3, () => makeTallGrassMesh(rand(1.7, 2.1)), 0.35);
  cluster( 3.4,  0.5, 2, () => makeTallGrassMesh(rand(1.5, 1.9)), 0.25);
}
spawnDecorativeFlora();

// drifting motes (soft white, not green)
const MOTE_COUNT = 70;
const moteGeo = new THREE.BufferGeometry();
const motePos = new Float32Array(MOTE_COUNT * 3);
const motePhase = new Float32Array(MOTE_COUNT);
for (let i = 0; i < MOTE_COUNT; i++) {
  motePos[i * 3]     = (Math.random() - 0.5) * 10;
  motePos[i * 3 + 1] = 0.4 + Math.random() * 2.6;
  motePos[i * 3 + 2] = (Math.random() - 0.5) * 6;
  motePhase[i] = Math.random() * Math.PI * 2;
}
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
const moteMat = new THREE.PointsMaterial({
  color: 0xc8ffd8, size: 0.045, transparent: true, opacity: 0.72,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
sceneB.add(new THREE.Points(moteGeo, moteMat));

// post-processing
const composer = new EffectComposer(rendererB);
composer.addPass(new RenderPass(sceneB, cameraB));
// Threshold bumped slightly so high-emissive grass blooms more than softer flower petals.
// Bloom: UnrealBloomPass(resolution, strength, radius, threshold)
//   strength  — main “how much glow” knob (try 0.35–1.2)
//   radius    — blur spread / size of halos
//   threshold — higher = only the brightest pixels bloom (try 0.45–0.85)
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.78, 0.58);
composer.addPass(bloomPass);
window.__gardenBloom = bloomPass;
const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), sceneB, cameraB);
outlinePass.edgeStrength = 8;
outlinePass.edgeGlow = 0.5;
outlinePass.edgeThickness = 2;
outlinePass.pulsePeriod = 1.6;
outlinePass.visibleEdgeColor.set("#ff2a3a");
outlinePass.hiddenEdgeColor.set("#ff2a3a");
composer.addPass(outlinePass);

// White outline pass — toggled when the player hovers an infested patch.
const whiteOutlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), sceneB, cameraB);
whiteOutlinePass.edgeStrength = 6;
whiteOutlinePass.edgeGlow = 0.8;
whiteOutlinePass.edgeThickness = 1.6;
whiteOutlinePass.pulsePeriod = 0;
whiteOutlinePass.visibleEdgeColor.set("#ffffff");
whiteOutlinePass.hiddenEdgeColor.set("#ffffff");
composer.addPass(whiteOutlinePass);

// Warm + soft-glow grade pass. Custom GLSL shader: lifts warm channels,
// applies a gentle radial vignette, and adds a quadratic-glow blend so
// already-bright regions softly bloom in a warm tint.
const WarmGlowShader = {
  uniforms: {
    tDiffuse: { value: null },
    warmth:   { value: 1.34 },
    glow:     { value: 0.44 },
    vignette: { value: 0.18 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float warmth;
    uniform float glow;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // Slight warm-shift: lift R/G, dip B
      vec3 warm = vec3(1.0 + warmth * 0.06,
                       1.0 + warmth * 0.025,
                       1.0 - warmth * 0.05);
      c.rgb *= warm;

      // Soft radial vignette so the corners feel like they recede into night
      vec2 d = vUv - vec2(0.5);
      float r2 = dot(d, d);
      float vig = 1.0 - vignette * smoothstep(0.05, 0.55, r2);
      c.rgb *= vig;

      // Quadratic self-glow — bright spots smear gently warmer
      vec3 hi = c.rgb * c.rgb;
      vec3 warmTint = vec3(1.14, 1.02, 0.80);
      c.rgb += hi * warmTint * glow;

      // Extra warmth on mid-green foliage (grass reads “lit from within” vs matte petals).
      float greenBias = smoothstep(0.06, 0.42, c.g - max(c.r, c.b) * 0.92);
      c.rgb += vec3(0.055, 0.15, 0.038) * greenBias * 0.52;

      gl_FragColor = c;
    }`,
};
const warmGlowPass = new ShaderPass(WarmGlowShader);
warmGlowPass.renderToScreen = true;
composer.addPass(warmGlowPass);

// ═════════════════════════════════════════════════════════════════════════════
//  WEEDS · PESTS · WATER · CRACKS · INVASIVE BLOOM
// ═════════════════════════════════════════════════════════════════════════════
function spawnWeed(x, z, opts = {}) {
  let g;
  if (opts.invasive) {
    // INVASIVE plants are either flat long-leaf ferns OR tall grass clumps.
    // Both are outlined RED via OutlinePass. They look like real plants
    // (which is what makes them feel invasive — they blend in until the
    // red outline gives them away).
    const variant = opts.invasiveKind || (Math.random() < 0.55 ? "fern" : "grass");
    if (variant === "fern") {
      g = makeFernMesh(0.7 + Math.random() * 0.4);
    } else {
      g = makeTallGrassMesh(1.4 + Math.random() * 0.6);
    }
    g.userData.invasiveKind = variant;
  } else {
    // Regular weeds — yellow-green tufty grass shape.
    g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7e9a55,
      emissive: 0x223317, emissiveIntensity: 0.5,
      side: THREE.DoubleSide, transparent: true, alphaTest: 0.1,
      roughness: 1,
    });
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.30), mat);
      blade.geometry.translate(0, 0.15, 0);
      const ang = (i / 4) * Math.PI * 2;
      blade.rotation.set(0.4 + Math.random() * 0.3, ang, (Math.random() - 0.5) * 0.4);
      g.add(blade);
    }
  }
  g.position.set(x, platformY(x, z), z);
  g.userData.isWeed = true;
  g.userData.swayPhase = Math.random() * Math.PI * 2;
  sceneB.add(g);
  const weed = { mesh: g, x, z, alive: true, invasive: !!opts.invasive, bornAt: now() };
  state.weeds.push(weed);
  refreshOutlineSelection();
  return weed;
}
function refreshOutlineSelection() {
  if (!outlinePass) return;
  outlinePass.selectedObjects = state.weeds.filter(w => w.alive).map(w => w.mesh);
}
function spawnRandomWeeds(n = 1) {
  for (let i = 0; i < n; i++) {
    spawnWeed((Math.random() - 0.5) * (PLATFORM_W - 1), (Math.random() - 0.5) * (PLATFORM_D - 1));
  }
}
function removeWeed(weed) {
  if (!weed.alive) return;
  weed.alive = false;
  sceneB.remove(weed.mesh);
  weed.mesh.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  state.weeds = state.weeds.filter(w => w !== weed);
  refreshOutlineSelection();
}

// PESTS now live on FLOWER PATCHES (not on individual plants). Each patch
// can be infested; while infested it shows a red exclamation marker that
// the player can click to "zoom into" a top-down diagnosis page where
// crawling pests are clicked to remove.
//
// `state.pests` is kept as a derived COUNT (sum of per-patch pest counts)
// so older code paths (garden health, antivirus, etc.) keep working.
state.pests = []; // legacy collection, treated as patch references now

function spawnPestOnPatch(patch) {
  if (!patch) {
    const candidates = state.patches.filter(p => p.pests === 0);
    if (!candidates.length) return null;
    patch = pick(candidates);
  }
  if (!patch) return null;
  const count = patch.everInfected ? (3 + Math.floor(Math.random() * 3)) : (3 + Math.floor(Math.random() * 4));
  patch.pests = count;
  patch.needsInsecticide = patch.everInfected;     // re-infested = needs spray
  state.pests.push({ patchId: patch.id });
  refreshFloraMarkers();
  return patch;
}
// Legacy: any old call to spawnPest(hostMesh) infests a random patch
function spawnPest(_hostIgnored) {
  return spawnPestOnPatch();
}
function removePest(pestOrPatch) {
  // Clear all pests on a single patch (used by antivirus or after diagnosis)
  const patch = pestOrPatch?.patchId
    ? state.patches.find(p => p.id === pestOrPatch.patchId)
    : pestOrPatch;
  if (!patch) return;
  patch.pests = 0;
  patch.needsInsecticide = false;
  patch.everInfected = true;
  state.pests = state.pests.filter(x => x.patchId !== patch.id);
  refreshFloraMarkers();
}

// ── ROOT ROT (on entity trees/bushes) ──────────────────────────────────────
state.rotted = new Set();   // entity ids currently rotted
function infectWithRoot(entityId) {
  const e = state.entities.get(entityId);
  if (!e || !e.alive || !e.mesh) return;
  state.rotted.add(entityId);
  e.water = Math.min(e.water, 18);
  refreshFloraMarkers();
}
function healRoot(entityId) {
  state.rotted.delete(entityId);
  const e = state.entities.get(entityId);
  if (e) e.water = Math.max(e.water, 80);
  refreshFloraMarkers();
}

// ── In-world flora markers (red exclamation over infested patches /
//                              orange triangle over rotted trees) ──────────
const floraMarkersEl = $("#flora-markers");
const patchHoverEl   = $("#patch-hover");
const _projectVec    = new THREE.Vector3();

function refreshFloraMarkers() {
  if (!floraMarkersEl) return;
  // Remove markers for patches that are no longer infected / trees no longer rotted
  const liveIds = new Set();
  for (const p of state.patches) if (p.pests > 0) liveIds.add(`patch:${p.id}`);
  for (const id of state.rotted)                    liveIds.add(`tree:${id}`);
  $$(".flora-marker", floraMarkersEl).forEach(m => {
    if (!liveIds.has(m.dataset.markerId)) m.remove();
  });
  // Add markers that don't exist yet
  for (const p of state.patches) {
    if (p.pests <= 0) continue;
    const mid = `patch:${p.id}`;
    if (floraMarkersEl.querySelector(`[data-marker-id="${mid}"]`)) continue;
    const m = document.createElement("div");
    m.className = "flora-marker kind-pest";
    m.dataset.markerId = mid;
    m.dataset.patchId  = p.id;
    m.innerHTML = `<div class="flora-bubble">!</div><div class="flora-tip"></div>`;
    m.addEventListener("click", () => openDiagnosisForPatch(p));
    m.addEventListener("mouseenter", () => setPatchHover(p));
    m.addEventListener("mouseleave", () => clearPatchHover());
    floraMarkersEl.appendChild(m);
  }
  for (const id of state.rotted) {
    const mid = `tree:${id}`;
    if (floraMarkersEl.querySelector(`[data-marker-id="${mid}"]`)) continue;
    const e = state.entities.get(id);
    if (!e?.mesh) continue;
    const m = document.createElement("div");
    m.className = "flora-marker kind-rot";
    m.dataset.markerId = mid;
    m.dataset.entityId = id;
    m.innerHTML = `<div class="flora-bubble">!</div><div class="flora-tip"></div>`;
    m.addEventListener("click", () => openDiagnosisForTree(e));
    m.addEventListener("mouseenter", () => setTreeHover(e));
    m.addEventListener("mouseleave", () => clearPatchHover());
    floraMarkersEl.appendChild(m);
  }
}

// Project a world position to the renderer canvas. Returns null if behind cam.
function projectToScreen(x, y, z) {
  _projectVec.set(x, y, z);
  _projectVec.project(cameraB);
  if (_projectVec.z > 1) return null;
  const rect = rendererB.domElement.getBoundingClientRect();
  const sx = (_projectVec.x * 0.5 + 0.5) * rect.width;
  const sy = (-_projectVec.y * 0.5 + 0.5) * rect.height;
  return { x: sx, y: sy };
}

function updateFloraMarkerPositions() {
  for (const m of floraMarkersEl.querySelectorAll(".flora-marker")) {
    let wx, wy, wz;
    if (m.dataset.patchId) {
      const p = state.patches.find(pp => pp.id === m.dataset.patchId);
      if (!p) continue;
      wx = p.center.x;
      wy = 1.1;
      wz = p.center.z;
    } else if (m.dataset.entityId) {
      const e = state.entities.get(m.dataset.entityId);
      if (!e?.mesh) continue;
      wx = e.mesh.position.x;
      wy = e.mesh.position.y + 1.4;
      wz = e.mesh.position.z;
    }
    const pos = projectToScreen(wx, wy, wz);
    if (!pos) { m.style.opacity = "0"; continue; }
    m.style.opacity = "1";
    m.style.left = `${pos.x}px`;
    m.style.top  = `${pos.y}px`;
  }
}

// White outline + screen-space bounding rectangle for a patch on hover.
function setPatchHover(patch) {
  whiteOutlinePass.selectedObjects = patch.plants;
  // compute screen-space bounding box of all the plants
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of patch.plants) {
    const w = m.position;
    for (let dy = 0; dy <= 1.0; dy += 0.5) {
      const pt = projectToScreen(w.x, w.y + dy, w.z);
      if (!pt) continue;
      minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
    }
  }
  if (minX === Infinity) { clearPatchHover(); return; }
  const pad = 24;
  patchHoverEl.classList.remove("hidden");
  patchHoverEl.style.left   = `${minX - pad}px`;
  patchHoverEl.style.top    = `${minY - pad}px`;
  patchHoverEl.style.width  = `${(maxX - minX) + pad * 2}px`;
  patchHoverEl.style.height = `${(maxY - minY) + pad * 2}px`;
}
function setTreeHover(e) {
  whiteOutlinePass.selectedObjects = [e.mesh];
  const w = e.mesh.position;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const dy of [0, 0.5, 1.2, 1.8]) {
    const pt = projectToScreen(w.x, w.y + dy, w.z);
    if (!pt) continue;
    minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
  }
  if (minX === Infinity) { clearPatchHover(); return; }
  const pad = 32;
  patchHoverEl.classList.remove("hidden");
  patchHoverEl.style.left   = `${minX - pad}px`;
  patchHoverEl.style.top    = `${minY - pad}px`;
  patchHoverEl.style.width  = `${(maxX - minX) + pad * 2}px`;
  patchHoverEl.style.height = `${(maxY - minY) + pad * 2}px`;
}
function clearPatchHover() {
  whiteOutlinePass.selectedObjects = [];
  patchHoverEl.classList.add("hidden");
}

function spawnCrack(x, z, severity = 1) {
  const r = 0.35 + Math.random() * 0.25;
  const geo = new THREE.RingGeometry(r * 0.6, r, 18);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, -0.005, z);
  sceneB.add(m);
  const c = { mesh: m, x, z, severity };
  state.cracks.push(c);
  return c;
}

// Invasive bloom: spawn an initial cluster of 2-4 weeds, then have them
// SPREAD over time to neighboring positions until something stops it.
function startInvasiveBloom(intensity = 1) {
  const cx = (Math.random() - 0.5) * (PLATFORM_W - 1.5);
  const cz = (Math.random() - 0.5) * (PLATFORM_D - 1.5);
  const seedCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < seedCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.4;
    spawnWeed(cx + Math.cos(a) * r, cz + Math.sin(a) * r, { invasive: true });
  }
  state.invasiveSpread = state.invasiveSpread || { active: false, last: 0 };
  state.invasiveSpread.active = true;
  state.invasiveSpread.last = now();
  state.invasiveSpread.intensity = intensity;
}
function stepInvasiveSpread(tt) {
  const s = state.invasiveSpread;
  if (!s || !s.active) return;
  const interval = 4200 - clamp(s.intensity, 1, 3) * 400;
  if (tt - s.last < interval) return;
  s.last = tt;
  const live = state.weeds.filter(w => w.alive && w.invasive);
  if (!live.length) { s.active = false; return; }
  // Pick a random existing invasive weed, spawn a new one in a small radius.
  const parent = pick(live);
  const ang = Math.random() * Math.PI * 2;
  const r = 0.35 + Math.random() * 0.6;
  const nx = clamp(parent.x + Math.cos(ang) * r, -PLATFORM_W / 2 + 0.4, PLATFORM_W / 2 - 0.4);
  const nz = clamp(parent.z + Math.sin(ang) * r, -PLATFORM_D / 2 + 0.4, PLATFORM_D / 2 - 0.4);
  // Don't spread if there's already a weed very close
  const tooClose = state.weeds.some(w => w.alive && Math.hypot(w.x - nx, w.z - nz) < 0.3);
  if (!tooClose) spawnWeed(nx, nz, { invasive: true });
  // Cap total invasives (prevent runaway)
  if (state.weeds.filter(w => w.alive && w.invasive).length > 24) s.active = false;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DIAGNOSIS PAGES
//  Top-down zoomed-in view of a single patch (or tree). The patch shows a
//  stylised illustration of its flowers; pests crawl across them along
//  bezier-ish wandering paths and must be clicked to remove.
// ═════════════════════════════════════════════════════════════════════════════
const diagnosisEl = $("#diagnosis-overlay");
let activeDiagnosis = null;     // { type: "patch"|"tree", target, ... }

function openDiagnosisForPatch(patch) {
  if (activeDiagnosis) return;
  // If the patch was previously infected, the player must SPRAY insecticide
  // first instead of swatting individual pests. Same overlay, different UI.
  const insecticideMode = patch.everInfected || patch.needsInsecticide;
  diagnosisEl.classList.remove("hidden");
  diagnosisEl.innerHTML = `
    <button class="diag-close" data-diag-close>×</button>
    <div class="diag-frame" data-diag-frame>
      <canvas id="diag-canvas"></canvas>
      <div class="diag-head">
        <span>${patch.label} · diagnosis</span>
        <span class="diag-count" id="diag-count"></span>
      </div>
      <div class="diag-status" id="diag-status">${insecticideMode
        ? "previously infected — spray insecticide to clear pests"
        : "click each pest to remove it"}</div>
      ${insecticideMode
        ? `<button class="diag-spray" id="diag-spray-btn">spray insecticide ▸</button>`
        : ""}
    </div>`;
  const frame = diagnosisEl.querySelector("[data-diag-frame]");
  const canvas = diagnosisEl.querySelector("#diag-canvas");
  const ctx = canvas.getContext("2d");
  // Make canvas size match the frame's CSS pixel size (scaled for DPR).
  function resize() {
    const r = frame.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(r.width  * dpr);
    canvas.height = Math.floor(r.height * dpr);
    canvas.style.width  = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  const flowerDrawer = pickFlowerDrawer(patch.type);
  const W = () => canvas.width  / (window.devicePixelRatio || 1);
  const H = () => canvas.height / (window.devicePixelRatio || 1);

  // Spawn pest sprites — they wander on a smooth path; click each to kill.
  const pestCount = patch.pests || 5;
  const pests = [];
  for (let i = 0; i < pestCount; i++) {
    pests.push(makeWanderingPest(frame, W, H, () => {
      patch.pests = Math.max(0, patch.pests - 1);
      countEl.textContent = `${patch.pests} left`;
      if (patch.pests === 0) finishPatch();
    }));
  }
  // Forgiving hit-test: click anywhere in the frame, kill the nearest pest
  // within ~80 px. Helps because the sprites are small + always moving.
  frame.addEventListener("click", (ev) => {
    if (ev.target.closest(".diag-close, .diag-spray")) return;
    const r = frame.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    let best = null, bestD = 80 * 80;
    pests.forEach(p => {
      if (!p.alive()) return;
      const cx = p.x(), cy = p.y();
      const dx = cx - px, dy = cy - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    });
    if (best) best.kill(false, /*viaFrame*/ true);
  });
  const countEl = diagnosisEl.querySelector("#diag-count");
  countEl.textContent = `${patch.pests} left`;

  // Insecticide spray button — instantly clears all pests.
  const sprayBtn = diagnosisEl.querySelector("#diag-spray-btn");
  if (sprayBtn) {
    sprayBtn.addEventListener("click", () => {
      pests.forEach(p => p.kill(true));
      patch.pests = 0;
      patch.needsInsecticide = false;
      countEl.textContent = `0 left`;
      diagnosisEl.querySelector("#diag-status").textContent = "patch sprayed — pests neutralised";
      setTimeout(finishPatch, 800);
    });
  }

  // Animation loop: redraw the flower illustration + step pests.
  let raf = 0;
  let lastT = performance.now();
  function frameLoop(ts) {
    const dt = Math.min(0.05, (ts - lastT) / 1000);
    lastT = ts;
    ctx.clearRect(0, 0, W(), H());
    flowerDrawer(ctx, W(), H(), ts / 1000);
    pests.forEach(p => p.update(dt));
    raf = requestAnimationFrame(frameLoop);
  }
  raf = requestAnimationFrame(frameLoop);

  function finishPatch() {
    cancelAnimationFrame(raf);
    pests.forEach(p => p.kill());
    diagnosisEl.querySelector("#diag-status").textContent = "patch healthy ✓";
    setTimeout(closeDiagnosis, 700);
    removePest({ patchId: patch.id });   // clears + flags everInfected
  }

  diagnosisEl.querySelector("[data-diag-close]").addEventListener("click", () => {
    cancelAnimationFrame(raf);
    pests.forEach(p => p.kill());
    closeDiagnosis();
  });
  activeDiagnosis = { type: "patch", target: patch };
  clearPatchHover();
}

function openDiagnosisForTree(e) {
  if (activeDiagnosis) return;
  diagnosisEl.classList.remove("hidden");
  diagnosisEl.innerHTML = `
    <button class="diag-close" data-diag-close>×</button>
    <div class="diag-frame" data-diag-frame>
      <canvas id="diag-canvas"></canvas>
      <div class="diag-head">
        <span>${e.name || "Tree"} · root rot diagnosis</span>
        <span class="diag-count" id="diag-count"></span>
      </div>
      <div class="diag-status" id="diag-status">click each rotted root to treat it</div>
    </div>`;
  const frame = diagnosisEl.querySelector("[data-diag-frame]");
  const canvas = diagnosisEl.querySelector("#diag-canvas");
  const ctx = canvas.getContext("2d");
  function resize() {
    const r = frame.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(r.width  * dpr);
    canvas.height = Math.floor(r.height * dpr);
    canvas.style.width  = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  const W = () => canvas.width  / (window.devicePixelRatio || 1);
  const H = () => canvas.height / (window.devicePixelRatio || 1);

  // Spawn 4-6 rotted root spots placed near the trunk
  const spots = [];
  const spotCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < spotCount; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 0.18 + Math.random() * 0.30;
    const sx = 0.5 + Math.cos(ang) * r;
    const sy = 0.5 + Math.sin(ang) * r;
    const el = document.createElement("div");
    el.className = "diag-rot";
    el.style.left = `${sx * 100}%`;
    el.style.top  = `${sy * 100}%`;
    let alive = true;
    el.addEventListener("click", () => {
      if (!alive) return;
      alive = false;
      el.classList.add("healed");
      remaining--;
      countEl.textContent = `${remaining} left`;
      if (remaining === 0) finishTree();
    });
    frame.appendChild(el);
    spots.push(el);
  }
  let remaining = spots.length;
  const countEl = diagnosisEl.querySelector("#diag-count");
  countEl.textContent = `${remaining} left`;

  let raf = 0;
  let lastT = performance.now();
  function loop(ts) {
    ctx.clearRect(0, 0, W(), H());
    drawTreeRoots(ctx, W(), H(), ts / 1000, spots.length, remaining);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function finishTree() {
    cancelAnimationFrame(raf);
    diagnosisEl.querySelector("#diag-status").textContent = "tree treated ✓";
    setTimeout(() => {
      closeDiagnosis();
      healRoot(e.id);
      bigEventStep("B", "tree-treated");
    }, 700);
  }

  diagnosisEl.querySelector("[data-diag-close]").addEventListener("click", () => {
    cancelAnimationFrame(raf);
    closeDiagnosis();
  });
  activeDiagnosis = { type: "tree", target: e };
  clearPatchHover();
}

function closeDiagnosis() {
  diagnosisEl.classList.add("hidden");
  diagnosisEl.innerHTML = "";
  activeDiagnosis = null;
}

// One drawer per flower type — each renders a stylised top-down flower
// illustration (filling the canvas frame). Used as the BACKGROUND of the
// diagnosis page so pests crawl over recognisable plants.
function pickFlowerDrawer(type) {
  switch (type) {
    case "daisy":      return drawDaisyTopDown;
    case "tulip":      return drawTulipTopDown;
    case "wildflower": return drawWildflowerTopDown;
    case "bell":       return drawBellTopDown;
    case "wide":
    default:           return drawWideTopDown;
  }
}

function drawDaisyTopDown(ctx, w, h) {
  // Multiple overlapping daisies — white petals with yellow center
  const flowers = [
    { cx: 0.32 * w, cy: 0.34 * h, r: w * 0.20 },
    { cx: 0.70 * w, cy: 0.46 * h, r: w * 0.22 },
    { cx: 0.40 * w, cy: 0.68 * h, r: w * 0.19 },
    { cx: 0.78 * w, cy: 0.78 * h, r: w * 0.18 },
    { cx: 0.18 * w, cy: 0.82 * h, r: w * 0.15 },
  ];
  flowers.forEach(f => {
    const petals = 14;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      ctx.fillStyle = "#fafafc";
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * f.r * 0.45, Math.sin(a) * f.r * 0.45, f.r * 0.18, f.r * 0.42, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd34a";
    ctx.beginPath(); ctx.arc(0, 0, f.r * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}
function drawTulipTopDown(ctx, w, h) {
  // Tulips viewed from above — concentric pink petals
  const flowers = [
    { cx: 0.30 * w, cy: 0.36 * h, r: w * 0.18, hue: 350 },
    { cx: 0.72 * w, cy: 0.40 * h, r: w * 0.20, hue: 322 },
    { cx: 0.46 * w, cy: 0.66 * h, r: w * 0.19, hue: 340 },
    { cx: 0.20 * w, cy: 0.78 * h, r: w * 0.17, hue: 350 },
    { cx: 0.80 * w, cy: 0.78 * h, r: w * 0.18, hue: 320 },
  ];
  flowers.forEach(f => {
    ctx.save();
    ctx.translate(f.cx, f.cy);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const c = `hsl(${f.hue}, 65%, ${56 + i * 2}%)`;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * f.r * 0.30, Math.sin(a) * f.r * 0.30, f.r * 0.40, f.r * 0.55, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `hsl(${f.hue}, 65%, 70%)`;
    ctx.beginPath(); ctx.arc(0, 0, f.r * 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a1818";
    ctx.beginPath(); ctx.arc(0, 0, f.r * 0.10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}
/** Stable 0..1 pseudo-random (same inputs → same output every frame). */
function diagStable01(i, j = 0) {
  const x = Math.sin(i * 12.9898 + j * 78.233 + 19.989) * 43758.5453;
  return x - Math.floor(x);
}

function drawWildflowerTopDown(ctx, w, h) {
  // Many small yellow blooms — positions are deterministic per index so the
  // diagnosis rAF loop does not jitter (Math.random() here used to re-roll every frame).
  const blooms = 32;
  for (let i = 0; i < blooms; i++) {
    const cx = 0.10 * w + diagStable01(i, 1) * 0.80 * w;
    const cy = 0.12 * h + diagStable01(i, 2) * 0.78 * h;
    const r = w * (0.04 + diagStable01(i, 3) * 0.04);
    const rot = diagStable01(i, 4) * 0.08;
    ctx.save();
    ctx.translate(cx, cy);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + rot;
      ctx.fillStyle = "#fce15a";
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.42, r * 0.7, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#a8420f";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
function drawBellTopDown(ctx, w, h) {
  // Bell flowers from above — looking down into the cup
  const flowers = [
    { cx: 0.32 * w, cy: 0.36 * h, r: w * 0.16, hue: 280 },
    { cx: 0.66 * w, cy: 0.30 * h, r: w * 0.15, hue: 270 },
    { cx: 0.78 * w, cy: 0.62 * h, r: w * 0.18, hue: 290 },
    { cx: 0.40 * w, cy: 0.74 * h, r: w * 0.16, hue: 260 },
    { cx: 0.18 * w, cy: 0.66 * h, r: w * 0.14, hue: 285 },
  ];
  flowers.forEach(f => {
    ctx.save();
    ctx.translate(f.cx, f.cy);
    ctx.fillStyle = `hsl(${f.hue}, 60%, 72%)`;
    ctx.beginPath(); ctx.arc(0, 0, f.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `hsl(${f.hue}, 55%, 50%)`;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * f.r, Math.sin(a) * f.r);
      ctx.lineTo(Math.cos(a + 0.6) * f.r, Math.sin(a + 0.6) * f.r);
      ctx.fill();
    }
    ctx.fillStyle = `hsl(${f.hue}, 70%, 35%)`;
    ctx.beginPath(); ctx.arc(0, 0, f.r * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}
function drawWideTopDown(ctx, w, h) {
  // Magenta wide-petal blooms
  const flowers = [
    { cx: 0.30 * w, cy: 0.38 * h, r: w * 0.20, hue: 320 },
    { cx: 0.72 * w, cy: 0.42 * h, r: w * 0.22, hue: 330 },
    { cx: 0.42 * w, cy: 0.72 * h, r: w * 0.20, hue: 320 },
    { cx: 0.78 * w, cy: 0.78 * h, r: w * 0.18, hue: 335 },
  ];
  flowers.forEach(f => {
    const petals = 8;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      ctx.fillStyle = `hsl(${f.hue}, 70%, 70%)`;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * f.r * 0.5, Math.sin(a) * f.r * 0.5, f.r * 0.30, f.r * 0.55, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffe680";
    ctx.beginPath(); ctx.arc(0, 0, f.r * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

function drawTreeRoots(ctx, w, h, t, total, remaining) {
  // Stylized brown root cross-section
  const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.55);
  grad.addColorStop(0, "#5c3a1c");
  grad.addColorStop(0.5, "#3a230f");
  grad.addColorStop(1, "#1a0e06");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // central trunk circle
  ctx.fillStyle = "#7c4f24";
  ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.10, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#3a2010";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.10, 0, Math.PI * 2); ctx.stroke();
  // branching roots
  const roots = 7;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#4a2a14";
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + Math.sin(t * 0.4 + i) * 0.1;
    const x0 = w / 2 + Math.cos(a) * w * 0.10;
    const y0 = h / 2 + Math.sin(a) * w * 0.10;
    const x1 = w / 2 + Math.cos(a) * w * 0.45;
    const y1 = h / 2 + Math.sin(a) * w * 0.45;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    // sub-roots
    for (let k = 0; k < 3; k++) {
      const ka = a + (k - 1) * 0.4;
      const sx = x0 + Math.cos(a) * w * 0.30;
      const sy = y0 + Math.sin(a) * w * 0.30;
      const ex = sx + Math.cos(ka) * w * 0.12;
      const ey = sy + Math.sin(ka) * w * 0.12;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.lineWidth = 8;
    }
  }
}

// Wandering pest sprite — element added directly to the diagnosis frame
// so its CSS-percentage positioning works at any frame size.
function makeWanderingPest(frameEl, getW, getH, onKill) {
  const el = document.createElement("div");
  el.className = "diag-pest";
  const path = makeRandomLoop();
  let pIdx = Math.random() * path.length;
  const speed = 0.45 + Math.random() * 0.45;
  let alive = true;
  let lastX = 0, lastY = 0;
  function doKill(viaFrame) {
    if (!alive) return;
    alive = false;
    el.classList.add("dead");
    setTimeout(() => el.remove(), 400);
    onKill?.();
  }
  el.addEventListener("click", () => doKill(false));
  frameEl.appendChild(el);
  function update(dt) {
    if (!alive) return;
    pIdx = (pIdx + speed * dt) % path.length;
    const i = Math.floor(pIdx);
    const f = pIdx - i;
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const w = getW(), h = getH();
    lastX = x * w; lastY = y * h;
    el.style.left = `${lastX}px`;
    el.style.top  = `${lastY}px`;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    el.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
  }
  function kill(silent, viaFrame) {
    if (!alive) return;
    alive = false;
    if (silent) { el.remove(); return; }
    el.classList.add("dead");
    setTimeout(() => el.remove(), 400);
    if (viaFrame) onKill?.();
  }
  return {
    update,
    kill,
    alive: () => alive,
    x: () => lastX,
    y: () => lastY,
  };
}
function makeRandomLoop() {
  // 6-8 random points inside the diagnosis frame, in 0..1 coords
  const n = 6 + Math.floor(Math.random() * 3);
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: 0.18 + Math.random() * 0.64, y: 0.18 + Math.random() * 0.64 });
  }
  return pts;
}

const waterParticles = [];
function spawnWater(x, z, amount = 14) {
  for (let i = 0; i < amount; i++) {
    const geo = new THREE.SphereGeometry(0.04, 6, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x88c8ff, transparent: true, opacity: 0.85, emissive: 0x224d80, emissiveIntensity: 0.3 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x + (Math.random() - 0.5) * 0.4, 1.5 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4);
    sceneB.add(m);
    waterParticles.push({ mesh: m, vy: -1.2 - Math.random() * 0.8, life: 0, maxLife: 1.2 });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOL PALETTE
// ═════════════════════════════════════════════════════════════════════════════
const toolPalette = $("#tool-palette");
toolPalette.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".tool"); if (!btn) return;
  setTool(btn.dataset.tool);
});
function setTool(tool) {
  state.tool = tool;
  if (tool !== "weed") {
    weedHoverWeed = null;
    weedPullHintEl?.classList.add("hidden");
  }
  $$("#tool-palette .tool").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
  // strip ALL tool-* classes (keep hover-grab if currently set)
  viewportB.className = viewportB.className.replace(/\btool-[a-z]+\b/g, "").trim();
  viewportB.classList.add(`tool-${tool}`);
  $("#b-caption").textContent = TOOL_HINTS[tool] || "";
  if (tool === "weed")    bigEventStep("B", "tool-weed");
  if (tool === "water")   bigEventStep("B", "tool-water");
  if (tool === "compost") bigEventStep("B", "tool-compost");
  if (tool === "pest")    bigEventStep("B", "tool-pest");
  cancelHintForTool();
}
const TOOL_HINTS = {
  look:    "drag empty space to look around",
  prune:   "click leaves on a tree, bush, or fern to prune",
  weed:    "hover a weed, then click and drag to pull it",
  water:   "click on the soil near a plant to water it",
  pest:    "click on a plant to check for pests",
  compost: "click on the compost pile to compost dead matter",
};

// ═════════════════════════════════════════════════════════════════════════════
//  POINTER INTERACTIONS ON B
// ═════════════════════════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragPoint = new THREE.Vector3();

function ptrNDC(ev) {
  const r = rendererB.domElement.getBoundingClientRect();
  ndc.x =  ((ev.clientX - r.left) / r.width)  * 2 - 1;
  ndc.y = -((ev.clientY - r.top)  / r.height) * 2 + 1;
}
function intersectScene(ev) { ptrNDC(ev); raycaster.setFromCamera(ndc, cameraB); return raycaster; }

function findEntityAt(ev) {
  const r = intersectScene(ev);
  const candidates = [];
  for (const e of state.entities.values()) if (e.alive && e.mesh) candidates.push(e.mesh);
  const hits = r.intersectObjects(candidates, true);
  if (!hits.length) return null;
  return state.entities.get(hits[0].object.userData.entityId);
}
function findWeedAt(ev) {
  const r = intersectScene(ev);
  const meshes = state.weeds.filter(w => w.alive).map(w => w.mesh);
  const hits = r.intersectObjects(meshes, true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && !obj.userData?.isWeed) obj = obj.parent;
  return state.weeds.find(w => w.mesh === obj);
}
// Find which patch (if any) the pointer is over by walking up the parent
// chain until we find a mesh tagged with patchId.
function findPatchAt(ev) {
  const r = intersectScene(ev);
  const allPlants = state.patches.flatMap(p => p.plants);
  const hits = r.intersectObjects(allPlants, true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && !obj.userData?.patchId) obj = obj.parent;
  if (!obj) return null;
  return state.patches.find(p => p.id === obj.userData.patchId);
}
function findCompostAt(ev) {
  const r = intersectScene(ev);
  const hits = r.intersectObject(compostPile, true);
  return hits.length ? compostPile : null;
}
function getGroundPoint(ev) {
  intersectScene(ev);
  if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) return dragPoint.clone();
  return null;
}

// Hover detection — weed: slight scale (see applySway) + first-time pull hint.
// Pest: white outline on infested patches / rotted trees.
let weedHoverWeed = null;
const weedPullHintEl = $("#weed-pull-hint");

rendererB.domElement.addEventListener("pointermove", (ev) => {
  if (state.tool === "weed") {
    const w = findWeedAt(ev);
    weedHoverWeed = w;
    viewportB.classList.toggle("hover-grab", !!w);
    if (weedPullHintEl && w && state.weedPullHintsShown < 3 && !weedDrag) {
      weedPullHintEl.classList.remove("hidden");
      const r = viewportB.getBoundingClientRect();
      weedPullHintEl.style.left = `${clamp(ev.clientX - r.left + 14, 8, r.width - 200)}px`;
      weedPullHintEl.style.top = `${clamp(ev.clientY - r.top - 36, 8, r.height - 48)}px`;
    } else if (weedPullHintEl) weedPullHintEl.classList.add("hidden");
    clearPatchHover();
    return;
  }
  weedHoverWeed = null;
  weedPullHintEl?.classList.add("hidden");
  viewportB.classList.remove("hover-grab");

  if (state.tool === "pest") {
    const e = findEntityAt(ev);
    if (e && state.rotted.has(e.id)) { setTreeHover(e); return; }
    const patch = findPatchAt(ev);
    if (patch && patch.pests > 0) { setPatchHover(patch); return; }
    clearPatchHover();
  } else {
    clearPatchHover();
  }
});

// Drag-to-pull state for weeds
let weedDrag = null;
let lastCleanPestNotify = 0;

rendererB.domElement.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  const tool = state.tool;
  if (tool === "look") return;     // let orbit handle it

  ev.stopPropagation();
  if (tool === "prune") {
    const e = findEntityAt(ev);
    if (!e) return;
    pruneEntity(e);
  } else if (tool === "weed") {
    const w = findWeedAt(ev);
    if (!w) return;
    // start a "grab" — must move > a few px, then mouseup, to pull
    weedDrag = { weed: w, startX: ev.clientX, startY: ev.clientY, dragged: 0, pid: ev.pointerId };
    orbit.enabled = false;
    viewportB.classList.add("dragging");
    try { rendererB.domElement.setPointerCapture(ev.pointerId); } catch {}
  } else if (tool === "water") {
    const p = getGroundPoint(ev);
    if (!p) return;
    spawnWater(p.x, p.z);
    waterPlantsAt(p.x, p.z);
    doAction("B", "water", {});
    bigEventStep("B", "watered");
  } else if (tool === "pest") {
    // Click on a plant → check the patch. If infested → open diagnosis.
    // If a tree with root rot → open root-rot diagnosis. Otherwise: nothing.
    const e = findEntityAt(ev);
    if (e && state.rotted.has(e.id)) {
      openDiagnosisForTree(e);
      return;
    }
    const patch = findPatchAt(ev);
    if (patch && patch.pests > 0) {
      openDiagnosisForPatch(patch);
      doAction("B", "pest", {});
      return;
    }
    if (patch) {
      const tn = now();
      if (tn - lastCleanPestNotify > 14_000) {
        lastCleanPestNotify = tn;
        notifyB("info", "No pests", `${patch.label} is clean.`, 2200);
      }
    }
  } else if (tool === "compost") {
    const c = findCompostAt(ev);
    if (!c) return;
    composteAtPile();
    bigEventStep("B", "composted");
  }
}, true);

rendererB.domElement.addEventListener("pointermove", (ev) => {
  if (!weedDrag) return;
  ev.stopPropagation();
  const dx = ev.clientX - weedDrag.startX;
  const dy = ev.clientY - weedDrag.startY;
  weedDrag.dragged = Math.hypot(dx, dy);
  // visually STRETCH the weed taller as the user pulls — like rubber roots
  if (weedDrag.weed?.alive) {
    const m = weedDrag.weed.mesh;
    const stretch = 1 + clamp(weedDrag.dragged / 60, 0, 2.2);
    m.scale.set(0.9 + 0.1 / stretch, stretch, 0.9 + 0.1 / stretch);
    // very slight upward shift only at the end (right before pop)
    m.position.y = clamp((weedDrag.dragged - 80) / 200, 0, 0.15);
  }
}, true);

function endWeedDrag(ev) {
  if (!weedDrag) return;
  const { weed, dragged } = weedDrag;
  try { rendererB.domElement.releasePointerCapture(ev.pointerId); } catch {}
  viewportB.classList.remove("dragging");
  weedDrag = null;
  setTimeout(() => { orbit.enabled = true; }, 0);
  if (dragged > 16 && weed.alive) {
    // pop — short scale-up burst then remove
    weed.mesh.scale.set(1.4, 3.0, 1.4);
    setTimeout(() => {
      if (weed.alive) {
        removeWeed(weed);
        state.weedPullHintsShown = Math.min(99, state.weedPullHintsShown + 1);
        doAction("B", "weed", {});
        bigEventStep("B", "weeded");
      }
    }, 80);
  } else if (weed.alive) {
    // snap back
    weed.mesh.position.y = 0;
    weed.mesh.scale.set(1, 1, 1);
  }
}
rendererB.domElement.addEventListener("pointerup",     endWeedDrag, true);
rendererB.domElement.addEventListener("pointercancel", endWeedDrag, true);

// pruning
function pruneEntity(e) {
  if (!e.mesh) return;
  let foliage = null;
  e.mesh.traverse(o => { if (!foliage && o.userData?.isFoliage) foliage = o; });
  if (foliage) {
    e.mesh.remove(foliage);
    foliage.geometry?.dispose?.();
    if (Array.isArray(foliage.material)) foliage.material.forEach(m => m.dispose?.());
    else foliage.material?.dispose?.();
  }
  e.pruneCount = (e.pruneCount || 0) + 1;
  if (e.pruneCount > 4) e.mesh.scale.multiplyScalar(0.92);
  doAction("B", "prune", { id: e.id });
}

function waterPlantsAt(x, z) {
  for (const e of state.entities.values()) {
    if (!e.alive || !e.mesh) continue;
    if (state.rotted.has(e.id)) continue;     // root rot must be diagnosed
    const d = Math.hypot(e.mesh.position.x - x, e.mesh.position.z - z);
    if (d < 1.4) {
      e.water = clamp(e.water + 28, 0, 100);
      // brief shimmer
      e.mesh.traverse(o => {
        const m = o.material;
        if (m && m.emissiveIntensity != null) {
          m._wateredAt = now();
          m.emissiveIntensity = Math.min(1.2, (m.emissiveIntensity || 0) + 0.25);
        }
      });
      if (e.isWilted) {
        e.isWilted = false;
        e.mesh.scale.setScalar(1);
      }
    }
  }
  // also refill nearby flower patches
  for (const p of state.patches) {
    const d = Math.hypot(p.center.x - x, p.center.z - z);
    if (d < 1.4) p.water = clamp((p.water ?? 100) + 36, 0, 100);
  }
  state.overwaterTicks++;
}

function composteAtPile() {
  state.composted++;
  doAction("B", "compost", {});
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAPPINGS
// ═════════════════════════════════════════════════════════════════════════════
const B_TO_A_MAP = {
  prune: {
    delayMin: 1000, delayMax: 3000,
    pressure: 7, sustainedAt: 3, extremeAt: 5, window: 12_000,
    base:      () => setCursorEffect("lag", 3000),
    sustained: () => setCursorEffect("rubberband", 4500),
    extreme:   () => setCursorEffect("spin", 2500),
  },
  weed: {
    delayMin: 800, delayMax: 2500,
    pressure: 3, sustainedAt: 4, extremeAt: 7, window: 12_000,
    base:      () => flickerOneIcon(),
    sustained: () => flickerOneIcon(),
    extreme:   () => flickerOneIcon(),
  },
  water: {
    delayMin: 1000, delayMax: 3500,
    pressure: 5, sustainedAt: 3, extremeAt: 5, window: 10_000,
    base:      () => notify("info", "Background sync started", "Mail and Photos are syncing in the background."),
    sustained: () => notifyBurstEscalating("warn", "Background activity", "Several apps are running.", 5),
    extreme:   () => notifyBurstEscalating("warn", "Process flood", "Too many background processes.", 14),
  },
  pest: {
    delayMin: 1200, delayMax: 3500,
    pressure: 4, sustainedAt: 4, extremeAt: 7, window: 14_000,
    base:      () => corruptFiles(1),
    sustained: () => { corruptFiles(2); notify("warn", "File integrity warning", "One or more files appear to be corrupted."); },
    extreme:   () => { corruptFiles(3); notify("warn", "Multiple file corruptions", "Some files may no longer open. A scan is recommended."); },
  },
  compost: {
    delayMin: 1500, delayMax: 4000,
    pressure: 2, sustainedAt: 99, extremeAt: 999,
    base: () => {
      const dead = [...state.entities.values()].filter(e => !e.alive);
      if (!dead.length) return;
      const e = pick(dead);
      e.alive = true; e.inTrash = false; e.water = 100;
      const x = 24 + Math.floor(Math.random() * 5) * 100;
      const y = 18 + Math.floor(Math.random() * 4) * 96;
      mountEntityIcon(e, x, y);
      if (Math.random() < 0.6) {
        e.dom?.classList.add("corrupted");
        const lab = e.dom?.querySelector(".dicon-label");
        if (lab) lab.textContent = lab.textContent.replace(/\.([^.]+)$/, "(1).$1.bak");
      } else {
        notify("mystery", "File restored", `“${e.name}” was recovered from a recent backup.`);
      }
      buildEntityMesh(e);
    },
  },
  move: {
    delayMin: 1500, delayMax: 3500,
    pressure: 2, sustainedAt: 99, extremeAt: 999,
    base: () => {},
  },
};

const A_TO_B_MAP = {
  delete: {
    delayMin: 1500, delayMax: 4000,
    pressure: 6, sustainedAt: 4, extremeAt: 7, window: 14_000,
    base: () => {
      const live = [...state.entities.values()].filter(e => e.alive && e.mesh);
      if (!live.length) return;
      const e = pick(live);
      spawnCrack(e.mesh.position.x + (Math.random() - 0.5) * 0.6, e.mesh.position.z + (Math.random() - 0.5) * 0.6, 1);
    },
    sustained: () => {
      for (let i = 0; i < 3; i++) setTimeout(() => {
        const live = [...state.entities.values()].filter(e => e.alive && e.mesh);
        if (!live.length) return;
        const e = pick(live);
        spawnCrack(e.mesh.position.x + (Math.random() - 0.5) * 0.6, e.mesh.position.z + (Math.random() - 0.5) * 0.6, 2);
      }, i * 600);
      for (let i = 0; i < 3; i++) {
        const t = pick(groundTiles.filter(g => g.alive));
        if (t) t.mesh.material.color.lerp(new THREE.Color(0x2a3318), 0.25);
      }
    },
    extreme: () => {
      dissolveOutskirts(2 + Math.floor(Math.random() * 2));
    },
  },
  emptytrash: {
    delayMin: 800, delayMax: 1800,
    pressure: 25, sustainedAt: 2, extremeAt: 4, window: 30_000,
    base: () => {
      dissolveOutskirts(2 + Math.floor(Math.random() * 2));
      startInvasiveBloom(1);
    },
  },
  cleanup: {
    delayMin: 600, delayMax: 1800,
    pressure: 8, sustainedAt: 99, extremeAt: 999,
    base: () => triggerWind(8_000, 1.6),
  },
  defrag: {
    delayMin: 1000, delayMax: 2200,
    pressure: 12, sustainedAt: 99, extremeAt: 999,
    base: () => triggerWind(14_000, 2.6),
  },
  antivirus: {
    delayMin: 1500, delayMax: 3500,
    pressure: 10, sustainedAt: 99, extremeAt: 999,
    base: () => {
      // Clear pests on every infested patch (sterilizing scan).
      state.patches.filter(p => p.pests > 0).forEach(p => removePest(p));
      // ...but a delayed swarm comes back across multiple patches.
      schedule(28_000 + Math.random() * 32_000, () => {
        if (!pacing.issuesUnlocked) return;
        const candidates = state.patches.filter(p => p.pests === 0);
        const cap = 1 + Math.floor(issueEscalation() * 2.5);
        const n = Math.min(candidates.length, cap + Math.floor(Math.random() * 2));
        for (let i = 0; i < n; i++) {
          const p = pick(candidates);
          if (p) { spawnPestOnPatch(p); candidates.splice(candidates.indexOf(p), 1); }
        }
      });
    },
  },
  sleep: {
    delayMin: 100, delayMax: 300,
    pressure: 6, sustainedAt: 99, extremeAt: 999,
    base: (opts) => {
      sceneB.userData.sunTarget = opts.asleep ? 0.05 : (state.isDimmed ? 0.35 : 1.0);
    },
  },
  dim: {
    delayMin: 100, delayMax: 300,
    pressure: 4,
    base: (opts) => { sceneB.userData.sunTarget = opts.dimmed ? 0.35 : 1.0; },
  },
};
sceneB.userData.sunTarget = 1.0;
sceneB.userData.sunCurrent = 1.0;

// ── Helper effects on A ────────────────────────────────────────────────────
function flickerOneIcon() {
  const live = [...state.entities.values()].filter(e => e.dom);
  const targets = [...live, ...state.decor.filter(d => d.dom)];
  if (!targets.length) return;
  const t = pick(targets);
  const el = t.dom;
  el.style.transition = "opacity 0.05s linear";
  el.style.opacity = "0.05";
  setTimeout(() => { el.style.opacity = "1"; setTimeout(() => el.style.transition = "", 80); }, 90);
}
function redrawIconsBriefly() {
  desktopEl.style.transition = "filter 0.15s linear";
  desktopEl.style.filter = "brightness(0.7) saturate(0.6)";
  setTimeout(() => { desktopEl.style.filter = ""; setTimeout(() => desktopEl.style.transition = "", 200); }, 150);
}

// ── Helper effects on B ────────────────────────────────────────────────────
const dissolveQ = [];

// Pick 1–3 ADJACENT tiles only from the outskirts (the platform's edge)
// and dissolve them. Outskirts = tiles whose row/col is at the boundary
// or within 1 of it.
function dissolveOutskirts(count = 2) {
  const liveOutskirts = groundTiles.filter(g =>
    g.alive && (g.row === 0 || g.row === ROWS - 1 || g.col === 0 || g.col === COLS - 1)
  );
  if (!liveOutskirts.length) return;
  const seed = pick(liveOutskirts);
  const cluster = [seed];
  const wanted = Math.min(count, 3);
  // grow cluster by adding neighbors
  while (cluster.length < wanted) {
    const last = cluster[cluster.length - 1];
    const neighbors = liveOutskirts.filter(g =>
      !cluster.includes(g) &&
      Math.abs(g.row - last.row) + Math.abs(g.col - last.col) === 1
    );
    if (!neighbors.length) break;
    cluster.push(pick(neighbors));
  }
  for (const t of cluster) startTileDissolve(t);
}

function startTileDissolve(t) {
  if (!t || !t.alive) return;
  t.alive = false;
  t.mesh.material = t.mesh.material.clone();
  t.mesh.material.transparent = true;
  dissolveQ.push({ tile: t, start: now(), life: 1100 });
  for (const e of state.entities.values()) {
    if (!e.alive || !e.mesh) continue;
    const dx = e.mesh.position.x - t.mesh.position.x;
    const dz = e.mesh.position.z - t.mesh.position.z;
    if (Math.abs(dx) < TILE_SIZE * 0.5 && Math.abs(dz) < TILE_SIZE * 0.5) e.mesh.userData.falling = now();
  }
}

// WIND. Plants sway harder (and a few light ones may blow away) for the
// duration of the wind event. `strength` 1.0 = breeze, 2+ = storm,
// 3.5+ = full storm that can uproot multiple flora at once.
let windStart = 0, windDur = 0, windPeak = 0;
function triggerWind(durationMs = 8000, peakStrength = 1.5) {
  windStart = now();
  windDur = durationMs;
  windPeak = peakStrength;
  if (peakStrength > 2.0) {
    // Storm: many decorative flowers might be blown away. The stronger the
    // peak, the more flora rip up at once.
    const targets = decorFlora.filter(d => d.userData.canBlow !== false).slice();
    const baseN = Math.min(targets.length,
      Math.floor(2 + (peakStrength - 2.0) * 4));   // 2 @ 2.0 → ~10 @ 4.0
    for (let i = 0; i < baseN; i++) {
      const m = pick(targets);
      if (!m || m.userData.blowing) continue;
      m.userData.blowing = true;
      m.userData.blowStart = now() + i * 60;       // staggered uprooting
    }
    // Notify Player B that a storm is hitting
    notifyB("warn", "Wind storm", "Strong winds are blowing across the garden.");
  }
}
function getWindStrength() {
  if (!windDur) return 0;
  const k = (now() - windStart) / windDur;
  if (k > 1) { windDur = 0; return 0; }
  // ramp up then down
  const env = Math.sin(clamp(k, 0, 1) * Math.PI);
  return windPeak * env;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GARDEN HEALTH UI
// ═════════════════════════════════════════════════════════════════════════════
const gardenHealthEl = $("#garden-health");
const ghNum = $("#gh-num"), ghFill = $("#gh-fill"), ghIssues = $("#gh-issues"), ghIssuesList = $("#gh-issues-list");
$("#gh-toggle").addEventListener("click", () => {
  const open = gardenHealthEl.classList.toggle("open");
  ghIssues.classList.toggle("hidden", !open);
});

function computeGardenHealth() {
  let hp = 100;
  const issues = [];
  const weedCount     = state.weeds.filter(w => w.alive && !w.invasive).length;
  const invasiveCount = state.weeds.filter(w => w.alive &&  w.invasive).length;
  const infestedPatches = state.patches.filter(p => p.pests > 0).length;
  const rottedTrees   = state.rotted.size;
  const crackCount    = state.cracks.length;
  let wiltedCount = 0, dyingCount = 0;
  for (const e of state.entities.values()) {
    if (!e.alive || !e.mesh) continue;
    if (e.water < 10)      dyingCount++;
    else if (e.water < 30) wiltedCount++;
  }
  hp -= weedCount     * 3;
  hp -= invasiveCount * 7;
  hp -= infestedPatches * 5;
  hp -= rottedTrees   * 8;
  hp -= crackCount    * 5;
  hp -= wiltedCount   * 4;
  hp -= dyingCount    * 8;
  if (state.invasive?.length) hp -= 5;
  hp = clamp(hp, 0, 100);
  if (weedCount)        issues.push({ minor: weedCount < 3, text: `${weedCount} weed${weedCount === 1 ? "" : "s"} growing` });
  if (invasiveCount)    issues.push({ minor: false,         text: `${invasiveCount} invasive plant${invasiveCount === 1 ? "" : "s"} spreading` });
  if (infestedPatches)  issues.push({ minor: infestedPatches < 2, text: `${infestedPatches} flower patch${infestedPatches === 1 ? "" : "es"} infested with pests` });
  if (rottedTrees)      issues.push({ minor: false,         text: `${rottedTrees} tree${rottedTrees === 1 ? "" : "s"} with root rot` });
  if (crackCount)       issues.push({ minor: crackCount < 2, text: `${crackCount} crack${crackCount === 1 ? "" : "s"} in the soil` });
  if (wiltedCount)      issues.push({ minor: true,          text: `${wiltedCount} plant${wiltedCount === 1 ? "" : "s"} need water` });
  if (dyingCount)       issues.push({ minor: false,         text: `${dyingCount} plant${dyingCount === 1 ? "" : "s"} dying — water now` });
  return { hp, issues };
}

function updateGardenHealthUI() {
  const { hp, issues } = computeGardenHealth();
  ghNum.textContent = `${Math.round(hp)}`;
  ghFill.style.width = `${hp}%`;
  ghFill.classList.toggle("warn", hp < 65 && hp >= 35);
  ghFill.classList.toggle("crit", hp < 35);
  if (issues.length === 0) {
    ghIssuesList.innerHTML = `<li class="gh-empty">all good — garden is calm</li>`;
  } else {
    ghIssuesList.innerHTML = issues.map(i => `<li class="${i.minor ? "minor" : ""}">${i.text}</li>`).join("");
  }
}
setInterval(updateGardenHealthUI, 1000);

// ── Plant water decay + droop / browning visualization ────────────────────
//
//  As water drops, each plant noticeably:
//    • droops down (via scale + tilt)
//    • lerps its foliage colour towards brown
//    • dims its emissive
//
//  We tween based on per-plant `dryness = 1 - water/30`. Over-30 means
//  healthy and the plant stays at its original colour.
function _cacheOriginalMaterials(rootMesh) {
  if (rootMesh.userData._cachedOriginal) return;
  rootMesh.userData._cachedOriginal = true;
  rootMesh.traverse(o => {
    const m = o.material;
    if (!m || !m.color) return;
    if (!m._origColor) {
      m._origColor    = m.color.clone();
      m._origEmissive = m.emissive ? m.emissive.clone() : new THREE.Color(0,0,0);
      m._origEI       = m.emissiveIntensity ?? 0.5;
    }
  });
}
const BROWN_FOLIAGE = new THREE.Color(0x6a4220);
const BROWN_EMISS   = new THREE.Color(0x2e1a08);
function _applyDryness(rootMesh, dryness) {
  _cacheOriginalMaterials(rootMesh);
  rootMesh.traverse(o => {
    const m = o.material;
    if (!m || !m._origColor) return;
    // Only brown the GREEN parts of plants (foliage, stems, leaves).
    // Skip flower petals: those have green that's not the dominant channel.
    const c = m._origColor;
    const isGreenDom = c.g > c.r * 1.05 && c.g > c.b * 1.15 && c.g > 0.18;
    if (!isGreenDom) return;
    m.color.copy(c).lerp(BROWN_FOLIAGE, dryness);
    if (m.emissive) m.emissive.copy(m._origEmissive).lerp(BROWN_EMISS, dryness);
    if (m.emissiveIntensity != null && !m._wateredAt) {
      m.emissiveIntensity = m._origEI * (1 - dryness * 0.7);
    }
  });
  // Slight droop scale (down + flatter).
  const droop = 1 - dryness * 0.22;
  rootMesh.scale.setScalar(droop);
}
function _resetDryness(rootMesh) {
  _applyDryness(rootMesh, 0);
  rootMesh.scale.setScalar(1);
}

// Notification debouncer
let lastWaterNotice = 0;
let lastWiltNotice  = 0;

setInterval(() => {
  let dryEntities = 0, wiltedEntities = 0;
  const introMul = pacing.issuesUnlocked ? 1 : 0.38;
  const esc = issueEscalation();
  const decayMul = introMul * (0.65 + esc * 0.35);
  for (const e of state.entities.values()) {
    if (!e.alive || !e.mesh) continue;
    e.water = clamp(e.water - rand(0.5, 1.0) * decayMul, 0, 100);
    const dryness = clamp((30 - e.water) / 30, 0, 1);
    if (dryness > 0) _applyDryness(e.mesh, dryness);
    else _resetDryness(e.mesh);
    if (e.water < 30) wiltedEntities++;
    if (e.water < 12) dryEntities++;
    e.isWilted = e.water < 30;
  }
  // Decor patches dry too.
  for (const p of state.patches) {
    p.water = clamp((p.water ?? 100) - rand(0.3, 0.7) * decayMul, 0, 100);
    const dryness = clamp((30 - p.water) / 30, 0, 1);
    for (const m of p.plants) {
      if (dryness > 0) _applyDryness(m, dryness);
      else _resetDryness(m);
    }
    if (p.water < 30) wiltedEntities++;
    if (p.water < 12) dryEntities++;
  }

  const t = now();
  if (!pacing.issuesUnlocked) return;
  const dryNeed = esc < 0.35 ? 4 : esc < 0.7 ? 3 : 2;
  const wiltNeed = esc < 0.35 ? 5 : esc < 0.7 ? 4 : 3;
  const waterGap = 28_000 + (1 - esc) * 22_000;
  const wiltGap = 35_000 + (1 - esc) * 25_000;
  if (dryEntities >= dryNeed && t - lastWaterNotice > waterGap) {
    lastWaterNotice = t;
    notifyB("warn", "Water the plants", `${dryEntities} plants are running dry.`, 6500);
  } else if (wiltedEntities >= wiltNeed && t - lastWiltNotice > wiltGap) {
    lastWiltNotice = t;
    notifyB("warn", "Plants wilting", `${wiltedEntities} plants are starting to wilt.`, 6000);
  }
}, 3500);

// ═════════════════════════════════════════════════════════════════════════════
//  BIG EVENTS
// ─────────────────────────────────────────────────────────────────────────────
//  The BIG EVENT UI:
//    • DEFAULT STATE  → a tiny red CAUTION badge centered at the top of the
//      affected side. Player must CLICK the badge to expand the actual task
//      popup (a Win-95 style window with a red title bar + step list).
//    • RESOLVED STATE → green confirmation pill that auto-closes.
// ═════════════════════════════════════════════════════════════════════════════
function bigCard(side, kind, title, msg, steps, uiOpts = {}) {
  const overlay = side === "A" ? bigAEl : bigBEl;
  const hintLine = uiOpts.expandHint ?? "Click for step-by-step fix";
  const hintEsc = hintLine.replace(/"/g, "&quot;");
  overlay.innerHTML = "";
  if (kind === "ok") {
    // Resolved confirmation — small dark pill, auto-dismissed by caller.
    overlay.innerHTML = `
      <div class="big-card ok" style="text-align:center">
        <div class="big-head" style="justify-content:center">
          <div class="big-dot ok"></div>
          <div class="big-title">${title}</div>
        </div>
        <div class="big-msg">${msg}</div>
        <ol class="big-steps"><li class="done">Resolved</li></ol>
      </div>`;
    return;
  }
  // Active task — badge invites expansion; full Win-95 task popup holds instructions.
  overlay.innerHTML = `
    <div class="caution-badge" data-bigtoggle role="button" tabindex="0"
      aria-expanded="false" title="${hintEsc}">
      <span class="caution-tri"></span>
      <span class="caution-stack">
        <span class="caution-label">${hintLine} ▾</span>
        <span class="caution-sub">${title}</span>
      </span>
    </div>
    <div class="win-error red task hidden big-task-popup" data-bigpopup>
      <div class="win-bar">
        <span>${title}</span>
        <span class="x" data-bigtoggle>×</span>
      </div>
      <div class="win-body">
        <div class="win-icon"></div>
        <div class="win-msg win-msg-task">
          <div class="win-msg-lead">${msg}</div>
          <ol class="big-steps win-steps">
            ${steps.map((s, i) => `<li class="${i === 0 ? 'active' : ''}" data-step="${i}">${s}</li>`).join("")}
          </ol>
        </div>
      </div>
    </div>`;
  const badge = overlay.querySelector(".caution-badge");
  const popup = overlay.querySelector("[data-bigpopup]");
  attachWinDrag(popup, overlay);
  function showPopup(show) {
    popup.classList.toggle("hidden", !show);
    badge?.setAttribute("aria-expanded", show ? "true" : "false");
    if (!show) return;
    const overlayRect = overlay.getBoundingClientRect();
    if (!popup.dataset.dragged) {
      popup.style.position = "absolute";
      popup.style.top = `${overlayRect.height + 10}px`;
      popup.style.left = "50%";
      popup.style.transform = "translateX(-50%)";
    }
  }
  overlay.querySelectorAll("[data-bigtoggle]").forEach(el => {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      showPopup(popup.classList.contains("hidden"));
    });
  });
}
function bigCardClose(side) {
  const overlay = side === "A" ? bigAEl : bigBEl;
  overlay.innerHTML = "";
}
function bigEventStep(side, hint, payload) {
  const ev = pacing.bigEvent;
  if (!ev || ev.side !== side) return;
  ev.handler?.(hint, payload);
}

// HINT system: if no progress on the active big event for >2 minutes,
// highlight the next thing the player should interact with.
function startHintTimer(forSide, hintKind) {
  cancelHintTimer();
  state.hintTarget = { side: forSide, kind: hintKind };
  state.hintTimer = setTimeout(() => triggerHint(), 120_000);
}
function bumpHintTimer() {
  if (!state.hintTarget) return;
  cancelHintTimer();
  state.hintTimer = setTimeout(() => triggerHint(), 120_000);
}
function cancelHintTimer() {
  if (state.hintTimer) { clearTimeout(state.hintTimer); state.hintTimer = null; }
  // remove any active hint pulses
  $$(".hint-pulse").forEach(el => el.classList.remove("hint-pulse"));
  state.hintTarget = null;
}
function cancelHintForTool() {
  // When the player picks the right tool we can drop the hint
  if (!state.hintTarget) return;
  if (state.hintTarget.kind?.startsWith?.("tool:")) cancelHintTimer();
}
function triggerHint() {
  const t = state.hintTarget;
  if (!t) return;
  if (t.side === "A") {
    if (t.kind === "open-activity") dockEl.querySelector(".app-activity")?.classList.add("hint-pulse");
    else if (t.kind === "open-settings") dockEl.querySelector(".app-settings")?.classList.add("hint-pulse");
    else if (t.kind === "open-safari")   dockEl.querySelector(".app-safari")?.classList.add("hint-pulse");
    else if (t.kind === "apple-menu")    $(".mb-apple")?.classList.add("hint-pulse");
  } else {
    if (t.kind === "tool:weed")    toolPalette.querySelector(`[data-tool="weed"]`)?.classList.add("hint-pulse");
    if (t.kind === "tool:water")   toolPalette.querySelector(`[data-tool="water"]`)?.classList.add("hint-pulse");
    if (t.kind === "tool:compost") toolPalette.querySelector(`[data-tool="compost"]`)?.classList.add("hint-pulse");
  }
  state.hintTimer = setTimeout(() => triggerHint(), 60_000);
}

// ── A-side big events ──────────────────────────────────────────────────────
function triggerBigEventA(type) {
  pacing.bigEvent = { side: "A", type, startedAt: now(), handler: null };
  if (type === "restart-needed")  startRestartEvent();
  else if (type === "low-storage") startLowStorageEvent();
  else                             startBrowserIssue();
}

function startRestartEvent() {
  const ev = pacing.bigEvent;
  ev.steps = ["Click the Apple menu (top-left)", "Click Restart…", "Confirm Restart"];
  ev.idx = 0;
  const cascadeMsgs = [
    "I don't know what's wrong.",
    "An unexpected condition was encountered.",
    "Operation could not be completed.",
    "Kernel driver reported an exception.",
    "Core Audio pipeline stalled.",
    "Graphics subsystem reset failed.",
    "Memory pressure is critically high.",
    "Could not save unsaved documents.",
    "System extension blocked.",
    "Watchdog timeout — service hung.",
    "Please restart your computer.",
  ];
  showWinErrorEscalating(11, cascadeMsgs, () => {
    bigCard("A", "crit", "System unresponsive", "Several services have stopped responding. A restart is required.", ev.steps, {
      expandHint: "Critical · tap for restart steps",
    });
    startHintTimer("A", "apple-menu");
  });
  ev.handler = (hint) => {
    if (ev.idx === 0 && hint === "apple-menu-open") { bumpHintTimer(); advance(); }
    if (ev.idx === 1 && hint === "restart-clicked") { bumpHintTimer(); advance(); }
    if (ev.idx === 2 && hint === "restart-confirmed") { advance(); }
    if (hint === "restart-complete") finish();
  };
  function advance() {
    ev.idx++;
    bigAEl.querySelectorAll(".big-steps li").forEach((li, i) => {
      li.classList.toggle("done",  i <  ev.idx);
      li.classList.toggle("active", i === ev.idx);
    });
  }
  function finish() {
    cancelHintTimer();
    bigCard("A", "ok", "System restored", "Your Mac has restarted successfully.", ["Resolved"]);
    bigAEl.querySelector(".big-card .big-dot")?.classList.add("ok");
    bigAEl.querySelector("li").classList.add("done");
    setTimeout(() => bigCardClose("A"), 2200);
    endBigEvent("A");
  }
}

function startLowStorageEvent() {
  const ev = pacing.bigEvent;
  ev.steps = [
    "Open System Settings → Storage",
    "Find an application using significant space",
    "Uninstall an application to free at least 5 GB",
  ];
  ev.idx = 0;
  state.diskUsedPct = Math.max(state.diskUsedPct, 96);
  const diskCascade = [
    "Your disk is almost full.",
    "Could not write preference file — disk full.",
    "Photo analysis paused — insufficient storage.",
    "Download failed — no space left on volume.",
    "Time Machine backup deferred — disk full.",
    "Could not save document — storage critically low.",
    "Unable to allocate swap — disk nearly full.",
    "System services may be unstable.",
  ];
  showWinErrorEscalating(8, diskCascade, () => {
    bigCard("A", "crit", "Disk almost full", "Free up space by uninstalling applications you no longer need.", ev.steps, {
      expandHint: "Critical · tap for storage steps",
    });
    notifyBurstEscalating("err", "Storage alert", "Your startup disk is almost full.", 8, 9000);
    startHintTimer("A", "open-settings");
  });
  ev.startUsed = state.diskUsedPct;
  ev.freedGB = 0;
  ev.handler = (hint, payload) => {
    if (ev.idx === 0 && hint === "settings-storage") { bumpHintTimer(); advance(); }
    if (ev.idx === 1 && hint === "settings-storage") advance();
    if (hint === "uninstalled-app") {
      ev.freedGB += payload.sizeGB;
      if (ev.idx < 2) advance();
      if (ev.freedGB >= 5) { advance(); finish(); }
    }
  };
  // observe settings open + pane switch
  const obs = new MutationObserver(() => {
    const main = openWindows.settings?.body.querySelector("#settings-main");
    if (main?.dataset.pane === "storage") bigEventStep("A", "settings-storage");
  });
  obs.observe(desktopEl, { childList: true, subtree: true });
  ev._obs = obs;
  function advance() {
    ev.idx = Math.min(2, ev.idx + 1);
    bigAEl.querySelectorAll(".big-steps li").forEach((li, i) => {
      li.classList.toggle("done",  i <  ev.idx);
      li.classList.toggle("active", i === ev.idx);
    });
  }
  function finish() {
    ev._obs?.disconnect();
    cancelHintTimer();
    bigCard("A", "ok", "Storage restored", `${ev.freedGB.toFixed(1)} GB freed. Your Mac has room to breathe again.`, ["Resolved"]);
    bigAEl.querySelector(".big-card .big-dot")?.classList.add("ok");
    bigAEl.querySelector("li").classList.add("done");
    setTimeout(() => bigCardClose("A"), 2200);
    endBigEvent("A");
  }
}

function startBrowserIssue() {
  const ev = pacing.bigEvent;
  ev.steps = ["Open Safari", "Read the troubleshooting page", "Click the “Clear Cache” button"];
  ev.idx = 0;
  const safariWave1 = [
    "Could not establish a secure connection to the server.",
    "The certificate for this server is invalid.",
    "DNS lookup timed out.",
    "TCP connection reset by peer.",
    "Secure transport layer handshake failed.",
  ];
  const safariWave2 = [
    "Unable to reach the network.",
    "Request timed out after 30 seconds.",
    "No route to host.",
    "SSL peer certificate expired.",
    "Connection refused by host.",
    "The network connection was lost.",
    "Server returned an invalid response.",
    "Safari cannot verify the identity of the website.",
  ];
  const safariWave3 = [
    "WebKit networking process terminated.",
    "Safari cannot open the page.",
    "A TLS error occurred.",
    "The operation couldn’t be completed.",
    "Network changed while loading.",
  ];
  const afterStacks = () => {
    bigCard("A", "crit", "Network issue detected", "Safari encountered a problem. Open the help page and follow the steps.", ev.steps, {
      expandHint: "Safari · tap for fix steps",
    });
    startHintTimer("A", "open-safari");
  };
  showWinErrorEscalating(5, safariWave1, () => {
    showWinErrorEscalating(8, safariWave2, () => {
      showWinErrorEscalating(5, safariWave3, afterStacks, msBetweenSpawnFast);
    }, msBetweenSpawnSlow);
  }, msBetweenSpawnFast);
  ev.handler = (hint) => {
    if (ev.idx === 0 && hint === "open-safari") {
      bumpHintTimer(); advance();
      const html = `
        <h1>Safari · Troubleshooting</h1>
        <div class="err">Error 0x80072F8F — secure connection failure.</div>
        <h3>Try these steps</h3>
        <ol>
          <li>Quit and relaunch Safari.</li>
          <li>Clear your browsing cache.</li>
          <li>Restart your Wi-Fi.</li>
        </ol>
        <button class="btn primary" id="clear-cache-btn">Clear Cache</button>`;
      const page = openSafari({ title: "Safari · Help", url: "support.apple.com/safari/help", html });
      page.querySelector("#clear-cache-btn").addEventListener("click", () => bigEventStep("A", "clear-cache"));
      setTimeout(() => bigEventStep("A", "read-page"), 1200);
    } else if (ev.idx === 1 && hint === "read-page") advance();
    else if (ev.idx === 2 && hint === "clear-cache") {
      const page = openWindows.safari?.body.querySelector("#safari-page");
      if (page) page.innerHTML += `<div class="progress-track" style="margin-top:14px"><div class="progress-fill" id="cc-fill"></div></div><div class="progress-status">Clearing cache…</div>`;
      const fill = page?.querySelector("#cc-fill");
      const t0 = now(), dur = 4000;
      (function tick() {
        const k = clamp((now() - t0) / dur, 0, 1);
        if (fill) fill.style.width = `${(k * 100).toFixed(1)}%`;
        if (k < 1) requestAnimationFrame(tick);
        else finish();
      })();
    }
  };
  const obs = new MutationObserver(() => {
    if (openWindows.safari && ev.idx === 0) bigEventStep("A", "open-safari");
  });
  obs.observe(desktopEl, { childList: true, subtree: false });
  function advance() {
    ev.idx++;
    bigAEl.querySelectorAll(".big-steps li").forEach((li, i) => {
      li.classList.toggle("done",  i <  ev.idx);
      li.classList.toggle("active", i === ev.idx);
    });
  }
  function finish() {
    obs.disconnect();
    cancelHintTimer();
    bigCard("A", "ok", "Safari is responsive again", "Connection restored.", ["Resolved"]);
    bigAEl.querySelector(".big-card .big-dot")?.classList.add("ok");
    bigAEl.querySelector("li").classList.add("done");
    setTimeout(() => bigCardClose("A"), 2000);
    endBigEvent("A");
  }
}

// ── B-side big events ──────────────────────────────────────────────────────
function triggerBigEventB(type) {
  pacing.bigEvent = { side: "B", type, startedAt: now(), handler: null };
  if (type === "invasive-bloom")    startInvasiveEvent();
  else if (type === "root-rot")     startRootRotEvent();
  else                              startErosionRepairEvent();
}

function startInvasiveEvent() {
  const ev = pacing.bigEvent;
  ev.steps = ["Switch to the weed tool", "Pull at least 8 weeds", "Wait for the soil to settle"];
  ev.idx = 0;
  ev.weedsToPull = 10;
  bigCard("B", "crit", "Invasive bloom", "Foreign growth is spreading. Switch to the weed tool and pull them.", ev.steps, {
    expandHint: "Garden · tap for weed steps",
  });
  startInvasiveBloom(2);
  startHintTimer("B", "tool:weed");
  ev.handler = (hint) => {
    if (ev.idx === 0 && hint === "tool-weed") { bumpHintTimer(); advance(); }
    if (ev.idx === 1 && hint === "weeded") {
      ev.weedsToPull--;
      if (ev.weedsToPull <= 0) { advance(); setTimeout(() => { advance(); finish(); }, 6000); }
    }
  };
  function advance() {
    ev.idx++;
    bigBEl.querySelectorAll(".big-steps li").forEach((li, i) => {
      li.classList.toggle("done",  i <  ev.idx);
      li.classList.toggle("active", i === ev.idx);
    });
  }
  function finish() {
    cancelHintTimer();
    bigCard("B", "ok", "Garden recovering", "The invasive bloom is contained.", ["Resolved"]);
    bigBEl.querySelector(".big-card .big-dot")?.classList.add("ok");
    bigBEl.querySelector("li").classList.add("done");
    setTimeout(() => bigCardClose("B"), 2000);
    endBigEvent("B");
  }
}

function startRootRotEvent() {
  const ev = pacing.bigEvent;
  ev.steps = [
    "Switch to the pest tool",
    "Click each tree marked with a caution icon",
    "Treat every rotted root in the diagnosis page",
  ];
  ev.idx = 0;
  bigCard("B", "crit", "Root rot detected", "Several trees are showing signs of root rot. Click each tree to diagnose and treat them.", ev.steps, {
    expandHint: "Trees · tap for diagnosis steps",
  });
  // Pick 2-3 entities (trees/bushes) to rot
  const candidates = [...state.entities.values()].filter(e => e.alive && e.mesh && (e.type === "tree" || e.type === "bush"));
  const toRot = candidates.slice(0, 3);
  toRot.forEach(e => infectWithRoot(e.id));
  ev.totalToTreat = toRot.length;
  startHintTimer("B", "tool:pest");
  ev.handler = (hint) => {
    if (ev.idx === 0 && hint === "tool-pest") { bumpHintTimer(); advance(); }
    if (hint === "tree-treated") {
      if (ev.idx < 2) advance();
      if (state.rotted.size === 0) { advance(); finish(); }
    }
  };
  function advance() {
    ev.idx = Math.min(2, ev.idx + 1);
    const popup = bigBEl.querySelector("[data-bigpopup]");
    popup?.querySelectorAll(".big-steps li").forEach((li, i) => {
      li.classList.toggle("done",  i <  ev.idx);
      li.classList.toggle("active", i === ev.idx);
    });
  }
  function finish() {
    cancelHintTimer();
    bigCard("B", "ok", "Trees treated", "Root rot has been cleared.", ["Resolved"]);
    bigBEl.querySelector(".big-card .big-dot")?.classList.add("ok");
    bigBEl.querySelector("li").classList.add("done");
    setTimeout(() => bigCardClose("B"), 2000);
    endBigEvent("B");
  }
}

function startErosionRepairEvent() {
  const ev = pacing.bigEvent;
  ev.steps = ["Switch to the compost tool", "Compost 5 times", "Wait for soil to rebuild"];
  ev.idx = 0;
  ev.composts = 5;
  bigCard("B", "crit", "Soil erosion", "Patches of ground are crumbling. Switch to the compost tool.", ev.steps, {
    expandHint: "Soil · tap for compost steps",
  });
  for (let i = 0; i < 6; i++) setTimeout(() => spawnCrack((Math.random() - 0.5) * (PLATFORM_W - 1), (Math.random() - 0.5) * (PLATFORM_D - 1), 2), i * 600);
  startHintTimer("B", "tool:compost");
  ev.handler = (hint) => {
    if (ev.idx === 0 && hint === "tool-compost") { bumpHintTimer(); advance(); }
    if (ev.idx === 1 && hint === "composted") {
      ev.composts--;
      if (ev.composts <= 0) { advance(); setTimeout(() => { advance(); finish(); }, 5000); }
    }
  };
  function advance() {
    ev.idx++;
    bigBEl.querySelectorAll(".big-steps li").forEach((li, i) => {
      li.classList.toggle("done",  i <  ev.idx);
      li.classList.toggle("active", i === ev.idx);
    });
  }
  function finish() {
    cancelHintTimer();
    state.cracks.forEach(c => sceneB.remove(c.mesh));
    state.cracks = [];
    bigCard("B", "ok", "Soil restored", "The platform is stable again.", ["Resolved"]);
    bigBEl.querySelector(".big-card .big-dot")?.classList.add("ok");
    bigBEl.querySelector("li").classList.add("done");
    setTimeout(() => bigCardClose("B"), 2000);
    endBigEvent("B");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  AMBIENT GARDEN LIFE
// ═════════════════════════════════════════════════════════════════════════════
setInterval(() => {
  const t = now();
  if (!pacing.issuesUnlocked) {
    if (t >= pacing.firstIssueAt) {
      pacing.issuesUnlocked = true;
      pacing.firstIssueFiredAt = t;
      if (Math.random() < 0.5) {
        notify("info", "Sync complete", "A small background task finished. Nothing else for now.", 3800);
      } else {
        spawnRandomWeeds(1);
        notifyB("info", "Garden", "A weed popped up near the edge — easy to pull when you’re ready.", 5000);
      }
    }
    return;
  }
  const esc = issueEscalation();
  const weedChance = (0.06 + esc * 0.34) * (state.weeds.length < 5 ? 1 : 0.35);
  if (state.weeds.length < 8 && Math.random() < weedChance) spawnRandomWeeds(1);
  const cleanPatches = state.patches.filter(p => p.pests === 0);
  const infested = state.patches.filter(p => p.pests > 0).length;
  const pestChance = (0.05 + esc * 0.28) * (infested < 1 + Math.floor(esc * 2) ? 1 : 0.4);
  if (cleanPatches.length && infested < 3 && Math.random() < pestChance) {
    spawnPestOnPatch(pick(cleanPatches));
  }
}, 8_000);

// ═════════════════════════════════════════════════════════════════════════════
//  DEV MODE
// ═════════════════════════════════════════════════════════════════════════════
const devToggleBtn = $("#dev-toggle");
const devPanelA = $("#dev-panel-a");
const devPanelB = $("#dev-panel-b");
const soloToggle = $("#solo-toggle");
const demoRow = $("#demo-row");
const demoStartBtn = $("#demo-start");
const demoStopBtn = $("#demo-stop");
const demoStatusEl = $("#demo-status");

/** Dummy opponent — fires `doAction` on the side you are *not* playing so pacing maps run across worlds even solo. */
let demoBotTimer = null;

function pickAliveEntityForDemoPrune() {
  const live = [...state.entities.values()].filter(e => e.alive && e.mesh);
  const e = pick(live);
  return e?.id ?? null;
}

function stopDemoBot() {
  if (demoBotTimer) {
    clearInterval(demoBotTimer);
    demoBotTimer = null;
  }
  state.demoActive = false;
  if (demoStatusEl) demoStatusEl.textContent = "";
}

function demoBotTickHumanIsA() {
  const step = pick([
    () => doAction("B", "water", {}),
    () => doAction("B", "weed", {}),
    () => {
      const id = pickAliveEntityForDemoPrune();
      if (id) doAction("B", "prune", { id });
    },
    () => doAction("B", "pest", {}),
    () => doAction("B", "compost", {}),
  ]);
  try { step(); } catch (err) { console.warn(err); }
}

function demoBotTickHumanIsB() {
  const step = pick([
    () => doAction("A", "cleanup", {}),
    () => doAction("A", "defrag", {}),
    () => doAction("A", "delete", {}),
    () => doAction("A", "dim", { dimmed: Math.random() < 0.45 }),
    () => doAction("A", "antivirus", {}),
  ]);
  try { step(); } catch (err) { console.warn(err); }
}

async function requestDemoFullscreen() {
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen();
  } catch (_) { /* user denied or unsupported */ }
}

async function startDemoBot() {
  stopDemoBot();
  state.demoActive = true;
  const humanIsA = Math.random() < 0.5;
  window.__devSolo(humanIsA ? "a" : "b");
  soloToggle.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.solo === (humanIsA ? "a" : "b"));
  });
  if (demoStatusEl) {
    demoStatusEl.textContent = humanIsA ? "dummy → garden (B)" : "dummy → desktop (A)";
  }
  await requestDemoFullscreen();
  requestAnimationFrame(() => syncSizes());
  const tick = humanIsA ? demoBotTickHumanIsA : demoBotTickHumanIsB;
  tick();
  demoBotTimer = setInterval(tick, 4200 + Math.random() * 5200);
}

devToggleBtn.addEventListener("click", () => {
  state.devMode = !state.devMode;
  devToggleBtn.classList.toggle("on", state.devMode);
  devPanelA.classList.toggle("hidden", !state.devMode);
  devPanelB.classList.toggle("hidden", !state.devMode);
  soloToggle.classList.toggle("hidden", !state.devMode);
  demoRow?.classList.toggle("hidden", !state.devMode);
  document.body.classList.toggle("dev-on", state.devMode);
  if (!state.devMode) stopDemoBot();
});

demoStartBtn?.addEventListener("click", () => { void startDemoBot(); });
demoStopBtn?.addEventListener("click", () => {
  stopDemoBot();
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
  } catch (_) {}
});

// Solo player fullscreen view (dev-only). Hides the other side and
// stretches the visible side over the whole viewport.
soloToggle.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  const mode = btn.dataset.solo;
  document.body.classList.remove("solo-a", "solo-b");
  if (mode === "a") document.body.classList.add("solo-a");
  if (mode === "b") document.body.classList.add("solo-b");
  soloToggle.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
  // The renderer needs a re-size after the viewport changes
  requestAnimationFrame(() => syncSizes());
});
function devFire(action) {
  switch (action) {
    // A side
    case "a:cursor-lag":  setCursorEffect("lag", 4000); break;
    case "a:rubberband":  setCursorEffect("rubberband", 4500); break;
    case "a:spin":        setCursorEffect("spin", 3000); break;
    case "a:rainbow":     setCursorEffect("rainbow", 3500); break;
    case "a:notif":       notify("warn", "Notification", "A background process is running."); break;
    case "a:notif-flood": notifyBurstEscalating("warn", "Process busy", "Some apps may slow down.", 14); break;
    case "a:err-popup":   showWinError(); break;
    case "a:flicker":     flickerOneIcon(); break;
    case "a:corrupt":     corruptFiles(1 + Math.floor(Math.random() * 2)); break;
    case "a:leak":        leakOnA(); break;
    case "a:big-restart": triggerBigEventA("restart-needed"); break;
    case "a:big-storage": triggerBigEventA("low-storage"); break;
    case "a:big-browser": triggerBigEventA("browser-issue"); break;
    // B side
    case "b:weed":   spawnRandomWeeds(1); break;
    case "b:weeds5": spawnRandomWeeds(5); break;
    case "b:pest":   spawnPestOnPatch(); break;
    case "b:crack":  spawnCrack((Math.random()-0.5)*PLATFORM_W*0.8, (Math.random()-0.5)*PLATFORM_D*0.8, 2); break;
    case "b:tile-dissolve": dissolveOutskirts(2 + Math.floor(Math.random() * 2)); break;
    case "b:wind":   triggerWind(15_000, 4.0); break;
    case "b:drain":
      for (const e of state.entities.values()) if (e.alive) e.water = 12;
      for (const p of state.patches) p.water = 12;
      break;
    case "b:wilt":
      for (const e of state.entities.values()) if (e.alive && e.mesh) { e.water = 5; e.isWilted = true; }
      for (const p of state.patches) p.water = 5;
      break;
    case "b:sun-dim":  sceneB.userData.sunTarget = 0.35; break;
    case "b:sun-dead": sceneB.userData.sunTarget = 0.05; break;
    case "b:big-bloom":   triggerBigEventB("invasive-bloom"); break;
    case "b:big-rot":     triggerBigEventB("root-rot"); break;
    case "b:big-erosion": triggerBigEventB("erosion-repair"); break;
  }
}
devPanelA.addEventListener("click", (ev) => {
  const b = ev.target.closest(".dev-btn"); if (!b) return; devFire(b.dataset.dev);
});
devPanelB.addEventListener("click", (ev) => {
  const b = ev.target.closest(".dev-btn"); if (!b) return; devFire(b.dataset.dev);
});

// Expose dev actions + key state on window for headless / browser-automation
// testing. (Easier than clicking 230px-wide dev buttons reliably.)
window.__devFire = devFire;
window.__state   = state;
window.__stopDemoBot = stopDemoBot;
window.__startDemoBot = startDemoBot;
window.__devSolo = (mode) => {
  document.body.classList.remove("solo-a", "solo-b");
  if (mode === "a") document.body.classList.add("solo-a");
  if (mode === "b") document.body.classList.add("solo-b");
  soloToggle.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.solo === mode));
  requestAnimationFrame(() => syncSizes());
};

// ═════════════════════════════════════════════════════════════════════════════
//  SWAY ANIMATION  (gentle breeze always; stronger during wind events)
// ═════════════════════════════════════════════════════════════════════════════
function applySway(t, amplitude, wind, dt) {
  // For heavy wind we add a single dominant gust direction so all plants
  // tilt the SAME way at the same time — looks like a real storm.
  const gustDir = Math.sin(t * 0.7);                  // -1..1, slowly varying
  const gustForce = clamp((wind - 1.5) * 0.45, 0, 1.4); // 0 unless wind > 1.5
  const gust = gustDir * gustForce;

  const droopAdj = (e) => (e.water != null && e.water < 35)
    ? clamp((35 - e.water) / 35, 0, 1) : 0;

  for (const e of state.entities.values()) {
    if (!e.alive || !e.mesh) continue;
    const phase = e.mesh.userData.swayPhase ??= hashId(e.id) * 0.01;
    const droop = droopAdj(e);                       // 0..1
    // ambient sway + global storm gust + slight permanent droop
    e.mesh.rotation.z = Math.sin(t * 1.4 + phase) * (amplitude * 0.6) + gust * 0.55;
    e.mesh.rotation.x = Math.sin(t * 1.1 + phase * 1.3) * (amplitude * 0.3) + droop * 0.45;
  }
  for (const m of decorFlora) {
    if (m.userData.blowing) continue;
    m.userData.swayPhase ??= Math.random() * 6.28;
    m.rotation.z = Math.sin(t * 1.6 + m.userData.swayPhase) * amplitude + gust * 0.5;
    m.rotation.x = Math.sin(t * 1.0 + m.userData.swayPhase * 1.4) * (amplitude * 0.4);
  }
  for (const w of state.weeds) {
    if (!w.alive) continue;
    w.mesh.rotation.z = Math.sin(t * 1.3 + (w.mesh.userData.swayPhase || 0)) * (amplitude * 0.8) + gust * 0.6;
    if (weedDrag?.weed === w) continue;
    const hover = weedHoverWeed === w && state.tool === "weed";
    const tgt = hover ? 1.07 : 1.0;
    const c = w.mesh.scale.x;
    const n = c + (tgt - c) * Math.min(1, dt * 14);
    w.mesh.scale.set(n, n, n);
  }
  // grass: just rotate the whole instanced mesh subtly when there's wind
  if (grassMesh) grassMesh.rotation.z = Math.sin(t * 2) * (amplitude * 0.3) + gust * 0.18;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ANIMATION LOOP
// ═════════════════════════════════════════════════════════════════════════════
let sceneFlash = 0;
function sceneFlashPulse(n) { sceneFlash = Math.max(sceneFlash, n); }
const clock = new THREE.Clock();

function syncSizes() {
  const wB = viewportB.clientWidth, hB = viewportB.clientHeight;
  rendererB.setSize(wB, hB);
  composer.setSize(wB, hB);
  cameraB.aspect = wB / Math.max(1, hB);
  cameraB.updateProjectionMatrix();
  paintWallpaper();
  if (Object.keys(openWindows).length === 0) buildAllIcons();
}
window.addEventListener("resize", syncSizes);

function animate() {
  requestAnimationFrame(animate);
  const t  = clock.getElapsedTime();
  const dt = Math.min(0.1, clock.getDelta());
  const tt = now();

  tickPacing();
  updateCursorPosition(dt);

  // motes float
  const mp = moteGeo.attributes.position.array;
  for (let i = 0; i < MOTE_COUNT; i++) {
    mp[i * 3]     += Math.sin(t * 0.6 + motePhase[i]) * 0.0018;
    mp[i * 3 + 1] += Math.cos(t * 0.8 + motePhase[i]) * 0.0014;
    mp[i * 3 + 2] += Math.sin(t * 0.7 + motePhase[i] * 1.4) * 0.0018;
  }
  moteGeo.attributes.position.needsUpdate = true;

  // scanline scroll + mild flicker on the screen
  scanlineTex.offset.y = (t * 0.02) % 1;
  scanlineMat.opacity  = 0.10 + Math.sin(t * 8) * 0.02;

  // false sun smoothing (sleep / dim)
  const cur = sceneB.userData.sunCurrent;
  const tgt = sceneB.userData.sunTarget;
  const next = cur + (tgt - cur) * Math.min(1, dt * 2.2);
  sceneB.userData.sunCurrent = next;
  screenMat.uniforms.uDim.value = Math.max(0.07, next);
  screenMat.uniforms.uCamPos.value.copy(cameraB.position);
  falseSunLight.intensity = 1.95 * next;
  sceneB.fog.density = 0.046 + (1 - next) * 0.06;

  // tile dissolves
  for (let i = dissolveQ.length - 1; i >= 0; i--) {
    const f = dissolveQ[i];
    const age = (tt - f.start) / f.life;
    if (age >= 1) {
      sceneB.remove(f.tile.mesh);
      f.tile.mesh.geometry.dispose?.();
      f.tile.mesh.material.dispose?.();
      dissolveQ.splice(i, 1); continue;
    }
    f.tile.mesh.material.opacity = 1 - age;
    f.tile.mesh.position.y = f.tile.originalY - age * 0.6;
  }

  // sway from wind (every plant, decor flora, weeds)
  const wind = getWindStrength();           // 0..~3
  const baseSway = 0.04;                    // gentle ambient sway
  const swayAmount = baseSway + wind * 0.07;
  applySway(t, swayAmount, wind, dt);

  // invasive bloom spreading
  stepInvasiveSpread(tt);

  // entity falling (when their tile dissolved)
  for (const e of state.entities.values()) {
    if (!e.mesh) continue;
    if (e.mesh.userData.falling) {
      const age = (tt - e.mesh.userData.falling) / 1200;
      e.mesh.position.y -= dt * (1.5 + age * 4);
      if (e.mesh.position.y < -6) { sceneB.remove(e.mesh); e.mesh = null; e.alive = false; }
    }
  }

  // blow-away animation for marked decor
  for (const m of decorFlora) {
    if (!m.userData.blowing) continue;
    const age = (tt - m.userData.blowStart) / 1500;
    m.position.x += dt * (3 + wind * 1.5);
    m.position.y += dt * 1.2 - age * dt * 0.6;
    m.rotation.z -= dt * 4;
    m.rotation.x += dt * 2;
    if (m.position.x > 12) {
      sceneB.remove(m);
      m.userData.blowing = false;
    }
  }

  // water particles
  for (let i = waterParticles.length - 1; i >= 0; i--) {
    const p = waterParticles[i];
    p.life += dt;
    p.mesh.position.y += p.vy * dt;
    if (p.mesh.position.y < 0 || p.life > p.maxLife) {
      sceneB.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      waterParticles.splice(i, 1);
    } else p.mesh.material.opacity = clamp(1 - p.life / p.maxLife, 0, 1);
  }

  // pests bob
  for (const p of state.pests) { if (p.alive) { p.phase += dt * 4; p.mesh.position.y += Math.sin(p.phase) * 0.002; } }


  // restore watered emissive over time
  for (const e of state.entities.values()) {
    if (!e.mesh) continue;
    e.mesh.traverse(o => {
      const m = o.material;
      if (m && m._wateredAt && tt - m._wateredAt > 800) {
        m.emissiveIntensity = Math.max(0.3, m.emissiveIntensity - dt * 0.3);
        if (m.emissiveIntensity <= 0.35) delete m._wateredAt;
      }
    });
  }

  // scene flash decay
  rendererB.toneMappingExposure = 1.22 + sceneFlash;
  sceneFlash *= 0.9;

  // project DOM markers (red exclamation pings) onto the canvas
  updateFloraMarkerPositions();

  orbit.update();
  composer.render();
}

// ═════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═════════════════════════════════════════════════════════════════════════════
function boot() {
  paintWallpaper();
  buildAllIcons();
  buildDock();
  setTool("look");
  syncSizes();
  animate();
  // initial seeds
  setTimeout(() => spawnRandomWeeds(2), 4000);
  setTimeout(() => {
    const live = [...state.entities.values()].filter(e => e.alive && e.mesh);
    if (live.length) spawnPest(pick(live).mesh);
  }, 7000);
  setTimeout(() => {
    notify("err", "Your disk is almost full",
      "Only 4% of space remains on Macintosh HD. Move files to the Trash and empty it to free space.");
  }, 1500);
  // first health draw
  updateGardenHealthUI();
}
boot();

// ═════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function hashId(s) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
