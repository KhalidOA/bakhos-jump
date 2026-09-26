(() => {
  'use strict';

  // ---- Fixed logical resolution: physics/drawing always use these units,
  // the canvas is scaled+letterboxed to fit whatever real screen it's on. ----
  const LW = 400;
  const LH = 700;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(window.innerWidth / LW, window.innerHeight / LH);
    canvas.style.width = (LW * scale) + 'px';
    canvas.style.height = (LH * scale) + 'px';
    canvas.width = Math.round(LW * scale * dpr);
    canvas.height = Math.round(LH * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // ---- Constants (tuned in logical px, scaled by dt so frame-rate independent) ----
  const GRAVITY = 1050;      // px/s^2
  const FLAP_VELOCITY = -370; // px/s
  const MAX_FALL = 550;
  const GROUND_H = 54;
  const PIPE_W = 74;
  const GAP_H = 250;
  const PIPE_SPEED = 115;    // px/s
  const PIPE_INTERVAL = 1750; // ms
  const PLAYER_X = LW * 0.28;
  // Deliberately smaller than the sprite's full bounding box: drawPlayer()
  // rotates the face sprite up to -0.3..+0.5 rad depending on vertical
  // speed, but this hitbox doesn't rotate with it, and a box sized to the
  // sprite's full visual extent (the face circle plus legs) caused "unfair"
  // deaths where the tilted sprite visually missed a pipe the static box
  // still overlapped. Sized instead to sit inside the face's solid core.
  const HALF_W = 26;
  const HALF_H = 18;
  const HORIZON_Y = LH - GROUND_H - 30;
  const SKY_SCALE = 2.3;      // blows the skyline drawings up to fill most of the screen
  const SKY_SPEED = 46;       // px/s on-screen scroll speed for the near skyline layer
  const SKY_SPEED_FAR = 24;   // px/s for the lighter, more distant layer — slower, for parallax depth

  const BEST_KEY = 'bjBest';
  const MUTE_KEY = 'bjMuted';
  const CHARACTER_KEY = 'bjFace';
  const MUTE_BTN = { x: LW - 46, y: 10, w: 36, h: 36 };
  const GAMEOVER_CARD = { x: 40, y: 160, w: 320, h: 258 };
  const GAMEOVER_CHIP1 = { x: 60, y: 252, w: 132, h: 78 };
  const GAMEOVER_CHIP2 = { x: 208, y: 252, w: 132, h: 78 };
  const SHARE_BTN = { x: 60, y: 348, w: 280, h: 46 };

  // ---- Bakhos Jump design tokens: night-party palette (deep purple, hot
  // pink/gold neon accents) ----
  const BJ_BG = '#1b1030';
  const BJ_SURFACE = '#2e2150';
  const BJ_TEXT = '#fdf6ff';
  const BJ_ACCENT = '#ff6ec7';
  const BJ_ACCENT_DARK = '#c73fa0';
  const BJ_ACCENT_2 = '#7df9ff';
  const FONT_HEAD = '"Baloo 2", sans-serif';
  const FONT_BODY = '"Inter", system-ui, sans-serif';

  // ---- Home screen layout (character select + play, all on one screen) ----
  const PLAY_BTN = { x: 22, y: 596, w: 356, h: 64 };

  // ---- Procedurally generated background music (no audio files) ----
  // Same looping rhythmic phrase every run, transposed onto a maqam (Arabic
  // melodic mode) at a fixed root note and tempo. Neutral (non-12-TET) scale
  // steps like 1.5 or 3.5 semitones are real maqam intervals (e.g. Bayati's
  // neutral 2nd) — oscillators can play any frequency, so we don't need to
  // round them to a piano keyboard.
  const Music = (() => {
    const MAQAM = {
      hijaz: [0, 1, 4, 5, 7, 8, 11, 12],       // Hijaz — augmented 2nd, the "classic" Arabic sound
      bayati: [0, 1.5, 3, 5, 7, 8, 10, 12],    // Bayati — neutral 2nd, very common in the Levant
      rast: [0, 2, 3.5, 5, 7, 9, 10.5, 12],    // Rast — neutral 3rd/7th, foundational Arabic maqam
      kurd: [0, 1, 3, 5, 7, 8, 10, 12],        // Kurd — phrygian-like
      nahawand: [0, 2, 3, 5, 7, 8, 10, 12],    // Nahawand — harmonic-minor-like, more somber
    };
    const MELODY = [4, -1, 3, 2, 3, -1, 1, 0, 0, -1, 1, 2, 4, -1, 2, -1];
    const ROOT_FREQ = 293.66;
    const TEMPO = 108;

    function buildScale(root, offsets) {
      return offsets.map(semi => root * Math.pow(2, semi / 12));
    }

    const SCALE = buildScale(ROOT_FREQ, MAQAM.hijaz);
    const STEP_DUR = 60 / TEMPO / 2;
    const rootFreq = ROOT_FREQ;

    let ctx = null;
    let masterGain = null;
    let drone = null;
    let started = false;
    let muted = localStorage.getItem(MUTE_KEY) === '1';
    let nextStepTime = 0;
    let stepIndex = 0;
    let schedulerTimer = null;

    function playNote(freq, time, dur) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.18, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(g).connect(masterGain);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    }

    function playHit(time, dum) {
      const dur = dum ? 0.16 : 0.07;
      const size = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < size; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, dum ? 2 : 4);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = dum ? 'lowpass' : 'highpass';
      filter.frequency.value = dum ? 300 : 2500;
      const g = ctx.createGain();
      g.gain.value = dum ? 0.45 : 0.2;
      src.connect(filter).connect(g).connect(masterGain);
      src.start(time);
    }

    function scheduler() {
      while (nextStepTime < ctx.currentTime + 0.2) {
        const deg = MELODY[stepIndex % MELODY.length];
        if (deg >= 0) playNote(SCALE[deg], nextStepTime, STEP_DUR * 1.4);
        if (stepIndex % 8 === 0) playHit(nextStepTime, true);
        else if (stepIndex % 4 === 0) playHit(nextStepTime, false);
        nextStepTime += STEP_DUR;
        stepIndex++;
      }
    }

    function start() {
      if (started) return;
      started = true;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.35;
      masterGain.connect(ctx.destination);

      drone = ctx.createOscillator();
      drone.type = 'sine';
      drone.frequency.value = rootFreq / 2;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.07;
      drone.connect(droneGain).connect(masterGain);
      drone.start();

      nextStepTime = ctx.currentTime + 0.1;
      stepIndex = 0;
      schedulerTimer = setInterval(scheduler, 100);
    }

    function resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    }

    function toggleMute() {
      muted = !muted;
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, ctx.currentTime, 0.05);
    }

    return { start, resume, toggleMute, isMuted: () => muted };
  })();

  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // ---- Single fixed map: night-party skyline ----
  const MAP_NEAR_COLOR = '#140a24';
  const MAP_FAR_COLOR = '#4b2e73';

  // ---- Obstacle theme: neon spike walls lining the gap ----
  const SPIKE_GRADIENT_STOPS = [[0, '#ff6ec7'], [0.5, '#c77dff'], [1, '#7df9ff']];

  // ---- Home screen layout: 5 face cards, 3 on top + 2 centered below ----
  const NUM_FACES = 5;
  const TOP_ROW_COUNT = 3;
  const FACE_GRID = { top: 290, cardSize: 96, colGap: 16, rowGap: 16, sideMargin: 40 };
  const faceCardRects = Array.from({ length: NUM_FACES }, (_, i) => {
    if (i < TOP_ROW_COUNT) {
      return {
        x: FACE_GRID.sideMargin + i * (FACE_GRID.cardSize + FACE_GRID.colGap),
        y: FACE_GRID.top,
        w: FACE_GRID.cardSize,
        h: FACE_GRID.cardSize,
      };
    }
    const bottomCol = i - TOP_ROW_COUNT;
    const bottomRowW = 2 * FACE_GRID.cardSize + FACE_GRID.colGap;
    const bottomStartX = LW / 2 - bottomRowW / 2;
    return {
      x: bottomStartX + bottomCol * (FACE_GRID.cardSize + FACE_GRID.colGap),
      y: FACE_GRID.top + FACE_GRID.cardSize + FACE_GRID.rowGap,
      w: FACE_GRID.cardSize,
      h: FACE_GRID.cardSize,
    };
  });
  // Hosted off-repo (not committed to this repo) on catbox.moe, so photos
  // aren't sitting in git history. TODO: paste each real catbox.moe URL in
  // once photos are received from the user.
  const FACE_URLS = [
    '', // TODO: player 1
    '', // TODO: player 2
    '', // TODO: player 3
    '', // TODO: player 4
    '', // TODO: player 5
  ];
  const FACE_IMAGES = FACE_URLS.map(url => {
    const img = new Image();
    if (url) img.src = url;
    return img;
  });
  // Distinct placeholder tint per slot, shown only until a real photo loads
  // (drawRiderFace/drawHomeScreen fall through to this when the face image
  // has no src or hasn't finished loading yet).
  const FACE_FALLBACK_COLORS = ['#ff6ec7', '#7df9ff', '#c77dff', '#ffd700', '#ff9f6e'];

  let state = 'home'; // home | playing | gameover
  let selectedFace;
  let player, pipes, score, best, spawnTimer, groundOffset, skyScrollX, skyScrollXFar, lastTime;
  let speedRamp, hardModeTriggered;
  const HARD_MODE_SCORE = 100;
  const HARD_MODE_BOOST = 0.35; // +35% speed once the ramp is fully eased in
  let flapAnim = 0;
  let popups; // floating "+N" text (unused for now, kept for future bonus effects)
  let deathGlitter = [];
  let joke = '';

  const LEBANESE_JOKES = [
    'Yalla, try again — the manoushe is getting cold.',
    'Even your teta jumps better than that.',
    'That spike said marhaba on the way in.',
    'Habibi... work on that timing.',
    'You just got zaatar\'d.',
    'The DJ paused the dabke for that one.',
    'Bas! One more try, star.',
    'Lebanon called — it wants its reflexes back.',
  ];

  const GLITTER_COLORS = ['#ffd700', '#ff6ec7', '#7df9ff', '#c77dff', '#ffffff'];

  function makeGlitter() {
    const particles = [];
    for (let i = 0; i < 70; i++) {
      particles.push({
        x: Math.random() * LW,
        y: Math.random() * LH,
        r: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        color: GLITTER_COLORS[Math.floor(Math.random() * GLITTER_COLORS.length)],
      });
    }
    return particles;
  }

  function resetGame() {
    player = { y: LH * 0.42, vy: 0 };
    pipes = [];
    popups = [];
    score = 0;
    spawnTimer = 0;
    groundOffset = 0;
    skyScrollX = 0;
    skyScrollXFar = 0;
    flapAnim = 0;
    speedRamp = 0;
    hardModeTriggered = false;
  }

  best = Number(localStorage.getItem(BEST_KEY) || 0);
  selectedFace = Number(localStorage.getItem(CHARACTER_KEY) || 0);
  resetGame();

  function selectFace(index) {
    selectedFace = index;
    localStorage.setItem(CHARACTER_KEY, String(index));
  }

  function startRun() {
    resetGame();
    state = 'playing';
    player.vy = FLAP_VELOCITY;
    flapAnim = 1;
  }

  function flap() {
    if (state === 'playing') {
      player.vy = FLAP_VELOCITY;
      flapAnim = 1;
    } else if (state === 'gameover') {
      resetGame();
      state = 'home';
    }
  }

  function getActiveButtons() {
    if (state === 'home') {
      const buttons = faceCardRects.map((rect, i) => ({ rect, onTap: () => selectFace(i) }));
      buttons.push({ rect: PLAY_BTN, onTap: () => startRun() });
      return buttons;
    }
    if (state === 'gameover') {
      return [{ rect: SHARE_BTN, onTap: () => shareScore() }];
    }
    return [];
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    Music.start();
    Music.resume();

    const rect = canvas.getBoundingClientRect();
    const lx = (e.clientX - rect.left) * (LW / rect.width);
    const ly = (e.clientY - rect.top) * (LH / rect.height);

    if (pointInRect(lx, ly, MUTE_BTN)) {
      Music.toggleMute();
      return;
    }

    for (const b of getActiveButtons()) {
      if (pointInRect(lx, ly, b.rect)) {
        b.onTap();
        return;
      }
    }

    if (state === 'playing' || state === 'gameover') {
      flap();
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      Music.start();
      Music.resume();
      flap();
    }
  });

  function spawnPipe() {
    const margin = 70;
    const gapY = margin + Math.random() * (LH - GROUND_H - margin * 2 - GAP_H) + GAP_H / 2;
    pipes.push({ x: LW + PIPE_W, gapY, scored: false });
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function update(dt) {
    if (state !== 'playing') return;

    player.vy += GRAVITY * dt;
    if (player.vy > MAX_FALL) player.vy = MAX_FALL;
    player.y += player.vy * dt;

    const hardMode = score >= HARD_MODE_SCORE;
    speedRamp += ((hardMode ? 1 : 0) - speedRamp) * Math.min(1, dt * 2);
    const speedMul = 1 + speedRamp * HARD_MODE_BOOST;
    if (hardMode && !hardModeTriggered) {
      hardModeTriggered = true;
      popups.push({ x: PLAYER_X, y: player.y - HALF_H - 6, age: 0, text: 'Yalla! Faster!' });
    }

    spawnTimer += dt * 1000;
    if (spawnTimer >= PIPE_INTERVAL) {
      spawnTimer = 0;
      spawnPipe();
    }

    const groundY = LH - GROUND_H;
    let dead = false;

    for (const p of pipes) {
      p.x -= PIPE_SPEED * speedMul * dt;

      const topH = p.gapY - GAP_H / 2;
      const botY = p.gapY + GAP_H / 2;

      if (rectsOverlap(PLAYER_X - HALF_W, player.y - HALF_H, HALF_W * 2, HALF_H * 2, p.x, 0, PIPE_W, topH) ||
          rectsOverlap(PLAYER_X - HALF_W, player.y - HALF_H, HALF_W * 2, HALF_H * 2, p.x, botY, PIPE_W, groundY - botY)) {
        dead = true;
      }

      if (!p.scored && p.x + PIPE_W < PLAYER_X - HALF_W) {
        p.scored = true;
        score++;
      }
    }

    pipes = pipes.filter(p => p.x + PIPE_W > -10);

    for (const pop of popups) pop.age += dt;
    popups = popups.filter(pop => pop.age < 0.6);

    if (player.y - HALF_H < 0) {
      player.y = HALF_H;
      player.vy = 0;
    }
    if (player.y + HALF_H > groundY) {
      player.y = groundY - HALF_H;
      dead = true;
    }

    if (dead) {
      state = 'gameover';
      joke = LEBANESE_JOKES[Math.floor(Math.random() * LEBANESE_JOKES.length)];
      deathGlitter = makeGlitter();
      if (score > best) {
        best = score;
        localStorage.setItem(BEST_KEY, String(best));
      }
    }

    groundOffset = (groundOffset + PIPE_SPEED * speedMul * dt) % 40;
    skyScrollX = (skyScrollX + SKY_SPEED * speedMul * dt) % (BASE_SKYLINE_W * SKY_SCALE);
    skyScrollXFar = (skyScrollXFar + SKY_SPEED_FAR * speedMul * dt) % (BASE_SKYLINE_W * SKY_SCALE);
    if (flapAnim > 0) flapAnim = Math.max(0, flapAnim - dt * 3);
  }

  // ---------------- Drawing ----------------

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, LH);
    g.addColorStop(0, '#170b2e');
    g.addColorStop(0.45, '#4b1f6b');
    g.addColorStop(1, '#ff6ec7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LW, LH);

    ctx.fillStyle = 'rgba(255, 235, 250, 0.85)';
    ctx.beginPath();
    ctx.arc(LW * 0.78, LH * 0.22, 46, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHorizon() {
    ctx.fillStyle = 'rgba(60, 20, 90, 0.35)';
    const amp = 14;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON_Y + 40);
    for (let x = 0; x <= LW; x += 40) {
      const y = HORIZON_Y + Math.sin((x + groundOffset * 0.4) * 0.02) * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(LW, LH);
    ctx.lineTo(0, LH);
    ctx.closePath();
    ctx.fill();
  }

  // ---- Skyline: wireframe/line-art style (stroked outlines, not flat
  // silhouettes) so the city reads as a distinct architectural sketch rather
  // than a generic filled shape. A shared "filler" building row gives the
  // skyline more density, and a signature party-tower landmark is drawn
  // bigger and more detailed on top of it. ----

  // Every landmark below is drawn in a LOCAL coordinate space where y=0 is
  // the ground line and negative y goes up — this lets drawSkyline() scale
  // and tile the whole drawing to fill the screen and scroll continuously,
  // without each function needing to know about that.
  //
  // Style: flat, solid single-color silhouettes (no outlines/strokes) layered
  // two-deep — a dense generic "filler" skyline shared throughout, plus the
  // landmark's own recognizable silhouette drawn on top of it.

  function drawFilledBuilding(b, color) {
    const topY = -b.h;
    ctx.fillStyle = color;
    ctx.fillRect(b.x, topY, b.w, b.h);

    if (b.top === 'peak') {
      ctx.beginPath();
      ctx.moveTo(b.x, topY);
      ctx.lineTo(b.x + b.w / 2, topY - b.w * 0.55);
      ctx.lineTo(b.x + b.w, topY);
      ctx.closePath();
      ctx.fill();
    } else if (b.top === 'dome') {
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, topY, b.w / 2, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    } else if (b.top === 'notch') {
      const nw = b.w * 0.5;
      ctx.fillRect(b.x + (b.w - nw) / 2, topY - b.h * 0.22, nw, b.h * 0.22);
    } else if (b.top === 'antenna') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + b.w / 2, topY);
      ctx.lineTo(b.x + b.w / 2, topY - b.h * 0.4);
      ctx.stroke();
    }
  }

  // Shared dense "generic city" pattern reused throughout (recolored) so the
  // skyline reads as a full, continuous cityscape like a real silhouette
  // illustration, not a few isolated buildings.
  const BASE_SKYLINE = [
    { w: 22, h: 40, top: 'flat', gap: 4 }, { w: 16, h: 65, top: 'antenna', gap: 6 }, { w: 28, h: 30, top: 'flat', gap: 3 },
    { w: 20, h: 78, top: 'flat', gap: 5 }, { w: 24, h: 50, top: 'notch', gap: 4 }, { w: 18, h: 35, top: 'flat', gap: 7 },
    { w: 32, h: 68, top: 'flat', gap: 3 }, { w: 20, h: 45, top: 'dome', gap: 5 }, { w: 16, h: 85, top: 'antenna', gap: 4 },
    { w: 26, h: 55, top: 'flat', gap: 6 }, { w: 18, h: 38, top: 'flat', gap: 3 }, { w: 22, h: 62, top: 'notch', gap: 5 },
    { w: 28, h: 48, top: 'flat', gap: 4 }, { w: 16, h: 72, top: 'flat', gap: 6 }, { w: 20, h: 32, top: 'flat', gap: 3 },
    { w: 24, h: 58, top: 'dome', gap: 5 }, { w: 14, h: 42, top: 'flat', gap: 4 }, { w: 18, h: 66, top: 'antenna', gap: 6 },
  ];
  const BASE_SKYLINE_W = BASE_SKYLINE.reduce((sum, b) => sum + b.w + b.gap, 0);

  function drawSilhouetteRow(color, heightScale) {
    let x = 0;
    BASE_SKYLINE.forEach(spec => {
      drawFilledBuilding({ x, w: spec.w, h: spec.h * heightScale, top: spec.top }, color);
      x += spec.w + spec.gap;
    });
  }

  // The skyline's signature landmark: a tall party tower topped with a
  // disco ball, silhouetted against the night sky.
  function drawLandmarkPartyTower(color) {
    ctx.fillStyle = color;
    ctx.fillRect(292, -78, 16, 78);
    ctx.beginPath();
    ctx.arc(300, -92, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draws the fixed night skyline as two parallax layers — a lighter,
  // slower-scrolling far layer and a darker, faster near layer carrying the
  // landmark — both scaled up to fill most of the screen and tiled
  // seamlessly so they keep scrolling past, giving a sense of forward motion.
  function drawSkyline() {
    const tileW = BASE_SKYLINE_W * SKY_SCALE;

    const farBase = -(skyScrollXFar % tileW);
    for (let i = -1; i <= 1; i++) {
      ctx.save();
      ctx.translate(farBase + i * tileW, HORIZON_Y);
      ctx.scale(SKY_SCALE, SKY_SCALE);
      drawSilhouetteRow(MAP_FAR_COLOR, 0.85);
      ctx.restore();
    }

    const nearBase = -(skyScrollX % tileW);
    for (let i = -1; i <= 1; i++) {
      ctx.save();
      ctx.translate(nearBase + i * tileW, HORIZON_Y);
      ctx.scale(SKY_SCALE, SKY_SCALE);
      drawSilhouetteRow(MAP_NEAR_COLOR, 1);
      drawLandmarkPartyTower(MAP_NEAR_COLOR);
      ctx.restore();
    }
  }

  // ---- Spike wall obstacles: a row of jagged triangular teeth along the
  // gap edge, points aimed into the gap so the "point" is what you must
  // avoid touching. ----
  const SPIKE_TOOTH_W = 14;
  const SPIKE_TOOTH_H = 16;

  function spikeWallShape(x, isTop, edgeY) {
    ctx.beginPath();
    if (isTop) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, edgeY);
      let tx = x;
      let toothOut = true;
      while (tx < x + PIPE_W) {
        const nx = Math.min(tx + SPIKE_TOOTH_W, x + PIPE_W);
        const midX = (tx + nx) / 2;
        ctx.lineTo(midX, toothOut ? edgeY + SPIKE_TOOTH_H : edgeY);
        ctx.lineTo(nx, edgeY);
        tx = nx;
        toothOut = !toothOut;
      }
      ctx.lineTo(x + PIPE_W, 0);
    } else {
      ctx.moveTo(x, LH);
      ctx.lineTo(x, edgeY);
      let tx = x;
      let toothOut = true;
      while (tx < x + PIPE_W) {
        const nx = Math.min(tx + SPIKE_TOOTH_W, x + PIPE_W);
        const midX = (tx + nx) / 2;
        ctx.lineTo(midX, toothOut ? edgeY - SPIKE_TOOTH_H : edgeY);
        ctx.lineTo(nx, edgeY);
        tx = nx;
        toothOut = !toothOut;
      }
      ctx.lineTo(x + PIPE_W, LH);
    }
    ctx.closePath();
  }

  function drawPipes() {
    for (const p of pipes) {
      const topH = p.gapY - GAP_H / 2;
      const botY = p.gapY + GAP_H / 2;

      const g = ctx.createLinearGradient(p.x, 0, p.x + PIPE_W, 0);
      SPIKE_GRADIENT_STOPS.forEach(([stop, color]) => g.addColorStop(stop, color));
      ctx.fillStyle = g;

      spikeWallShape(p.x, true, topH);
      ctx.fill();
      spikeWallShape(p.x, false, botY);
      ctx.fill();
    }
  }

  function drawGround() {
    const y = LH - GROUND_H;
    ctx.fillStyle = '#241a3d';
    ctx.fillRect(0, y, LW, GROUND_H);
    ctx.fillStyle = '#3a2a63';
    for (let x = -40; x < LW + 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x - groundOffset, y);
      ctx.lineTo(x - groundOffset + 20, y);
      ctx.lineTo(x - groundOffset + 10, y + 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = BJ_ACCENT_DARK;
    ctx.fillRect(0, y, LW, 4);
  }

  // The player's face photo IS the character (no body sprite) — drawn as a
  // big circle with a thin outline so it reads clearly against both the sky
  // and the spike walls.
  const FACE_SPRITE_R = 28;

  function drawRiderFace(index, r) {
    const img = FACE_IMAGES[index];
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = FACE_FALLBACK_COLORS[index % FACE_FALLBACK_COLORS.length];
    ctx.fill();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.clip();
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawPlayer() {
    const x = PLAYER_X;
    const y = player.y;
    const bob = Math.sin(Date.now() / 120) * 2 * (state === 'playing' ? 1 : 0.4);
    const hop = flapAnim * -6;
    const cy = y + bob + hop;

    ctx.save();
    ctx.translate(x, cy);

    const angle = state === 'playing' ? Math.max(-0.3, Math.min(0.5, player.vy / 900)) : 0;
    ctx.rotate(angle);

    // legs, dangling beneath the face
    ctx.strokeStyle = '#3a2a55';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, FACE_SPRITE_R - 4); ctx.lineTo(-10, FACE_SPRITE_R + 12);
    ctx.moveTo(8, FACE_SPRITE_R - 4); ctx.lineTo(10, FACE_SPRITE_R + 12);
    ctx.stroke();

    drawRiderFace(selectedFace, FACE_SPRITE_R);

    ctx.restore();
  }

  function drawText(text, x, y, size, color, weight = '700') {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${FONT_BODY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function drawTextAligned(text, x, y, size, color, weight, align) {
    ctx.save();
    ctx.font = `${weight || '700'} ${size}px ${FONT_BODY}`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawOutlinedText(text, x, y, size, color) {
    ctx.font = `${size}px ${FONT_HEAD}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.1;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawPopups() {
    for (const pop of popups) {
      const t = pop.age / 0.6;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      drawOutlinedText(pop.text, pop.x, pop.y - t * 26, 22, '#8bffb0');
      ctx.restore();
    }
  }

  // Card background used throughout the UI: a rounded rect, highlighted gold
  // when it's the currently-selected option.
  function drawOptionCard(r, selected, radius) {
    roundRectPath(r.x, r.y, r.w, r.h, radius);
    ctx.fillStyle = selected ? '#ffe08a' : BJ_SURFACE;
    ctx.fill();
    if (selected) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = BJ_ACCENT;
      ctx.stroke();
    }
  }

  function drawHomeScreen() {
    drawTextAligned('Bakhos Jump', LW / 2, 60, 19, BJ_TEXT, '700', 'center');
    drawTextAligned(`Best: ${best}`, LW / 2, 86, 13, 'rgba(253,246,255,0.6)', '600', 'center');

    drawTextAligned('Pick your player', 24, 266, 16, BJ_TEXT, '700', 'left');

    faceCardRects.forEach((r, i) => {
      drawOptionCard(r, selectedFace === i, 18);
      const img = FACE_IMAGES[i];
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2 - 6, radius = r.w / 2 - 12;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = FACE_FALLBACK_COLORS[i % FACE_FALLBACK_COLORS.length];
      ctx.fill();
      if (img.complete && img.naturalWidth > 0) {
        ctx.clip();
        ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
      }
      ctx.restore();
      drawText(`P${i + 1}`, cx, r.y + r.h - 12, 11, 'rgba(253,246,255,0.7)', '600');
    });

    // bottom action bar
    roundRectPath(0, 556, LW, LH - 556, 0);
    ctx.fillStyle = 'rgba(27, 16, 48, 0.96)';
    ctx.fill();

    roundRectPath(PLAY_BTN.x, PLAY_BTN.y, PLAY_BTN.w, PLAY_BTN.h, 999);
    ctx.fillStyle = BJ_ACCENT;
    ctx.fill();
    drawText('Play', LW / 2, PLAY_BTN.y + PLAY_BTN.h / 2, 20, BJ_BG, '700');
  }

  // Death effect: a burst of glitter scattered across the whole screen
  // (no gore) — each particle a tiny rotated sparkle in a party color.
  function drawDeathGlitter() {
    ctx.save();
    for (const p of deathGlitter) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7);
      ctx.rotate(Math.PI / 2);
      ctx.fillRect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawHUD() {
    if (state === 'playing') {
      drawOutlinedText(String(score), LW / 2, 70, 48, '#ffffff');
      drawText(`Best ${best}`, LW / 2, 104, 13, 'rgba(255,255,255,0.9)', '600');
    }

    if (state === 'gameover') {
      ctx.fillStyle = 'rgba(10, 4, 20, 0.55)';
      ctx.fillRect(0, 0, LW, LH);

      drawDeathGlitter();

      roundRectPath(GAMEOVER_CARD.x, GAMEOVER_CARD.y, GAMEOVER_CARD.w, GAMEOVER_CARD.h, 28);
      ctx.fillStyle = BJ_SURFACE;
      ctx.fill();

      drawOutlinedText('Game Over', LW / 2, GAMEOVER_CARD.y + 46, 26, BJ_TEXT);
      drawText(joke, LW / 2, GAMEOVER_CARD.y + 76, 12.5, 'rgba(253,246,255,0.75)', '600');

      [[GAMEOVER_CHIP1, 'Score', String(score)], [GAMEOVER_CHIP2, 'Best', String(best)]].forEach(([chip, label, value]) => {
        roundRectPath(chip.x, chip.y, chip.w, chip.h, 20);
        ctx.fillStyle = BJ_BG;
        ctx.fill();
        drawText(label, chip.x + chip.w / 2, chip.y + 22, 11, 'rgba(253,246,255,0.55)', '500');
        ctx.font = `30px ${FONT_HEAD}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = BJ_TEXT;
        ctx.fillText(value, chip.x + chip.w / 2, chip.y + 54);
      });

      drawText('Tap to continue', LW / 2, GAMEOVER_CARD.y + GAMEOVER_CARD.h + 34, 14, 'rgba(255,246,252,0.9)', '600');
    }
  }

  function drawShareButton() {
    const { x, y, w, h } = SHARE_BTN;
    roundRectPath(x, y, w, h, 999);
    ctx.fillStyle = BJ_ACCENT;
    ctx.fill();
    drawText('Share Score', x + w / 2, y + h / 2, 14, BJ_BG, '700');
  }

  // Renders a standalone score-card image (independent canvas, not the game's)
  // and hands it to the phone's native share sheet, falling back to a direct
  // download if navigator.share isn't available (e.g. desktop browsers).
  // Builds the score-card canvas and exports it to a PNG blob. The face
  // photos are hotlinked from an external host with no CORS headers, so
  // drawing one into this offscreen canvas taints it and toBlob() will
  // throw/resolve null — in that case the caller retries with
  // includeFace=false so sharing still works, just without the photo.
  function buildShareCanvas(includeFace) {
    const W = 800, H = 1000;
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const c = off.getContext('2d');

    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#4b1f6b');
    g.addColorStop(0.5, '#ff6ec7');
    g.addColorStop(1, '#ffd76e');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    c.fillStyle = 'rgba(255, 244, 250, 0.9)';
    c.beginPath();
    c.arc(W * 0.5, H * 0.2, 110, 0, Math.PI * 2);
    c.fill();

    // the winning face, big, matching the in-game look
    c.save();
    c.translate(W * 0.5, H * 0.55);
    const shareImg = FACE_IMAGES[selectedFace];
    const shareR = 90;
    c.beginPath();
    c.arc(0, 0, shareR, 0, Math.PI * 2);
    c.closePath();
    c.fillStyle = FACE_FALLBACK_COLORS[selectedFace % FACE_FALLBACK_COLORS.length];
    c.fill();
    if (includeFace && shareImg && shareImg.complete && shareImg.naturalWidth > 0) {
      c.save();
      c.clip();
      c.drawImage(shareImg, -shareR, -shareR, shareR * 2, shareR * 2);
      c.restore();
    }
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.stroke();
    c.restore();

    c.textAlign = 'center';
    c.font = '800 40px "Segoe UI", Tahoma, sans-serif';
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.strokeText('Bakhos', W / 2, 90);
    c.fillStyle = '#ffffff';
    c.fillText('Bakhos', W / 2, 90);
    c.font = '600 24px "Segoe UI", Tahoma, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillText('Jump', W / 2, 128);

    c.font = '700 34px "Segoe UI", Tahoma, sans-serif';
    c.fillStyle = '#ffffff';
    c.fillText(`Player ${selectedFace + 1}`, W / 2, H * 0.32);

    const boxW = 560, boxH = 190, boxX = (W - boxW) / 2, boxY = H * 0.72;
    const r = 20;
    c.beginPath();
    c.moveTo(boxX + r, boxY);
    c.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
    c.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
    c.arcTo(boxX, boxY + boxH, boxX, boxY, r);
    c.arcTo(boxX, boxY, boxX + boxW, boxY, r);
    c.closePath();
    c.fillStyle = 'rgba(0, 0, 0, 0.3)';
    c.fill();

    c.fillStyle = '#ffffff';
    c.font = '700 40px "Segoe UI", Tahoma, sans-serif';
    c.fillText(`Score: ${score}`, W / 2, boxY + 65);
    c.font = '500 26px "Segoe UI", Tahoma, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText(`Best: ${best}`, W / 2, boxY + 115);

    return off;
  }

  async function canvasToBlob(canvas) {
    try {
      return await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('empty blob')), 'image/png');
      });
    } catch (e) {
      return null;
    }
  }

  async function shareScore() {
    let blob = await canvasToBlob(buildShareCanvas(true));
    if (!blob) blob = await canvasToBlob(buildShareCanvas(false));
    if (!blob) return;

    const shareText = `I scored ${score} in Bakhos Jump! Best: ${best}`;
    const file = new File([blob], 'bakhos-jump-score.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Bakhos Jump', text: shareText });
        return;
      } catch (e) {
        // user cancelled, or share failed — fall back to a direct download below
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bakhos-jump-score.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function drawMuteButton() {
    const { x, y, w, h } = MUTE_BTN;
    const cx = x + w / 2 - 5;
    const cy = y + h / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.arc(x + w / 2, cy, w / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 5);
    ctx.lineTo(cx - 4, cy - 5);
    ctx.lineTo(cx + 4, cy - 11);
    ctx.lineTo(cx + 4, cy + 11);
    ctx.lineTo(cx - 4, cy + 5);
    ctx.lineTo(cx - 9, cy + 5);
    ctx.closePath();
    ctx.fill();

    if (Music.isMuted()) {
      ctx.beginPath();
      ctx.moveTo(cx + 9, cy - 6); ctx.lineTo(cx + 17, cy + 6);
      ctx.moveTo(cx + 17, cy - 6); ctx.lineTo(cx + 9, cy + 6);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx + 8, cy, 4, -0.6, 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 8, cy, 8, -0.7, 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Menu/UI screens use the flat night-party background — only actual
  // gameplay (and its game-over overlay) keeps the vivid sunset-into-night
  // sky and skyline.
  function draw() {
    if (state === 'home') {
      ctx.fillStyle = BJ_BG;
      ctx.fillRect(0, 0, LW, LH);
      drawHomeScreen();
    } else {
      drawSky();
      drawHorizon();
      drawSkyline();
      drawPipes();
      drawGround();
      drawPlayer();
      drawHUD();
      drawPopups();
      if (state === 'gameover') drawShareButton();
    }

    drawMuteButton();
  }

  function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05; // clamp to avoid big jumps on tab switch

    if (state !== 'playing') {
      groundOffset = (groundOffset + PIPE_SPEED * dt * 0.3) % 40;
      skyScrollX = (skyScrollX + SKY_SPEED * dt * 0.3) % (BASE_SKYLINE_W * SKY_SCALE);
      skyScrollXFar = (skyScrollXFar + SKY_SPEED_FAR * dt * 0.3) % (BASE_SKYLINE_W * SKY_SCALE);
    } else {
      update(dt);
    }
    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
