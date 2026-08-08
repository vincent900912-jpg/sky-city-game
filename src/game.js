import { loadAssets, loadLevelData } from './assets.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { WindScout, CourtyardGuard } from './enemies.js';
import { OroBoss } from './boss.js';
import { UI } from './ui.js';
import { clamp, overlap } from './collision.js';
import { drawAnchored, drawImageWorld, drawRect, drawAnchor, frameAt, anchoredVisualBounds, imageAlphaBounds } from './render.js';
import { loadSave, writeSave, resetRunSave } from './save.js';
import { configureCanvas, WORLD_WIDTH, WORLD_HEIGHT, MAP_ASSET_SCALE } from './config.js';
import { FlowController, STATES } from './flow.js';
import { ArenaPlatformManager } from './platforms.js';
import { createAudioManager } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

class Game {
  constructor(assets, data, audio, save) {
    this.assets = assets; this.data = data; this.ui = new UI(); this.save = save; this.audio = audio;
    this.input = new Input(this.save.controls, (controls) => { this.save.controls = controls; writeSave(this.save); this.ui.renderBindings(this.input, true); this.ui.renderBindings(this.input, false); });
    this.renderInfo = configureCanvas(canvas, ctx); addEventListener('resize', () => { this.renderInfo = configureCanvas(canvas, ctx); });
    const query = new URLSearchParams(location.search);
    this.worldWidth = data['level-manifest'].world_bounds.width; this.cameraX = 0; this.time = 0; this.runTime = 0; this.fps = 60; this.debug = query.get('debug') === '1'; this.debugArea = this.debug ? query.get('area') : null; this.debugPhase = this.debug ? Number(query.get('phase') || 1) : 1; this.state = STATES.BOOT; this.modalOpen = null; this.overlayReturnState = null;
    this.projectiles = []; this.effects = []; this.phaseTwo = false; this.pauseReason = null; this.gameOver = false; this.victory = false; this.hitStop = 0; this.lastTime = performance.now(); this.accumulator = 0;
    this.collision = data.collision; this.objectData = data.objects; this.hazards = this.collision.hazards.map((item) => ({ ...item }));
    this.arenaPlatforms = new ArenaPlatformManager(this.collision.solids.find((item) => item.id === 'boss_floor'));
    const checkpoint = this.save.checkpoint?.level === 'level_01_cloud_gate' ? this.save.checkpoint : null;
    const spawn = checkpoint ? { x: checkpoint.x, y: checkpoint.y, facing: 'right' } : this.objectData.player_spawn;
    this.player = new Player(spawn, this.save.maxHp, this.save.maxEnergy);
    this.checkpoint = checkpoint ? { x: checkpoint.x, y: checkpoint.y } : { x: this.objectData.player_spawn.x, y: this.objectData.player_spawn.y };
    this.checkpointActive = Boolean(checkpoint); this.activeCheckpointId = checkpoint?.id || (checkpoint ? 'checkpoint_01' : null); this.movingY = 148; this.movingDirection = -1; this.movingDelta = 0; this.courtyardClear = false; this.bossActive = false; this.windRingCooldown = 0;
    this.enemies = this.objectData.enemy_spawns.filter((spawnData) => spawnData.enemy !== 'oro').map((spawnData) => spawnData.enemy === 'wind_scout_bug' ? new WindScout(spawnData) : new CourtyardGuard(spawnData));
    this.boss = new OroBoss(this.objectData.enemy_spawns.find((spawnData) => spawnData.enemy === 'oro')); this.applyDebugStart();
    this.bindCommands(); this.flow = new FlowController(this); document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === STATES.GAMEPLAY && !this.victory) this.setPause('pause'); else if (!document.hidden) this.audio.unlock(); });
    this.ui.hideAll(); this.flow.start(); requestAnimationFrame((time) => this.loop(time));
  }
  bindCommands() {
    document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
      const command = button.dataset.command;
      if (command === 'resume' || command === 'close-overlay') this.resume();
      else if (command === 'retry' || command === 'restart') this.retry();
      else if (command === 'main-menu') this.returnToMainMenu();
      else if (command === 'reset-bindings') { this.input.resetBindings(); this.ui.renderBindings(this.input, true); this.ui.renderBindings(this.input, false); document.getElementById('binding-message').textContent = '已恢復預設按鍵。'; }
      else if (command === 'replay') { resetRunSave(this.save); this.resetGameplayFromSave(); this.enterGameplay(); }
    }));
    document.getElementById('help-button').addEventListener('click', () => this.openOverlay('help'));
    document.getElementById('settings-button').addEventListener('click', () => this.openOverlay('settings'));
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('pointerenter', () => this.audio.playSfx('ui_hover', { ui: true }));
      button.addEventListener('click', () => this.audio.playSfx(button.id === 'confirm-cancel' || button.dataset.command === 'close-overlay' ? 'ui_cancel' : 'ui_confirm', { ui: true }));
    });
    this.ui.renderBindings(this.input, false); this.ui.renderBindings(this.input, true); this.ui.renderAudioSettings(this.audio);
  }
  solids() {
    const disabled = new Set();
    if (!this.bossActive) disabled.add('boss_left_wall');
    if (this.courtyardClear) disabled.add('gear_door_blocker');
    if (!this.bossActive || this.boss.finished) disabled.add('boss_room_door');
    const solids = [...this.collision.solids.filter((item) => item.id !== 'boss_floor'), ...this.arenaPlatforms.colliders(), ...this.collision.doors].filter((item) => !disabled.has(item.id));
    return solids;
  }
  oneWays() {
    return this.collision.one_way_platforms.map((item) => item.id === 'moving_01' ? { ...item, y: this.movingY } : item);
  }
  spawnProjectile(projectile) { projectile.age = 0; projectile.animTime = 0; projectile.hit = new Set(); this.projectiles.push(projectile); }
  addFx(type, x, y, life = 0.3, facing = 1, meta = {}) { this.effects.push({ type, x, y, life, maxLife: life, facing, time: 0, ...meta }); }
  endProjectile(projectile, duration = .26) {
    if (projectile.ending) return; projectile.ending = true; projectile.endingTime = duration; projectile.endingDuration = duration; projectile.vx = 0; projectile.vy = 0;
  }
  clearBossThreats() { this.projectiles.forEach((projectile) => { if (projectile.team === 'enemy') this.endProjectile(projectile, projectile.type === 'beam' ? .18 : .26); }); }
  beginPhaseTwoCollapse() {
    if (!this.arenaPlatforms.beginCollapse()) return;
    const center = this.arenaPlatforms.center();
    this.addFx('impact', center.x + center.w * .28, center.y - 2, .42); this.addFx('impact', center.x + center.w * .72, center.y - 2, .42);
    this.audio.playSfx('platform_warning', { x: center.x }); this.audio.playSfx('platform_crack', { x: center.x, volume: .8 });
    this.ui.notify('中央平台開始崩裂，立即離開！', 1.6);
  }
  resolvePlayerAttack(box, player) {
    for (const projectile of this.projectiles) {
      if (projectile.team !== 'enemy' || !projectile.reflectable || !overlap(box, this.projectileBox(projectile))) continue;
      projectile.team = 'player'; projectile.vx = player.facing * Math.max(130, Math.abs(projectile.vx) * 1.5); projectile.vy *= -0.25; projectile.damage = 4; projectile.reflectable = false; player.energy = clamp(player.energy + 10, 0, player.maxEnergy); this.addFx('reflect', projectile.x, projectile.y, 0.3); player.attackHit.add(projectile);
      this.audio.playSfx(projectile.type === 'scoutWind' ? 'wind_bullet_reflect' : 'projectile_reflect', { x: projectile.x });
    }
    for (const enemy of this.enemies) {
      if (enemy.dead || player.attackHit.has(enemy) || !overlap(box, enemy.hitbox())) continue;
      if (enemy.takeDamage(player.attackStage === 3 ? 3 : 2, player.x, this)) { player.attackHit.add(enemy); player.energy = clamp(player.energy + 6, 0, player.maxEnergy); this.hitStop = Math.max(this.hitStop, 0.045); this.audio.playSfx(player.attackStage === 3 ? 'hit_enemy_heavy' : 'hit_enemy_light', { x: enemy.x }); }
    }
    if (this.boss.active && !this.boss.dead && !player.attackHit.has(this.boss) && overlap(box, this.boss.hitbox())) {
      if (this.boss.takeDamage(player.attackStage === 3 ? 4 : 2, player.x, this)) { player.attackHit.add(this.boss); player.energy = clamp(player.energy + 5, 0, player.maxEnergy); this.audio.playSfx(player.attackStage === 3 ? 'hit_enemy_heavy' : 'hit_enemy_light', { x: this.boss.x }); }
    }
  }
  projectileBox(projectile) { return { x: projectile.x - projectile.w / 2, y: projectile.y - projectile.h / 2, w: projectile.w, h: projectile.h }; }
  updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      projectile.age += dt; projectile.animTime += dt;
      if (projectile.ending) { projectile.endingTime -= dt; continue; }
      projectile.life -= dt;
      if (projectile.type === 'ring' && projectile.age >= projectile.outwardUntil && projectile.age < projectile.returnAt && !projectile.turned) {
        projectile.turned = true; projectile.vx = projectile.targetDirection * 155; projectile.vy = (projectile.socketIndex ? 1 : -1) * 24;
      }
      if (projectile.type === 'ring' && projectile.age >= projectile.returnAt) {
        const socket = this.boss.ringSockets()[projectile.socketIndex || 0]; const dx = socket.x - projectile.x; const dy = socket.y - projectile.y; const distance = Math.hypot(dx, dy) || 1;
        projectile.vx = dx / distance * 185; projectile.vy = dy / distance * 185; projectile.returning = true;
        if (distance < 12) { projectile.x = socket.x; projectile.y = socket.y; this.endProjectile(projectile, .3); this.addFx('hit', socket.x, socket.y, .22); this.audio.playSfx('oro_ring_end', { x: socket.x }); continue; }
      }
      if (!projectile.static) { projectile.x += projectile.vx * dt; projectile.y += projectile.vy * dt; }
      const box = this.projectileBox(projectile);
      if (projectile.team === 'enemy' && overlap(box, this.player.hurtbox())) { this.player.takeDamage(projectile.damage, projectile.x, this); if (['ring', 'bossBullet', 'beam'].includes(projectile.type)) this.endProjectile(projectile, projectile.type === 'beam' ? .14 : .22); else projectile.life = 0; }
      if (projectile.team === 'player') {
        for (const enemy of this.enemies) if (!enemy.dead && !projectile.hit.has(enemy) && overlap(box, enemy.hitbox())) { enemy.takeDamage(projectile.damage, projectile.x, this); projectile.hit.add(enemy); if (!projectile.pierce) projectile.life = 0; }
        if (this.boss.active && !this.boss.dead && !projectile.hit.has(this.boss) && overlap(box, this.boss.hitbox())) { this.boss.takeDamage(projectile.damage, projectile.x, this); projectile.hit.add(this.boss); if (!projectile.pierce) projectile.life = 0; }
      }
      if (!projectile.static && projectile.type !== 'ring' && this.solids().some((solid) => overlap(box, solid))) projectile.life = 0;
      if (projectile.life <= 0 && ['ring', 'bossBullet', 'beam'].includes(projectile.type)) this.endProjectile(projectile, projectile.type === 'beam' ? .18 : .24);
    }
    this.projectiles = this.projectiles.filter((projectile) => (projectile.ending ? projectile.endingTime > 0 : projectile.life > 0) && projectile.x > -60 && projectile.x < this.worldWidth + 60);
  }
  updateEffects(dt) { this.effects.forEach((effect) => { effect.life -= dt; effect.time += dt; }); this.effects = this.effects.filter((effect) => effect.life > 0); }
  activateCheckpoint(checkpointId = 'checkpoint_01') {
    if (this.activeCheckpointId === checkpointId) return;
    const checkpoint = this.objectData.interactives.find((item) => item.id === checkpointId && item.type === 'checkpoint'); if (!checkpoint) return;
    this.checkpointActive = true; this.activeCheckpointId = checkpointId; this.checkpoint = checkpoint.respawn;
    this.save.checkpoint = { level: 'level_01_cloud_gate', id: checkpointId, ...checkpoint.respawn }; writeSave(this.save);
    this.addFx('checkpoint', checkpoint.x + (checkpoint.width || 64) / 2, checkpoint.y + 24, 0.8); this.ui.notify(checkpointId === 'checkpoint_boss' ? '雲門旗標已啟動・自動存檔' : '檢查點已啟動・自動存檔');
    this.audio.playSfx(checkpointId === 'checkpoint_boss' ? 'checkpoint_flag_activate' : 'checkpoint_crystal_activate', { x: checkpoint.x + 24 }); this.audio.playSfx('checkpoint_saved', { ui: true });
    this.audio.stopLoop('world:checkpoint'); this.audio.startLoop('checkpoint_idle_loop', 'world:checkpoint', { x: checkpoint.x + 24 });
  }
  fallRespawn() {
    if (this.player.invulnerable > 0.9) return;
    this.player.hp -= 1; this.audio.playSfx('death_fall', { x: this.player.x });
    if (this.player.hp <= 0) { this.player.dead = true; this.player.deathTimer = 0.6; this.player.setAnim('death'); return; }
    this.player.respawn({ ...this.checkpoint, facing: 'right' }); this.player.hp = Math.max(1, this.player.hp); this.ui.notify('上升氣流將你送回立足點');
  }
  showGameOver() { if (this.gameOver || this.victory) return; this.gameOver = true; this.setState(STATES.GAME_OVER); this.ui.show('game-over'); this.input.clear(); }
  retry() {
    this.ui.hideAll(); this.audio.stopLoops('enemy:'); this.audio.stopLoops('boss:'); this.gameOver = false; this.projectiles.length = 0; this.effects.length = 0; this.hitStop = 0; this.movingY = 148; this.movingDirection = -1; this.movingDelta = 0; this.phaseTwo = false; this.arenaPlatforms.reset(); this.bossActive = false; this.courtyardClear = false; this.windRingCooldown = 0;
    this.player = new Player({ ...this.checkpoint, facing: 'right' }, this.save.maxHp, this.save.maxEnergy);
    this.enemies = this.objectData.enemy_spawns.filter((spawn) => spawn.enemy !== 'oro').map((spawn) => spawn.enemy === 'wind_scout_bug' ? new WindScout(spawn) : new CourtyardGuard(spawn));
    this.boss = new OroBoss(this.objectData.enemy_spawns.find((spawn) => spawn.enemy === 'oro')); this.applyDebugStart(); this.pauseReason = null; this.setState(STATES.GAMEPLAY);
  }
  setState(state) {
    this.state = state; document.getElementById('game-shell').dataset.state = state;
    document.getElementById('hud').hidden = ![STATES.GAMEPLAY, STATES.PAUSED, STATES.GAME_OVER, STATES.VICTORY].includes(state); this.input.clear();
    this.audio.setPaused(state === STATES.PAUSED || state === STATES.GAME_OVER);
    if (state === STATES.OPENING) this.audio.playMusic('music_opening', .8);
    else if (state === STATES.MAIN_MENU) this.audio.playMusic('music_menu', .7);
    else if (state === STATES.INTRO_STORY) this.audio.playMusic('music_intro', .8);
    else if (state === STATES.GAMEPLAY) {
      this.audio.playMusic(this.bossActive ? 'music_boss_oro' : 'music_level_01', .75);
      this.audio.startLoop('ambience_high_wind', 'world:wind'); this.audio.startLoop('ambience_machine_hum', 'world:machine'); this.audio.startLoop('ambience_cloud_sea', 'world:clouds');
      this.audio.playSfx('moving_platform_start', { x: 430, volume: .55 });
      const checkpoint = this.objectData.interactives.find((item) => item.id === this.activeCheckpointId); if (checkpoint) this.audio.startLoop('checkpoint_idle_loop', 'world:checkpoint', { x: checkpoint.x + 24 });
    }
  }
  setPause(reason = 'pause') { if (this.gameOver || this.victory || this.state !== STATES.GAMEPLAY) return; this.pauseReason = reason; this.overlayReturnState = STATES.GAMEPLAY; this.audio.playSfx('ui_pause', { ui: true }); this.setState(STATES.PAUSED); this.ui.show(reason); }
  resume() {
    this.input.cancelCapture(); this.pauseReason = null; this.modalOpen = null; this.ui.hideAll(); const destination = this.overlayReturnState || STATES.GAMEPLAY; this.overlayReturnState = null; this.setState(destination);
  }
  openOverlay(reason) {
    if (![STATES.MAIN_MENU, STATES.GAMEPLAY].includes(this.state)) return; this.ui.renderBindings(this.input, reason === 'settings'); this.overlayReturnState = this.state; this.modalOpen = reason;
    this.ui.renderAudioSettings(this.audio); this.audio.playSfx('ui_open', { ui: true }); if (this.state === STATES.GAMEPLAY) this.setState(STATES.PAUSED); this.ui.show(reason);
  }
  resetGameplayFromSave() {
    this.audio.stopLoops('enemy:'); this.audio.stopLoops('boss:');
    const checkpoint = this.save.checkpoint?.level === 'level_01_cloud_gate' ? this.save.checkpoint : null; const spawn = checkpoint ? { x: checkpoint.x, y: checkpoint.y, facing: 'right' } : this.objectData.player_spawn;
    this.checkpoint = checkpoint ? { x: checkpoint.x, y: checkpoint.y } : { x: this.objectData.player_spawn.x, y: this.objectData.player_spawn.y }; this.checkpointActive = Boolean(checkpoint); this.activeCheckpointId = checkpoint?.id || (checkpoint ? 'checkpoint_01' : null);
    this.player = new Player(spawn, this.save.maxHp, this.save.maxEnergy); this.movingY = 148; this.movingDirection = -1; this.movingDelta = 0; this.hitStop = 0; this.projectiles.length = 0; this.effects.length = 0; this.phaseTwo = false; this.arenaPlatforms.reset(); this.bossActive = false; this.courtyardClear = false; this.windRingCooldown = 0; this.gameOver = false; this.victory = false; this.cameraX = clamp(this.player.x - 150, 0, this.worldWidth - WORLD_WIDTH);
    this.enemies = this.objectData.enemy_spawns.filter((spawnData) => spawnData.enemy !== 'oro').map((spawnData) => spawnData.enemy === 'wind_scout_bug' ? new WindScout(spawnData) : new CourtyardGuard(spawnData)); this.boss = new OroBoss(this.objectData.enemy_spawns.find((spawnData) => spawnData.enemy === 'oro')); this.applyDebugStart();
  }
  applyDebugStart() {
    if (!this.debug) return;
    if (this.debugArea === 'courtyard') { this.player.respawn({ x: 510, y: 184, facing: 'right' }); this.cameraX = 340; return; }
    if (this.debugArea === 'boss-gate') { this.player.respawn({ x: 830, y: 176, facing: 'right' }); this.cameraX = 768; return; }
    if (this.debugArea === 'boss' || this.debugArea === 'boss-center') {
      this.player.respawn({ x: this.debugArea === 'boss-center' ? 960 : 885, y: 176, facing: 'right' }); this.checkpoint = { x: 830, y: 176 }; this.cameraX = 768; this.bossActive = true; this.boss.activate(this);
      if (this.debugPhase >= 2) this.boss.hp = this.boss.maxHp * .5;
    }
  }
  enterGameplay(fromContinue = false, showChapter = false) {
    if (fromContinue) this.resetGameplayFromSave(); this.audio.preloadGroup('level'); this.ui.hideAll(); this.modalOpen = null; this.pauseReason = null; this.flow.showOnly(showChapter ? this.flow.chapter : null);
    const begin = () => { this.flow.showOnly(null); this.setState(STATES.GAMEPLAY); this.lastTime = performance.now(); };
    if (showChapter) { this.setState(STATES.INTRO_STORY); setTimeout(begin, 2600); } else this.flow.transition(begin);
  }
  prepareMainMenu() { writeSave(this.save); this.projectiles.length = 0; this.effects.length = 0; this.bossActive = false; this.boss.active = false; this.pauseReason = null; this.modalOpen = null; this.audio.stopLoops(); this.ui.hideAll(); }
  returnToMainMenu() { this.prepareMainMenu(); this.flow.showMenu(); }
  finishBoss() {
    this.clearBossThreats(); this.bossActive = false; this.save.level01Complete = true;
    if (!this.save.unlockedSkills.includes('returningWindSlash')) this.save.unlockedSkills.push('returningWindSlash');
    const elapsed = Math.round(this.runTime * 10) / 10; this.save.bestTime = this.save.bestTime == null ? elapsed : Math.min(this.save.bestTime, elapsed); writeSave(this.save);
    document.getElementById('victory-stats').textContent = `時間 ${elapsed.toFixed(1)} 秒　受傷 ${this.player.hurtCount} 次`;
    this.victory = true; this.audio.stopLoops(); this.audio.stopMusic(.35); this.audio.playMusic('music_victory', .12); this.setState(STATES.VICTORY); this.ui.show('victory'); this.input.clear();
  }
  update(dt) {
    this.time += dt; if (this.state === STATES.GAMEPLAY) this.runTime += dt; this.audio.setListenerX(this.player.x); this.ui.update(dt, this);
    if (this.input.wasPressed('pause')) {
      if (this.flow.cancelConfirm()) { this.input.endFrame(); return; }
      if (this.modalOpen || this.state === STATES.PAUSED) this.resume(); else if (this.state === STATES.GAMEPLAY) this.setPause('pause'); this.input.endFrame(); return;
    }
    if (this.input.wasPressed('debug')) this.debug = !this.debug;
    if (this.state !== STATES.GAMEPLAY) { this.input.endFrame(); return; }
    this.audio.startLoop('ambience_high_wind', 'world:wind'); this.audio.startLoop('ambience_machine_hum', 'world:machine'); this.audio.startLoop('ambience_cloud_sea', 'world:clouds');
    if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); this.input.endFrame(); return; }
    const moving = this.objectData.platform_visuals.find((item) => item.id === 'moving_01').motion;
    const previousMovingY = this.movingY;
    this.movingY += this.movingDirection * moving.speed * dt;
    if (this.movingY < moving.min || this.movingY > moving.max) { this.movingY = clamp(this.movingY, moving.min, moving.max); this.movingDirection *= -1; this.audio.playSfx('moving_platform_stop', { x: 430, volume: .65 }); }
    this.movingDelta = this.movingY - previousMovingY;
    const movingVisual = this.objectData.platform_visuals.find((item) => item.id === 'moving_01');
    if (this.player.grounded && Math.abs(this.player.y - previousMovingY) < 2.5 && this.player.x + 8 > movingVisual.x && this.player.x - 8 < movingVisual.x + movingVisual.width) this.player.y += this.movingDelta;
    const platformEvent = this.arenaPlatforms.update(dt); if (platformEvent === 'destroyed') { const center = this.arenaPlatforms.center(); this.addFx('death', center.x + center.w / 2, center.y + 8, .5); this.audio.playSfx('platform_collapse', { x: center.x + center.w / 2 }); }
    this.player.update(dt, this); this.windRingCooldown = Math.max(0, this.windRingCooldown - dt);
    const baseRing = this.objectData.interactives.find((item) => item.type === 'wind_ring'); const rings = [baseRing, ...(this.phaseTwo ? [{ x: 812, y: 112, width: 64, height: 64 }] : [])];
    if (this.windRingCooldown <= 0 && rings.some((ring) => overlap(this.player.hitbox(), { x: ring.x + 8, y: ring.y + 8, w: (ring.width || 64) - 16, h: (ring.height || 64) - 16 }))) {
      this.player.vy = -205; this.player.dashAvailable = true; this.windRingCooldown = 0.55; this.addFx('reflect', this.player.x, this.player.y - 24, 0.3); this.audio.playSfx('wind_ring_activate', { x: this.player.x }); this.ui.notify('風環重置翼環', 1);
    }
    this.enemies.forEach((enemy) => enemy.update(dt, this)); this.enemies = this.enemies.filter((enemy) => !enemy.remove);
    const wasCourtyardClear = this.courtyardClear; this.courtyardClear = !this.enemies.some((enemy) => !enemy.dead && enemy.x > 380 && enemy.x < 760); if (!wasCourtyardClear && this.courtyardClear) this.audio.playSfx('gear_door_open', { x: 742 });
    this.boss.update(dt, this); this.updateProjectiles(dt); this.updateEffects(dt);
    for (const trigger of this.data['scene-hooks'].triggers.filter((item) => item.checkpointId)) if (overlap(this.player.hitbox(), trigger)) this.activateCheckpoint(trigger.checkpointId);
    const bossTrigger = this.data['scene-hooks'].triggers.find((item) => item.id === 'boss_start');
    if (!this.boss.active && overlap(this.player.hitbox(), bossTrigger)) { this.bossActive = true; this.boss.activate(this); this.audio.playSfx('boss_door_close', { x: bossTrigger.x }); this.audio.playMusic('music_boss_oro', .9); this.ui.notify('天門守機「奧羅」'); }
    const desired = this.boss.active ? 768 : clamp(this.player.x - 150, 0, this.worldWidth - WORLD_WIDTH); this.cameraX += (desired - this.cameraX) * Math.min(1, dt * 7);
    this.input.endFrame();
  }
  drawParallax(image, factor, alpha = 1) {
    if (!image) return; const tileWidth = WORLD_WIDTH; const offset = -((this.cameraX * factor) % tileWidth); ctx.save(); ctx.globalAlpha = alpha;
    for (let x = offset - tileWidth; x < WORLD_WIDTH + tileWidth; x += tileWidth) ctx.drawImage(image, Math.round(x), 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.restore();
  }
  objectKey(assetPath) { return assetPath.split('/').pop().replace('.png', '').replace('..', ''); }
  drawPlatformImage(image, x, y, width, height) {
    const bounds = imageAlphaBounds(image); const sourceWidth = bounds.right - bounds.left + 1;
    ctx.save(); ctx.drawImage(image, bounds.left, 0, sourceWidth, image.height, Math.round(x - this.cameraX), Math.round(y), Math.round(width), Math.round(height)); ctx.restore();
  }
  drawArenaPlatform(image, item) {
    const bounds = imageAlphaBounds(image); const sourceWidth = bounds.right - bounds.left + 1;
    for (const platform of this.arenaPlatforms.platforms) {
      if (!platform.visualActive && !platform.debrisActive) continue;
      const ratioX = (platform.x - item.x) / item.width; const ratioW = platform.w / item.width; const sx = bounds.left + sourceWidth * ratioX; const sw = sourceWidth * ratioW;
      const breaking = platform.state === 'breaking'; const warning = this.arenaPlatforms.warningProgress(); const shake = breaking && platform.elapsed < 1.05 ? Math.sin(this.time * 55) * (0.25 + warning * 1.15) : 0; const y = item.y + platform.dropY + shake;
      ctx.save(); ctx.globalAlpha = platform.alpha; ctx.drawImage(image, sx, 0, sw, image.height, Math.round(platform.x - this.cameraX), Math.round(y), Math.round(platform.w), Math.round(item.height));
      if (breaking) {
        const left = Math.round(platform.x - this.cameraX); const pulse = .55 + Math.sin(this.time * 18) * .18;
        ctx.globalAlpha = (.16 + warning * .22) * pulse; ctx.fillStyle = warning > .66 ? '#ff4d35' : '#d78b26'; ctx.fillRect(left, Math.round(y), Math.round(platform.w), Math.round(item.height));
        ctx.globalAlpha = .62 + warning * .36; ctx.fillStyle = warning > .66 ? '#fff0a8' : '#ffce58'; ctx.fillRect(left, Math.round(y), Math.round(platform.w), 2);
        ctx.strokeStyle = warning > .66 ? '#fff0a8' : '#5e392a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(left + 5, y + 1); ctx.lineTo(left + 13, y + 7); ctx.lineTo(left + 20, y + 3); ctx.lineTo(left + 28, y + 12); ctx.lineTo(left + 34, y + 7); ctx.lineTo(left + 41, y + 15); ctx.moveTo(left + 49, y + 1); ctx.lineTo(left + 43, y + 7); ctx.lineTo(left + 52, y + 13); ctx.stroke();
      }
      ctx.restore();
    }
  }
  renderWorld() {
    this.drawParallax(this.assets.parallax.sky, 0); this.drawParallax(this.assets.parallax['far-bg'], .12); this.drawParallax(this.assets.parallax['mid-bg'], .28, .72); this.drawParallax(this.assets.parallax['near-bg'], .52, .38);
    for (const decoration of this.objectData.decorations) { const image = this.assets.objects[this.objectKey(decoration.asset)]; drawImageWorld(ctx, image, decoration.x, decoration.y, this.cameraX, decoration.alpha ?? .62, image.width / MAP_ASSET_SCALE, image.height / MAP_ASSET_SCALE); }
    for (const item of this.objectData.platform_visuals) {
      const image = this.assets.objects[this.objectKey(item.asset)]; if (!image) continue;
      const y = item.id === 'moving_01' ? this.movingY : item.y;
      if (item.id === 'boss_floor') this.drawArenaPlatform(image, item); else this.drawPlatformImage(image, item.x, y, item.width, item.height);
    }
    for (const item of this.objectData.interactives) {
      if (item.id === 'gear_door_blocker' && this.courtyardClear) continue;
      if (item.id === 'boss_room_door' && !this.bossActive) continue;
      const image = this.assets.objects[this.objectKey(item.asset)]; const width = item.width || image.width / MAP_ASSET_SCALE; const height = item.height || image.height / MAP_ASSET_SCALE;
      const activeCheckpoint = item.type === 'checkpoint' && item.id === this.activeCheckpointId;
      drawImageWorld(ctx, image, item.x, item.y, this.cameraX, activeCheckpoint ? .88 + Math.sin(this.time * 6) * .12 : 1, width, height);
      if (activeCheckpoint) {
        const crystal = item.id === 'checkpoint_01'; const fxX = item.x + (crystal ? width * .5 : width * .18); const fxY = item.y + (crystal ? height * .24 : height * .11);
        drawAnchored(ctx, frameAt(this.assets.fx.hit, this.time, 8, true), fxX, fxY, this.cameraX, 48, 48, 1, .7, false, crystal ? .3 : .22);
      }
    }
    if (this.phaseTwo) drawImageWorld(ctx, this.assets.objects.wind_ring, 812, 112, this.cameraX, 1, 64, 64);
  }
  renderProjectiles() {
    for (const projectile of this.projectiles) {
      if (projectile.type === 'scoutWind') drawAnchored(ctx, frameAt(this.assets.scout.projectile, projectile.animTime, 12, true), projectile.x, projectile.y, this.cameraX, 32, 32, Math.sign(projectile.vx) || 1);
      else if (projectile.type === 'windPulse') drawAnchored(ctx, frameAt(this.assets.fx.windPulse, projectile.animTime, 12, true), projectile.x, projectile.y, this.cameraX, 48, 48, Math.sign(projectile.vx) || 1);
      else this.renderBossProjectile(projectile);
    }
  }
  renderBossProjectile(projectile) {
    const x = Math.round(projectile.x - this.cameraX); const y = Math.round(projectile.y); const ending = projectile.ending ? Math.max(0, projectile.endingTime / projectile.endingDuration) : 1; ctx.save(); ctx.globalAlpha = ending;
    if (projectile.type === 'ring') {
      drawAnchored(ctx, frameAt(this.assets.fx.ring, projectile.animTime, 14, true), projectile.x, projectile.y, this.cameraX, 64, 64, Math.sign(projectile.vx) || 1, ending, false, .42 * (.82 + ending * .18), projectile.animTime * 7);
    } else if (projectile.type === 'bossBullet') {
      drawAnchored(ctx, frameAt(this.assets.fx.bossBullet, projectile.animTime, 12, true), projectile.x, projectile.y, this.cameraX, 48, 48, Math.sign(projectile.vx) || 1, ending, false, .48 * (.78 + ending * .22));
    } else if (projectile.type === 'beam') {
      const box = this.projectileBox(projectile); const left = Math.round(box.x - this.cameraX); const frame = frameAt(this.assets.fx.beam, projectile.animTime, 13, true);
      ctx.globalAlpha = .94 * ending; ctx.drawImage(frame, 0, 0, frame.width, Math.floor(frame.height * .5), left, Math.round(box.y - 8), Math.round(box.w), 25);
      if (projectile.sourceX != null) { ctx.globalAlpha = .75 * ending; ctx.fillStyle = '#bffcff'; ctx.fillRect(Math.round(projectile.sourceX - this.cameraX - 1), Math.round(projectile.sourceY), 3, Math.round(box.y - projectile.sourceY + 4)); }
    }
    ctx.restore();
  }
  renderEffects() {
    for (const effect of this.effects) {
      const progress = Math.min(1, effect.time / effect.maxLife); const x = Math.round(effect.x - this.cameraX); const y = Math.round(effect.y); ctx.save(); ctx.globalAlpha = effect.type === 'slash' ? (progress < .72 ? 1 : Math.max(0, 1 - (progress - .72) / .28)) : 1 - progress;
      if (effect.type === 'slash') {
        const frameIndex = progress < .18 ? 0 : progress < .74 ? 1 : progress < .9 ? 2 : 3; const frame = this.assets.fx.slash[frameIndex]; const scale = effect.stage === 3 ? .68 : effect.stage === 2 ? .55 : effect.stage === 0 ? .58 : .46; const rotation = effect.stage === 2 ? -.72 : effect.stage === 0 ? .55 : effect.stage === 3 ? .12 : 0;
        ctx.translate(x, y); ctx.rotate(rotation * effect.facing); ctx.scale(effect.facing * scale, scale); ctx.drawImage(frame, -64, -64);
      } else {
        const groups = { dash: this.assets.fx.dash, phase: this.assets.fx.phase, checkpoint: this.assets.fx.hit, hit: this.assets.fx.hit, impact: this.assets.fx.impact, reflect: this.assets.fx.reflect, death: this.assets.fx.death };
        const frames = groups[effect.type]; const frame = frameAt(frames, effect.time, effect.type === 'phase' ? 8 : 14, false);
        if (frame) {
          const anchorX = frame.width / 2; const anchorY = frame.height / 2; const scale = effect.type === 'phase' ? .62 : effect.type === 'dash' ? .72 : effect.type === 'death' ? .58 : effect.type === 'checkpoint' ? .45 : .38;
          ctx.translate(x, y); ctx.scale(effect.facing * scale, scale); ctx.drawImage(frame, -anchorX, -anchorY);
        }
      }
      ctx.restore();
    }
  }
  renderDebug() {
    if (!this.debug) return;
    for (const solid of this.solids()) drawRect(ctx, solid, this.cameraX, '#ff553d55');
    for (const platform of this.oneWays()) drawRect(ctx, platform, this.cameraX, '#43ff7f77');
    for (const visual of this.objectData.platform_visuals) drawRect(ctx, { x: visual.x, y: visual.id === 'moving_01' ? this.movingY : visual.y, w: visual.width, h: visual.height }, this.cameraX, '#4ee6ff', true);
    this.hazards.forEach((hazard) => drawRect(ctx, hazard, this.cameraX, '#ff0c9a66'));
    ctx.save(); ctx.font = '6px monospace'; this.arenaPlatforms.platforms.forEach((platform) => { const mismatch = platform.visualActive !== platform.collisionActive; drawRect(ctx, platform, this.cameraX, mismatch ? '#ff243d' : platform.state === 'breaking' ? '#ffb13d' : platform.state === 'destroyed' ? '#8b5cff' : '#58ef93', true); ctx.fillStyle = mismatch ? '#ff243d' : '#eaffff'; ctx.fillText(`${platform.id} ${platform.state} C:${platform.collisionActive} V:${platform.visualActive}`, Math.round(platform.x - this.cameraX), Math.round(platform.y - 3)); }); ctx.restore();
    const playerFrameInfo = this.player.currentFrameInfo(this); const visualOffset = this.player.visualCorrectionY(this);
    drawRect(ctx, { x: this.player.x - 64, y: this.player.y - 104 + visualOffset, w: 128, h: 128 }, this.cameraX, '#7fdcff', true); drawRect(ctx, this.player.hitbox(), this.cameraX, '#57e8ff88'); drawRect(ctx, this.player.hurtbox(), this.cameraX, '#579dff', true); drawRect(ctx, anchoredVisualBounds(playerFrameInfo.frame, this.player.x, this.player.y + visualOffset, 64, 104, this.player.facing), this.cameraX, '#ffffff', true);
    drawAnchor(ctx, this.player.x, this.player.y, this.cameraX, '#fff'); drawAnchor(ctx, this.player.x + 6, this.player.visualFeetY(this), this.cameraX, '#45ff9a'); const standingSurface = [...this.solids(), ...this.oneWays()].find((surface) => Math.abs(surface.y - this.player.y) < 2 && this.player.x >= surface.x && this.player.x <= surface.x + surface.w); if (standingSurface) { ctx.strokeStyle = '#ff65ec'; ctx.beginPath(); ctx.moveTo(this.player.x - this.cameraX - 14, standingSurface.y + .5); ctx.lineTo(this.player.x - this.cameraX + 14, standingSurface.y + .5); ctx.stroke(); }
    const attack = this.player.attackBox(); if (attack) drawRect(ctx, attack, this.cameraX, '#fff24599'); const fxOrigin = this.player.attackFxOrigin(); drawAnchor(ctx, fxOrigin.x, fxOrigin.y, this.cameraX, '#ffe94e');
    this.enemies.forEach((enemy) => { drawRect(ctx, enemy.hitbox(), this.cameraX, '#ff554488'); drawRect(ctx, anchoredVisualBounds(frameAt(this.assets[enemy.constructor.name === 'WindScout' ? 'scout' : 'guard'][enemy.anim] || [], enemy.animTime, 8, true), enemy.x, enemy.y, enemy.constructor.name === 'WindScout' ? 48 : 64, enemy.constructor.name === 'WindScout' ? 76 : 104, enemy.facing), this.cameraX, '#ff9fe9', true); drawAnchor(ctx, enemy.x, enemy.y, this.cameraX, '#ffaf9c'); }); if (this.boss.active) { drawRect(ctx, this.boss.hitbox(), this.cameraX, '#ff554488'); drawRect(ctx, anchoredVisualBounds(this.boss.currentFrame(this), this.boss.x, this.boss.y, 96, 164, this.boss.facing, false, .72), this.cameraX, '#ffdf64', true); drawAnchor(ctx, this.boss.x, this.boss.y, this.cameraX, '#ffdf64'); this.boss.ringSockets().forEach((socket) => drawAnchor(ctx, socket.x, socket.y, this.cameraX, '#ffcf48')); const emitter = this.boss.emitterPoint(); drawAnchor(ctx, emitter.x, emitter.y, this.cameraX, '#52f7ff'); }
    this.projectiles.forEach((projectile) => drawRect(ctx, this.projectileBox(projectile), this.cameraX, '#eaff5a99'));
    const checkpoints = this.data['scene-hooks'].triggers.filter((item) => item.checkpointId); const bossTrigger = this.data['scene-hooks'].triggers.find((item) => item.id === 'boss_start'); const arena = this.data['scene-hooks'].camera_zones.find((item) => item.id === 'boss_camera'); checkpoints.forEach((checkpoint) => drawRect(ctx, checkpoint, this.cameraX, '#46dfff55')); drawRect(ctx, bossTrigger, this.cameraX, '#c75aff55'); drawRect(ctx, arena, this.cameraX, '#f0a3ff', true);
  }
  render() {
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT); this.renderWorld(); this.enemies.forEach((enemy) => enemy.render(ctx, this)); this.boss.render(ctx, this); this.player.render(ctx, this); this.renderProjectiles(); this.renderEffects(); this.drawParallax(this.assets.parallax['foreground-overlay'], 1.15, .36); this.renderDebug(); this.ui.update(0, this);
  }
  loop(now) {
    const raw = Math.min(0.05, (now - this.lastTime) / 1000); this.lastTime = now; this.fps += ((raw > 0 ? 1 / raw : 60) - this.fps) * 0.08; this.accumulator += raw;
    while (this.accumulator >= 1 / 60) { this.update(1 / 60); this.accumulator -= 1 / 60; }
    this.render(); requestAnimationFrame((time) => this.loop(time));
  }
}

async function boot() {
  const ui = new UI();
  try {
    ui.loading('正在確認關卡資料…'); const data = await loadLevelData();
    const assets = await loadAssets((loaded, total) => ui.loading(`正在載入素材 ${loaded} / ${total}`));
    const save = loadSave(); const audio = await createAudioManager(save.audio, (settings) => { save.audio = settings; writeSave(save); });
    globalThis.__SKY_CITY_GAME__ = new Game(assets, data, audio, save);
  } catch (error) { console.error('[boot] 遊戲初始化失敗', error); ui.error(error); }
}

boot();
