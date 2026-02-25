const canvas = document.getElementById('game');

const ui = {
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  speed: document.getElementById('speed'),
  multiplier: document.getElementById('multiplier'),
  phaseStatus: document.getElementById('phase-status'),
  overloadStatus: document.getElementById('overload-status'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  startBtn: document.getElementById('start-btn'),
  audioBtn: document.getElementById('audio-toggle'),
  trailOptions: document.getElementById('trail-options'),
};

const TRAIL_STYLES = [
  { id: 'cyan', label: 'Classic Cyan', unlock: 0, color: '#17f2ff', particle: 'spark' },
  { id: 'magenta', label: 'Magenta Surge', unlock: 100, color: '#ff2cc6', particle: 'spark' },
  { id: 'amber', label: 'Amber Binary', unlock: 240, color: '#ffbb33', particle: 'binary' },
  { id: 'void', label: 'Void Glitch', unlock: 420, color: '#9f7bff', particle: 'binary' },
];

const CONFIG = {
  fieldHalf: 58,
  baseSpeed: 21,
  speedRamp: 0.75,
  botCount: 4,
  trailSpacing: 1.2,
  maxTrailSegments: 6500,
  nearMissDist: 2.5,
  powerupSpawnMs: 6200,
};

const DIR = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

const BOT_COLORS = ['#ff2cc6', '#ffa24d', '#79ff7a', '#7a8dff'];

const state = {
  running: false,
  lastTime: 0,
  survived: 0,
  score: 0,
  speedMul: 1,
  closeCallMultiplier: 1,
  nearMissCooldown: 0,
  phaseCharges: 0,
  overloadTimer: 0,
  overloadCooldown: 0,
  nextPowerupMs: CONFIG.powerupSpawnMs,
  unlockedTrailScore: 0,
  selectedTrail: TRAIL_STYLES[0],
  touchedFullscreen: false,
  renderDisabled: false,
  entities: [],
  trails: [],
  particles: [],
  powerups: [],
  nextEntityId: 1,
};

const audio = {
  context: null,
  master: null,
  bass: null,
  beatTimer: null,
  active: false,
};

const gfx = {
  renderer: null,
  scene: null,
  camera: null,
  floor: null,
  wallGroup: null,
  trailGeo: null,
  riderGeo: null,
  powerGeo: null,
  sparkGeo: null,
};

function randomIn(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(randomIn(min, max + 1));
}

function hexToInt(hex) {
  return Number.parseInt(hex.replace('#', '0x'), 16);
}

function cloneDir(d) {
  return { x: d.x, z: d.z };
}

function opposite(a, b) {
  return a.x + b.x === 0 && a.z + b.z === 0;
}

function dirFromSwipe(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? DIR.right : DIR.left;
  return dy > 0 ? DIR.down : DIR.up;
}

function distSq2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function neonMaterial(color, emissive = 0.9) {
  return new THREE.MeshStandardMaterial({
    color: hexToInt(color),
    emissive: hexToInt(color),
    emissiveIntensity: emissive,
    roughness: 0.35,
    metalness: 0.2,
  });
}

function setupThree() {
  gfx.scene = new THREE.Scene();
  gfx.scene.background = new THREE.Color(0x05030b);
  gfx.scene.fog = new THREE.Fog(0x05030b, 28, 145);

  gfx.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

  try {
    gfx.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    gfx.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gfx.renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (error) {
    state.renderDisabled = true;
    gfx.renderer = { setSize() {}, render() {} };
  }

  const hemi = new THREE.HemisphereLight(0x66f1ff, 0x080a14, 0.7);
  const key = new THREE.DirectionalLight(0x8ad8ff, 1.0);
  key.position.set(20, 35, -16);
  gfx.scene.add(hemi, key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140),
    new THREE.MeshStandardMaterial({ color: 0x070b15, emissive: 0x061425, emissiveIntensity: 0.3 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.65;
  gfx.scene.add(floor);
  gfx.floor = floor;

  const grid = new THREE.GridHelper(120, 60, 0x1b6ea8, 0x153a54);
  grid.position.y = -0.62;
  gfx.scene.add(grid);

  gfx.wallGroup = new THREE.Group();
  gfx.scene.add(gfx.wallGroup);

  const wallMat = neonMaterial('#20abcf', 0.5);
  const wallGeomLong = new THREE.BoxGeometry(120, 3.2, 0.8);
  const wallGeomSide = new THREE.BoxGeometry(0.8, 3.2, 120);

  const wTop = new THREE.Mesh(wallGeomLong, wallMat);
  wTop.position.set(0, 1, -CONFIG.fieldHalf);
  const wBottom = wTop.clone();
  wBottom.position.z = CONFIG.fieldHalf;
  const wLeft = new THREE.Mesh(wallGeomSide, wallMat);
  wLeft.position.set(-CONFIG.fieldHalf, 1, 0);
  const wRight = wLeft.clone();
  wRight.position.x = CONFIG.fieldHalf;
  gfx.wallGroup.add(wTop, wBottom, wLeft, wRight);

  gfx.riderGeo = new THREE.BoxGeometry(2.2, 1, 3.3);
  gfx.trailGeo = new THREE.BoxGeometry(1.2, 0.75, 1.2);
  gfx.powerGeo = new THREE.TorusGeometry(1.1, 0.3, 12, 20);
  gfx.sparkGeo = new THREE.SphereGeometry(0.14, 6, 6);

  const stars = new THREE.Group();
  for (let i = 0; i < 180; i += 1) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 5, 5),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x8d8dff : 0x17f2ff })
    );
    s.position.set(randomIn(-84, 84), randomIn(17, 65), randomIn(-84, 84));
    stars.add(s);
  }
  gfx.scene.add(stars);

  resizeRenderer();
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  gfx.renderer.setSize(width, height, false);
  gfx.camera.aspect = width / Math.max(1, height);
  gfx.camera.updateProjectionMatrix();
}

function requestFullscreenIfMobile() {
  if (state.touchedFullscreen) return;
  if (window.matchMedia('(max-width: 900px)').matches && document.fullscreenElement == null) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
  state.touchedFullscreen = true;
}

function createEntity(isPlayer, color, x, z, dir) {
  const mat = neonMaterial(color, 1.0);
  const mesh = new THREE.Mesh(gfx.riderGeo, mat);
  mesh.position.set(x, 0.3, z);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.2), neonMaterial('#d8f7ff', 0.25));
  canopy.position.set(0, 0.52, -0.1);
  mesh.add(canopy);

  gfx.scene.add(mesh);

  return {
    id: state.nextEntityId++,
    isPlayer,
    color,
    x,
    z,
    dir: cloneDir(dir),
    alive: true,
    mesh,
    trailTick: 0,
    thinkTimer: randomIn(0.08, 0.26),
  };
}

function createTrailPoint(entity) {
  const mesh = new THREE.Mesh(gfx.trailGeo, neonMaterial(entity.color, 0.75));
  mesh.position.set(entity.x, 0.06, entity.z);
  gfx.scene.add(mesh);

  state.trails.push({
    ownerId: entity.id,
    owner: entity.isPlayer ? 'player' : 'bot',
    x: entity.x,
    z: entity.z,
    bornAt: state.survived,
    mesh,
  });

  if (Math.random() < 0.32) {
    const style = entity.isPlayer ? state.selectedTrail : { color: entity.color, particle: 'spark' };
    const pm = new THREE.Mesh(
      gfx.sparkGeo,
      new THREE.MeshBasicMaterial({ color: hexToInt(style.color), transparent: true, opacity: 0.95 })
    );
    pm.position.set(entity.x + randomIn(-0.14, 0.14), 0.6, entity.z + randomIn(-0.14, 0.14));
    gfx.scene.add(pm);

    state.particles.push({
      mesh: pm,
      life: 0.7,
      vy: randomIn(0.14, 0.35),
      driftX: randomIn(-0.24, 0.24),
      driftZ: randomIn(-0.24, 0.24),
      binary: style.particle === 'binary',
    });
  }
}

function spawnPowerup() {
  const type = Math.random() > 0.5 ? 'phase' : 'overload';
  const color = type === 'phase' ? '#8dffef' : '#ff8ae4';
  const mesh = new THREE.Mesh(gfx.powerGeo, neonMaterial(color, 1.0));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(randomIn(-46, 46), 1.25, randomIn(-46, 46));
  gfx.scene.add(mesh);

  state.powerups.push({
    type,
    x: mesh.position.x,
    z: mesh.position.z,
    ttl: 13,
    mesh,
  });
}

function cleanupRunObjects() {
  for (const e of state.entities) gfx.scene.remove(e.mesh);
  for (const t of state.trails) gfx.scene.remove(t.mesh);
  for (const p of state.particles) gfx.scene.remove(p.mesh);
  for (const p of state.powerups) gfx.scene.remove(p.mesh);
  state.entities = [];
  state.trails = [];
  state.particles = [];
  state.powerups = [];
}

function resetGame() {
  cleanupRunObjects();
  state.running = false;
  state.survived = 0;
  state.score = 0;
  state.speedMul = 1;
  state.closeCallMultiplier = 1;
  state.nearMissCooldown = 0;
  state.phaseCharges = 0;
  state.overloadTimer = 0;
  state.overloadCooldown = 0;
  state.nextPowerupMs = CONFIG.powerupSpawnMs;
  state.nextEntityId = 1;

  state.entities.push(createEntity(true, state.selectedTrail.color, -22, 0, DIR.right));
  state.entities.push(createEntity(false, BOT_COLORS[0], 22, 0, DIR.left));
  state.entities.push(createEntity(false, BOT_COLORS[1], 0, -22, DIR.down));
  state.entities.push(createEntity(false, BOT_COLORS[2], 0, 22, DIR.up));
  state.entities.push(createEntity(false, BOT_COLORS[3], 28, 28, DIR.left));

  updateUi();
  render();
}

function player() {
  return state.entities[0];
}

function setPlayerDirection(next) {
  const p = player();
  if (!p?.alive) return;
  if (opposite(p.dir, next)) return;
  p.dir = cloneDir(next);
}

function setupControls() {
  window.addEventListener('keydown', (event) => {
    const k = event.key.toLowerCase();
    if (event.key === 'ArrowUp' || k === 'w') { event.preventDefault(); setPlayerDirection(DIR.up); }
    if (event.key === 'ArrowDown' || k === 's') { event.preventDefault(); setPlayerDirection(DIR.down); }
    if (event.key === 'ArrowLeft' || k === 'a') { event.preventDefault(); setPlayerDirection(DIR.left); }
    if (event.key === 'ArrowRight' || k === 'd') { event.preventDefault(); setPlayerDirection(DIR.right); }
    if (event.key === ' ') { event.preventDefault(); activateOverload(); }
  });

  let touchStart = null;
  canvas.addEventListener('touchstart', (event) => {
    touchStart = event.changedTouches[0];
    requestFullscreenIfMobile();
  }, { passive: true });

  canvas.addEventListener('touchend', (event) => {
    if (!touchStart) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touchStart.clientX;
    const dy = end.clientY - touchStart.clientY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;

    const direction = dirFromSwipe(dx, dy);
    setPlayerDirection(direction);

    if (Math.abs(dy) > Math.abs(dx) && dy > 0) {
      activateOverload();
    }
  }, { passive: true });
}

function estimateDanger(x, z, dir, entityId) {
  let penalty = 0;
  const nx = x + dir.x * 4;
  const nz = z + dir.z * 4;

  if (Math.abs(nx) > CONFIG.fieldHalf - 2 || Math.abs(nz) > CONFIG.fieldHalf - 2) penalty += 100;

  for (const t of state.trails) {
    if (t.ownerId === entityId && state.survived - t.bornAt < 0.22) continue;
    const d = (nx - t.x) ** 2 + (nz - t.z) ** 2;
    if (d < 8) penalty += 58;
  }

  return penalty;
}

function aiTurn(bot, dt) {
  bot.thinkTimer -= dt;
  if (bot.thinkTimer > 0) return;
  bot.thinkTimer = randomIn(0.08, 0.24);

  const options = [
    cloneDir(bot.dir),
    { x: bot.dir.z, z: -bot.dir.x },
    { x: -bot.dir.z, z: bot.dir.x },
  ];

  let best = options[0];
  let bestScore = -Infinity;
  const p = player();

  for (const opt of options) {
    if (opposite(bot.dir, opt)) continue;
    const probe = { x: bot.x + opt.x * 6, z: bot.z + opt.z * 6 };
    let score = randomIn(0, 9) - estimateDanger(bot.x, bot.z, opt, bot.id);

    const pFuture = { x: p.x + p.dir.x * 9, z: p.z + p.dir.z * 9 };
    score += Math.max(0, 72 - distSq2D(probe, pFuture));

    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }

  bot.dir = best;
}

function checkCollision(entity) {
  if (Math.abs(entity.x) >= CONFIG.fieldHalf || Math.abs(entity.z) >= CONFIG.fieldHalf) return true;

  for (const t of state.trails) {
    if (t.ownerId === entity.id && state.survived - t.bornAt < 0.2) continue;
    if (distSq2D(entity, t) < 0.75) return true;
  }
  return false;
}

function activateOverload() {
  if (state.overloadCooldown > 0 || state.overloadTimer > 0) return;
  state.overloadTimer = 3.6;
  state.overloadCooldown = 10;
  pulseSynth(190, 0.1);
}

function updateEntities(dt) {
  const overloadFactor = state.overloadTimer > 0 ? 0.48 : 1;
  const worldSpeed = (CONFIG.baseSpeed + state.survived * CONFIG.speedRamp) * state.speedMul;

  for (let i = 0; i < state.entities.length; i += 1) {
    const e = state.entities[i];
    if (!e.alive) continue;

    if (!e.isPlayer) aiTurn(e, dt * overloadFactor);

    const speed = e.isPlayer ? worldSpeed : worldSpeed * randomIn(0.9, 1.06) * overloadFactor;

    e.x += e.dir.x * speed * dt;
    e.z += e.dir.z * speed * dt;

    if (checkCollision(e)) {
      if (e.isPlayer && state.phaseCharges > 0) {
        state.phaseCharges -= 1;
        e.x += e.dir.x * 2.5;
        e.z += e.dir.z * 2.5;
        pulseSynth(560, 0.08);
      } else {
        e.alive = false;
        e.mesh.visible = false;
        continue;
      }
    }

    e.trailTick -= dt;
    if (e.trailTick <= 0) {
      e.trailTick = CONFIG.trailSpacing / Math.max(speed, 0.01);
      createTrailPoint(e);
    }

    e.mesh.position.set(e.x, 0.32, e.z);
    e.mesh.rotation.y = Math.atan2(e.dir.x, e.dir.z);
  }

  while (state.trails.length > CONFIG.maxTrailSegments) {
    const old = state.trails.shift();
    gfx.scene.remove(old.mesh);
  }
}

function updateNearMiss(dt) {
  if (state.nearMissCooldown > 0) {
    state.nearMissCooldown -= dt;
    return;
  }

  const p = player();
  let gotClose = false;
  const nearSq = CONFIG.nearMissDist * CONFIG.nearMissDist;

  for (const t of state.trails) {
    if (t.owner === 'player') continue;
    const d = distSq2D(p, t);
    if (d < nearSq && d > 1.1) {
      gotClose = true;
      break;
    }
  }

  if (gotClose) {
    state.closeCallMultiplier = Math.min(5, state.closeCallMultiplier + 0.24);
    state.speedMul = Math.min(2.8, state.speedMul + 0.02);
    state.score += 8 * state.closeCallMultiplier;
    state.nearMissCooldown = 0.32;
    pulseSynth(320, 0.045);
  } else {
    state.closeCallMultiplier = Math.max(1, state.closeCallMultiplier - dt * 0.1);
    state.speedMul = Math.max(1, state.speedMul - dt * 0.03);
  }
}

function updatePowerups(dt) {
  const p = player();

  state.nextPowerupMs -= dt * 1000;
  if (state.nextPowerupMs <= 0) {
    spawnPowerup();
    state.nextPowerupMs = CONFIG.powerupSpawnMs;
  }

  state.powerups = state.powerups.filter((item) => {
    item.ttl -= dt;
    item.mesh.rotation.z += dt * 2;

    if (item.ttl <= 0) {
      gfx.scene.remove(item.mesh);
      return false;
    }

    if (distSq2D(p, item) < 2.6) {
      if (item.type === 'phase') {
        state.phaseCharges += 1;
      } else {
        state.overloadTimer = 2.8;
        state.overloadCooldown = Math.max(0, state.overloadCooldown - 4);
      }
      state.score += 40;
      pulseSynth(480, 0.08);
      gfx.scene.remove(item.mesh);
      return false;
    }

    return true;
  });
}

function updateParticles(dt) {
  state.particles = state.particles.filter((p) => {
    p.life -= dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.x += p.driftX * dt;
    p.mesh.position.z += p.driftZ * dt;
    if (p.binary) p.mesh.position.y += Math.sin(state.survived * 9) * dt * 0.1;
    p.mesh.material.opacity = Math.max(0, p.life / 0.7);

    if (p.life <= 0) {
      gfx.scene.remove(p.mesh);
      return false;
    }
    return true;
  });
}

function updateCamera(dt) {
  const p = player();
  const dirLen = Math.hypot(p.dir.x, p.dir.z) || 1;
  const backX = -p.dir.x / dirLen;
  const backZ = -p.dir.z / dirLen;
  const camTarget = new THREE.Vector3(p.x, 1.5, p.z);
  const camPos = new THREE.Vector3(p.x + backX * 16, 11.5, p.z + backZ * 16);

  gfx.camera.position.lerp(camPos, Math.min(1, dt * 5));
  gfx.camera.lookAt(camTarget);
}

function updateGame(dt) {
  const p = player();
  if (!p?.alive) return;

  state.survived += dt;
  state.score += dt * 14 * state.closeCallMultiplier;
  state.overloadTimer = Math.max(0, state.overloadTimer - dt);
  state.overloadCooldown = Math.max(0, state.overloadCooldown - dt);

  updateEntities(dt);
  updateNearMiss(dt);
  updatePowerups(dt);
  updateParticles(dt);
  updateCamera(dt);

  if (!player().alive) endGame();
}

function updateUi() {
  ui.score.textContent = Math.floor(state.score).toString();
  ui.time.textContent = `${state.survived.toFixed(1)}s`;
  ui.speed.textContent = `${state.speedMul.toFixed(2)}x`;
  ui.multiplier.textContent = `${state.closeCallMultiplier.toFixed(2)}x`;
  ui.phaseStatus.textContent = String(state.phaseCharges);

  if (state.overloadTimer > 0) {
    ui.overloadStatus.textContent = `Active ${state.overloadTimer.toFixed(1)}s`;
  } else if (state.overloadCooldown > 0) {
    ui.overloadStatus.textContent = `Cooldown ${state.overloadCooldown.toFixed(1)}s`;
  } else {
    ui.overloadStatus.textContent = 'Ready (Space / swipe down)';
  }

  state.unlockedTrailScore = Math.max(state.unlockedTrailScore, state.score);
  renderTrailOptions();
}

function renderTrailOptions() {
  ui.trailOptions.innerHTML = '';
  for (const style of TRAIL_STYLES) {
    const unlocked = state.unlockedTrailScore >= style.unlock;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = unlocked ? style.label : `${style.label} (${style.unlock})`;
    btn.disabled = !unlocked;
    if (state.selectedTrail.id === style.id) btn.classList.add('active');

    btn.addEventListener('click', () => {
      state.selectedTrail = style;
      const p = player();
      if (p?.mesh?.material) {
        p.color = style.color;
        p.mesh.material.color.setHex(hexToInt(style.color));
        p.mesh.material.emissive.setHex(hexToInt(style.color));
      }
      renderTrailOptions();
    });

    ui.trailOptions.appendChild(btn);
  }
}

function render() {
  const pulse = 0.2 + Math.sin(state.survived * 2.3) * 0.06;
  gfx.floor.material.emissiveIntensity = pulse + (state.overloadTimer > 0 ? 0.25 : 0);
  gfx.renderer.render(gfx.scene, gfx.camera);
}

function loop(ts) {
  const dt = Math.min(0.033, ((ts - state.lastTime) || 16) / 1000);
  state.lastTime = ts;

  if (state.running) {
    updateGame(dt);
    updateUi();
    syncAudio();
  }

  render();
  requestAnimationFrame(loop);
}

function startGame() {
  requestFullscreenIfMobile();
  resetGame();
  state.running = true;
  state.lastTime = performance.now();
  ui.overlay.classList.add('hidden');
}

function endGame() {
  state.running = false;
  ui.overlay.classList.remove('hidden');
  ui.overlayTitle.textContent = 'Run Ended';
  ui.overlayText.textContent = `Survived ${state.survived.toFixed(1)}s | Score ${Math.floor(state.score)}. Tap Try Again.`;
  ui.startBtn.textContent = 'Try Again';
}

function initAudio() {
  if (audio.context) return;

  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.08;
  master.connect(context.destination);

  const bass = context.createOscillator();
  bass.type = 'sawtooth';
  bass.frequency.value = 52;
  const bassGain = context.createGain();
  bassGain.gain.value = 0.16;
  bass.connect(bassGain);
  bassGain.connect(master);
  bass.start();

  audio.context = context;
  audio.master = master;
  audio.bass = bass;
  audio.active = true;
  scheduleBeat();
}

function pulseSynth(freq = 220, duration = 0.08) {
  if (!audio.context || !audio.active) return;
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, audio.context.currentTime);
  gain.gain.setValueAtTime(0.001, audio.context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audio.context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.context.currentTime + duration);
  osc.connect(gain);
  gain.connect(audio.master);
  osc.start();
  osc.stop(audio.context.currentTime + duration + 0.03);
}

function scheduleBeat() {
  if (!audio.active) return;
  const tempo = 430 - Math.min(220, state.speedMul * 90 + state.survived * 1.8);
  pulseSynth(108 + state.speedMul * 20, 0.12);
  if (audio.beatTimer) clearTimeout(audio.beatTimer);
  audio.beatTimer = setTimeout(scheduleBeat, Math.max(130, tempo));
}

function syncAudio() {
  if (!audio.context || !audio.active) return;
  audio.master.gain.value = Math.min(0.24, 0.08 + state.speedMul * 0.035);
  audio.bass.frequency.value = 52 + state.speedMul * 12;
}

ui.startBtn.addEventListener('click', startGame);

ui.audioBtn.addEventListener('click', async () => {
  if (!audio.context) initAudio();
  if (audio.context.state === 'suspended') await audio.context.resume();

  audio.active = !audio.active;
  if (audio.active) {
    scheduleBeat();
    ui.audioBtn.textContent = 'Mute Audio';
  } else {
    if (audio.beatTimer) clearTimeout(audio.beatTimer);
    ui.audioBtn.textContent = 'Start Audio';
  }
});

window.addEventListener('resize', resizeRenderer);
document.addEventListener('pointerdown', requestFullscreenIfMobile, { once: true });

if (typeof window.THREE === 'undefined') {
  ui.overlayTitle.textContent = 'Three.js failed to load';
  ui.overlayText.textContent = '3D engine could not load. Check network/ad blockers and refresh.';
  ui.startBtn.disabled = true;
} else {
  setupThree();
  if (state.renderDisabled) {
    ui.overlayText.textContent = 'WebGL failed in this browser session. Please try another browser/device.';
    ui.startBtn.disabled = true;
  }
  setupControls();
  renderTrailOptions();
  resetGame();
  requestAnimationFrame(loop);
}
