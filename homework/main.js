const ROOM_NAME  = "audiosync-lobby-001";
const CURSOR_R   = 6;
const HOVER_R    = 55;
const NUM_BARS   = 300;
const THRESHOLD  = 0.04;
const JITTER     = 0.05;
const UPDATE_RATE = 3;
const FFT_SIZE   = 1024;
const FFT_SMOOTH = 0.5;
const CURSOR_SEND_RATE = 3;
const STALE_TIMEOUT    = 4000;

const S = {
  NAME_ENTRY:       0,
  LOBBY:            1,
  PAIRING:          2,
  ACTIVITY_WAITING: 3,
  ACTIVITY_LIVE:    4,
  RESULTS:          5,
};

let state       = S.NAME_ENTRY;
let myName      = "";
let partnerName = "";
let partnerId   = null;
let myId        = Math.random().toString(36).substr(2, 8);

let hoveredPeer = null;
let peerCursors = new Map();
let pairingBusy = false;
let socketToId  = new Map();

let p5lm       = null;
let p5ref      = null;
let remoteSpectrum = null;

let mic, fft;
let bars1       = new Uint8Array(NUM_BARS);
let bars2       = new Uint8Array(NUM_BARS);
let tick        = 0;

let timerStart   = 0;
let timerElapsed = 0;

let avgSpectrum       = null;
let avgFrames         = 0;
let avgRemoteSpectrum = null;
let avgRemoteFrames   = 0;

let snapshotGfx     = null;
let snapshotDataURL = null;

let elNameScreen, elNameInput, elNameBtn;
let elPairPopup, elPairText, elPairButtons;
let elActivityOverlay, elActivityHud, elTimer, elPauseBtn;
let elResultsScreen, elResultsText, elSnapshotWrap, elResultsBtn;

function setup() {
  p5ref = this;
  createCanvas(windowWidth, windowHeight);
  noSmooth();
  textFont("monospace");

  elNameScreen      = document.getElementById("name-screen");
  elNameInput       = document.getElementById("name-input");
  elNameBtn         = document.getElementById("name-btn");
  elPairPopup       = document.getElementById("pair-popup");
  elPairText        = document.getElementById("pair-text");
  elPairButtons     = document.getElementById("pair-buttons");
  elActivityOverlay = document.getElementById("activity-overlay");
  elActivityHud     = document.getElementById("activity-hud");
  elTimer           = document.getElementById("timer");
  elPauseBtn        = document.getElementById("pause-btn");
  elResultsScreen   = document.getElementById("results-screen");
  elResultsText     = document.getElementById("results-text");
  elSnapshotWrap    = document.getElementById("snapshot-wrap");
  elResultsBtn      = document.getElementById("results-btn");

  elNameBtn.addEventListener("click", submitName);
  elNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitName();
  });
  elPauseBtn.addEventListener("click", pauseActivity);
  elResultsBtn.addEventListener("click", returnToLobby);
  document.getElementById("save-btn").addEventListener("click", saveSnapshot);

  elNameInput.focus();
}

function draw() {
  switch (state) {
    case S.NAME_ENTRY:
      background(0);
      break;

    case S.LOBBY:
    case S.PAIRING:
      drawLobby();
      broadcastCursor();
      break;

    case S.ACTIVITY_WAITING:
      background(0);
      break;

    case S.ACTIVITY_LIVE:
      background(0);
      noStroke();
      tick++;
      if (tick % UPDATE_RATE === 0) updateBars();
      renderLayers();
      timerElapsed = millis() - timerStart;
      elTimer.textContent = formatTime(timerElapsed);
      break;

    case S.RESULTS:
      background(0);
      break;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function netSend(obj) {
  if (!p5lm) return;
  obj.id = myId;
  p5lm.send(JSON.stringify(obj));
}

function broadcastCursor() {
  if (!p5lm || frameCount % CURSOR_SEND_RATE !== 0) return;
  netSend({
    t: "c", n: myName,
    x: Math.round(mouseX), y: Math.round(mouseY)
  });
}

function submitName() {
  let v = elNameInput.value.trim();
  if (!v) return;
  myName = v;
  elNameScreen.classList.remove("active");
  document.body.classList.add("hide-cursor");

  p5lm = new p5LiveMedia(p5ref, "DATA", null, ROOM_NAME);
  p5lm.on("data", onData);
  p5lm.on("disconnect", onDisconnect);

  enterLobby();
}

function onData(data, socketId) {
  let msg;
  try { msg = JSON.parse(data); } catch (e) { return; }
  if (msg.id === myId) return;
  if (msg.id) socketToId.set(socketId, msg.id);

  switch (msg.t) {
    case "c":
      peerCursors.set(msg.id, {
        x: msg.x, y: msg.y, name: msg.n, lastSeen: millis()
      });
      break;

    case "pr":
      if (msg.to !== myId) return;
      if (pairingBusy || state !== S.LOBBY) {
        netSend({ t: "busy", to: msg.id });
        return;
      }
      partnerId = msg.id;
      partnerName = msg.n;
      state = S.PAIRING;
      showPairIncoming(msg.n);
      break;

    case "pa":
      if (msg.to !== myId) return;
      if (state === S.PAIRING && partnerId === msg.id) {
        elPairPopup.classList.remove("active");
        enterActivity();
      }
      break;

    case "pd":
    case "pc":
      if (msg.to !== myId) return;
      if (state === S.PAIRING && partnerId === msg.id) {
        elPairPopup.classList.remove("active");
        pairingBusy = false;
        partnerId = null;
        partnerName = "";
        state = S.LOBBY;
      }
      break;

    case "busy":
      if (msg.to !== myId) return;
      if (state === S.PAIRING) {
        elPairText.textContent = partnerName + " is busy. try again later.";
        elPairButtons.innerHTML = "";
        setTimeout(function () {
          elPairPopup.classList.remove("active");
          pairingBusy = false;
          partnerId = null;
          partnerName = "";
          state = S.LOBBY;
        }, 2000);
      }
      break;

    case "s":
      if (msg.to !== myId || msg.id !== partnerId) return;
      if (state === S.ACTIVITY_LIVE) {
        remoteSpectrum = msg.d;
      }
      break;

    case "go":
      if (msg.to !== myId || msg.id !== partnerId) return;
      if (state === S.ACTIVITY_WAITING) {
        startActivityLocal();
      }
      break;

    case "stop":
      if (msg.to !== myId || msg.id !== partnerId) return;
      if (state === S.ACTIVITY_LIVE) {
        pauseActivityLocal();
      }
      break;
  }
}

function onDisconnect(socketId) {
  let cid = socketToId.get(socketId);
  if (!cid) return;
  peerCursors.delete(cid);
  socketToId.delete(socketId);

  if (cid === partnerId) {
    if (state === S.PAIRING) {
      elPairPopup.classList.remove("active");
      pairingBusy = false;
      partnerId = null;
      partnerName = "";
      state = S.LOBBY;
    } else if (state === S.ACTIVITY_WAITING || state === S.ACTIVITY_LIVE) {
      pauseActivityLocal();
    }
  }
}

function enterLobby() {
  state = S.LOBBY;
  hoveredPeer = null;
  pairingBusy = false;
  partnerId   = null;
  partnerName = "";
  remoteSpectrum = null;

  hideAllOverlays();
  document.body.classList.add("hide-cursor");
}

function requestPairing(peerId) {
  let peer = peerCursors.get(peerId);
  if (!peer) return;
  if (pairingBusy) return;

  partnerId   = peerId;
  partnerName = peer.name;
  pairingBusy = true;
  state       = S.PAIRING;

  netSend({ t: "pr", to: peerId, n: myName });
  showPairWaiting(partnerName);
}

function showPairWaiting(name) {
  elPairText.textContent = "waiting for " + name + " to respond...";
  elPairButtons.innerHTML = "";
  let cancelBtn = document.createElement("button");
  cancelBtn.textContent = "cancel";
  cancelBtn.addEventListener("click", function () {
    netSend({ t: "pc", to: partnerId });
    elPairPopup.classList.remove("active");
    pairingBusy = false;
    partnerId = null;
    partnerName = "";
    state = S.LOBBY;
  });
  elPairButtons.appendChild(cancelBtn);
  elPairPopup.classList.add("active");
}

function showPairIncoming(name) {
  elPairText.textContent = name + " wants to sync audio with you.";
  elPairButtons.innerHTML = "";

  let acceptBtn = document.createElement("button");
  acceptBtn.textContent = "accept";
  acceptBtn.addEventListener("click", function () {
    netSend({ t: "pa", to: partnerId, n: myName });
    elPairPopup.classList.remove("active");
    enterActivity();
  });

  let declineBtn = document.createElement("button");
  declineBtn.textContent = "decline";
  declineBtn.addEventListener("click", function () {
    netSend({ t: "pd", to: partnerId });
    elPairPopup.classList.remove("active");
    pairingBusy = false;
    partnerId = null;
    partnerName = "";
    state = S.LOBBY;
  });

  elPairButtons.appendChild(acceptBtn);
  elPairButtons.appendChild(declineBtn);
  elPairPopup.classList.add("active");
  pairingBusy = true;
}

function enterActivity() {
  state = S.ACTIVITY_WAITING;
  hideAllOverlays();
  document.body.classList.remove("hide-cursor");

  bars1.fill(0);
  bars2.fill(0);
  tick = 0;
  avgSpectrum       = null;
  avgFrames         = 0;
  avgRemoteSpectrum = null;
  avgRemoteFrames   = 0;
  timerStart        = 0;
  timerElapsed      = 0;
  remoteSpectrum    = null;

  elTimer.textContent = "00:00.0";
  elActivityHud.classList.add("active");
  elActivityOverlay.classList.add("active");

  if (!mic) {
    userStartAudio();
    mic = new p5.AudioIn();
    mic.start(function () {
      fft = new p5.FFT(FFT_SMOOTH, FFT_SIZE);
      fft.setInput(mic);
    });
  }
}

function startActivity() {
  if (state !== S.ACTIVITY_WAITING) return;
  netSend({ t: "go", to: partnerId });
  startActivityLocal();
}

function startActivityLocal() {
  if (state !== S.ACTIVITY_WAITING) return;
  state = S.ACTIVITY_LIVE;
  elActivityOverlay.classList.remove("active");
  timerStart = millis();
}

function pauseActivity() {
  if (state !== S.ACTIVITY_LIVE) return;
  netSend({ t: "stop", to: partnerId });
  pauseActivityLocal();
}

function pauseActivityLocal() {
  if (state !== S.ACTIVITY_LIVE && state !== S.ACTIVITY_WAITING) return;
  if (state === S.ACTIVITY_LIVE) {
    timerElapsed = millis() - timerStart;
  }
  state = S.RESULTS;
  elActivityHud.classList.remove("active");
  generateSnapshot();
  showResults();
}

function showResults() {
  elResultsText.textContent =
    "this is the unique audio code you and " + partnerName + " share!";

  elSnapshotWrap.innerHTML = "";
  if (snapshotGfx) {
    snapshotDataURL = snapshotGfx.elt.toDataURL("image/png");
    let img = document.createElement("img");
    img.src = snapshotDataURL;
    img.style.width = "100%";
    img.style.maxWidth = "600px";
    img.style.height = "auto";
    img.style.display = "block";
    elSnapshotWrap.appendChild(img);
    snapshotGfx.remove();
    snapshotGfx = null;
  }

  document.getElementById("save-btn").style.display = snapshotDataURL ? "" : "none";
  elResultsScreen.classList.add("active");
}

function saveSnapshot() {
  if (!snapshotDataURL) return;
  let a = document.createElement("a");
  a.href = snapshotDataURL;
  a.download = "audiocode-" + myName + "-" + partnerName + ".png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function returnToLobby() {
  hideAllOverlays();
  elActivityHud.classList.remove("active");
  snapshotDataURL = null;
  enterLobby();
}

function hideAllOverlays() {
  elNameScreen.classList.remove("active");
  elPairPopup.classList.remove("active");
  elActivityOverlay.classList.remove("active");
  elActivityHud.classList.remove("active");
  elResultsScreen.classList.remove("active");
}

function keyPressed() {
  if (keyCode === ENTER && state === S.ACTIVITY_WAITING) {
    startActivity();
    return false;
  }
}

function drawLobby() {
  let now = millis();
  for (let [id, c] of peerCursors) {
    if (now - c.lastSeen > STALE_TIMEOUT) {
      peerCursors.delete(id);
    }
  }

  hoveredPeer = null;
  for (let [id, c] of peerCursors) {
    let d = dist(mouseX, mouseY, c.x, c.y);
    if (d < HOVER_R) {
      hoveredPeer = id;
      break;
    }
  }

  let hovered = hoveredPeer !== null;
  let bgVal  = hovered ? 210 : 0;
  let dotVal = hovered ? 30 : 220;

  background(bgVal);
  noStroke();

  fill(hovered ? 120 : 80);
  textSize(10);
  textAlign(CENTER, TOP);
  text("hover over a user and click to send a sync request", width / 2, 18);

  for (let [id, c] of peerCursors) {
    if (id === hoveredPeer) {
      fill(200, 50, 50);
    } else {
      fill(dotVal);
    }
    ellipse(c.x, c.y, CURSOR_R * 2);

    textSize(10);
    textAlign(CENTER, TOP);
    if (id === hoveredPeer) {
      fill(200, 50, 50);
    } else {
      fill(dotVal);
    }
    text(c.name, c.x, c.y + CURSOR_R + 6);
  }

  fill(dotVal);
  ellipse(mouseX, mouseY, CURSOR_R * 2);
  textSize(9);
  textAlign(CENTER, TOP);
  text(myName, mouseX, mouseY + CURSOR_R + 6);
}

function mousePressed() {
  if (state === S.LOBBY && hoveredPeer) {
    requestPairing(hoveredPeer);
  }
}

function touchStarted() {
  if (state === S.LOBBY && hoveredPeer) {
    requestPairing(hoveredPeer);
  }
  return false;
}

function updateBars() {
  let localSpec = fft ? fft.analyze() : null;

  if (localSpec) {
    fillBars(localSpec, bars1, NUM_BARS, THRESHOLD, JITTER);

    if (!avgSpectrum) {
      avgSpectrum = new Float32Array(localSpec.length);
    }
    for (let i = 0; i < localSpec.length; i++) {
      avgSpectrum[i] = (avgSpectrum[i] * avgFrames + localSpec[i]) / (avgFrames + 1);
    }
    avgFrames++;

    if (partnerId) {
      netSend({ t: "s", to: partnerId, d: downsample(localSpec, 128) });
    }
  } else {
    bars1.fill(0);
  }

  if (remoteSpectrum) {
    fillBars(remoteSpectrum, bars2, NUM_BARS, THRESHOLD * 0.85, JITTER * 1.4);

    if (!avgRemoteSpectrum) {
      avgRemoteSpectrum = new Float32Array(remoteSpectrum.length);
    }
    for (let i = 0; i < remoteSpectrum.length; i++) {
      avgRemoteSpectrum[i] =
        (avgRemoteSpectrum[i] * avgRemoteFrames + remoteSpectrum[i]) / (avgRemoteFrames + 1);
    }
    avgRemoteFrames++;
  } else {
    bars2.fill(0);
  }
}

function downsample(arr, targetLen) {
  let result = [];
  let step = arr.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    let a = Math.floor(i * step);
    let b = Math.min(Math.floor((i + 1) * step), arr.length);
    let sum = 0;
    for (let j = a; j < b; j++) sum += arr[j];
    result.push(Math.round(sum / (b - a)));
  }
  return result;
}

function fillBars(spectrum, target, count, thresh, jit) {
  let step = spectrum.length / count;
  for (let i = 0; i < count; i++) {
    let a   = Math.floor(i * step);
    let b   = Math.max(a + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = a; j < b; j++) sum += spectrum[j];
    let avg = (sum / ((b - a) * 255)) * 2.5;
    target[i] = avg + (Math.random() - 0.5) * jit >= thresh ? 1 : 0;
  }
}

function renderLayers() {
  let barW = width / NUM_BARS;
  fill(255);
  drawBarSet(bars1, barW, 0, height, false);
  drawBarSet(bars2, barW, 0, height, true);
}

function drawBarSet(bars, barW, y, h, mirrored) {
  let count = bars.length;
  let i = 0;
  while (i < count) {
    if (!bars[i]) { i++; continue; }
    let start = i;
    while (i < count && bars[i]) i++;
    if (mirrored) {
      let x1 = width - Math.round(i * barW);
      let x2 = width - Math.round(start * barW);
      rect(x1, y, x2 - x1, h);
    } else {
      let x = Math.round(start * barW);
      let w = Math.round(i * barW) - x;
      rect(x, y, w, h);
    }
  }
}

function generateSnapshot() {
  let sw = 600;
  let sh = 200;
  snapshotGfx = createGraphics(sw, sh);
  snapshotGfx.background(0);
  snapshotGfx.noStroke();
  snapshotGfx.noSmooth();

  let snap1 = new Uint8Array(NUM_BARS);
  let snap2 = new Uint8Array(NUM_BARS);

  if (avgSpectrum && avgFrames > 0) {
    fillBars(Array.from(avgSpectrum), snap1, NUM_BARS, THRESHOLD * 0.7, JITTER * 0.5);
  }

  if (avgRemoteSpectrum && avgRemoteFrames > 0) {
    fillBars(Array.from(avgRemoteSpectrum), snap2, NUM_BARS, THRESHOLD * 0.6, JITTER * 0.7);
  } else if (avgSpectrum && avgFrames > 0) {
    fillBars(Array.from(avgSpectrum), snap2, NUM_BARS, THRESHOLD * 0.6, JITTER * 0.7);
  }

  let barW = sw / NUM_BARS;
  snapshotGfx.fill(255);
  drawBarSetOn(snapshotGfx, snap1, barW, 0, sh, false);
  drawBarSetOn(snapshotGfx, snap2, barW, 0, sh, true);
}

function drawBarSetOn(gfx, bars, barW, y, h, mirrored) {
  let count = bars.length;
  let w = gfx.width;
  let i = 0;
  while (i < count) {
    if (!bars[i]) { i++; continue; }
    let start = i;
    while (i < count && bars[i]) i++;
    if (mirrored) {
      let x1 = w - Math.round(i * barW);
      let x2 = w - Math.round(start * barW);
      gfx.rect(x1, y, x2 - x1, h);
    } else {
      let x = Math.round(start * barW);
      let rw = Math.round(i * barW) - x;
      gfx.rect(x, y, rw, h);
    }
  }
}

function formatTime(ms) {
  let totalSec = Math.floor(ms / 1000);
  let mins = Math.floor(totalSec / 60);
  let secs = totalSec % 60;
  let tenths = Math.floor((ms % 1000) / 100);
  return (mins < 10 ? "0" : "") + mins + ":" +
         (secs < 10 ? "0" : "") + secs + "." + tenths;
}
