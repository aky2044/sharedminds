
const CFG = {
    // nodes
    baseRadius: 6.0,                 
    radiusGainFromStrength: 2.0,
  
    // hover/branching
    hoverDetectRadius: 25,           
    branchCooldownMs: 150,          
    branchChanceBasePerSec: 1.0,    
    branchChanceMaxPerSec: 4.0,   
    hoverToMaxBranchSec: 1.5,      
    maxChildrenPerNode: 7,          
    branchDistanceMin: 18,
    branchDistanceMax: 55,
    minNodeSeparation: 25,           
    secondaryBranchChance: 0.25,   
    maxSecondaryBranches: 5,        
    spawnDuration: 0.4,            
    distanceDecayFactor: 0.7,       
    maxSpawnAttempts: 8,            
  
    // strengthening (pulse glow system)
    pulsePhase1Sec: 10.0,           
    pulsePhase2Sec: 20.0,           
    pulsePhase3Sec: 30.0,           
    pulseGlowRadius: 15,            
    pulseGlowIntensity: 0.4,        
  
    // persistence based on hover time
    basePersistenceSec: 5.0,        
    persistenceMultiplier: 8.0,      
  
    // fading of branches after leaving hovered node
    fadeStepMs: 110,               
    childFadeSpeedPerSec: 0.3,     
    edgeFadeSpeedPerSec: 0.4,       
  
    // global fade (everything slowly ages)
    idleFadePerSec: 0.01,           
  
    // visuals
    background: "#ffffff",        
    edgeBaseAlpha: 0.15,            
    edgeWidth: 1.2,
    nodeBaseColor: [0, 0, 0],      
    pulseColor1: [100, 150, 255],  
    pulseColor2: [150, 100, 255],   
    pulseColor3: [255, 150, 100]    
  };
  
  // ------------------------------------------------------------
  // Canvas setup
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  
  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();
  
  // ------------------------------------------------------------
  // State
  let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, moved: false };
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.moved = true;
  });
  
  let nextId = 1;
  
  class Node {
    constructor(x, y, parentId = null) {
      this.id = nextId++;
      this.x = x;
      this.y = y;
      this.parentId = parentId;
      this.children = []; // child ids in birth order
  
      this.age = 0;               // seconds alive
      this.spawnAge = 0;          
      this.alpha = 0.0;           
      this.edgeAlpha = 0.0;       
      this.strength = 0.0;       
      this.hoverTime = 0.0;       
      this.isHovered = false;
      this.permanent = false;     
      this.persistUntil = 0;      
      this.maxHoverTime = 0.0;    
      this.distanceFromRoot = 0; 
  
      this.branchClockMs = 0;     
      this.fading = false;        
      this.fadeIndex = 0;         
      this.fadeTimerMs = 0;
      this.secondaryBranches = 0; // count of secondary branches
      
      // Calculate distance from root
      if (parentId != null) {
        const parent = nodes.get(parentId);
        if (parent) {
          this.distanceFromRoot = parent.distanceFromRoot + 1;
        }
      }
    }
  }
  
  const nodes = new Map(); // id -> Node
  
  // Find the root node for a given node (traverse up the tree)
  function findRootForNode(nodeId) {
    let current = nodes.get(nodeId);
    if (!current) return null;
    while (current && current.parentId != null) {
      current = nodes.get(current.parentId);
      if (!current) break;
    }
    return current;
  }
  
  function addNode(x, y, parentId = null) {
    const n = new Node(x, y, parentId);
    nodes.set(n.id, n);
    if (parentId != null) {
      nodes.get(parentId).children.push(n.id);
    }
    return n.id;
  }
  
  // spawn multiple random nodes
  const initialNodeCount = 5; // number of initial nodes to spawn
  const rootId = addNode(window.innerWidth * 0.5, window.innerHeight * 0.5, null);
  // initial nodes start fully visible 
  const rootNode = nodes.get(rootId);
  if (rootNode) {
    rootNode.alpha = 1.0;
    rootNode.edgeAlpha = 1.0;
    rootNode.spawnAge = CFG.spawnDuration; // skip spawn animation
  }
  
  // spawn additional random initial nodes 
  for (let i = 0; i < initialNodeCount; i++) {
    const padding = 50;
    let attempts = 0;
    let x, y, valid = false;
    
    // valid position for initial nodes
    while (attempts < 20 && !valid) {
      x = padding + Math.random() * (window.innerWidth - padding * 2);
      y = padding + Math.random() * (window.innerHeight - padding * 2);
      valid = isPositionValid(x, y);
      attempts++;
    }
    
    const nodeId = addNode(x, y, null);
    const node = nodes.get(nodeId);
    if (node) {
      node.alpha = 1.0;
      node.edgeAlpha = 1.0;
      node.spawnAge = CFG.spawnDuration; // skip spawn animation
    }
  }
  
  // ------------------------------------------------------------
  // helpers
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  
  function lerp(a, b, t) { return a + (b - a) * t; }
  
  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx*dx + dy*dy;
  }
  
  function dist(ax, ay, bx, by) {
    return Math.sqrt(dist2(ax, ay, bx, by));
  }
  
  // check if a position is too close to any existing node
  function isPositionValid(x, y, excludeNodeId = null) {
    const minDist2 = CFG.minNodeSeparation * CFG.minNodeSeparation;
    for (const [id, n] of nodes) {
      if (id === excludeNodeId) continue;
      if (n.alpha <= 0.01) continue; // ignore nearly invisible nodes
      const d2 = dist2(x, y, n.x, n.y);
      if (d2 < minDist2) {
        return false;
      }
    }
    return true;
  }
  
  // try to find a valid spawn position near the parent, away from root
  function findValidSpawnPosition(parentX, parentY, excludeNodeId = null, rootNode = null) {
    const pad = 20;
    const minDist2 = CFG.minNodeSeparation * CFG.minNodeSeparation;
    
    // calculate direction away from root if root exists
    let preferredAngle = null;
    let angleSpread = Math.PI * 2; // full circle if no root
    
    if (rootNode && rootNode.id !== excludeNodeId) {
      // calculate vector from root to parent
      const dx = parentX - rootNode.x;
      const dy = parentY - rootNode.y;
      const distFromRoot = Math.sqrt(dx*dx + dy*dy);
      
      if (distFromRoot > 0.1) {
        // preferred angle is the direction from root to parent (continuing outward)
        preferredAngle = Math.atan2(dy, dx);
        // allow some spread around this direction (120 degrees)
        angleSpread = Math.PI * 2 / 3; // 120 degrees
      }
    }
    
    // try multiple angles to find a valid position
    for (let attempt = 0; attempt < CFG.maxSpawnAttempts; attempt++) {
      let ang;
      if (preferredAngle !== null) {
        // generate angle in the preferred direction (away from root)
        const spread = (Math.random() - 0.5) * angleSpread;
        ang = preferredAngle + spread;
      } else {
        // no root constraint, use random angle
        ang = Math.random() * Math.PI * 2;
      }
      
      const d = lerp(CFG.branchDistanceMin, CFG.branchDistanceMax, Math.random());
      const x = parentX + Math.cos(ang) * d;
      const y = parentY + Math.sin(ang) * d;
      
      // keep inside bounds
      const nx = Math.max(pad, Math.min(window.innerWidth - pad, x));
      const ny = Math.max(pad, Math.min(window.innerHeight - pad, y));
      
      // check if this position is valid (not too close to other nodes)
      if (isPositionValid(nx, ny, excludeNodeId)) {
        return { x: nx, y: ny, valid: true };
      }
    }
    
    // if we couldn't find a valid position after max attempts, try a position further away
    for (let attempt = 0; attempt < CFG.maxSpawnAttempts; attempt++) {
      let ang;
      if (preferredAngle !== null) {
        const spread = (Math.random() - 0.5) * angleSpread;
        ang = preferredAngle + spread;
      } else {
        ang = Math.random() * Math.PI * 2;
      }
      
      // try further distances
      const d = lerp(CFG.branchDistanceMax, CFG.branchDistanceMax * 1.5, Math.random());
      const x = parentX + Math.cos(ang) * d;
      const y = parentY + Math.sin(ang) * d;
      
      const nx = Math.max(pad, Math.min(window.innerWidth - pad, x));
      const ny = Math.max(pad, Math.min(window.innerHeight - pad, y));
      
      if (isPositionValid(nx, ny, excludeNodeId)) {
        return { x: nx, y: ny, valid: true };
      }
    }
    
    // return a position anyway (better than not spawning)
    let ang;
    if (preferredAngle !== null) {
      ang = preferredAngle;
    } else {
      ang = Math.random() * Math.PI * 2;
    }
    const d = CFG.branchDistanceMax * 1.2;
    const x = parentX + Math.cos(ang) * d;
    const y = parentY + Math.sin(ang) * d;
    const nx = Math.max(pad, Math.min(window.innerWidth - pad, x));
    const ny = Math.max(pad, Math.min(window.innerHeight - pad, y));
    return { x: nx, y: ny, valid: false };
  }
  
  function nodeRadius(n) {
    return CFG.baseRadius + CFG.radiusGainFromStrength * (n.strength / 3.0);
  }
  
  // get pulse color based on hover time
  function getPulseColor(hoverTime) {
    if (hoverTime >= CFG.pulsePhase3Sec) {
      return CFG.pulseColor3; // orange - permanent
    } else if (hoverTime >= CFG.pulsePhase2Sec) {
      const t = (hoverTime - CFG.pulsePhase2Sec) / (CFG.pulsePhase3Sec - CFG.pulsePhase2Sec);
      return mixColorRGB(CFG.pulseColor2, CFG.pulseColor3, t);
    } else if (hoverTime >= CFG.pulsePhase1Sec) {
      const t = (hoverTime - CFG.pulsePhase1Sec) / (CFG.pulsePhase2Sec - CFG.pulsePhase1Sec);
      return mixColorRGB(CFG.pulseColor1, CFG.pulseColor2, t);
    } else {
      const t = hoverTime / CFG.pulsePhase1Sec;
      return mixColorRGB(CFG.nodeBaseColor, CFG.pulseColor1, t);
    }
  }
  
  // get pulse phase (0-3) for strength calculation
  function getPulsePhase(hoverTime) {
    if (hoverTime >= CFG.pulsePhase3Sec) return 3.0;
    if (hoverTime >= CFG.pulsePhase2Sec) return 2.0 + (hoverTime - CFG.pulsePhase2Sec) / (CFG.pulsePhase3Sec - CFG.pulsePhase2Sec);
    if (hoverTime >= CFG.pulsePhase1Sec) return 1.0 + (hoverTime - CFG.pulsePhase1Sec) / (CFG.pulsePhase2Sec - CFG.pulsePhase1Sec);
    return hoverTime / CFG.pulsePhase1Sec;
  }
  
  function mixColorRGB(a, b, t) {
    // a,b = [r,g,b], t in [0,1]
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t))
    ];
  }
  
  function rgbToCss([r,g,b], alpha=1) {
    return `rgba(${r},${g},${b},${alpha})`;
  }
  
  // ------------------------------------------------------------
  // hover detection: pick closest node within detect radius
  function findHoveredNodeId() {
    const R2 = CFG.hoverDetectRadius * CFG.hoverDetectRadius;
    let bestId = null;
    let bestD2 = Infinity;
  
    for (const [id, n] of nodes) {
      if (n.alpha <= 0.02) continue;
      const d2 = dist2(mouse.x, mouse.y, n.x, n.y);
      if (d2 <= R2 && d2 < bestD2) {
        bestD2 = d2;
        bestId = id;
      }
    }
    
    return bestId;
  }
  
  // When you leave a hovered node, fade its branch newest-first
  function beginFadeOutBranch(node) {
    if (!node) return;
    node.fading = true;
    node.fadeIndex = 0;
    node.fadeTimerMs = 0;
  
    // Mark children as "not yet fading" by setting a flag on each
    for (const cid of node.children) {
      const c = nodes.get(cid);
      if (c) c.fading = false; // child's own fading flag indicates it should decay faster
    }
  }
  
  // Mark next newest child to fade
  function fadeNextChild(node) {
    const idxFromEnd = node.fadeIndex; // 0 -> newest
    const childIndex = node.children.length - 1 - idxFromEnd;
    if (childIndex < 0) return false;
  
    const cid = node.children[childIndex];
    const c = nodes.get(cid);
    if (c) {
      c.fading = true;
    }
    node.fadeIndex++;
    return true;
  }
  
  
  // Branching
  function attemptBranch(parent, dtSec) {
    if (!parent) return;
    if (parent.children.length >= CFG.maxChildrenPerNode) return;
    if (parent.alpha <= 0.1) return; // Don't branch if parent is too faded
  
    // branching probability rises with continuous hover time
    const t = clamp01(parent.hoverTime / CFG.hoverToMaxBranchSec);
    const chancePerSec = Math.min(
      CFG.branchChanceMaxPerSec,
      CFG.branchChanceBasePerSec + (CFG.branchChanceMaxPerSec - CFG.branchChanceBasePerSec) * t
    );
  
    // convert rate to per-frame probability: p = 1 - exp(-rate * dt)
    const p = 1 - Math.exp(-chancePerSec * dtSec);
    if (Math.random() > p) return;
  
    // find the root node for this branch (to ensure we branch away from it)
    const rootNode = findRootForNode(parent.id);
    
    // find a valid spawn position (not too close to other nodes, away from root)
    const spawnPos = findValidSpawnPosition(parent.x, parent.y, parent.id, rootNode);
    
    const childId = addNode(spawnPos.x, spawnPos.y, parent.id);
    const child = nodes.get(childId);
    
    
    
    if (child && child.children.length < CFG.maxChildrenPerNode && Math.random() < CFG.secondaryBranchChance) {
      const secondaryPos = findValidSpawnPosition(child.x, child.y, childId, rootNode);
      addNode(secondaryPos.x, secondaryPos.y, childId);
    }
  }
  
  // find root node (the one being hovered or the original root)
  function findRootNode(hoveredId) {
    if (hoveredId != null) {
      const hovered = nodes.get(hoveredId);
      if (hovered && hovered.parentId == null) {
        return hovered; // hovered node is a root
      }
      // find the root by traversing up
      let current = hovered;
      while (current && current.parentId != null) {
        current = nodes.get(current.parentId);
      }
      return current;
    }
    return nodes.get(rootId);
  }
  
  // apply persistence to all descendants based on distance
  function applyPersistenceToDescendants(rootNode, hoverTime, currentTime) {
    if (!rootNode || hoverTime < CFG.basePersistenceSec) return;
    
    const basePersistDuration = hoverTime * CFG.persistenceMultiplier;
    
    function applyToNode(node, distance) {
      if (!node) return;
      
      // calculate persistence based on distance (decays with distance)
      const distanceFactor = Math.pow(CFG.distanceDecayFactor, distance);
      const persistDuration = basePersistDuration * distanceFactor;
      
      if (persistDuration > 0 && !node.permanent) {
        const newPersistUntil = currentTime + persistDuration;
        // only extend persistence if it's longer than current
        if (newPersistUntil > node.persistUntil) {
          node.persistUntil = newPersistUntil;
        }
      }
      
      // recursively apply to children
      for (const childId of node.children) {
        const child = nodes.get(childId);
        if (child) {
          applyToNode(child, distance + 1);
        }
      }
    }
    
    // start from root's children (distance 1)
    for (const childId of rootNode.children) {
      const child = nodes.get(childId);
      if (child) {
        applyToNode(child, 1);
      }
    }
  }
  
  // ------------------------------------------------------------
  // update & draw
  let last = performance.now();
  
  function tick(now) {
    const dtMs = Math.min(33, now - last); // cap for stability
    const dtSec = dtMs / 1000;
    last = now;
    const currentTime = performance.now() / 1000;
  
    // hover state updates
    const hoveredId = findHoveredNodeId();
    const rootNode = findRootNode(hoveredId);
  
    for (const [id, n] of nodes) {
      const wasHovered = n.isHovered;
      n.isHovered = (id === hoveredId);
      
      // spawn animation (fade in and expand)
      // skip spawn animation if node was initialized with full alpha (initial nodes)
      if (n.spawnAge < CFG.spawnDuration) {
        n.spawnAge += dtSec;
        if (n.spawnAge >= CFG.spawnDuration) {
          // animation - set to full visibility initially
          n.alpha = 1.0;
          n.edgeAlpha = 1.0;
          n.spawnAge = CFG.spawnDuration;
        } else {
          // during animation
          const spawnProgress = n.spawnAge / CFG.spawnDuration;
          // smooth ease-out curve
          const eased = 1 - Math.pow(1 - spawnProgress, 3);
          n.alpha = eased;
          n.edgeAlpha = eased;
        }
      }
     
  
      if (n.isHovered) {
        n.hoverTime += dtSec;
        n.maxHoverTime = Math.max(n.maxHoverTime, n.hoverTime);
        // not fading while actively hovered
        n.fading = false;
        n.fadeIndex = 0;
        n.fadeTimerMs = 0;
        
        // Check for permanent status (30s hover)
        if (n.hoverTime >= CFG.pulsePhase3Sec && !n.permanent) {
          n.permanent = true;
          n.persistUntil = Infinity; // never fade
        }
        
        // Apply persistence to all descendants based on distance
        if (n.parentId == null) { // Only if this is a root node
          applyPersistenceToDescendants(n, n.hoverTime, currentTime);
        }
      } else {
        // leaving hover triggers fade sequence (only if it *was* hovered)
        if (wasHovered && !n.isHovered) {
          beginFadeOutBranch(n);
          
          // Calculate persistence based on hover time
          if (n.maxHoverTime >= CFG.basePersistenceSec && !n.permanent) {
            const persistDuration = n.maxHoverTime * CFG.persistenceMultiplier;
            n.persistUntil = currentTime + persistDuration;
            
            // Apply to descendants if this is a root
            if (n.parentId == null) {
              applyPersistenceToDescendants(n, n.maxHoverTime, currentTime);
            }
          }
        }
        // don't reset hoverTime, keep maxHoverTime for persistence calculation
      }
  
      // update strength based on pulse phase
      if (n.isHovered) {
        n.strength = getPulsePhase(n.hoverTime);
      } else {
        // use max hover time for pulse phase when not hovered
        n.strength = getPulsePhase(n.maxHoverTime);
      }
  
      // Age / idle fade (but respect persistence and permanent status)
      n.age += dtSec;
      
      // don't fade during spawn animation - spawn animation handles alpha
      if (n.spawnAge < CFG.spawnDuration) {
        // spawn animation is handling alpha, don't interfere
      } else if (n.permanent) {
        // permanent nodes never fade
        n.alpha = 1.0;
      } else if (n.parentId == null) {
        // root nodes (initial nodes) never fade from idle fade
        n.alpha = Math.max(n.alpha, 1.0);
      } else if (n.persistUntil > 0) {
        if (currentTime < n.persistUntil) {
          // still in persistence period, maintain alpha (don't fade)
          n.alpha = Math.max(n.alpha, 0.95); // keep it high during persistence
        } else {
          // persistence expired, start fading
          n.alpha = clamp01(n.alpha - CFG.idleFadePerSec * dtSec);
        }
      } else {
       
        // Only fade if not being maintained by spawn animation
        if (n.spawnAge >= CFG.spawnDuration) {
          n.alpha = clamp01(n.alpha - CFG.idleFadePerSec * dtSec);
        }
      }
  
      
      
      if (n.parentId == null && id !== rootId) {
        // (not used; kept as placeholder)
      }
  
      if (n.fading) {
        // faster decay if marked fading (only if spawn animation is complete)
        if (n.spawnAge >= CFG.spawnDuration) {
          n.alpha = clamp01(n.alpha - CFG.childFadeSpeedPerSec * dtSec);
          n.edgeAlpha = clamp01(n.edgeAlpha - CFG.edgeFadeSpeedPerSec * dtSec);
        }
      }
  
      // Parent-managed fade sequencing
      if (n.fading === false && n.isHovered === false && n.children.length > 0) {
        // placeholder for future fade sequencing logic
      }
    }
  
    // Handle parent fade sequencing separately (needs to run even if parent isn't marked fading)
    for (const [id, n] of nodes) {
      if (!n.fading && n.fadeTimerMs >= 0 && n.fadeIndex >= 0) {
        
      }
    }
  
    // Let's implement a real "branchFadingActive" flag without changing class:
    // We'll store it on the node dynamically to keep code compact.
    for (const [id, n] of nodes) {
      if (n.branchFadingActive) {
        n.fadeTimerMs += dtMs;
        while (n.fadeTimerMs >= CFG.fadeStepMs) {
          n.fadeTimerMs -= CFG.fadeStepMs;
          const ok = fadeNextChild(n);
          if (!ok) {
            // once all children are marked fading, stop sequencing
            n.branchFadingActive = false;
            break;
          }
        }
      }
  
      // Cooldown + branching attempts only while hovered
      if (n.isHovered) {
        n.branchClockMs += dtMs;
        while (n.branchClockMs >= CFG.branchCooldownMs) {
          n.branchClockMs -= CFG.branchCooldownMs;
          const dtForBranch = CFG.branchCooldownMs / 1000;
          attemptBranch(n, dtForBranch);
        }
      } else {
        n.branchClockMs = 0;
      }
      
    }
  
    // cleanup: remove dead nodes (except root nodes and permanent nodes)
    for (const [id, n] of nodes) {
      if (n.parentId == null) continue; // protect all root nodes
      if (n.permanent) continue; // protect permanent nodes
      // Don't delete nodes that are still spawning
      if (n.spawnAge < CFG.spawnDuration) continue;
      if (n.alpha <= 0.01) {
        nodes.delete(id);
      }
    }
  
    draw();
  
    requestAnimationFrame(tick);
  }
  
  function draw() {
    // background
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.fillStyle = CFG.background;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  
    // edges first
    ctx.lineWidth = CFG.edgeWidth;
    for (const [id, n] of nodes) {
      if (n.parentId == null) continue;
      const p = nodes.get(n.parentId);
      if (!p) continue;
  
      const edgeAlpha = Math.min(n.edgeAlpha, p.edgeAlpha || 1.0);
      const a = CFG.edgeBaseAlpha * Math.min(n.alpha, p.alpha) * edgeAlpha;
      if (a <= 0.01) continue;
  
      // edge color - dark gray/black for white background
      ctx.strokeStyle = rgbToCss([50, 50, 50], a);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }
  
    // nodes
    for (const [id, n] of nodes) {
      //apply spawn scale animation
      let scale = 1.0;
      if (n.spawnAge < CFG.spawnDuration) {
        const spawnProgress = n.spawnAge / CFG.spawnDuration;
        const eased = 1 - Math.pow(1 - spawnProgress, 3);
        scale = 0.3 + eased * 0.7; // scale from 30% to 100%
      }
      
      const r = nodeRadius(n) * scale;
      //use the node's alpha directly (spawn animation handles it)
      const alpha = n.permanent ? 1.0 : n.alpha;
  
      if (alpha <= 0.001 && n.spawnAge >= CFG.spawnDuration) continue;
  
      //get pulse color based on hover time
      const pulseCol = getPulseColor(n.isHovered ? n.hoverTime : n.maxHoverTime);
      const pulsePhase = getPulsePhase(n.isHovered ? n.hoverTime : n.maxHoverTime);
      
      if (pulsePhase > 0.1) {
        const pulseAnim = 0.5 + 0.5 * Math.sin(n.age * 2.0); // pulse every ~3 seconds
        const baseGlowAlpha = CFG.pulseGlowIntensity * clamp01(pulsePhase / 3.0) * alpha;
        const glowAlpha = baseGlowAlpha * (0.7 + 0.3 * pulseAnim); // pulse between 70-100%
        const gradient = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r + CFG.pulseGlowRadius);
        gradient.addColorStop(0, rgbToCss(pulseCol, glowAlpha));
        gradient.addColorStop(1, rgbToCss(pulseCol, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + CFG.pulseGlowRadius, 0, Math.PI * 2);
        ctx.fill();
      }
  
      // draw the dot itself (always black)
      ctx.fillStyle = rgbToCss(CFG.nodeBaseColor, alpha);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // set branchFadingActive in beginFadeOutBranch
  const _beginFadeOutBranch = beginFadeOutBranch;
  beginFadeOutBranch = function(node) {
    _beginFadeOutBranch(node);
    node.branchFadingActive = true; // start sequencing newest-first
  };
  
  // kick off animation
  requestAnimationFrame(tick);
  