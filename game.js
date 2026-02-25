const canvas = document.getElementById('game');
const arenaWrap = document.querySelector('.arena-wrap');

const ui = {
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  speed: document.getElementById('speed'),
  multiplier: document.getElementById('multiplier'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  startBtn: document.getElementById('start-btn'),
  audioBtn: document.getElementById('audio-toggle'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  trailOptions: document.getElementById('trail-options'),
  inGameMenu: document.getElementById('in-game-menu'),
  bgm: document.getElementById('bgm'),
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
  { id: 'lime', label: 'Lime Pulse', unlock: 190, color: '#a5ff32', particle: 'spark' },
  { id: 'amber', label: 'Amber Binary', unlock: 280, color: '#ffbb33', particle: 'binary' },
  { id: 'sunset', label: 'Sunset Glide', unlock: 360, color: '#ff6b6b', particle: 'spark' },
  { id: 'void', label: 'Void Glitch', unlock: 460, color: '#9f7bff', particle: 'binary' },
  { id: 'electric', label: 'Electric Mint', unlock: 620, color: '#4dffd8', particle: 'binary' },
];

const CONFIG = {
  fieldHalf: 140,
  baseSpeed: 22,
  speedRamp: 0.85,
  botCount: 7,
  trailSpacing: 0.3,
  maxTrailLength: 760,
  nearMissDist: 2.8,
  powerupSpawnMs: 5200,
};

const BOT_COLORS = ['#ff2cc6', '#ffa24d', '#79ff7a', '#7a8dff', '#25f0ff', '#ff5a9f', '#ffd84e', '#c98dff'];

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
  bgmReady: false,
  bgmEnabled: false,
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

function syncEntityTrailColor(entity) {
  if (!entity?.trailMaterial) return;
  const color = hexToInt(entity.color);
  entity.trailMaterial.color.setHex(color);
  if (entity.trailMaterial.emissive) {
    entity.trailMaterial.emissive.setHex(color);
  }
}

function getRenderableTrailPoints(entity) {
  const points = entity.trailSamples;
  if (points.length <= 80) return points;

  const keepRecent = 80;
  const olderEnd = Math.max(0, points.length - keepRecent);
  const reduced = [];

  for (let i = 0; i < olderEnd; i += 2) reduced.push(points[i]);
  for (let i = olderEnd; i < points.length; i += 1) reduced.push(points[i]);
  return reduced;
}

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
    gfx.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
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
    new THREE.PlaneGeometry(360, 360),
    new THREE.MeshStandardMaterial({ color: 0x070b15, emissive: 0x071b30, emissiveIntensity: 0.34 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.72;
  gfx.scene.add(floor);
  gfx.floor = floor;

  const grid = new THREE.GridHelper(320, 160, 0x205f8f, 0x13344d);
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

  gfx.trailGeo = new THREE.BoxGeometry(1, 0.75, 1);
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
  const entity = {
    id: state.nextEntityId++,
    isPlayer,
    color,
    x,
    z,
    dirIndex,
    alive: true,
    mesh,
    trailTick: 0,
    trailSamples: [],
    trailGeometry: new THREE.BufferGeometry(),
    trailMaterial: new THREE.MeshBasicMaterial({
      color: hexToInt(color),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    trailMesh: null,
    trailPendingDist: 0,
    trailDirty: true,
    thinkTimer: randomIn(0.05, 0.16),
    targetId: null,
    pathMemory: [],
  };
  entity.trailSamples.push({ ownerId: entity.id, owner: isPlayer ? 'player' : 'bot', x, z, bornAt: state.survived });
  syncEntityTrailColor(entity);
  entity.trailMesh = new THREE.Mesh(entity.trailGeometry, entity.trailMaterial);
  entity.trailMesh.frustumCulled = false;
  gfx.scene.add(entity.trailMesh);
  return entity;
}

function rebuildTrailMesh(entity) {
  const points = getRenderableTrailPoints(entity);

  if (points.length < 2) {
    entity.trailMesh.visible = false;
    return;
  }

  const baseY = 0.06;
  const wallHeight = 0.72;
  const topY = baseY + wallHeight;
  const wallWidth = 0.05;
  const positions = [];
  const indices = [];

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    let len = Math.hypot(tx, tz);
    if (len < 0.0001) { tx = 1; tz = 0; len = 1; }

    const nx = (-tz / len) * wallWidth;
    const nz = (tx / len) * wallWidth;

    const px = points[i].x;
    const pz = points[i].z;

    // single wall ribbon, slightly widened for visibility
    positions.push(px, baseY, pz);
    positions.push(px + nx, baseY, pz + nz);
    positions.push(px, topY, pz);
    positions.push(px + nx, topY, pz + nz);

    if (i < points.length - 1) {
      const a = i * 4;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const e = a + 4;
      const f = a + 5;
      const g = a + 6;
      const h = a + 7;
      indices.push(a, c, e, c, g, e);
      indices.push(b, f, d, d, f, h);
    }
  }

  entity.trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  entity.trailGeometry.setIndex(indices);
  entity.trailGeometry.computeBoundingSphere();
  entity.trailMesh.visible = true;
  entity.trailDirty = false;
}

function addTrailSample(entity, x, z) {
  const sample = {
    ownerId: entity.id,
    owner: entity.isPlayer ? 'player' : 'bot',
    x,
    z,
    bornAt: state.survived,
  };
  entity.trailSamples.push(sample);
  if (entity.trailSamples.length > CONFIG.maxTrailLength) {
    entity.trailSamples.shift();
  }
  entity.trailDirty = true;
}

function addInterpolatedTrailSamples(entity, fromX, fromZ, toX, toZ) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return;

  entity.trailPendingDist += dist;
  const step = Math.max(0.01, CONFIG.trailSpacing);
  const steps = Math.floor(entity.trailPendingDist / step);
  if (steps <= 0) return;

  entity.trailPendingDist -= steps * step;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / (steps + 1);
    const x = fromX + dx * t;
    const z = fromZ + dz * t;
    addTrailSample(entity, x, z);
  }
}

function spawnPowerup() {
  // Power-up system removed.
}

function cleanupRunObjects() {
  for (const e of state.entities) { gfx.scene.remove(e.mesh); gfx.scene.remove(e.trailMesh); e.trailGeometry?.dispose?.(); e.trailMaterial?.dispose?.(); }
  for (const p of state.particles) gfx.scene.remove(p.mesh);
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

  const botSpawns = [
    [-94, -94, 1],
    [94, 94, 3],
    [-94, 94, 2],
    [94, -94, 0],
    [0, -108, 1],
    [108, 0, 2],
    [-108, 0, 0],
  ];

  for (let i = 0; i < CONFIG.botCount; i += 1) {
    const [x, z, d] = botSpawns[i % botSpawns.length];
    state.entities.push(createEntity(false, BOT_COLORS[i % BOT_COLORS.length], x, z, d));
  }

  updateUi();
  render();
}

function player() { return state.entities[0]; }
function entityDir(e) { return DIR[e.dirIndex]; }

function trailFadeAge() {
  return Math.max(3.2, 14 - state.survived * 0.22);
}

function trailLife() {
  return 1;
}

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


function selectBotTarget(bot) {
  const alive = state.entities.filter((e) => e.alive && e.id !== bot.id);
  if (!alive.length) return player();

  if (bot.targetId) {
    const keep = alive.find((e) => e.id === bot.targetId);
    if (keep) return keep;
  }

  alive.sort((a, b) => {
    const apri = a.isPlayer ? 0 : 1;
    const bpri = b.isPlayer ? 0 : 1;
    if (apri !== bpri) return apri - bpri;

    const ad = distSq2D(bot, a);
    const bd = distSq2D(bot, b);
    return ad - bd;
  });

  bot.targetId = alive[0].id;
  return alive[0];
}

function wallInterceptScore(bot, optDir, target) {
  const d = DIR[optDir];
  const td = entityDir(target);
  const tFuture = { x: target.x + td.x * 12, z: target.z + td.z * 12 };
  const wallFuture = { x: bot.x + d.x * 12, z: bot.z + d.z * 12 };

  const laneCut = Math.abs((tFuture.x - wallFuture.x) * d.z - (tFuture.z - wallFuture.z) * d.x);
  const approach = Math.max(0, 22 - Math.sqrt(distSq2D(wallFuture, tFuture)));
  return Math.max(0, 12 - laneCut) + approach;
}

function estimateDanger(x, z, dirIndex, entityId) {
  const d = DIR[dirIndex];
  let penalty = 0;
  for (let step = 1; step <= 9; step += 1) {
    const nx = x + d.x * step * 2;
    const nz = z + d.z * step * 2;
    if (Math.abs(nx) > CONFIG.fieldHalf - 2 || Math.abs(nz) > CONFIG.fieldHalf - 2) penalty += 24;
    for (const t of state.trails) {
      if (t.ownerId === entityId && state.survived - t.bornAt < 1.3) continue;
      const life = trailLife(t);
      if (life <= 0.15) continue;
      const dd = (nx - t.x) ** 2 + (nz - t.z) ** 2;
      const radius = 0.6 + life * 0.9;
      if (dd < radius * radius) penalty += t.ownerId === entityId ? 28 : 16;
    }
  }
  return penalty;
}

function pointBlocked(x, z, entityId) {
  if (Math.abs(x) >= CONFIG.fieldHalf - 1 || Math.abs(z) >= CONFIG.fieldHalf - 1) return true
  for (const t of state.trails) {
    if (t.ownerId === entityId && state.survived - t.bornAt < 1.2) continue;
    const life = trailLife(t);
    if (life <= 0.18) continue;
    const r = 0.55 + life * 0.95;
    if ((x - t.x) ** 2 + (z - t.z) ** 2 < r * r) return true;
  }
  return false;
}

function projectedFreeSpace(bot, optDir) {
  const startDir = DIR[optDir];
  const start = { x: bot.x + startDir.x * 5, z: bot.z + startDir.z * 5 };
  const step = 3;
  const limit = 150;
  const queue = [start];
  const visited = new Set();
  let count = 0;

  while (queue.length && count < limit) {
    const n = queue.shift();
    const qx = Math.round(n.x / step);
    const qz = Math.round(n.z / step);
    const key = `${qx},${qz}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const px = qx * step;
    const pz = qz * step;
    if (Math.abs(px - bot.x) > 48 || Math.abs(pz - bot.z) > 48) continue;
    if (pointBlocked(px, pz, bot.id)) continue;

    count += 1;
    queue.push({ x: px + step, z: pz });
    queue.push({ x: px - step, z: pz });
    queue.push({ x: px, z: pz + step });
    queue.push({ x: px, z: pz - step });
  }

  return count;
}

function pathfindExitScore(bot, optDir) {
  const step = 4;
  const d = DIR[optDir];
  const startQx = Math.round((bot.x + d.x * 4) / step);
  const startQz = Math.round((bot.z + d.z * 4) / step);
  const rangeCells = 18;
  const maxNodes = 280;
  const queue = [{ qx: startQx, qz: startQz, dist: 0 }];
  const visited = new Set();
  const blockedCache = new Map();
  let qi = 0;
  let explored = 0;
  let foundDist = null;

  function isBlocked(qx, qz) {
    const key = `${qx},${qz}`;
    if (blockedCache.has(key)) return blockedCache.get(key);
    const px = qx * step;
    const pz = qz * step;
    const blocked = pointBlocked(px, pz, bot.id);
    blockedCache.set(key, blocked);
    return blocked;
  }

  while (qi < queue.length && explored < maxNodes) {
    const { qx, qz, dist } = queue[qi++];
    const key = `${qx},${qz}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (Math.abs(qx - startQx) > rangeCells || Math.abs(qz - startQz) > rangeCells) continue;
    if (isBlocked(qx, qz)) continue;

    explored += 1;

    let openNeighbors = 0;
    const neighbors = [
      { qx: qx + 1, qz },
      { qx: qx - 1, qz },
      { qx, qz: qz + 1 },
      { qx, qz: qz - 1 },
    ];
    for (const n of neighbors) {
      if (Math.abs(n.qx - startQx) > rangeCells || Math.abs(n.qz - startQz) > rangeCells) continue;
      if (!isBlocked(n.qx, n.qz)) openNeighbors += 1;
      queue.push({ qx: n.qx, qz: n.qz, dist: dist + 1 });
    }

    if (openNeighbors >= 3 && dist >= 4) {
      foundDist = dist;
      break;
    }
  }

  if (foundDist !== null) {
    return 240 - foundDist * 8 + explored * 0.8;
  }
  return explored * 0.7 - 160;
}

function loopPenalty(bot, opt) {
  const d = DIR[opt];
  const nx = Math.round((bot.x + d.x * 4) / 2);
  const nz = Math.round((bot.z + d.z * 4) / 2);
  const k = `${nx},${nz}`;
  let hits = 0;
  for (const key of bot.pathMemory) {
    if (key === k) hits += 1;
  }
  return hits * 35;
}

function optionTowardTarget(bot, target) {
  const dx = target.x - bot.x;
  const dz = target.z - bot.z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 2 : 0;
}


function willHitOwnTrailSoon(bot, dirIndex, horizon = 18) {
  const d = DIR[dirIndex];
  const speed = (CONFIG.baseSpeed + state.survived * CONFIG.speedRamp) * state.speedMul;
  const stride = 1.6;
  const steps = Math.max(6, Math.floor(horizon / stride));

  for (let i = 1; i <= steps; i += 1) {
    const nx = bot.x + d.x * i * stride;
    const nz = bot.z + d.z * i * stride;

    if (Math.abs(nx) >= CONFIG.fieldHalf - 1.4 || Math.abs(nz) >= CONFIG.fieldHalf - 1.4) return true;

    for (const t of state.trails) {
      if (t.ownerId !== bot.id) continue;
      if (state.survived - t.bornAt < 1.1) continue;
      const life = trailLife(t);
      if (life <= 0.12) continue;
      const r = 0.35 + life * 0.9;
      if ((nx - t.x) ** 2 + (nz - t.z) ** 2 < r * r) return true;
    }
  }

  return false;
}

function safestTurn(bot) {
  const options = [(bot.dirIndex + 3) % 4, (bot.dirIndex + 1) % 4, bot.dirIndex];
  let best = options[0];
  let bestScore = -Infinity;

  for (const opt of options) {
    const ownRisk = willHitOwnTrailSoon(bot, opt, 20) ? 1 : 0;
    const escapeScore = pathfindExitScore(bot, opt);
    const score = projectedFreeSpace(bot, opt) + escapeScore - estimateDanger(bot.x, bot.z, opt, bot.id) - ownRisk * 200;
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }

  return best;
}

function aiTurn(bot, dt) {
  bot.thinkTimer -= dt;
  if (bot.thinkTimer > 0) return;
  bot.thinkTimer = randomIn(0.04, 0.13);

  const options = [bot.dirIndex, (bot.dirIndex + 3) % 4, (bot.dirIndex + 1) % 4];
  const target = selectBotTarget(bot);
  const targetDir = entityDir(target);
  const preferred = optionTowardTarget(bot, target);

  let best = options[0];
  let bestScore = -Infinity;

  for (const opt of options) {
    const d = DIR[opt];
    const probe = { x: bot.x + d.x * 10, z: bot.z + d.z * 10 };

    const ownTrap = willHitOwnTrailSoon(bot, opt, 22) ? 1 : 0;

    let score = 0;
    score -= estimateDanger(bot.x, bot.z, opt, bot.id);

    const tFuture = { x: target.x + targetDir.x * 14, z: target.z + targetDir.z * 14 };
    score += Math.max(0, 120 - distSq2D(probe, tFuture));
    score += wallInterceptScore(bot, opt, target) * 1.3;
    score += projectedFreeSpace(bot, opt) * 0.95;
    score += pathfindExitScore(bot, opt);

    if (opt === preferred) score += 24;
    score -= loopPenalty(bot, opt);
    score -= ownTrap * 260;

    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }

  bot.dirIndex = best;

  // Emergency correction right after choosing: never keep a heading that immediately self-traps.
  if (willHitOwnTrailSoon(bot, bot.dirIndex, 14)) {
    bot.dirIndex = safestTurn(bot);
  }
}

function checkCollision(entity) {
  if (Math.abs(entity.x) >= CONFIG.fieldHalf || Math.abs(entity.z) >= CONFIG.fieldHalf) return true;
  for (const t of state.trails) {
    if (t.ownerId === entity.id && state.survived - t.bornAt < 0.22) continue;
    const life = trailLife(t);
    if (life <= 0.12) continue;
    const radius = 0.3 + life * 0.9;
    if (distSq2D(entity, t) < radius * radius) return true;
  }
  return false;
}

function activateOverload() {
  // Power-ups are disabled.
}

function updateEntities(dt) {
  const worldSpeed = (CONFIG.baseSpeed + state.survived * CONFIG.speedRamp) * state.speedMul;

  for (let i = 0; i < state.entities.length; i += 1) {
    const e = state.entities[i];
    if (!e.alive) continue;
    if (!e.isPlayer) aiTurn(e, dt);

    const speed = e.isPlayer ? worldSpeed : worldSpeed * randomIn(0.9, 1.03);

    if (!e.isPlayer && willHitOwnTrailSoon(e, e.dirIndex, 10)) {
      e.dirIndex = safestTurn(e);
    }

    const d = entityDir(e);
    const prevX = e.x;
    const prevZ = e.z;
    e.x += d.x * speed * dt;
    e.z += d.z * speed * dt;

    if (checkCollision(e)) {
      e.alive = false;
      e.mesh.visible = false;
      if (e.isPlayer) playCrashSound();
      continue;
    }

    addInterpolatedTrailSamples(e, prevX, prevZ, e.x, e.z);

    e.mesh.position.set(e.x, 0.1, e.z);
    e.mesh.rotation.y = e.dirIndex * (Math.PI / 2);

    if (!e.isPlayer) {
      const memoryKey = `${Math.round(e.x / 2)},${Math.round(e.z / 2)}`;
      e.pathMemory.push(memoryKey);
      if (e.pathMemory.length > 40) e.pathMemory.shift();
    }
  }

  state.trails = [];
  for (const e of state.entities) {
    syncEntityTrailColor(e);
    for (const sample of e.trailSamples) state.trails.push(sample);
    if (e.trailDirty) rebuildTrailMesh(e);
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

function updatePowerups() {
  // Power-up system removed.
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
      if (p?.trailMaterial) {
        syncEntityTrailColor(p);
      }
      renderTrailOptions();
    });

    ui.trailOptions.appendChild(btn);
  }
}

function render() {
  const pulse = 0.2 + Math.sin(state.survived * 2.5) * 0.06;
  gfx.floor.material.emissiveIntensity = pulse;
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
  ui.inGameMenu?.classList.add('hidden');
}

function endGame() {
  state.running = false;
  document.body.classList.remove('game-active');
  ui.overlay.classList.remove('hidden');
  ui.overlayTitle.textContent = 'Run Ended';
  ui.overlayText.textContent = `Survived ${state.survived.toFixed(1)}s | Score ${Math.floor(state.score)}. Press Space or Try Again.`;
  ui.startBtn.textContent = 'Try Again';
  ui.inGameMenu?.classList.remove('hidden');
}

function playCrashSound() {
  if (!audio.context || !audio.active) return;
  const now = audio.context.currentTime;
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(240, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.2);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
  osc.connect(gain);
  gain.connect(audio.master);
  osc.start(now);
  osc.stop(now + 0.25);
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

function prepareBgm() {
  if (!ui.bgm) return;
  ui.bgm.volume = 0.28;
  ui.bgm.playbackRate = 1;
  ui.bgm.addEventListener('canplay', () => {
    audio.bgmReady = true;
  }, { once: true });
  ui.bgm.addEventListener('error', () => {
    audio.bgmReady = false;
  });
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

  if (audio.bgmReady) {
    ui.bgm.play().then(() => {
      audio.bgmEnabled = true;
    }).catch(() => {
      audio.bgmEnabled = false;
      scheduleSynthwaveStep();
    });
  } else {
    scheduleSynthwaveStep();
  }
}

function syncMusic() {
  if (!audio.context || !audio.active) return;
  audio.master.gain.value = Math.min(0.3, 0.1 + state.speedMul * 0.05);
  if (audio.bgmEnabled && ui.bgm) {
    ui.bgm.playbackRate = Math.min(1.2, 0.98 + state.speedMul * 0.08);
    ui.bgm.volume = Math.min(0.45, 0.22 + state.speedMul * 0.08);
  }
}

ui.startBtn.addEventListener('click', startGame);
ui.fullscreenBtn.addEventListener('click', requestGameFullscreen);
ui.audioBtn.addEventListener('click', async () => {
  if (!audio.context) initMusic();
  if (audio.context.state === 'suspended') await audio.context.resume();
  audio.active = !audio.active;
  if (audio.active) {
    if (audio.bgmReady) {
      ui.bgm.play().then(() => { audio.bgmEnabled = true; }).catch(() => { audio.bgmEnabled = false; });
    } else {
      scheduleSynthwaveStep();
    }
    ui.audioBtn.textContent = 'Mute Music';
  } else {
    if (audio.stepTimer) clearTimeout(audio.stepTimer);
    if (ui.bgm) ui.bgm.pause();
    audio.bgmEnabled = false;
    ui.audioBtn.textContent = 'Start Music';
  }
});

window.addEventListener('resize', resizeRenderer);
document.addEventListener('pointerdown', requestFullscreenIfMobile, { once: true });
prepareBgm();

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
