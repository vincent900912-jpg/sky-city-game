export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  master: 1,
  music: 0.7,
  sfx: 0.85,
  ambience: 0.45,
  muted: false,
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
export async function createAudioManager(settings, onSettingsChange = () => {}) {
  let manifest = { sounds: {} };
  try {
    const response = await fetch('assets/audio/audio-manifest.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json();
  } catch (error) {
    console.error('[audio] Failed to load assets/audio/audio-manifest.json', error);
  }
  const manager = new AudioManager(manifest, settings, onSettingsChange);
  manager.installUnlock();
  manager.preloadGroup('boot');
  return manager;
}

export class AudioManager {
  constructor(manifest, settings, onSettingsChange = () => {}) {
    this.manifest = manifest.sounds || {};
    this.settings = { ...DEFAULT_AUDIO_SETTINGS, ...(settings || {}) };
    this.onSettingsChange = onSettingsChange;
    this.context = null; this.unlocked = false; this.paused = false;
    this.masterGain = null; this.musicGain = null; this.sfxGain = null; this.ambienceGain = null;
    this.raw = new Map(); this.buffers = new Map(); this.loading = new Map(); this.cooldowns = new Map(); this.loops = new Map();
    this.currentMusic = null; this.desiredMusic = null; this.musicRequest = 0; this.lastPlayedSfx = 'none'; this.listenerX = 0; this.unlockInstalled = false;
  }
  installUnlock() {
    if (this.unlockInstalled) return; this.unlockInstalled = true;
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchstart']) addEventListener(type, unlock, { once: true, passive: true });
  }
  async unlock() {
    if (this.unlocked) { if (this.context?.state === 'suspended') await this.context.resume().catch(() => {}); return true; }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) { console.warn('[audio] Web Audio API is unavailable'); return false; }
    try {
      this.context = new Context();
      this.masterGain = this.context.createGain(); this.musicGain = this.context.createGain(); this.sfxGain = this.context.createGain(); this.ambienceGain = this.context.createGain();
      this.musicGain.connect(this.masterGain); this.sfxGain.connect(this.masterGain); this.ambienceGain.connect(this.masterGain); this.masterGain.connect(this.context.destination);
      this.unlocked = true; this.applyVolumes(true);
      if (this.context.state === 'suspended') await this.context.resume();
      await this.decodePreloaded();
      if (this.desiredMusic) this.startMusic(this.desiredMusic.id, this.desiredMusic.fade, this.musicRequest);
      return true;
    } catch (error) { console.warn('[audio] Unlock was blocked; waiting for the next user gesture', error); this.unlocked = false; return false; }
  }
  async fetchRaw(path) {
    if (this.raw.has(path)) return this.raw.get(path);
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path} (HTTP ${response.status})`);
    const data = await response.arrayBuffer(); this.raw.set(path, data); return data;
  }
  async loadBuffer(path) {
    if (this.buffers.has(path)) return this.buffers.get(path);
    if (this.loading.has(path)) return this.loading.get(path);
    const promise = (async () => {
      const raw = await this.fetchRaw(path);
      if (!this.context) return null;
      const buffer = await this.context.decodeAudioData(raw.slice(0)); this.buffers.set(path, buffer); return buffer;
    })().catch((error) => { console.warn('[audio] Missing or invalid sound:', path, error); return null; }).finally(() => this.loading.delete(path));
    this.loading.set(path, promise); return promise;
  }
  async decodePreloaded() {
    if (!this.context) return;
    await Promise.all([...this.raw.keys()].map((path) => this.loadBuffer(path)));
  }
  async preloadGroup(group) {
    const paths = Object.values(this.manifest).filter((entry) => entry.preload === group).flatMap((entry) => entry.paths || []);
    await Promise.all(paths.map((path) => this.fetchRaw(path).catch((error) => console.warn('[audio] Preload failed:', path, error))));
    if (this.unlocked) await this.decodePreloaded();
  }
  entry(id) {
    const entry = this.manifest[id];
    if (!entry) console.warn(`[audio] Unknown sound id: ${id}`);
    return entry;
  }
  choosePath(entry) { return entry.paths[Math.floor(Math.random() * entry.paths.length)]; }
  makeChain(entry, x, volume = 1, ui = false) {
    const gain = this.context.createGain();
    const distance = entry.spatial && Number.isFinite(x) ? Math.abs(x - this.listenerX) : 0;
    const attenuation = entry.spatial ? Math.max(0.22, 1 - distance / 430) : 1;
    gain.gain.value = clamp01((entry.volume ?? 1) * volume * attenuation * (ui ? this.settings.sfx : 1));
    if (entry.spatial && this.context.createStereoPanner) {
      const pan = this.context.createStereoPanner(); pan.pan.value = Math.max(-0.8, Math.min(0.8, (x - this.listenerX) / 190)); gain.connect(pan); pan.connect(ui ? this.masterGain : entry.category === 'ambience' ? this.ambienceGain : this.sfxGain);
    } else gain.connect(ui ? this.masterGain : entry.category === 'ambience' ? this.ambienceGain : this.sfxGain);
    return gain;
  }
  async playSfx(id, options = {}) {
    const entry = this.entry(id); if (!entry || this.settings.muted || !this.unlocked || (this.paused && !options.ui)) return null;
    const now = this.context.currentTime; const cooldown = options.cooldown ?? entry.cooldown ?? 0;
    if (now < (this.cooldowns.get(id) || 0)) return null; this.cooldowns.set(id, now + cooldown);
    const path = this.choosePath(entry); const buffer = await this.loadBuffer(path); if (!buffer || !this.unlocked) return null;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = options.pitch ?? (0.975 + Math.random() * 0.05);
    const gain = this.makeChain(entry, options.x, options.volume ?? 1, options.ui); source.connect(gain); source.start(); source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch {} };
    this.lastPlayedSfx = id; return source;
  }
  async startLoop(id, key = id, options = {}) {
    if (this.loops.has(key) || !this.unlocked || this.settings.muted) return this.loops.get(key) || null;
    const entry = this.entry(id); if (!entry) return null; const buffer = await this.loadBuffer(this.choosePath(entry)); if (!buffer || this.loops.has(key)) return null;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true; const gain = this.makeChain(entry, options.x, options.volume ?? 1); source.connect(gain); source.start();
    const handle = { id, source, gain, x: options.x, volume: options.volume ?? 1 }; this.loops.set(key, handle); this.lastPlayedSfx = id; return handle;
  }
  stopLoop(key, fade = 0.12) {
    const handle = this.loops.get(key); if (!handle || !this.context) return;
    this.loops.delete(key); const now = this.context.currentTime; handle.gain.gain.cancelScheduledValues(now); handle.gain.gain.setValueAtTime(handle.gain.gain.value, now); handle.gain.gain.linearRampToValueAtTime(0, now + fade);
    try { handle.source.stop(now + fade + 0.02); } catch {}
  }
  stopLoops(prefix = '') { for (const key of [...this.loops.keys()]) if (!prefix || key.startsWith(prefix)) this.stopLoop(key); }
  setListenerX(x) {
    this.listenerX = x;
    for (const handle of this.loops.values()) {
      if (!Number.isFinite(handle.x)) continue;
      const entry = this.manifest[handle.id]; const distance = Math.abs(handle.x - x); const attenuation = Math.max(0.22, 1 - distance / 430);
      const target = clamp01((entry.volume ?? 1) * handle.volume * attenuation); handle.gain.gain.setTargetAtTime(target, this.context?.currentTime || 0, .08);
    }
  }
  playMusic(id, fade = 0.8) { this.desiredMusic = id ? { id, fade } : null; this.musicRequest += 1; if (this.unlocked) this.startMusic(id, fade, this.musicRequest); }
  async startMusic(id, fade = 0.8, request = this.musicRequest) {
    if (!id || this.currentMusic?.id === id || !this.unlocked) return;
    const entry = this.entry(id); if (!entry) return; const buffer = await this.loadBuffer(this.choosePath(entry)); if (!buffer || !this.unlocked || request !== this.musicRequest) return;
    const now = this.context.currentTime; const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = Boolean(entry.loop); const gain = this.context.createGain(); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(entry.volume ?? 1, now + fade); source.connect(gain); gain.connect(this.musicGain); source.start();
    const previous = this.currentMusic; this.currentMusic = { id, source, gain };
    if (previous) { previous.gain.gain.cancelScheduledValues(now); previous.gain.gain.setValueAtTime(previous.gain.gain.value, now); previous.gain.gain.linearRampToValueAtTime(0, now + fade); try { previous.source.stop(now + fade + .05); } catch {} }
    if (!entry.loop) source.onended = () => { if (this.currentMusic?.source === source) this.currentMusic = null; };
  }
  stopMusic(fade = .6) {
    this.desiredMusic = null; this.musicRequest += 1; if (!this.currentMusic || !this.context) return;
    const current = this.currentMusic; this.currentMusic = null; const now = this.context.currentTime; current.gain.gain.setValueAtTime(current.gain.gain.value, now); current.gain.gain.linearRampToValueAtTime(0, now + fade); try { current.source.stop(now + fade + .05); } catch {}
  }
  setPaused(paused) { this.paused = paused; this.applyVolumes(); if (paused) this.stopLoops('world:'); }
  applyVolumes(immediate = false) {
    if (!this.context) return; const now = this.context.currentTime; const ramp = immediate ? 0 : .08; const muted = this.settings.muted ? 0 : 1;
    const set = (node, value) => { node.gain.cancelScheduledValues(now); node.gain.setValueAtTime(node.gain.value, now); node.gain.linearRampToValueAtTime(value, now + ramp); };
    set(this.masterGain, clamp01(this.settings.master) * muted); set(this.musicGain, clamp01(this.settings.music) * (this.paused ? .3 : 1)); set(this.sfxGain, clamp01(this.settings.sfx) * (this.paused ? 0 : 1)); set(this.ambienceGain, clamp01(this.settings.ambience) * (this.paused ? .12 : 1));
  }
  updateSettings(next) { this.settings = { ...this.settings, ...next }; this.applyVolumes(); this.onSettingsChange({ ...this.settings }); }
  debugState() { return { unlocked: this.unlocked, muted: this.settings.muted, master: this.settings.master, music: this.currentMusic?.id || this.desiredMusic?.id || 'none', activeLoops: [...this.loops.keys()], lastSfx: this.lastPlayedSfx }; }
}
