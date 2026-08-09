import { moveBody, overlap } from './collision.js';
import { drawAnchored, frameAt } from './render.js';

class Enemy {
  constructor(spawn, hp) {
    this.id = spawn.id; this.x = spawn.x; this.y = spawn.y; this.spawn = spawn; this.hp = hp; this.maxHp = hp;
    this.facing = spawn.facing === 'left' ? -1 : 1; this.dead = false; this.remove = false; this.anim = 'idle'; this.animTime = 0; this.invulnerable = 0; this.healthBarTimer = 0;
  }
  setAnim(name) { if (name !== this.anim) { this.anim = name; this.animTime = 0; } }
  updateBase(dt) { this.animTime += dt; this.invulnerable = Math.max(0, this.invulnerable - dt); this.healthBarTimer = Math.max(0, this.healthBarTimer - dt); }
  die(game) { this.dead = true; this.deathTimer = 0.8; this.setAnim('death'); game.addFx('death', this.x, this.y - 25, 0.5); }
}

export class WindScout extends Enemy {
  constructor(spawn) { super(spawn, 6); this.baseY = spawn.y; this.vx = 25 * this.facing; this.state = 'patrol'; this.cooldown = 0.8; this.stateTime = 0; this.shot = false; }
  hitbox() { return { x: this.x - 14, y: this.y - 25, w: 28, h: 23 }; }
  takeDamage(amount, sourceX, game) {
    if (this.dead || this.invulnerable > 0) return false;
    this.hp -= amount; this.invulnerable = 0.12; this.healthBarTimer = 3.2; this.facing = sourceX < this.x ? -1 : 1; this.setAnim('hurt'); this.hurtTimer = 0.34;
    game.addFx('hit', this.x, this.y - 14, 0.25); if (this.hp <= 0) this.die(game); return true;
  }
  update(dt, game) {
    this.updateBase(dt);
    if (this.dead) { this.deathTimer -= dt; if (this.deathTimer <= 0) this.remove = true; return; }
    if (this.hurtTimer > 0) { this.hurtTimer -= dt; return; }
    const dx = game.player.x - this.x; const distance = Math.abs(dx); this.cooldown -= dt;
    if (this.state === 'patrol') {
      this.setAnim('move'); this.x += this.vx * dt;
      if (this.x < this.spawn.patrol.left || this.x > this.spawn.patrol.right) { this.vx *= -1; this.facing = Math.sign(this.vx); }
      if (distance < 142 && this.cooldown <= 0) { this.state = 'aim'; this.stateTime = 0.72; this.shot = false; this.facing = Math.sign(dx) || this.facing; this.setAnim('attack'); }
    } else if (this.state === 'aim') {
      this.stateTime -= dt; this.facing = Math.sign(dx) || this.facing; this.setAnim('attack');
      const elapsed = 0.72 - this.stateTime;
      // 9 FPS attack: 0.45s begins frame 5 (zero-based index 4), the documented projectile event frame.
      if (!this.shot && elapsed >= 0.45) {
        this.shot = true;
        game.spawnProjectile({ type: 'scoutWind', team: 'enemy', reflectable: true, x: this.x + this.facing * 20, y: this.y - 15, vx: this.facing * 72, vy: 0, w: 14, h: 14, damage: 1, life: 4 });
      }
      if (this.stateTime <= 0) { this.state = distance > 175 ? 'patrol' : 'cooldown'; this.cooldown = 1.15; this.stateTime = 0.45; this.setAnim('idle'); }
    } else {
      this.stateTime -= dt; this.setAnim('idle'); if (this.stateTime <= 0) this.state = distance < 142 ? 'aim' : 'patrol';
    }
    this.y = this.baseY + Math.sin(game.time * 3 + this.x) * 1.2;
    if (overlap(this.hitbox(), game.player.hurtbox())) game.player.takeDamage(1, this.x, game);
  }
  render(ctx, game) {
    const fps = this.anim === 'attack' ? 9 : 8;
    const frame = frameAt(game.assets.scout[this.anim], this.animTime, fps, !['hurt', 'death'].includes(this.anim));
    drawAnchored(ctx, frame, this.x, this.y, game.cameraX, 48, 76, this.facing, this.invulnerable > 0 ? 0.55 : 1);
    if (this.state === 'aim') {
      const progress = 1 - this.stateTime / 0.72;
      ctx.fillStyle = progress > .72 ? '#ff3c2f' : progress > .38 ? '#ff9b32' : '#ffe36a';
      ctx.beginPath(); ctx.arc(Math.round(this.x - game.cameraX + this.facing * 12), Math.round(this.y - 19), 2 + progress * 2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

export class CourtyardGuard extends Enemy {
  constructor(spawn, groundY = 184) {
    super(spawn, 16); this.y = groundY; this.vx = 0; this.vy = 0; this.grounded = true; this.state = 'guard'; this.stateTime = 0.7; this.homeX = spawn.x;
  }
  hitbox() { return { x: this.x - 18, y: this.y - 44, w: 36, h: 44 }; }
  coreBox() { return { x: this.x - this.facing * 18 - 8, y: this.y - 35, w: 16, h: 24 }; }
  takeDamage(amount, sourceX, game) {
    if (this.dead || this.invulnerable > 0) return false;
    const sourceInFront = (sourceX - this.x) * this.facing > 0;
    if (sourceInFront && this.state !== 'stunned') { game.addFx('reflect', this.x + this.facing * 16, this.y - 28, 0.25); return false; }
    const multiplier = this.state === 'stunned' ? 1.6 : 1;
    this.hp -= amount * multiplier; this.invulnerable = 0.12; this.healthBarTimer = 3.2; this.setAnim('hurt'); this.hurtTimer = 0.32; game.addFx('hit', this.x - this.facing * 10, this.y - 26, 0.28);
    if (this.hp <= 0) this.die(game); return true;
  }
  enterStunned(game) { this.state = 'stunned'; this.stateTime = 1.8; this.healthBarTimer = 3.2; this.vx = 0; this.setAnim('stunned'); game.addFx('impact', this.x + this.facing * 18, this.y - 22, 0.35); }
  update(dt, game) {
    this.updateBase(dt);
    if (this.dead) { this.deathTimer -= dt; if (this.deathTimer <= 0) this.remove = true; return; }
    if (this.hurtTimer > 0) { this.hurtTimer -= dt; if (this.hurtTimer <= 0) this.setAnim(this.state === 'stunned' ? 'stunned' : 'guard'); return; }
    const dx = game.player.x - this.x; const distance = Math.abs(dx); const playerBehind = dx * this.facing < -14;
    if (this.state === 'guard') {
      this.vx = 0; this.setAnim('guard');
      if (playerBehind && distance < 100) { this.state = 'turn'; this.stateTime = 0.34; this.setAnim('turn'); }
      else if (distance < 95) { this.state = 'warn'; this.stateTime = 0.62; this.setAnim('charge_attack'); }
      else if (distance > 125) { this.state = 'walk'; this.stateTime = 0.8; }
    } else if (this.state === 'walk') {
      this.facing = Math.sign(dx) || this.facing; this.vx = this.facing * 20; this.setAnim('walk'); this.stateTime -= dt;
      if (distance < 95 || this.stateTime <= 0 || Math.abs(this.x - this.homeX) > 48) { this.vx = 0; this.state = 'guard'; }
    } else if (this.state === 'turn') {
      this.vx = 0; this.stateTime -= dt; if (this.stateTime <= 0) { this.facing *= -1; this.state = 'guard'; }
    } else if (this.state === 'warn') {
      this.vx = 0; this.stateTime -= dt; this.setAnim('charge_attack');
      if (this.stateTime <= 0) { this.state = 'charge'; this.stateTime = 0.55; this.vx = this.facing * 155; }
    } else if (this.state === 'charge') {
      this.setAnim('charge_attack'); this.stateTime -= dt;
      const before = this.vx; this.vy += 700 * dt; moveBody(this, dt, game.solids(), game.oneWays());
      if ((before !== 0 && this.vx === 0) || this.stateTime <= 0) this.enterStunned(game);
    } else if (this.state === 'stunned') {
      this.vx = 0; this.stateTime -= dt; this.setAnim('stunned'); if (this.stateTime <= 0) { this.state = 'turn'; this.stateTime = 0.34; }
    }
    if (this.state !== 'charge') { this.vy += 700 * dt; moveBody(this, dt, game.solids(), game.oneWays()); }
    if (overlap(this.hitbox(), game.player.hurtbox())) game.player.takeDamage(this.state === 'charge' ? 2 : 1, this.x, game);
  }
  render(ctx, game) {
    const anim = game.assets.guard[this.anim] ? this.anim : 'idle';
    const frame = frameAt(game.assets.guard[anim], this.animTime, anim === 'charge_attack' ? 12 : 8, !['turn', 'hurt', 'death'].includes(anim));
    drawAnchored(ctx, frame, this.x, this.y, game.cameraX, 64, 104, this.facing, this.invulnerable > 0 ? 0.55 : 1);
    if (this.state === 'warn') {
      ctx.fillStyle = this.stateTime < .25 ? '#ff4738' : '#ffe46b'; ctx.fillRect(Math.round(this.x - game.cameraX + this.facing * 13), Math.round(this.y - 31), 5, 3);
    }
    if (this.state === 'stunned') {
      const coreX = this.x - this.facing * 18; const coreY = this.y - 25;
      drawAnchored(ctx, frameAt(game.assets.fx.hit, game.time, 11, true), coreX, coreY, game.cameraX, 48, 48, 1, .9, false, .34);
    }
  }
}
