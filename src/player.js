import { clamp, moveBody, overlap } from './collision.js';
import { drawAnchored, frameAt } from './render.js';

const ANIMS = {
  idle: [6, true], run: [12, true], jump_rising: [9, true], fall: [7, true], landing: [10, false],
  crouch: [1, false],
  ground_attack_1: [14, false], ground_attack_2: [14, false], ground_attack_3: [14, false], air_attack: [14, false],
  air_dash: [16, false], wind_pulse: [14, false], hurt: [14, false], death: [8, false],
};

// Measured from the actual transparent PNGs. Rendering translates each frame
// so its lowest visible boot pixel meets the immutable physics-feet position.
const VISIBLE_FEET = {
  idle: [104, 104, 105, 105], run: [106, 106, 106, 107, 107, 105, 105, 107], landing: [104, 104, 105],
  crouch: [104], ground_attack_1: [105, 105, 104, 105], ground_attack_2: [105, 105, 105, 104],
  ground_attack_3: [105, 105, 106, 104, 106, 104], hurt: [106, 105, 105, 105],
};

export class Player {
  constructor(spawn, maxHp = 10, maxEnergy = 100) {
    this.maxHp = maxHp; this.hp = maxHp; this.maxEnergy = maxEnergy; this.energy = maxEnergy;
    this.respawn(spawn);
    this.hurtCount = 0;
  }
  respawn(spawn) {
    this.x = spawn.x; this.y = spawn.y; this.vx = 0; this.vy = 0; this.facing = spawn.facing === 'left' ? -1 : 1;
    this.grounded = false; this.wasGrounded = false; this.anim = 'idle'; this.animTime = 0; this.lockTimer = 0;
    this.attackTimer = 0; this.attackStage = 0; this.comboWindow = 0; this.attackId = 0; this.attackHit = new Set();
    this.invulnerable = .75; this.spawnGrace = .75; this.dashAvailable = true; this.dashTimer = 0; this.dead = false; this.deathTimer = 0;
    this.crouching = false; this.attackFxSpawned = false; this.stepTimer = 0;
    this.jumpGrace = 0;
  }
  hitbox() { const h = this.crouching ? 25 : 42; return { x: this.x - 8, y: this.y - h, w: 16, h }; }
  hurtbox() { const box = this.hitbox(); return { x: box.x + 1, y: box.y + 3, w: box.w - 2, h: box.h - 3 }; }
  attackBox() {
    if (!this.isAttackActive()) return null;
    const air = !this.grounded || this.attackStage === 0;
    const reach = air ? { y: -62, h: 55, w: 39 } : this.attackStage === 3 ? { y: -74, h: 64, w: 42 } : this.attackStage === 2 ? { y: -66, h: 56, w: 39 } : { y: -55, h: 45, w: 36 };
    return { x: this.facing > 0 ? this.x + 3 : this.x - reach.w - 3, y: this.y + reach.y, w: reach.w, h: reach.h };
  }
  isAttackActive() {
    if (!this.attackTimer) return false;
    const duration = this.attackStage === 3 ? 0.46 : 0.32;
    const elapsed = duration - this.attackTimer;
    return elapsed >= 0.09 && elapsed <= (this.attackStage === 3 ? 0.28 : 0.22);
  }
  beginAttack(air = false) {
    this.attackId += 1; this.attackHit.clear(); this.attackFxSpawned = false; this.crouching = false;
    if (air) { this.attackStage = 0; this.attackTimer = 0.32; this.setAnim('air_attack'); return; }
    this.attackStage = this.comboWindow > 0 ? (this.attackStage % 3) + 1 : 1;
    this.attackTimer = this.attackStage === 3 ? 0.46 : 0.32;
    this.comboWindow = 0;
    this.setAnim(`ground_attack_${this.attackStage}`);
  }
  attackFxOrigin() {
    const stage = this.attackStage;
    return { x: this.x + this.facing * (stage === 3 ? 23 : 18), y: this.y - (stage === 3 ? 48 : stage === 2 ? 40 : stage === 0 ? 38 : 32) };
  }
  setAnim(name) { if (this.anim !== name) { this.anim = name; this.animTime = 0; } }
  takeDamage(amount, sourceX, game) {
    if (this.invulnerable > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - amount); this.hurtCount += 1; this.invulnerable = 1.05; this.spawnGrace = 0;
    this.vx = this.x < sourceX ? -105 : 105; this.vy = -120; this.lockTimer = 0.3; this.setAnim('hurt');
    game.addFx('impact', this.x, this.y - 28, 0.28);
    game.audio.playSfx('player_hurt', { x: this.x });
    if (this.hp <= 0) { this.dead = true; this.deathTimer = 1.1; this.setAnim('death'); game.audio.playSfx('player_death', { x: this.x }); }
    return true;
  }
  update(dt, game) {
    this.animTime += dt; this.invulnerable = Math.max(0, this.invulnerable - dt); this.spawnGrace = Math.max(0, this.spawnGrace - dt); this.lockTimer = Math.max(0, this.lockTimer - dt); this.comboWindow = Math.max(0, this.comboWindow - dt); this.jumpGrace = Math.max(0, this.jumpGrace - dt);
    if (this.dead) { this.deathTimer -= dt; if (this.deathTimer <= 0) game.showGameOver(); return; }
    const input = game.input;
    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt);
      if (this.attackTimer === 0 && this.attackStage) this.comboWindow = 0.35;
    }
    const wasCrouching = this.crouching; this.crouching = this.grounded && input.isDown('crouch') && this.lockTimer <= 0 && !this.attackTimer;
    if (this.crouching !== wasCrouching) game.audio.playSfx(this.crouching ? 'player_crouch' : 'player_stand', { x: this.x });
    if (input.wasPressed('attack') && !this.crouching) {
      if (!this.grounded && !this.attackTimer) this.beginAttack(true);
      else if (this.grounded && (!this.attackTimer || this.attackTimer < 0.08)) this.beginAttack(false);
    }
    if (input.wasPressed('skill') && this.energy >= 25 && !this.attackTimer && this.lockTimer <= 0) {
      this.energy -= 25; this.lockTimer = 0.34; this.setAnim('wind_pulse');
      game.audio.playSfx('wind_pulse_charge', { x: this.x });
      game.spawnProjectile({ type: 'windPulse', team: 'player', x: this.x + this.facing * 16, y: this.y - 29, vx: this.facing * 190, vy: 0, w: 26, h: 14, damage: 3, life: 0.9, pierce: true });
      game.audio.playSfx('wind_pulse_fire', { x: this.x + this.facing * 16 });
    }
    if (input.wasPressed('dash') && !this.grounded && this.dashAvailable && this.lockTimer <= 0) {
      this.dashAvailable = false; this.dashTimer = 0.2; this.invulnerable = Math.max(this.invulnerable, 0.2); this.vx = this.facing * 240; this.vy = input.isDown('jump') ? -80 : 0; this.setAnim('air_dash');
      game.addFx('dash', this.x - this.facing * 18, this.y - 32, 0.25, this.facing);
      game.audio.playSfx('player_dash', { x: this.x });
    }
    if (this.attackTimer && this.isAttackActive() && !this.attackFxSpawned) {
      this.attackFxSpawned = true; const origin = this.attackFxOrigin(); game.addFx('slash', origin.x, origin.y, this.attackStage === 3 ? 0.31 : 0.24, this.facing, { stage: this.attackStage });
      game.audio.playSfx(this.attackStage === 0 ? 'air_attack_swing' : `attack_${this.attackStage}_swing`, { x: origin.x });
    }
    const tappedAxis = (input.wasPressed('right') ? 1 : 0) - (input.wasPressed('left') ? 1 : 0); const axis = this.crouching ? 0 : (input.axis() || tappedAxis);
    if (this.lockTimer <= 0 && this.dashTimer <= 0) {
      if (axis) { this.facing = axis; if (tappedAxis && !input.isDown(tappedAxis > 0 ? 'right' : 'left') && Math.abs(this.vx) < 70) this.vx = tappedAxis * 70; else this.vx += axis * (this.grounded ? 620 : 330) * dt; }
      else this.vx -= Math.sign(this.vx) * Math.min(Math.abs(this.vx), (this.grounded ? 720 : 90) * dt);
      this.vx = clamp(this.vx, -105, 105);
    }
    if (input.wasPressed('jump') && this.grounded && this.lockTimer <= 0) { this.crouching = false; this.vy = -270; this.grounded = false; this.jumpGrace = .14; this.setAnim('jump_rising'); game.audio.playSfx('player_jump', { x: this.x }); }
    if (input.wasReleased('jump') && this.jumpGrace <= 0 && this.vy < -90) this.vy *= .52;
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (this.dashTimer <= 0) this.vy += 720 * dt;
    else this.vx = this.facing * 240;
    this.vy = Math.min(this.vy, 360);
    this.wasGrounded = this.grounded;
    moveBody(this, dt, game.solids(), game.oneWays());
    if (this.grounded) { this.dashAvailable = true; if (!this.wasGrounded && this.vy === 0) { this.setAnim('landing'); this.lockTimer = Math.max(this.lockTimer, 0.29); game.audio.playSfx('player_land', { x: this.x }); } }
    if (this.y > 236 || game.hazards.some((hazard) => overlap(this.hitbox(), hazard))) { game.fallRespawn(); return; }
    const attack = this.attackBox();
    if (attack) game.resolvePlayerAttack(attack, this);
    if (!this.attackTimer && this.lockTimer <= 0 && this.dashTimer <= 0) {
      if (!this.grounded) this.setAnim(this.vy < 0 ? 'jump_rising' : 'fall');
      else if (this.crouching) this.setAnim('crouch');
      else if (Math.abs(this.vx) > 10) this.setAnim('run');
      else this.setAnim('idle');
    }
    this.stepTimer = Math.max(0, this.stepTimer - dt); if (this.grounded && !this.crouching && !this.attackTimer && Math.abs(this.vx) > 45 && this.stepTimer <= 0) { game.audio.playSfx('player_step', { x: this.x }); this.stepTimer = .27; }
    this.x = clamp(this.x, 10, game.worldWidth - 10);
  }
  render(ctx, game) {
    const { frame, index } = this.currentFrameInfo(game); const feet = VISIBLE_FEET[this.anim]?.[index] ?? 104; const visualCorrection = 104 - feet;
    const blink = this.invulnerable > 0 && this.spawnGrace <= 0 && Math.floor(this.invulnerable * 18) % 2 === 0;
    // The source frames were authored against Y=104. Using the lowest opaque
    // pixel would mistake sword/FX pixels for feet and lift attack frames.
    drawAnchored(ctx, frame, this.x, this.y + visualCorrection, game.cameraX, 64, 104, this.facing, blink ? 0.38 : 1);
  }
  currentFrameInfo(game) {
    const [fps, loop] = ANIMS[this.anim] || ANIMS.idle; const frames = game.assets.player[this.anim] || game.assets.player.idle; const raw = Math.floor(this.animTime * fps); const index = loop ? raw % frames.length : Math.min(raw, frames.length - 1);
    return { frame: frames[index], index };
  }
  currentFrame(game) { return this.currentFrameInfo(game).frame; }
  visualCorrectionY(game) { const { index } = this.currentFrameInfo(game); const feet = VISIBLE_FEET[this.anim]?.[index] ?? 104; return 104 - feet; }
  visualFeetY(game) { const { index } = this.currentFrameInfo(game); const feet = VISIBLE_FEET[this.anim]?.[index] ?? 104; return this.y + this.visualCorrectionY(game) + feet - 104; }
}
