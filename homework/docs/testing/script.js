/**
 * Thought Collage Prototype — vanilla JS, no external libraries.
 * Are.na image source; mockLLM for phrases/sound; masonry, crossfade, history.
 */

(function () {
  'use strict';

  // --- Are.na configuration ---
  const ARENA_USE_PROXY = false;
  const ARENA_PROXY_BASE = 'http://localhost:3000/arena';
  const ARENA_PER_PAGE = 50;
  const ARENA_PAGES_TO_TRY = 2;

  const ARENA_CHANNELS = {
    nocturnal: ['arena-influences'],
    organic: ['arena-influences'],
    glitch: ['arena-influences'],
    soft: ['arena-influences']
  };

  const arenaCache = {};

  // --- State ---
  const state = {
    history: [],
    currentIndex: -1,
    reduceSensory: false
  };

  let wordInput, submitBtn, historyStrip, backBtn, forwardBtn, reduceCheckbox, viewport, arenaWarningEl;

  function routeWordToArenaCategory(word) {
    const w = (word || '').toLowerCase();
    if (/night|dark|moon|sleep|midnight|indigo|dusk|twilight|nocturnal/.test(w)) return 'nocturnal';
    if (/nature|plant|forest|leaf|botanical|organic|green|garden|natural/.test(w)) return 'organic';
    if (/glitch|digital|tech|web|digital|code|pixel|screen/.test(w)) return 'glitch';
    if (/soft|quiet|minimal|calm|paper|interior|gentle/.test(w)) return 'soft';
    const cats = ['nocturnal', 'organic', 'glitch', 'soft'];
    return cats[Math.abs((w.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0) | 0, 0)) % cats.length)];
  }

  function pickChannelSlug(category) {
    const list = ARENA_CHANNELS[category];
    if (!list || list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  function arenaContentsUrl(slug, per, page) {
    if (!ARENA_USE_PROXY) {
      return 'https://api.are.na/v2/channels/' + encodeURIComponent(slug) + '/contents?per=' + per + '&page=' + page;
    }
    return ARENA_PROXY_BASE + '/channels/' + encodeURIComponent(slug) + '/contents?per=' + per + '&page=' + page;
  }

  async function fetchArenaImages(slug) {
    if (arenaCache[slug]) return arenaCache[slug];
    const seen = new Set();
    const out = [];
    try {
      for (let page = 1; page <= ARENA_PAGES_TO_TRY; page++) {
        const url = arenaContentsUrl(slug, ARENA_PER_PAGE, page);
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch not ok');
        const json = await res.json();
        const blocks = json.contents || json || [];
        for (const block of blocks) {
          if (block.class !== 'Image') continue;
          const displayUrl = block.image && block.image.display && block.image.display.url;
          if (!displayUrl || seen.has(displayUrl)) continue;
          seen.add(displayUrl);
          out.push({
            url: displayUrl,
            title: block.title || block.generated_title || 'Untitled',
            blockUrl: block.id ? 'https://www.are.na/block/' + block.id : null
          });
        }
      }
      arenaCache[slug] = out;
      return out;
    } catch (e) {
      return [];
    }
  }

  function pickN(arr, n) {
    if (!arr || arr.length === 0) return [];
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(n, copy.length));
  }

  /**
   * mockLLM(inputWord) — returns a structured object (no network).
   * Structure: { seed, mood, palette: { bg1, bg2, accent }, imageQueries, textureTags, wordPhrases, soundTag }
   * Pinterest-y: vibe associations, not literal synonyms.
   * Handcrafted dict for blueberry, ocean, kubernetes, velvet; fallback generator for unknown words.
   */
  const MOODS = ['dreamy', 'calm', 'mysterious', 'warm', 'cool', 'nostalgic', 'serene', 'bold'];
  const HANDCRAFTED = {
    blueberry: {
      seed: 'blueberry-1',
      mood: 'dreamy',
      palette: { bg1: '#1e1a2e', bg2: '#2d2640', accent: '#6b5b95' },
      imageQueries: ['indigo stain', 'berry bowl', 'dusk meadow', 'lavender field', 'jam jar', 'morning mist', 'wild violet', 'twilight sky'],
      textureTags: ['grain', 'soft'],
      wordPhrases: ['sweet dusk', 'purple hour', 'quiet harvest', 'jam and bread', 'wild and tender', 'berry stain', 'morning dew', 'still life'],
      soundTag: 'bee hum'
    },
    ocean: {
      seed: 'ocean-1',
      mood: 'serene',
      palette: { bg1: '#0f2027', bg2: '#1a3a47', accent: '#4a90a4' },
      imageQueries: ['deep blue', 'foam line', 'horizon', 'salt spray', 'tide pool', 'shell drift', 'wave curl', 'sand light', 'pearl sky'],
      textureTags: ['grain', 'fog'],
      wordPhrases: ['endless', 'tide turn', 'salt and wind', 'deep calm', 'shore light', 'horizon line', 'drift', 'ebb and flow'],
      soundTag: 'wave hum'
    },
    kubernetes: {
      seed: 'k8s-1',
      mood: 'cool',
      palette: { bg1: '#0d1117', bg2: '#161b22', accent: '#58a6ff' },
      imageQueries: ['server lights', 'node cluster', 'grid mesh', 'blue terminal', 'data flow', 'cloud nodes', 'circuit trace', 'dashboard glow'],
      textureTags: ['scanlines', 'grain'],
      wordPhrases: ['orchestrate', 'scale', 'pod', 'mesh', 'deploy', 'reconcile', 'state', 'distributed'],
      soundTag: 'server hum'
    },
    velvet: {
      seed: 'velvet-1',
      mood: 'warm',
      palette: { bg1: '#2c1f2a', bg2: '#3d2a38', accent: '#9b6b7d' },
      imageQueries: ['burgundy fold', 'soft texture', 'crimson drape', 'plush shadow', 'rose velvet', 'theatre curtain', 'dark bloom', 'tactile light'],
      textureTags: ['soft', 'grain'],
      wordPhrases: ['touch', 'depth', 'luxe', 'shadow', 'crimson', 'fold', 'tactile', 'rich'],
      soundTag: 'quiet room'
    }
  };

  function mockLLM(inputWord) {
    const key = (inputWord || '').trim().toLowerCase();
    if (HANDCRAFTED[key]) {
      return { ...JSON.parse(JSON.stringify(HANDCRAFTED[key])) };
    }
    return fallbackLLM(key || 'thought');
  }

  /** Fallback for unknown words: deterministic but vibe-y from the word string. */
  function fallbackLLM(word) {
    const s = word.length;
    const h = hashString(word);
    const mood = MOODS[Math.abs(h % MOODS.length)];
    const hue = Math.abs(h % 360);
    const bg1 = hsl(hue, 18, 14);
    const bg2 = hsl((hue + 40) % 360, 14, 20);
    const accent = hsl((hue + 60) % 360, 35, 55);
    const vibeWords = ['stain', 'glow', 'drift', 'fold', 'trace', 'bloom', 'mist', 'edge', 'light', 'shadow', 'field', 'line', 'hum', 'still', 'soft', 'deep'];
    const n = 6 + (Math.abs(h) % 5);
    const imageQueries = [];
    const wordPhrases = [];
    for (let i = 0; i < n; i++) {
      const w1 = vibeWords[Math.abs(h + i * 7) % vibeWords.length];
      const w2 = vibeWords[Math.abs(h + i * 11 + 1) % vibeWords.length];
      imageQueries.push(w1 + ' ' + w2);
      wordPhrases.push(w1 + ' ' + w2);
    }
    const textureTags = ['grain'];
    if (Math.abs(h % 2) === 0) textureTags.push('soft');
    return {
      seed: word + '-' + Math.abs(h % 100),
      mood,
      palette: { bg1, bg2, accent },
      imageQueries,
      textureTags,
      wordPhrases,
      soundTag: word + ' hum'
    };
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
    return h;
  }

  function hsl(h, s, l) {
    const _s = s / 100, _l = l / 100;
    const c = (1 - Math.abs(2 * _l - 1)) * _s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = _l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }

  // --- Masonry: 2–4 columns by viewport; assign each card to currently shortest column (greedy) ---
  function getColumnCount() {
    const w = typeof window !== 'undefined' ? window.innerWidth : 800;
    if (w <= 600) return 1;
    if (w <= 900) return 2;
    if (w <= 1200) return 3;
    return 4;
  }

  function assignCardsToColumns(cardHeights, numColumns) {
    const colHeights = new Array(numColumns).fill(0);
    const assignment = [];
    for (let i = 0; i < cardHeights.length; i++) {
      let minCol = 0;
      for (let c = 1; c < numColumns; c++) {
        if (colHeights[c] < colHeights[minCol]) minCol = c;
      }
      assignment.push(minCol);
      colHeights[minCol] += cardHeights[i];
    }
    return assignment;
  }

  // Seeded random for repeatable layout per collage (0..1)
  function seededRandom(seed, n) {
    const x = Math.sin(seed * 9999 + n * 12345) * 10000;
    return x - Math.floor(x);
  }

  // Bigger rects — varied aspect ratios, no rotation; touch-only packing
  // Sizes tuned so ~3 can stack vertically in typical viewport (shorter heights)
  const CARD_SIZES = [
    { w: 320, h: 200 },
    { w: 300, h: 190 },
    { w: 340, h: 195 },
    { w: 280, h: 210 },
    { w: 380, h: 205 },
    { w: 290, h: 185 },
    { w: 330, h: 200 },
    { w: 270, h: 220 },
    { w: 360, h: 195 },
    { w: 310, h: 205 }
  ];

  // Strict: overlap only if they share interior (touching = share edge only, not overlap)
  function rectsOverlap(a, b) {
    if (a.left >= b.left + b.w || a.left + a.w <= b.left) return false;
    if (a.top >= b.top + b.h || a.top + a.h <= b.top) return false;
    return true;
  }

  function inBounds(r, cw, ch) {
    return r.left >= 0 && r.top >= 0 && r.left + r.w <= cw && r.top + r.h <= ch;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Touch only, no overlap; prefer vertical
  function packTouchingRects(sizes, seedNum, cw, ch) {
    const placed = [];
    if (sizes.length === 0) return placed;
    const first = sizes[0];
    placed.push({
      left: Math.floor((cw - first.w) / 2),
      top: Math.floor((ch - first.h) / 2),
      w: first.w,
      h: first.h
    });

    for (let i = 1; i < sizes.length; i++) {
      const size = sizes[i];
      const candidates = [];
      const order = placed.map((_, idx) => idx);
      for (let j = order.length - 1; j > 0; j--) {
        const k = Math.floor(seededRandom(seedNum, i * 10 + j) * (j + 1));
        [order[j], order[k]] = [order[k], order[j]];
      }
      const dirOrder = [0, 1, 2, 3];
      for (let j = 3; j > 0; j--) {
        const k = Math.floor(seededRandom(seedNum, i * 20 + j) * (j + 1));
        [dirOrder[j], dirOrder[k]] = [dirOrder[k], dirOrder[j]];
      }

      for (const anchorIdx of order) {
        const R = placed[anchorIdx];
        const yAlign = [R.top, R.top + R.h - size.h, R.top + Math.floor((R.h - size.h) / 2)];
        const xAlign = [R.left, R.left + R.w - size.w, R.left + Math.floor((R.w - size.w) / 2)];
        const yClamp = (y) => clamp(Math.floor(y), 0, ch - size.h);
        const xClamp = (x) => clamp(Math.floor(x), 0, cw - size.w);

        for (const d of dirOrder) {
          if (d === 0 && R.left + R.w + size.w <= cw) {
            yAlign.forEach(y => {
              const yy = yClamp(y);
              if (yy < R.top + R.h && yy + size.h > R.top)
                candidates.push({ left: R.left + R.w, top: yy, w: size.w, h: size.h, vert: 0 });
            });
          } else if (d === 1 && R.left - size.w >= 0) {
            yAlign.forEach(y => {
              const yy = yClamp(y);
              if (yy < R.top + R.h && yy + size.h > R.top)
                candidates.push({ left: R.left - size.w, top: yy, w: size.w, h: size.h, vert: 0 });
            });
          } else if (d === 2 && R.top + R.h + size.h <= ch) {
            xAlign.forEach(x => {
              const xx = xClamp(x);
              if (xx < R.left + R.w && xx + size.w > R.left)
                candidates.push({ left: xx, top: R.top + R.h, w: size.w, h: size.h, vert: 1 });
            });
          } else if (d === 3 && R.top - size.h >= 0) {
            xAlign.forEach(x => {
              const xx = xClamp(x);
              if (xx < R.left + R.w && xx + size.w > R.left)
                candidates.push({ left: xx, top: R.top - size.h, w: size.w, h: size.h, vert: 1 });
            });
          }
        }
      }

      const valid = candidates.filter(c =>
        inBounds(c, cw, ch) && !placed.some(p => rectsOverlap(c, p))
      );
      const deduped = [];
      const seen = new Set();
      valid.forEach(c => {
        const key = c.left + ',' + c.top;
        if (!seen.has(key)) { seen.add(key); deduped.push(c); }
      });

      if (deduped.length === 0) {
        let fallback = null;
        for (const R of placed) {
          const tries = [
            { left: R.left + R.w, top: R.top },
            { left: R.left - size.w, top: R.top },
            { left: R.left, top: R.top + R.h },
            { left: R.left, top: R.top - size.h }
          ];
          for (const t of tries) {
            const r = { left: t.left, top: t.top, w: size.w, h: size.h };
            if (inBounds(r, cw, ch) && !placed.some(p => rectsOverlap(r, p))) {
              fallback = r;
              break;
            }
          }
          if (fallback) break;
        }
        placed.push(fallback || { left: 0, top: 0, w: size.w, h: size.h });
      } else {
        const vertical = deduped.filter(c => c.vert === 1);
        const pool = (vertical.length > 0 && seededRandom(seedNum, i * 30) < 0.6) ? vertical : deduped;
        const idx = Math.floor(seededRandom(seedNum, i) * pool.length) % pool.length;
        const chosen = pool[idx];
        placed.push({ left: chosen.left, top: chosen.top, w: chosen.w, h: chosen.h });
      }
    }

    // Post-pass: fix any overlapping pairs (nudge later rect to touch another, no overlap)
    for (let j = 1; j < placed.length; j++) {
      const r = placed[j];
      for (let i = 0; i < j; i++) {
        if (!rectsOverlap(r, placed[i])) continue;
        const other = placed[i];
        const yOpts = [other.top, other.top + other.h - r.h, other.top + Math.floor((other.h - r.h) / 2)];
        const xOpts = [other.left, other.left + other.w - r.w, other.left + Math.floor((other.w - r.w) / 2)];
        const yClamp = (y) => clamp(Math.floor(y), 0, ch - r.h);
        const xClamp = (x) => clamp(Math.floor(x), 0, cw - r.w);
        const tries = [];
        yOpts.forEach(y => {
          const yy = yClamp(y);
          if (yy < other.top + other.h && yy + r.h > other.top) {
            tries.push({ left: other.left + other.w, top: yy });
            tries.push({ left: other.left - r.w, top: yy });
          }
        });
        xOpts.forEach(x => {
          const xx = xClamp(x);
          if (xx < other.left + other.w && xx + r.w > other.left) {
            tries.push({ left: xx, top: other.top + other.h });
            tries.push({ left: xx, top: other.top - r.h });
          }
        });
        for (const t of tries) {
          const moved = { left: t.left, top: t.top, w: r.w, h: r.h };
          if (!inBounds(moved, cw, ch)) continue;
          let ok = true;
          for (let k = 0; k < placed.length; k++) {
            if (k === j) continue;
            if (rectsOverlap(moved, placed[k])) { ok = false; break; }
          }
          if (ok) {
            placed[j] = moved;
            break;
          }
        }
      }
    }
    return placed;
  }

  // --- Build collage: real Are.na images or mock fallback; pack into viewport ---
  function buildCollageLayer(data, reduceSensory) {
    const vw = Math.max(300, viewport.clientWidth || window.innerWidth);
    const vh = Math.max(300, viewport.clientHeight || window.innerHeight - 160);

    const layer = document.createElement('div');
    layer.className = 'collage-layer';
    const seedNum = hashString(data.seed);

    const useArena = data.arenaImages && data.arenaImages.length > 0;
    const maxN = reduceSensory ? 5 : 14;
    const queries = data.imageQueries || [];
    const imageItems = useArena
      ? data.arenaImages.slice(0, maxN)
      : queries.slice(0, maxN).map(function (q) {
          return { url: 'https://picsum.photos/seed/' + Math.abs(hashString(q)).toString(36) + '/400/300', title: q, blockUrl: null };
        });
    const numCards = imageItems.length;
    if (numCards === 0) {
      layer.appendChild(document.createElement('div'));
      return layer;
    }

    const sizes = imageItems.map(function (_, i) {
      const idx = Math.floor(seededRandom(seedNum, i) * CARD_SIZES.length) % CARD_SIZES.length;
      return CARD_SIZES[idx];
    });
    const positions = packTouchingRects(sizes, seedNum, vw, vh);

    const cluster = document.createElement('div');
    cluster.className = 'collage-cluster';
    cluster.style.width = vw + 'px';
    cluster.style.height = vh + 'px';

    imageItems.forEach(function (item, i) {
      const pos = positions[i];
      if (!pos) return;
      const left = Math.floor(pos.left);
      const top = Math.floor(pos.top);
      const card = document.createElement('div');
      card.className = 'card animate-in';
      card.style.animationDelay = (i * 0.04) + 's';
      card.style.left = left + 'px';
      card.style.top = top + 'px';
      card.style.width = pos.w + 'px';
      card.style.height = pos.h + 'px';
      card.style.zIndex = 10 + i;
      if (item.blockUrl) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', function () { window.open(item.blockUrl, '_blank', 'noopener'); });
      }

      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      card.appendChild(img);
      const label = document.createElement('span');
      label.className = 'card-label';
      label.textContent = item.title;
      card.appendChild(label);
      if (useArena) {
        const attr = document.createElement('span');
        attr.className = 'card-arena-attribution';
        attr.textContent = 'source: are.na';
        card.appendChild(attr);
      }
      cluster.appendChild(card);
    });

    layer.appendChild(cluster);

    var wordCloud = document.createElement('div');
    wordCloud.className = 'collage-word-cloud';
    var centerX = 50;
    var centerY = 50;
    var motherWord = (data.word || '').trim();
    if (motherWord) {
      var motherEl = document.createElement('span');
      motherEl.className = 'word-cloud-word word-cloud-mother animate-in';
      motherEl.textContent = motherWord;
      motherEl.style.left = centerX + '%';
      motherEl.style.top = centerY + '%';
      motherEl.style.setProperty('--r', '0deg');
      motherEl.style.animationDelay = (numCards * 0.04) + 's';
      wordCloud.appendChild(motherEl);
    }
    var phraseCount = reduceSensory ? Math.min(6, (data.wordPhrases || []).length) : Math.min(10, (data.wordPhrases || []).length);
    var phrases = (data.wordPhrases || []).slice(0, phraseCount);
    phrases.forEach(function (p, i) {
      var angle = seededRandom(seedNum, i * 7) * Math.PI * 2;
      var dist = 8 + seededRandom(seedNum, i * 11) * 28;
      var left = centerX + dist * Math.cos(angle);
      var top = centerY + dist * Math.sin(angle);
      var rot = (seededRandom(seedNum, i * 13) - 0.5) * 12;
      var size = 0.7 + seededRandom(seedNum, i * 17) * 0.5;
      var el = document.createElement('span');
      el.textContent = p;
      el.className = 'word-cloud-word animate-in';
      el.style.left = left + '%';
      el.style.top = top + '%';
      el.style.setProperty('--r', rot + 'deg');
      el.style.fontSize = size + 'rem';
      el.style.animationDelay = (numCards * 0.04 + (i + 1) * 0.05) + 's';
      wordCloud.appendChild(el);
    });
    layer.appendChild(wordCloud);

    var captions = document.createElement('div');
    captions.className = 'collage-captions';
    if (!reduceSensory && data.soundTag) {
      var sound = document.createElement('span');
      sound.textContent = 'sound: ' + data.soundTag;
      captions.appendChild(sound);
    }
    layer.appendChild(captions);

    return layer;
  }

  function showNewCollage(data) {
    const reduceSensory = state.reduceSensory;
    const newLayer = buildCollageLayer(data, reduceSensory);
    newLayer.classList.add('entering');
    viewport.appendChild(newLayer);

    const prevLayer = viewport.querySelector('.collage-layer:not(.entering)');
    if (prevLayer) {
      prevLayer.classList.add('leaving');
      prevLayer.classList.remove('active');
    }

    requestAnimationFrame(function () {
      newLayer.classList.add('visible');
    });

    setTimeout(function () {
      if (prevLayer && prevLayer.parentNode) prevLayer.remove();
      newLayer.classList.remove('entering', 'visible');
      newLayer.classList.add('active');
    }, 900);

    if (arenaWarningEl) {
      arenaWarningEl.style.display = data.arenaFetchFailed ? 'block' : 'none';
    }
  }

  function goToIndex(index) {
    if (index < 0 || index >= state.history.length) return;
    state.currentIndex = index;
    const entry = state.history[index];
    entry.data.word = entry.word;
    showNewCollage(entry.data);
    updateUI();
  }

  function updateUI() {
    historyStrip.innerHTML = '';
    state.history.forEach((entry, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (i === state.currentIndex ? ' active' : '');
      chip.textContent = entry.word;
      chip.addEventListener('click', () => goToIndex(i));
      historyStrip.appendChild(chip);
    });
    backBtn.disabled = state.currentIndex <= 0;
    forwardBtn.disabled = state.currentIndex < 0 || state.currentIndex >= state.history.length - 1;
  }

  function onSubmit() {
    const word = (wordInput.value || '').trim();
    if (!word) return;
    const data = mockLLM(word);
    data.arenaImages = [];
    data.arenaFetchFailed = false;
    submitBtn.disabled = true;
    const category = routeWordToArenaCategory(word);
    const slug = pickChannelSlug(category);
    Promise.resolve(slug ? fetchArenaImages(slug) : [])
      .then(function (images) {
        const n = state.reduceSensory ? 5 : 14;
        data.arenaImages = pickN(images, n);
        if (data.arenaImages.length === 0) data.arenaFetchFailed = true;
      })
      .catch(function () {
        data.arenaFetchFailed = true;
      })
      .then(function () {
        submitBtn.disabled = false;
        data.word = word;
        const nextIndex = state.currentIndex + 1;
        state.history = state.history.slice(0, nextIndex);
        state.history.push({ word: word, data: data });
        state.currentIndex = state.history.length - 1;
        showNewCollage(data);
        updateUI();
        wordInput.value = '';
        wordInput.focus();
      });
  }

  function init() {
    wordInput = document.getElementById('word-input');
    submitBtn = document.getElementById('submit-btn');
    historyStrip = document.getElementById('history-strip');
    backBtn = document.getElementById('back-btn');
    forwardBtn = document.getElementById('forward-btn');
    reduceCheckbox = document.getElementById('reduce-sensory');
    viewport = document.getElementById('collage-viewport');
    arenaWarningEl = document.getElementById('arena-warning');

    if (!wordInput || !submitBtn || !viewport) return;

    submitBtn.addEventListener('click', onSubmit);
    wordInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
    });

    backBtn.addEventListener('click', () => goToIndex(state.currentIndex - 1));
    forwardBtn.addEventListener('click', () => goToIndex(state.currentIndex + 1));

    reduceCheckbox.addEventListener('change', function () {
      state.reduceSensory = this.checked;
      if (state.currentIndex >= 0 && state.history[state.currentIndex]) {
        showNewCollage(state.history[state.currentIndex].data);
      }
    });

    updateUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
