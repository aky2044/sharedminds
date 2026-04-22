let srcImg;
let feedbackImg;
let cleanG;
let edgePts = [];
let interiorPts = [];
let cx, cy, drawW, drawH;

const MAGENTA = [200, 0, 210];
const LIME = [160, 255, 40];
const LIME_BRIGHT = [200, 255, 80];
const FEEDBACK_ALPHA = 248;
const SCALE_ECHO = 1.0035;
const JITTER_AMP = 18;
const STRIP_H = 3;
const EDGE_STEP = 2;
const MAX_EDGES = 7000;

function preload() {
  srcImg = loadImage(
    "3.png",
    function () {},
    function () {
      console.warn("Could not load 3.png — place it next to index.html.");
    }
  );
}

function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, windowHeight);
  noStroke();
  imageMode(CENTER);
  if (srcImg && srcImg.width > 0) {
    buildShapeAndEdges();
  }
}

function buildShapeAndEdges() {
  srcImg.loadPixels();
  let w = srcImg.width;
  let h = srcImg.height;
  cleanG = createGraphics(w, h);
  cleanG.pixelDensity(1);
  cleanG.loadPixels();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let i = (y * w + x) * 4;
      let r = srcImg.pixels[i];
      let g = srcImg.pixels[i + 1];
      let b = srcImg.pixels[i + 2];
      let br = (r + g + b) / 3;
      let o = (y * w + x) * 4;
      if (br < 140) {
        cleanG.pixels[o] = LIME[0];
        cleanG.pixels[o + 1] = LIME[1];
        cleanG.pixels[o + 2] = LIME[2];
        cleanG.pixels[o + 3] = 255;
      } else {
        cleanG.pixels[o + 3] = 0;
      }
    }
  }
  cleanG.updatePixels();

  edgePts.length = 0;
  interiorPts.length = 0;
  let tries = 0;
  while (interiorPts.length < 900 && tries < 20000) {
    tries++;
    let sx = floor(random(w));
    let sy = floor(random(h));
    let i = (sy * w + sx) * 4;
    if (cleanG.pixels[i + 3] < 200) continue;
    let nUp = cleanG.pixels[((max(0, sy - 4)) * w + sx) * 4 + 3] < 128;
    let nDn = cleanG.pixels[((min(h - 1, sy + 4)) * w + sx) * 4 + 3] < 128;
    let nLf = cleanG.pixels[(sy * w + max(0, sx - 4)) * 4 + 3] < 128;
    let nRt = cleanG.pixels[(sy * w + min(w - 1, sx + 4)) * 4 + 3] < 128;
    if (nUp || nDn || nLf || nRt) continue;
    interiorPts.push({ x: sx / w, y: sy / h });
  }

  for (let y = EDGE_STEP; y < h - EDGE_STEP; y += EDGE_STEP) {
    for (let x = EDGE_STEP; x < w - EDGE_STEP; x += EDGE_STEP) {
      let i = (y * w + x) * 4;
      if (cleanG.pixels[i + 3] < 128) continue;
      let nUp = cleanG.pixels[((y - EDGE_STEP) * w + x) * 4 + 3] < 128;
      let nDn = cleanG.pixels[((y + EDGE_STEP) * w + x) * 4 + 3] < 128;
      let nLf = cleanG.pixels[(y * w + (x - EDGE_STEP)) * 4 + 3] < 128;
      let nRt = cleanG.pixels[(y * w + (x + EDGE_STEP)) * 4 + 3] < 128;
      if (nUp || nDn || nLf || nRt) {
        edgePts.push({ x: x / w, y: y / h });
        if (edgePts.length >= MAX_EDGES) break;
      }
    }
    if (edgePts.length >= MAX_EDGES) break;
  }

  layoutShape();
}

function layoutShape() {
  if (!cleanG) return;
  let ar = cleanG.width / cleanG.height;
  let margin = 0.08;
  let maxW = width * (1 - margin * 2);
  let maxH = height * (1 - margin * 2);
  if (maxW / maxH > ar) {
    drawH = maxH;
    drawW = drawH * ar;
  } else {
    drawW = maxW;
    drawH = drawW / ar;
  }
  cx = width / 2;
  cy = height / 2;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layoutShape();
}

function draw() {
  if (!cleanG || cleanG.width < 1) {
    background(MAGENTA);
    fill(255);
    textAlign(CENTER, CENTER);
    text("loading 3.png…", width / 2, height / 2);
    return;
  }

  background(MAGENTA[0], MAGENTA[1], MAGENTA[2]);

  if (feedbackImg && feedbackImg.width === width && feedbackImg.height === height) {
    push();
    translate(width / 2, height / 2);
    scale(SCALE_ECHO);
    translate(-width / 2, -height / 2);
    tint(255, FEEDBACK_ALPHA);
    drawImageStripJitter(feedbackImg);
    noTint();
    pop();
  }

  drawSpikyHalo();
  drawInteriorMottle();
  drawFringeScanlines();
  drawSoftGlowUnder();
  drawCrispTubeOverlay();

  feedbackImg = get(0, 0, width, height);
}

function drawImageStripJitter(img) {
  let ctx = drawingContext;
  let c = img.canvas || img.elt;
  if (!c) {
    image(img, 0, 0, width, height);
    return;
  }
  for (let y = 0; y < height; y += STRIP_H) {
    let h = min(STRIP_H, height - y);
    let j =
      (noise(y * 0.035, frameCount * 0.04) - 0.5) * JITTER_AMP +
      (noise(y * 0.12 + 99, frameCount * 0.08) - 0.5) * (JITTER_AMP * 0.35);
    ctx.drawImage(c, 0, y, width, h, j, y, width, h);
  }
}

function drawInteriorMottle() {
  noStroke();
  let t = frameCount * 0.015;
  for (let i = 0; i < interiorPts.length; i++) {
    let p = interiorPts[i];
    let wx = cx + (p.x - 0.5) * drawW;
    let wy = cy + (p.y - 0.5) * drawH;
    let n = noise(p.x * 6, p.y * 6, t);
    let sz = 1.5 + n * 5;
    if (n > 0.52) {
      fill(LIME[0], LIME[1], LIME[2], 28 + n * 45);
    } else {
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 15 + (1 - n) * 35);
    }
    ellipse(wx, wy, sz, sz * (0.7 + n * 0.5));
  }
}

function drawSpikyHalo() {
  let t = frameCount * 0.017;
  let seed = frameCount * 0.003;
  let phase = frameCount % 2;

  for (let k = phase; k < edgePts.length; k += 2) {
    let p = edgePts[k];
    let px = cx + (p.x - 0.5) * drawW;
    let py = cy + (p.y - 0.5) * drawH;

    let n1 = noise(p.x * 8 + seed, p.y * 8);
    let n2 = noise(p.x * 20 - seed * 2, p.y * 20 + t);
    let ang = n1 * Math.PI * 2 + t * 0.4;
    let len = 2 + n2 * 22 + Math.abs(Math.sin(t + p.x * 30)) * 8;
    let x2 = px + Math.cos(ang) * len;
    let y2 = py + Math.sin(ang) * len * 0.35;

    let useGreen = noise(k * 0.1, t) > 0.42;
    if (useGreen) {
      stroke(LIME_BRIGHT[0], LIME_BRIGHT[1], LIME_BRIGHT[2], 140 + n2 * 100);
    } else {
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 90 + n2 * 80);
    }
    strokeWeight(0.6 + n2 * 0.8);
    line(px, py, x2, y2);

    if (k % 3 === 0) {
      let len2 = len * 0.6;
      let ang2 = ang + (noise(k, seed) - 0.5) * 1.2;
      stroke(LIME[0], LIME[1], LIME[2], 70);
      strokeWeight(0.35);
      line(px, py, px + Math.cos(ang2) * len2, py + Math.sin(ang2) * len2 * 0.25);
    }
  }
}

function drawFringeScanlines() {
  blendMode(SCREEN);
  let rows = floor(height / 2);
  for (let r = 0; r < rows; r++) {
    let y = r * 2;
    let n = noise(r * 0.08, frameCount * 0.06);
    if (n > 0.72) {
      let wobble = (noise(r * 0.2, frameCount * 0.1) - 0.5) * 40;
      stroke(LIME_BRIGHT[0], LIME_BRIGHT[1], LIME_BRIGHT[2], (n - 0.72) * 400);
      strokeWeight(1);
      line(wobble, y, width + wobble, y);
    }
  }
  blendMode(BLEND);
}

function drawSoftGlowUnder() {
  push();
  noStroke();
  imageMode(CENTER);
  tint(LIME[0], LIME[1], LIME[2], 55);
  image(cleanG, cx, cy, drawW * 1.08, drawH * 1.08);
  tint(LIME_BRIGHT[0], LIME_BRIGHT[1], LIME_BRIGHT[2], 35);
  image(cleanG, cx, cy, drawW * 1.04, drawH * 1.04);
  noTint();
  pop();
}

function drawCrispTubeOverlay() {
  push();
  noStroke();
  imageMode(CENTER);
  blendMode(SCREEN);
  tint(LIME_BRIGHT[0], LIME_BRIGHT[1], LIME_BRIGHT[2], 200);
  image(cleanG, cx, cy, drawW * 1.012, drawH * 1.012);
  noTint();
  blendMode(BLEND);
  image(cleanG, cx, cy, drawW, drawH);
  pop();
}
