import { DEFAULT_CONTROLS } from './controls.js';
import { DEFAULT_AUDIO_SETTINGS } from './audio.js';

const KEY = 'skyCitySave.slot1';
const BACKUP = `${KEY}.backup`;
const defaults = {
  version: 5, level01Complete: false, introCompleted: false, checkpoint: null, unlockedSkills: ['windPulse'],
  maxHp: 10, maxEnergy: 100, controls: { ...DEFAULT_CONTROLS },
  settings: { volume: 0.8, shake: true }, audio: { ...DEFAULT_AUDIO_SETTINGS }, bestTime: null,
};

function migrate(parsed) {
  if (!parsed || ![1, 2, 3, 4, 5].includes(parsed.version)) return null;
  return {
    ...structuredClone(defaults), ...parsed, version: 5,
    introCompleted: parsed.introCompleted ?? Boolean(parsed.checkpoint || parsed.level01Complete),
    maxHp: Math.max(10, Number(parsed.maxHp) || 10),
    maxEnergy: Math.max(100, Number(parsed.maxEnergy) || 100),
    unlockedSkills: Array.isArray(parsed.unlockedSkills) ? parsed.unlockedSkills : ['windPulse'],
    controls: { ...DEFAULT_CONTROLS, ...(parsed.controls || {}) },
    settings: { ...defaults.settings, ...(parsed.settings || {}) },
    audio: { ...DEFAULT_AUDIO_SETTINGS, ...(parsed.audio || {}) },
  };
}

export function loadSave() {
  for (const key of [KEY, BACKUP]) {
    try { const raw = localStorage.getItem(key); if (raw) { const save = migrate(JSON.parse(raw)); if (save) return save; } }
    catch (error) { console.warn(`[save] 無法讀取 ${key}`, error); }
  }
  return structuredClone(defaults);
}

export function writeSave(data) {
  try {
    const previous = localStorage.getItem(KEY); if (previous) localStorage.setItem(BACKUP, previous);
    localStorage.setItem(KEY, JSON.stringify({ ...data, version: 5 })); return true;
  } catch (error) { console.error('[save] localStorage 寫入失敗', error); return false; }
}

export function resetRunSave(save) { save.checkpoint = null; writeSave(save); }
export function hasValidSave() {
  for (const key of [KEY, BACKUP]) { try { const parsed = JSON.parse(localStorage.getItem(key)); if ([1, 2, 3, 4, 5].includes(parsed?.version)) return true; } catch {} }
  return false;
}
export function resetForNewGame(save) {
  Object.assign(save, { version: 5, level01Complete: false, introCompleted: false, checkpoint: null, unlockedSkills: ['windPulse'], maxHp: 10, maxEnergy: 100, bestTime: null });
  writeSave(save); return save;
}
