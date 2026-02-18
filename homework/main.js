import { UMAP } from "https://cdn.skypack.dev/umap-js";

// --- CONFIGURATION ---
const REPLICATE_PROXY = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
const AUTH_TOKEN = "YOUR_TOKEN_HERE"; // Replace with your active token

let canvas, ctx, feedback, mainField;
let sentenceDivs = [];
let isRunning = false;

// Initialize UI and Canvas
function setupUI() {
    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.append(canvas);
    ctx = canvas.getContext('2d');

    // Toolbar Container
    let topBar = document.createElement('div');
    Object.assign(topBar.style, {
        position: "fixed", top: "0", left: "0", right: "0", zIndex: "1001",
        background: "rgba(20, 20, 20, 0.9)", color: "white", padding: "15px",
        display: "flex", gap: "15px", alignItems: "center", borderBottom: "1px solid #444"
    });
    document.body.append(topBar);

    mainField = document.createElement('input');
    mainField.placeholder = "Enter a vibe (e.g. Solarpunk, Stoicism)...";
    Object.assign(mainField.style, { flex: "1", padding: "10px", borderRadius: "4px", border: "none" });
    
    let addBtn = document.createElement('button');
    addBtn.textContent = "✨ Populate World";
    
    let clearBtn = document.createElement('button');
    clearBtn.textContent = "Clear Map";

    feedback = document.createElement('div');
    feedback.style.fontSize = "12px";
    feedback.style.color = "#aaa";
    feedback.innerHTML = "Map ready. Enter a concept to seed the social space.";

    topBar.append(mainField, addBtn, clearBtn, feedback);

    // Button Events
    addBtn.onclick = () => createUniverse(mainField.value);
    clearBtn.onclick = () => {
        localStorage.removeItem("embeddings");
        location.reload();
    };
}

async function createUniverse(concept) {
    if (!concept || isRunning) return;
    isRunning = true;
    feedback.innerHTML = "Generating 36 personas...";
    document.body.style.cursor = "wait";

    const prompt = `Give me a flat json object with 36 short descriptions of perspectives about ${concept}. 
    Organize into 6 different types of people. Use only fields 'description' and 'type'.`;

    try {
        // 1. GENERATION PHASE
        const res1 = await fetch(REPLICATE_PROXY, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` },
            body: JSON.stringify({
                model: "openai/gpt-5-structured", // or gpt-4o
                input: { prompt: prompt, system_prompt: "Return JSON only." }
            })
        });
        
        const json1 = await res1.json();
        let list = json1.output.json_output;
        if (!Array.isArray(list)) list = Object.values(list);

        const descriptions = list.map(item => `${item.type}: ${item.description}`);
        
        // 2. EMBEDDING PHASE
        feedback.innerHTML = "Calculating spatial coordinates (Embeddings)...";
        const res2 = await fetch(REPLICATE_PROXY, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` },
            body: JSON.stringify({
                version: "beautyyuyanli/multilingual-e5-large:a06276a89f1a902d5fc225a9ca32b6e8e6292b7f3b136518878da97c458e2bad",
                input: { texts: JSON.stringify(descriptions) }
            })
        });

        const embeddings = (await res2.json()).output;

        // 3. PERSISTENCE
        let storage = JSON.parse(localStorage.getItem("embeddings") || '{"vectors":[], "texts":[]}');
        storage.vectors.push(...embeddings);
        storage.texts.push(...descriptions);
        localStorage.setItem("embeddings", JSON.stringify(storage));

        // 4. PROJECTION (UMAP)
        runUMAP(storage);

    } catch (e) {
        feedback.innerHTML = "Error: " + e.message;
        console.error(e);
    } finally {
        isRunning = false;
        document.body.style.cursor = "default";
        feedback.innerHTML = "World updated.";
    }
}

function runUMAP(data) {
    if (data.vectors.length < 5) {
        feedback.innerHTML = "Add more data points to see clusters.";
        return;
    }

    const umap = new UMAP({
        nNeighbors: 15,
        minDist: 0.3,
        nComponents: 2,
        random: new Math.seedrandom('fixed-seed') // Keep map stable
    });

    const projection = umap.fit(data.vectors);
    const normalized = normalize(projection);

    renderMap(normalized, data.texts);
}

function renderMap(coords, texts) {
    // Clear old labels
    sentenceDivs.forEach(div => div.remove());
    sentenceDivs = [];

    coords.forEach((pos, i) => {
        const dot = document.createElement('div');
        Object.assign(dot.style, {
            position: "absolute",
            left: `${pos[0] * 80 + 10}%`,
            top: `${pos[1] * 80 + 10}%`,
            width: "8px", height: "8px", background: "cyan", borderRadius: "50%",
            boxShadow: "0 0 10px cyan", cursor: "pointer", zIndex: "5"
        });

        const label = document.createElement('div');
        label.className = "label";
        label.innerHTML = texts[i];
        Object.assign(label.style, {
            position: "absolute", left: "12px", top: "-5px", width: "150px",
            color: "white", fontSize: "10px", opacity: "0", transition: "opacity 0.2s",
            pointerEvents: "none", background: "rgba(0,0,0,0.7)", padding: "5px"
        });

        dot.append(label);
        dot.onmouseenter = () => label.style.opacity = "1";
        dot.onmouseleave = () => label.style.opacity = "0";

        document.body.append(dot);
        sentenceDivs.push(dot);
    });
}

function normalize(points) {
    let min = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))];
    let max = [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
    return points.map(p => [
        (p[0] - min[0]) / (max[0] - min[0]),
        (p[1] - min[1]) / (max[1] - min[1])
    ]);
}

// Start app
setupUI();
const existing = localStorage.getItem("embeddings");
if (existing) runUMAP(JSON.parse(existing));