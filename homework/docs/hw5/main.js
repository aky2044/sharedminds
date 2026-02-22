import { UMAP } from "https://cdn.skypack.dev/umap-js";

// --- CONFIGURATION (original proxy + setup preserved) ---
const REPLICATE_PROXY = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
const AUTH_TOKEN = "YOUR_TOKEN_HERE"; // Replace with your active token

// --- ANIMAL EMOJI + WIKIPEDIA LOOKUP ---
const ANIMAL_EMOJIS = {
    'wolf': '🐺', 'hyena': '🐺', 'crow': '🐦‍⬛', 'fox': '🦊',
    'shark': '🦈', 'owl': '🦉', 'dolphin': '🐬', 'cat': '🐱',
    'bear': '🐻', 'honey badger': '🦡', 'ant': '🐜', 'chameleon': '🦎',
    'elephant': '🐘', 'peacock': '🦚', 'vulture': '🦅', 'octopus': '🐙',
    'sloth': '🦥', 'hawk': '🦅', 'rabbit': '🐇', 'snake': '🐍'
};
const WIKI_TITLES = {
    'wolf': 'Gray_wolf', 'hyena': 'Spotted_hyena', 'crow': 'Crow',
    'fox': 'Red_fox', 'shark': 'Great_white_shark', 'owl': 'Owl',
    'dolphin': 'Bottlenose_dolphin', 'cat': 'Cat', 'bear': 'Brown_bear',
    'honey badger': 'Honey_badger', 'ant': 'Ant', 'chameleon': 'Chameleon',
    'elephant': 'African_elephant', 'peacock': 'Peafowl', 'vulture': 'Vulture',
    'octopus': 'Octopus', 'sloth': 'Sloth', 'hawk': 'Red-tailed_hawk',
    'rabbit': 'Rabbit', 'snake': 'Snake'
};

// --- STATE ---
let canvas, ctx;
let isRunning = false;
let descriptionArea = null;
let wordCountDiv = null;
let findAnimalBtn = null;
let matchLabel = null;
const MAX_WORDS = 70;

// 3D data
let points3D = [];       // { x, y, z, text, name, description } for each animal
let userPoint = null;
let lastMatchIndex = null;

// Embedding data
let mapVectors = [];
let mapTexts = [];

// Camera state
let camRotY = 0;
let camRotX = 0.3;
let camZoom = 600;
const FIELD_SIZE = 300;

// Interaction state
let isDragging = false;
let didDrag = false;       // Track if mouse moved during press (to distinguish click vs drag)
let lastPointerX = 0;
let lastPointerY = 0;
let lastPinchDist = 0;

// Hover state
let hoveredIndex = -1;
let mouseX = 0, mouseY = 0;

// Bio card state
let bioOverlay = null;
let bioCard = null;
let bioShowing = false;
let selectedAnimalIndex = -1;

// Camera animation state
let camAnim = null;  // { startRY, startRX, startZoom, targetRY, targetRX, targetZoom, startTime, duration, onComplete }
let savedCam = null; // saved camera before zoom-in

// --- MATH UTILS ---
function cosineSimilarityEmbeddings(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    let dot = 0, aNorm = 0, bNorm = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        aNorm += vecA[i] * vecA[i];
        bNorm += vecB[i] * vecB[i];
    }
    if (!aNorm || !bNorm) return 0;
    return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

// --- 3D PERSPECTIVE PROJECTION ---
function rotateY(x, y, z, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: x * c + z * s, y, z: -x * s + z * c };
}
function rotateX(x, y, z, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x, y: y * c - z * s, z: y * s + z * c };
}
const SIDEBAR_WIDTH = 320;
function project(x, y, z) {
    let p = rotateY(x, y, z, camRotY);
    p = rotateX(p.x, p.y, p.z, camRotX);
    const fov = camZoom;
    const zOffset = p.z + fov + FIELD_SIZE;
    if (zOffset < 1) return null;
    const scale = fov / zOffset;
    const visibleWidth = canvas.width - SIDEBAR_WIDTH;
    return {
        sx: visibleWidth / 2 + p.x * scale,
        sy: canvas.height / 2 - p.y * scale,
        scale, depth: zOffset
    };
}

// --- NORMALIZE 3D ---
function normalize3D(points) {
    const dims = [0, 1, 2];
    const mins = dims.map(d => Math.min(...points.map(p => p[d])));
    const maxs = dims.map(d => Math.max(...points.map(p => p[d])));
    return points.map(p => dims.map(d => {
        const range = maxs[d] - mins[d];
        return range > 0 ? ((p[d] - mins[d]) / range - 0.5) * FIELD_SIZE * 2 : 0;
    }));
}

// --- CAMERA ANIMATION ---
function animateCamera(targetRY, targetRX, targetZoom, duration, onComplete) {
    camAnim = {
        startRY: camRotY, startRX: camRotX, startZoom: camZoom,
        targetRY, targetRX, targetZoom,
        startTime: performance.now(), duration,
        onComplete: onComplete || null
    };
}
function updateCameraAnimation() {
    if (!camAnim) return;
    const elapsed = performance.now() - camAnim.startTime;
    const t = Math.min(elapsed / camAnim.duration, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

    camRotY = camAnim.startRY + (camAnim.targetRY - camAnim.startRY) * ease;
    camRotX = camAnim.startRX + (camAnim.targetRX - camAnim.startRX) * ease;
    camZoom = camAnim.startZoom + (camAnim.targetZoom - camAnim.startZoom) * ease;

    if (t >= 1) {
        if (camAnim.onComplete) camAnim.onComplete();
        camAnim = null;
    }
}

// --- CALCULATE TARGET ROTATION TO CENTER A POINT ---
function getTargetRotation(pt) {
    const targetRY = Math.atan2(-pt.x, pt.z);
    const zAfterY = Math.sqrt(pt.x * pt.x + pt.z * pt.z);
    const targetRX = Math.atan2(pt.y, zAfterY);
    return { targetRY, targetRX };
}

// --- ZOOM TO ANIMAL ---
function zoomToAnimal(index) {
    if (index < 0 || index >= points3D.length || bioShowing) return;
    selectedAnimalIndex = index;
    savedCam = { rotY: camRotY, rotX: camRotX, zoom: camZoom };

    const pt = points3D[index];
    const { targetRY, targetRX } = getTargetRotation(pt);

    // Compute how far away the point is from origin to determine zoom level
    const ptDist = Math.sqrt(pt.x * pt.x + pt.y * pt.y + pt.z * pt.z);
    const targetZoom = Math.max(60, ptDist * 0.35);

    animateCamera(targetRY, targetRX, targetZoom, 1800, () => {
        showBioCard(index);
    });
}

function zoomBack() {
    if (!savedCam) return;
    animateCamera(savedCam.rotY, savedCam.rotX, savedCam.zoom, 1200);
    savedCam = null;
}

// --- WIKIPEDIA IMAGE FETCH ---
async function getAnimalImageUrl(animalName) {
    const key = animalName.toLowerCase();
    const wikiTitle = WIKI_TITLES[key] || animalName;
    try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`);
        const data = await res.json();
        return data.thumbnail?.source || null;
    } catch {
        return null;
    }
}

// --- BIO CARD (MUSEUM STYLE) ---
function createBioElements() {
    // Full-screen overlay
    bioOverlay = document.createElement('div');
    Object.assign(bioOverlay.style, {
        position: "fixed", inset: "0", zIndex: "2000",
        background: "rgba(0,0,0,0.8)", backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        display: "none", alignItems: "center", justifyContent: "center"
    });
    bioOverlay.onclick = (e) => { if (e.target === bioOverlay) hideBioCard(); };

    // Card — modern black & white
    bioCard = document.createElement('div');
    Object.assign(bioCard.style, {
        width: "420px", maxWidth: "90vw", maxHeight: "85vh",
        background: "#0a0a0a",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.8)",
        overflow: "hidden", display: "flex", flexDirection: "column",
        fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
        color: "#ffffff",
        transform: "scale(0.95) translateY(10px)", opacity: "0",
        transition: "transform 0.4s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease"
    });

    bioOverlay.append(bioCard);
    document.body.append(bioOverlay);
}

async function showBioCard(index) {
    if (!bioOverlay || !bioCard) return;
    bioShowing = true;
    const pt = points3D[index];
    const key = pt.name.toLowerCase();
    const emoji = ANIMAL_EMOJIS[key] || '🐾';

    // Parse description (remove "AnimalName: " prefix)
    const colonIdx = pt.text.indexOf(":");
    const description = colonIdx > 0 ? pt.text.substring(colonIdx + 1).trim() : pt.text;

    // Build card HTML — modern B&W
    bioCard.innerHTML = `
        <div style="position:relative;">
            <div id="bio-img-area" style="width:100%; height:240px; background:#111;
                display:flex; align-items:center; justify-content:center;
                font-size:80px; overflow:hidden; position:relative;">
                <span id="bio-emoji" style="filter:grayscale(0.3) drop-shadow(0 0 30px rgba(255,255,255,0.15));">${emoji}</span>
            </div>
            <button id="bio-close" style="position:absolute; top:14px; right:14px;
                width:28px; height:28px; border-radius:50%;
                border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.6);
                color:rgba(255,255,255,0.6); font-size:14px;
                cursor:pointer; display:flex; align-items:center; justify-content:center;
                backdrop-filter:blur(8px); transition:all 0.2s ease;"
                onmouseenter="this.style.borderColor='rgba(255,255,255,0.5)';this.style.color='white'"
                onmouseleave="this.style.borderColor='rgba(255,255,255,0.2)';this.style.color='rgba(255,255,255,0.6)'">✕</button>
        </div>
        <div style="padding:28px 32px 32px;">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:3px;
                color:rgba(255,255,255,0.3); margin-bottom:8px; font-weight:500;">Archetype</div>
            <div style="font-size:26px; font-weight:600; color:white;
                margin-bottom:4px; line-height:1.2; letter-spacing:-0.5px;">${pt.name}</div>
            <div style="width:40px; height:1px; background:rgba(255,255,255,0.15); margin:16px 0 20px;"></div>
            <div style="font-size:14px; line-height:1.8; color:rgba(255,255,255,0.6);
                font-weight:400; margin-bottom:16px;">
                ${description}
            </div>
            <div style="font-size:10px; color:rgba(255,255,255,0.15); text-align:right;
                border-top:1px solid rgba(255,255,255,0.06); padding-top:14px; margin-top:8px;
                letter-spacing:1px; text-transform:uppercase;">
                Behavioral Profile
            </div>
        </div>
    `;

    // Show overlay
    bioOverlay.style.display = "flex";
    requestAnimationFrame(() => {
        bioCard.style.transform = "scale(1) translateY(0)";
        bioCard.style.opacity = "1";
    });

    // Close button
    document.getElementById('bio-close').onclick = () => hideBioCard();

    // Fetch real image from Wikipedia
    const imgUrl = await getAnimalImageUrl(pt.name);
    if (imgUrl && bioShowing) {
        const imgArea = document.getElementById('bio-img-area');
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            if (!bioShowing) return;
            imgArea.innerHTML = '';
            img.style.cssText = "width:100%; height:100%; object-fit:cover; filter:grayscale(0.6) brightness(0.9);";
            imgArea.append(img);
        };
        img.src = imgUrl;
    }
}

function hideBioCard() {
    if (!bioOverlay) return;
    bioShowing = false;
    bioCard.style.transform = "scale(0.95) translateY(10px)";
    bioCard.style.opacity = "0";
    setTimeout(() => {
        bioOverlay.style.display = "none";
    }, 400);
    zoomBack();
}

// --- SETUP UI ---
function setupUI() {
    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    Object.assign(canvas.style, { display: "block", position: "fixed", top: "0", left: "0", zIndex: "0", cursor: "grab" });
    document.body.append(canvas);
    ctx = canvas.getContext('2d');

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    // Side panel — modern black & white
    const sidePanel = document.createElement('div');
    Object.assign(sidePanel.style, {
        position: "fixed", top: "0", right: "0", bottom: "0", width: "320px",
        background: "rgba(0, 0, 0, 0.85)", color: "white", padding: "24px 20px",
        boxSizing: "border-box", zIndex: "1002",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        display: "flex", flexDirection: "column", gap: "12px",
        borderLeft: "1px solid rgba(255,255,255,0.08)"
    });

    const title = document.createElement('div');
    title.textContent = "ARCHETYPE UNIVERSE";
    Object.assign(title.style, {
        fontSize: "11px", fontWeight: "600", letterSpacing: "3px",
        color: "rgba(255,255,255,0.5)", textTransform: "uppercase",
        paddingBottom: "8px", borderBottom: "1px solid rgba(255,255,255,0.08)"
    });

    const promptLabel = document.createElement('div');
    promptLabel.textContent = "Describe your tendencies, personality, habits — both good and bad:";
    Object.assign(promptLabel.style, {
        fontSize: "13px", lineHeight: "1.5", color: "rgba(255,255,255,0.6)",
        fontWeight: "400"
    });

    descriptionArea = document.createElement('textarea');
    descriptionArea.placeholder = "e.g. I hoard things, I'm lazy but burst with energy when motivated, I avoid confrontation...";
    Object.assign(descriptionArea.style, {
        flex: "1", resize: "none", padding: "12px", borderRadius: "6px",
        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
        color: "white", fontFamily: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
        fontSize: "13px", lineHeight: "1.5", outline: "none",
        transition: "border-color 0.2s ease"
    });
    descriptionArea.addEventListener('focus', () => {
        descriptionArea.style.borderColor = "rgba(255,255,255,0.25)";
    });
    descriptionArea.addEventListener('blur', () => {
        descriptionArea.style.borderColor = "rgba(255,255,255,0.1)";
    });

    wordCountDiv = document.createElement('div');
    Object.assign(wordCountDiv.style, {
        fontSize: "11px", color: "rgba(255,255,255,0.25)",
        fontFamily: "'SF Mono', 'Fira Code', monospace"
    });
    wordCountDiv.textContent = `0 / ${MAX_WORDS} words`;

    findAnimalBtn = document.createElement('button');
    findAnimalBtn.textContent = "Find my animal";
    Object.assign(findAnimalBtn.style, {
        padding: "10px 16px", borderRadius: "6px",
        border: "1px solid rgba(255,255,255,0.15)",
        background: "white", color: "black", fontWeight: "600",
        cursor: "pointer", fontSize: "13px", opacity: "0",
        pointerEvents: "none", transition: "all 0.2s ease",
        letterSpacing: "0.5px"
    });
    findAnimalBtn.onmouseenter = () => {
        if (findAnimalBtn.style.opacity === "1") {
            findAnimalBtn.style.background = "rgba(255,255,255,0.85)";
        }
    };
    findAnimalBtn.onmouseleave = () => {
        findAnimalBtn.style.background = "white";
    };
    findAnimalBtn.onclick = () => findAnimalWithEmbedding();

    matchLabel = document.createElement('div');
    Object.assign(matchLabel.style, {
        fontSize: "12px", color: "rgba(255,255,255,0.7)", minHeight: "20px",
        fontWeight: "500"
    });

    const helperText = document.createElement('div');
    Object.assign(helperText.style, {
        fontSize: "10px", color: "rgba(255,255,255,0.2)",
        lineHeight: "1.5", marginTop: "auto", paddingTop: "12px",
        borderTop: "1px solid rgba(255,255,255,0.06)"
    });
    helperText.textContent = "Drag to rotate · Pinch to zoom · Click a dot to inspect";

    sidePanel.append(title, promptLabel, descriptionArea, wordCountDiv, findAnimalBtn, matchLabel, helperText);
    document.body.append(sidePanel);

    // Create bio card elements
    createBioElements();

    // Description events
    descriptionArea.addEventListener('input', () => {
        enforceWordLimit();
        updateFindButtonVisibility();
    });

    // --- MOUSE DRAG TO ROTATE ---
    canvas.addEventListener('mousedown', e => {
        if (bioShowing) return;
        isDragging = true;
        didDrag = false;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        canvas.style.cursor = "grabbing";
    });
    window.addEventListener('mousemove', e => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        if (isDragging && !bioShowing) {
            const dx = e.clientX - lastPointerX;
            const dy = e.clientY - lastPointerY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;
            camRotY += dx * 0.005;
            camRotX += dy * 0.005;
            camRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camRotX));
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;
        }
    });
    window.addEventListener('mouseup', e => {
        isDragging = false;
        canvas.style.cursor = "grab";
    });

    // --- CLICK TO SELECT ANIMAL ---
    canvas.addEventListener('click', e => {
        if (didDrag || bioShowing) return;
        // Find which animal was clicked
        const clickX = e.clientX, clickY = e.clientY;
        let closestIdx = -1, closestDist = 25;
        for (let i = 0; i < points3D.length; i++) {
            const p = project(points3D[i].x, points3D[i].y, points3D[i].z);
            if (!p) continue;
            const d = Math.sqrt((clickX - p.sx) ** 2 + (clickY - p.sy) ** 2);
            if (d < closestDist) { closestDist = d; closestIdx = i; }
        }
        if (closestIdx >= 0) zoomToAnimal(closestIdx);
    });

    // --- ZOOM: TRACKPAD PINCH (ctrlKey wheel) ONLY ---
    canvas.addEventListener('wheel', e => {
        // Trackpad pinch/spread fires wheel with ctrlKey on Chrome/Firefox
        if (e.ctrlKey) {
            e.preventDefault();
            camZoom = Math.max(60, Math.min(3000, camZoom - e.deltaY * 8));
        }
    }, { passive: false });

    // Safari gesture events for trackpad pinch
    let lastGestureScale = 1;
    canvas.addEventListener('gesturestart', e => {
        e.preventDefault();
        lastGestureScale = 1;
    });
    canvas.addEventListener('gesturechange', e => {
        e.preventDefault();
        const delta = e.scale - lastGestureScale;
        camZoom = Math.max(60, Math.min(3000, camZoom + delta * 800));
        lastGestureScale = e.scale;
    });
    canvas.addEventListener('gestureend', e => e.preventDefault());

    // --- TOUCH: Swipe to rotate, two-finger pinch to zoom ---
    canvas.addEventListener('touchstart', e => {
        if (bioShowing) return;
        if (e.touches.length === 1) {
            isDragging = true;
            didDrag = false;
            lastPointerX = e.touches[0].clientX;
            lastPointerY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            isDragging = false;
            lastPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (bioShowing) return;
        if (e.touches.length === 1 && isDragging) {
            const dx = e.touches[0].clientX - lastPointerX;
            const dy = e.touches[0].clientY - lastPointerY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;
            camRotY += dx * 0.005;
            camRotX += dy * 0.005;
            camRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camRotX));
            lastPointerX = e.touches[0].clientX;
            lastPointerY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const delta = dist - lastPinchDist;
            camZoom = Math.max(60, Math.min(3000, camZoom + delta * 3));
            lastPinchDist = dist;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', () => { isDragging = false; });

}

function updateFindButtonVisibility() {
    if (!findAnimalBtn || !descriptionArea) return;
    const hasText = descriptionArea.value.trim().length > 0;
    findAnimalBtn.style.opacity = hasText ? "1" : "0";
    findAnimalBtn.style.pointerEvents = hasText ? "auto" : "none";
}

function enforceWordLimit() {
    if (!descriptionArea) return;
    let words = descriptionArea.value.trim().split(/\s+/).filter(Boolean);
    if (words.length > MAX_WORDS) {
        words = words.slice(0, MAX_WORDS);
        descriptionArea.value = words.join(" ");
    }
    if (wordCountDiv) wordCountDiv.textContent = `${words.length} / ${MAX_WORDS} words`;
}

// --- UNIVERSE CREATION ---
async function createUniverse() {
    if (isRunning) return;
    isRunning = true;
    document.body.style.cursor = "wait";

    const prompt = `Generate a flat JSON array with exactly 20 animal archetype entries. Each must have 'type' (the animal name) and 'description' (3–4 vivid sentences covering BOTH positive AND negative traits, specific behaviors, habits, and personality quirks unique to that animal — avoid generic adjectives).

Use these 20 animals exactly: Wolf, Hyena, Crow, Fox, Shark, Owl, Dolphin, Cat, Bear, Honey Badger, Ant, Chameleon, Elephant, Peacock, Vulture, Octopus, Sloth, Hawk, Rabbit, Snake.

Each description MUST include:
- 1–2 sentences on distinctive positive behaviors (loyalty, cleverness, patience, etc.)
- 1–2 sentences on negative traits or flaws (aggression, manipulation, laziness, hoarding, cowardice, selfishness, etc.)

Examples of good descriptions:
- Hyena: "Thrives in tight-knit groups and never abandons the pack. Communicates constantly with raucous energy and dark humor. But scavenges aggressively, steals from others without guilt, and dominates through relentless harassment rather than fair competition."
- Cat: "Fiercely independent and self-sufficient, with razor-sharp instincts and effortless grace. But aloof and emotionally withholding — connects only on its own terms, ignores others' needs, and can be cruel to smaller creatures for pure entertainment."
- Sloth: "Patient and energy-efficient, deeply content with simplicity and never wasteful. But avoids effort at all costs, procrastinates on everything, and lets opportunities pass by out of sheer inertia."

Focus on concrete behaviors: hoarding, stealing, nurturing, solitary hunting, pack tactics, deception, patience, aggression, playfulness, laziness, manipulation, loyalty, jealousy, vanity, cowardice, etc.`;

    try {
        const res1 = await fetch(REPLICATE_PROXY, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` },
            body: JSON.stringify({
                model: "openai/gpt-5-structured",
                input: { prompt, system_prompt: "Return JSON only." }
            })
        });
        const json1 = await res1.json();
        let list = json1.output.json_output;
        if (!Array.isArray(list)) list = Object.values(list);
        const descriptions = list.map(item => `${item.type}: ${item.description}`);
        
        const res2 = await fetch(REPLICATE_PROXY, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` },
            body: JSON.stringify({
                version: "beautyyuyanli/multilingual-e5-large:a06276a89f1a902d5fc225a9ca32b6e8e6292b7f3b136518878da97c458e2bad",
                input: { texts: JSON.stringify(descriptions) }
            })
        });
        const embeddings = (await res2.json()).output;

        const storage = { vectors: embeddings, texts: descriptions };
        localStorage.setItem("embeddings", JSON.stringify(storage));
        buildWorld(storage);
    } catch (e) {
        console.error(e);
    } finally {
        isRunning = false;
        document.body.style.cursor = "default";
    }
}

function buildWorld(data) {
    if (data.vectors.length < 5) return;
    const umap = new UMAP({
        nNeighbors: Math.min(15, data.vectors.length - 1),
        minDist: 0.4,
        nComponents: 3,
        random: new Math.seedrandom('fixed-seed')
    });
    const projection = umap.fit(data.vectors);
    const normalized = normalize3D(projection);

    points3D = normalized.map((coords, i) => {
        const fullText = data.texts[i];
        const colonIdx = fullText.indexOf(":");
        const name = colonIdx > 0 ? fullText.substring(0, colonIdx).trim() : `Animal ${i}`;
        const description = colonIdx > 0 ? fullText.substring(colonIdx + 1).trim() : fullText;
        return { x: coords[0], y: coords[1], z: coords[2], text: fullText, name, description };
    });

    mapTexts = data.texts;
    mapVectors = data.vectors;
}

// --- FIND ANIMAL WITH EMBEDDING ---
async function findAnimalWithEmbedding() {
    if (!descriptionArea) return;
    const text = descriptionArea.value.trim();
    if (!text || !mapVectors.length || !points3D.length) return;

    findAnimalBtn.disabled = true;
        findAnimalBtn.textContent = "Finding...";
        findAnimalBtn.style.cursor = "wait";

    try {
        const res = await fetch(REPLICATE_PROXY, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` },
            body: JSON.stringify({
                version: "beautyyuyanli/multilingual-e5-large:a06276a89f1a902d5fc225a9ca32b6e8e6292b7f3b136518878da97c458e2bad",
                input: { texts: JSON.stringify([text]) }
            })
        });
        const userEmbedding = (await res.json()).output[0];
        const scores = mapVectors.map(vec => cosineSimilarityEmbeddings(userEmbedding, vec));

        let bestIndex = 0, bestScore = 0;
        scores.forEach((s, i) => { if (s > bestScore) { bestScore = s; bestIndex = i; } });

        const SHARPNESS = 6;
        const weights = scores.map(s => Math.pow(Math.max(s, 0), SHARPNESS));
        const totalWeight = weights.reduce((a, b) => a + b, 0);

        let wx = 0, wy = 0, wz = 0;
        if (totalWeight > 0) {
            weights.forEach((w, i) => {
                const f = w / totalWeight;
                wx += f * points3D[i].x;
                wy += f * points3D[i].y;
                wz += f * points3D[i].z;
            });
        } else {
            wx = points3D[bestIndex].x;
            wy = points3D[bestIndex].y;
            wz = points3D[bestIndex].z;
        }

        animateUserTo(wx, wy, wz);
        if (matchLabel) {
            matchLabel.innerHTML = `Closest: <strong>${points3D[bestIndex].name}</strong> (${(bestScore * 100).toFixed(1)}% match)`;
        }
        lastMatchIndex = bestIndex;
    } catch (e) {
        console.error("Error finding animal:", e);
    } finally {
        findAnimalBtn.disabled = false;
        findAnimalBtn.textContent = "Find my animal";
        findAnimalBtn.style.cursor = "pointer";
    }
}

// --- USER POINT ANIMATION ---
let userAnimTarget = null;
let userAnimStart = null;
let userAnimStartTime = 0;
const userAnimDuration = 1200;

function animateUserTo(tx, ty, tz) {
    userAnimStart = {
        x: userPoint ? userPoint.x : 0,
        y: userPoint ? userPoint.y : 0,
        z: userPoint ? userPoint.z : -FIELD_SIZE
    };
    userAnimTarget = { x: tx, y: ty, z: tz };
    if (!userPoint) userPoint = { ...userAnimStart };
    userAnimStartTime = performance.now();
}

function updateUserAnimation() {
    if (!userAnimTarget || !userPoint) return;
    const t = Math.min((performance.now() - userAnimStartTime) / userAnimDuration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    userPoint.x = userAnimStart.x + (userAnimTarget.x - userAnimStart.x) * ease;
    userPoint.y = userAnimStart.y + (userAnimTarget.y - userAnimStart.y) * ease;
    userPoint.z = userAnimStart.z + (userAnimTarget.z - userAnimStart.z) * ease;
    if (t >= 1) userAnimTarget = null;
}

// --- RENDER LOOP ---
function renderLoop() {
    updateCameraAnimation();
    updateUserAnimation();

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Project animals
    const projected = [];
    for (let i = 0; i < points3D.length; i++) {
        const pt = points3D[i];
        const p = project(pt.x, pt.y, pt.z);
        if (p) projected.push({ i, p, pt });
    }
    projected.sort((a, b) => b.p.depth - a.p.depth);

    // Network lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
            const a = projected[i].pt, b = projected[j].pt;
            const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
            if (dist < FIELD_SIZE * 0.7) {
                ctx.beginPath();
                ctx.moveTo(projected[i].p.sx, projected[i].p.sy);
                ctx.lineTo(projected[j].p.sx, projected[j].p.sy);
                ctx.stroke();
            }
        }
    }

    // Animal dots (hover highlight only — no tooltip)
    hoveredIndex = -1;
    let closestDist = 25;

    for (const { i, p, pt } of projected) {
        const radius = Math.max(3, 8 * p.scale);
        const glowR = Math.max(6, 20 * p.scale);

        // Hover detection (highlight only, no tooltip)
        const dx = mouseX - p.sx, dy = mouseY - p.sy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < closestDist) { closestDist = d; hoveredIndex = i; }

        const isHovered = hoveredIndex === i;

        // Glow
        const grad = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, isHovered ? glowR * 1.8 : glowR);
        grad.addColorStop(0, `rgba(255, 255, 255, ${(isHovered ? 0.8 : 0.35) * p.scale})`);
        grad.addColorStop(0.5, `rgba(255, 255, 255, ${(isHovered ? 0.3 : 0.08) * p.scale})`);
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, isHovered ? glowR * 1.8 : glowR, 0, Math.PI * 2);
        ctx.fill();

        // Core dot — brighter on hover
        ctx.fillStyle = isHovered ? "#ffffff" : `rgba(255, 255, 255, ${Math.min(p.scale * 1.5, 0.9)})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, isHovered ? radius * 1.4 : radius, 0, Math.PI * 2);
        ctx.fill();

        // Name label
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(p.scale * 1.5, isHovered ? 1.0 : 0.6)})`;
        ctx.font = `${isHovered ? 'bold ' : ''}${Math.max(9, 12 * p.scale)}px sans-serif`;
        ctx.fillText(pt.name, p.sx + radius + 4, p.sy + 3);
    }

    // Change cursor when hovering a dot
    if (hoveredIndex >= 0 && !isDragging) {
        canvas.style.cursor = "pointer";
    } else if (!isDragging) {
        canvas.style.cursor = "grab";
    }

    // User point
    if (userPoint) {
        const up = project(userPoint.x, userPoint.y, userPoint.z);
        if (up) {
            const r = Math.max(5, 12 * up.scale);
            const glow = Math.max(12, 30 * up.scale);

            const grad = ctx.createRadialGradient(up.sx, up.sy, 0, up.sx, up.sy, glow);
            grad.addColorStop(0, `rgba(255, 215, 0, ${0.7 * up.scale})`);
            grad.addColorStop(0.5, `rgba(255, 180, 0, ${0.3 * up.scale})`);
            grad.addColorStop(1, "rgba(255, 215, 0, 0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(up.sx, up.sy, glow, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#FFD700";
            ctx.beginPath();
            ctx.arc(up.sx, up.sy, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(255, 230, 100, ${Math.min(up.scale * 2, 1)})`;
            ctx.font = `bold ${Math.max(10, 14 * up.scale)}px sans-serif`;
            ctx.fillText("YOU", up.sx + r + 5, up.sy + 4);
        }
    }

    requestAnimationFrame(renderLoop);
}

// --- START APP ---
setupUI();
requestAnimationFrame(renderLoop);

const existing = localStorage.getItem("embeddings");
if (existing) {
    const data = JSON.parse(existing);
    if (data.texts && data.texts.length >= 20) {
        buildWorld(data);
    } else {
        localStorage.removeItem("embeddings");
        createUniverse();
    }
} else {
    createUniverse();
}
