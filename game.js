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
  worldWidth: 240,
  worldHeight: 140,
  botCount: 4,
  segmentGap: 1.8,
  baseSpeed: 28,
  speedRamp: 0.65,
  nearMissDistance: 5,
  powerupEveryMs: 5200,
};

const TRAIL_STYLES = [
  { id: 'cyan', label: 'Classic Cyan', unlock: 0, color: '#17f2ff', particle: 'spark' },
  { id: 'magenta', label: 'Magenta Surge', unlock: 80, color: '#ff2cc6', particle: 'spark' },
  { id: 'amber', label: 'Amber Binary', unlock: 180, color: '#ffbb33', particle: 'binary' },
  { id: 'void', label: 'Void Glitch', unlock: 320, color: '#9f7bff', particle: 'binary' },
];

const BOT_COLORS = ['#ff2cc6', '#ff7c4d', '#54ff8c', '#8b7bff'];

const state = {
  running: false,
  lastTime: 0,
  score: 0,
  survived: 0,
  speedMultiplier: 1,
  closeCallMultiplier: 1,
  nearMissCooldown: 0,
  phaseCharges: 0,
  overloadTimer: 0,
  overloadCooldown: 0,
  powerups: [],
  nextPowerup: 0,
  trailSegments: [],
  particles: [],
  entities: [],
  nextEntityId: 1,
  selectedTrail: TRAIL_STYLES[0],
  unlockedTrailScore: 0,
  spawnGrace: 0,
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
  arena: null,
  entityGeom: null,
  trailGeom: null,
  sparkGeom: null,
  powerGeom: null,
  floor: null,
};

function hexToInt(hex) {
  return Number.parseInt(hex.replace('#', '0x'), 16);
}

function randomIn(min, max) {
  return Math.random() * (max - min) + min;
}

function randomDir() {
  return [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ][Math.floor(Math.random() * 4)];
}

function cloneDir(dir) {
  return { x: dir.x, y: dir.y };
}

function isOpposite(a, b) {
  return a.x + b.x === 0 && a.y + b.y === 0;
}

function worldBounds() {
  const halfW = CONFIG.worldWidth / 2;
  const halfH = CONFIG.worldHeight / 2;
  return {
    minX: -halfW,
    maxX: halfW,
    minY: -halfH,
    maxY: halfH,
  };
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function createNeonMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: hexToInt(color),
    emissive: hexToInt(color),
    emissiveIntensity: 0.85,
    metalness: 0.2,
    roughness: 0.4,
  });
}

function setupThree() {
  gfx.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  gfx.renderer.setPixelRatio(window.devicePixelRatio || 1);
  gfx.renderer.outputColorSpace = THREE.SRGBColorSpace;

  gfx.scene = new THREE.Scene();
  gfx.scene.background = new THREE.Color(0x05030b);

  const ambient = new THREE.AmbientLight(0x5577aa, 0.6);
  const key = new THREE.DirectionalLight(0x66d8ff, 0.95);
  key.position.set(0, 40, 30);

  gfx.scene.add(ambient, key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.worldWidth + 8, CONFIG.worldHeight + 8),
    new THREE.MeshStandardMaterial({ color: 0x090d18, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.8;
  gfx.scene.add(floor);
  gfx.floor = floor;

  const grid = new THREE.GridHelper(CONFIG.worldWidth + 8, 50, 0x1b6ea8, 0x103754);
  grid.position.y = -0.78;
  gfx.scene.add(grid);

  const box = worldBounds();
  const boundaryPoints = [
    new THREE.Vector3(box.minX, 0, box.minY),
    new THREE.Vector3(box.maxX, 0, box.minY),
    new THREE.Vector3(box.maxX, 0, box.maxY),
    new THREE.Vector3(box.minX, 0, box.maxY),
    new THREE.Vector3(box.minX, 0, box.minY),
  ];
  const boundaryGeom = new THREE.BufferGeometry().setFromPoints(boundaryPoints);
  const boundary = new THREE.Line(
    boundaryGeom,
    new THREE.LineBasicMaterial({ color: 0x17f2ff })
  );
  boundary.position.y = 0.02;
  gfx.scene.add(boundary);

  gfx.entityGeom = new THREE.BoxGeometry(2.1, 1, 2.1);
  gfx.trailGeom = new THREE.BoxGeometry(1.4, 0.5, 1.4);
  gfx.sparkGeom = new THREE.SphereGeometry(0.35, 8, 8);
  gfx.powerGeom = new THREE.TorusGeometry(1.1, 0.25, 12, 20);

  resizeRenderer();
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const aspect = width / Math.max(height, 1);
  const viewSize = CONFIG.worldHeight;

  if (!gfx.camera) {
    gfx.camera = new THREE.OrthographicCamera();
    gfx.camera.position.set(0, 115, 0);
    gfx.camera.up.set(0, 0, -1);
    gfx.camera.lookAt(0, 0, 0);
  }

  gfx.camera.left = (-viewSize * aspect) / 2;
  gfx.camera.right = (viewSize * aspect) / 2;
  gfx.camera.top = viewSize / 2;
  gfx.camera.bottom = -viewSize / 2;
  gfx.camera.near = 1;
  gfx.camera.far = 400;
  gfx.camera.updateProjectionMatrix();

  gfx.renderer.setSize(width, height, false);
}

function cleanupObjects() {
  for (const seg of state.trailSegments) {
    gfx.scene.remove(seg.mesh);
  }
  for (const p of state.particles) {
    gfx.scene.remove(p.mesh);
  }
  for (const p of state.powerups) {
    gfx.scene.remove(p.mesh);
  }
  for (const e of state.entities) {
    if (e.mesh) gfx.scene.remove(e.mesh);
  }
}

function createEntity(isPlayer, color, preset = null) {
  const box = worldBounds();
  const pad = 15;
  const material = createNeonMaterial(color);
  const mesh = new THREE.Mesh(gfx.entityGeom, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  gfx.scene.add(mesh);

  const entity = {
    id: state.nextEntityId++,
    isPlayer,
    color,
    x: preset?.x ?? randomIn(box.minX + pad, box.maxX - pad),
    y: preset?.y ?? randomIn(box.minY + pad, box.maxY - pad),
    dir: preset?.dir ?? randomDir(),
    alive: true,
    thinkTime: randomIn(0.1, 0.4),
    trailEvery: 0,
    mesh,
    material,
  };
  syncEntityMesh(entity);
  return entity;
}

function syncEntityMesh(entity) {
  entity.mesh.position.set(entity.x, 0.65, entity.y);
  const angle = Math.atan2(entity.dir.y, entity.dir.x);
  entity.mesh.rotation.y = -angle + Math.PI / 2;
}

function spawnTrailPoint(entity) {
  const material = createNeonMaterial(entity.color);
  material.emissiveIntensity = 0.7;
  const mesh = new THREE.Mesh(gfx.trailGeom, material);
  mesh.position.set(entity.x, 0.26, entity.y);
  gfx.scene.add(mesh);

  state.trailSegments.push({
    x: entity.x,
    y: entity.y,
    owner: entity.isPlayer ? 'player' : 'bot',
    ownerId: entity.id,
    bornAt: state.survived,
    mesh,
  });

  const style = entity.isPlayer ? state.selectedTrail : { particle: 'spark', color: entity.color };
  if (Math.random() < 0.35) {
    const pm = new THREE.Mesh(
      gfx.sparkGeom,
      new THREE.MeshBasicMaterial({ color: hexToInt(style.color), transparent: true, opacity: 0.95 })
    );
    pm.position.set(entity.x, 0.9, entity.y);
    gfx.scene.add(pm);
    state.particles.push({
      x: entity.x,
      y: entity.y,
      vy: randomIn(0.15, 0.4),
      life: 0.7,
      binary: style.particle === 'binary',
      mesh: pm,
    });
  }
}

function spawnPowerup() {
  const box = worldBounds();
  const type = Math.random() > 0.5 ? 'phase' : 'overload';
  const color = type === 'phase' ? '#8dffef' : '#ff8ae4';
  const mesh = new THREE.Mesh(gfx.powerGeom, createNeonMaterial(color));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(randomIn(box.minX + 8, box.maxX - 8), 0.7, randomIn(box.minY + 8, box.maxY - 8));
  gfx.scene.add(mesh);

  state.powerups.push({
    type,
    x: mesh.position.x,
    y: mesh.position.z,
    ttl: 10,
    mesh,
  });
}

function detectCollision(entity) {
  const box = worldBounds();
  const margin = 1.5;
  if (entity.isPlayer && state.spawnGrace > 0) return false;

  if (entity.x < box.minX + margin || entity.x > box.maxX - margin || entity.y < box.minY + margin || entity.y > box.maxY - margin) {
    return true;
  }

  for (const segment of state.trailSegments) {
    if (segment.ownerId === entity.id && state.survived - segment.bornAt < 0.2) continue;
    if (distSq(entity, segment) < 1.2) return true;
  }

  return false;
}

function setPlayerDirection(target) {
  const player = state.entities[0];
  if (!player?.alive) return;
  if (!isOpposite(player.dir, target)) {
    player.dir = target;
    syncEntityMesh(player);
  }
}

function setupControls() {
  window.addEventListener('keydown', (event) => {
    const map = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    };

    if (map[event.key]) {
      event.preventDefault();
      setPlayerDirection(map[event.key]);
    }

    if (event.key === ' ') {
      event.preventDefault();
      activateOverload();
    }
  });

  let touchStart = null;
  canvas.addEventListener('touchstart', (event) => {
    touchStart = event.changedTouches[0];
  }, { passive: true });

  canvas.addEventListener('touchend', (event) => {
    if (!touchStart) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - touchStart.clientX;
    const dy = end.clientY - touchStart.clientY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < 20) return;

    if (absX > absY) {
      setPlayerDirection({ x: Math.sign(dx), y: 0 });
    } else {
      setPlayerDirection({ x: 0, y: Math.sign(dy) });
    }
  }, { passive: true });
}

function aiTurn(bot, dt) {
  bot.thinkTime -= dt;
  if (bot.thinkTime > 0) return;
  bot.thinkTime = randomIn(0.06, 0.22);

  const options = [
    cloneDir(bot.dir),
    { x: bot.dir.y, y: -bot.dir.x },
    { x: -bot.dir.y, y: bot.dir.x },
  ];

  let best = options[0];
  let bestScore = -Infinity;
  const bounds = worldBounds();

  for (const dir of options) {
    if (isOpposite(bot.dir, dir)) continue;
    const probe = { x: bot.x + dir.x * 8, y: bot.y + dir.y * 8 };
    let score = randomIn(0, 8);

    if (probe.x < bounds.minX + 3 || probe.x > bounds.maxX - 3 || probe.y < bounds.minY + 3 || probe.y > bounds.maxY - 3) {
      score -= 120;
    }

    for (const segment of state.trailSegments) {
      if (distSq(probe, segment) < 20) score -= 55;
    }

    const player = state.entities[0];
    const pressure = { x: player.x + player.dir.x * 12, y: player.y + player.dir.y * 12 };
    score += Math.max(0, 80 - distSq(probe, pressure));

    if (score > bestScore) {
      best = dir;
      bestScore = score;
    }
  }

  bot.dir = best;
  syncEntityMesh(bot);
}

function awardNearMiss(dt) {
  if (state.nearMissCooldown > 0) {
    state.nearMissCooldown -= dt;
    return;
  }

  const player = state.entities[0];
  const nearSq = CONFIG.nearMissDistance * CONFIG.nearMissDistance;
  let close = false;

  for (const segment of state.trailSegments) {
    if (segment.owner === 'player') continue;
    const d = distSq(player, segment);
    if (d < nearSq && d > 2.3) {
      close = true;
      break;
    }
  }

  if (close) {
    state.closeCallMultiplier = Math.min(5, state.closeCallMultiplier + 0.25);
    state.speedMultiplier = Math.min(2.8, state.speedMultiplier + 0.025);
    state.score += 8 * state.closeCallMultiplier;
    state.nearMissCooldown = 0.35;
    pulseSynth(330, 0.05);
  } else {
    state.closeCallMultiplier = Math.max(1, state.closeCallMultiplier - dt * 0.12);
  }
}

function activateOverload() {
  if (state.overloadCooldown > 0 || state.overloadTimer > 0) return;
  state.overloadTimer = 3.8;
  state.overloadCooldown = 10;
  pulseSynth(180, 0.1);
}

function handlePowerupPickup(dt) {
  const player = state.entities[0];
  state.powerups = state.powerups.filter((p) => {
    p.ttl -= dt;
    p.mesh.rotation.z += dt * 1.7;
    if (p.ttl <= 0) {
      gfx.scene.remove(p.mesh);
      return false;
    }

    if (distSq(player, p) < 9) {
      if (p.type === 'phase') {
        state.phaseCharges += 1;
      } else {
        state.overloadCooldown = Math.max(0, state.overloadCooldown - 5);
        state.overloadTimer = 2.6;
      }
      state.score += 40;
      pulseSynth(470, 0.08);
      gfx.scene.remove(p.mesh);
      return false;
    }

    return true;
  });
}

function updateEntities(dt) {
  const overloadFactor = state.overloadTimer > 0 ? 0.45 : 1;
  const base = CONFIG.baseSpeed + state.survived * CONFIG.speedRamp;

  for (let i = 0; i < state.entities.length; i += 1) {
    const entity = state.entities[i];
    if (!entity.alive) continue;

    if (!entity.isPlayer) aiTurn(entity, dt * overloadFactor);

    const speed = entity.isPlayer
      ? base * state.speedMultiplier
      : base * randomIn(0.86, 1.03) * overloadFactor;

    entity.x += entity.dir.x * speed * dt;
    entity.y += entity.dir.y * speed * dt;

    if (detectCollision(entity)) {
      if (entity.isPlayer && state.phaseCharges > 0) {
        state.phaseCharges -= 1;
        entity.x += entity.dir.x * 3.6;
        entity.y += entity.dir.y * 3.6;
        pulseSynth(560, 0.08);
      } else {
        entity.alive = false;
        entity.mesh.visible = false;
        continue;
      }
    }

    entity.trailEvery -= dt;
    if (entity.trailEvery <= 0) {
      entity.trailEvery = CONFIG.segmentGap / Math.max(speed, 1);
      spawnTrailPoint(entity);
    }

    syncEntityMesh(entity);
  }

  while (state.trailSegments.length > 3800) {
    const old = state.trailSegments.shift();
    gfx.scene.remove(old.mesh);
  }
}

function updateParticles(dt) {
  state.particles = state.particles.filter((p) => {
    p.life -= dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.material.opacity = Math.max(0, p.life / 0.7);
    if (p.binary) p.mesh.position.x += Math.sin(state.survived * 10 + p.mesh.position.z) * dt * 0.2;

    if (p.life <= 0) {
      gfx.scene.remove(p.mesh);
      return false;
    }
    return true;
  });
}

function updateUi() {
  ui.score.textContent = Math.floor(state.score).toString();
  ui.time.textContent = `${state.survived.toFixed(1)}s`;
  ui.speed.textContent = `${state.speedMultiplier.toFixed(2)}x`;
  ui.multiplier.textContent = `${state.closeCallMultiplier.toFixed(2)}x`;
  ui.phaseStatus.textContent = state.phaseCharges.toString();

  if (state.overloadTimer > 0) {
    ui.overloadStatus.textContent = `Active ${state.overloadTimer.toFixed(1)}s`;
  } else if (state.overloadCooldown > 0) {
    ui.overloadStatus.textContent = `Cooldown ${state.overloadCooldown.toFixed(1)}s (Space)`;
  } else {
    ui.overloadStatus.textContent = 'Ready (Space)';
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
      const player = state.entities[0];
      if (player) {
        player.color = style.color;
        player.material.color.set(hexToInt(style.color));
        player.material.emissive.set(hexToInt(style.color));
      }
      renderTrailOptions();
    });

    ui.trailOptions.appendChild(button);
  }
}

function render() {
  const pulse = 0.18 + Math.sin(state.survived * 2.5) * 0.04;
  gfx.floor.material.emissive = new THREE.Color(0x080a12 + Math.floor(pulse * 1000));
  gfx.renderer.render(gfx.scene, gfx.camera);
}

function endGame() {
  state.running = false;
  ui.overlay.classList.remove('hidden');
  ui.overlayTitle.textContent = 'Run Ended';
  ui.overlayText.textContent = `You lasted ${state.survived.toFixed(1)}s with ${Math.floor(state.score)} points.`;
  ui.startBtn.textContent = 'Try Again';
}

function resetGame() {
  cleanupObjects();

  state.score = 0;
  state.survived = 0;
  state.speedMultiplier = 1;
  state.closeCallMultiplier = 1;
  state.nearMissCooldown = 0;
  state.phaseCharges = 0;
  state.overloadTimer = 0;
  state.overloadCooldown = 0;
  state.spawnGrace = 1.1;
  state.powerups = [];
  state.nextPowerup = CONFIG.powerupEveryMs;
  state.trailSegments = [];
  state.particles = [];

  state.nextEntityId = 1;
  state.entities = [createEntity(true, state.selectedTrail.color, { x: 0, y: 0, dir: { x: 1, y: 0 } })];
  const spawns = [
    { x: -90, y: -50, dir: { x: 1, y: 0 } },
    { x: 90, y: 50, dir: { x: -1, y: 0 } },
    { x: -90, y: 50, dir: { x: 0, y: -1 } },
    { x: 90, y: -50, dir: { x: 0, y: 1 } },
  ];
  for (let i = 0; i < CONFIG.botCount; i += 1) {
    state.entities.push(createEntity(false, BOT_COLORS[i % BOT_COLORS.length], spawns[i % spawns.length]));
  }
}

function loop(timestamp) {
  if (!state.running) return;

  const dt = Math.min(0.033, (timestamp - state.lastTime) / 1000 || 0.016);
  state.lastTime = timestamp;

  state.survived += dt;
  state.score += dt * 12 * state.closeCallMultiplier;

  state.nextPowerup -= dt * 1000;
  if (state.nextPowerup <= 0) {
    spawnPowerup();
    state.nextPowerup = CONFIG.powerupEveryMs;
  }

  state.overloadTimer = Math.max(0, state.overloadTimer - dt);
  state.overloadCooldown = Math.max(0, state.overloadCooldown - dt);
  state.spawnGrace = Math.max(0, state.spawnGrace - dt);

  handlePowerupPickup(dt);
  awardNearMiss(dt);
  updateEntities(dt);
  updateParticles(dt);
  updateUi();
  syncAudio();
  render();

  if (!state.entities[0].alive) {
    endGame();
    return;
  }

  requestAnimationFrame(loop);
}

function startGame() {
  resetGame();
  state.running = true;
  state.lastTime = performance.now();
  ui.overlay.classList.add('hidden');
  requestAnimationFrame(loop);
}

function initAudio() {
  if (audio.context) return;

  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.08;
  master.connect(context.destination);

  const bass = context.createOscillator();
  bass.type = 'sawtooth';
  bass.frequency.value = 55;
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
  const tempo = 420 - Math.min(200, state.speedMultiplier * 70 + state.survived * 2);
  pulseSynth(110 + state.speedMultiplier * 15, 0.12);
  if (audio.beatTimer) clearTimeout(audio.beatTimer);
  audio.beatTimer = setTimeout(scheduleBeat, Math.max(140, tempo));
}

function syncAudio() {
  if (!audio.context || !audio.active) return;
  const boost = Math.min(0.22, 0.08 + state.speedMultiplier * 0.03 + state.survived * 0.0005);
  audio.master.gain.value = boost;
  audio.bass.frequency.value = 55 + state.speedMultiplier * 9;
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

window.addEventListener('resize', () => {
  resizeRenderer();
  render();
});

setupThree();
setupControls();
renderTrailOptions();
resetGame();
updateUi();
render();
