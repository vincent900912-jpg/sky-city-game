const image = (path, critical = true) => ({ path, critical });
const frames = (folder, prefix, count, critical = true) => Array.from({ length: count }, (_, index) => image(`${folder}/${prefix}_${String(index).padStart(2, '0')}.png`, critical));

export const MANIFEST = {
  player: {
    idle: frames('assets/player/chengyu/idle', 'chengyu_idle', 4),
    run: frames('assets/player/chengyu/run', 'chengyu_run', 8),
    jump_rising: frames('assets/player/chengyu/jump_rising', 'chengyu_jump_rising', 2),
    fall: frames('assets/player/chengyu/fall', 'chengyu_fall', 2),
    landing: frames('assets/player/chengyu/landing', 'chengyu_landing', 3),
    // The accepted landing compression poses are the safest identity-locked
    // low stance available in the current vertical-slice art set.
    crouch: [image('assets/player/chengyu/landing/chengyu_landing_01.png')],
    ground_attack_1: frames('assets/player/chengyu/ground_attack_1', 'chengyu_ground_attack_1', 4),
    ground_attack_2: frames('assets/player/chengyu/ground_attack_2', 'chengyu_ground_attack_2', 4),
    ground_attack_3: frames('assets/player/chengyu/ground_attack_3', 'chengyu_ground_attack_3', 6),
    air_attack: frames('assets/player/chengyu/air_attack', 'chengyu_air_attack', 4),
    air_dash: frames('assets/player/chengyu/air_dash', 'chengyu_air_dash', 4),
    wind_pulse: frames('assets/player/chengyu/wind_pulse', 'chengyu_wind_pulse', 6),
    hurt: frames('assets/player/chengyu/hurt', 'chengyu_hurt', 4),
    death: frames('assets/player/chengyu/death', 'chengyu_death', 6),
  },
  scout: {
    idle: frames('assets/enemies/wind_scout_bug/idle', 'wind_scout_bug_idle', 4),
    move: frames('assets/enemies/wind_scout_bug/move', 'wind_scout_bug_move', 6),
    attack: frames('assets/enemies/wind_scout_bug/attack', 'wind_scout_bug_attack', 6),
    hurt: frames('assets/enemies/wind_scout_bug/hurt', 'wind_scout_bug_hurt', 4),
    death: frames('assets/enemies/wind_scout_bug/death', 'wind_scout_bug_death', 6),
    projectile: frames('assets/enemies/wind_scout_bug/projectile', 'wind_bullet', 4),
  },
  guard: Object.fromEntries(Object.entries({ idle: 4, walk: 6, guard: 4, turn: 4, charge_attack: 6, stunned: 4, hurt: 4, death: 6 }).map(([key, count]) => [key, frames(`assets/enemies/courtyard_guard/${key}`, `courtyard_guard_${key}`, count)])),
  boss: {
    master: image('assets/bosses/oro/reference/oro_master_no_cross.png'),
  },
  fx: {
    slash: frames('assets/fx/player/slash_arc', 'slash_arc', 4, false),
    windPulse: frames('assets/fx/player/wind_pulse_projectile', 'wind_pulse_projectile', 4),
    hit: frames('assets/fx/common/hit_spark', 'hit_spark', 4, false),
    impact: frames('assets/fx/common/small_impact', 'small_impact', 4, false),
    reflect: frames('assets/fx/common/reflect_hint', 'reflect_hint', 4, false),
    death: frames('assets/fx/common/enemy_death_burst', 'enemy_death_burst', 4, false),
    ring: frames('assets/fx/boss/ring_blade', 'ring_blade', 4),
    bossBullet: frames('assets/fx/boss/wind_bullet', 'wind_bullet', 4),
    beam: frames('assets/fx/boss/scan_beam', 'scan_beam', 4),
    dash: frames('assets/fx/boss/dash', 'dash', 4, false),
    phase: frames('assets/fx/boss/phase_change', 'phase_change', 4, false),
  },
  parallax: Object.fromEntries(['sky', 'far-bg', 'mid-bg', 'near-bg', 'foreground-overlay'].map((name) => [name, image(`assets/levels/level_01_cloud_gate/parallax-hires/${name}.png`, name !== 'foreground-overlay')])),
  objects: Object.fromEntries(Object.entries({
    stone_platform: 'platforms/stone_platform.png', thin_platform: 'platforms/thin_platform.png', moving_platform: 'platforms/moving_platform.png', stone_wall: 'platforms/stone_wall.png', boss_arena_platform: 'platforms/boss_arena_platform.png',
    wind_ring: 'interactives/wind_ring.png', rusted_gear_door: 'interactives/rusted_gear_door.png', checkpoint: 'interactives/checkpoint.png', boss_room_door: 'interactives/boss_room_door.png',
    stone_column: 'decorations/stone_column.png', small_flag: 'decorations/small_flag.png', cloud_grass: 'decorations/cloud_grass.png', weather_vane: 'decorations/weather_vane.png',
  }).map(([key, file]) => [key, image(`assets/levels/level_01_cloud_gate/objects/${file}`, !file.startsWith('decorations/'))])),
};

export async function loadAssets(onProgress = () => {}) {
  const loaded = new Map();
  const errors = [];
  const entries = [];
  const walk = (node) => Object.values(node).forEach((value) => Array.isArray(value) ? value.forEach((item) => entries.push(item)) : value?.path ? entries.push(value) : walk(value));
  walk(MANIFEST);
  let cursor = 0; let completed = 0;
  const loadImage = (entry) => new Promise((resolve) => {
    const img = new Image(); let attempt = 0;
    const start = () => { attempt += 1; img.src = attempt === 1 ? entry.path : `${entry.path}?retry=${attempt}`; };
    img.onload = () => { loaded.set(entry.path, img); resolve(); };
    img.onerror = () => {
      if (attempt < 3) { setTimeout(start, 180 * attempt); return; }
      const message = `${entry.critical ? '核心' : '選用'}素材載入失敗：${entry.path}`; console[entry.critical ? 'error' : 'warn'](`[assets] ${message}`); errors.push({ ...entry, message }); resolve();
    };
    start();
  });
  const worker = async () => {
    while (cursor < entries.length) { const entry = entries[cursor]; cursor += 1; await loadImage(entry); completed += 1; onProgress(completed, entries.length); }
  };
  await Promise.all(Array.from({ length: Math.min(12, entries.length) }, worker));
  const critical = errors.filter((entry) => entry.critical);
  if (critical.length) throw new Error(critical.map((entry) => entry.message).join('\n'));
  const resolve = (node) => Object.fromEntries(Object.entries(node).map(([key, value]) => [key, Array.isArray(value) ? value.map((entry) => loaded.get(entry.path)).filter(Boolean) : value?.path ? loaded.get(value.path) : resolve(value)]));
  const assets = resolve(MANIFEST); validateGameplayAssets(assets); return assets;
}

function validateGameplayAssets(assets) {
  const required = [
    ['PLAYER FX / slash attacks 1-3 and air slash', assets.fx.slash, 4], ['PLAYER FX / Wind Pulse', assets.fx.windPulse, 4], ['COMMON FX / hit spark', assets.fx.hit, 4],
    ['BOSS FX / ring blade', assets.fx.ring, 4], ['BOSS FX / wind bullet', assets.fx.bossBullet, 4], ['BOSS FX / scan warning + beam', assets.fx.beam, 4], ['BOSS FX / dash', assets.fx.dash, 4], ['BOSS FX / phase change', assets.fx.phase, 4],
    ['CHECKPOINT / crystal', assets.objects.checkpoint, 1], ['CHECKPOINT / flag', assets.objects.small_flag, 1], ['CHECKPOINT / activation spark', assets.fx.hit, 4],
  ];
  const missing = required.filter(([, value, count]) => Array.isArray(value) ? value.length < count : !value).map(([name]) => name);
  if (missing.length) { const message = `Required gameplay art is incomplete:\n- ${missing.join('\n- ')}`; console.error(`[assets:validation] ${message}`); throw new Error(message); }
  console.info('[assets:validation] Player, Boss and Checkpoint FX validated');
}

export async function loadLevelData() {
  const root = 'assets/levels/level_01_cloud_gate/data';
  const names = ['level-manifest', 'objects', 'collision', 'scene-hooks'];
  const values = await Promise.all(names.map(async (name) => {
    let response;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await fetch(`${root}/${name}.json`, { cache: attempt === 1 ? 'default' : 'no-store' }).catch(() => null);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 180));
    }
    if (!response?.ok) throw new Error(`關卡資料載入失敗：${name}.json (${response?.status || 'network'})`);
    return response.json();
  }));
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}
