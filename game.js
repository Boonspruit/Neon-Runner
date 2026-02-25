const canvas = document.getElementById('game');
const arenaWrap = document.querySelector('.arena-wrap');

const ui = {
  playerName: document.getElementById('player-name'),
  bestScore: document.getElementById('best-score'),
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  speed: document.getElementById('speed'),
  multiplier: document.getElementById('multiplier'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  startBtn: document.getElementById('start-btn'),
  newPlayerBtn: document.getElementById('new-player-btn'),
  audioBtn: document.getElementById('audio-toggle'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  trailOptions: document.getElementById('trail-options'),
  inGameMenu: document.getElementById('in-game-menu'),
  bgm: document.getElementById('bgm'),
};

const STORAGE_KEY = 'neonRunnerProfile.v1';

function loadProfile() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { name: 'Runner-01', bestScore: 0 };
    const parsed = JSON.parse(raw);
    const name = (parsed?.name || 'Runner-01').toString().slice(0, 20);
    const bestScore = Number.isFinite(parsed?.bestScore) ? Math.max(0, parsed.bestScore) : 0;
    return { name, bestScore };
  } catch (error) {
    return { name: 'Runner-01', bestScore: 0 };
  }
}

function saveProfile() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      name: state.playerName,
      bestScore: state.bestScore,
    }));
  } catch (error) {
    // Ignore storage failures.
  }
}

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
  fieldHalf: 110,
  baseSpeed: 22,
  speedRamp: 0.85,
  botCount: 7,
  maxBots: 20,
  botJoinIntervalMs: 5500,
  trailSpacing: 0.34,
  maxTrailLength: 760,
  wallHalfWidth: 0.19,
  bikeHitRadius: 0.24,
  nearMissDist: 2.8,
  powerupSpawnMs: 5200,
};

const BOT_COLORS = ['#ff2cc6', '#ffa24d', '#79ff7a', '#7a8dff', '#25f0ff', '#ff5a9f', '#ffd84e', '#c98dff', '#6bffb0', '#ff8f4d', '#67d1ff', '#ff4dc4', '#b9ff4d', '#8ec5ff', '#ff6e9c', '#9ef07a', '#ffb86c', '#5af7d2', '#a08dff', '#ff7fb2', '#7df06b', '#6ec5ff', '#ff9d57', '#7affd9'];

function botPaletteExcluding(playerColor) {
  const normalized = (playerColor || '').toLowerCase();
  const seen = new Set();
  const filtered = [];
  for (const color of BOT_COLORS) {
    const key = color.toLowerCase();
    if (key === normalized || seen.has(key)) continue;
    seen.add(key);
    filtered.push(color);
  }
  return filtered.length ? filtered : BOT_COLORS;
}

const BOT_SPAWNS = [
  [-94, -94, 1],
  [94, 94, 3],
  [-94, 94, 2],
  [94, -94, 0],
  [0, -108, 1],
  [108, 0, 2],
  [-108, 0, 0],
  [58, -82, 1],
  [-58, 82, 3],
  [74, 74, 2],
];

function pickUniqueBotColor(playerColor, usedColors) {
  const palette = botPaletteExcluding(playerColor);
  for (const color of palette) {
    const key = color.toLowerCase();
    if (!usedColors.has(key)) {
      usedColors.add(key);
      return color;
    }
  }
  return palette[Math.floor(Math.random() * palette.length)];
}

function recolorEntity(entity, color) {
  entity.color = color;
  const body = entity?.mesh?.children?.[0];
  if (body?.material) {
    body.material.color.setHex(hexToInt(color));
    body.material.emissive.setHex(hexToInt(color));
  }
  syncEntityTrailColor(entity);
}

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
  nextBotJoinMs: 0,
  botSpawnCursor: 0,
  pixelTimer: 0,
  playerName: 'Runner-01',
  bestScore: 0,
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
  composer: null,
  bloomPass: null,
  chromaPass: null,
  scene: null,
  camera: null,
  floor: null,
  trailGeo: null,
  sparkGeo: null,
  bitTextures: {},
};

function randomIn(min, max) { return Math.random() * (max - min) + min; }
function hexToInt(hex) { return Number.parseInt(hex.replace('#', '0x'), 16); }
function distSq2D(a, b) { const dx = a.x - b.x; const dz = a.z - b.z; return dx * dx + dz * dz; }

function pointSegmentDistSq(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const denom = abx * abx + abz * abz;
  if (denom <= 0.000001) {
    const dx = px - ax;
    const dz = pz - az;
    return dx * dx + dz * dz;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / denom));
  const qx = ax + abx * t;
  const qz = az + abz * t;
  const dx = px - qx;
  const dz = pz - qz;
  return dx * dx + dz * dz;
}

function trailSegmentHit(x, z, opts = {}) {
  const {
    ignoreEntityId = null,
    onlyEntityId = null,
    ownRecentGrace = 0,
    inflate = 0,
  } = opts;

  const hitR = CONFIG.wallHalfWidth + CONFIG.bikeHitRadius + inflate;
  const hitSq = hitR * hitR;

  for (const owner of state.entities) {
    if (!owner) continue;
    if (onlyEntityId !== null && owner.id !== onlyEntityId) continue;
    if (ignoreEntityId !== null && owner.id === ignoreEntityId) continue;

    const samples = owner.trailSamples;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1];
      const b = samples[i];
      if (state.survived - b.bornAt > trailFadeAge()) continue;
      if (ownRecentGrace > 0 && owner.id === onlyEntityId && state.survived - b.bornAt < ownRecentGrace) continue;
      if (pointSegmentDistSq(x, z, a.x, a.z, b.x, b.z) < hitSq) return true;
    }
  }
  return false;
}

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
  const n = points.length;
  if (n <= 120) return points;

  const keepRecent = 96;
  const olderEnd = Math.max(0, n - keepRecent);
  const stride = n > 520 ? 4 : (n > 320 ? 3 : 2);
  const reduced = [];

  for (let i = 0; i < olderEnd; i += stride) reduced.push(points[i]);
  for (let i = olderEnd; i < n; i += 1) reduced.push(points[i]);
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

  if (window.THREE?.EffectComposer && window.THREE?.RenderPass && window.THREE?.UnrealBloomPass && window.THREE?.ShaderPass && window.THREE?.RGBShiftShader) {
    gfx.composer = new THREE.EffectComposer(gfx.renderer);
    const renderPass = new THREE.RenderPass(gfx.scene, gfx.camera);
    gfx.bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(1, 1), 0.95, 0.7, 0.2);
    gfx.chromaPass = new THREE.ShaderPass(THREE.RGBShiftShader);
    gfx.chromaPass.uniforms.amount.value = 0.00095;
    gfx.composer.addPass(renderPass);
    gfx.composer.addPass(gfx.bloomPass);
    gfx.composer.addPass(gfx.chromaPass);
  }

  resizeRenderer();
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  gfx.renderer.setSize(width, height, false);
  if (gfx.composer) gfx.composer.setSize(width, height);
  if (gfx.bloomPass) gfx.bloomPass.setSize(width, height);
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
      transparent: false,
      opacity: 1,
      depthWrite: true,
      side: THREE.DoubleSide,
    }),
    trailMesh: null,
    trailPendingDist: 0,
    trailDirty: true,
    thinkTimer: randomIn(0.05, 0.16),
    targetId: null,
    pathMemory: [],
    spawnX: x,
    spawnZ: z,
    spawnDirIndex: dirIndex,
    deadTimer: 0,
    awaitingTrailClear: false,
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
  const wallWidth = CONFIG.wallHalfWidth;
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

    // One centered thick wall volume (not two separate walls)
    positions.push(px - nx, baseY, pz - nz); // left bottom
    positions.push(px + nx, baseY, pz + nz); // right bottom
    positions.push(px - nx, topY, pz - nz);  // left top
    positions.push(px + nx, topY, pz + nz);  // right top

    if (i < points.length - 1) {
      const a = i * 4;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const e = a + 4;
      const f = a + 5;
      const g = a + 6;
      const h = a + 7;

      // top bridge keeps wall visible head-on
      indices.push(c, d, g, d, h, g);
      // side faces
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

function spawnAdditionalBot() {
  const botCount = state.entities.filter((e) => !e.isPlayer).length;
  if (botCount >= CONFIG.maxBots) return;

  const [x, z] = BOT_SPAWNS[state.botSpawnCursor % BOT_SPAWNS.length];
  state.botSpawnCursor += 1;

  const usedBotColors = new Set(
    state.entities.filter((e) => !e.isPlayer).map((e) => e.color.toLowerCase())
  );
  const botColor = pickUniqueBotColor(state.selectedTrail.color, usedBotColors);
  state.entities.push(createEntity(false, botColor, x, z, centerBiasDir(x, z)));
}

function resetGame() {

  cleanupRunObjects();
  Object.assign(state, {
    running: false, survived: 0, score: 0, speedMul: 1, closeCallMultiplier: 1, nearMissCooldown: 0,
    phaseGhostTimer: 0, phaseGhostHits: 0, overloadTimer: 0, overloadCooldown: 0,
    nextPowerupMs: CONFIG.powerupSpawnMs, nextEntityId: 1, nextBotJoinMs: CONFIG.botJoinIntervalMs, botSpawnCursor: 0, pixelTimer: 0,
  });

  state.entities.push(createEntity(true, state.selectedTrail.color, 0, 0, 0));

  const usedBotColors = new Set();
  for (let i = 0; i < CONFIG.botCount; i += 1) {
    const [x, z] = BOT_SPAWNS[i % BOT_SPAWNS.length];
    const botColor = pickUniqueBotColor(state.selectedTrail.color, usedBotColors);
    state.entities.push(createEntity(false, botColor, x, z, centerBiasDir(x, z)));
    state.botSpawnCursor += 1;
  }

  updateUi();
  render();
}

function player() { return state.entities[0]; }
function entityDir(e) { return DIR[e.dirIndex]; }

function trailFadeAge() {
  return Math.max(3.2, 14 - state.survived * 0.22);
}

function pruneAgedTrailSamples(entity) {
  const fadeAge = trailFadeAge();
  const minSamples = entity.alive ? 1 : 0;
  let changed = false;

  while (entity.trailSamples.length > minSamples) {
    const next = entity.trailSamples[1] || entity.trailSamples[0];
    if (state.survived - next.bornAt <= fadeAge) break;
    entity.trailSamples.shift();
    changed = true;
  }

  if (changed) entity.trailDirty = true;
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
  const p = player();
  bot.targetId = p?.id ?? null;
  return p;
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
    if (trailSegmentHit(nx, nz, { ignoreEntityId: entityId, inflate: -0.05 })) penalty += 16;
    if (trailSegmentHit(nx, nz, { onlyEntityId: entityId, ownRecentGrace: 1.3, inflate: -0.05 })) penalty += 28;
  }
  return penalty;
}

function pointBlocked(x, z, entityId) {
  if (Math.abs(x) >= CONFIG.fieldHalf - 1 || Math.abs(z) >= CONFIG.fieldHalf - 1) return true;
  return trailSegmentHit(x, z, { ignoreEntityId: entityId, inflate: -0.06 })
    || trailSegmentHit(x, z, { onlyEntityId: entityId, ownRecentGrace: 1.2, inflate: -0.06 });
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

function centerBiasDir(x, z) {
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? 3 : 1;
  return z > 0 ? 0 : 2;
}

function playerCutoffTurn(bot) {
  const p = player();
  if (!p?.alive || !bot.alive) return null;

  const bd = entityDir(bot);
  const pd = entityDir(p);
  const sameHeading = bd.x * pd.x + bd.z * pd.z > 0.85;
  if (!sameHeading) return null;

  const relX = bot.x - p.x;
  const relZ = bot.z - p.z;
  const aheadDist = relX * pd.x + relZ * pd.z;
  if (aheadDist < 8 || aheadDist > 48) return null;

  const lateral = relX * pd.z - relZ * pd.x;
  const lateralAbs = Math.abs(lateral);
  if (lateralAbs > 12) return null;

  if (Math.abs(pd.x) > 0) {
    return lateral >= 0 ? 2 : 0;
  }
  return lateral >= 0 ? 3 : 1;
}

function rammingAmbushScore(bot, optDir) {
  const p = player();
  if (!p?.alive) return 0;

  const pd = entityDir(p);
  const relX = bot.x - p.x;
  const relZ = bot.z - p.z;
  const aheadDist = relX * pd.x + relZ * pd.z;
  if (aheadDist < 8) return 0;

  const lateralDist = Math.abs(relX * pd.z - relZ * pd.x);
  if (lateralDist > 24) return 0;

  const aheadWeight = Math.min(1, (aheadDist - 8) / 36);
  const laneWeight = Math.max(0, 1 - (lateralDist / 24));
  const ambushWeight = aheadWeight * laneWeight;
  if (ambushWeight <= 0) return 0;

  const d = DIR[optDir];
  const playerFuture = {
    x: p.x + pd.x * Math.min(34, 12 + aheadDist * 0.65),
    z: p.z + pd.z * Math.min(34, 12 + aheadDist * 0.65),
  };
  const botFuture = {
    x: bot.x + d.x * (10 + ambushWeight * 14),
    z: bot.z + d.z * (10 + ambushWeight * 14),
  };

  const closing = Math.max(0, 30 - Math.sqrt(distSq2D(botFuture, playerFuture)));
  const crossLane = Math.abs((playerFuture.x - botFuture.x) * d.z - (playerFuture.z - botFuture.z) * d.x);
  const laneCut = Math.max(0, 16 - crossLane);
  const headOn = (d.x * pd.x + d.z * pd.z < -0.4) ? 18 : 0;

  return ambushWeight * (closing * 2.4 + laneCut * 1.9 + headOn);
}


function willHitOwnTrailSoon(bot, dirIndex, horizon = 18) {
  const d = DIR[dirIndex];
  const stride = 1.6;
  const steps = Math.max(6, Math.floor(horizon / stride));

  for (let i = 1; i <= steps; i += 1) {
    const nx = bot.x + d.x * i * stride;
    const nz = bot.z + d.z * i * stride;

    if (Math.abs(nx) >= CONFIG.fieldHalf - 1.4 || Math.abs(nz) >= CONFIG.fieldHalf - 1.4) return true;
    if (trailSegmentHit(nx, nz, { onlyEntityId: bot.id, ownRecentGrace: 1.1, inflate: -0.05 })) return true;
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

  const forcedCut = playerCutoffTurn(bot);
  if (forcedCut !== null && !willHitOwnTrailSoon(bot, forcedCut, 9)) {
    bot.dirIndex = forcedCut;
    return;
  }

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
    if (target?.isPlayer) score += rammingAmbushScore(bot, opt) * 1.25;
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

function collidesAtPosition(entity, x, z) {
  if (Math.abs(x) >= CONFIG.fieldHalf || Math.abs(z) >= CONFIG.fieldHalf) return true;
  if (trailSegmentHit(x, z, { ignoreEntityId: entity.id, inflate: -0.05 })) return true;
  if (trailSegmentHit(x, z, { onlyEntityId: entity.id, ownRecentGrace: 0.22, inflate: -0.05 })) return true;
  return false;
}

function checkCollision(entity, fromX, fromZ, toX, toZ) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const dist = Math.hypot(dx, dz);

  const sweepStep = Math.max(0.06, CONFIG.bikeHitRadius * 0.6);
  const steps = Math.max(1, Math.ceil(dist / sweepStep));

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = fromX + dx * t;
    const z = fromZ + dz * t;
    if (collidesAtPosition(entity, x, z)) return true;
  }

  return false;
}

function getBitTexture(char, color) {
  const key = `${char}-${color}`;
  if (gfx.bitTextures[key]) return gfx.bitTextures[key];

  const bitCanvas = document.createElement('canvas');
  bitCanvas.width = 64;
  bitCanvas.height = 64;
  const ctx = bitCanvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = color;
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, 32, 34);

  const texture = new THREE.CanvasTexture(bitCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  gfx.bitTextures[key] = texture;
  return texture;
}

function emitRespawnEffect(bot) {
  for (let i = 0; i < 34; i += 1) {
    const texture = getBitTexture(Math.random() < 0.5 ? '0' : '1', bot.color);
    if (!texture) continue;

    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.92,
      color: 0xffffff,
    }));

    mesh.position.set(
      bot.spawnX + randomIn(-2.6, 2.6),
      randomIn(3.8, 8.5),
      bot.spawnZ + randomIn(-2.6, 2.6),
    );
    const scale = randomIn(0.34, 0.72);
    mesh.scale.set(scale, scale, 1);
    gfx.scene.add(mesh);

    state.particles.push({
      mesh,
      life: randomIn(0.9, 1.5),
      vy: randomIn(-3.8, -1.8),
      driftX: randomIn(-0.55, 0.55),
      driftZ: randomIn(-0.55, 0.55),
      binary: true,
      codeBit: true,
    });
  }
}

function explodeBike(entity) {
  if (!entity?.mesh) return;
  const voxelGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  const voxelCount = 28;
  for (let i = 0; i < voxelCount; i += 1) {
    const mesh = new THREE.Mesh(voxelGeo, neonMaterial(entity.color, 0.92));
    mesh.position.set(
      entity.x + randomIn(-0.5, 0.5),
      randomIn(0.25, 0.85),
      entity.z + randomIn(-0.5, 0.5),
    );
    gfx.scene.add(mesh);
    state.particles.push({
      mesh,
      life: randomIn(0.55, 1.05),
      vy: randomIn(1.0, 3.9),
      driftX: randomIn(-3.2, 3.2),
      driftZ: randomIn(-3.2, 3.2),
      spinX: randomIn(-9, 9),
      spinY: randomIn(-9, 9),
      spinZ: randomIn(-9, 9),
      gravity: 8.4,
      voxel: true,
      binary: false,
    });
  }
}

function activateOverload() {
  // Power-ups are disabled.
}

function respawnBot(bot) {
  bot.alive = true;
  bot.mesh.visible = true;
  bot.x = bot.spawnX;
  bot.z = bot.spawnZ;
  bot.dirIndex = bot.spawnDirIndex;
  bot.trailSamples = [{ ownerId: bot.id, owner: 'bot', x: bot.x, z: bot.z, bornAt: state.survived }];
  bot.trailPendingDist = 0;
  bot.trailDirty = true;
  bot.deadTimer = 0;
  bot.awaitingTrailClear = false;
  bot.pathMemory = [];
  bot.mesh.position.set(bot.x, 0.1, bot.z);
  bot.mesh.rotation.y = bot.dirIndex * (Math.PI / 2);
}

function updateEntities(dt) {

  const worldSpeed = (CONFIG.baseSpeed + state.survived * CONFIG.speedRamp) * state.speedMul;

  for (let i = 0; i < state.entities.length; i += 1) {
    const e = state.entities[i];
    if (!e.alive) {
      if (!e.isPlayer) {
        pruneAgedTrailSamples(e);
        if (e.awaitingTrailClear && e.trailSamples.length === 0) {
          emitRespawnEffect(e);
          respawnBot(e);
        }
      }
      continue;
    }
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

    if (checkCollision(e, prevX, prevZ, e.x, e.z)) {
      e.alive = false;
      explodeBike(e);
      e.mesh.visible = false;
      if (e.isPlayer) {
        playCrashSound();
      } else {
        e.awaitingTrailClear = true;
      }
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

  state.trails.length = 0;
  for (const e of state.entities) {
    pruneAgedTrailSamples(e);
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
    if (p.voxel) {
      p.vy -= (p.gravity || 0) * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.x += p.driftX * dt;
      p.mesh.position.z += p.driftZ * dt;
      p.mesh.rotation.x += (p.spinX || 0) * dt;
      p.mesh.rotation.y += (p.spinY || 0) * dt;
      p.mesh.rotation.z += (p.spinZ || 0) * dt;
    } else {
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.x += p.driftX * dt;
      p.mesh.position.z += p.driftZ * dt;
      if (p.binary) p.mesh.position.y += Math.sin(state.survived * 8) * dt * 0.12;
    }
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
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    saveProfile();
  }
  state.pixelTimer = Math.max(0, state.pixelTimer - dt);
  if (state.pixelTimer <= 0) canvas.classList.remove('power-effect');

  state.nextBotJoinMs -= dt * 1000;
  if (state.nextBotJoinMs <= 0) {
    spawnAdditionalBot();
    state.nextBotJoinMs = CONFIG.botJoinIntervalMs;
  }

  updateEntities(dt);
  updateNearMiss(dt);
  updatePowerups(dt);
  updateParticles(dt);
  updateCamera(dt);

  if (!player().alive) endGame();
}

function updateUi() {
  ui.playerName.textContent = state.playerName;
  ui.bestScore.textContent = Math.floor(state.bestScore).toString();
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
      if (p) {
        recolorEntity(p, style.color);
      }

      const usedBotColors = new Set();
      for (const bot of state.entities.filter((e) => !e.isPlayer)) {
        if (bot.color.toLowerCase() === style.color.toLowerCase() || usedBotColors.has(bot.color.toLowerCase())) {
          const newColor = pickUniqueBotColor(style.color, usedBotColors);
          recolorEntity(bot, newColor);
        } else {
          usedBotColors.add(bot.color.toLowerCase());
        }
      }

      renderTrailOptions();
    });

    ui.trailOptions.appendChild(btn);
  }
}

function render() {
  const pulse = 0.2 + Math.sin(state.survived * 2.5) * 0.06;
  gfx.floor.material.emissiveIntensity = pulse;
  if (gfx.bloomPass) gfx.bloomPass.strength = 0.85 + Math.min(0.8, state.speedMul * 0.18);
  if (gfx.chromaPass) gfx.chromaPass.uniforms.amount.value = 0.00075 + Math.min(0.003, state.speedMul * 0.00045);
  if (gfx.composer) {
    gfx.composer.render();
  } else {
    gfx.renderer.render(gfx.scene, gfx.camera);
  }
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
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    saveProfile();
  }
  document.body.classList.remove('game-active');
  ui.overlay.classList.remove('hidden');
  ui.overlayTitle.textContent = 'Run Ended';
  ui.overlayText.textContent = `${state.playerName} survived ${state.survived.toFixed(1)}s | Score ${Math.floor(state.score)} | Best ${Math.floor(state.bestScore)}. Press Space or Try Again.`;
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
ui.newPlayerBtn?.addEventListener('click', () => {
  const entered = window.prompt('Enter player name (max 20 chars):', state.playerName) || '';
  const name = entered.trim().slice(0, 20);
  if (!name) return;
  state.playerName = name;
  state.bestScore = 0;
  saveProfile();
  updateUi();
  ui.overlayText.textContent = `${state.playerName}, press Start Run to enter the grid.`;
});
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

const profile = loadProfile();
state.playerName = profile.name;
state.bestScore = profile.bestScore;

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
