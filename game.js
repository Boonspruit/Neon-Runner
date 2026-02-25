const canvas = document.getElementById('game');
const arenaWrap = document.querySelector('.arena-wrap');

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
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  trailOptions: document.getElementById('trail-options'),
};

const DIR = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

const TRAIL_STYLES = [
  { id: 'cyan', label: 'Classic Cyan', unlock: 0, color: '#17f2ff', particle: 'spark' },
  { id: 'magenta', label: 'Magenta Surge', unlock: 120, color: '#ff2cc6', particle: 'spark' },
  { id: 'amber', label: 'Amber Binary', unlock: 280, color: '#ffbb33', particle: 'binary' },
  { id: 'void', label: 'Void Glitch', unlock: 460, color: '#9f7bff', particle: 'binary' },
];

const CONFIG = {
  fieldHalf: 115,
  baseSpeed: 22,
  speedRamp: 0.85,
  botCount: 4,
  trailSpacing: 1.04,
  maxTrailSegments: 12000,
  nearMissDist: 2.8,
  powerupSpawnMs: 5200,
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
  phaseGhostTimer: 0,
  phaseGhostHits: 0,
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
  pixelTimer: 0,
};

const audio = {
  context: null,
  master: null,
  active: false,
  stepTimer: null,
  step: 0,
};

const gfx = {
  renderer: null,
  scene: null,
  camera: null,
  floor: null,
  trailGeo: null,
  sparkGeo: null,
};

function randomIn(min, max) { return Math.random() * (max - min) + min; }
function hexToInt(hex) { return Number.parseInt(hex.replace('#', '0x'), 16); }
function distSq2D(a, b) { const dx = a.x - b.x; const dz = a.z - b.z; return dx * dx + dz * dz; }

function neonMaterial(color, emissive = 0.9) {
  return new THREE.MeshStandardMaterial({
    color: hexToInt(color), emissive: hexToInt(color), emissiveIntensity: emissive, roughness: 0.35, metalness: 0.22,
  });
}

function setupThree() {
  gfx.scene = new THREE.Scene();
  gfx.scene.background = new THREE.Color(0x05030b);
  gfx.scene.fog = new THREE.Fog(0x05030b, 50, 280);
  gfx.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1100);

  try {
    gfx.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    gfx.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gfx.renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (error) {
    state.renderDisabled = true;
    gfx.renderer = { setSize() {}, render() {} };
  }

  const hemi = new THREE.HemisphereLight(0x70f3ff, 0x060812, 0.78);
  const key = new THREE.DirectionalLight(0x96ddff, 1.1);
  key.position.set(24, 45, -20);
  gfx.scene.add(hemi, key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: 0x070b15, emissive: 0x071b30, emissiveIntensity: 0.34 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.72;
  gfx.scene.add(floor);
  gfx.floor = floor;

  const grid = new THREE.GridHelper(260, 130, 0x205f8f, 0x13344d);
  grid.position.y = -0.7;
  gfx.scene.add(grid);

  const wallMat = neonMaterial('#20abcf', 0.64);
  const longWall = new THREE.BoxGeometry(CONFIG.fieldHalf * 2 + 8, 3.4, 1);
  const sideWall = new THREE.BoxGeometry(1, 3.4, CONFIG.fieldHalf * 2 + 8);
  const top = new THREE.Mesh(longWall, wallMat); top.position.set(0, 1, -CONFIG.fieldHalf);
  const bottom = top.clone(); bottom.position.z = CONFIG.fieldHalf;
  const left = new THREE.Mesh(sideWall, wallMat); left.position.set(-CONFIG.fieldHalf, 1, 0);
  const right = left.clone(); right.position.x = CONFIG.fieldHalf;
  gfx.scene.add(top, bottom, left, right);

  gfx.trailGeo = new THREE.BoxGeometry(1.25, 0.75, 1.25);
  gfx.sparkGeo = new THREE.SphereGeometry(0.14, 6, 6);

  resizeRenderer();
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  gfx.renderer.setSize(width, height, false);
  gfx.camera.aspect = width / Math.max(1, height);
  gfx.camera.updateProjectionMatrix();
}

function requestGameFullscreen() {
  const target = arenaWrap || canvas;
  target.requestFullscreen?.().catch(() => {});
}

function requestFullscreenIfMobile() {
  if (state.touchedFullscreen) return;
  if (window.matchMedia('(max-width: 900px)').matches && !document.fullscreenElement) requestGameFullscreen();
  state.touchedFullscreen = true;
}

function createBike(color) {
  const bike = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.45, 2.25), neonMaterial(color, 1.0));
  body.position.y = 0.38;
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.25, 0.7), neonMaterial('#c9f9ff', 0.28));
  windshield.position.set(0, 0.55, -0.45);
  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.28, 14);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x101015, emissive: hexToInt(color), emissiveIntensity: 0.48 });
  const frontWheel = new THREE.Mesh(wheelGeo, wheelMat);
  frontWheel.rotation.z = Math.PI / 2;
  frontWheel.position.set(0, 0.2, -0.95);
  const rearWheel = frontWheel.clone(); rearWheel.position.z = 0.95;
  bike.add(body, windshield, frontWheel, rearWheel);
  return bike;
}

function createEntity(isPlayer, color, x, z, dirIndex) {
  const mesh = createBike(color);
  mesh.position.set(x, 0.1, z);
  mesh.rotation.y = dirIndex * (Math.PI / 2);
  gfx.scene.add(mesh);
  return { id: state.nextEntityId++, isPlayer, color, x, z, dirIndex, alive: true, mesh, trailTick: 0, thinkTimer: randomIn(0.08, 0.22) };
}

function createTrailPoint(entity) {
  const mesh = new THREE.Mesh(gfx.trailGeo, neonMaterial(entity.color, 0.75));
  mesh.position.set(entity.x, 0.06, entity.z);
  gfx.scene.add(mesh);
  state.trails.push({ ownerId: entity.id, owner: entity.isPlayer ? 'player' : 'bot', x: entity.x, z: entity.z, bornAt: state.survived, mesh });

  if (Math.random() < 0.32) {
    const style = entity.isPlayer ? state.selectedTrail : { color: entity.color, particle: 'spark' };
    const pm = new THREE.Mesh(gfx.sparkGeo, new THREE.MeshBasicMaterial({ color: hexToInt(style.color), transparent: true, opacity: 0.95 }));
    pm.position.set(entity.x + randomIn(-0.2, 0.2), 0.62, entity.z + randomIn(-0.2, 0.2));
    gfx.scene.add(pm);
    state.particles.push({ mesh: pm, life: 0.75, vy: randomIn(0.12, 0.35), driftX: randomIn(-0.25, 0.25), driftZ: randomIn(-0.25, 0.25), binary: style.particle === 'binary' });
  }
}

function spawnPowerup() {
  const type = Math.random() > 0.5 ? 'phase' : 'overload';
  const color = type === 'phase' ? '#8dffef' : '#ff8ae4';
  const geometry = type === 'phase' ? new THREE.IcosahedronGeometry(0.95, 0) : new THREE.OctahedronGeometry(1.05, 0);
  const mesh = new THREE.Mesh(geometry, neonMaterial(color, 1.1));
  mesh.position.set(randomIn(-82, 82), 1.6, randomIn(-82, 82));
  gfx.scene.add(mesh);
  state.powerups.push({ type, x: mesh.position.x, z: mesh.position.z, ttl: 15, mesh });
}

function cleanupRunObjects() {
  for (const e of state.entities) gfx.scene.remove(e.mesh);
  for (const t of state.trails) gfx.scene.remove(t.mesh);
  for (const p of state.particles) gfx.scene.remove(p.mesh);
  for (const p of state.powerups) gfx.scene.remove(p.mesh);
  state.entities = []; state.trails = []; state.particles = []; state.powerups = [];
}

function resetGame() {
  cleanupRunObjects();
  Object.assign(state, {
    running: false, survived: 0, score: 0, speedMul: 1, closeCallMultiplier: 1, nearMissCooldown: 0,
    phaseGhostTimer: 0, phaseGhostHits: 0, overloadTimer: 0, overloadCooldown: 0,
    nextPowerupMs: CONFIG.powerupSpawnMs, nextEntityId: 1, pixelTimer: 0,
  });

  state.entities.push(createEntity(true, state.selectedTrail.color, 0, 0, 0));
  state.entities.push(createEntity(false, BOT_COLORS[0], -38, -38, 1));
  state.entities.push(createEntity(false, BOT_COLORS[1], 38, 38, 3));
  state.entities.push(createEntity(false, BOT_COLORS[2], -38, 38, 2));
  state.entities.push(createEntity(false, BOT_COLORS[3], 38, -38, 0));

  updateUi();
  render();
}

function player() { return state.entities[0]; }
function entityDir(e) { return DIR[e.dirIndex]; }
function turnLeft(e) { e.dirIndex = (e.dirIndex + 3) % 4; }
function turnRight(e) { e.dirIndex = (e.dirIndex + 1) % 4; }

function handleTurnInput(direction) {
  const p = player();
  if (!p?.alive) return;
  if (direction === 'left') turnLeft(p);
  if (direction === 'right') turnRight(p);
}

function setupControls() {
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const controlKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'spacebar', 'a', 'd', 'w', 's'];
    if (controlKeys.includes(key) || controlKeys.includes(event.key)) event.preventDefault();

    if (!state.running && (key === ' ' || key === 'spacebar')) { startGame(); return; }
    if (event.key === 'ArrowLeft' || key === 'a') handleTurnInput('left');
    if (event.key === 'ArrowRight' || key === 'd') handleTurnInput('right');
    if ((event.key === ' ' || key === 'spacebar') && state.running) activateOverload();
  }, { passive: false });

  let touchStart = null;
  canvas.addEventListener('touchstart', (event) => { touchStart = event.changedTouches[0]; requestFullscreenIfMobile(); }, { passive: true });
  canvas.addEventListener('touchend', (event) => {
    if (!touchStart) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touchStart.clientX;
    const dy = end.clientY - touchStart.clientY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18 || Math.abs(dx) < Math.abs(dy)) return;
    handleTurnInput(dx > 0 ? 'right' : 'left');
  }, { passive: true });
}

function estimateDanger(x, z, dirIndex, entityId) {
  const d = DIR[dirIndex];
  let penalty = 0;
  for (let step = 1; step <= 8; step += 1) {
    const nx = x + d.x * step * 2;
    const nz = z + d.z * step * 2;
    if (Math.abs(nx) > CONFIG.fieldHalf - 2 || Math.abs(nz) > CONFIG.fieldHalf - 2) penalty += 22;
    for (const t of state.trails) {
      const age = state.survived - t.bornAt;
      if (t.ownerId === entityId && age < 1.4) continue;
      const dd = (nx - t.x) ** 2 + (nz - t.z) ** 2;
      if (dd < 4) penalty += t.ownerId === entityId ? 24 : 15;
    }
  }
  return penalty;
}

function aiTurn(bot, dt) {
  bot.thinkTimer -= dt;
  if (bot.thinkTimer > 0) return;
  bot.thinkTimer = randomIn(0.08, 0.2);

  const options = [bot.dirIndex, (bot.dirIndex + 3) % 4, (bot.dirIndex + 1) % 4];
  const p = player();
  const pDir = entityDir(p);
  let best = options[0];
  let bestScore = -Infinity;

  for (const opt of options) {
    const d = DIR[opt];
    const probe = { x: bot.x + d.x * 10, z: bot.z + d.z * 10 };
    let score = randomIn(0, 7) - estimateDanger(bot.x, bot.z, opt, bot.id);
    const pFuture = { x: p.x + pDir.x * 13, z: p.z + pDir.z * 13 };
    score += Math.max(0, 100 - distSq2D(probe, pFuture));
    if (score > bestScore) { bestScore = score; best = opt; }
  }

  bot.dirIndex = best;
}

function checkCollision(entity) {
  if (Math.abs(entity.x) >= CONFIG.fieldHalf || Math.abs(entity.z) >= CONFIG.fieldHalf) return true;
  for (const t of state.trails) {
    if (t.ownerId === entity.id && state.survived - t.bornAt < 0.22) continue;
    if (distSq2D(entity, t) < 0.8) return true;
  }
  return false;
}

function activateOverload() {
  if (state.overloadCooldown > 0 || state.overloadTimer > 0) return;
  state.overloadTimer = 3.8;
  state.overloadCooldown = 10;
  triggerSynth(180, 0.1, 'triangle');
}

function updateEntities(dt) {
  const overloadFactor = state.overloadTimer > 0 ? 0.45 : 1;
  const worldSpeed = (CONFIG.baseSpeed + state.survived * CONFIG.speedRamp) * state.speedMul;

  for (let i = 0; i < state.entities.length; i += 1) {
    const e = state.entities[i];
    if (!e.alive) continue;
    if (!e.isPlayer) aiTurn(e, dt * overloadFactor);

    const speed = e.isPlayer ? worldSpeed : worldSpeed * randomIn(0.9, 1.03) * overloadFactor;
    const d = entityDir(e);
    e.x += d.x * speed * dt;
    e.z += d.z * speed * dt;

    if (checkCollision(e)) {
      if (e.isPlayer && state.phaseGhostTimer > 0 && state.phaseGhostHits > 0) {
        state.phaseGhostHits -= 1;
        state.phaseGhostTimer = 0;
        e.x += d.x * 2.8;
        e.z += d.z * 2.8;
        triggerSynth(560, 0.08, 'square');
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

    e.mesh.position.set(e.x, 0.1, e.z);
    e.mesh.rotation.y = e.dirIndex * (Math.PI / 2);
  }

  const fadeAge = Math.max(8, 28 - state.survived * 0.12);
  state.trails = state.trails.filter((t) => {
    if (state.survived - t.bornAt > fadeAge) {
      gfx.scene.remove(t.mesh);
      return false;
    }
    return true;
  });

  while (state.trails.length > CONFIG.maxTrailSegments) {
    const old = state.trails.shift();
    gfx.scene.remove(old.mesh);
  }
}

function updateNearMiss(dt) {
  if (state.nearMissCooldown > 0) { state.nearMissCooldown -= dt; return; }
  const p = player();
  let gotClose = false;
  const nearSq = CONFIG.nearMissDist * CONFIG.nearMissDist;
  for (const t of state.trails) {
    if (t.owner === 'player') continue;
    const d = distSq2D(p, t);
    if (d < nearSq && d > 1.2) { gotClose = true; break; }
  }

  if (gotClose) {
    state.closeCallMultiplier = Math.min(5, state.closeCallMultiplier + 0.24);
    state.speedMul = Math.min(2.9, state.speedMul + 0.025);
    state.score += 11 * state.closeCallMultiplier;
    state.nearMissCooldown = 0.28;
    triggerSynth(310, 0.04, 'triangle');
  } else {
    state.closeCallMultiplier = Math.max(1, state.closeCallMultiplier - dt * 0.1);
    state.speedMul = Math.max(1, state.speedMul - dt * 0.03);
  }
}

function triggerPixelEffect() {
  state.pixelTimer = 0.55;
  canvas.classList.add('power-effect');
}

function updatePowerups(dt) {
  const p = player();
  state.nextPowerupMs -= dt * 1000;
  if (state.nextPowerupMs <= 0) { spawnPowerup(); state.nextPowerupMs = CONFIG.powerupSpawnMs; }

  state.powerups = state.powerups.filter((item) => {
    item.ttl -= dt;
    item.mesh.rotation.y += dt * 1.6;
    item.mesh.rotation.x += dt * 0.9;
    if (item.ttl <= 0) { gfx.scene.remove(item.mesh); return false; }

    if (distSq2D(p, item) < 2.8) {
      if (item.type === 'phase') {
        state.phaseGhostTimer = 7;
        state.phaseGhostHits = 1;
      } else {
        state.overloadTimer = 3.3;
        state.overloadCooldown = Math.max(0, state.overloadCooldown - 4);
      }
      triggerPixelEffect();
      state.score += 45;
      triggerSynth(470, 0.08, 'triangle');
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
    if (p.binary) p.mesh.position.y += Math.sin(state.survived * 8) * dt * 0.12;
    p.mesh.material.opacity = Math.max(0, p.life / 0.75);
    if (p.life <= 0) { gfx.scene.remove(p.mesh); return false; }
    return true;
  });
}

function updateCamera(dt) {
  const p = player();
  const d = entityDir(p);
  const camPos = new THREE.Vector3(p.x - d.x * 19, 13, p.z - d.z * 19);
  const target = new THREE.Vector3(p.x, 1.2, p.z);
  gfx.camera.position.lerp(camPos, Math.min(1, dt * 4.8));
  gfx.camera.lookAt(target);
}

function updateGame(dt) {
  const p = player();
  if (!p?.alive) return;

  state.survived += dt;
  state.score += dt * 15 * state.closeCallMultiplier;
  state.overloadTimer = Math.max(0, state.overloadTimer - dt);
  state.overloadCooldown = Math.max(0, state.overloadCooldown - dt);
  state.phaseGhostTimer = Math.max(0, state.phaseGhostTimer - dt);
  state.pixelTimer = Math.max(0, state.pixelTimer - dt);
  if (state.pixelTimer <= 0) canvas.classList.remove('power-effect');

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
  ui.phaseStatus.textContent = state.phaseGhostTimer > 0 ? `Ghost ${state.phaseGhostTimer.toFixed(1)}s` : 'Ready';
  if (state.overloadTimer > 0) ui.overloadStatus.textContent = `Active ${state.overloadTimer.toFixed(1)}s`;
  else if (state.overloadCooldown > 0) ui.overloadStatus.textContent = `Cooldown ${state.overloadCooldown.toFixed(1)}s`;
  else ui.overloadStatus.textContent = 'Ready';

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
      const body = p?.mesh?.children?.[0];
      if (body?.material) {
        p.color = style.color;
        body.material.color.setHex(hexToInt(style.color));
        body.material.emissive.setHex(hexToInt(style.color));
      }
      renderTrailOptions();
    });

    ui.trailOptions.appendChild(btn);
  }
}

function render() {
  const pulse = 0.2 + Math.sin(state.survived * 2.5) * 0.06;
  gfx.floor.material.emissiveIntensity = pulse + (state.overloadTimer > 0 ? 0.22 : 0);
  gfx.renderer.render(gfx.scene, gfx.camera);
}

function loop(ts) {
  const dt = Math.min(0.033, ((ts - state.lastTime) || 16) / 1000);
  state.lastTime = ts;
  if (state.running) {
    updateGame(dt);
    updateUi();
    syncMusic();
  }
  render();
  requestAnimationFrame(loop);
}

function startGame() {
  requestFullscreenIfMobile();
  canvas.focus();
  document.body.classList.add('game-active');
  resetGame();
  state.running = true;
  state.lastTime = performance.now();
  ui.overlay.classList.add('hidden');
}

function endGame() {
  state.running = false;
  document.body.classList.remove('game-active');
  ui.overlay.classList.remove('hidden');
  ui.overlayTitle.textContent = 'Run Ended';
  ui.overlayText.textContent = `Survived ${state.survived.toFixed(1)}s | Score ${Math.floor(state.score)}. Press Space or Try Again.`;
  ui.startBtn.textContent = 'Try Again';
}

function triggerSynth(freq = 220, duration = 0.08, type = 'triangle') {
  if (!audio.context || !audio.active) return;
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.context.currentTime);
  gain.gain.setValueAtTime(0.001, audio.context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audio.context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.context.currentTime + duration);
  osc.connect(gain); gain.connect(audio.master);
  osc.start(); osc.stop(audio.context.currentTime + duration + 0.03);
}

function midiFreq(midi) { return 440 * (2 ** ((midi - 69) / 12)); }

function scheduleSynthwaveStep() {
  if (!audio.active || !audio.context) return;
  const speed = state.speedMul;
  const now = audio.context.currentTime;
  const bassPattern = [40, 40, 43, 40, 45, 43, 40, 35, 40, 40, 47, 43, 45, 47, 43, 40];
  const leadPattern = [64, 67, 71, 67, 62, 67, 71, 74, 64, 67, 71, 67, 62, 67, 69, 71];
  const bassNote = midiFreq(bassPattern[audio.step % bassPattern.length]);
  const leadNote = midiFreq(leadPattern[audio.step % leadPattern.length]);

  const kick = audio.context.createOscillator();
  const kickGain = audio.context.createGain();
  kick.type = 'sine';
  kick.frequency.setValueAtTime(125, now);
  kick.frequency.exponentialRampToValueAtTime(38, now + 0.12);
  kickGain.gain.setValueAtTime(0.2, now);
  kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  kick.connect(kickGain); kickGain.connect(audio.master); kick.start(now); kick.stop(now + 0.13);

  const bass = audio.context.createOscillator();
  const bassGain = audio.context.createGain();
  bass.type = 'sawtooth';
  bass.frequency.setValueAtTime(bassNote, now);
  bassGain.gain.setValueAtTime(0.001, now);
  bassGain.gain.exponentialRampToValueAtTime(0.06 + speed * 0.012, now + 0.02);
  bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  bass.connect(bassGain); bassGain.connect(audio.master); bass.start(now); bass.stop(now + 0.26);

  if (audio.step % 2 === 0) {
    const lead = audio.context.createOscillator();
    const leadGain = audio.context.createGain();
    lead.type = 'triangle';
    lead.frequency.setValueAtTime(leadNote, now);
    leadGain.gain.setValueAtTime(0.001, now);
    leadGain.gain.exponentialRampToValueAtTime(0.05 + speed * 0.01, now + 0.02);
    leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    lead.connect(leadGain); leadGain.connect(audio.master); lead.start(now); lead.stop(now + 0.21);
  }

  audio.step += 1;
  const stepMs = Math.max(90, 148 - Math.min(40, speed * 18));
  audio.stepTimer = setTimeout(scheduleSynthwaveStep, stepMs);
}

function initMusic() {
  if (audio.context) return;
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.12;
  master.connect(context.destination);
  audio.context = context;
  audio.master = master;
  audio.active = true;
  audio.step = 0;
  scheduleSynthwaveStep();
}

function syncMusic() {
  if (!audio.context || !audio.active) return;
  audio.master.gain.value = Math.min(0.3, 0.1 + state.speedMul * 0.05);
}

ui.startBtn.addEventListener('click', startGame);
ui.fullscreenBtn.addEventListener('click', requestGameFullscreen);
ui.audioBtn.addEventListener('click', async () => {
  if (!audio.context) initMusic();
  if (audio.context.state === 'suspended') await audio.context.resume();
  audio.active = !audio.active;
  if (audio.active) {
    scheduleSynthwaveStep();
    ui.audioBtn.textContent = 'Mute Music';
  } else {
    if (audio.stepTimer) clearTimeout(audio.stepTimer);
    ui.audioBtn.textContent = 'Start Music';
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
