const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

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
  botCount: 4,
  segmentSize: 5,
  baseSpeed: 150,
  speedRamp: 2.8,
  nearMissDistance: 16,
  powerupEveryMs: 5200,
};

const TRAIL_STYLES = [
  { id: 'cyan', label: 'Classic Cyan', unlock: 0, color: '#17f2ff', particle: 'spark' },
  { id: 'magenta', label: 'Magenta Surge', unlock: 80, color: '#ff2cc6', particle: 'spark' },
  { id: 'amber', label: 'Amber Binary', unlock: 180, color: '#ffbb33', particle: 'binary' },
  { id: 'void', label: 'Void Glitch', unlock: 320, color: '#9f7bff', particle: 'binary' },
];

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
  trails: [],
  particles: [],
  entities: [],
  selectedTrail: TRAIL_STYLES[0],
  unlockedTrailScore: 0,
};

const audio = {
  context: null,
  master: null,
  bass: null,
  pulse: null,
  beatTimer: null,
  active: false,
};

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.floor(bounds.width * window.devicePixelRatio);
  canvas.height = Math.floor(bounds.height * window.devicePixelRatio);
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
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

function createEntity(isPlayer, color) {
  const pad = 80;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  return {
    isPlayer,
    color,
    x: randomIn(pad, w - pad),
    y: randomIn(pad, h - pad),
    dir: randomDir(),
    alive: true,
    thinkTime: randomIn(0.1, 0.4),
    trailEvery: 0,
  };
}

function resetGame() {
  state.score = 0;
  state.survived = 0;
  state.speedMultiplier = 1;
  state.closeCallMultiplier = 1;
  state.nearMissCooldown = 0;
  state.phaseCharges = 0;
  state.overloadTimer = 0;
  state.overloadCooldown = 0;
  state.powerups = [];
  state.nextPowerup = CONFIG.powerupEveryMs;
  state.trails = [];
  state.particles = [];

  state.entities = [createEntity(true, state.selectedTrail.color)];
  for (let i = 0; i < CONFIG.botCount; i += 1) {
    const botColors = ['#ff2cc6', '#ff7c4d', '#54ff8c', '#8b7bff'];
    const bot = createEntity(false, botColors[i % botColors.length]);
    state.entities.push(bot);
  }
}

function isOpposite(a, b) {
  return a.x + b.x === 0 && a.y + b.y === 0;
}

function setPlayerDirection(target) {
  const player = state.entities[0];
  if (!player?.alive) return;
  if (!isOpposite(player.dir, target)) {
    player.dir = target;
  }
}

function setupControls() {
  window.addEventListener('keydown', (event) => {
    const map = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
    };

    if (map[event.key]) {
      event.preventDefault();
      setPlayerDirection(map[event.key]);
    }

    if (event.key.toLowerCase() === ' ') {
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

function addTrailPoint(entity) {
  state.trails.push({
    x: entity.x,
    y: entity.y,
    color: entity.color,
    owner: entity.isPlayer ? 'player' : 'bot',
  });

  const style = entity.isPlayer ? state.selectedTrail : { particle: 'spark', color: entity.color };
  if (Math.random() < 0.38) {
    state.particles.push({
      x: entity.x,
      y: entity.y,
      life: 0.6,
      text: style.particle === 'binary' ? (Math.random() > 0.5 ? '0' : '1') : null,
      color: style.color,
    });
  }
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function detectCollision(entity) {
  const margin = 6;
  if (entity.x < margin || entity.y < margin || entity.x > canvas.clientWidth - margin || entity.y > canvas.clientHeight - margin) {
    return true;
  }

  for (let i = 0; i < state.trails.length; i += 1) {
    const t = state.trails[i];
    if (distSq(entity, t) < 32) {
      return true;
    }
  }
  return false;
}

function awardNearMiss(dt) {
  if (state.nearMissCooldown > 0) {
    state.nearMissCooldown -= dt;
    return;
  }

  const player = state.entities[0];
  let close = false;
  const nearSq = CONFIG.nearMissDistance * CONFIG.nearMissDistance;

  for (let i = 0; i < state.trails.length; i += 1) {
    const trail = state.trails[i];
    if (trail.owner === 'player') continue;
    const d = distSq(player, trail);
    if (d < nearSq && d > 48) {
      close = true;
      break;
    }
  }

  if (close) {
    state.closeCallMultiplier = Math.min(5, state.closeCallMultiplier + 0.25);
    state.speedMultiplier = Math.min(2.8, state.speedMultiplier + 0.03);
    state.score += 8 * state.closeCallMultiplier;
    state.nearMissCooldown = 0.35;
    pulseSynth(320, 0.05);
  } else {
    state.closeCallMultiplier = Math.max(1, state.closeCallMultiplier - dt * 0.12);
  }
}

function spawnPowerup() {
  const types = ['phase', 'overload'];
  state.powerups.push({
    type: types[Math.floor(Math.random() * types.length)],
    x: randomIn(40, canvas.clientWidth - 40),
    y: randomIn(40, canvas.clientHeight - 40),
    ttl: 10,
  });
}

function activateOverload() {
  if (state.overloadCooldown > 0 || state.overloadTimer > 0) return;
  state.overloadTimer = 3.8;
  state.overloadCooldown = 10;
  pulseSynth(180, 0.1);
}

function handlePowerupPickup() {
  const player = state.entities[0];
  state.powerups = state.powerups.filter((p) => {
    p.ttl -= 1 / 60;
    if (p.ttl <= 0) return false;
    if (distSq(player, p) < 360) {
      if (p.type === 'phase') {
        state.phaseCharges += 1;
      } else {
        state.overloadCooldown = Math.max(0, state.overloadCooldown - 5);
        state.overloadTimer = 2.6;
      }
      state.score += 40;
      pulseSynth(480, 0.08);
      return false;
    }
    return true;
  });
}

function aiTurn(bot, dt) {
  bot.thinkTime -= dt;
  if (bot.thinkTime > 0) return;
  bot.thinkTime = randomIn(0.08, 0.3);

  const options = [
    cloneDir(bot.dir),
    { x: bot.dir.y, y: -bot.dir.x },
    { x: -bot.dir.y, y: bot.dir.x },
  ];

  let best = options[0];
  let bestScore = -Infinity;

  options.forEach((dir) => {
    if (isOpposite(bot.dir, dir)) return;
    const probe = { x: bot.x + dir.x * 28, y: bot.y + dir.y * 28 };
    let score = randomIn(0, 10);

    if (probe.x < 20 || probe.y < 20 || probe.x > canvas.clientWidth - 20 || probe.y > canvas.clientHeight - 20) {
      score -= 100;
    }

    for (let i = 0; i < state.trails.length; i += 1) {
      if (distSq(probe, state.trails[i]) < 540) {
        score -= 60;
      }
    }

    const player = state.entities[0];
    const pressureSpot = { x: player.x + player.dir.x * 40, y: player.y + player.dir.y * 40 };
    score += Math.max(0, 180 - distSq(probe, pressureSpot) * 0.02);

    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  });

  bot.dir = best;
}

function updateEntities(dt) {
  const overloadFactor = state.overloadTimer > 0 ? 0.45 : 1;
  const base = CONFIG.baseSpeed + state.survived * CONFIG.speedRamp;

  state.entities.forEach((entity, index) => {
    if (!entity.alive) return;

    if (!entity.isPlayer) {
      aiTurn(entity, dt * overloadFactor);
    }

    const speed = entity.isPlayer
      ? base * state.speedMultiplier
      : base * randomIn(0.88, 1.04) * overloadFactor;

    entity.x += entity.dir.x * speed * dt;
    entity.y += entity.dir.y * speed * dt;

    entity.trailEvery -= dt;
    if (entity.trailEvery <= 0) {
      entity.trailEvery = CONFIG.segmentSize / Math.max(speed, 1);
      addTrailPoint(entity);
    }

    if (detectCollision(entity)) {
      if (index === 0 && state.phaseCharges > 0) {
        state.phaseCharges -= 1;
        entity.x += entity.dir.x * 20;
        entity.y += entity.dir.y * 20;
        pulseSynth(560, 0.08);
      } else {
        entity.alive = false;
      }
    }
  });

  state.trails = state.trails.slice(-3000);
}

function updateParticles(dt) {
  state.particles.forEach((p) => {
    p.life -= dt;
    p.y += 18 * dt;
  });
  state.particles = state.particles.filter((p) => p.life > 0);
}

function drawGrid() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const step = 32;
  ctx.strokeStyle = 'rgba(28, 122, 163, 0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function render() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);
  drawGrid();

  state.trails.forEach((trail) => {
    ctx.fillStyle = trail.color;
    ctx.shadowColor = trail.color;
    ctx.shadowBlur = 12;
    ctx.fillRect(trail.x - 2, trail.y - 2, 4, 4);
  });

  state.powerups.forEach((p) => {
    const color = p.type === 'phase' ? '#8dffef' : '#ff8ae4';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.stroke();
  });

  state.entities.forEach((e) => {
    if (!e.alive) return;
    ctx.fillStyle = e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 18;
    ctx.fillRect(e.x - 6, e.y - 6, 12, 12);
  });

  state.particles.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life / 0.6);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    if (p.text) {
      ctx.font = '12px monospace';
      ctx.fillText(p.text, p.x, p.y);
    } else {
      ctx.fillRect(p.x, p.y, 2, 2);
    }
  });
  ctx.globalAlpha = 1;
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
  TRAIL_STYLES.forEach((style) => {
    const unlocked = state.unlockedTrailScore >= style.unlock;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = unlocked ? style.label : `${style.label} (${style.unlock})`;
    button.disabled = !unlocked;
    if (state.selectedTrail.id === style.id) {
      button.classList.add('active');
    }
    button.addEventListener('click', () => {
      state.selectedTrail = style;
      if (state.entities[0]) {
        state.entities[0].color = style.color;
      }
      renderTrailOptions();
    });
    ui.trailOptions.appendChild(button);
  });
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

  handlePowerupPickup();
  awardNearMiss(dt);
  updateEntities(dt);
  updateParticles(dt);
  render();
  updateUi();
  syncAudio();

  if (!state.entities[0].alive) {
    endGame();
    return;
  }

  requestAnimationFrame(loop);
}

function endGame() {
  state.running = false;
  ui.overlay.classList.remove('hidden');
  ui.overlayTitle.textContent = 'Run Ended';
  ui.overlayText.textContent = `You lasted ${state.survived.toFixed(1)}s with ${Math.floor(state.score)} points.`;
  ui.startBtn.textContent = 'Try Again';
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
  audio.pulse = bassGain;
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
  if (audio.context.state === 'suspended') {
    await audio.context.resume();
  }
  audio.active = !audio.active;
  if (audio.active) {
    scheduleBeat();
    ui.audioBtn.textContent = 'Mute Audio';
  } else {
    if (audio.beatTimer) clearTimeout(audio.beatTimer);
    ui.audioBtn.textContent = 'Start Audio';
  }
});

window.addEventListener('resize', resizeCanvas);

resizeCanvas();
setupControls();
renderTrailOptions();
resetGame();
render();
updateUi();
