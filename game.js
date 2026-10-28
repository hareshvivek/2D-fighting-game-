/**
 * ============================================================================
 * 2D SHOWDOWN - TOP-DOWN BATTLEGROUND FOUNDATION (COMBAT EXPANSION)
 * ============================================================================
 * Lead Developer Architecture
 *
 * Modules:
 *  1. CONFIG & SETTINGS       - Centralized tuning (reduced speed, dashes, combat)
 *  2. INPUT HANDLER           - Keyboard & Right-Click M1 punch, F block, Q dash
 *  3. FLOATING TEXT & PARTICLES - Combat damage text, block sparks, dash streaks
 *  4. CAMERA                  - Smooth lerp following, view culling & DPR scaling
 *  5. WORLD & ARENA           - Terrain, boundary collision & obstacle sliding
 *  6. FIGHTER ENTITY          - Unified player & dummy stats, states, animations & HP
 *  7. COMBAT SYSTEM           - Hit detection, 4-hit combo, 180° block, dash strikes
 *  8. GAME ENGINE             - Main loop, depth-sorted (Y-sort) rendering pipeline
 * ============================================================================
 */

'use strict';

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================
const CONFIG = {
  // World dimensions (pixels)
  world: {
    width: 2600,
    height: 2600,
    arenaRadius: 1050, // Central combat arena circle
  },

  // Fighter physics and normal movement
  player: {
    radius: 26,           // Collision body radius
    baseSpeed: 186,       // Normal movement speed reduced by 25% from 248 (px/sec)
    acceleration: 1500,   // Rate of acceleration (px/sec^2)
    friction: 11.5,       // Damping deceleration factor
    turnSpeed: 14.0,      // Facing direction lerp speed
    attackSpeedMult: 0.38,// Movement speed multiplier while punching
    blockSpeedMult: 0.38, // Movement speed multiplier while blocking (same as punching)
  },

  // Combat parameters
  combat: {
    maxHealth: 100,

    // 4-hit M1 combo tuning
    comboChainWindow: 1.0,    // Seconds allowed to chain next punch
    comboExpireTimer: 4.0,    // Reset combo counter after 4 seconds of inactivity
    punchAttackDelay: 0.12,   // Proper attack delay between punches to prevent spamming
    punches: [
      { id: 1, damage: 3, stunDuration: 1.0, range: 18, windup: 0.08, active: 0.12, recovery: 0.15 },
      { id: 2, damage: 3, stunDuration: 1.0, range: 18, windup: 0.08, active: 0.12, recovery: 0.15 },
      { id: 3, damage: 3, stunDuration: 1.0, range: 18, windup: 0.08, active: 0.12, recovery: 0.15 },
      { id: 4, damage: 4, stunDuration: 0.5, range: 20, windup: 0.09, active: 0.14, recovery: 0.28, knockback: 1092 } // +30% from 840
    ],

    // Blocking rules
    blockAngleThreshold: 0.0,   // cos(angle) >= 0.0 represents front 180 degrees
    blockStaggerDuration: 0.32, // Recovery freeze on attacker when M1 blocked
    blockHitDashLock: 0.5,      // Seconds the attacker cannot start a dash after hitting a block
    blockHitSpeedMult: 0.25,    // Speed multiplier applied to attacker for blockHitDashLock duration

    // Dash tuning
    forwardDash: {
      speed: 720,             // px/sec (longer & faster)
      duration: 0.36,         // seconds (travels ~260px)
      cooldown: 8.0,          // 8-second cooldown
      damage: 5,              // Damage on connecting strike
      stunDuration: 0.85,     // Stun duration on hit
      missRecovery: 0.38,     // Punishable recovery on whiff
      perfectBlockStun: 1.25, // Stun on attacker when blocked by generous guard
      range: 58,
    },
    sideDash: {
      speed: 520,             // px/sec
      duration: 0.25,         // seconds (travels ~130px, approx half forward)
      cooldown: 5.0,          // 5-second cooldown
    },
    backDash: {
      speed: 520,             // px/sec
      duration: 0.25,         // seconds (travels ~130px, approx half forward)
      cooldown: 5.0,          // 5-second cooldown
    }
  },

  // Camera settings
  camera: {
    lerpFactor: 0.1,
  },

  // Visuals & Effects
  visuals: {
    maxParticles: 120,
    maxFloatingTexts: 30,
  }
};

// ============================================================================
// 2. INPUT HANDLER (WASD, Left-Click M1, F Block, Q Dash, Shift Lock-On, R Reset)
// ============================================================================
class InputHandler {
  constructor() {
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false,
      block: false,       // F key held
    };

    // One-shot action triggers (consumed in game loop update)
    this.m1Triggered = false;     // Left-click / Space single attack trigger
    this.dashTriggered = false;   // Q key trigger
    this.resetTriggered = false;  // R key trigger
    this.lockOnTriggered = false; // Shift key toggle trigger

    this.isLeftMouseDown = false; // Prevent auto-repeat while holding left mouse button
    this.isSpaceDown = false;     // Prevent auto-repeat while holding Space

    // DOM UI bindings
    this.keyElements = {
      w: document.getElementById('keyW'),
      a: document.getElementById('keyA'),
      s: document.getElementById('keyS'),
      d: document.getElementById('keyD'),
      f: document.getElementById('keyF'),
      q: document.getElementById('keyQ'),
      keyShift: document.getElementById('keyShift'),
      lockOnStatus: document.getElementById('lockOnStatus'),
      m1: document.getElementById('m1Badge'),
      comboLabel: document.getElementById('comboCounterLabel'),
      fwdCdVal: document.getElementById('fwdCdVal'),
      fwdCdBadge: document.getElementById('fwdCdBadge'),
      sideCdVal: document.getElementById('sideCdVal'),
      sideCdBadge: document.getElementById('sideCdBadge'),
      backCdVal: document.getElementById('backCdVal'),
      backCdBadge: document.getElementById('backCdBadge'),
    };

    this.bindEvents();
  }

  bindEvents() {
    // 1. Keyboard listeners
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    // 2. Disable default browser right-click context menu
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    // 3. Mouse listeners (Left click = button 0)
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (!this.isLeftMouseDown) {
          this.m1Triggered = true; // One-shot trigger
          this.isLeftMouseDown = true;
          if (this.keyElements.m1) this.keyElements.m1.classList.add('active');
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isLeftMouseDown = false;
        if (this.keyElements.m1) this.keyElements.m1.classList.remove('active');
      }
    });

    // 4. Reset Button listener on HUD
    const resetBtn = document.getElementById('resetDummyBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetTriggered = true;
      });
    }

    // 5. Blur event cleanup
    window.addEventListener('blur', () => this.reset());
  }

  onKeyDown(e) {
    const key = e.key.toLowerCase();

    // Prevent scrolling for navigation keys
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
      e.preventDefault();
    }

    // Space bar M1 (one-shot, no repeat)
    if (key === ' ' && !e.repeat && !this.isSpaceDown) {
      this.isSpaceDown = true;
      this.m1Triggered = true;
      if (this.keyElements.m1) this.keyElements.m1.classList.add('active');
    }

    switch (key) {
      case 'w':
      case 'arrowup':
        this.keys.up = true;
        if (this.keyElements.w) this.keyElements.w.classList.add('active');
        break;
      case 's':
      case 'arrowdown':
        this.keys.down = true;
        if (this.keyElements.s) this.keyElements.s.classList.add('active');
        break;
      case 'a':
      case 'arrowleft':
        this.keys.left = true;
        if (this.keyElements.a) this.keyElements.a.classList.add('active');
        break;
      case 'd':
      case 'arrowright':
        this.keys.right = true;
        if (this.keyElements.d) this.keyElements.d.classList.add('active');
        break;
      case 'f':
        this.keys.block = true;
        if (this.keyElements.f) this.keyElements.f.classList.add('active');
        break;
      case 'q':
        if (!e.repeat) {
          this.dashTriggered = true;
          if (this.keyElements.q) this.keyElements.q.classList.add('active');
        }
        break;
      case 'shift':
        if (!e.repeat) {
          this.lockOnTriggered = true;
        }
        break;
      case 'r':
        if (!e.repeat) {
          this.resetTriggered = true;
        }
        break;
    }
  }

  onKeyUp(e) {
    const key = e.key.toLowerCase();
    switch (key) {
      case 'w':
      case 'arrowup':
        this.keys.up = false;
        if (this.keyElements.w) this.keyElements.w.classList.remove('active');
        break;
      case 's':
      case 'arrowdown':
        this.keys.down = false;
        if (this.keyElements.s) this.keyElements.s.classList.remove('active');
        break;
      case 'a':
      case 'arrowleft':
        this.keys.left = false;
        if (this.keyElements.a) this.keyElements.a.classList.remove('active');
        break;
      case 'd':
      case 'arrowright':
        this.keys.right = false;
        if (this.keyElements.d) this.keyElements.d.classList.remove('active');
        break;
      case 'f':
        this.keys.block = false;
        if (this.keyElements.f) this.keyElements.f.classList.remove('active');
        break;
      case 'q':
        if (this.keyElements.q) this.keyElements.q.classList.remove('active');
        break;
      case ' ':
        this.isSpaceDown = false;
        if (this.keyElements.m1) this.keyElements.m1.classList.remove('active');
        break;
    }
  }

  reset() {
    this.keys.up = false;
    this.keys.down = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.block = false;
    this.m1Triggered = false;
    this.dashTriggered = false;
    this.resetTriggered = false;
    this.lockOnTriggered = false;
    this.isLeftMouseDown = false;
    this.isSpaceDown = false;
    ['w', 'a', 's', 'd', 'f', 'q', 'm1', 'keyShift'].forEach((k) => {
      if (this.keyElements[k]) this.keyElements[k].classList.remove('active');
    });
  }

  /**
   * Returns normalized movement vector [dx, dy]
   */
  getMovementVector() {
    let dx = 0;
    let dy = 0;

    if (this.keys.up) dy -= 1;
    if (this.keys.down) dy += 1;
    if (this.keys.left) dx -= 1;
    if (this.keys.right) dx += 1;

    if (dx !== 0 && dy !== 0) {
      const invMag = 1 / Math.SQRT2; // ~0.7071
      dx *= invMag;
      dy *= invMag;
    }

    return { dx, dy };
  }

  /**
   * Consume and return one-shot triggers
   */
  consumeM1() {
    const val = this.m1Triggered;
    this.m1Triggered = false;
    return val;
  }

  consumeDash() {
    const val = this.dashTriggered;
    this.dashTriggered = false;
    return val;
  }

  consumeReset() {
    const val = this.resetTriggered;
    this.resetTriggered = false;
    return val;
  }

  consumeLockOn() {
    const val = this.lockOnTriggered;
    this.lockOnTriggered = false;
    return val;
  }

  updateHUD(player) {
    if (!player) return;

    // 1. Lock-On Indicator
    if (this.keyElements.lockOnStatus) {
      if (player.isLockedOn && player.lockOnTarget && !player.lockOnTarget.isDefeated) {
        this.keyElements.lockOnStatus.textContent = 'LOCKED';
        this.keyElements.lockOnStatus.style.color = '#38ef7d';
        if (this.keyElements.keyShift) this.keyElements.keyShift.classList.add('active');
      } else {
        this.keyElements.lockOnStatus.textContent = 'OFF';
        this.keyElements.lockOnStatus.style.color = '#8fae96';
        if (this.keyElements.keyShift) this.keyElements.keyShift.classList.remove('active');
      }
    }

    // 2. Combo Indicator
    if (this.keyElements.comboLabel) {
      if (player.comboIndex > 0) {
        this.keyElements.comboLabel.textContent = `Hit ${player.comboIndex} / 4`;
        this.keyElements.comboLabel.style.color = '#38ef7d';
      } else {
        this.keyElements.comboLabel.textContent = '4-Hit (13 Dmg)';
        this.keyElements.comboLabel.style.color = '#8fae96';
      }
    }

    // 3. Dash Cooldown Badges
    const updateCdBadge = (cdVal, badgeEl, textEl) => {
      if (!badgeEl || !textEl) return;
      if (cdVal > 0) {
        badgeEl.classList.add('on-cd');
        textEl.textContent = `${cdVal.toFixed(1)}s`;
      } else {
        badgeEl.classList.remove('on-cd');
        textEl.textContent = 'RDY';
      }
    };

    updateCdBadge(player.dashCooldowns.forward, this.keyElements.fwdCdBadge, this.keyElements.fwdCdVal);
    updateCdBadge(player.dashCooldowns.side, this.keyElements.sideCdBadge, this.keyElements.sideCdVal);
    updateCdBadge(player.dashCooldowns.back, this.keyElements.backCdBadge, this.keyElements.backCdVal);
  }
}

// ============================================================================
// 3. FLOATING COMBAT TEXT & PARTICLES
// ============================================================================
class FloatingTextSystem {
  constructor() {
    this.texts = [];
  }

  spawn(x, y, text, color = '#ff4d4d', fontSize = 16, duration = 0.9) {
    if (this.texts.length >= CONFIG.visuals.maxFloatingTexts) {
      this.texts.shift();
    }
    this.texts.push({
      x: x + (Math.random() - 0.5) * 16,
      y: y - 10,
      vy: -45, // Drift upward
      text,
      color,
      fontSize,
      life: 0,
      duration,
      alpha: 1.0,
    });
  }

  update(dt) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const item = this.texts[i];
      item.life += dt;
      if (item.life >= item.duration) {
        this.texts.splice(i, 1);
        continue;
      }
      item.y += item.vy * dt;
      item.vy *= 0.94; // Decelerate upward drift
      const progress = item.life / item.duration;
      item.alpha = Math.max(0, 1 - progress * progress);
    }
  }

  render(ctx, camera) {
    ctx.save();
    for (const item of this.texts) {
      if (!camera.isInView(item.x, item.y, 40)) continue;

      ctx.font = `800 ${item.fontSize}px 'Outfit', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Drop shadow for legibility
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = `rgba(0, 0, 0, ${item.alpha * 0.75})`;
      ctx.fillText(item.text, item.x, item.y + 1);

      // Text Fill
      ctx.fillStyle = item.color.replace(')', `, ${item.alpha})`).replace('rgb', 'rgba');
      ctx.fillText(item.text, item.x, item.y);
    }
    ctx.restore();
  }
}

class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  emitDust(x, y, angle) {
    if (this.particles.length >= CONFIG.visuals.maxParticles) return;
    const speed = 20 + Math.random() * 40;
    const spread = (Math.random() - 0.5) * 1.2;
    const dustAngle = angle + Math.PI + spread;

    this.particles.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(dustAngle) * speed,
      vy: Math.sin(dustAngle) * speed,
      radius: 3 + Math.random() * 4,
      alpha: 0.45,
      maxLife: 0.35 + Math.random() * 0.25,
      life: 0,
      color: 'rgba(165, 185, 145, ',
    });
  }

  emitHitSparks(x, y, count = 10, isBlock = false) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= CONFIG.visuals.maxParticles) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 140;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: isBlock ? 2.5 + Math.random() * 3 : 2 + Math.random() * 3,
        alpha: 0.9,
        maxLife: 0.2 + Math.random() * 0.2,
        life: 0,
        color: isBlock ? 'rgba(74, 222, 128, ' : 'rgba(255, 120, 60, ',
      });
    }
  }

  emitAmbientForestMote(worldWidth, worldHeight) {
    if (this.particles.length >= CONFIG.visuals.maxParticles) return;
    this.particles.push({
      x: Math.random() * worldWidth,
      y: Math.random() * worldHeight,
      vx: (Math.random() - 0.5) * 15,
      vy: -10 - Math.random() * 15,
      radius: 1.5 + Math.random() * 2,
      alpha: 0.2 + Math.random() * 0.3,
      maxLife: 3.5 + Math.random() * 3,
      life: 0,
      isAmbient: true,
      color: Math.random() > 0.4 ? 'rgba(180, 240, 160, ' : 'rgba(235, 220, 150, ',
    });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }

  render(ctx, camera) {
    ctx.save();
    for (const p of this.particles) {
      if (!camera.isInView(p.x, p.y, p.radius * 2)) continue;

      const progress = p.life / p.maxLife;
      const currentAlpha = p.alpha * (1 - progress);

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (p.isAmbient ? 1 : 1 + progress * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = `${p.color}${Math.max(0, currentAlpha)})`;
      ctx.fill();
    }
    ctx.restore();
  }
}

// ============================================================================
// 4. CAMERA
// ============================================================================
class Camera {
  constructor(viewportWidth, viewportHeight) {
    this.x = CONFIG.world.width / 2;
    this.y = CONFIG.world.height / 2;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.targetX = this.x;
    this.targetY = this.y;
  }

  resize(viewportWidth, viewportHeight) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
  }

  update(targetX, targetY, dt) {
    this.targetX = targetX;
    this.targetY = targetY;

    const t = 1 - Math.exp(-CONFIG.camera.lerpFactor * 60 * dt);
    this.x += (this.targetX - this.x) * t;
    this.y += (this.targetY - this.y) * t;

    const halfW = this.viewportWidth / 2;
    const halfH = this.viewportHeight / 2;

    if (this.viewportWidth < CONFIG.world.width) {
      this.x = Math.max(halfW, Math.min(CONFIG.world.width - halfW, this.x));
    } else {
      this.x = CONFIG.world.width / 2;
    }

    if (this.viewportHeight < CONFIG.world.height) {
      this.y = Math.max(halfH, Math.min(CONFIG.world.height - halfH, this.y));
    } else {
      this.y = CONFIG.world.height / 2;
    }
  }

  applyTransform(ctx) {
    ctx.save();
    ctx.translate(
      Math.floor(this.viewportWidth / 2 - this.x),
      Math.floor(this.viewportHeight / 2 - this.y)
    );
  }

  restoreTransform(ctx) {
    ctx.restore();
  }

  isInView(x, y, radius = 0) {
    const left = this.x - this.viewportWidth / 2 - radius;
    const right = this.x + this.viewportWidth / 2 + radius;
    const top = this.y - this.viewportHeight / 2 - radius;
    const bottom = this.y + this.viewportHeight / 2 + radius;
    return x >= left && x <= right && y >= top && y <= bottom;
  }
}

// ============================================================================
// 5. WORLD & ARENA (Ground, Boundaries, Trees, Rocks, Obstacle Slide)
// ============================================================================
class ArenaWorld {
  constructor() {
    this.width = CONFIG.world.width;
    this.height = CONFIG.world.height;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = CONFIG.world.arenaRadius;

    this.trees = [];
    this.rocks = [];
    this.bushes = [];
    this.boundaryStones = [];
    this.fallenLogs = [];
    this.ruins = [];

    this.groundCanvas = document.createElement('canvas');
    this.groundCtx = this.groundCanvas.getContext('2d');

    this.initWorld();
  }

  initWorld() {
    this.generateDecorations();
    this.preRenderGround();
  }

  seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  generateDecorations() {
    const rand = this.seededRandom(42918);

    // 1. Boundary monoliths
    const stoneCount = 36;
    for (let i = 0; i < stoneCount; i++) {
      const angle = (i / stoneCount) * Math.PI * 2;
      const dist = this.radius;
      this.boundaryStones.push({
        x: this.centerX + Math.cos(angle) * dist,
        y: this.centerY + Math.sin(angle) * dist,
        radius: 20,
      });
    }

    // Helper to generate irregular tree canopy lobes
    const createTreeLobes = (baseRadius) => {
      const lobeCount = 14;
      const lobes = [];
      for (let i = 0; i < lobeCount; i++) {
        const a = (i / lobeCount) * Math.PI * 2;
        // Irregular radius offset for illustrated organic look
        const rMult = 0.82 + rand() * 0.36;
        lobes.push({
          angle: a,
          radius: baseRadius * rMult,
          subLobeRadius: baseRadius * (0.32 + rand() * 0.18),
        });
      }
      return lobes;
    };

    // 2. Inner trees (scattered in the outer clearing, away from central ring)
    const innerTreeCount = 14;
    for (let i = 0; i < innerTreeCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 380 + rand() * 500;
      const canopyRadius = 68 + rand() * 26;
      this.trees.push({
        x: this.centerX + Math.cos(angle) * dist,
        y: this.centerY + Math.sin(angle) * dist,
        collisionRadius: 28,
        canopyRadius: canopyRadius,
        shade: 0.8 + rand() * 0.4,
        seed: Math.floor(rand() * 100000),
        lobes: createTreeLobes(canopyRadius),
        trunkThickness: 14 + rand() * 6,
        species: rand() > 0.35 ? 'oak' : 'pine',
      });
    }

    // 3. Outer perimeter trees (dense forest frame)
    const outerTreeCount = 85;
    for (let i = 0; i < outerTreeCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = this.radius + 60 + rand() * 200;
      const canopyRadius = 78 + rand() * 32;
      this.trees.push({
        x: this.centerX + Math.cos(angle) * dist,
        y: this.centerY + Math.sin(angle) * dist,
        collisionRadius: 32,
        canopyRadius: canopyRadius,
        shade: 0.7 + rand() * 0.4,
        seed: Math.floor(rand() * 100000),
        lobes: createTreeLobes(canopyRadius),
        trunkThickness: 16 + rand() * 6,
        species: rand() > 0.35 ? 'oak' : 'pine',
      });
    }

    // 4. Faceted Boulders with irregular polygonal geometry
    const rockCount = 16;
    for (let i = 0; i < rockCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 320 + rand() * 600;
      const baseRadius = 24 + rand() * 14;

      // Generate 8 polygonal vertices with irregular angles and radii
      const vertCount = 8;
      const vertices = [];
      for (let v = 0; v < vertCount; v++) {
        const va = (v / vertCount) * Math.PI * 2 + (rand() - 0.5) * 0.25;
        const vr = baseRadius * (0.76 + rand() * 0.42);
        vertices.push({
          x: Math.cos(va) * vr,
          y: Math.sin(va) * vr * 0.76,
        });
      }

      this.rocks.push({
        x: this.centerX + Math.cos(angle) * dist,
        y: this.centerY + Math.sin(angle) * dist,
        radius: baseRadius,
        rotation: rand() * Math.PI * 2,
        mossiness: 0.2 + rand() * 0.7,
        vertices: vertices,
        ridgeX: (rand() - 0.5) * baseRadius * 0.4,
        ridgeY: (rand() - 0.5) * baseRadius * 0.3,
      });
    }

    // 5. Multi-lobed Illustrated Bushes
    const bushCount = 28;
    for (let i = 0; i < bushCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 220 + rand() * 800;
      const baseRadius = 22 + rand() * 16;
      const lobeCount = 6 + Math.floor(rand() * 3);
      const lobes = [];
      for (let b = 0; b < lobeCount; b++) {
        const ba = (b / lobeCount) * Math.PI * 2;
        lobes.push({
          x: Math.cos(ba) * baseRadius * 0.48,
          y: Math.sin(ba) * baseRadius * 0.38,
          r: baseRadius * (0.45 + rand() * 0.22),
        });
      }

      this.bushes.push({
        x: this.centerX + Math.cos(angle) * dist,
        y: this.centerY + Math.sin(angle) * dist,
        radius: baseRadius,
        colorShade: rand(),
        lobes: lobes,
      });
    }

    // 6. Fallen Broken Trees (Weathered Mossy Trunks & Splintered Stumps)
    this.fallenLogs = [
      {
        x: this.centerX - 340,
        y: this.centerY + 210,
        length: 105,
        angle: 0.38,
        thickness: 18,
        bracketFungi: [
          { t: 0.3, side: -1, size: 9 },
          { t: 0.55, side: -1, size: 12 },
          { t: 0.75, side: 1, size: 8 },
        ],
      },
      {
        x: this.centerX + 360,
        y: this.centerY - 220,
        length: 115,
        angle: -0.62,
        thickness: 20,
        bracketFungi: [
          { t: 0.25, side: 1, size: 10 },
          { t: 0.45, side: -1, size: 11 },
          { t: 0.7, side: -1, size: 8 },
        ],
      },
      {
        x: this.centerX - 180,
        y: this.centerY - 420,
        length: 90,
        angle: 0.85,
        thickness: 16,
        bracketFungi: [
          { t: 0.4, side: -1, size: 9 },
          { t: 0.65, side: 1, size: 7 },
        ],
      },
      {
        x: this.centerX + 260,
        y: this.centerY + 380,
        length: 100,
        angle: -0.22,
        thickness: 18,
        bracketFungi: [
          { t: 0.35, side: 1, size: 11 },
          { t: 0.6, side: 1, size: 9 },
        ],
      },
    ];

    // 7. Ancient Ruins (Decorative Historical Set Pieces)
    this.ruins = [
      {
        type: 'arch',
        x: this.centerX + 480,
        y: this.centerY - 320,
        radius: 45,
      },
      {
        type: 'column',
        x: this.centerX - 460,
        y: this.centerY + 290,
        radius: 35,
        angle: 0.42,
      },
      {
        type: 'plinth',
        x: this.centerX + 440,
        y: this.centerY + 360,
        radius: 36,
      },
      {
        type: 'wall',
        x: this.centerX - 380,
        y: this.centerY - 450,
        radius: 48,
        angle: -0.25,
      },
    ];
  }

  preRenderGround() {
    this.groundCanvas.width = this.width;
    this.groundCanvas.height = this.height;
    const ctx = this.groundCtx;
    const rand = this.seededRandom(77123);

    // 1. Deep forest base fill
    ctx.fillStyle = '#0e1b11';
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. Outer dense canopy & forest understory gradient
    const outerGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, this.radius * 0.65,
      this.centerX, this.centerY, this.radius * 1.35
    );
    outerGrad.addColorStop(0, '#1f3a25');
    outerGrad.addColorStop(0.55, '#162b1a');
    outerGrad.addColorStop(0.85, '#101d13');
    outerGrad.addColorStop(1, '#09110a');
    ctx.fillStyle = outerGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // 3. Main Arena Meadow Floor (multi-tonal lush forest grass)
    const meadowGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 60,
      this.centerX, this.centerY, this.radius
    );
    meadowGrad.addColorStop(0, '#3e6a43');    // vibrant sunlit center clearing
    meadowGrad.addColorStop(0.35, '#355c3a'); // rich meadow green
    meadowGrad.addColorStop(0.68, '#2a4c2f'); // mossy forest floor
    meadowGrad.addColorStop(0.90, '#203c24'); // shaded woodland boundary
    meadowGrad.addColorStop(1.0, '#142617');  // perimeter shade

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = meadowGrad;
    ctx.fill();

    // 4. WATER FEATURE 1: Northwest Woodland Pond
    const pondX = this.centerX - 440;
    const pondY = this.centerY - 360;
    ctx.save();
    // A. Sandy/Muddy Shoreline Fringe
    ctx.beginPath();
    ctx.ellipse(pondX, pondY, 155, 105, -0.32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(52, 48, 32, 0.45)';
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#2b2a1c';
    ctx.stroke();

    // B. Water Body with Depth Gradient
    const pondGrad = ctx.createRadialGradient(pondX - 15, pondY - 10, 20, pondX, pondY, 140);
    pondGrad.addColorStop(0, '#09241b');              // deep abyss
    pondGrad.addColorStop(0.55, '#133e32');            // emerald depth
    pondGrad.addColorStop(0.88, 'rgba(28, 82, 68, 0.85)'); // clear shallows
    pondGrad.addColorStop(1.0, 'rgba(40, 108, 90, 0.55)');

    ctx.beginPath();
    ctx.ellipse(pondX, pondY, 142, 92, -0.32, 0, Math.PI * 2);
    ctx.fillStyle = pondGrad;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(110, 220, 185, 0.35)';
    ctx.stroke();

    // C. Submerged River Rocks visible through water
    const subRocks = [
      { x: pondX - 55, y: pondY - 20, r: 12 },
      { x: pondX + 45, y: pondY + 15, r: 15 },
      { x: pondX - 10, y: pondY + 35, r: 11 },
    ];
    for (const sr of subRocks) {
      ctx.beginPath();
      ctx.arc(sr.x, sr.y, sr.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(25, 45, 36, 0.7)';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(56, 120, 95, 0.4)';
      ctx.stroke();
    }

    // D. Water Lily Pads with Lotus Blossoms
    const lilyPads = [
      { x: pondX - 35, y: pondY - 15, r: 9, hasFlower: true },
      { x: pondX - 20, y: pondY - 24, r: 7, hasFlower: false },
      { x: pondX + 25, y: pondY - 10, r: 10, hasFlower: true },
      { x: pondX + 38, y: pondY - 22, r: 8, hasFlower: false },
      { x: pondX + 15, y: pondY + 22, r: 9, hasFlower: false },
      { x: pondX - 45, y: pondY + 18, r: 8, hasFlower: true },
    ];
    for (const lp of lilyPads) {
      // Lily pad disc with notch
      ctx.beginPath();
      ctx.arc(lp.x, lp.y, lp.r, 0.25, Math.PI * 1.85);
      ctx.lineTo(lp.x, lp.y);
      ctx.closePath();
      ctx.fillStyle = '#2d6d42';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#43995f';
      ctx.stroke();

      // Delicate pink/white lotus flower
      if (lp.hasFlower) {
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#fce7f3';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
      }
    }

    // E. Concentric Water Ripples
    ctx.strokeStyle = 'rgba(175, 235, 215, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pondX + 5, pondY - 8, 38, 0.2, Math.PI * 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pondX - 25, pondY + 10, 26, 0.8, Math.PI * 2.2);
    ctx.stroke();

    // F. Shoreline Reeds / Cattails
    for (let r = 0; r < 7; r++) {
      const rx = pondX - 110 + r * 14 + (rand() - 0.5) * 6;
      const ry = pondY - 45 + (r % 3) * 8;
      ctx.strokeStyle = '#3d6c38';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.quadraticCurveTo(rx - 4, ry - 14, rx - 2, ry - 24);
      ctx.stroke();
      // Cattail head
      ctx.fillStyle = '#5c3d25';
      ctx.beginPath();
      ctx.ellipse(rx - 3, ry - 18, 2, 5, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5. WATER FEATURE 2: Southeast Winding Forest Creek / Stream
    ctx.save();
    ctx.lineWidth = 26;
    ctx.strokeStyle = '#27291a'; // muddy stream bed
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.centerX + 340, this.centerY + 240);
    ctx.bezierCurveTo(
      this.centerX + 420, this.centerY + 320,
      this.centerX + 460, this.centerY + 450,
      this.centerX + 640, this.centerY + 620
    );
    ctx.stroke();

    // Water channel
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(28, 86, 72, 0.85)';
    ctx.beginPath();
    ctx.moveTo(this.centerX + 340, this.centerY + 240);
    ctx.bezierCurveTo(
      this.centerX + 420, this.centerY + 320,
      this.centerX + 460, this.centerY + 450,
      this.centerX + 640, this.centerY + 620
    );
    ctx.stroke();

    // Water highlight & foam ripples
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(140, 230, 205, 0.35)';
    ctx.beginPath();
    ctx.moveTo(this.centerX + 342, this.centerY + 242);
    ctx.bezierCurveTo(
      this.centerX + 422, this.centerY + 322,
      this.centerX + 462, this.centerY + 452,
      this.centerX + 642, this.centerY + 622
    );
    ctx.stroke();

    // Stepping stones crossing the creek
    const stepStones = [
      { x: this.centerX + 430, y: this.centerY + 350 },
      { x: this.centerX + 444, y: this.centerY + 364 },
    ];
    for (const ss of stepStones) {
      ctx.beginPath();
      ctx.ellipse(ss.x, ss.y, 8, 6, 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#4c5e52';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#688270';
      ctx.stroke();
    }
    ctx.restore();

    // 6. ANCIENT CRACKED STONE PATHS (Cobblestone / Flagstone Pavers)
    ctx.save();
    // Sparring ring perimeter worn trail
    ctx.lineWidth = 52;
    ctx.strokeStyle = 'rgba(112, 92, 64, 0.16)';
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, 290, 0, Math.PI * 2);
    ctx.stroke();

    // Draw cracked flagstones scattered along the trail
    const flagstoneAngles = 28;
    for (let f = 0; f < flagstoneAngles; f++) {
      const fa = (f / flagstoneAngles) * Math.PI * 2;
      const fDist = 290 + (rand() - 0.5) * 22;
      const fx = this.centerX + Math.cos(fa) * fDist;
      const fy = this.centerY + Math.sin(fa) * fDist;

      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(fa + rand() * 0.4);

      // Irregular stone slab
      ctx.beginPath();
      ctx.rect(-9, -6, 18, 12);
      ctx.fillStyle = rand() > 0.5 ? '#3e5244' : '#4a5f50';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#27362c';
      ctx.stroke();

      // Crack line
      ctx.beginPath();
      ctx.moveTo(-5, -6);
      ctx.lineTo(2, 0);
      ctx.lineTo(-1, 6);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#1e2922';
      ctx.stroke();
      ctx.restore();
    }

    // Flagstone path spoke towards Northeast Ancient Arch
    const spokeNEAngles = 12;
    for (let s = 0; s < spokeNEAngles; s++) {
      const t = s / spokeNEAngles;
      const sx = this.centerX + Math.cos(-Math.PI * 0.3) * (240 + t * 240) + (rand() - 0.5) * 12;
      const sy = this.centerY + Math.sin(-Math.PI * 0.3) * (240 + t * 240) + (rand() - 0.5) * 12;

      ctx.beginPath();
      ctx.rect(sx - 8, sy - 6, 16, 12);
      ctx.fillStyle = '#3c4e41';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#25332a';
      ctx.stroke();
    }
    ctx.restore();

    // 7. Rich organic terrain patches (warm meadow, cool moss, and earthy soil)
    const patchCount = 180;
    for (let i = 0; i < patchCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * (this.radius * 0.94);
      const px = this.centerX + Math.cos(angle) * dist;
      const py = this.centerY + Math.sin(angle) * dist;
      const pr = 45 + rand() * 110;

      const patchGrad = ctx.createRadialGradient(px, py, 6, px, py, pr);
      const toneChoice = rand();
      if (toneChoice < 0.45) {
        patchGrad.addColorStop(0, 'rgba(74, 136, 84, 0.22)');
      } else if (toneChoice < 0.8) {
        patchGrad.addColorStop(0, 'rgba(20, 44, 25, 0.30)');
      } else {
        patchGrad.addColorStop(0, 'rgba(78, 60, 40, 0.15)');
      }
      patchGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = patchGrad;
      ctx.fill();
    }

    // 8. DETAILED WOODLAND FERNS (Feathered Fronds)
    const fernCount = 65;
    for (let f = 0; f < fernCount; f++) {
      const fa = rand() * Math.PI * 2;
      const fd = 310 + rand() * (this.radius * 0.62);
      const fx = this.centerX + Math.cos(fa) * fd;
      const fy = this.centerY + Math.sin(fa) * fd;

      ctx.save();
      ctx.translate(fx, fy);
      const frondCount = 5;
      for (let fr = 0; fr < frondCount; fr++) {
        const frAngle = (fr / frondCount) * Math.PI * 1.8 - 0.4 + (rand() - 0.5) * 0.2;
        const frLen = 14 + rand() * 10;
        ctx.save();
        ctx.rotate(frAngle);
        // Frond arching stem
        ctx.strokeStyle = '#2e6b37';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(frLen * 0.5, -4, frLen, 0);
        ctx.stroke();

        // Paired leaflets along stem
        ctx.strokeStyle = '#439952';
        ctx.lineWidth = 1.1;
        for (let l = 4; l < frLen - 2; l += 3.5) {
          ctx.beginPath();
          ctx.moveTo(l, -1);
          ctx.lineTo(l + 2, -4);
          ctx.moveTo(l, 1);
          ctx.lineTo(l + 2, 4);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // 9. WILD MUSHROOM COLONIES (Fly Agaric & Golden Chanterelles)
    const mushroomCount = 42;
    for (let m = 0; m < mushroomCount; m++) {
      const ma = rand() * Math.PI * 2;
      const md = 280 + rand() * (this.radius * 0.65);
      const mx = this.centerX + Math.cos(ma) * md;
      const my = this.centerY + Math.sin(ma) * md;
      const isRedFlyAgaric = rand() > 0.45;

      ctx.save();
      ctx.translate(mx, my);
      const clusterSize = 2 + Math.floor(rand() * 3);
      for (let c = 0; c < clusterSize; c++) {
        const cx = (c - 1) * 5 + (rand() - 0.5) * 3;
        const cy = (rand() - 0.5) * 4;
        const capR = 3 + rand() * 2.5;

        // Stem
        ctx.beginPath();
        ctx.rect(cx - 1, cy, 2, 4);
        ctx.fillStyle = '#f3f4f6';
        ctx.fill();

        // Mushroom Cap
        ctx.beginPath();
        ctx.arc(cx, cy, capR, Math.PI, 0);
        ctx.fillStyle = isRedFlyAgaric ? '#dc2626' : '#d97706';
        ctx.fill();

        // White spots on fly agaric
        if (isRedFlyAgaric) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx - 1.2, cy - capR * 0.5, 0.7, 0, Math.PI * 2);
          ctx.arc(cx + 1.2, cy - capR * 0.5, 0.7, 0, Math.PI * 2);
          ctx.arc(cx, cy - capR * 0.8, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 10. DELICATE WILDFLOWER CLUSTERS (Bluebells, Buttercups, Anemones)
    const flowerCount = 75;
    for (let fl = 0; fl < flowerCount; fl++) {
      const fla = rand() * Math.PI * 2;
      const fld = 260 + rand() * (this.radius * 0.68);
      const flx = this.centerX + Math.cos(fla) * fld;
      const fly = this.centerY + Math.sin(fla) * fld;

      const flowerType = rand();
      const flowerColor = flowerType < 0.4 ? '#60a5fa' : (flowerType < 0.75 ? '#facc15' : '#f8fafc');
      const clusterN = 2 + Math.floor(rand() * 4);

      for (let c = 0; c < clusterN; c++) {
        const fcx = flx + (rand() - 0.5) * 14;
        const fcy = fly + (rand() - 0.5) * 14;
        ctx.beginPath();
        ctx.arc(fcx, fcy, 1.8 + rand() * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = flowerColor;
        ctx.fill();
        // Tiny center
        ctx.beginPath();
        ctx.arc(fcx, fcy, 0.6, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
      }
    }

    // 11. Baked Grass Tufts & Clover Clusters
    const tuftCount = 380;
    for (let i = 0; i < tuftCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * (this.radius * 0.92);
      const tx = this.centerX + Math.cos(angle) * dist;
      const ty = this.centerY + Math.sin(angle) * dist;

      ctx.save();
      ctx.translate(tx, ty);
      const bladeColor = rand() > 0.4 ? '#4e8c58' : (rand() > 0.5 ? '#64ad71' : '#36633d');
      ctx.strokeStyle = bladeColor;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.quadraticCurveTo(-4, -6, -6, -8);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(0, -7, 1, -10);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.quadraticCurveTo(5, -6, 7, -7);
      ctx.stroke();
      ctx.restore();
    }

    // 12. Scattered Woodland Leaves & Tiny Pebbles
    const detailCount = 130;
    for (let i = 0; i < detailCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * (this.radius * 0.92);
      const dx = this.centerX + Math.cos(angle) * dist;
      const dy = this.centerY + Math.sin(angle) * dist;

      if (rand() > 0.4) {
        const leafColor = rand() > 0.45 ? 'rgba(168, 126, 52, 0.38)' : 'rgba(84, 150, 94, 0.4)';
        ctx.beginPath();
        ctx.ellipse(dx, dy, 2.8, 1.8, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = leafColor;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(dx, dy, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(50, 62, 54, 0.45)';
        ctx.fill();
      }
    }

    // 13. Polished Sparring Ring (Clear, clean central fighting zone)
    const centerRingRadius = 260;
    const centerGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, 30,
      this.centerX, this.centerY, centerRingRadius
    );
    centerGrad.addColorStop(0, 'rgba(108, 134, 100, 0.32)');
    centerGrad.addColorStop(0.65, 'rgba(74, 98, 70, 0.22)');
    centerGrad.addColorStop(1, 'rgba(40, 68, 46, 0)');

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, centerRingRadius, 0, Math.PI * 2);
    ctx.fillStyle = centerGrad;
    ctx.fill();

    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(130, 180, 140, 0.16)';
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, centerRingRadius * 0.88, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(165, 215, 175, 0.38)';
    ctx.setLineDash([18, 14]);
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, centerRingRadius * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4 Ancient Cardinal Marker Stones
    for (let c = 0; c < 4; c++) {
      const ca = (c * Math.PI) / 2;
      const cx = this.centerX + Math.cos(ca) * (centerRingRadius * 0.88);
      const cy = this.centerY + Math.sin(ca) * (centerRingRadius * 0.88);

      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#3c5241';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#5a7860';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#38ef7d';
      ctx.fill();
    }

    // 14. Arena Perimeter Rim & Vignette Shade
    const vignetteGrad = ctx.createRadialGradient(
      this.centerX, this.centerY, this.radius - 50,
      this.centerX, this.centerY, this.radius + 30
    );
    vignetteGrad.addColorStop(0, 'rgba(10, 20, 12, 0)');
    vignetteGrad.addColorStop(1, 'rgba(7, 14, 9, 0.72)');
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.radius + 30, 0, Math.PI * 2);
    ctx.fillStyle = vignetteGrad;
    ctx.fill();

    ctx.lineWidth = 34;
    ctx.strokeStyle = 'rgba(6, 12, 8, 0.70)';
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 14;
    ctx.strokeStyle = '#273b2d';
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.50)';
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.radius - 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  constrainToBounds(entity) {
    const dx = entity.x - this.centerX;
    const dy = entity.y - this.centerY;
    const dist = Math.hypot(dx, dy);
    const maxDist = this.radius - entity.radius - 10;

    if (dist > maxDist && dist > 0.0001) {
      const nx = dx / dist;
      const ny = dy / dist;
      entity.x = this.centerX + nx * maxDist;
      entity.y = this.centerY + ny * maxDist;

      const normalDotVel = entity.vx * nx + entity.vy * ny;
      if (normalDotVel > 0) {
        entity.vx -= normalDotVel * nx;
        entity.vy -= normalDotVel * ny;
      }
    }
  }

  resolveObstacleCollisions(entity) {
    for (const tree of this.trees) {
      this.circleResolve(entity, tree.x, tree.y, tree.collisionRadius);
    }
    for (const rock of this.rocks) {
      this.circleResolve(entity, rock.x, rock.y, rock.radius);
    }
    for (const stone of this.boundaryStones) {
      this.circleResolve(entity, stone.x, stone.y, stone.radius);
    }
  }

  circleResolve(entity, ox, oy, obstacleRadius) {
    const dx = entity.x - ox;
    const dy = entity.y - oy;
    const minDist = entity.radius + obstacleRadius;
    const distSq = dx * dx + dy * dy;

    if (distSq < minDist * minDist && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;

      entity.x += nx * overlap;
      entity.y += ny * overlap;

      const dot = entity.vx * nx + entity.vy * ny;
      if (dot < 0) {
        entity.vx -= dot * nx;
        entity.vy -= dot * ny;
      }
    }
  }

  renderGround(ctx) {
    ctx.drawImage(this.groundCanvas, 0, 0);
  }

  getWorldEntities() {
    const list = [];
    for (const tree of this.trees) {
      list.push({
        y: tree.y,
        render: (ctx) => this.drawTree(ctx, tree),
        cullX: tree.x,
        cullY: tree.y,
        cullRadius: tree.canopyRadius + 30,
      });
    }
    for (const rock of this.rocks) {
      list.push({
        y: rock.y,
        render: (ctx) => this.drawRock(ctx, rock),
        cullX: rock.x,
        cullY: rock.y,
        cullRadius: rock.radius + 20,
      });
    }
    for (const bush of this.bushes) {
      list.push({
        y: bush.y,
        render: (ctx) => this.drawBush(ctx, bush),
        cullX: bush.x,
        cullY: bush.y,
        cullRadius: bush.radius + 15,
      });
    }
    for (const log of this.fallenLogs) {
      list.push({
        y: log.y,
        render: (ctx) => this.drawFallenLog(ctx, log),
        cullX: log.x,
        cullY: log.y,
        cullRadius: log.length + 30,
      });
    }
    for (const ruin of this.ruins) {
      list.push({
        y: ruin.y,
        render: (ctx) => this.drawRuinEntity(ctx, ruin),
        cullX: ruin.x,
        cullY: ruin.y,
        cullRadius: ruin.radius + 40,
      });
    }
    for (const stone of this.boundaryStones) {
      list.push({
        y: stone.y,
        render: (ctx) => this.drawBoundaryStone(ctx, stone),
        cullX: stone.x,
        cullY: stone.y,
        cullRadius: stone.radius + 20,
      });
    }
    return list;
  }

  drawBoundaryStone(ctx, stone) {
    ctx.save();
    // 1. Soft directional cast shadow
    ctx.beginPath();
    ctx.ellipse(stone.x + 6, stone.y + 8, stone.radius * 1.15, stone.radius * 0.72, 0.15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 14, 8, 0.48)';
    ctx.fill();

    // 2. Chiseled Stone Base
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#27382d';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a261e';
    ctx.stroke();

    // 3. Faceted top plateau
    ctx.beginPath();
    ctx.arc(stone.x - 3, stone.y - 4, stone.radius * 0.74, 0, Math.PI * 2);
    ctx.fillStyle = '#3f5646';
    ctx.fill();

    // Subtle stone highlight rim
    ctx.beginPath();
    ctx.arc(stone.x - 4, stone.y - 5, stone.radius * 0.5, -Math.PI * 0.7, Math.PI * 0.1);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#5c7865';
    ctx.stroke();

    // Base moss fringe
    ctx.beginPath();
    ctx.arc(stone.x + 3, stone.y + 4, stone.radius * 0.6, Math.PI * 0.1, Math.PI * 0.9);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(54, 102, 62, 0.65)';
    ctx.stroke();

    // 4. Mystical Ancient Inlaid Emerald Glyph
    ctx.beginPath();
    ctx.arc(stone.x - 1, stone.y - 2, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38ef7d';
    ctx.shadowColor = '#38ef7d';
    ctx.shadowBlur = 8;
    ctx.fill();

    // Glowing core
    ctx.beginPath();
    ctx.arc(stone.x - 1, stone.y - 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#f0fdf4';
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Illustrated Top-Down Tree with Irregular Organic Canopy & Layered Foliage
   */
  drawTree(ctx, tree) {
    ctx.save();
    const { x, y, canopyRadius, shade, lobes } = tree;

    // 1. Directional Ground Shadow following irregular canopy
    ctx.save();
    ctx.translate(x + 22, y + 28);
    ctx.beginPath();
    if (lobes && lobes.length > 0) {
      for (let i = 0; i < lobes.length; i++) {
        const lb = lobes[i];
        const lx = Math.cos(lb.angle) * lb.radius * 0.98;
        const ly = Math.sin(lb.angle) * lb.radius * 0.68;
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      ctx.closePath();
    } else {
      ctx.ellipse(0, 0, canopyRadius * 1.05, canopyRadius * 0.72, 0.18, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(5, 12, 7, 0.46)';
    ctx.fill();
    ctx.restore();

    // 2. Trunk base and knotty root flares (grounded at collision point)
    ctx.save();
    ctx.translate(x, y);
    // Root claws spreading into the mossy turf
    ctx.fillStyle = '#1c1209';
    const rootPoints = [
      { a: -0.4, len: tree.collisionRadius * 1.25, w: 7 },
      { a: 0.5, len: tree.collisionRadius * 1.3, w: 8 },
      { a: 1.8, len: tree.collisionRadius * 1.2, w: 7 },
      { a: 3.4, len: tree.collisionRadius * 1.22, w: 7 },
    ];
    for (const rp of rootPoints) {
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(rp.a) * (rp.len * 0.6),
        Math.sin(rp.a) * (rp.len * 0.45) + 3,
        rp.len * 0.5,
        rp.w * 0.5,
        rp.a,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Main trunk cross-section with textured bark
    ctx.beginPath();
    ctx.arc(0, 0, tree.collisionRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1a0f';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#150d07';
    ctx.stroke();

    // Bark growth rings & moss collar
    ctx.beginPath();
    ctx.arc(-2, -2, tree.collisionRadius * 0.65, 0, Math.PI * 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#3d2717';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -3, tree.collisionRadius * 0.85, -Math.PI * 0.8, -Math.PI * 0.1);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#2d5e36';
    ctx.stroke();
    ctx.restore();

    // 3. Exposed Branch Limbs (Peeking through canopy foliage gaps)
    ctx.save();
    ctx.translate(x, y - 10);
    ctx.strokeStyle = '#1d120a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-canopyRadius * 0.35, -canopyRadius * 0.25);
    ctx.moveTo(0, 0); ctx.lineTo(canopyRadius * 0.38, -canopyRadius * 0.22);
    ctx.moveTo(0, 0); ctx.lineTo(canopyRadius * 0.1, -canopyRadius * 0.42);
    ctx.stroke();
    ctx.restore();

    // 4. Illustrated Irregular Foliage Canopy (Multi-tiered Volume & Leaf Clumps)
    ctx.save();
    ctx.translate(x, y - 10);

    // TIER A: Ambient Occlusion Deep Under-Canopy (Irregular scalloped silhouette)
    ctx.beginPath();
    if (lobes && lobes.length > 0) {
      for (let i = 0; i < lobes.length; i++) {
        const lb = lobes[i];
        const nextLb = lobes[(i + 1) % lobes.length];
        const cx = Math.cos(lb.angle) * lb.radius;
        const cy = Math.sin(lb.angle) * lb.radius;
        const ncx = Math.cos(nextLb.angle) * nextLb.radius;
        const ncy = Math.sin(nextLb.angle) * nextLb.radius;
        const midX = (cx + ncx) * 0.5 + Math.cos(lb.angle + 0.2) * 8;
        const midY = (cy + ncy) * 0.5 + Math.sin(lb.angle + 0.2) * 8;
        if (i === 0) ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(midX, midY, ncx, ncy);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, canopyRadius, 0, Math.PI * 2);
    }
    const deepGreen = `rgb(${Math.floor(14 * shade)}, ${Math.floor(32 * shade)}, ${Math.floor(18 * shade)})`;
    ctx.fillStyle = deepGreen;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(7, 18, 10, 0.6)';
    ctx.stroke();

    // TIER B: Major Foliage Clumps (Mid-tone volume lobes with scalloped leafy edges)
    const midGreen = `rgb(${Math.floor(26 * shade)}, ${Math.floor(64 * shade)}, ${Math.floor(34 * shade)})`;
    const clumpCenters = [
      { a: 0.2, d: 0.42, r: 0.52 },
      { a: 1.3, d: 0.45, r: 0.50 },
      { a: 2.4, d: 0.40, r: 0.54 },
      { a: 3.6, d: 0.44, r: 0.52 },
      { a: 4.8, d: 0.42, r: 0.50 },
    ];
    for (const cl of clumpCenters) {
      const clx = Math.cos(cl.a) * (canopyRadius * cl.d);
      const cly = Math.sin(cl.a) * (canopyRadius * cl.d);
      const clr = canopyRadius * cl.r;

      // Draw bumpy scalloped leaf cluster
      ctx.beginPath();
      const subLobes = 7;
      for (let s = 0; s < subLobes; s++) {
        const sa = (s / subLobes) * Math.PI * 2;
        const sx = clx + Math.cos(sa) * clr;
        const sy = cly + Math.sin(sa) * clr * 0.9;
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.arc(clx + Math.cos(sa) * (clr * 0.75), cly + Math.sin(sa) * (clr * 0.68), clr * 0.38, 0, Math.PI * 2);
      }
      ctx.fillStyle = midGreen;
      ctx.fill();
    }

    // TIER C: Sunlit Foliage Crests (Directional sunlight biased towards northwest)
    const sunlitGreen = `rgb(${Math.floor(42 * shade)}, ${Math.floor(96 * shade)}, ${Math.floor(50 * shade)})`;
    const sunlitLobes = [
      { x: -canopyRadius * 0.32, y: -canopyRadius * 0.28, r: canopyRadius * 0.45 },
      { x: -canopyRadius * 0.12, y: -canopyRadius * 0.45, r: canopyRadius * 0.42 },
      { x: canopyRadius * 0.18, y: -canopyRadius * 0.32, r: canopyRadius * 0.38 },
      { x: -canopyRadius * 0.45, y: canopyRadius * 0.05, r: canopyRadius * 0.36 },
      { x: -canopyRadius * 0.10, y: -canopyRadius * 0.05, r: canopyRadius * 0.48 },
    ];
    for (const sl of sunlitLobes) {
      ctx.beginPath();
      ctx.ellipse(sl.x, sl.y, sl.r, sl.r * 0.88, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = sunlitGreen;
      ctx.fill();
    }

    // TIER D: Crisp Leaf Highlights & Foliage Rim Strokes
    const rimGreen = `rgb(${Math.floor(62 * shade)}, ${Math.floor(132 * shade)}, ${Math.floor(70 * shade)})`;
    ctx.strokeStyle = rimGreen;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let h = 0; h < 6; h++) {
      const ha = Math.PI * 1.1 + h * 0.32;
      const hx = Math.cos(ha) * (canopyRadius * 0.65);
      const hy = Math.sin(ha) * (canopyRadius * 0.58);
      ctx.beginPath();
      ctx.arc(hx, hy, canopyRadius * 0.18, ha - 0.4, ha + 0.6);
      ctx.stroke();
    }

    // Top-most sun crest highlight
    const crownGreen = `rgb(${Math.floor(78 * shade)}, ${Math.floor(158 * shade)}, ${Math.floor(86 * shade)})`;
    ctx.beginPath();
    ctx.ellipse(-canopyRadius * 0.22, -canopyRadius * 0.32, canopyRadius * 0.26, canopyRadius * 0.16, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = crownGreen;
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  /**
   * Illustrated Faceted Boulder with Planar Geological Lighting & Moss
   */
  drawRock(ctx, rock) {
    ctx.save();
    const { x, y, radius, rotation, mossiness, vertices, ridgeX, ridgeY } = rock;

    // 1. Directional cast shadow (offset southeast)
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 12, radius * 1.25, radius * 0.82, 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5, 12, 7, 0.46)';
    ctx.fill();

    ctx.translate(x, y);
    ctx.rotate(rotation);

    // 2. Base Polygonal Boulder Silhouette
    if (vertices && vertices.length > 0) {
      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = '#243028';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#131b16';
      ctx.stroke();

      // 3. Planar Facets meeting at an off-center crest ridge
      const rx = ridgeX || -radius * 0.2;
      const ry = ridgeY || -radius * 0.2;

      // Draw each triangular facet from adjacent vertices to the central ridge
      const facetTones = [
        '#688070', // sunlit top-left
        '#586e5f', // top highlight
        '#475b4f', // midtone east
        '#35443a', // shaded southeast
        '#28352d', // deep shadow south
        '#222c26', // shadow underbelly
        '#3d4d42', // midtone west
        '#566d5e', // northwest sunlit
      ];

      for (let f = 0; f < vertices.length; f++) {
        const v1 = vertices[f];
        const v2 = vertices[(f + 1) % vertices.length];
        ctx.beginPath();
        ctx.moveTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y);
        ctx.lineTo(rx, ry);
        ctx.closePath();
        ctx.fillStyle = facetTones[f % facetTones.length];
        ctx.fill();
      }

      // Crisp geological ridge highlights along sunlit edges
      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      ctx.lineTo(rx, ry);
      ctx.lineTo(vertices[6].x, vertices[6].y);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#8fa896';
      ctx.stroke();

      // Hairline crack striations
      ctx.beginPath();
      ctx.moveTo(rx - 2, ry - 3);
      ctx.lineTo(rx + 8, ry + 10);
      ctx.lineTo(vertices[3].x * 0.7, vertices[3].y * 0.7);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#18221b';
      ctx.stroke();

      // 4. Draped Moss Blanket on upper sunny facets
      if (mossiness > 0.25) {
        ctx.beginPath();
        ctx.moveTo(vertices[6].x * 0.85, vertices[6].y * 0.85);
        ctx.quadraticCurveTo(rx - 4, ry - 8, vertices[0].x * 0.85, vertices[0].y * 0.85);
        ctx.quadraticCurveTo(rx + 6, ry + 2, rx, ry + 4);
        ctx.closePath();
        ctx.fillStyle = 'rgba(56, 115, 62, 0.85)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(rx - 3, ry - 4, radius * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(84, 156, 92, 0.75)';
        ctx.fill();
      }
    } else {
      // Fallback
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.75, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#445147';
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Illustrated Multi-Lobed Bush with Berry & Floral Details
   */
  drawBush(ctx, bush) {
    ctx.save();
    const { x, y, radius, colorShade, lobes } = bush;

    // 1. Ground shadow
    ctx.beginPath();
    ctx.ellipse(x + 5, y + 8, radius * 1.15, radius * 0.72, 0.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5, 12, 7, 0.38)';
    ctx.fill();

    ctx.translate(x, y);

    const gBase = Math.floor(65 + colorShade * 28);
    const gMid = Math.floor(88 + colorShade * 32);
    const gHigh = Math.floor(112 + colorShade * 35);

    // 2. Deep Under-Layer
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(18, ${gBase}, 26)`;
    ctx.fill();

    // 3. Overlapping Leaf Masses
    if (lobes && lobes.length > 0) {
      for (const lb of lobes) {
        ctx.beginPath();
        ctx.arc(lb.x, lb.y, lb.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(28, ${gMid}, 40)`;
        ctx.fill();
      }
    }

    // 4. Sunlit Upper Highlight Lobe
    ctx.beginPath();
    ctx.arc(-radius * 0.24, -radius * 0.26, radius * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(42, ${gHigh}, 58)`;
    ctx.fill();

    // Leaf cluster rim highlights
    ctx.strokeStyle = `rgb(64, ${Math.min(255, gHigh + 35)}, 80)`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(-radius * 0.24, -radius * 0.26, radius * 0.44, -Math.PI * 0.8, -Math.PI * 0.1);
    ctx.stroke();

    // 5. Wild Berries / Forest Florets
    if (colorShade > 0.35) {
      const berryColor = colorShade > 0.7 ? '#e11d48' : (colorShade > 0.5 ? '#f59e0b' : '#a78bfa');
      const bOffsets = [
        [-radius * 0.38, -radius * 0.12],
        [radius * 0.28, -radius * 0.32],
        [-radius * 0.12, radius * 0.32],
        [radius * 0.35, radius * 0.18],
        [-radius * 0.05, -radius * 0.22],
      ];
      ctx.fillStyle = berryColor;
      for (const [bx, by] of bOffsets) {
        ctx.beginPath();
        ctx.arc(bx, by, 2.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Illustrated Fallen Broken Tree (Mossy Trunk, Splintered Wood, Bracket Fungi)
   */
  drawFallenLog(ctx, log) {
    ctx.save();
    const { x, y, length, angle, thickness, bracketFungi } = log;

    // 1. Cast shadow
    ctx.save();
    ctx.translate(x + 10, y + 14);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.roundRect(-length * 0.5, -thickness * 0.5, length, thickness * 1.15, 6);
    ctx.fillStyle = 'rgba(5, 12, 7, 0.42)';
    ctx.fill();
    ctx.restore();

    ctx.translate(x, y);
    ctx.rotate(angle);

    // 2. Main Bark Trunk Body
    ctx.beginPath();
    ctx.roundRect(-length * 0.5, -thickness * 0.5, length, thickness, 4);
    ctx.fillStyle = '#261a10';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#140c06';
    ctx.stroke();

    // Bark grain striations running lengthwise
    ctx.strokeStyle = '#3d2b1a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-length * 0.45, -thickness * 0.15);
    ctx.lineTo(length * 0.45, -thickness * 0.15);
    ctx.moveTo(-length * 0.4, thickness * 0.2);
    ctx.lineTo(length * 0.4, thickness * 0.2);
    ctx.stroke();

    // Sunlit top edge of the log
    ctx.strokeStyle = '#4e3824';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-length * 0.48, -thickness * 0.45);
    ctx.lineTo(length * 0.46, -thickness * 0.45);
    ctx.stroke();

    // 3. Splintered Fracture End (Severed break point with exposed pale wood fibers)
    ctx.save();
    ctx.translate(-length * 0.5, 0);
    ctx.beginPath();
    ctx.moveTo(0, -thickness * 0.5);
    ctx.lineTo(-7, -thickness * 0.25);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-9, thickness * 0.3);
    ctx.lineTo(0, thickness * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#c79c62'; // pale raw wood
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#855d31';
    ctx.stroke();
    ctx.restore();

    // 4. Hollow cavity at opposite end
    ctx.save();
    ctx.translate(length * 0.5, 0);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4, thickness * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#110a05';
    ctx.fill();
    ctx.restore();

    // 5. Pillowy Velvety Moss Cushions on top of log
    ctx.beginPath();
    ctx.ellipse(-length * 0.15, -thickness * 0.45, 18, 5, 0.05, 0, Math.PI * 2);
    ctx.ellipse(length * 0.2, -thickness * 0.45, 22, 6, -0.05, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(54, 118, 62, 0.85)';
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(-length * 0.15, -thickness * 0.48, 14, 3.5, 0.05, 0, Math.PI * 2);
    ctx.ellipse(length * 0.2, -thickness * 0.48, 18, 4, -0.05, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(78, 156, 88, 0.75)';
    ctx.fill();

    // 6. Bracket Fungi (Shelf Mushrooms projecting from the bark)
    if (bracketFungi) {
      for (const bf of bracketFungi) {
        const bx = -length * 0.5 + length * bf.t;
        const by = (thickness * 0.5) * bf.side;
        ctx.beginPath();
        ctx.arc(bx, by, bf.size, bf.side > 0 ? 0 : Math.PI, bf.side > 0 ? Math.PI : Math.PI * 2);
        ctx.fillStyle = '#d97706';
        ctx.fill();
        // Cream rim
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fef08a';
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Illustrated Ancient Ruins (Weathered Arches, Fallen Columns, Mossy Walls, Plinths)
   */
  drawRuinEntity(ctx, ruin) {
    ctx.save();
    const { type, x, y, angle } = ruin;

    if (type === 'arch') {
      // Weathered Broken Stone Archway
      // Shadow
      ctx.beginPath();
      ctx.ellipse(x + 12, y + 16, 52, 28, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(5, 12, 7, 0.45)';
      ctx.fill();

      ctx.translate(x, y);

      // Left Pillar Base
      ctx.beginPath();
      ctx.rect(-34, -20, 20, 36);
      ctx.fillStyle = '#3f5244';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#233227';
      ctx.stroke();

      // Right Pillar Base
      ctx.beginPath();
      ctx.rect(14, -20, 20, 36);
      ctx.fillStyle = '#3f5244';
      ctx.fill();
      ctx.stroke();

      // Broken Overhead Lintel Beam (Fractured in the middle)
      ctx.beginPath();
      ctx.moveTo(-38, -20);
      ctx.lineTo(8, -20);
      ctx.lineTo(12, -26);
      ctx.lineTo(-4, -32);
      ctx.lineTo(-38, -32);
      ctx.closePath();
      ctx.fillStyle = '#4f6555';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#27382d';
      ctx.stroke();

      // Carved frieze relief lines
      ctx.strokeStyle = '#2d4033';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-34, -26); ctx.lineTo(4, -26);
      ctx.stroke();

      // Hanging Ivy Vines
      ctx.strokeStyle = '#2d6836';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-18, -20); ctx.quadraticCurveTo(-22, -8, -20, 4);
      ctx.moveTo(-4, -22); ctx.quadraticCurveTo(0, -10, -2, 2);
      ctx.moveTo(18, -14); ctx.quadraticCurveTo(16, -2, 19, 8);
      ctx.stroke();

      // Fallen stone rubble blocks at the base
      ctx.fillStyle = '#4a5e50';
      ctx.beginPath();
      ctx.rect(-10, 8, 12, 10);
      ctx.rect(4, 12, 10, 8);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#28382d';
      ctx.stroke();

    } else if (type === 'column') {
      // Fallen Fluted Classical Column lying in the turf
      const rot = angle || 0.42;
      ctx.save();
      ctx.translate(x + 10, y + 14);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.roundRect(-42, -14, 84, 28, 4);
      ctx.fillStyle = 'rgba(5, 12, 7, 0.44)';
      ctx.fill();
      ctx.restore();

      ctx.translate(x, y);
      ctx.rotate(rot);

      // Column cylindrical shaft with drum joint lines
      ctx.beginPath();
      ctx.roundRect(-42, -14, 84, 28, 3);
      ctx.fillStyle = '#445649';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#233127';
      ctx.stroke();

      // Fluting lines along cylinder
      ctx.strokeStyle = '#324236';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-38, -6); ctx.lineTo(36, -6);
      ctx.moveTo(-38, 0); ctx.lineTo(36, 0);
      ctx.moveTo(-38, 6); ctx.lineTo(36, 6);
      ctx.stroke();

      // Drum seam joint
      ctx.strokeStyle = '#243228';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(2, -14); ctx.lineTo(2, 14);
      ctx.stroke();

      // Broken jagged fracture at right end
      ctx.beginPath();
      ctx.moveTo(38, -14);
      ctx.lineTo(44, -5);
      ctx.lineTo(40, 4);
      ctx.lineTo(46, 14);
      ctx.lineTo(38, 14);
      ctx.closePath();
      ctx.fillStyle = '#2d3b31';
      ctx.fill();

      // Carved Capital Drum at left end
      ctx.beginPath();
      ctx.rect(-46, -17, 8, 34);
      ctx.fillStyle = '#526857';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#293a2e';
      ctx.stroke();

      // Moss creeping up over column
      ctx.beginPath();
      ctx.ellipse(-10, -12, 14, 5, 0.1, 0, Math.PI * 2);
      ctx.ellipse(18, 11, 12, 4, -0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 118, 65, 0.8)';
      ctx.fill();

    } else if (type === 'plinth') {
      // Ancient Octagonal Stepped Altar / Runic Plinth
      ctx.beginPath();
      ctx.ellipse(x + 8, y + 12, 42, 28, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(5, 12, 7, 0.45)';
      ctx.fill();

      ctx.translate(x, y);

      // Stepped Base Tier
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.fillStyle = '#36473b';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#223026';
      ctx.stroke();

      // Upper Octagonal Plinth
      ctx.beginPath();
      const octSides = 8;
      for (let s = 0; s < octSides; s++) {
        const sa = (s / octSides) * Math.PI * 2;
        const ox = Math.cos(sa) * 23;
        const oy = Math.sin(sa) * 23;
        if (s === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
      }
      ctx.closePath();
      ctx.fillStyle = '#4c6252';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2b3b30';
      ctx.stroke();

      // Inlaid Glowing Ancient Spiral Glyph
      ctx.strokeStyle = '#38ef7d';
      ctx.shadowColor = '#38ef7d';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let t = 0; t < Math.PI * 4; t += 0.2) {
        const sr = 2 + t * 1.1;
        const sx = Math.cos(t) * sr;
        const sy = Math.sin(t) * sr;
        if (t === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

    } else if (type === 'wall') {
      // Crumbling Mossy Stone Wall
      const rot = angle || -0.25;
      ctx.save();
      ctx.translate(x + 8, y + 12);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.roundRect(-45, -12, 90, 24, 3);
      ctx.fillStyle = 'rgba(5, 12, 7, 0.44)';
      ctx.fill();
      ctx.restore();

      ctx.translate(x, y);
      ctx.rotate(rot);

      // Ashlar Masonry Wall Blocks
      ctx.beginPath();
      ctx.rect(-45, -12, 90, 24);
      ctx.fillStyle = '#3c4e41';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#243228';
      ctx.stroke();

      // Masonry block courses and vertical joints
      ctx.strokeStyle = '#233127';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-45, 0); ctx.lineTo(45, 0); // horizontal mortar
      ctx.moveTo(-25, -12); ctx.lineTo(-25, 0);
      ctx.moveTo(5, -12); ctx.lineTo(5, 0);
      ctx.moveTo(25, -12); ctx.lineTo(25, 0);
      ctx.moveTo(-10, 0); ctx.lineTo(-10, 12);
      ctx.moveTo(20, 0); ctx.lineTo(20, 12);
      ctx.stroke();

      // Broken / missing stone notch
      ctx.fillStyle = '#222f25';
      ctx.beginPath();
      ctx.rect(26, -12, 14, 10);
      ctx.fill();

      // Cascading Ivy Vines
      ctx.strokeStyle = '#32733d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-35, -12); ctx.quadraticCurveTo(-38, 0, -32, 10);
      ctx.moveTo(0, -12); ctx.quadraticCurveTo(-4, 2, -2, 12);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ============================================================================
// 6. FIGHTER ENTITY (Shared Base for Player and Training Opponent)
// ============================================================================
class Fighter {
  constructor(startX, startY, options = {}) {
    this.name = options.name || 'Fighter';
    this.isPlayer = options.isPlayer || false;
    this.x = startX;
    this.y = startY;
    this.spawnX = startX;
    this.spawnY = startY;
    this.vx = 0;
    this.vy = 0;
    this.radius = CONFIG.player.radius;

    // Palette & Visual Theme
    this.tunicColor = options.tunicColor || '#2d5a3f';
    this.headbandColor = options.headbandColor || '#38ef7d';
    this.hpBarColor = options.hpBarColor || '#38ef7d';

    // Facing Angle
    this.facingAngle = options.initialAngle !== undefined ? options.initialAngle : -Math.PI / 2;
    this.targetFacingAngle = this.facingAngle;

    // Health & Vitals
    this.maxHealth = CONFIG.combat.maxHealth;
    this.health = this.maxHealth;
    this.isDefeated = false;

    // State machine: 'idle' | 'running' | 'attacking' | 'blocking' | 'dashing' | 'stunned' | 'recovering' | 'defeated'
    this.state = 'idle';

    // Combat & Attack State
    this.comboIndex = 0;         // Current combo strike (0 = ready for Hit 1, 1 = Hit 1 done, etc.)
    this.comboResetTimer = 0;    // Inactivity timer to reset combo back to 0
    this.currentAttack = null;   // Active punch config
    this.attackTimer = 0;        // Progress timer within active punch
    this.attackHasHit = false;   // Prevent repeated hits from single swing

    // Blocking State
    this.isBlocking = false;

    // Dash State & Cooldowns
    this.dashType = null;        // 'forward' | 'side' | 'back' | null
    this.dashTimer = 0;
    this.dashMaxDuration = 0;
    this.dashVx = 0;
    this.dashVy = 0;
    this.dashHasHit = false;
    this.dashCooldowns = { forward: 0, side: 0, back: 0 };

    // Stun & Recovery
    this.stunTimer = 0;
    this.recoveryTimer = 0;

    // Knockback Slide (Upright slide)
    this.knockbackVx = 0;
    this.knockbackVy = 0;

    // Lock-On State
    this.isLockedOn = false;
    this.lockOnTarget = null;
    this.attackCooldownTimer = 0;

    // Block-hit penalty state (attacker penalised after hitting a blocking defender)
    this.blockHitTimer = 0;  // Counts down: dash locked + movement slowed while > 0

    // Visual Reaction Timers
    this.hurtFlashTimer = 0;
    this.hurtShakeTimer = 0;
    this.walkAnimTimer = 0;
    this.idleAnimTimer = 0;
    this.footstepDustTimer = 0;
  }

  reset() {
    this.health = this.maxHealth;
    this.isDefeated = false;
    this.state = 'idle';
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.knockbackVx = 0;
    this.knockbackVy = 0;
    this.stunTimer = 0;
    this.recoveryTimer = 0;
    this.currentAttack = null;
    this.dashType = null;
    this.dashCooldowns = { forward: 0, side: 0, back: 0 };
    this.isBlocking = false;
    this.comboIndex = 0;
    this.comboResetTimer = 0;
    this.isLockedOn = false;
    this.lockOnTarget = null;
    this.attackCooldownTimer = 0;
    this.blockHitTimer = 0;
    this.hurtFlashTimer = 0;
    this.hurtShakeTimer = 0;
  }

  update(dt, inputVector, particleSystem, arena) {
    // 1. Tick cooldowns & visual timers
    if (this.dashCooldowns.forward > 0) this.dashCooldowns.forward = Math.max(0, this.dashCooldowns.forward - dt);
    if (this.dashCooldowns.side > 0) this.dashCooldowns.side = Math.max(0, this.dashCooldowns.side - dt);
    if (this.dashCooldowns.back > 0) this.dashCooldowns.back = Math.max(0, this.dashCooldowns.back - dt);

    if (this.hurtFlashTimer > 0) this.hurtFlashTimer = Math.max(0, this.hurtFlashTimer - dt);
    if (this.hurtShakeTimer > 0) this.hurtShakeTimer = Math.max(0, this.hurtShakeTimer - dt);
    if (this.attackCooldownTimer > 0) this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt);
    if (this.blockHitTimer > 0) this.blockHitTimer = Math.max(0, this.blockHitTimer - dt);
    this.idleAnimTimer += dt * 2.8;

    // 2. Combo inactivity timer (Resets combo counter after ~4s)
    if (this.comboIndex > 0) {
      this.comboResetTimer -= dt;
      if (this.comboResetTimer <= 0) {
        this.comboIndex = 0;
      }
    }

    // 3. Stun State Processing
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      this.state = 'stunned';
      this.isBlocking = false;
      this.currentAttack = null;
      this.dashType = null;

      // Apply knockback decay while upright
      this.applyKnockbackPhysics(dt, arena);
      return;
    }

    // 4. Whiff / Stagger Recovery State
    if (this.recoveryTimer > 0) {
      this.recoveryTimer = Math.max(0, this.recoveryTimer - dt);
      this.state = 'recovering';
      this.isBlocking = false;
      this.applyKnockbackPhysics(dt, arena);
      return;
    }

    // 5. Defeated State
    if (this.isDefeated) {
      this.state = 'defeated';
      this.applyKnockbackPhysics(dt, arena);
      return;
    }

    // 6. Dash Processing
    if (this.dashType) {
      this.state = 'dashing';
      this.dashTimer -= dt;

      // Move in dash direction
      this.x += this.dashVx * dt;
      this.y += this.dashVy * dt;

      arena.constrainToBounds(this);
      arena.resolveObstacleCollisions(this);

      // Dash trail particles
      particleSystem.emitDust(this.x, this.y + 10, Math.atan2(this.dashVy, this.dashVx));

      if (this.dashTimer <= 0) {
        // Forward dash miss penalty: punishable recovery
        if (this.dashType === 'forward' && !this.dashHasHit) {
          this.recoveryTimer = CONFIG.combat.forwardDash.missRecovery;
        }
        this.dashType = null;
      }
      return;
    }

    // 7. Active Punch Attack Processing
    if (this.currentAttack) {
      this.state = 'attacking';
      this.attackTimer += dt;
      const totalAttackDuration = this.currentAttack.windup + this.currentAttack.active + this.currentAttack.recovery;

      // Attacker movement speed is reduced while punching (or while block-hit penalty is active)
      const { dx, dy } = inputVector;
      const effectiveSpeedMult = (this.blockHitTimer > 0)
        ? CONFIG.combat.blockHitSpeedMult
        : CONFIG.player.attackSpeedMult;
      if (dx !== 0 || dy !== 0) {
        const speed = CONFIG.player.baseSpeed * effectiveSpeedMult;
        this.vx += (dx * speed - this.vx) * 0.15;
        this.vy += (dy * speed - this.vy) * 0.15;
      } else {
        this.vx *= 0.85;
        this.vy *= 0.85;
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      arena.constrainToBounds(this);
      arena.resolveObstacleCollisions(this);

      if (this.attackTimer >= totalAttackDuration) {
        // Attack finished - trigger attack delay to prevent spamming
        this.currentAttack = null;
        this.attackCooldownTimer = CONFIG.combat.punchAttackDelay;
        this.state = 'idle';
      }
      return;
    }

    // 8. Blocking State — allow reduced movement while holding block
    if (this.isBlocking) {
      this.state = 'blocking';
      const { dx, dy } = inputVector;
      if (dx !== 0 || dy !== 0) {
        const speed = CONFIG.player.baseSpeed * CONFIG.player.blockSpeedMult;
        this.vx += (dx * speed - this.vx) * 0.15;
        this.vy += (dy * speed - this.vy) * 0.15;
        // While blocking + moving, don't update facing (keep guard direction)
      } else {
        this.vx *= 0.8;
        this.vy *= 0.8;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.applyKnockbackPhysics(dt, arena);
      arena.constrainToBounds(this);
      arena.resolveObstacleCollisions(this);
      return;
    }

    // 9. Standard WASD Movement Physics (Delta-time consistent)
    const { dx, dy } = inputVector;
    const isMoving = dx !== 0 || dy !== 0;

    // Block-hit speed penalty applies even outside the attack state
    const penaltyActive = this.blockHitTimer > 0;

    if (isMoving) {
      this.state = 'running';
      const topSpeed = penaltyActive
        ? CONFIG.player.baseSpeed * CONFIG.combat.blockHitSpeedMult
        : CONFIG.player.baseSpeed;
      const targetVx = dx * topSpeed;
      const targetVy = dy * topSpeed;

      const accelFactor = CONFIG.player.acceleration * dt;
      this.vx += (targetVx - this.vx) * Math.min(1, accelFactor / CONFIG.player.baseSpeed);
      this.vy += (targetVy - this.vy) * Math.min(1, accelFactor / CONFIG.player.baseSpeed);

      // If not locked on, facing direction follows movement
      if (!this.isLockedOn || !this.lockOnTarget || this.lockOnTarget.isDefeated) {
        this.targetFacingAngle = Math.atan2(dy, dx);
      }
    } else {
      this.state = 'idle';
      const damping = Math.exp(-CONFIG.player.friction * dt);
      this.vx *= damping;
      this.vy *= damping;

      if (Math.hypot(this.vx, this.vy) < 1.0) {
        this.vx = 0;
        this.vy = 0;
      }
    }

    // Lock-on facing tracking: smoothly aim/face towards the locked opponent
    if (this.isLockedOn && this.lockOnTarget) {
      if (this.lockOnTarget.isDefeated) {
        this.isLockedOn = false;
        this.lockOnTarget = null;
      } else {
        this.targetFacingAngle = Math.atan2(this.lockOnTarget.y - this.y, this.lockOnTarget.x - this.x);
      }
    }

    // Shortest-path angular lerp
    let angleDiff = this.targetFacingAngle - this.facingAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this.facingAngle += angleDiff * Math.min(1, CONFIG.player.turnSpeed * (this.isLockedOn ? 1.4 : 1.0) * dt);

    // Position integration & arena clamping
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.applyKnockbackPhysics(dt, arena);
    arena.constrainToBounds(this);
    arena.resolveObstacleCollisions(this);

    // Animation & dust timers
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 15) {
      this.walkAnimTimer += dt * (speed / 25);
      this.footstepDustTimer += dt;
      if (this.footstepDustTimer > 0.18) {
        this.footstepDustTimer = 0;
        particleSystem.emitDust(this.x, this.y + 12, this.facingAngle);
      }
    } else {
      this.idleAnimTimer += dt * 3.0;
    }
  }

  applyKnockbackPhysics(dt, arena) {
    if (Math.hypot(this.knockbackVx, this.knockbackVy) > 1.0) {
      this.x += this.knockbackVx * dt;
      this.y += this.knockbackVy * dt;

      // Friction damping on knockback slide (upright slide ~50% farther)
      const kbDamping = Math.exp(-6.5 * dt);
      this.knockbackVx *= kbDamping;
      this.knockbackVy *= kbDamping;

      arena.constrainToBounds(this);
      arena.resolveObstacleCollisions(this);
    } else {
      this.knockbackVx = 0;
      this.knockbackVy = 0;
    }
  }

  /**
   * Trigger next punch in the 4-hit combo sequence
   */
  startPunch() {
    if (this.stunTimer > 0 || this.recoveryTimer > 0 || this.dashType || this.isBlocking || this.isDefeated) {
      return false;
    }

    // Enforce proper attack delay: cannot start if attack active or cooldown delay running
    if (this.currentAttack || this.attackCooldownTimer > 0) {
      return false;
    }

    // If locked on, aim attack directly toward the target
    if (this.isLockedOn && this.lockOnTarget && !this.lockOnTarget.isDefeated) {
      this.facingAngle = Math.atan2(this.lockOnTarget.y - this.y, this.lockOnTarget.x - this.x);
      this.targetFacingAngle = this.facingAngle;
    }

    // Determine combo punch index (0-based: 0 -> Hit 1, 1 -> Hit 2, 2 -> Hit 3, 3 -> Hit 4)
    const punchIndex = this.comboIndex % 4;
    this.currentAttack = CONFIG.combat.punches[punchIndex];
    this.attackTimer = 0;
    this.attackHasHit = false;

    // Advance combo counter and reset timer
    this.comboIndex = punchIndex + 1;
    this.comboResetTimer = CONFIG.combat.comboExpireTimer;

    return true;
  }

  /**
   * Initiate directional dash (W+Q forward, A/D+Q side, S+Q back)
   */
  startDash(inputVector) {
    // Block-hit timer prevents dash start (does NOT reset existing cooldowns)
    if (this.stunTimer > 0 || this.recoveryTimer > 0 || this.dashType || this.isBlocking || this.isDefeated || this.blockHitTimer > 0) {
      return false;
    }

    const { dx, dy } = inputVector;
    const hasMoveInput = dx !== 0 || dy !== 0;

    let dashType = 'forward';
    let dashAngle = this.facingAngle;

    if (hasMoveInput) {
      const moveAngle = Math.atan2(dy, dx);
      let angleDiff = moveAngle - this.facingAngle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const absDiff = Math.abs(angleDiff);
      if (absDiff <= Math.PI * 0.28) {
        dashType = 'forward';
        dashAngle = moveAngle;
      } else if (absDiff >= Math.PI * 0.72) {
        dashType = 'back';
        dashAngle = moveAngle;
      } else {
        dashType = 'side';
        dashAngle = moveAngle;
      }
    } else {
      dashType = 'forward';
      // If locked on and no WASD held, aim forward dash straight at the target
      if (this.isLockedOn && this.lockOnTarget && !this.lockOnTarget.isDefeated) {
        dashAngle = Math.atan2(this.lockOnTarget.y - this.y, this.lockOnTarget.x - this.x);
        this.facingAngle = dashAngle;
        this.targetFacingAngle = dashAngle;
      } else {
        dashAngle = this.facingAngle;
      }
    }

    // Check cooldown for the specific dash type
    if (this.dashCooldowns[dashType] > 0) {
      return false; // Still on cooldown
    }

    // Apply dash config
    let cfg;
    if (dashType === 'forward') {
      cfg = CONFIG.combat.forwardDash;
    } else if (dashType === 'side') {
      cfg = CONFIG.combat.sideDash;
    } else {
      cfg = CONFIG.combat.backDash;
    }

    this.dashType = dashType;
    this.dashTimer = cfg.duration;
    this.dashMaxDuration = cfg.duration;
    this.dashVx = Math.cos(dashAngle) * cfg.speed;
    this.dashVy = Math.sin(dashAngle) * cfg.speed;
    this.dashHasHit = false;

    // Set cooldown immediately
    this.dashCooldowns[dashType] = cfg.cooldown;

    // Interrupt any active punch
    this.currentAttack = null;

    return true;
  }

  interruptDash() {
    if (this.dashType) {
      this.dashType = null;
    }
  }

  takeDamage(amount, stunDuration, knockbackSpeed, attackerAngle) {
    this.health = Math.max(0, this.health - amount);
    this.hurtFlashTimer = 0.14;
    this.hurtShakeTimer = 0.16;

    // Stop active actions
    this.currentAttack = null;
    this.interruptDash();

    if (this.health <= 0) {
      this.isDefeated = true;
      this.health = 0;
      this.stunTimer = 0;
    } else if (stunDuration > 0) {
      this.stunTimer = stunDuration;
    }

    // Upright slide knockback
    if (knockbackSpeed > 0 && attackerAngle !== undefined) {
      this.knockbackVx = Math.cos(attackerAngle) * knockbackSpeed;
      this.knockbackVy = Math.sin(attackerAngle) * knockbackSpeed;
    }
  }

  /**
   * Render fighter silhouette, anime hairstyles, outfits, dynamic animations & overhead HP
   */
  render(ctx) {
    ctx.save();

    // 1. Hurt shudder recoil
    let shakeX = 0;
    let shakeY = 0;
    if (this.hurtShakeTimer > 0) {
      shakeX = (Math.random() - 0.5) * 6;
      shakeY = (Math.random() - 0.5) * 4;
    }

    ctx.translate(this.x + shakeX, this.y + shakeY);

    const speed = Math.hypot(this.vx, this.vy);
    const isMoving = speed > 15;

    const idleBob = Math.sin(this.idleAnimTimer) * 1.5;
    const walkBob = isMoving ? Math.sin(this.walkAnimTimer * 2) * 2.2 : 0;
    const walkSway = isMoving ? Math.cos(this.walkAnimTimer) * 0.12 : 0;
    const currentBob = isMoving ? walkBob : idleBob;

    // 2. Anime Flash-Step Dash (Ghost After-Images)
    if (this.dashType && (this.dashVx !== 0 || this.dashVy !== 0)) {
      const trailOffsets = [0.022, 0.044, 0.066];
      const trailAlphas = [0.35, 0.20, 0.09];
      for (let t = 0; t < trailOffsets.length; t++) {
        const tx = -this.dashVx * trailOffsets[t];
        const ty = -this.dashVy * trailOffsets[t];
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(this.facingAngle);
        ctx.scale(1.22, 0.82); // forward anime speed stretch
        ctx.globalAlpha = trailAlphas[t];

        // Ghost body silhouette
        ctx.beginPath();
        ctx.ellipse(0, 0, 17, 24, 0, 0, Math.PI * 2);
        ctx.fillStyle = this.tunicColor;
        ctx.fill();

        // Ghost hair silhouette
        ctx.beginPath();
        ctx.arc(2, 0, 13, 0, Math.PI * 2);
        ctx.fillStyle = this.headbandColor;
        ctx.fill();

        ctx.restore();
      }
    }

    // 3. Drop Shadows (Directional Ambient Soft Shadow + Crisp Grounding Contact Shadow)
    const shadowScale = 1 - currentBob * 0.035;
    let shadowStretchX = 0;
    let shadowStretchY = 0;
    if (this.dashType) {
      shadowStretchX = -this.dashVx * 0.016;
      shadowStretchY = -this.dashVy * 0.016;
    }

    // Diffused ambient soft drop shadow (offset slightly southeast)
    ctx.beginPath();
    ctx.ellipse(
      shadowStretchX + 3,
      10 + shadowStretchY + 4,
      this.radius * 1.05 * shadowScale,
      this.radius * 0.62 * shadowScale,
      0.15, 0, Math.PI * 2
    );
    ctx.fillStyle = 'rgba(5, 12, 7, 0.36)';
    ctx.fill();

    // Crisp contact grounding shadow right under the feet
    ctx.beginPath();
    ctx.ellipse(0, 6, this.radius * 0.72, this.radius * 0.40, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3, 8, 5, 0.52)';
    ctx.fill();

    // 4. Dynamic Punch Progress & Stance Twist
    let punchExt = 0;
    let punchTwist = 0;
    let isRightPunch = false;
    let punchProgress = 0;
    let punchIndex = 0;

    if (this.currentAttack) {
      punchIndex = (this.comboIndex - 1) % 4; // 0, 1, 2, 3
      isRightPunch = punchIndex % 2 === 1;   // 0=L, 1=R, 2=L, 3=R (Heavy Finisher)
      const totalAttackDuration = this.currentAttack.windup + this.currentAttack.active + this.currentAttack.recovery;
      punchProgress = Math.min(1, Math.max(0, this.attackTimer / totalAttackDuration));

      if (punchProgress < 0.22) {
        // Snappy anime windup recoil
        punchExt = -4.5 * (punchProgress / 0.22);
      } else if (punchProgress < 0.58) {
        // Explosive forward strike thrust reaching out to opponent
        const t = (punchProgress - 0.22) / 0.36;
        const maxReach = punchIndex === 3 ? 27 : 24; // Finisher reaches farthest!
        punchExt = -4.5 + Math.sin(t * Math.PI * 0.5) * (maxReach + 4.5);
      } else {
        // Crisp recovery back to stance
        const t = (punchProgress - 0.58) / 0.42;
        punchExt = 22 * (1 - t);
      }

      // Torso twist into punch
      const twistMult = punchIndex === 3 ? 0.20 : 0.15;
      punchTwist = (isRightPunch ? twistMult : -twistMult) * (punchExt / 24);
    }

    // 5. Rotate fighter to face target direction with walk sway and punch rotation
    ctx.rotate(this.facingAngle + walkSway + punchTwist);

    // Dynamic squish & stretch animations
    if (this.hurtShakeTimer > 0) {
      // Hit reaction: compression along facing angle gives immediate physical weight
      ctx.scale(1.14, 0.86);
    } else if (this.dashType) {
      // Dash animation: forward lean into the dash
      ctx.scale(1.22, 0.82);
    } else if (!isMoving) {
      // Idle animation: organic breathing expansion
      const breath = 1 + Math.sin(this.idleAnimTimer * 2.2) * 0.025;
      ctx.scale(breath, breath);
    }

    // --- CHARACTER VISUAL IDENTIFIERS ---
    const isFlashing = this.hurtFlashTimer > 0;
    const isBag = this.name === 'Bag';
    const isPlayer = this.isPlayer || this.name === 'Player';

    // A. Martial Cloak / Tunic Fringe (Trailing behind character with lag)
    const fringeFlutter = isMoving ? Math.sin(this.walkAnimTimer * 2) * 4 : Math.sin(this.idleAnimTimer * 1.5) * 1.8;
    ctx.beginPath();
    ctx.ellipse(-15 - fringeFlutter, 0, 11, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = isFlashing
      ? '#ffffff'
      : (isBag ? '#25213b' : (isPlayer ? '#143820' : '#450a0a'));
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = isBag ? '#121020' : (isPlayer ? '#0c1810' : '#1a0808');
    ctx.stroke();

    // B. Shoulders & Torso with Anime Cel-Shading
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 23.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = isFlashing ? '#ff4d4d' : this.tunicColor;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = isBag ? '#121020' : (isPlayer ? '#0c1810' : '#1a0808');
    ctx.stroke();

    // Outfit Details based on Character Identity
    if (isBag) {
      // Passive Dummy ("Zen" - Stoic Training Monk Apprentice)
      ctx.save();
      // Crossed white collar lapels
      ctx.beginPath();
      ctx.moveTo(-2, -12); ctx.lineTo(10, 0); ctx.lineTo(-2, 12);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isFlashing ? '#ffffff' : '#f8fafc';
      ctx.stroke();

      // Lavender silk trim
      ctx.beginPath();
      ctx.moveTo(-1, -14); ctx.lineTo(12, 0); ctx.lineTo(-1, 14);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = isFlashing ? '#ffffff' : '#c084fc';
      ctx.stroke();

      // Wide folded training obi belt
      ctx.beginPath();
      ctx.rect(-4, -16, 7, 32);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#312e81';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#1e1b4b';
      ctx.stroke();

      // Wooden training talisman / belt knot
      ctx.beginPath();
      ctx.arc(-4, -8, 3, 0, Math.PI * 2);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#b45309';
      ctx.fill();
      ctx.restore();

    } else if (isPlayer) {
      // Player ("Ren" - Emerald Martial Hero)
      ctx.save();
      // Open V-neck white undershirt
      ctx.beginPath();
      ctx.moveTo(2, -8); ctx.lineTo(9, 0); ctx.lineTo(2, 8);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#e2e8f0';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#0c1810';
      ctx.stroke();

      // Golden-piped shoulder spaulders
      ctx.beginPath();
      ctx.arc(0, -17, 6, 0, Math.PI * 2);
      ctx.arc(0, 17, 6, 0, Math.PI * 2);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#2d7a46';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#eab308';
      ctx.stroke();

      // Flowing golden martial obi sash
      ctx.beginPath();
      ctx.rect(-3.5, -16, 7, 32);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#d97706';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#78350f';
      ctx.stroke();

      // Twin sash knot tassels trailing dynamically on left flank
      const sashSway = isMoving ? Math.sin(this.walkAnimTimer * 2.2) * 4 : Math.sin(this.idleAnimTimer * 1.6) * 2;
      ctx.beginPath();
      ctx.moveTo(-3, -16);
      ctx.quadraticCurveTo(-14, -22 + sashSway, -22, -18 + sashSway);
      ctx.moveTo(-3, -12);
      ctx.quadraticCurveTo(-12, -18 + sashSway, -18, -14 + sashSway);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = isFlashing ? '#ffffff' : '#f59e0b';
      ctx.stroke();
      ctx.restore();

    } else {
      // Fighting Dummy ("Kage" - Crimson Brawler Rival)
      ctx.save();
      // Popped high battle collar behind neck
      ctx.beginPath();
      ctx.arc(-8, 0, 14, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = isFlashing ? '#ffffff' : '#1f1414';
      ctx.stroke();

      // Heavy riveted iron shoulder pauldrons
      ctx.beginPath();
      ctx.ellipse(-1, -18, 8, 6, 0, 0, Math.PI * 2);
      ctx.ellipse(-1, 18, 8, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#475569';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      // Bronze pauldron rivet studs
      ctx.beginPath();
      ctx.arc(-1, -18, 2, 0, Math.PI * 2);
      ctx.arc(-1, 18, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();

      // Heavy studded leather chest cross-harness with steel buckle
      ctx.beginPath();
      ctx.rect(-4, -16, 7.5, 32);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#18181b';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#3f3f46';
      ctx.stroke();

      // Buckle
      ctx.beginPath();
      ctx.rect(-5, -4, 4, 8);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.restore();
    }

    // C. Martial Hands / Stances & Dynamic Anime Punching
    let leftHandX = 14;
    let leftHandY = -15;
    let rightHandX = 14;
    let rightHandY = 15;

    if (this.currentAttack) {
      if (isRightPunch) {
        rightHandX += punchExt;
        leftHandX -= 5; // tight chin guard chamber
        leftHandY += 3;
      } else {
        leftHandX += punchExt;
        rightHandX -= 5;
        rightHandY -= 3;
      }
    } else if (this.isBlocking) {
      // Anime braced cross-arm defensive stance
      leftHandX = 10;
      leftHandY = -5;
      rightHandX = 10;
      rightHandY = 5;
    } else if (isMoving) {
      // Athletic arm swing with walking stride
      leftHandX += Math.sin(this.walkAnimTimer) * 5;
      rightHandX -= Math.sin(this.walkAnimTimer) * 5;
    } else if (!isBag) {
      // Idle breathing hand drift
      leftHandX += Math.sin(this.idleAnimTimer * 0.9) * 0.8;
      rightHandX += Math.sin(this.idleAnimTimer * 0.9 + 1) * 0.8;
    }

    // Kinetic Anime Punch Visual Effects
    if (this.currentAttack && punchProgress >= 0.22 && punchProgress <= 0.62) {
      const punchHandX = isRightPunch ? rightHandX : leftHandX;
      const punchHandY = isRightPunch ? rightHandY : leftHandY;
      ctx.save();

      if (punchIndex === 3) {
        // FINISHER (Punch 4): Heavy Straight with Anime Shockwave Ring!
        const shockRadius = 12 + (punchProgress - 0.22) * 28;
        ctx.beginPath();
        ctx.arc(punchHandX + 4, punchHandY, shockRadius, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = isPlayer ? 'rgba(56, 239, 125, 0.85)' : 'rgba(239, 68, 68, 0.85)';
        ctx.stroke();

        // Expanding radial impact burst lines
        for (let b = 0; b < 6; b++) {
          const ba = (b / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(punchHandX + 4 + Math.cos(ba) * 8, punchHandY + Math.sin(ba) * 8);
          ctx.lineTo(punchHandX + 4 + Math.cos(ba) * (shockRadius + 4), punchHandY + Math.sin(ba) * (shockRadius + 4));
          ctx.lineWidth = 1.8;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        }
      } else {
        // COMBOS 1, 2, 3: Dynamic Curved Anime Speed Swipe
        ctx.beginPath();
        ctx.arc(punchHandX + 6, punchHandY, 13, -Math.PI * 0.4, Math.PI * 0.4);
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = isFlashing
          ? '#ffffff'
          : (isPlayer ? 'rgba(56, 239, 125, 0.85)' : 'rgba(248, 113, 113, 0.85)');
        ctx.stroke();

        // Inner white speed core
        ctx.beginPath();
        ctx.arc(punchHandX + 6, punchHandY, 10, -Math.PI * 0.3, Math.PI * 0.3);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.stroke();
      }
      ctx.restore();
    }

    // Render Clenched Martial Anime Fists
    const handRadius = isBag ? 7.0 : 6.8;
    const handFill = isFlashing
      ? '#ffffff'
      : (isBag ? '#a88c6c' : (isPlayer ? '#f8fafc' : '#27272a'));
    const handBorder = isBag
      ? '#3b2f21'
      : (isPlayer ? '#0c1810' : '#18181b');

    // Left Hand
    ctx.beginPath();
    ctx.arc(leftHandX, leftHandY, handRadius, 0, Math.PI * 2);
    ctx.fillStyle = handFill;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = handBorder;
    ctx.stroke();

    // Hand wrap detail / metal knuckle plate
    if (isPlayer) {
      // Steel knuckle plate
      ctx.beginPath();
      ctx.arc(leftHandX + 2, leftHandY, 3.2, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
    } else if (!isBag) {
      // Spiked combat stud
      ctx.beginPath();
      ctx.arc(leftHandX + 2, leftHandY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
    }

    // Right Hand
    ctx.beginPath();
    ctx.arc(rightHandX, rightHandY, handRadius, 0, Math.PI * 2);
    ctx.fillStyle = handFill;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = handBorder;
    ctx.stroke();

    if (isPlayer) {
      ctx.beginPath();
      ctx.arc(rightHandX + 2, rightHandY, 3.2, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
    } else if (!isBag) {
      ctx.beginPath();
      ctx.arc(rightHandX + 2, rightHandY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
    }

    // D. ANIME HEAD & HAIRSTYLE (Distinct Top-Down Anime Identity)
    ctx.save();
    // Head skin base
    ctx.beginPath();
    ctx.ellipse(3, 0, 11, 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = isFlashing ? '#ffffff' : '#fcd3b8'; // warm anime skin tone
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = isBag ? '#121020' : (isPlayer ? '#0c1810' : '#1a0808');
    ctx.stroke();

    // Pointed chin/nose profile along facing direction (+X)
    ctx.beginPath();
    ctx.moveTo(10, -3);
    ctx.lineTo(14, 0);
    ctx.lineTo(10, 3);
    ctx.fillStyle = isFlashing ? '#ffffff' : '#fcd3b8';
    ctx.fill();

    // Expressive Anime Eyes looking forward
    if (isBag) {
      // Serene closed meditative eyes
      ctx.beginPath();
      ctx.arc(8, -4, 2.5, Math.PI * 0.9, Math.PI * 1.9);
      ctx.arc(8, 4, 2.5, Math.PI * 0.9, Math.PI * 1.9);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#475569';
      ctx.stroke();
    } else if (isPlayer) {
      // Determined emerald anime eyes
      ctx.beginPath();
      ctx.ellipse(8, -4, 2.2, 1.4, 0.2, 0, Math.PI * 2);
      ctx.ellipse(8, 4, 2.2, 1.4, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#064e3b';
      ctx.stroke();
      // White eye catchlight
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(8.5, -4.5, 1, 1);
      ctx.fillRect(8.5, 3.5, 1, 1);
    } else {
      // Fierce angled brawler amber eyes
      ctx.beginPath();
      ctx.ellipse(8, -4, 2.4, 1.2, 0.35, 0, Math.PI * 2);
      ctx.ellipse(8, 4, 2.4, 1.2, -0.35, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#7c2d12';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(8.5, -4.5, 1, 1);
      ctx.fillRect(8.5, 3.5, 1, 1);
    }

    // --- ANIME HAIRSTYLES ---
    if (isBag) {
      // Sleek silver-lavender anime samurai hair with formal topknot/bun
      ctx.fillStyle = isFlashing ? '#ffffff' : '#cbd5e1'; // base silver
      // Parted side hair masses
      ctx.beginPath();
      ctx.arc(1, 0, 11.5, Math.PI * 0.45, Math.PI * 1.55);
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#334155';
      ctx.stroke();

      // Lavender cel-shading
      ctx.fillStyle = isFlashing ? '#ffffff' : '#a78bfa';
      ctx.beginPath();
      ctx.arc(-2, 0, 9, Math.PI * 0.6, Math.PI * 1.4);
      ctx.fill();

      // Topknot bun at the back
      ctx.beginPath();
      ctx.arc(-11, 0, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#7c3aed';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#334155';
      ctx.stroke();

      // Wooden hairpin
      ctx.beginPath();
      ctx.moveTo(-11, -8); ctx.lineTo(-11, 8);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#b45309';
      ctx.stroke();

    } else if (isPlayer) {
      // Player ("Ren"): Spiky layered anime hero hair (7 distinct spikes)
      const hairSpikes = [
        { x: -14, y: 0, r: 6.5 },
        { x: -12, y: -6, r: 6 },
        { x: -12, y: 6, r: 6 },
        { x: -7, y: -10, r: 5.5 },
        { x: -7, y: 10, r: 5.5 },
        { x: -2, y: -11, r: 5 },
        { x: -2, y: 11, r: 5 },
      ];

      // Hair Spikes (Obsidian-charcoal base with emerald cel-shading)
      ctx.fillStyle = isFlashing ? '#ffffff' : '#121a14';
      ctx.strokeStyle = '#061009';
      ctx.lineWidth = 1.8;

      for (const hs of hairSpikes) {
        ctx.beginPath();
        ctx.arc(hs.x, hs.y, hs.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Hair Crown Volume & Emerald Highlights
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#1b3824';
      ctx.fill();
      ctx.stroke();

      // Emerald hair shine / specular rim
      ctx.strokeStyle = isFlashing ? '#ffffff' : '#38ef7d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-3, -4, 6, Math.PI * 0.8, Math.PI * 1.5);
      ctx.arc(-3, 4, 6, -Math.PI * 1.5, -Math.PI * 0.8);
      ctx.stroke();

      // Metallic Forehead Protector / Headband
      ctx.beginPath();
      ctx.arc(5, 0, 10.5, -Math.PI / 2.2, Math.PI / 2.2);
      ctx.lineWidth = 4.2;
      ctx.strokeStyle = this.headbandColor;
      ctx.stroke();

      // Steel Plate on forehead
      ctx.beginPath();
      ctx.rect(8, -5, 3.5, 10);
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#475569';
      ctx.stroke();
      // Rivets
      ctx.fillStyle = '#eab308';
      ctx.fillRect(8.5, -4, 1.2, 1.2);
      ctx.fillRect(8.5, 3, 1.2, 1.2);

      // Twin Dynamic Flowing Headband Ribbon Tails
      const ribbonSpeed = isMoving ? this.walkAnimTimer * 2.5 : this.idleAnimTimer * 1.6;
      const ribbonFlutter1 = Math.sin(ribbonSpeed) * 5;
      const ribbonFlutter2 = Math.cos(ribbonSpeed * 1.2) * 4.5;

      // Ribbon Strand 1
      ctx.beginPath();
      ctx.moveTo(-8, -2);
      ctx.quadraticCurveTo(-20, -7 + ribbonFlutter1, -30, -3 + ribbonFlutter1);
      ctx.lineWidth = 2.8;
      ctx.strokeStyle = this.headbandColor;
      ctx.stroke();

      // Ribbon Strand 2
      ctx.beginPath();
      ctx.moveTo(-8, 2);
      ctx.quadraticCurveTo(-18, 5 + ribbonFlutter2, -28, 7 + ribbonFlutter2);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#10b981';
      ctx.stroke();

    } else {
      // Fighting Dummy ("Kage"): Wild jagged flame-spike anime hair (8 spikes)
      const flameSpikes = [
        { x: -15, y: -2, r: 6.8 },
        { x: -14, y: 5, r: 6.5 },
        { x: -11, y: -8, r: 6.2 },
        { x: -10, y: 10, r: 6.2 },
        { x: -5, y: -12, r: 5.5 },
        { x: -4, y: 12, r: 5.5 },
        { x: 1, y: -12, r: 4.8 },
        { x: 2, y: 12, r: 4.8 },
      ];

      ctx.fillStyle = isFlashing ? '#ffffff' : '#1c0d0f'; // deep obsidian-red
      ctx.strokeStyle = '#100608';
      ctx.lineWidth = 1.8;

      for (const fs of flameSpikes) {
        ctx.beginPath();
        ctx.arc(fs.x, fs.y, fs.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Hair Crown Volume & Fiery Crimson Cel-Shading
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fillStyle = isFlashing ? '#ffffff' : '#7f1d1d';
      ctx.fill();
      ctx.stroke();

      // Flame hair tip highlights
      ctx.fillStyle = isFlashing ? '#ffffff' : '#ef4444';
      ctx.beginPath();
      ctx.arc(-13, -2, 3, 0, Math.PI * 2);
      ctx.arc(-10, -7, 2.5, 0, Math.PI * 2);
      ctx.arc(-9, 8, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Blackened Iron Combat Headband with Horned Crest
      ctx.beginPath();
      ctx.arc(5, 0, 10.5, -Math.PI / 2.2, Math.PI / 2.2);
      ctx.lineWidth = 4.2;
      ctx.strokeStyle = '#27272a';
      ctx.stroke();

      // Spiked Combat Crest
      ctx.beginPath();
      ctx.moveTo(8, -6); ctx.lineTo(12, 0); ctx.lineTo(8, 6);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#7f1d1d';
      ctx.stroke();

      // Jagged dark-red ribbon tails
      const ribbonSpeed = isMoving ? this.walkAnimTimer * 2.5 : this.idleAnimTimer * 1.6;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.quadraticCurveTo(-18, -6 + Math.sin(ribbonSpeed) * 4, -28, -2 + Math.sin(ribbonSpeed) * 4);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#f87171';
      ctx.stroke();
    }

    ctx.restore(); // Restore anime head transform

    // E. DEFENSIVE GUARD SHIELD ARC (Anime 180° Hex Energy Barrier)
    if (this.isBlocking) {
      // Outer glowing energy barrier arc (180 degrees)
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 16, -Math.PI / 2, Math.PI / 2);
      ctx.lineWidth = 5.5;
      ctx.strokeStyle = isPlayer ? 'rgba(74, 222, 128, 0.95)' : 'rgba(248, 113, 113, 0.95)';
      ctx.shadowColor = isPlayer ? '#38ef7d' : '#ef4444';
      ctx.shadowBlur = 16;
      ctx.stroke();

      // Inner concentrated white energy line
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 12, -Math.PI / 2, Math.PI / 2);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowBlur = 6;
      ctx.stroke();

      // 3 Defensive Energy Notches at -45°, 0°, +45°
      const notchAngles = [-Math.PI * 0.25, 0, Math.PI * 0.25];
      for (const na of notchAngles) {
        const nx1 = Math.cos(na) * (this.radius + 10);
        const ny1 = Math.sin(na) * (this.radius + 10);
        const nx2 = Math.cos(na) * (this.radius + 19);
        const ny2 = Math.sin(na) * (this.radius + 19);
        ctx.beginPath();
        ctx.moveTo(nx1, ny1);
        ctx.lineTo(nx2, ny2);
        ctx.lineWidth = 2.8;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    ctx.restore(); // Restore fighter orientation transform

    // --- OVERHEAD HUD: STUN STARS & HEALTH BAR ---
    ctx.save();
    ctx.translate(this.x, this.y);

    // 1. Stun Indicators (Spinning yellow stars)
    if (this.stunTimer > 0) {
      const starAngle = performance.now() * 0.006;
      for (let s = 0; s < 3; s++) {
        const sa = starAngle + (s * Math.PI * 2) / 3;
        const sx = Math.cos(sa) * 20;
        const sy = -38 + Math.sin(sa) * 6;
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#f6e05e';
        ctx.shadowColor = '#ecc94b';
        ctx.shadowBlur = 6;
        ctx.fill();
      }
    }

    // 2. Visible Overhead Health Bar
    const barWidth = 64;
    const barHeight = 7;
    const barY = -48;

    // Background Container
    ctx.fillStyle = 'rgba(10, 20, 14, 0.85)';
    ctx.beginPath();
    ctx.roundRect(-barWidth / 2 - 2, barY - 2, barWidth + 4, barHeight + 4, 3);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();

    // Health Fill Bar
    const hpRatio = Math.max(0, this.health / this.maxHealth);
    ctx.fillStyle = this.hpBarColor;
    if (hpRatio < 0.3) ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.roundRect(-barWidth / 2, barY, Math.max(0, barWidth * hpRatio), barHeight, 2);
    ctx.fill();

    // Name Label & Current HP Number
    ctx.font = "700 11px 'Outfit', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e2f5e7';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(`${this.name} (${Math.ceil(this.health)})`, 0, barY - 6);

    // Defeated banner
    if (this.isDefeated) {
      ctx.font = "800 12px 'Outfit', sans-serif";
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('DEFEATED - Press [R]', 0, barY + 22);
    }

    ctx.restore();
  }
}

// ============================================================================
// 7. COMBAT SYSTEM (Hit Detection, 4-Hit Combo, 180° Block & Dash Strikes)
// ============================================================================
class CombatSystem {
  constructor(floatingTextSystem, particleSystem) {
    this.textSystem = floatingTextSystem;
    this.particleSystem = particleSystem;
  }

  update(player, opponent) {
    if (!player || !opponent) return;

    // 1. Check Player's Attack against Opponent
    this.checkFighterAttack(player, opponent);

    // 2. Check Player's Forward Dash Strike against Opponent
    this.checkDashStrike(player, opponent);
  }

  /**
   * Resolves punch attack hitboxes, 180-degree front block, and combos
   */
  checkFighterAttack(attacker, defender) {
    if (!attacker.currentAttack || attacker.attackHasHit || defender.isDefeated) return;

    const attack = attacker.currentAttack;
    // Check if attack is in its active frame window
    if (attacker.attackTimer < attack.windup || attacker.attackTimer > attack.windup + attack.active) {
      return;
    }

    const dx = defender.x - attacker.x;
    const dy = defender.y - attacker.y;
    const dist = Math.hypot(dx, dy);

    // 1. Range Check
    const reach = attacker.radius + defender.radius + attack.range;
    if (dist > reach) return;

    // 2. Facing Direction Check (Must be facing toward defender)
    const angleToDefender = Math.atan2(dy, dx);
    let facingDiff = angleToDefender - attacker.facingAngle;
    while (facingDiff > Math.PI) facingDiff -= Math.PI * 2;
    while (facingDiff < -Math.PI) facingDiff += Math.PI * 2;

    if (Math.abs(facingDiff) > Math.PI * 0.44) {
      return; // Outside punch arc
    }

    // Hit connected! Prevent multiple hits from single swing
    attacker.attackHasHit = true;

    // 3. Check Defender's Block (Protects front 180 degrees)
    const isBlocked = this.isAttackBlocked(attacker, defender);

    if (isBlocked) {
      // --- SUCCESSFUL BLOCK ---
      // 0 HP damage. Attacker suffers block-hit dash-lock + speed penalty.
      // No stun reset on defender. Attacker combo resets.
      attacker.comboIndex = 0;
      attacker.currentAttack = null;
      // Apply block-hit penalty: heavy movement slow + dash lockout for 0.5s
      attacker.blockHitTimer = CONFIG.combat.blockHitDashLock;
      // NOTE: blockStaggerDuration recovery freeze is intentionally NOT applied here.
      // The "blocked attack stuns the attacker" behaviour is replaced by the new penalty.

      // Visuals: Block spark & popup
      this.particleSystem.emitHitSparks(
        (attacker.x + defender.x) / 2,
        (attacker.y + defender.y) / 2,
        14,
        true
      );
      this.textSystem.spawn(defender.x, defender.y - 20, 'BLOCKED', 'rgb(56, 239, 125)', 16);
      return;
    }

    // --- SUCCESSFUL CLEAN HIT ---
    const damage = attack.damage;
    const stun = attack.stunDuration || 0;
    const knockback = attack.knockback || 0;

    defender.takeDamage(damage, stun, knockback, attacker.facingAngle);

    // Hit sparks & floating damage text
    this.particleSystem.emitHitSparks(
      (attacker.x + defender.x) / 2,
      (attacker.y + defender.y) / 2,
      12,
      false
    );
    this.textSystem.spawn(defender.x, defender.y - 20, `-${damage}`, 'rgb(255, 77, 77)', 18);
  }

  /**
   * Resolves Forward Dash Punch hit against opponent
   */
  checkDashStrike(attacker, defender) {
    if (attacker.dashType !== 'forward' || attacker.dashHasHit || defender.isDefeated) return;

    const dx = defender.x - attacker.x;
    const dy = defender.y - attacker.y;
    const dist = Math.hypot(dx, dy);
    const reach = attacker.radius + defender.radius + CONFIG.combat.forwardDash.range;

    if (dist > reach) return;

    // Strike connected!
    attacker.dashHasHit = true;
    attacker.dashType = null; // Dash ends on contact

    // Check if defender blocked the dash
    const isBlocked = this.isAttackBlocked(attacker, defender);

    if (isBlocked) {
      // --- GENEROUS PERFECT BLOCK ---
      // Attacker is stunned for 1.25s, knocked back slightly, defender takes 0 damage
      attacker.stunTimer = CONFIG.combat.forwardDash.perfectBlockStun;
      attacker.knockbackVx = -Math.cos(attacker.facingAngle) * 220;
      attacker.knockbackVy = -Math.sin(attacker.facingAngle) * 220;

      this.particleSystem.emitHitSparks(
        (attacker.x + defender.x) / 2,
        (attacker.y + defender.y) / 2,
        18,
        true
      );
      this.textSystem.spawn(defender.x, defender.y - 24, 'PERFECT BLOCK!', 'rgb(246, 224, 94)', 18, 1.2);
      return;
    }

    // --- CLEAN DASH STRIKE ---
    defender.takeDamage(
      CONFIG.combat.forwardDash.damage,
      CONFIG.combat.forwardDash.stunDuration,
      320,
      attacker.facingAngle
    );

    this.particleSystem.emitHitSparks(
      (attacker.x + defender.x) / 2,
      (attacker.y + defender.y) / 2,
      16,
      false
    );
    this.textSystem.spawn(defender.x, defender.y - 20, `-${CONFIG.combat.forwardDash.damage}`, 'rgb(255, 120, 60)', 20);
  }

  /**
   * Evaluates if attack enters defender's front 180-degree blocking arc
   */
  isAttackBlocked(attacker, defender) {
    if (!defender.isBlocking) return false;

    // Vector from defender to attacker
    const dx = attacker.x - defender.x;
    const dy = attacker.y - defender.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0001) return true;

    const nx = dx / dist;
    const ny = dy / dist;

    // Defender's facing unit vector
    const fx = Math.cos(defender.facingAngle);
    const fy = Math.sin(defender.facingAngle);

    // Dot product: cos(theta) >= 0.0 represents the front 180 degrees
    const dot = fx * nx + fy * ny;
    return dot >= CONFIG.combat.blockAngleThreshold;
  }
}

// ============================================================================
// 7b. AI CONTROLLER (Combat Dummy Brain — activates after first hit)
// ============================================================================
class AIController {
  constructor(dummy, player) {
    this.dummy = dummy;
    this.player = player;

    // Activation
    this.isActivated = false;

    // Phase state machine
    // Phases: 'idle' | 'approach' | 'strafe' | 'pressure' | 'sidestep' | 'retreat' | 'blockBrief'
    this.phase = 'idle';
    this.phaseTimer = 0;
    this.phaseDuration = 0;

    // Timers
    this.decisionTimer = 0;     // How long until next decision
    this.comboTimer = 0;        // Rhythm timer for chained punches
    this.strafeSign = 1;        // Strafe clockwise (+1) or counter (-1)

    // Blocking gate: tracks how long block has been held this cycle
    this.blockHeldTimer = 0;
    this.maxBlockHold = 0.55;   // Never hold block longer than this before forcing a phase exit

    // Range thresholds (px)
    this.attackRange = 110;     // Start throwing punches inside this
    this.engageRange = 160;     // Forward-dash engagement threshold
  }

  activate() {
    if (this.isActivated) return;
    this.isActivated = true;
    this.dummy.isLockedOn = true;
    this.dummy.lockOnTarget = this.player;
    this._setPhase('approach', 0.4 + Math.random() * 0.3);
  }

  reset() {
    this.isActivated = false;
    this.phase = 'idle';
    this.phaseTimer = 0;
    this.phaseDuration = 0;
    this.decisionTimer = 0;
    this.comboTimer = 0;
    this.blockHeldTimer = 0;
    this.strafeSign = 1;
    this.dummy.isLockedOn = false;
    this.dummy.lockOnTarget = null;
  }

  _setPhase(phase, duration) {
    this.phase = phase;
    this.phaseDuration = duration;
    this.phaseTimer = 0;
    if (phase !== 'blockBrief') this.blockHeldTimer = 0;
  }

  _normVec(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < 0.001) return { dx: 0, dy: 0 };
    return { dx: x / mag, dy: y / mag };
  }

  /**
   * Main AI tick — returns { inputVector, wantsM1, wantsDash, wantsBlock }
   */
  update(dt) {
    if (!this.isActivated || this.dummy.isDefeated || this.player.isDefeated) {
      return { inputVector: { dx: 0, dy: 0 }, wantsM1: false, wantsDash: false, wantsBlock: false };
    }

    // Tick timers
    this.phaseTimer  += dt;
    this.decisionTimer = Math.max(0, this.decisionTimer - dt);
    this.comboTimer    = Math.max(0, this.comboTimer - dt);

    const isStunned = this.dummy.stunTimer > 0 || this.dummy.recoveryTimer > 0;
    if (isStunned) {
      this.blockHeldTimer = 0;
      return { inputVector: { dx: 0, dy: 0 }, wantsM1: false, wantsDash: false, wantsBlock: false };
    }

    // Spatial awareness
    const dx   = this.player.x - this.dummy.x;
    const dy   = this.player.y - this.dummy.y;
    const dist = Math.hypot(dx, dy);
    const angleToPlayer = Math.atan2(dy, dx);

    const playerAttacking  = !!this.player.currentAttack;
    const playerDashing    = !!this.player.dashType;
    const playerFwdDashing = this.player.dashType === 'forward';
    const playerIsStunned  = this.player.stunTimer > 0;
    const playerIsVulnerable = playerIsStunned || this.player.recoveryTimer > 0;
    const playerJustBlocked  = this.player.blockHitTimer > 0; // player hit our block
    const isLowHP          = this.dummy.health < 35;
    const isMidHP          = this.dummy.health < 60;

    // ── Combo pursuit: if the player is stunned, keep pressing the combo ──
    // This overrides the regular decision cycle until stun clears or we run out of range.
    if (playerIsVulnerable && dist < this.attackRange) {
      const moveVec = dist > 58 ? this._normVec(dx, dy) : { dx: 0, dy: 0 };
      const wantsM1 = this.comboTimer <= 0;
      if (wantsM1) this.comboTimer = 0.26 + Math.random() * 0.14; // tight combo rhythm
      // Capitalize on opening: also use forward dash if available and not already close
      const wantsDash = dist > 70 && this.dummy.dashCooldowns.forward <= 0 && Math.random() < 0.12;
      return { inputVector: moveVec, wantsM1, wantsDash, wantsBlock: false };
    }

    // ── Capitalize on block-hit opening: player just hit our block ──
    if (playerJustBlocked && dist < this.attackRange + 20) {
      const moveVec = dist > 60 ? this._normVec(dx, dy) : { dx: 0, dy: 0 };
      const wantsM1 = this.comboTimer <= 0;
      if (wantsM1) this.comboTimer = 0.26 + Math.random() * 0.14;
      return { inputVector: moveVec, wantsM1, wantsDash: false, wantsBlock: false };
    }

    // ── High-priority reactive interrupts (run every frame) ──
    let reactBlock = false;

    // React to incoming forward dash (gated by decision timer)
    if (playerFwdDashing && dist < 220 && this.decisionTimer <= 0) {
      if (Math.random() < 0.60) {
        this._setPhase('blockBrief', 0.38 + Math.random() * 0.18);
      }
      this.decisionTimer = 0.20;
    }

    // React to a punch active frame landing close (imperfect human-like)
    if (playerAttacking && dist < this.attackRange + 15 && this.decisionTimer <= 0) {
      if (Math.random() < 0.45) reactBlock = true;
      this.decisionTimer = 0.15;
    }

    // ── Periodic decision cycle ──
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 0.20 + Math.random() * 0.15;
      this._decide(dist, playerAttacking, playerDashing, isLowHP, isMidHP);
    }

    // ── Execute current phase ──
    let inputVector = { dx: 0, dy: 0 };
    let wantsM1    = false;
    let wantsDash  = false;
    let wantsBlock = false;

    switch (this.phase) {

      // ── APPROACH: close the gap efficiently ──
      case 'approach': {
        if (dist > this.attackRange * 0.6) {
          inputVector = this._normVec(dx, dy);
        }
        // Use side-dash to close gap if cooldown ready and still far
        if (dist > this.attackRange && this.dummy.dashCooldowns.side <= 0 && Math.random() < 0.025) {
          wantsDash = true;
          inputVector = this._normVec(dx, dy); // side-dash toward player
        }
        if (dist < this.attackRange && this.phaseTimer > 0.15) {
          this._setPhase('pressure', 0.55 + Math.random() * 0.55);
        } else if (this.phaseTimer >= this.phaseDuration) {
          this._setPhase('strafe', 0.4 + Math.random() * 0.4);
        }
        break;
      }

      // ── PRESSURE: in-range, throw combo punches ──
      case 'pressure': {
        // Drift slightly toward player to stay in range
        if (dist > this.attackRange * 0.75) {
          inputVector = this._normVec(dx, dy);
        } else if (dist < 58) {
          // Too close — micro back-step
          inputVector = this._normVec(-dx, -dy);
        }

        if (dist < this.attackRange && this.comboTimer <= 0) {
          wantsM1 = true;
          // Rhythm: faster chains (0.28–0.48s), simulating combo timing
          this.comboTimer = 0.28 + Math.random() * 0.20;
        }

        // Occasionally use forward dash to close gap and strike
        if (dist > this.attackRange * 0.7 && dist < this.engageRange &&
            this.dummy.dashCooldowns.forward <= 0 && Math.random() < 0.03) {
          wantsDash = true;
          inputVector = this._normVec(dx, dy);
        }

        if (this.phaseTimer >= this.phaseDuration) {
          const r = Math.random();
          if (r < 0.28)      this._setPhase('strafe',    0.35 + Math.random() * 0.4);
          else if (r < 0.44) this._setPhase('sidestep',  0.25 + Math.random() * 0.2);
          else if (r < 0.56) this._setPhase('blockBrief',0.28 + Math.random() * 0.18);
          else               this._setPhase('approach',  0.2  + Math.random() * 0.3);
        }
        break;
      }

      // ── STRAFE: orbit player, maintain range ──
      case 'strafe': {
        // Pick a consistent strafe direction for the whole phase
        const perpAngle = angleToPlayer + (Math.PI / 2) * this.strafeSign;
        const sX = Math.cos(perpAngle);
        const sY = Math.sin(perpAngle);
        const bias = dist > this.attackRange + 30 ? 0.55 : (dist < 58 ? -0.45 : 0.0);
        inputVector = this._normVec(sX + Math.cos(angleToPlayer) * bias,
                                    sY + Math.sin(angleToPlayer) * bias);

        // Use side-dash in the strafe direction as a dodge/reposition
        if (this.dummy.dashCooldowns.side <= 0 && this.phaseTimer > 0.15 && Math.random() < 0.025) {
          wantsDash = true;
        }

        if (this.phaseTimer >= this.phaseDuration) {
          this.strafeSign = Math.random() < 0.5 ? 1 : -1; // Possibly flip direction next strafe
          const r = Math.random();
          if (r < 0.50) this._setPhase('pressure', 0.5 + Math.random() * 0.5);
          else          this._setPhase('approach',  0.3 + Math.random() * 0.3);
        }
        break;
      }

      // ── SIDESTEP: quick directional dash escape ──
      case 'sidestep': {
        // Move perpendicular then transition
        const perpAngle2 = angleToPlayer + (Math.PI / 2) * this.strafeSign;
        inputVector = { dx: Math.cos(perpAngle2), dy: Math.sin(perpAngle2) };

        // Use back-dash if cooldown ready
        if (this.dummy.dashCooldowns.back <= 0 && this.phaseTimer < 0.05) {
          wantsDash = true;
          inputVector = this._normVec(-dx, -dy); // backward dash input
        }

        if (this.phaseTimer >= this.phaseDuration) {
          this._setPhase('pressure', 0.45 + Math.random() * 0.4);
        }
        break;
      }

      // ── BLOCK BRIEF: short defensive window, then counter ──
      case 'blockBrief': {
        wantsBlock = true;
        this.blockHeldTimer += dt;

        // Slight back-step while blocking if player is very close
        if (dist < 65) {
          inputVector = this._normVec(-dx, -dy);
        }

        // Exit conditions: phase expired OR block held too long
        if (this.phaseTimer >= this.phaseDuration || this.blockHeldTimer >= this.maxBlockHold) {
          this.blockHeldTimer = 0;
          // After blocking, immediately counter
          this._setPhase('pressure', 0.45 + Math.random() * 0.35);
        }
        break;
      }

      // ── RETREAT: back away to recover ──
      case 'retreat': {
        inputVector = this._normVec(-dx, -dy);
        // Use back-dash to escape cleanly if available
        if (this.dummy.dashCooldowns.back <= 0 && this.phaseTimer < 0.05) {
          wantsDash = true;
        }
        if (this.phaseTimer >= this.phaseDuration) {
          this._setPhase('strafe', 0.4 + Math.random() * 0.4);
        }
        break;
      }

      default:
        break;
    }

    // Apply reactive block override (only if not already blocking from phase)
    if (reactBlock && !wantsBlock) wantsBlock = true;

    // Safety: never block while already punching or dashing
    if (wantsBlock && (this.dummy.currentAttack || this.dummy.dashType)) wantsBlock = false;

    return { inputVector, wantsM1, wantsDash, wantsBlock };
  }

  _decide(dist, playerAttacking, playerDashing, isLowHP, isMidHP) {
    const roll = Math.random();

    // Retreated far — close the gap
    if (dist > this.attackRange + 100) {
      this._setPhase('approach', 0.4 + Math.random() * 0.35);
      return;
    }

    // Low HP: mostly strafe and brief retreats; still attacks
    if (isLowHP) {
      if (roll < 0.30)      this._setPhase('retreat',   0.3 + Math.random() * 0.25);
      else if (roll < 0.55) this._setPhase('strafe',    0.4 + Math.random() * 0.4);
      else if (roll < 0.80) this._setPhase('pressure',  0.4 + Math.random() * 0.4);
      else                  this._setPhase('sidestep',  0.2 + Math.random() * 0.2);
      return;
    }

    // Mid HP: slightly more cautious transitions
    if (isMidHP) {
      if (roll < 0.40)      this._setPhase('pressure',  0.5 + Math.random() * 0.45);
      else if (roll < 0.62) this._setPhase('strafe',    0.35 + Math.random() * 0.4);
      else if (roll < 0.76) this._setPhase('sidestep',  0.2 + Math.random() * 0.2);
      else if (roll < 0.88) this._setPhase('blockBrief',0.25 + Math.random() * 0.15);
      else                  this._setPhase('retreat',   0.28 + Math.random() * 0.2);
      return;
    }

    // Full HP: aggressive
    if (roll < 0.48)      this._setPhase('pressure',  0.55 + Math.random() * 0.5);
    else if (roll < 0.68) this._setPhase('strafe',    0.35 + Math.random() * 0.4);
    else if (roll < 0.80) this._setPhase('approach',  0.25 + Math.random() * 0.25);
    else if (roll < 0.90) this._setPhase('sidestep',  0.2 + Math.random() * 0.18);
    else                  this._setPhase('blockBrief',0.22 + Math.random() * 0.12);
  }
}

// ============================================================================
// 8. GAME ENGINE & MAIN LOOP
// ============================================================================
class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // Core Systems
    this.input = new InputHandler();
    this.arena = new ArenaWorld();
    this.camera = new Camera(window.innerWidth, window.innerHeight);
    this.particles = new ParticleSystem();
    this.floatingTexts = new FloatingTextSystem();
    this.combat = new CombatSystem(this.floatingTexts, this.particles);

    // Spawn Player at center
    this.player = new Fighter(this.arena.centerX, this.arena.centerY, {
      name: 'Player',
      isPlayer: true,
      tunicColor: '#2d5a3f',
      headbandColor: '#38ef7d',
      hpBarColor: '#38ef7d',
      initialAngle: -Math.PI / 2,
    });

    // Spawn AI Combat Dummy 140px to the right, facing the player
    this.dummy = new Fighter(this.arena.centerX + 140, this.arena.centerY, {
      name: 'Dummy',
      isPlayer: false,
      tunicColor: '#7a2e2e',       // Crimson tunic
      headbandColor: '#ff6b6b',    // Coral headband
      hpBarColor: '#f87171',       // Red HP bar
      initialAngle: Math.PI,       // Facing player initially
    });

    // AI Controller wired to fighting dummy
    this.ai = new AIController(this.dummy, this.player);

    // Spawn idle training dummy: 140px above the fighting dummy (no overlap with player or dummy)
    this.idleDummy = new Fighter(this.arena.centerX + 140, this.arena.centerY - 145, {
      name: 'Bag',
      isPlayer: false,
      tunicColor: '#3a3a5c',       // Slate-blue tunic (visually distinct)
      headbandColor: '#a78bfa',    // Purple headband
      hpBarColor: '#a78bfa',       // Purple HP bar
      initialAngle: Math.PI / 2,   // Facing down
    });

    // Timing and loop
    this.lastTime = performance.now();
    this.ambientMoteTimer = 0;

    this.setupDisplay();
    this.bindWindowEvents();
    this.start();
  }

  setupDisplay() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.resetTransform?.();
    this.ctx.scale(this.dpr, this.dpr);

    this.camera.resize(width, height);
  }

  bindWindowEvents() {
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this.setupDisplay(), 50);
    });
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame((timestamp) => this.gameLoop(timestamp));
  }

  gameLoop(timestamp) {
    const rawDt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    const dt = Math.min(rawDt, 0.08);

    this.update(dt);
    this.render();

    requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  update(dt) {
    // 1. Process Player Input Triggers
    const moveVector = this.input.getMovementVector();

    // Check Reset Trigger (R key or Reset button)
    if (this.input.consumeReset()) {
      this.dummy.reset();
      this.ai.reset();
      this.idleDummy.reset();
      this.floatingTexts.spawn(this.dummy.x, this.dummy.y - 20, 'RESET', 'rgb(56, 239, 125)', 16);
      this.particles.emitHitSparks(this.dummy.x, this.dummy.y, 20, true);
    }

    // Check Lock-On Trigger (Shift key) — cycles to nearest valid target including idleDummy
    if (this.input.consumeLockOn()) {
      if (this.player.isLockedOn) {
        // Already locked; unlock
        this.player.isLockedOn = false;
        this.player.lockOnTarget = null;
        this.floatingTexts.spawn(this.player.x, this.player.y - 28, 'UNLOCK', 'rgb(180, 200, 190)', 14, 0.6);
      } else {
        // Find nearest valid target among all fighters (excluding player)
        const candidates = [this.dummy, this.idleDummy].filter(f => !f.isDefeated);
        let nearest = null;
        let nearestDist = Infinity;
        for (const c of candidates) {
          const d = Math.hypot(c.x - this.player.x, c.y - this.player.y);
          if (d < nearestDist) { nearestDist = d; nearest = c; }
        }
        if (nearest) {
          this.player.isLockedOn = true;
          this.player.lockOnTarget = nearest;
          this.floatingTexts.spawn(nearest.x, nearest.y - 32, 'LOCKED ON', 'rgb(245, 158, 11)', 15, 0.8);
          this.particles.emitHitSparks(nearest.x, nearest.y, 10, true);
        }
      }
    }

    // Check Blocking (F key held) — allow even while moving
    this.player.isBlocking = this.input.keys.block && this.player.stunTimer <= 0 && !this.player.dashType && !this.player.currentAttack;

    // Check Dash Trigger (Q key)
    if (this.input.consumeDash()) {
      this.player.startDash(moveVector);
    }

    // Check M1 Punch Trigger (Left Click or Space)
    if (this.input.consumeM1()) {
      this.player.startPunch();
    }

    // 2. Run AI Controller for the dummy
    const aiDecision = this.ai.update(dt);

    // Apply AI blocking decision
    this.dummy.isBlocking = aiDecision.wantsBlock && this.dummy.stunTimer <= 0 && !this.dummy.dashType && !this.dummy.currentAttack;

    // Apply AI dash decision
    if (aiDecision.wantsDash) {
      this.dummy.startDash(aiDecision.inputVector);
    }

    // Apply AI punch decision (one-shot consumed each cycle)
    if (aiDecision.wantsM1) {
      this.dummy.startPunch();
    }

    // 3. Update Fighter Entities
    this.player.update(dt, moveVector, this.particles, this.arena);
    this.dummy.update(dt, aiDecision.inputVector, this.particles, this.arena);
    // Idle dummy: always zero input, never acts
    this.idleDummy.update(dt, { dx: 0, dy: 0 }, this.particles, this.arena);

    // 4. Resolve Combat Hits, Blocks & Combos (bidirectional for AI dummy; one-way for idle bag)
    this.combat.update(this.player, this.dummy);
    this.combat.checkFighterAttack(this.dummy, this.player);
    this.combat.checkDashStrike(this.dummy, this.player);
    // Idle dummy only receives damage from player, never blocks or counterattacks
    this.combat.checkFighterAttack(this.player, this.idleDummy);
    this.combat.checkDashStrike(this.player, this.idleDummy);

    // 5. Activate AI on first hit from player
    if (!this.ai.isActivated && this.dummy.hurtFlashTimer > 0) {
      this.ai.activate();
      this.floatingTexts.spawn(this.dummy.x, this.dummy.y - 45, 'AI ACTIVATED!', 'rgb(255, 107, 107)', 17, 1.0);
    }

    // 6. Update Camera tracking on Player
    this.camera.update(this.player.x, this.player.y, dt);

    // 7. Update Effects Systems
    this.particles.update(dt);
    this.floatingTexts.update(dt);

    // 8. Ambient Forest Particles
    this.ambientMoteTimer += dt;
    if (this.ambientMoteTimer > 0.22) {
      this.ambientMoteTimer = 0;
      this.particles.emitAmbientForestMote(this.arena.width, this.arena.height);
    }

    // 9. Update HUD indicators
    this.input.updateHUD(this.player);
  }

  drawTargetMarker(ctx, target) {
    ctx.save();
    ctx.translate(target.x, target.y);

    const now = performance.now();
    const pulse = Math.sin(now * 0.006) * 2.5;

    // 1. Subtle glowing lock-on ring on the ground under target
    ctx.beginPath();
    ctx.ellipse(0, 10, target.radius + 14 + pulse, (target.radius + 14 + pulse) * 0.65, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Corner Bracket Reticle around target
    const boxSize = target.radius + 12 + pulse;
    const bracketLen = 9;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#f59e0b';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 8;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(-boxSize, -boxSize + bracketLen);
    ctx.lineTo(-boxSize, -boxSize);
    ctx.lineTo(-boxSize + bracketLen, -boxSize);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(boxSize - bracketLen, -boxSize);
    ctx.lineTo(boxSize, -boxSize);
    ctx.lineTo(boxSize, -boxSize + bracketLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(-boxSize, boxSize - bracketLen);
    ctx.lineTo(-boxSize, boxSize);
    ctx.lineTo(-boxSize + bracketLen, boxSize);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(boxSize - bracketLen, boxSize);
    ctx.lineTo(boxSize, boxSize);
    ctx.lineTo(boxSize, boxSize - bracketLen);
    ctx.stroke();

    // 3. Overhead Inverted Target Diamond Indicator
    const diamondY = -68 + Math.sin(now * 0.007) * 4;
    ctx.beginPath();
    ctx.moveTo(0, diamondY + 8);
    ctx.lineTo(-6, diamondY);
    ctx.lineTo(0, diamondY - 8);
    ctx.lineTo(6, diamondY);
    ctx.closePath();
    ctx.fillStyle = '#f59e0b';
    ctx.shadowBlur = 10;
    ctx.fill();

    // Inner diamond core
    ctx.beginPath();
    ctx.arc(0, diamondY, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }

  render() {
    const width = this.camera.viewportWidth;
    const height = this.camera.viewportHeight;

    this.ctx.clearRect(0, 0, width, height);

    this.camera.applyTransform(this.ctx);

    // Layer 1: Ground & Arena Ring
    this.arena.renderGround(this.ctx);

    // Layer 2: Ambient Particles below entities
    this.particles.render(this.ctx, this.camera);

    // Layer 3: Y-Sorted Depth Buffer Entities
    const entities = this.arena.getWorldEntities();

    // Add Player to render list
    entities.push({
      y: this.player.y,
      render: (ctx) => this.player.render(ctx),
      cullX: this.player.x,
      cullY: this.player.y,
      cullRadius: this.player.radius * 2 + 30,
    });

    // Add AI Dummy to render list
    entities.push({
      y: this.dummy.y,
      render: (ctx) => this.dummy.render(ctx),
      cullX: this.dummy.x,
      cullY: this.dummy.y,
      cullRadius: this.dummy.radius * 2 + 30,
    });

    // Add Idle Dummy to render list
    entities.push({
      y: this.idleDummy.y,
      render: (ctx) => this.idleDummy.render(ctx),
      cullX: this.idleDummy.x,
      cullY: this.idleDummy.y,
      cullRadius: this.idleDummy.radius * 2 + 30,
    });

    // Sort ascending by Y coordinate
    entities.sort((a, b) => a.y - b.y);

    for (const entity of entities) {
      if (this.camera.isInView(entity.cullX, entity.cullY, entity.cullRadius)) {
        entity.render(this.ctx);
      }
    }

    // Layer 4: Target Lock-On Marker
    if (this.player.isLockedOn && this.player.lockOnTarget && !this.player.lockOnTarget.isDefeated) {
      this.drawTargetMarker(this.ctx, this.player.lockOnTarget);
    }

    // Layer 5: Floating Combat Text (Always on top for maximum clarity)
    this.floatingTexts.render(this.ctx, this.camera);

    this.camera.restoreTransform(this.ctx);
  }
}

// Initialize when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.gameInstance = new Game();
});
