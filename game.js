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

const CONFIG = {
  lanes: [-8, 0, 8],
  baseSpeed: 24,
  maxSpeed: 52,
  speedRamp: 0.42,
  nearMissZ: 3.5,
  obstacleSpacing: 14,
  powerupSpacing: 36,
  botCount: 3,
};

const TRAIL_STYLES = [
  { id: 'cyan', label: 'Classic Cyan', unlock: 0, color: '#17f2ff', particle: 'spark' },
  { id: 'magenta', label: 'Magenta Surge', unlock: 120, color: '#ff2cc6', particle: 'spark' },
  { id: 'amber', label: 'Amber Binary', unlock: 260, color: '#ffbb33', particle: 'binary' },
  { id: 'void', label: 'Void Glitch', unlock: 420, color: '#9f7bff', particle: 'binary' },
];

const state = {
  running: false,
  survived: 0,
  score: 0,
  speed: CONFIG.baseSpeed,
  closeCallMultiplier: 1,
  nearMissCooldown: 0,
  phaseCharges: 0,
  overloadTimer: 0,
  overloadCooldown: 0,
  nextObstacleZ: 60,
  nextPowerupZ: 90,
  selectedTrail: TRAIL_STYLES[0],
  unlockedTrailScore: 0,
  lastTime: 0,
  player: null,
  bots: [],
  obstacles: [],
  powerups: [],
  particles: [],
  touchedFullscreen: false,
  renderDisabled: false,
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
  road: null,
  laneLines: [],
  chaseOffset: new THREE.Vector3(0, 9, -19),
};

function laneX(index) {
  return CONFIG.lanes[Math.max(0, Math.min(CONFIG.lanes.length - 1, index))];
}

function randomIn(min, max) {
  return Math.random() * (max - min) + min;
}

function hexToInt(hex) {
  return Number.parseInt(hex.replace('#', '0x'), 16);
}

function createGlowMaterial(color, emissive = 0.9) {
  return new THREE.MeshStandardMaterial({
    color: hexToInt(color),
    emissive: hexToInt(color),
    emissiveIntensity: emissive,
    roughness: 0.35,
    metalness: 0.25,
  });
}

function setupThree() {
  gfx.scene = new THREE.Scene();
  gfx.scene.background = new THREE.Color(0x05030b);
  gfx.scene.fog = new THREE.Fog(0x05030b, 35, 230);

  gfx.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);

  try {
    gfx.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    gfx.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gfx.renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (error) {
    state.renderDisabled = true;
    gfx.renderer = {
      setSize() {},
      render() {},
    };
  }

  gfx.camera.position.set(0, 10, -22);

  const hemi = new THREE.HemisphereLight(0x66f1ff, 0x080a14, 0.75);
  const key = new THREE.DirectionalLight(0x7ad9ff, 0.85);
  key.position.set(0, 25, -10);
  gfx.scene.add(hemi, key);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 1200),
    new THREE.MeshStandardMaterial({ color: 0x070b15, emissive: 0x050b15, emissiveIntensity: 0.45 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.55, 460);
  gfx.scene.add(road);
  gfx.road = road;

  const sideWallGeom = new THREE.BoxGeometry(1.2, 3, 1200);
  const leftWall = new THREE.Mesh(sideWallGeom, createGlowMaterial('#1f9cbf', 0.45));
  leftWall.position.set(-13, 1, 460);
  const rightWall = leftWall.clone();
  rightWall.position.x = 13;
  gfx.scene.add(leftWall, rightWall);

  for (const x of [-4, 4]) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.06, 1200),
      createGlowMaterial('#18c4e8', 0.65)
    );
    line.position.set(x, -0.48, 460);
    gfx.scene.add(line);
    gfx.laneLines.push(line);
  }

  const stars = new THREE.Group();
  for (let i = 0; i < 160; i += 1) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x8d8dff : 0x17f2ff })
    );
    s.position.set(randomIn(-80, 80), randomIn(18, 60), randomIn(-40, 400));
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

function createPlayer() {
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1, 3.5), createGlowMaterial(state.selectedTrail.color, 1.0));
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.4), createGlowMaterial('#dbf9ff', 0.3));
  canopy.position.y = 0.6;
  canopy.position.z = -0.1;
  body.add(canopy);
  gfx.scene.add(body);

  return {
    lane: 1,
    targetLane: 1,
    x: laneX(1),
    z: 0,
    y: 0.25,
    alive: true,
    mesh: body,
    phaseBlink: 0,
    overloadPulse: 0,
  };
}

function createBot(index) {
  const colors = ['#ff2cc6', '#ffa24d', '#79ff7a'];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 2.8), createGlowMaterial(colors[index % colors.length], 0.95));
  const lane = index % 3;
  const z = 24 + index * 18;
  mesh.position.set(laneX(lane), 0.25, z);
  gfx.scene.add(mesh);

  return {
    lane,
    z,
    mesh,
    driftTimer: randomIn(0.9, 1.7),
    dropTimer: randomIn(0.45, 1.2),
    color: colors[index % colors.length],
  };
}

function createObstacle(lane, z, owner = 'ai', color = '#11b6e0') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.4, 0.8), createGlowMaterial(color, 0.85));
  mesh.position.set(laneX(lane), 0.95, z);
  gfx.scene.add(mesh);
  const obs = { lane, z, mesh, owner, passed: false, nearMissAwarded: false };
  state.obstacles.push(obs);
  return obs;
}

function createPowerup(type, lane, z) {
  const color = type === 'phase' ? '#8dffef' : '#ff8ae4';
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.3, 12, 20), createGlowMaterial(color, 1));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(laneX(lane), 1.4, z);
  gfx.scene.add(mesh);
  state.powerups.push({ type, lane, z, mesh });
}

function cleanupRunObjects() {
  const removeAll = (arr) => {
    for (const item of arr) {
      if (item.mesh) gfx.scene.remove(item.mesh);
    }
    arr.length = 0;
  };

  if (state.player?.mesh) gfx.scene.remove(state.player.mesh);
  for (const bot of state.bots) gfx.scene.remove(bot.mesh);
  removeAll(state.obstacles);
  removeAll(state.powerups);
  removeAll(state.particles);
  state.bots = [];
  state.player = null;
}

function resetGame() {
  cleanupRunObjects();
  state.running = false;
  state.survived = 0;
  state.score = 0;
  state.speed = CONFIG.baseSpeed;
  state.closeCallMultiplier = 1;
  state.nearMissCooldown = 0;
  state.phaseCharges = 0;
  state.overloadTimer = 0;
  state.overloadCooldown = 0;
  state.nextObstacleZ = 62;
  state.nextPowerupZ = 95;
  state.player = createPlayer();

  for (let i = 0; i < CONFIG.botCount; i += 1) {
    state.bots.push(createBot(i));
  }

  for (let i = 0; i < 10; i += 1) {
    spawnForwardObstacle();
  }

  updateUi();
  render();
}

function spawnForwardObstacle() {
  const lane = Math.floor(Math.random() * 3);
  createObstacle(lane, state.nextObstacleZ, 'world', '#15a3ca');

  if (Math.random() > 0.58) {
    const blockLane = (lane + (Math.random() > 0.5 ? 1 : 2)) % 3;
    createObstacle(blockLane, state.nextObstacleZ + 3.6, 'world', '#0f7fa3');
  }

  state.nextObstacleZ += CONFIG.obstacleSpacing + randomIn(2, 6.5);
}

function maybeSpawnPowerup() {
  if (state.nextPowerupZ - state.player.z > 200) return;
  const lane = Math.floor(Math.random() * 3);
  const type = Math.random() > 0.5 ? 'phase' : 'overload';
  createPowerup(type, lane, state.nextPowerupZ);
  state.nextPowerupZ += CONFIG.powerupSpacing + randomIn(8, 14);
}

function setLane(targetLane) {
  if (!state.player?.alive) return;
  state.player.targetLane = Math.max(0, Math.min(2, targetLane));
}

function setupControls() {
  window.addEventListener('keydown', (event) => {
    if (!state.player) return;

    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setLane(state.player.targetLane - 1);
    }
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      event.preventDefault();
      setLane(state.player.targetLane + 1);
    }
    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
      event.preventDefault();
      state.speed = Math.min(CONFIG.maxSpeed, state.speed + 0.9);
    }
    if (event.key === ' ' || event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
      event.preventDefault();
      activateOverload();
    }
  });

  let touchStart = null;
  canvas.addEventListener('touchstart', (event) => {
    touchStart = event.changedTouches[0];
    requestFullscreenIfMobile();
  }, { passive: true });

  canvas.addEventListener('touchend', (event) => {
    if (!touchStart || !state.player) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touchStart.clientX;
    const dy = end.clientY - touchStart.clientY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < 20) return;

    if (absX > absY) {
      setLane(state.player.targetLane + (dx > 0 ? 1 : -1));
    } else if (dy < 0) {
      state.speed = Math.min(CONFIG.maxSpeed, state.speed + 1.2);
    } else {
      activateOverload();
    }
  }, { passive: true });
}

function activateOverload() {
  if (state.overloadTimer > 0 || state.overloadCooldown > 0) return;
  state.overloadTimer = 3.5;
  state.overloadCooldown = 9.5;
  pulseSynth(190, 0.1);
}

function requestFullscreenIfMobile() {
  if (state.touchedFullscreen) return;
  if (window.matchMedia('(max-width: 900px)').matches && document.fullscreenElement == null) {
    const root = document.documentElement;
    if (root.requestFullscreen) {
      root.requestFullscreen().catch(() => {});
    }
  }
  state.touchedFullscreen = true;
}

function syncPlayer(dt) {
  const p = state.player;
  const targetX = laneX(p.targetLane);
  p.x += (targetX - p.x) * Math.min(1, dt * 10);
  if (Math.abs(targetX - p.x) < 0.06) {
    p.x = targetX;
    p.lane = p.targetLane;
  }

  const step = state.speed * dt * (state.overloadTimer > 0 ? 0.56 : 1);
  p.z += step;

  p.mesh.position.set(p.x, p.y, p.z);
  p.mesh.rotation.y = (targetX - p.x) * 0.06;
  p.overloadPulse += dt * 5;

  const em = p.mesh.material;
  if (state.overloadTimer > 0) {
    em.emissiveIntensity = 1.2 + Math.sin(p.overloadPulse) * 0.2;
  } else {
    em.emissiveIntensity = 1.0;
  }

  if (state.phaseCharges > 0) {
    p.phaseBlink += dt * 12;
    p.mesh.material.opacity = 0.75 + Math.sin(p.phaseBlink) * 0.18;
    p.mesh.material.transparent = true;
  } else {
    p.mesh.material.opacity = 1;
    p.mesh.material.transparent = false;
  }
}

function updateBots(dt) {
  const speedFactor = state.overloadTimer > 0 ? 0.45 : 1;
  for (const bot of state.bots) {
    bot.z += (state.speed * 0.7 + 7) * dt * speedFactor;
    bot.driftTimer -= dt;
    bot.dropTimer -= dt;

    if (bot.driftTimer <= 0) {
      bot.lane = Math.floor(Math.random() * 3);
      bot.driftTimer = randomIn(0.9, 1.8);
    }

    bot.mesh.position.set(laneX(bot.lane), 0.25, bot.z);

    if (bot.dropTimer <= 0) {
      createObstacle(bot.lane, bot.z + 4, 'bot', bot.color);
      bot.dropTimer = randomIn(0.55, 1.35);
    }

    if (bot.z < state.player.z - 40) {
      bot.z = state.player.z + randomIn(70, 120);
      bot.lane = Math.floor(Math.random() * 3);
      bot.mesh.position.z = bot.z;
      bot.mesh.position.x = laneX(bot.lane);
      bot.dropTimer = randomIn(0.4, 1);
    }
  }
}

function checkNearMissAndCollisions() {
  const p = state.player;
  for (const obs of state.obstacles) {
    const dz = obs.z - p.z;
    const sameLane = obs.lane === p.lane;

    if (!obs.nearMissAwarded && Math.abs(dz) < CONFIG.nearMissZ && !sameLane && Math.abs(obs.lane - p.lane) === 1) {
      state.closeCallMultiplier = Math.min(5, state.closeCallMultiplier + 0.22);
      state.score += 10 * state.closeCallMultiplier;
      state.nearMissCooldown = 0.24;
      obs.nearMissAwarded = true;
      pulseSynth(330, 0.04);
    }

    if (sameLane && Math.abs(dz) < 1.7) {
      if (state.phaseCharges > 0) {
        state.phaseCharges -= 1;
        obs.passed = true;
        obs.mesh.visible = false;
        pulseSynth(570, 0.08);
      } else {
        p.alive = false;
      }
      return;
    }
  }

  for (const power of state.powerups) {
    if (power.lane === p.lane && Math.abs(power.z - p.z) < 1.8) {
      if (power.type === 'phase') {
        state.phaseCharges += 1;
      } else {
        state.overloadTimer = 2.8;
        state.overloadCooldown = Math.max(0, state.overloadCooldown - 3);
      }
      state.score += 35;
      power.collected = true;
      power.mesh.visible = false;
      pulseSynth(480, 0.07);
    }
  }
}

function updateObstaclesAndPowerups(dt) {
  const minZ = state.player.z - 28;

  state.obstacles = state.obstacles.filter((obs) => {
    if (obs.z < minZ || obs.passed) {
      gfx.scene.remove(obs.mesh);
      return false;
    }

    if (!obs.passed && obs.z < state.player.z - 1.2) {
      obs.passed = true;
      if (!obs.nearMissAwarded && state.nearMissCooldown <= 0) {
        state.closeCallMultiplier = Math.max(1, state.closeCallMultiplier - 0.03);
      }
    }

    return true;
  });

  state.powerups = state.powerups.filter((p) => {
    p.mesh.rotation.z += dt * 2;
    if (p.z < minZ || p.collected) {
      gfx.scene.remove(p.mesh);
      return false;
    }
    return true;
  });

  while (state.nextObstacleZ < state.player.z + 200) spawnForwardObstacle();
  while (state.nextPowerupZ < state.player.z + 220) maybeSpawnPowerup();
}

function emitTrailParticles(dt) {
  if (Math.random() > 0.62) return;
  const p = state.player;
  const binary = state.selectedTrail.particle === 'binary';
  const particle = new THREE.Mesh(
    new THREE.SphereGeometry(binary ? 0.17 : 0.12, 6, 6),
    new THREE.MeshBasicMaterial({ color: hexToInt(state.selectedTrail.color), transparent: true, opacity: 0.95 })
  );
  particle.position.set(p.x + randomIn(-0.18, 0.18), 0.15, p.z - 2.1);
  gfx.scene.add(particle);

  state.particles.push({
    mesh: particle,
    life: 0.7,
    vy: randomIn(0.2, 0.45),
    drift: randomIn(-0.55, 0.55),
    binary,
  });
}

function updateParticles(dt) {
  state.particles = state.particles.filter((p) => {
    p.life -= dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.x += p.drift * dt;
    if (p.binary) p.mesh.position.z -= dt * 2.1;
    p.mesh.material.opacity = Math.max(0, p.life / 0.7);
    if (p.life <= 0) {
      gfx.scene.remove(p.mesh);
      return false;
    }
    return true;
  });
}

function updateCamera(dt) {
  const p = state.player;
  const target = new THREE.Vector3(p.x, 1.8, p.z + 16);
  const pos = new THREE.Vector3(p.x, 8.8, p.z - 20);
  gfx.camera.position.lerp(pos, Math.min(1, dt * 5));
  gfx.camera.lookAt(target);
}

function updateGame(dt) {
  if (!state.player?.alive) return;

  state.survived += dt;
  state.speed = Math.min(CONFIG.maxSpeed, CONFIG.baseSpeed + state.survived * CONFIG.speedRamp + state.closeCallMultiplier * 0.4);
  state.score += dt * 13 * state.closeCallMultiplier;

  if (state.nearMissCooldown > 0) state.nearMissCooldown -= dt;
  state.closeCallMultiplier = Math.max(1, state.closeCallMultiplier - dt * 0.08);
  state.overloadTimer = Math.max(0, state.overloadTimer - dt);
  state.overloadCooldown = Math.max(0, state.overloadCooldown - dt);

  syncPlayer(dt);
  updateBots(dt);
  checkNearMissAndCollisions();
  updateObstaclesAndPowerups(dt);
  emitTrailParticles(dt);
  updateParticles(dt);
  updateCamera(dt);

  if (!state.player.alive) endGame();
}

function updateUi() {
  ui.score.textContent = Math.floor(state.score).toString();
  ui.time.textContent = `${state.survived.toFixed(1)}s`;
  ui.speed.textContent = `${(state.speed / CONFIG.baseSpeed).toFixed(2)}x`;
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
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = unlocked ? style.label : `${style.label} (${style.unlock})`;
    button.disabled = !unlocked;

    if (state.selectedTrail.id === style.id) button.classList.add('active');

    button.addEventListener('click', () => {
      state.selectedTrail = style;
      if (state.player?.mesh?.material) {
        state.player.mesh.material.color.setHex(hexToInt(style.color));
        state.player.mesh.material.emissive.setHex(hexToInt(style.color));
      }
      renderTrailOptions();
    });

    ui.trailOptions.appendChild(button);
  }
}

function render() {
  const pulse = 0.2 + Math.sin(state.survived * 2.8) * 0.05;
  gfx.road.material.emissiveIntensity = pulse + (state.overloadTimer > 0 ? 0.25 : 0);
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
  ui.overlayText.textContent = `You lasted ${state.survived.toFixed(1)}s and scored ${Math.floor(state.score)}. Tap Try Again to restart instantly.`;
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
  const tempo = 430 - Math.min(220, (state.speed / CONFIG.baseSpeed) * 85 + state.survived * 1.6);
  pulseSynth(108 + (state.speed / CONFIG.baseSpeed) * 18, 0.12);
  if (audio.beatTimer) clearTimeout(audio.beatTimer);
  audio.beatTimer = setTimeout(scheduleBeat, Math.max(135, tempo));
}

function syncAudio() {
  if (!audio.context || !audio.active) return;
  const speedFactor = state.speed / CONFIG.baseSpeed;
  audio.master.gain.value = Math.min(0.24, 0.08 + speedFactor * 0.035);
  audio.bass.frequency.value = 52 + speedFactor * 11;
}

ui.startBtn.addEventListener('click', () => {
  startGame();
});

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

setupThree();
if (state.renderDisabled) {
  ui.overlayText.textContent = 'WebGL failed in this browser session. Gameplay still runs, but 3D rendering is unavailable here.';
}
setupControls();
renderTrailOptions();
resetGame();
requestAnimationFrame(loop);
