import { ACTIONS, ACTION_LABELS, displayCode } from './controls.js';

export class UI {
  constructor() {
    this.panels = Object.fromEntries(['loading', 'error', 'pause', 'help', 'settings', 'game-over', 'victory'].map((id) => [id, document.getElementById(id)]));
    this.health = document.getElementById('health'); this.energy = document.querySelector('#energy-bar i'); this.energyValue = document.getElementById('energy-value');
    this.bossHud = document.getElementById('boss-hud'); this.bossHealth = document.querySelector('#boss-health i'); this.bossPhase = document.getElementById('boss-phase');
    this.toastNode = document.getElementById('toast'); this.debugNode = document.getElementById('debug-info'); this.enemyBars = document.getElementById('enemy-bars'); this.enemyBarNodes = new Map(); this.toast = { text: '', timer: 0 };
  }
  show(name) { Object.entries(this.panels).forEach(([key, panel]) => panel?.classList.toggle('active', key === name)); }
  hideAll() { Object.values(this.panels).forEach((panel) => panel?.classList.remove('active')); }
  loading(text) { document.getElementById('loading-text').textContent = text; this.show('loading'); }
  error(error) { document.getElementById('error-text').textContent = error?.stack || String(error); this.show('error'); }
  notify(text, seconds = 2) { this.toast = { text, timer: seconds }; }
  update(dt, game) {
    this.toast.timer = Math.max(0, this.toast.timer - dt); this.toastNode.hidden = this.toast.timer <= 0; this.toastNode.textContent = this.toast.text;
    if (!game) return; const player = game.player;
    if (this.health.children.length !== player.maxHp) this.health.replaceChildren(...Array.from({ length: player.maxHp }, () => Object.assign(document.createElement('i'), { className: 'heart' })));
    [...this.health.children].forEach((heart, index) => heart.classList.toggle('full', index < player.hp));
    this.energy.style.width = `${100 * player.energy / player.maxEnergy}%`; this.energyValue.textContent = `${Math.ceil(player.energy)} / ${player.maxEnergy}`;
    const bossShown = game.boss.active && !game.boss.finished; this.bossHud.hidden = !bossShown;
    if (bossShown) { this.bossHealth.style.width = `${100 * game.boss.hp / game.boss.maxHp}%`; this.bossPhase.textContent = `Phase ${game.boss.phase}`; }
    this.updateEnemyBars(game);
    this.debugNode.hidden = !game.debug;
    if (game.debug) this.debugNode.textContent = [
      `FPS ${game.fps.toFixed(0)}  Canvas ${game.renderInfo.width}×${game.renderInfo.height}  DPR ${game.renderInfo.dpr.toFixed(2)}`,
      `State ${game.state}  World 384×216  Render ${game.renderInfo.scaleX.toFixed(2)}×  Camera X ${game.cameraX.toFixed(1)}`,
      `Player X/Y ${player.x.toFixed(1)} / ${player.y.toFixed(1)}  VX/VY ${player.vx.toFixed(1)} / ${player.vy.toFixed(1)}`,
      `Grounded ${player.grounded}  Crouch ${player.crouching}  Anim ${player.anim}  Facing ${player.facing > 0 ? 'right' : 'left'}`,
      `Feet physics/visual ${player.y.toFixed(1)} / ${player.visualFeetY(game).toFixed(1)}  Hurtbox ${player.hurtbox().h}px (${player.crouching ? 'crouching' : 'standing'})`,
      `Attack FX origin ${player.attackFxOrigin().x.toFixed(1)} / ${player.attackFxOrigin().y.toFixed(1)}  active ${player.isAttackActive()}`,
      `Enemies ${game.enemies.filter((enemy) => !enemy.dead).map((enemy) => `${enemy.id}:${enemy.anim}/${enemy.state}${enemy.invulnerable > 0 ? ':hitFX' : ''}`).join('  ') || 'none'}`,
      `Boss active ${game.boss.active}  attack ${game.boss.state}  anim ${game.boss.animation()}  FX ${game.projectiles.filter((p) => ['ring', 'bossBullet', 'beam'].includes(p.type)).map((p) => p.type).join(',') || 'none'}`,
      `Boss sockets ring ${game.boss.ringSockets().map((p) => `${p.x.toFixed(0)}/${p.y.toFixed(0)}`).join(' ')}  projectile ${game.boss.emitterPoint().x.toFixed(0)}/${game.boss.emitterPoint().y.toFixed(0)}  dash target ${game.boss.dashTarget?.toFixed?.(0) ?? '-'}`,
      `Checkpoint ${game.activeCheckpointId || 'none'}  save ${game.checkpoint.x}/${game.checkpoint.y}`,
      `Arena ${game.arenaPlatforms.debugSummary()}`,
      `Arena sync ${game.arenaPlatforms.syncIssues().length ? 'ERROR ' + game.arenaPlatforms.syncIssues().map((item) => item.id).join(',') : 'OK'}`,
      `Audio unlocked ${game.audio.debugState().unlocked}  muted ${game.audio.debugState().muted}  master ${game.audio.debugState().master.toFixed(2)}  music ${game.audio.debugState().music}`,
      `Audio loops ${game.audio.debugState().activeLoops.join(',') || 'none'}  last SFX ${game.audio.debugState().lastSfx}`,
    ].join('\n');
  }
  updateEnemyBars(game) {
    const liveIds = new Set(); const shell = document.getElementById('game-shell'); const width = shell.clientWidth || 1; const height = shell.clientHeight || 1;
    for (const enemy of game.enemies) {
      if (enemy.dead || enemy.remove) continue;
      const distance = Math.abs(game.player.x - enemy.x); const engaged = enemy.healthBarTimer > 0 || distance < 112 || !['patrol', 'walk', 'guard'].includes(enemy.state);
      const screenX = (enemy.x - game.cameraX) / 384 * width; const worldTop = enemy.constructor.name === 'WindScout' ? enemy.y - 31 : enemy.y - 51; const screenY = worldTop / 216 * height;
      if (!engaged || screenX < -60 || screenX > width + 60 || screenY < 0 || screenY > height) continue;
      liveIds.add(enemy.id); let node = this.enemyBarNodes.get(enemy.id);
      if (!node) {
        node = document.createElement('div'); node.className = `enemy-health ${enemy.constructor.name === 'CourtyardGuard' ? 'guard' : 'scout'}`;
        const track = document.createElement('span'); track.className = 'enemy-health-track'; track.append(document.createElement('i')); const value = document.createElement('span'); value.className = 'enemy-health-value'; node.append(track, value); this.enemyBars.append(node); this.enemyBarNodes.set(enemy.id, node);
      }
      node.style.left = `${screenX}px`; node.style.top = `${screenY}px`; node.classList.toggle('weak', enemy.state === 'stunned'); node.querySelector('i').style.width = `${Math.max(0, enemy.hp / enemy.maxHp) * 100}%`; node.querySelector('.enemy-health-value').textContent = `${Math.ceil(Math.max(0, enemy.hp))} / ${enemy.maxHp}`;
    }
    for (const [id, node] of this.enemyBarNodes) if (!liveIds.has(id)) { node.remove(); this.enemyBarNodes.delete(id); }
  }
  renderBindings(input, editable = false) {
    const list = document.getElementById(editable ? 'settings-bindings' : 'help-bindings'); list.replaceChildren();
    for (const action of ACTIONS) {
      const label = document.createElement('span'); label.textContent = ACTION_LABELS[action]; const key = editable ? document.createElement('button') : document.createElement('span');
      key.className = 'binding-key'; key.textContent = displayCode(input.bindings[action]) + (action === 'left' ? ' / ←' : action === 'right' ? ' / →' : '');
      if (editable) { key.dataset.binding = action; key.addEventListener('click', () => this.captureBinding(input, action, key)); }
      list.append(label, key);
    }
  }
  renderAudioSettings(audio) {
    const root = document.getElementById('audio-controls'); if (!root) return; root.replaceChildren();
    const fields = [['master', '主音量'], ['music', '音樂'], ['sfx', '音效'], ['ambience', '環境音']];
    for (const [key, labelText] of fields) {
      const row = document.createElement('label'); row.className = 'audio-control'; const label = document.createElement('span'); label.textContent = labelText;
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.value = String(Math.round(audio.settings[key] * 100)); slider.dataset.audio = key;
      const value = document.createElement('span'); value.className = 'audio-value'; value.textContent = slider.value;
      slider.addEventListener('input', () => { value.textContent = slider.value; audio.updateSettings({ [key]: Number(slider.value) / 100 }); });
      slider.addEventListener('change', () => audio.playSfx('ui_confirm', { ui: true, volume: .55 })); row.append(label, slider, value); root.append(row);
    }
    const muted = document.getElementById('audio-muted'); muted.checked = audio.settings.muted; muted.onchange = () => audio.updateSettings({ muted: muted.checked });
  }
  captureBinding(input, action, button) {
    document.querySelectorAll('.binding-key.capturing').forEach((node) => node.classList.remove('capturing')); button.classList.add('capturing'); button.textContent = '請按新按鍵…';
    const message = document.getElementById('binding-message'); message.textContent = '';
    input.beginCapture(action, (result) => { if (!result.ok) { message.textContent = result.error; return; } message.textContent = '按鍵已儲存。'; this.renderBindings(input, true); });
  }
}
