import { clamp, overlap } from './collision.js';
import { drawAnchored } from './render.js';

const ARENA = Object.freeze({ left: 768, right: 1152, floor: 176, hoverMin: 900, hoverMax: 1038 });
const BOSS_SCALE = 0.72;

export class OroBoss {
  constructor(spawn) {
    this.id = spawn.id; this.x = spawn.x; this.y = spawn.y; this.spawnX = spawn.x; this.spawnY = spawn.y; this.facing = -1;
    this.hp = 90; this.maxHp = 90; this.active = false; this.dead = false; this.finished = false; this.phase = 1;
    this.state = 'idle'; this.stateTime = 0; this.animTime = 0; this.attackIndex = 0; this.spawnFlags = new Set(); this.invulnerable = 0;
  }
  hitbox() { return { x: this.x - 46, y: this.y - 91, w: 92, h: 86 }; }
  corePoint() { return { x: this.x, y: this.y - 60 }; }
  emitterPoint() { return { x: this.x + this.facing * 8, y: this.y - 60 }; }
  ringSockets() { return [{ x: this.x - 43, y: this.y - 60 }, { x: this.x + 43, y: this.y - 60 }]; }
  activate() { if (this.active || this.dead) return; this.active = true; this.x = clamp(this.spawnX, ARENA.hoverMin, ARENA.hoverMax); this.y = this.spawnY; this.state = 'intro'; this.stateTime = 1; this.animTime = 0; }
  setState(state, duration) { this.state = state; this.stateTime = duration; this.animTime = 0; this.spawnFlags.clear(); }
  takeDamage(amount, sourceX, game) {
    if (!this.active || this.dead || this.invulnerable > 0 || ['intro', 'phase_change'].includes(this.state)) return false;
    const vulnerable = this.state === 'core_open'; const actual = vulnerable ? amount * 2 : Math.max(0.5, amount * 0.3);
    this.hp = Math.max(0, this.hp - actual); this.invulnerable = 0.08; game.addFx('hit', this.x, this.y - 60, 0.22); game.hitStop = Math.max(game.hitStop, 0.035);
    if (this.hp <= 0) { this.dead = true; this.setState('death', 1.45); game.clearBossThreats(); }
    return true;
  }
  beginAttack() {
    const sequence = this.phase === 1 ? ['ring', 'bullets', 'beam'] : ['dash', 'bullets', 'ring', 'beam'];
    const attack = sequence[this.attackIndex % sequence.length]; this.attackIndex += 1;
    this.setState(attack, { ring: 1.35, bullets: 1.45, beam: 1.35, dash: 1.2 }[attack]);
  }
  update(dt, game) {
    if (!this.active && !this.dead) return;
    this.animTime += dt; this.invulnerable = Math.max(0, this.invulnerable - dt); this.facing = game.player.x < this.x ? -1 : 1;
    if (this.dead) { this.stateTime -= dt; if (this.stateTime <= 0 && !this.finished) { this.finished = true; game.finishBoss(); } return; }
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2; this.setState('phase_change', 1.55); game.clearBossThreats(); game.beginPhaseTwoCollapse(); game.addFx('phase', this.x, this.y - 60, 1.25); return;
    }
    this.stateTime -= dt; const elapsed = this.elapsed();
    if (this.state === 'intro') { if (this.stateTime <= 0) this.setState('cooldown', .4); return; }
    if (this.state === 'phase_change') { if (this.stateTime <= 0) { game.phaseTwo = true; this.setState('cooldown', .45); } return; }
    if (this.state === 'cooldown') { if (this.stateTime <= 0) this.beginAttack(); return; }
    const emitter = this.emitterPoint();
    if (this.state === 'ring' && elapsed > 0.62 && !this.spawnFlags.has('ring')) {
      this.spawnFlags.add('ring'); const direction = game.player.x < this.x ? -1 : 1;
      this.ringSockets().forEach((socket, socketIndex) => { const outward = socketIndex ? 1 : -1; game.spawnProjectile({ type: 'ring', team: 'enemy', sourceX: socket.x, sourceY: socket.y, socketIndex, x: socket.x, y: socket.y, vx: outward * 120, vy: outward * 22, targetDirection: direction, outwardUntil: .22, w: 24, h: 24, damage: 1, life: 1.8, returnAt: .82 }); });
    } else if (this.state === 'bullets') {
      for (let index = 0; index < 3; index += 1) if (elapsed > 0.55 + index * 0.18 && !this.spawnFlags.has(`bullet${index}`)) {
        this.spawnFlags.add(`bullet${index}`); const dx = game.player.x - emitter.x; const dy = game.player.y - 30 - emitter.y; const length = Math.hypot(dx, dy) || 1; const spread = (index - 1) * 0.12;
        game.spawnProjectile({ type: 'bossBullet', team: 'enemy', reflectable: true, sourceX: emitter.x, sourceY: emitter.y, x: emitter.x, y: emitter.y, vx: dx / length * 92, vy: dy / length * 92 + spread * 92, w: 16, h: 16, damage: 1, life: 4 });
      }
    } else if (this.state === 'beam' && elapsed > 0.62 && !this.spawnFlags.has('beam')) {
      this.spawnFlags.add('beam'); game.spawnProjectile({ type: 'beam', team: 'enemy', sourceX: emitter.x, sourceY: emitter.y, x: (ARENA.left + ARENA.right) / 2, y: 163, vx: 0, vy: 0, w: ARENA.right - ARENA.left - 28, h: 10, damage: 1, life: 0.58, static: true });
    } else if (this.state === 'dash' && elapsed > 0.58) {
      if (!this.spawnFlags.has('dash')) {
        this.spawnFlags.add('dash'); this.dashTarget = this.x > (ARENA.hoverMin + ARENA.hoverMax) / 2 ? ARENA.hoverMin : ARENA.hoverMax;
        game.addFx('dash', this.x, this.y - 56, 0.4, Math.sign(this.dashTarget - this.x));
      }
      const delta = this.dashTarget - this.x; this.x += Math.sign(delta) * Math.min(Math.abs(delta), 300 * dt);
      if (Math.abs(delta) < 1) this.stateTime = 0; if (overlap(this.hitbox(), game.player.hurtbox())) game.player.takeDamage(2, this.x, game);
    }
    if (this.stateTime <= 0) {
      if (['ring', 'bullets', 'beam', 'dash'].includes(this.state)) this.setState('core_open', this.phase === 1 ? 1.55 : 1.25);
      else if (this.state === 'core_open') this.setState('cooldown', .35);
    }
    this.x = clamp(this.x, ARENA.hoverMin, ARENA.hoverMax);
  }
  elapsed() {
    const duration = { ring: 1.35, bullets: 1.45, beam: 1.35, dash: 1.2, core_open: this.phase === 1 ? 1.55 : 1.25, phase_change: 1.55, intro: 1 }[this.state] || 1;
    return duration - this.stateTime;
  }
  animation() { return { ring: 'ring_blade_attack', bullets: 'wind_bullet_attack', beam: 'scan_beam', dash: 'dash', phase_change: 'phase_change', core_open: 'core_open', death: 'death' }[this.state] || 'core_closed'; }
  currentFrame(game) { return game.assets.boss.master; }
  render(ctx, game) {
    if (!this.active && !this.dead) return;
    const bob = this.dead ? 0 : Math.sin(game.time * 2.4) * 1.25; const fade = this.dead ? Math.max(0, this.stateTime / 1.45) : 1;
    const elapsed = this.elapsed(); const warningProgress = Math.min(1, elapsed / .58);
    const bodyRotation = this.state === 'dash' ? this.facing * -.035 * warningProgress : this.state === 'ring' ? Math.sin(elapsed * 14) * .012 : 0;
    const bodyY = this.y + bob + (this.state === 'bullets' && elapsed < .62 ? Math.sin(elapsed * 18) * .8 : 0);
    drawAnchored(ctx, game.assets.boss.master, this.x, bodyY, game.cameraX, 96, 164, this.facing, (this.invulnerable > 0 ? 0.58 : 1) * fade, false, BOSS_SCALE, bodyRotation);
    const core = this.corePoint(); const sx = Math.round(core.x - game.cameraX); const sy = Math.round(core.y + bob);
    ctx.save();
    if (this.state === 'core_open' || this.state === 'phase_change') {
      const radius = 8 + Math.sin(game.time * 10) * 2; const glow = ctx.createRadialGradient(sx, sy, 1, sx, sy, radius + 7); glow.addColorStop(0, '#efffff'); glow.addColorStop(.35, '#5ff4ffdd'); glow.addColorStop(1, '#23aee000'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, radius + 7, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#102d3bcc'; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#d7b65f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, Math.PI * 2); ctx.stroke();
    }
    const warning = ['ring', 'bullets', 'beam', 'dash'].includes(this.state) && elapsed < 0.58;
    if (warning) {
      const progress = warningProgress;
      if (this.state === 'ring') this.ringSockets().forEach((socket, index) => drawAnchored(ctx, game.assets.fx.ring[index % game.assets.fx.ring.length], socket.x + (index ? 1 : -1) * progress * 5, socket.y, game.cameraX, 64, 64, 1, .35 + progress * .6, false, .34, elapsed * 3));
      if (this.state === 'bullets') drawAnchored(ctx, game.assets.fx.bossBullet[Math.min(3, Math.floor(progress * 4))], this.emitterPoint().x, this.emitterPoint().y, game.cameraX, 48, 48, this.facing, .45 + progress * .55, false, .38);
      if (this.state === 'dash') drawAnchored(ctx, game.assets.fx.dash[Math.min(3, Math.floor(progress * 4))], this.x - this.facing * 48, this.y - 58, game.cameraX, 64, 64, this.facing, .35 + progress * .55, false, .72);
      if (this.state === 'beam') {
        const beam = game.assets.fx.beam[Math.min(3, Math.floor(progress * 4))]; const left = ARENA.left + 14 - game.cameraX; const width = ARENA.right - ARENA.left - 28;
        ctx.globalAlpha = .18 + progress * .35; ctx.drawImage(beam, 0, 0, beam.width, Math.floor(beam.height * .5), Math.round(left), 153, Math.round(width), 18);
        ctx.globalAlpha = .6 + progress * .4; ctx.fillStyle = '#d9ffff'; ctx.fillRect(Math.round(sx - 1), Math.round(sy), 2, Math.round(163 - sy));
      }
    }
    ctx.restore();
  }
}
