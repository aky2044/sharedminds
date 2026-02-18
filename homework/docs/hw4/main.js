//setup
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

//mouse hover detection
let mouseX = 0;
let mouseY = 0;
let hoveredNode = null;
let isFetching = false;

canvas.addEventListener("mousemove", (e) => 
    {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
        hoveredNode = getHoveredNode();
    });


//given mouse position, are we on top of a node? (use node's current scale for hit box, multi-line aware)
function getHoveredNode() 
{
    for (let i = 0; i < nodes.length; i++) 
    {
        const n = nodes[i];
        const scale = n.permanentScale ?? n.scale ?? 1;
        const { width, height } = getTextBlockSize(n.text, scale);
        const left = n.x - width / 2;
        const right = n.x + width / 2;
        const top = n.y - height / 2;
        const bottom = n.y + height / 2;

        if (mouseX > left && mouseX < right && mouseY > top && mouseY < bottom) 
        {
            return n;
        }
    }
    return null;
}

//mouse click detection
canvas.addEventListener("mousedown", async () => 
{
    const clickedNode = getHoveredNode();
    if (clickedNode)
    {
        await expandNode(clickedNode);
    }
});

// Replicate proxy: your backend calls Replicate and returns the model output (no API key in frontend)
const REPLICATE_PROXY_URL = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
const REPLICATE_MODEL = "meta/llama-4-maverick-instruct";

const CHATGPT_ASSOCIATIONS_PROMPT =
`Return ONLY valid JSON. No markdown, no commentary.

Pattern: Immediate next thought (stream of consciousness). Given a word, list short phrases that might naturally pop into someone's mind. These are not definitions or descriptions. They can be objects, memories, actions, places, or random associations.

Example format (follow exactly):
{"children":[{"text":"...", "type":"synonym"}]}

Types allowed: synonym, sensory, memory, metaphor, related
Rules:
- exactly 2 per type (10 total)
- each text is 1 to 3 lowercase words, no punctuation
- no duplicates
- do not include the input word

Word: `;

async function getAssociationsAI(word) {
  const prompt = CHATGPT_ASSOCIATIONS_PROMPT + (word || "").trim();

  const data = {
    model: REPLICATE_MODEL,
    input: {
      prompt: prompt
    }
  };

  console.log("sending to replicate:", data);

  try {
    const response = await fetch(REPLICATE_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!response.ok) return fallbackAssociations(word);

    const prediction = await response.json();
    console.log("prediction:", prediction);
    if (!prediction.output) return fallbackAssociations(word);

    // Replicate output is usually prediction.output (string OR array of strings)
    let raw = prediction.output;
    let text = "";

    if (typeof raw === "string") text = raw;
    else if (Array.isArray(raw)) text = raw.join("");

    // Extract JSON object if the model adds extra text
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return fallbackAssociations(word);

    const parsed = JSON.parse(text.slice(start, end + 1));

    if (!parsed || !Array.isArray(parsed.children)) return fallbackAssociations(word);

    const children = parsed.children.filter(c => c && typeof c.text === "string");
    const seen = new Set();
    const cleaned = children.filter(c => {
      const t = (c.text || "").trim().toLowerCase();
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    return {
      children: cleaned.map(c => ({
        text: (c.text || "").trim().toLowerCase().slice(0, 80),
        type: ["synonym", "sensory", "memory", "metaphor", "related"].includes(c.type) ? c.type : "related"
      }))
    };
  } catch (e) {
    console.error(e);
    return fallbackAssociations(word);
  }
}

function fallbackAssociations(word) 
{
    const list = getAsssociations(word);
    return { children: list.map(text => ({ text, type: "related" })) };
}

// fake association function (fallback when AI unavailable)
function getAsssociations(word)
{
    const map = 
    {
        ocean: ["sea", "blue", "salt", "tide", "vast", "drift"],
        sea: ["waves", "current", "ship", "fish", "whale", "kraken"],
        blue: ["sky", "water", "ocean", "sea", "skyline", "oceanic"],
        salt: ["salty", "saltwater", "ocean", "sea", "saltlake", "saltwater"],
        tide: ["high", "low", "ocean", "sea", "tides", "tidepool"],
        vast: ["large", "ocean", "sea", "vastocean", "vastsea", "vastoceanic"],
        drift: ["driftwood", "driftwood", "driftwood", "driftwood", "driftwood", "driftwood"],
        waves: ["wave", "waves", "wave", "waves", "wave", "waves"],
        current: ["current", "current", "current", "current", "current", "current"],
        ship: ["ship", "ship", "ship", "ship", "ship", "ship"],
    };
    return map[word.toLowerCase()] || ["echo", "near", "elsewhere"];
}

const BASE_FONT_SIZE = 24;
const TEXT_PADDING = 1;
const LINE_HEIGHT_MULTIPLIER = 1.15;

// multi-word text stacks vertically (e.g. "roast chicken" → roast on one line, chicken on next)
function getTextBlockSize(text, scale) 
{
    const size = BASE_FONT_SIZE * (scale ?? 1);
    ctx.font = size + "px system-ui";
    const raw = (text || "").trim();
    const lines = raw.indexOf(" ") >= 0 ? raw.split(/\s+/).filter(Boolean) : [raw];
    let width = 0;
    for (let i = 0; i < lines.length; i++) 
    {
        const w = ctx.measureText(lines[i]).width;
        if (w > width) width = w;
    }
    const lineHeight = size * LINE_HEIGHT_MULTIPLIER;
    const height = lines.length * lineHeight;
    return { width, height, lines, lineHeight };
}

// get bounding box for a node (left, right, top, bottom) with padding
function getNodeBox(node, x, y) 
{
    const scale = node ? (node.scale ?? 1) : 1;
    const text = node ? (node.text || "") : "";
    const { width: w, height: h } = getTextBlockSize(text, scale);
    return {
        left: x - w / 2 - TEXT_PADDING,
        right: x + w / 2 + TEXT_PADDING,
        top: y - h / 2 - TEXT_PADDING,
        bottom: y + h / 2 + TEXT_PADDING
    };
}

function boxesOverlap(a, b) 
{
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// check if position (x,y) for a new node with text would overlap any existing node
function overlapsAny(text, x, y) 
{
    const temp = { text: text, scale: 1 };
    const box = getNodeBox(temp, x, y);
    for (let i = 0; i < nodes.length; i++) 
    {
        const other = getNodeBox(nodes[i], nodes[i].x, nodes[i].y);
        if (boxesOverlap(box, other)) return true;
    }
    return false;
}

// hue shifts with each expansion so you can see which thoughts go together
let expandHue = 200;

const FADE_IN_DURATION_MS = 500;
const HOVER_GRACE_PERIOD_MS = 10000;

function spawnPlaceholders(parent, count, hue) 
{
    const placeholders = [];
    const baseRadius = 65;
    const radiusSpread = 70;
    const placeholderText = "…";

    for (let i = 0; i < count; i++) 
    {
        let x, y;
        let attempts = 0;
        const maxAttempts = 80;
        do 
        {
            const angle = Math.random() * Math.PI * 2;
            const extra = attempts > 40 ? (attempts - 40) * 3 : 0;
            const t = 0.5 + 0.5 * Math.random();
            const radius = baseRadius + radiusSpread * t + extra;
            x = parent.x + Math.cos(angle) * radius;
            y = parent.y + Math.sin(angle) * radius;
            attempts++;
        } while (attempts < maxAttempts && overlapsAny(placeholderText, x, y));

        const n = {
            text: placeholderText,
            x: x,
            y: y,
            expanded: false,
            scale: 1,
            permanentScale: 1,
            hue: hue,
            isPlaceholder: true
        };
        nodes.push(n);
        placeholders.push(n);
    }
    return placeholders;
}

//expand node function — placeholders first, then replace when AI returns
async function expandNode(parent) 
{
    if (parent.expanded) return;
    parent.expanded = true;

    expandHue = (expandHue + 38) % 360;
    const groupHue = expandHue;
    if (parent.hue == null) parent.hue = groupHue;

    const count = 6 + Math.floor(Math.random() * 5);
    const placeholders = spawnPlaceholders(parent, count, groupHue);
    draw();

    isFetching = true;
    try 
    {
        const { children } = await getAssociationsAI(parent.text);
        const now = performance.now();

        for (let i = 0; i < placeholders.length; i++) 
        {
            placeholders[i].text = children[i]?.text ?? "";
            placeholders[i].isPlaceholder = false;
            placeholders[i].fadeInStart = now;
            placeholders[i].spawnedAt = now;
        }

        for (let i = nodes.length - 1; i >= 0; i--) 
        {
            if (nodes[i].text === "") nodes.splice(i, 1);
        }

        resolvePushes();
        draw();
    } 
    finally 
    {
        isFetching = false;
    }
}



//resize canvas
function resize() 
{
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (nodes.length > 0) 
    {
        nodes[0].x = canvas.width / 2;
        nodes[0].y = canvas.height / 2;
    }
    draw();
}

//words to display (mother node added when user submits the start text box)
const nodes = [];

// permanent scale: grows while hovered, never resets
const hoverGrowthRate = 0.4;   // scale units per second while hovered
const maxPermanentScale = 2.8;
let lastTime = performance.now();

const PUSH_GAP = 2; // extra pixels so text never touches after push

// push node "other" away from node "from" so their boxes no longer overlap (both axes + gap)
function pushApart(from, other) 
{
    const boxFrom = getNodeBox(from, from.x, from.y);
    const boxOther = getNodeBox(other, other.x, other.y);
    if (!boxesOverlap(boxFrom, boxOther)) return;

    const overlapLeft = boxOther.right - boxFrom.left;
    const overlapRight = boxFrom.right - boxOther.left;
    const overlapTop = boxOther.bottom - boxFrom.top;
    const overlapBottom = boxFrom.bottom - boxOther.top;

    const overlapX = Math.min(overlapLeft, overlapRight);
    const overlapY = Math.min(overlapTop, overlapBottom);
    const nudge = overlapX + PUSH_GAP;
    const nudgeY = overlapY + PUSH_GAP;

    other.x += other.x > from.x ? nudge : -nudge;
    other.y += other.y > from.y ? nudgeY : -nudgeY;
}

// resolve overlaps until none remain (both axes + extra passes for chains)
function resolvePushes() 
{
    const n = nodes.length;
    const maxPasses = 15;
    for (let pass = 0; pass < maxPasses; pass++) 
    {
        let anyOverlap = false;
        if (hoveredNode) 
        {
            const boxHovered = getNodeBox(hoveredNode, hoveredNode.x, hoveredNode.y);
            for (let i = 0; i < n; i++) 
            {
                const other = nodes[i];
                if (other === hoveredNode) continue;
                const boxOther = getNodeBox(other, other.x, other.y);
                if (boxesOverlap(boxHovered, boxOther)) 
                {
                    pushApart(hoveredNode, other);
                    anyOverlap = true;
                }
            }
        }
        for (let i = 0; i < n; i++) 
        {
            for (let j = i + 1; j < n; j++) 
            {
                const a = nodes[i], b = nodes[j];
                const boxA = getNodeBox(a, a.x, a.y), boxB = getNodeBox(b, b.x, b.y);
                if (boxesOverlap(boxA, boxB)) 
                {
                    pushApart(a, b);
                    pushApart(b, a);
                    anyOverlap = true;
                }
            }
        }
        if (!anyOverlap) break;
    }
}

function draw()
{
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // permanent scale: grow only while hovered (skip during 5s grace period after spawn)
    for (let i = 0; i < nodes.length; i++) 
    {
        const n = nodes[i];
        n.permanentScale = n.permanentScale ?? 1;
        const inGracePeriod = n.spawnedAt != null && (now - n.spawnedAt < HOVER_GRACE_PERIOD_MS);
        if (n === hoveredNode && !isFetching && !n.isPlaceholder && !inGracePeriod) 
        {
            n.permanentScale = Math.min(maxPermanentScale, n.permanentScale + hoverGrowthRate * dt);
        }
        n.scale = n.permanentScale;
    }

    resolvePushes();

    //background
    ctx.fillStyle = "#FFFFFF"; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const baseSize = BASE_FONT_SIZE;
    for (let i = 0; i < nodes.length; i++) 
    {
        const n = nodes[i];
        let alpha = 1;
        if (n.fadeInStart != null) 
        {
            const elapsed = now - n.fadeInStart;
            alpha = Math.min(1, elapsed / FADE_IN_DURATION_MS);
            if (alpha >= 1) n.fadeInStart = null;
        }
        if (n.hue != null) 
        {
            ctx.fillStyle = "hsl(" + n.hue + ", 52%, 32%)";
        } 
        else 
        {
            ctx.fillStyle = "black";
        }
        ctx.globalAlpha = alpha;
        const size = baseSize * n.scale;
        ctx.font = size + "px system-ui";
        const block = getTextBlockSize(n.text, n.scale);
        const startY = n.y - (block.height / 2) + block.lineHeight / 2;
        for (let j = 0; j < block.lines.length; j++) 
        {
            const lineY = startY + j * block.lineHeight;
            ctx.fillText(block.lines[j], n.x, lineY);
        }
        ctx.globalAlpha = 1;
    }
}

function tick() 
{
    draw();
    requestAnimationFrame(tick);
}
window.addEventListener("resize", resize);
resize();
tick();

// start screen: enter mother word, then place at center and remove text box
(function initStartBox() 
{
    const overlay = document.getElementById("start-overlay");
    const form = document.getElementById("start-form");
    const input = document.getElementById("mother-word");

    function submitWord() 
    {
        const word = (input.value || "").trim();
        if (!word) return;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        nodes.push({
            text: word,
            x: cx,
            y: cy,
            expanded: false,
            scale: 1,
            permanentScale: 1
        });
        overlay.style.display = "none";
    }

    form.addEventListener("submit", (e) => 
    {
        e.preventDefault();
        submitWord();
    });
})();



