const PROXY_URL = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";

const IMAGE_MODEL = "google/nano-banana";

const TEXT_EMBEDDING_MODEL = "meta/llama-4-maverick-instruct";

const VISUAL_PROMPT_INSTRUCTION =
    "Rules: ONE line only. Use 8 to 18 words. Describe in abstract terms: mood, color, shape, texture—not a literal scene. Include at least 2 nouns and 1 adjective. Do not use the words short, prompt, description, or output. No quotes, no explanation. Thought: ";

function getImageStyleSuffix() {
    return ", highly abstract, non-representational, shapes and color over literal subject, raw imperfect handmade look, oil or acrylic, thick impasto, visible brushstrokes, rough tactile surface, heavy film grain, strong pixelation, accidental marks, not digital not smooth, atmospheric, fine art";
}

function buildImagePrompt(imagePrompt, conveyingThought) {
    const noText = "No text in image. No words, no letters, no writing, no typography, no captions. Purely visual scene only. ";
    return noText + "Highly abstract, non-representational painting of " + imagePrompt + ", shapes and mood not literal illustration. Raw, imperfect, handmade. Conveying: \"" + conveyingThought + "\"." + getImageStyleSuffix();
}

function isProxyConfigured() {
    return PROXY_URL && PROXY_URL !== "PASTE_PROXY_URL_HERE";
}

function isImageModelConfigured() {
    return IMAGE_MODEL && IMAGE_MODEL !== "PASTE_IMAGE_MODEL_HERE";
}

const PLACEHOLDER_IMAGE_DATAURL =
    "data:image/svg+xml," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect fill="%231a1a24" width="256" height="256"/><text x="50%25" y="50%25" fill="%23666" font-family="sans-serif" font-size="14" text-anchor="middle" dy=".3em">no proxy</text></svg>'
    );

const state = {
    items: [],
    links: [],
    mode: "realism",
    selectedId: null,
    status: ""
};

let itemIdCounter = 0;
let dragState = { active: false, itemEl: null, item: null, startX: 0, startY: 0, startTransform: null };
let nearestRecombineTarget = null;
let recombinePreviewEl = null;
let stageEl = null;
let itemsContainerEl = null;
let fileInputEl = null;

async function callProxy(data) {
    if (!PROXY_URL || PROXY_URL === "PASTE_PROXY_URL_HERE") {
        setStatus("Set PROXY_URL in main.js", true);
        return null;
    }
    try {
        const res = await fetch(PROXY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(t || "HTTP " + res.status);
        }
        return await res.json();
    } catch (err) {
        setStatus("Proxy: " + (err.message || "request failed"), true);
        console.error("callProxy error", err);
        return null;
    }
}

function getImageFromResponse(res) {
    if (!res) return { url: null, dataUrl: null };
    if (res.imageDataUrl) return { url: null, dataUrl: res.imageDataUrl };
    if (res.imageUrl) return { url: res.imageUrl, dataUrl: null };
    const out = res.output;
    if (typeof out === "string" && (out.startsWith("http") || out.startsWith("data:"))) {
        return out.startsWith("data:") ? { url: null, dataUrl: out } : { url: out, dataUrl: null };
    }
    if (Array.isArray(out) && out.length) {
        const first = out[0];
        if (typeof first === "string") {
            return first.startsWith("data:") ? { url: null, dataUrl: first } : { url: first, dataUrl: null };
        }
    }
    return { url: null, dataUrl: null };
}

function getTagsFromResponse(res) {
    if (!res) return { tags: null, embedding: null };
    if (res.tags) return { tags: res.tags, embedding: res.embedding || null };
    const out = res.output;
    if (typeof out === "string") {
        const trimmed = out.trim();
        const words = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
        return { tags: words.length ? words : null, embedding: res.embedding || null };
    }
    if (Array.isArray(out)) return { tags: out.filter(Boolean), embedding: res.embedding || null };
    return { tags: null, embedding: res.embedding || null };
}

const DEBUG_TEXT = true;

const TEXT_GEN_PARAMS = { max_new_tokens: 80, temperature: 0.7 };

const JUNK_WORDS = new Set(["short", "ok", "yes", "none", "n/a", "no", "idk", "unknown", "skip", "done"]);
const META_WORDS = new Set(["prompt", "description", "output", "response", "result", "text", "phrase", "title"]);

function normalizeOneLine(out) {
    if (out == null) return "";
    let text = "";
    if (typeof out === "string") text = out;
    else if (Array.isArray(out) && out.length) text = out.map(x => typeof x === "string" ? x : "").join("\n");
    const lines = text.split(/\n/).map(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 0) return lines[i];
    }
    return "";
}

function isUsablePhrase(s) {
    if (typeof s !== "string") return false;
    const t = s.trim();
    if (t.length < 12) return false;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 3 || words.length > 22) return false;
    const lower = t.toLowerCase();
    if (JUNK_WORDS.has(lower)) return false;
    const wordSet = new Set(words.map(w => w.toLowerCase().replace(/\W/g, "")));
    for (const meta of META_WORDS) {
        if (wordSet.has(meta)) return false;
    }
    return true;
}

function isUsableTitle(s) {
    if (typeof s !== "string") return false;
    const t = s.trim();
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 5) return false;
    if (JUNK_WORDS.has(t.toLowerCase())) return false;
    return true;
}

async function thoughtToVisualPrompt(thought) {
    if (!TEXT_EMBEDDING_MODEL || !thought) return null;
    const input = { prompt: VISUAL_PROMPT_INSTRUCTION + thought, ...TEXT_GEN_PARAMS };
    const res = await callProxy({ model: TEXT_EMBEDDING_MODEL, input });
    if (!res) return null;
    const raw = res.output;
    const line = normalizeOneLine(raw);
    if (DEBUG_TEXT) console.log("[thoughtToVisualPrompt] raw:", raw, "normalized:", line);
    if (!line) return null;
    return isUsablePhrase(line) ? line : null;
}

const COMBINE_THOUGHTS_INSTRUCTION =
    "Rules: ONE line only. Use 8 to 16 words. Your phrase must clearly include BOTH concepts below. Do not use the words short, prompt, description, or output. Example: 'fashion magazine' + 'angel on ocean' -> 'A fashion spread with an angel figure standing on an ocean shore'. First: ";
const SHORT_TITLE_INSTRUCTION = "Reduce this to 2 to 5 words only, a short title. Output nothing else. ";

async function promptToShortTitle(prompt) {
    if (!TEXT_EMBEDDING_MODEL || !prompt) return null;
    const input = { prompt: SHORT_TITLE_INSTRUCTION + prompt, ...TEXT_GEN_PARAMS };
    const res = await callProxy({ model: TEXT_EMBEDDING_MODEL, input });
    if (!res) return null;
    const raw = res.output;
    const line = normalizeOneLine(raw);
    if (DEBUG_TEXT) console.log("[promptToShortTitle] raw:", raw, "normalized:", line);
    if (!line) return null;
    return isUsableTitle(line) ? line : null;
}

async function combineThoughtsToJointPrompt(thoughtA, thoughtB) {
    if (!TEXT_EMBEDDING_MODEL || !thoughtA || !thoughtB) return null;
    const prompt = COMBINE_THOUGHTS_INSTRUCTION + thoughtA + " Second: " + thoughtB;
    const input = { prompt, ...TEXT_GEN_PARAMS };
    const res = await callProxy({ model: TEXT_EMBEDDING_MODEL, input });
    if (!res) return null;
    const raw = res.output;
    const line = normalizeOneLine(raw);
    if (DEBUG_TEXT) console.log("[combineThoughtsToJointPrompt] raw:", raw, "normalized:", line);
    if (!line) return null;
    return isUsablePhrase(line) ? line : null;
}

function nextId() {
    return "item_" + String(++itemIdCounter).padStart(3, "0");
}

function createItem(overrides = {}) {
    const now = Date.now();
    return {
        id: overrides.id ?? nextId(),
        prompt: overrides.prompt ?? "",
        title: overrides.title ?? null,
        semantics: Array.isArray(overrides.semantics) ? overrides.semantics : (overrides.semantics ? [overrides.semantics] : []),
        image: overrides.image ?? { url: null, dataUrl: null },
        transform: overrides.transform ?? { x: 120, y: 120, scale: 1, rot: 0, z: 0 },
        behavior: overrides.behavior ?? { anim: "float_lethargic", energy: 0.3, jitter: 0.1 },
        embedding: overrides.embedding ?? null,
        createdAt: overrides.createdAt ?? now,
        loading: overrides.loading ?? false,
        regenerating: overrides.regenerating ?? false
    };
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const den = Math.sqrt(na) * Math.sqrt(nb);
    return den === 0 ? 0 : dot / den;
}

function jaccardSimilarity(tagsA, tagsB) {
    const a = new Set((tagsA || []).map(t => String(t).toLowerCase()));
    const b = new Set((tagsB || []).map(t => String(t).toLowerCase()));
    if (a.size === 0 && b.size === 0) return 0;
    const inter = [...a].filter(x => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : inter / union;
}

function areItemsLinked(itemA, itemB) {
    const idA = itemA.id;
    const idB = itemB.id;
    for (const link of state.links) {
        const ids = new Set([link.from, link.to, link.child]);
        if (ids.has(idA) && ids.has(idB)) return true;
    }
    return false;
}

function similarity(itemA, itemB) {
    return areItemsLinked(itemA, itemB) ? 1 : 0;
}

const PANEL_WIDTH = 280;
const DRIFT_ATTRACTION = 0.0005;
const DRIFT_REPULSE_DIST = 140;
const DRIFT_REPULSE_STRENGTH = 0.045;
const BOUNDARY_PADDING = 60;
const MAX_VEL = 0.6;

function getOpenAreaCenter() {
    const w = stageEl ? stageEl.offsetWidth : window.innerWidth;
    const h = stageEl ? stageEl.offsetHeight : window.innerHeight;
    const openLeft = PANEL_WIDTH;
    const openWidth = Math.max(0, w - openLeft);
    return {
        centerX: openLeft + openWidth / 2,
        centerY: h / 2,
        openLeft,
        openWidth,
        openHeight: h
    };
}

function driftSimulation() {
    const stageWidth = stageEl ? stageEl.offsetWidth : window.innerWidth;
    const stageHeight = stageEl ? stageEl.offsetHeight : window.innerHeight;

    for (const item of state.items) {
        if (item._vel === undefined) item._vel = { vx: 0, vy: 0 };
        const v = item._vel;
        const t = item.transform;

        for (const other of state.items) {
            if (other.id === item.id) continue;
            const dx = other.transform.x - t.x;
            const dy = other.transform.y - t.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const sim = similarity(item, other);

            if (dist < DRIFT_REPULSE_DIST) {
                const rep = (DRIFT_REPULSE_DIST - dist) / DRIFT_REPULSE_DIST;
                v.vx -= (dx / dist) * DRIFT_REPULSE_STRENGTH * rep;
                v.vy -= (dy / dist) * DRIFT_REPULSE_STRENGTH * rep;
            } else {
                const pull = sim * DRIFT_ATTRACTION;
                v.vx += (dx / dist) * pull * Math.min(dist, 200);
                v.vy += (dy / dist) * pull * Math.min(dist, 200);
            }
        }

        v.vx *= 0.96;
        v.vy *= 0.96;
        const speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
        const maxVel = (item._kickFrames && item._kickFrames > 0) ? 200 : MAX_VEL;
        if (speed > maxVel) {
            v.vx = (v.vx / speed) * maxVel;
            v.vy = (v.vy / speed) * maxVel;
        }
        if (item._kickFrames > 0) item._kickFrames--;

        t.x += v.vx;
        t.y += v.vy;
        const minX = PANEL_WIDTH + BOUNDARY_PADDING;
        t.x = Math.max(minX, Math.min(stageWidth - BOUNDARY_PADDING, t.x));
        t.y = Math.max(BOUNDARY_PADDING, Math.min(stageHeight - BOUNDARY_PADDING, t.y));
    }
}

function getItemElement(id) {
    return document.querySelector(`[data-item-id="${id}"]`);
}

function applyTransform(el, item) {
    if (!el || !item) return;
    const t = item.transform;
    el.style.left = t.x + "px";
    el.style.top = t.y + "px";
    el.style.transform = `translate(-50%,-50%) scale(${t.scale}) rotate(${t.rot}deg)`;
    el.style.zIndex = String(t.z);
}

function applyAnimation(el, item) {
    const target = el?.querySelector(".item-inner") || el;
    if (!target) return;
    const anim = (item.behavior && item.behavior.anim) || "float_lethargic";
    const energy = (item.behavior && item.behavior.energy) ?? 0.3;
    const jitter = (item.behavior && item.behavior.jitter) ?? 0.1;
    target.style.animation = "none";
    target.offsetHeight;
    const duration = 4 + (1 - energy) * 4;
    if (anim === "float_lethargic" || anim === "float") {
        target.style.animation = `float ${duration}s ease-in-out infinite`;
    } else if (anim === "jitter" || anim.includes("jitter")) {
        target.style.animation = `jitter ${1 + jitter * 2}s ease-in-out infinite`;
    } else if (anim === "pulse" || anim.includes("pulse")) {
        target.style.animation = `pulse ${2}s ease-in-out infinite`;
    } else if (anim === "birth_pulse") {
        target.style.animation = "birth_pulse 1.2s ease-out forwards";
    } else {
        target.style.animation = `float ${duration}s ease-in-out infinite`;
    }
}

function createItemElement(item) {
    const div = document.createElement("div");
    div.className = "item";
    div.dataset.itemId = item.id;
    const inner = document.createElement("div");
    inner.className = "item-inner";
    const imgSrc = (item.image.dataUrl || item.image.url || "").replace(/"/g, "&quot;");
    inner.innerHTML =
      "<div class=\"item-image-wrap\">" +
      (item.loading || (!item.image.url && !item.image.dataUrl)
          ? "<div class=\"shimmer\"></div>"
          : "<img src=\"" + imgSrc + "\" alt=\"\" />") +
      "</div><span class=\"item-label\">" + escapeHtml((item.title != null ? item.title : item.prompt) || "—") + "</span>";
    div.appendChild(inner);
    applyTransform(div, item);
    applyAnimation(div, item);
    return div;
}

function updateItemImageInDOM(item) {
    const el = getItemElement(item.id);
    if (!el) return;
    const wrap = el.querySelector(".item-image-wrap");
    if (!wrap) return;
    const hasImage = item.image.dataUrl || item.image.url;
    if (item.loading || item.regenerating) {
        wrap.innerHTML = "<div class=\"shimmer\"></div>";
    } else if (hasImage) {
        const src = (item.image.dataUrl || item.image.url || "").replace(/"/g, "&quot;");
        wrap.innerHTML = "<img src=\"" + src + "\" alt=\"\" />";
    } else {
        wrap.innerHTML = "<div class=\"shimmer\"></div>";
    }
    const label = el.querySelector(".item-label");
    if (label) label.textContent = (item.title != null ? item.title : item.prompt) || "—";
}

function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

async function summonItem() {
    const input = document.getElementById("summon-input");
    const prompt = (input && input.value && input.value.trim()) || "Abstract fragment";
    input.value = "";

    const area = getOpenAreaCenter();
    const spread = 120;
    const item = createItem({
        prompt,
        semantics: [prompt.slice(0, 20).toLowerCase().replace(/\s+/g, "_") || "abstract"],
        transform: {
            x: area.centerX + (Math.random() - 0.5) * spread,
            y: area.centerY + (Math.random() - 0.5) * spread,
            scale: 1,
            rot: 0,
            z: state.items.length
        },
        loading: true
    });
    state.items.push(item);
    if (!itemsContainerEl) {
        setStatus("Error: stage not ready", true);
        return;
    }
    const el = createItemElement(item);
    itemsContainerEl.appendChild(el);
    bindItemEvents(el, item);
    setStatus("Summoning…", false);

    let imagePrompt = prompt;
    if (isProxyConfigured()) {
        if (TEXT_EMBEDDING_MODEL) {
            const visualPrompt = await thoughtToVisualPrompt(prompt);
            if (visualPrompt) {
                imagePrompt = visualPrompt;
                const words = visualPrompt.split(/\s+/).filter(Boolean);
                if (words.length) {
                    item.semantics = words.slice(0, 10);
                    if (words.some(w => /nervous|jitter|chaos|frantic/i.test(w))) {
                        item.behavior = { ...item.behavior, anim: "jitter", jitter: 0.2 };
                    }
                }
            }
        }

        if (isImageModelConfigured()) {
            const fullImagePrompt = buildImagePrompt(imagePrompt, prompt);
            const imgRes = await callProxy({
                model: IMAGE_MODEL,
                input: { prompt: fullImagePrompt }
            });
            const img = getImageFromResponse(imgRes);
            if (img.url || img.dataUrl) {
                item.image.url = img.url;
                item.image.dataUrl = img.dataUrl;
            }
        }
    }

    item.loading = false;
    if (!item.image.dataUrl && !item.image.url) {
        item.image.dataUrl = PLACEHOLDER_IMAGE_DATAURL;
    }
    updateItemImageInDOM(item);
    applyAnimation(getItemElement(item.id), item);
    setStatus(isProxyConfigured() ? "" : "No proxy — using placeholder", false);
    updateHUD();
}

async function regenerateImageForItem(item) {
    item.regenerating = true;
    updateItemImageInDOM(item);
    if (isProxyConfigured() && isImageModelConfigured()) {
        let imagePrompt = item.prompt;
        if (TEXT_EMBEDDING_MODEL) {
            const visualPrompt = await thoughtToVisualPrompt(item.prompt);
            if (visualPrompt) imagePrompt = visualPrompt;
        }
        const fullImagePrompt = buildImagePrompt(imagePrompt, item.prompt);
        const res = await callProxy({
            model: IMAGE_MODEL,
            input: { prompt: fullImagePrompt }
        });
        const img = getImageFromResponse(res);
        if (img.url || img.dataUrl) {
            item.image.url = img.url;
            item.image.dataUrl = img.dataUrl;
        }
    }
    item.regenerating = false;
    if (!item.image.dataUrl && !item.image.url) {
        item.image.dataUrl = PLACEHOLDER_IMAGE_DATAURL;
    }
    updateItemImageInDOM(item);
}

const RECOMBINE_RADIUS = 120;

function findNearestRecombineTarget(centerX, centerY, excludeId) {
    let best = null;
    let bestDist = RECOMBINE_RADIUS + 1;
    for (const item of state.items) {
        if (item.id === excludeId) continue;
        const dx = item.transform.x - centerX;
        const dy = item.transform.y - centerY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
            bestDist = d;
            best = item;
        }
    }
    return best;
}

function showRecombinePreview(fromItem, toItem) {
    if (!recombinePreviewEl) return;
    const tx = toItem.transform.x;
    const ty = toItem.transform.y;
    const fx = fromItem.transform.x;
    const fy = fromItem.transform.y;
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    recombinePreviewEl.innerHTML =
        "<div class=\"recombine-line\" style=\"left:" + fx + "px;top:" + fy + "px;width:" + len + "px;transform:rotate(" + angle + "deg)\"></div>";
    recombinePreviewEl.classList.add("visible");
}

function hideRecombinePreview() {
    if (recombinePreviewEl) {
        recombinePreviewEl.classList.remove("visible");
        recombinePreviewEl.innerHTML = "";
    }
}

async function recombineItems(itemA, itemB) {
    setStatus("Recombining…", false);
    const fallbackPrompt = itemA.prompt + " + " + itemB.prompt;
    let jointPrompt = fallbackPrompt;
    if (isProxyConfigured() && TEXT_EMBEDDING_MODEL) {
        const combined = await combineThoughtsToJointPrompt(itemA.prompt, itemB.prompt);
        if (combined && isUsablePhrase(combined)) jointPrompt = combined;
    }
    let imagePrompt = jointPrompt;
    if (isProxyConfigured() && TEXT_EMBEDDING_MODEL) {
        const visualPrompt = await thoughtToVisualPrompt(jointPrompt);
        if (visualPrompt && isUsablePhrase(visualPrompt)) imagePrompt = visualPrompt;
    }
    const fullImagePrompt = buildImagePrompt(imagePrompt, jointPrompt);
    let imageRes = null;
    if (isProxyConfigured() && isImageModelConfigured()) {
        imageRes = await callProxy({
            model: IMAGE_MODEL,
            input: { prompt: fullImagePrompt }
        });
    }
    let shortTitle = null;
    if (TEXT_EMBEDDING_MODEL && jointPrompt) {
        const fromModel = await promptToShortTitle(jointPrompt);
        if (fromModel && isUsableTitle(fromModel)) shortTitle = fromModel;
    }
    if (!shortTitle && jointPrompt) {
        const words = jointPrompt.split(/\s+/).filter(Boolean);
        shortTitle = words.slice(0, 4).join(" ") || null;
    }
    setStatus("", false);

    const midX = (itemA.transform.x + itemB.transform.x) / 2;
    const midY = (itemA.transform.y + itemB.transform.y) / 2;
    const maxZ = Math.max(itemA.transform.z, itemB.transform.z) + 1;
    const mergedTags = [...new Set([...(itemA.semantics || []), ...(itemB.semantics || [])])];
    const img = getImageFromResponse(imageRes);
    const childTags = imagePrompt !== jointPrompt
        ? imagePrompt.split(/\s+/).filter(Boolean).slice(0, 10)
        : null;

    const child = createItem({
        prompt: jointPrompt,
        title: shortTitle,
        semantics: (childTags && childTags.length) ? childTags : mergedTags,
        image: { url: img.url || null, dataUrl: img.dataUrl || null },
        transform: { x: midX, y: midY, scale: 1, rot: 0, z: maxZ },
        behavior: { anim: "birth_pulse", energy: 0.4, jitter: 0.1 },
        embedding: null
    });
    if (!child.image.dataUrl && !child.image.url) {
        child.image.dataUrl = PLACEHOLDER_IMAGE_DATAURL;
    }
    state.items.push(child);
    state.links.push({ from: itemA.id, to: itemB.id, child: child.id, type: "recombine" });

    const kickSpeed = 6;
    const ax = itemA.transform.x - midX;
    const ay = itemA.transform.y - midY;
    const distA = Math.sqrt(ax * ax + ay * ay) || 1;
    itemA._vel = { vx: (ax / distA) * kickSpeed, vy: (ay / distA) * kickSpeed };
    itemA._kickFrames = 35;
    const bx = itemB.transform.x - midX;
    const by = itemB.transform.y - midY;
    const distB = Math.sqrt(bx * bx + by * by) || 1;
    itemB._vel = { vx: (bx / distB) * kickSpeed, vy: (by / distB) * kickSpeed };
    itemB._kickFrames = 35;

    const el = createItemElement(child);
    itemsContainerEl.appendChild(el);
    bindItemEvents(el, child);
    applyAnimation(el, child);
    state.selectedId = child.id;
    updateSelectionUI();
    updateHUD();
}

function getItemCenter(item) {
    const el = getItemElement(item.id);
    if (!el) return { x: item.transform.x, y: item.transform.y };
    const r = el.getBoundingClientRect();
    const stageR = stageEl.getBoundingClientRect();
    return {
        x: item.transform.x,
        y: item.transform.y
    };
}

function bindItemEvents(el, item) {
    el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (e.button !== 0) return;
        if (state.selectedId !== item.id) {
            state.selectedId = item.id;
            updateSelectionUI();
            updateHUD();
        }
        dragState.active = true;
        dragState.itemEl = el;
        dragState.item = item;
        dragState.startX = e.clientX;
        dragState.startY = e.clientY;
        dragState.startTransform = { ...item.transform };
        el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e) => {
        if (!dragState.active || dragState.item !== item) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        item.transform.x = dragState.startTransform.x + dx;
        item.transform.y = dragState.startTransform.y + dy;
        applyTransform(el, item);

        const nearest = findNearestRecombineTarget(item.transform.x, item.transform.y, item.id);
        if (nearest !== nearestRecombineTarget) {
            nearestRecombineTarget = nearest;
            state.items.forEach(i => getItemElement(i.id)?.classList.remove("recombine-target"));
            if (nearest) {
                getItemElement(nearest.id)?.classList.add("recombine-target");
                showRecombinePreview(item, nearest);
            } else {
                hideRecombinePreview();
            }
        }
    });

    el.addEventListener("pointerup", (e) => {
        if (e.button !== 0) return;
        if (dragState.active && dragState.item === item) {
            const nearest = findNearestRecombineTarget(item.transform.x, item.transform.y, item.id);
            if (nearest) {
                recombineItems(item, nearest);
            }
            dragState.active = false;
            dragState.itemEl = null;
            dragState.item = null;
            nearestRecombineTarget = null;
            state.items.forEach(i => getItemElement(i.id)?.classList.remove("recombine-target"));
            hideRecombinePreview();
        }
        el.releasePointerCapture(e.pointerId);
    });

    el.addEventListener("pointercancel", () => {
        dragState.active = false;
        nearestRecombineTarget = null;
        hideRecombinePreview();
    });
}

function updateSelectionUI() {
    state.items.forEach(item => {
        const el = getItemElement(item.id);
        if (el) el.classList.toggle("selected", state.selectedId === item.id);
    });
}

function getSelectedItem() {
    return state.items.find(i => i.id === state.selectedId);
}

document.addEventListener("keydown", (e) => {
    const item = getSelectedItem();
    if (!item) return;
    const el = getItemElement(item.id);
    if (!el) return;
    if (e.key === "[") {
        item.transform.z = Math.max(0, item.transform.z - 1);
        applyTransform(el, item);
        e.preventDefault();
    } else if (e.key === "]") {
        item.transform.z += 1;
        applyTransform(el, item);
        e.preventDefault();
    }
});

function initDOM() {
    itemsContainerEl = document.getElementById("items-container");
    stageEl = document.getElementById("stage");
    recombinePreviewEl = document.getElementById("recombine-preview");
    fileInputEl = document.getElementById("file-input");

    if (!itemsContainerEl) {
        setStatus("Error: #items-container not found", true);
        return;
    }

    itemsContainerEl.addEventListener("wheel", (e) => {
        const item = getSelectedItem();
        if (!item || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        item.transform.scale = Math.max(0.3, Math.min(3, item.transform.scale + delta));
        const el = getItemElement(item.id);
        if (el) applyTransform(el, item);
    }, { passive: false });

    if (fileInputEl) {
        fileInputEl.addEventListener("change", () => {
            const f = fileInputEl.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => loadState(r.result);
            r.readAsText(f);
            fileInputEl.value = "";
        });
    }

    document.getElementById("btn-summon")?.addEventListener("click", () => summonItem());
    document.getElementById("summon-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") summonItem();
    });
    document.getElementById("btn-load")?.addEventListener("click", () => fileInputEl?.click());

    seedDemoItems();
    tick();
}

function serializeState() {
    return JSON.stringify({
        items: state.items.map(item => ({
            ...item,
            loading: false,
            regenerating: false,
            _vel: undefined
        })),
        links: state.links,
        mode: state.mode,
        selectedId: state.selectedId
    }, null, 2);
}

function loadState(jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        state.items = (data.items || []).map(it => {
            const item = createItem({ ...it, id: it.id });
            item.id = it.id;
            item.loading = false;
            item.regenerating = false;
            delete item._vel;
            return item;
        });
        state.links = data.links || [];
        state.mode = data.mode === "cubist" ? "cubist" : "realism";
        state.selectedId = data.selectedId || null;
        const numIds = state.items.map(i => parseInt(i.id.replace(/\D/g, ""), 10)).filter(Boolean);
        if (numIds.length) itemIdCounter = Math.max(itemIdCounter, ...numIds);

        itemsContainerEl.innerHTML = "";
        state.items.forEach(item => {
            const el = createItemElement(item);
            itemsContainerEl.appendChild(el);
            bindItemEvents(el, item);
        });
        updateSelectionUI();
        updateHUD();
        setStatus("Loaded", false);
    } catch (err) {
        setStatus("Load failed: " + err.message, true);
    }
}

function saveJSON() {
    const blob = new Blob([serializeState()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "delaroche-ghost.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Saved", false);
}

function setStatus(msg, isError) {
    state.status = msg;
    const el = document.getElementById("hud-status");
    if (el) {
        el.textContent = msg;
        el.classList.toggle("error", isError);
        el.classList.toggle("loading", msg && !isError);
    }
}

function updateHUD() {
    const selEl = document.getElementById("hud-selected");
    if (selEl) selEl.textContent = "Selected: " + (state.selectedId || "—");
}

function seedDemoItems() {
    if (isProxyConfigured() || state.items.length > 0) return;
    if (!itemsContainerEl) return;
    const area = getOpenAreaCenter();
    const demos = [
        { prompt: "The weight of a Tuesday", semantics: ["heavy", "gray", "metallic"] },
        { prompt: "A forgotten window", semantics: ["dust", "light", "quiet"] },
        { prompt: "Abstract fragment", semantics: ["abstract", "shape"] }
    ];
    const radius = 130;
    demos.forEach((d, i) => {
        const angle = (i / demos.length) * Math.PI * 2 - Math.PI / 2;
        const item = createItem({
            prompt: d.prompt,
            semantics: d.semantics,
            image: { url: null, dataUrl: PLACEHOLDER_IMAGE_DATAURL },
            transform: {
                x: area.centerX + Math.cos(angle) * radius,
                y: area.centerY + Math.sin(angle) * radius,
                scale: 1,
                rot: 0,
                z: i
            }
        });
        state.items.push(item);
        const el = createItemElement(item);
        itemsContainerEl.appendChild(el);
        bindItemEvents(el, item);
    });
    updateHUD();
}

function tick() {
    if (!dragState.active) {
        driftSimulation();
        state.items.forEach(item => {
            const el = getItemElement(item.id);
            if (el) applyTransform(el, item);
        });
    }
    requestAnimationFrame(tick);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDOM);
} else {
    initDOM();
}