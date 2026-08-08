import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Player } from '../src/player.js';
import { WindScout } from '../src/enemies.js';
import { OroBoss } from '../src/boss.js';
import { overlap } from '../src/collision.js';
import { STORY_SCENES } from '../src/flow.js';
import { DEFAULT_CONTROLS, ACTIONS } from '../src/controls.js';
import { ArenaPlatformManager, ARENA_BREAK_TIMING } from '../src/platforms.js';
import { MANIFEST } from '../src/assets.js';

const root = new URL('../', import.meta.url);
const audioStub = { playSfx() {}, playMusic() {}, stopMusic() {}, startLoop() {}, stopLoop() {}, stopLoops() {}, setListenerX() {}, setPaused() {}, debugState: () => ({ unlocked: false, muted: false, master: 1, music: 'none', activeLoops: [], lastSfx: 'none' }) };
const collision = JSON.parse(await readFile(new URL('assets/levels/level_01_cloud_gate/data/collision.json', root), 'utf8'));
const objects = JSON.parse(await readFile(new URL('assets/levels/level_01_cloud_gate/data/objects.json', root), 'utf8'));
const hooks = JSON.parse(await readFile(new URL('assets/levels/level_01_cloud_gate/data/scene-hooks.json', root), 'utf8'));

const collisionIdForVisual = { approach_floor: 'floor_approach_a', courtyard_floor: 'floor_approach_b' };
for (const platform of objects.platform_visuals) {
  const physical = [...collision.solids, ...collision.one_way_platforms].find((item) => item.id === (collisionIdForVisual[platform.id] || platform.id));
  assert(physical, `missing collision for ${platform.id}`);
  assert.equal(platform.y, physical.y, `${platform.id} visual/collision top mismatch`);
}

const jumpRise = 270 ** 2 / (2 * 720);
assert(jumpRise - (184 - 144) >= 8, 'first thin platform lacks a forgiving jump margin');
assert(jumpRise - (148 - 122) >= 20, 'moving-to-upper platform route is too strict');
assert.equal(objects.decorations.every((item) => item.collision === 'none'), true, 'decorations must remain non-colliding');
assert(collision.hazards.find((item) => item.id === 'world_kill_plane').y >= 214, 'boss fall death plane is too close to the platform surface');

const arenaFloor = collision.solids.find((item) => item.id === 'boss_floor');
const arenaPlatforms = new ArenaPlatformManager(arenaFloor);
assert.deepEqual(arenaPlatforms.platforms.filter((item) => item.destroyable).map((item) => item.id), ['boss_floor_center'], 'unexpected boss platforms are destroyable');
assert.equal(arenaPlatforms.colliders().reduce((sum, item) => sum + item.w, 0), arenaFloor.w, 'phase 1 arena collision is not contiguous');
arenaPlatforms.beginCollapse();
for (let elapsed = 0; elapsed < ARENA_BREAK_TIMING.warning - .05; elapsed += 1 / 60) arenaPlatforms.update(1 / 60);
assert.equal(arenaPlatforms.center().collisionActive, true, 'center collision disappeared before the warning completed');
assert.equal(arenaPlatforms.center().visualActive, true, 'center visual disappeared before the warning completed');
for (let elapsed = ARENA_BREAK_TIMING.warning - .05; elapsed < ARENA_BREAK_TIMING.collisionRelease + .04; elapsed += 1 / 60) arenaPlatforms.update(1 / 60);
assert.equal(arenaPlatforms.center().state, 'destroyed', 'center platform did not enter destroyed state');
assert.equal(arenaPlatforms.center().collisionActive, false, 'destroyed center retained collision');
assert.equal(arenaPlatforms.center().visualActive, false, 'destroyed center retained a standable visual');
assert.equal(arenaPlatforms.syncIssues().length, 0, 'arena visual/collision state diverged');
arenaPlatforms.reset(); assert.equal(arenaPlatforms.center().state, 'intact', 'retry did not restore the center platform');

const simulateJump = (start, targetId) => {
  let firstFrame = true;
  const input = { axis: () => 1, wasPressed: (action) => action === 'jump' && firstFrame, wasReleased: () => false, isDown: () => false };
  const game = { input, audio: audioStub, worldWidth: 1152, hazards: collision.hazards, solids: () => collision.solids, oneWays: () => collision.one_way_platforms, addFx() {}, spawnProjectile() {}, resolvePlayerAttack() {}, fallRespawn() {}, showGameOver() {} };
  const actor = new Player({ ...start, facing: 'right' }); actor.grounded = true;
  for (let frame = 0; frame < 120; frame += 1) { actor.update(1 / 60, game); firstFrame = false; if (actor.grounded && Math.abs(actor.y - collision.one_way_platforms.find((item) => item.id === targetId).y) < .1) return true; }
  return false;
};
assert(simulateJump({ x: 100, y: 184 }, 'thin_01'), 'ordinary jump cannot reach thin_01');
assert(simulateJump({ x: 382, y: 184 }, 'moving_01'), 'ordinary jump cannot reach moving_01 at its low position');
assert(simulateJump({ x: 535, y: 148 }, 'thin_02'), 'moving-platform route cannot reach thin_02');
let tapFrame = true; const tapJumpGame = { input: { axis: () => 1, wasPressed: (action) => action === 'jump' && tapFrame, wasReleased: (action) => action === 'jump' && tapFrame, isDown: () => false }, audio: audioStub, worldWidth: 1152, hazards: collision.hazards, solids: () => collision.solids, oneWays: () => collision.one_way_platforms, addFx() {}, spawnProjectile() {}, resolvePlayerAttack() {}, fallRespawn() { this.fell = true; }, showGameOver() {} };
const tapJumper = new Player({ x: 282, y: 184, facing: 'right' }); tapJumper.grounded = true; tapJumper.vx = 60;
for (let frame = 0; frame < 90; frame += 1) { tapJumper.update(1 / 60, tapJumpGame); tapFrame = false; if (tapJumper.grounded && tapJumper.x > 340) break; }
assert.equal(tapJumpGame.fell, undefined, 'minimum W tap falls into the first required gap'); assert(tapJumper.x > 340 && tapJumper.grounded, 'minimum W tap cannot clear the first required gap');

assert.equal(DEFAULT_CONTROLS.jump, 'KeyW', 'new default jump must be W');
assert.equal(DEFAULT_CONTROLS.crouch, 'KeyS', 'new default crouch must be S');
assert(ACTIONS.includes('crouch'), 'crouch must be exposed to Settings and Help');
assert.equal(MANIFEST.player.crouch.length, 1, 'crouch must hold one stable low pose instead of cycling toward standing');
assert.equal(MANIFEST.boss.master.path.endsWith('oro_master_no_cross.png'), true, 'runtime boss master still points at the crossed-marker art');
const crouchActor = new Player({ x: 80, y: 184, facing: 'right' }); crouchActor.grounded = true;
let crouchJump = false;
const crouchGame = { input: { axis: () => 1, wasPressed: (action) => action === 'jump' && crouchJump, wasReleased: () => false, isDown: (action) => action === 'crouch' }, audio: audioStub, worldWidth: 1152, hazards: [], solids: () => collision.solids, oneWays: () => [], addFx() {}, spawnProjectile() {}, resolvePlayerAttack() {}, fallRespawn() {}, showGameOver() {} };
crouchActor.update(1 / 60, crouchGame);
assert.equal(crouchActor.crouching, true, 'grounded S should enter crouch');
assert.equal(crouchActor.hurtbox().h, 22, 'crouch hurtbox should be shorter');
assert(Math.abs(crouchActor.vx) < .01, 'crouch should stop horizontal acceleration');
crouchJump = true; crouchActor.update(1 / 60, crouchGame);
assert.equal(crouchActor.crouching, false, 'jump should leave crouch');
assert(crouchActor.vy < 0, 'W should jump directly from crouch');

const player = new Player({ x: 180, y: 184, facing: 'right' });
const scout = new WindScout({ id: 'test_scout', x: 210, y: 128, facing: 'left', patrol: { left: 200, right: 220 } });
player.grounded = true; player.attackStage = 2; player.attackTimer = .2;
assert(overlap(player.attackBox(), scout.hitbox()), 'ground combo stage 2 should reach a low flying scout');
player.y = 150; player.grounded = false; player.attackStage = 0; player.attackTimer = .2;
assert(overlap(player.attackBox(), scout.hitbox()), 'air attack should reliably overlap the flying scout hurtbox');

const spawned = [];
const fakeGame = { player: { x: 820, y: 176, hurtbox: () => ({ x: 812, y: 134, w: 16, h: 42 }), takeDamage: () => false }, audio: audioStub, spawnProjectile: (item) => spawned.push(item), clearBossThreats() {}, addFx() {}, phaseTwo: false, finishBoss() {}, hitStop: 0 };
const boss = new OroBoss(objects.enemy_spawns.find((item) => item.enemy === 'oro'));
boss.active = true; boss.state = 'beam'; boss.stateTime = .72; boss.update(1 / 60, fakeGame);
assert.equal(spawned.length, 1, 'beam should spawn once');
assert.equal(spawned[0].x, 960, 'beam should be centered in the arena');
assert(Math.abs(spawned[0].sourceX - boss.x) <= 45, 'beam source must remain attached to the boss emitter');
boss.x = 1000; boss.setState('dash', .61); boss.update(1 / 60, fakeGame);
assert(boss.dashTarget >= 900 && boss.dashTarget <= 1038, 'dash target escaped the safe hover zone');

let collapseCalls = 0; let bossFinished = 0;
const phaseGame = { ...fakeGame, beginPhaseTwoCollapse: () => { collapseCalls += 1; }, finishBoss: () => { bossFinished += 1; } };
const phaseBoss = new OroBoss(objects.enemy_spawns.find((item) => item.enemy === 'oro')); phaseBoss.active = true; phaseBoss.hp = 45;
phaseBoss.update(1 / 60, phaseGame); phaseBoss.update(1 / 60, phaseGame);
assert.equal(phaseBoss.phase, 2, 'boss did not enter phase 2 at 50% HP'); assert.equal(collapseCalls, 1, 'phase 2 collapse triggered more than once');
phaseBoss.state = 'core_open'; phaseBoss.hp = 1; phaseBoss.invulnerable = 0; phaseBoss.takeDamage(2, 800, phaseGame);
assert.equal(phaseBoss.dead, true, 'boss death did not start after lethal damage'); phaseBoss.update(1.5, phaseGame);
assert.equal(bossFinished, 1, 'boss death did not complete into victory exactly once');

const bossCheck = objects.interactives.find((item) => item.id === 'checkpoint_boss');
assert(bossCheck?.respawn, 'boss flag must be a functional checkpoint');
assert(hooks.triggers.some((item) => item.checkpointId === 'checkpoint_boss'), 'boss checkpoint trigger missing');
assert.equal(STORY_SCENES.flatMap((scene) => scene.beats).some((beat) => beat.endsWith('。')), false, 'intro narration still contains terminal full stops');

const requiredAnimations = [
  ['assets/player/chengyu/idle', 'chengyu_idle_', 4], ['assets/player/chengyu/run', 'chengyu_run_', 8], ['assets/player/chengyu/ground_attack_3', 'chengyu_ground_attack_3_', 6],
  ['assets/enemies/wind_scout_bug/attack', 'wind_scout_bug_attack_', 6], ['assets/enemies/courtyard_guard/charge_attack', 'courtyard_guard_charge_attack_', 6],
  ['assets/fx/player/slash_arc', 'slash_arc_', 4], ['assets/fx/boss/ring_blade', 'ring_blade_', 4], ['assets/fx/boss/scan_beam', 'scan_beam_', 4],
];
for (const [folder, prefix, expected] of requiredAnimations) { const files = (await readdir(new URL(folder + '/', root))).filter((file) => file.startsWith(prefix) && file.endsWith('.png')); assert(files.length >= expected, `${folder} is missing animation frames`); }

const manifestEntries = [];
const collectManifest = (node) => Object.values(node).forEach((value) => {
  if (Array.isArray(value)) value.forEach((entry) => manifestEntries.push(entry));
  else if (value?.path) manifestEntries.push(value);
  else collectManifest(value);
});
collectManifest(MANIFEST);
for (const entry of manifestEntries) {
  assert(!entry.path.startsWith('/'), `GitHub Pages asset path must be relative: ${entry.path}`);
  await readFile(new URL(entry.path, root));
}
const audioManifest = JSON.parse(await readFile(new URL('assets/audio/audio-manifest.json', root), 'utf8'));
const requiredAudio = ['music_opening', 'music_menu', 'music_intro', 'music_level_01', 'music_boss_oro', 'music_victory', 'player_jump', 'attack_1_swing', 'wind_scout_charge', 'guard_wall_hit', 'oro_ring_charge', 'oro_scan_warning', 'oro_phase_change', 'checkpoint_saved'];
for (const id of requiredAudio) assert(audioManifest.sounds[id], `audio manifest missing ${id}`);
for (const [id, entry] of Object.entries(audioManifest.sounds)) {
  assert(entry.volume >= 0 && entry.volume <= 1, `${id} volume is outside 0..1`);
  assert(Array.isArray(entry.paths) && entry.paths.length > 0, `${id} has no audio path`);
  for (const path of entry.paths) { const data = await readFile(new URL(path, root)); assert.equal(data.subarray(0, 4).toString(), 'RIFF', `${path} is not a WAV file`); assert.equal(data.subarray(8, 12).toString(), 'WAVE', `${path} has an invalid WAV header`); }
  if (entry.loop) assert(['music', 'sfx', 'ambience'].includes(entry.category), `${id} loop has no manageable category`);
}
const audioSources = await Promise.all(['src/game.js', 'src/player.js', 'src/enemies.js', 'src/boss.js', 'src/ui.js'].map((path) => readFile(new URL(path, root), 'utf8')));
for (const source of audioSources) for (const match of source.matchAll(/(?:playSfx|playMusic|startLoop)\('([^']+)'/g)) assert(audioManifest.sounds[match[1]], `code references unknown sound id ${match[1]}`);
const indexHtml = await readFile(new URL('index.html', root), 'utf8');
assert(!/(?:src|href)=["']\//.test(indexHtml), 'index.html contains a site-root asset path');
assert(!/(?:localhost|127\.0\.0\.1|file:\/\/\/|C:\\Users\\|C:\/Users\/)/i.test(indexHtml), 'index.html contains a local-only URL');

console.log('UX smoke checks passed');
